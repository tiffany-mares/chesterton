import cors from "cors";
import express, { type Express, type Request } from "express";
import { createOverride, getDecisions, getFencesByFile, getStats, getVerdicts, upsertVerdict } from "./clients/ledger.js";
import { buildAndPostPlaqueComment, resolveFlag } from "./plaque.js";
import { JudgeCache, LocalOverrideState, type RawEventStore } from "./store.js";
import type { Flag } from "./types.js";
import { createWebhookHandler } from "./webhook.js";

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
  );

  app.get("/verdicts", async (req, res) => {
    const repo = String(req.query.repo ?? "");
    const pr = Number(req.query.pr);
    if (!repo || Number.isNaN(pr)) {
      res.status(400).json({ error: "repo and pr query params are required" });
      return;
    }

    let flags: Flag[];
    try {
      const rows = await getVerdicts(opts.ledgerUrl, repo, pr, opts.fetchImpl);
      flags = rows.map((row) => ({ ...(row.payload as Flag), id: row.id }));
    } catch {
      flags = judgeCache.get(repo, pr) ?? [];
    }

    res.json({ flags: applyLocalOverlay(flags, opts.localState) });
  });

  app.post("/flags/:id/dismiss", async (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "invalid flag id" });
      return;
    }

    // Never lose a dismiss silently: record it locally first.
    opts.localState.markDismissed(id);

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
  });

  app.post("/overrides", async (req, res) => {
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
  });

  app.post("/plaque", async (req, res) => {
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
  });

  app.get("/fences/by-file", async (req, res) => {
    const repo = String(req.query.repo ?? "");
    try {
      const result = await getFencesByFile(opts.ledgerUrl, repo, opts.fetchImpl);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: "ledger unavailable", message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/stats", async (req, res) => {
    const repo = String(req.query.repo ?? "");
    try {
      const result = await getStats(opts.ledgerUrl, repo, opts.fetchImpl);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: "ledger unavailable", message: err instanceof Error ? err.message : String(err) });
    }
  });

  // Added per controller scope addition: straight proxy for the dashboard's
  // fence side panel.
  app.get("/decisions", async (req, res) => {
    const repo = String(req.query.repo ?? "");
    const file = req.query.file !== undefined ? String(req.query.file) : undefined;
    try {
      const result = await getDecisions(opts.ledgerUrl, repo, file, opts.fetchImpl);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: "ledger unavailable", message: err instanceof Error ? err.message : String(err) });
    }
  });

  return app;
}
