import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import {
  createOverride,
  getDecisions,
  getFencesByFile,
  getOverrides,
  getStats,
  getVerdicts,
  upsertVerdict,
} from "./clients/ledger.js";
import { buildAndPostPlaqueComment, resolveFlag } from "./plaque.js";
import { JudgeCache, LocalOverrideState, type RawEventStore } from "./store.js";
import type { Flag } from "./types.js";
import { createWebhookHandler } from "./webhook.js";

/**
 * Express 4 does not forward a rejected promise (or a thrown error inside
 * an async handler) to the error-handling middleware on its own -- an
 * unhandled rejection like that crashes the whole process. Wrapping every
 * async route handler funnels any throw/rejection into `next(err)`, so the
 * global error middleware below can turn it into a JSON 500/502 response
 * instead of taking the server down.
 */
function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

export interface CreateAppOptions {
  analyzerUrl: string;
  triageUrl: string;
  verdictUrl: string;
  ledgerUrl: string;
  githubApiUrl: string;
  githubToken: string;
  webhookSecret: string;
  rawEventStore: RawEventStore;
  localState: LocalOverrideState;
  judgeCache?: JudgeCache<Flag[]>;
  fetchImpl?: typeof fetch;
}

/** Merges ledger/cache flags with the local dismiss/override overlay so a
 * dismiss or override is never lost even if the ledger write didn't stick. */
function applyLocalOverlay(flags: Flag[], localState: LocalOverrideState): Flag[] {
  return flags.map((flag) => {
    if (localState.isDismissed(flag.id)) return { ...flag, status: "dismissed" as const };
    if (localState.isOverridden(flag.id)) return { ...flag, status: "overridden" as const };
    return flag;
  });
}

export function createApp(opts: CreateAppOptions): Express {
  const app = express();
  app.use(cors());
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );

  const judgeCache = opts.judgeCache ?? new JudgeCache<Flag[]>();

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, service: "gateway" });
  });

  app.post(
    "/webhooks/github",
    asyncHandler(
      createWebhookHandler({
        webhookSecret: opts.webhookSecret,
        rawEventStore: opts.rawEventStore,
        analyzerUrl: opts.analyzerUrl,
        triageUrl: opts.triageUrl,
        verdictUrl: opts.verdictUrl,
        githubApiUrl: opts.githubApiUrl,
        githubToken: opts.githubToken,
        fetchImpl: opts.fetchImpl,
        judgeCache,
      })
    )
  );

  app.get(
    "/verdicts",
    asyncHandler(async (req, res) => {
      const repo = String(req.query.repo ?? "");
      if (!repo) {
        res.status(400).json({ error: "repo query param is required" });
        return;
      }

      // `pr` is optional per docs/contracts.md: omitted returns all flags
      // for the repo (dashboard verdict history).
      let pr: number | undefined;
      if (req.query.pr !== undefined && req.query.pr !== "") {
        const parsedPr = Number(req.query.pr);
        if (Number.isNaN(parsedPr)) {
          res.status(400).json({ error: "pr query param must be a number" });
          return;
        }
        pr = parsedPr;
      }

      let flags: Flag[];
      try {
        const rows = await getVerdicts(opts.ledgerUrl, repo, pr, opts.fetchImpl);
        flags = rows.map((row) => ({ ...(row.payload as Flag), id: row.id }));
      } catch {
        // The judge cache is keyed by repo:pr, so it can only help the
        // ledger-down fallback when a specific pr was requested.
        flags = pr !== undefined ? judgeCache.get(repo, pr) ?? [] : [];
      }

      res.json({ flags: applyLocalOverlay(flags, opts.localState) });
    })
  );

  app.post(
    "/flags/:id/dismiss",
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: "invalid flag id" });
        return;
      }

      // Never lose a dismiss silently: record it locally first. Guarded so
      // a local-storage failure (e.g. a disk write error) degrades
      // gracefully -- the response below is still returned -- instead of
      // crashing the process.
      try {
        opts.localState.markDismissed(id);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("gateway: localState.markDismissed failed", err instanceof Error ? err.message : err);
      }

      // Best-effort: if we have this flag cached (repo/pr/head_sha/hunk_hash
      // known), also push the status update to the ledger for durability
      // beyond this gateway process's lifetime.
      const entry = judgeCache.findEntry((flags) => flags.some((f) => f.id === id));
      if (entry) {
        const flag = entry.value.find((f) => f.id === id);
        if (flag) {
          try {
            await upsertVerdict(
              opts.ledgerUrl,
              {
                repo: flag.repo,
                pr: flag.pr,
                head_sha: flag.head_sha,
                hunk_hash: flag.hunk_hash,
                decision_id: null,
                verdict: flag.verdict,
                payload: { ...flag, status: "dismissed" },
              },
              opts.fetchImpl
            );
          } catch {
            // Ledger down: local state above is still authoritative.
          }
        }
      }

      res.json({ ok: true, id, status: "dismissed" });
    })
  );

  app.post(
    "/overrides",
    asyncHandler(async (req, res) => {
      const { verdict_id, reason, author } = req.body as { verdict_id?: number; reason?: string; author?: string };
      if (verdict_id === undefined || !reason || !author) {
        res.status(400).json({ error: "verdict_id, reason, author are required" });
        return;
      }

      try {
        const created = await createOverride(opts.ledgerUrl, { verdict_id, reason, author }, opts.fetchImpl);
        opts.localState.markOverridden(verdict_id);
        res.status(201).json(created);
      } catch {
        // Ledger down: never lose the override silently either.
        const record = opts.localState.addPendingOverride(verdict_id, reason, author);
        res.status(201).json({ ...record, pending_sync: true });
      }
    })
  );

  // Added per controller scope addition: straight proxy of ledger's
  // GET /overrides, consumed by the dashboard's overrides view.
  app.get(
    "/overrides",
    asyncHandler(async (req, res) => {
      const repo = String(req.query.repo ?? "");
      try {
        const result = await getOverrides(opts.ledgerUrl, repo, opts.fetchImpl);
        res.json(result);
      } catch (err) {
        res.status(502).json({ error: "ledger unavailable", message: err instanceof Error ? err.message : String(err) });
      }
    })
  );

  app.post(
    "/plaque",
    asyncHandler(async (req, res) => {
      const { repo, pr, flag_id } = req.body as { repo?: string; pr?: number; flag_id?: number };
      if (!repo || pr === undefined || flag_id === undefined) {
        res.status(400).json({ error: "repo, pr, flag_id are required" });
        return;
      }

      try {
        const flag = await resolveFlag(
          { ledgerUrl: opts.ledgerUrl, judgeCache, fetchImpl: opts.fetchImpl },
          repo,
          pr,
          flag_id
        );
        if (!flag) {
          res.status(404).json({ error: "flag not found" });
          return;
        }

        const posted = await buildAndPostPlaqueComment(
          { githubApiUrl: opts.githubApiUrl, githubToken: opts.githubToken, fetchImpl: opts.fetchImpl },
          repo,
          pr,
          flag
        );
        res.status(201).json({ posted: true, comment: posted });
      } catch (err) {
        res.status(502).json({ error: "plaque failed", message: err instanceof Error ? err.message : String(err) });
      }
    })
  );

  app.get(
    "/fences/by-file",
    asyncHandler(async (req, res) => {
      const repo = String(req.query.repo ?? "");
      try {
        const result = await getFencesByFile(opts.ledgerUrl, repo, opts.fetchImpl);
        res.json(result);
      } catch (err) {
        res.status(502).json({ error: "ledger unavailable", message: err instanceof Error ? err.message : String(err) });
      }
    })
  );

  app.get(
    "/stats",
    asyncHandler(async (req, res) => {
      const repo = String(req.query.repo ?? "");
      try {
        const result = await getStats(opts.ledgerUrl, repo, opts.fetchImpl);
        res.json(result);
      } catch (err) {
        res.status(502).json({ error: "ledger unavailable", message: err instanceof Error ? err.message : String(err) });
      }
    })
  );

  // Added per controller scope addition: straight proxy for the dashboard's
  // fence side panel.
  app.get(
    "/decisions",
    asyncHandler(async (req, res) => {
      const repo = String(req.query.repo ?? "");
      const file = req.query.file !== undefined ? String(req.query.file) : undefined;
      try {
        const result = await getDecisions(opts.ledgerUrl, repo, file, opts.fetchImpl);
        res.json(result);
      } catch (err) {
        res.status(502).json({ error: "ledger unavailable", message: err instanceof Error ? err.message : String(err) });
      }
    })
  );

  // Global error middleware: the last-resort safety net for any
  // throw/rejection that escapes a route handler (via asyncHandler's
  // next(err), or a synchronous throw in a non-async handler). Without
  // this, Express 4 has no built-in default beyond its bare-bones
  // text/html handler, and an unhandled rejection upstream of this would
  // otherwise crash the process.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      return;
    }
    // eslint-disable-next-line no-console
    console.error("gateway: unhandled route error", err instanceof Error ? err.stack ?? err.message : err);
    res.status(500).json({ error: "internal error", message: err instanceof Error ? err.message : String(err) });
  });

  return app;
}
