import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { Fixtures } from "./store.js";
import { readPrDiff } from "./store.js";
import { renderPrFilesPage } from "./pages/prFiles.js";

const DIFF_ACCEPT = "application/vnd.github.v3.diff";

interface CheckRunBody {
  name: string;
  head_sha: string;
  status: string;
  conclusion: string;
  output: { title: string; summary: string };
}

interface CommentBody {
  body: string;
  commit_id: string;
  path: string;
  line: number;
  side: string;
}

type StoredComment = CommentBody & { id: number; repo: string; pr: number };

/**
 * Review-comment storage, shared between the GitHub API router (which
 * writes via POST /pulls/:n/comments) and the pages router (which reads it
 * to render stored comments -- including plaque suggestions -- on the PR
 * files page). Created fresh per createGithubRouter() call so state stays
 * isolated per app instance, same as the check-runs store below.
 */
interface CommentStore {
  items: StoredComment[];
  nextId: number;
}

export interface GithubRouterOptions {
  fixtures: Fixtures;
  gatewayUrl: string;
  webhookSecret: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

function findPr(fixtures: Fixtures, number: number) {
  return fixtures.prs.prs.find((p) => p.number === number);
}

/** `GET/POST /repos/...`, `GET/POST /pulls/.../comments`, `POST /check-runs`, etc. */
function createGithubApiRouter(fixtures: Fixtures, commentStore: CommentStore): Router {
  const router = Router();

  // In-memory store, scoped to this router instance (fresh per createApp() call).
  const checkRuns: Array<CheckRunBody & { id: number; repo: string }> = [];
  let nextCheckRunId = 1;

  router.get("/repos/:owner/:repo/pulls/:n", (req: Request, res: Response) => {
    const number = Number(req.params.n);
    const pr = findPr(fixtures, number);
    if (!pr) {
      res.status(404).json({ message: "Not Found" });
      return;
    }

    const accept = req.header("accept") ?? "";
    if (accept.includes(DIFF_ACCEPT) || accept.includes("application/vnd.github.diff")) {
      const diffText = readPrDiff(fixtures, pr.diff_file);
      res.status(200).type(DIFF_ACCEPT).send(diffText);
      return;
    }

    res.json({
      number: pr.number,
      title: pr.title,
      state: "open",
      head: { sha: pr.head_sha, ref: pr.branch },
      base: { ref: pr.base },
    });
  });

  router.post("/repos/:owner/:repo/check-runs", (req: Request, res: Response) => {
    const body = req.body as Partial<CheckRunBody>;
    if (!body || typeof body.name !== "string" || typeof body.head_sha !== "string") {
      res.status(400).json({ message: "expected { name, head_sha, status, conclusion, output }" });
      return;
    }
    const record = {
      id: nextCheckRunId++,
      repo: `${req.params.owner}/${req.params.repo}`,
      name: body.name,
      head_sha: body.head_sha,
      status: body.status ?? "completed",
      conclusion: body.conclusion ?? "neutral",
      output: body.output ?? { title: "", summary: "" },
    };
    checkRuns.push(record);
    res.status(201).json(record);
  });

  router.get("/repos/:owner/:repo/commits/:sha/check-runs", (req: Request, res: Response) => {
    const repo = `${req.params.owner}/${req.params.repo}`;
    const runs = checkRuns.filter((cr) => cr.repo === repo && cr.head_sha === req.params.sha);
    res.json({ check_runs: runs });
  });

  router.post("/repos/:owner/:repo/pulls/:n/comments", (req: Request, res: Response) => {
    const body = req.body as Partial<CommentBody>;
    if (!body || typeof body.body !== "string" || typeof body.path !== "string") {
      res.status(400).json({ message: "expected { body, commit_id, path, line, side }" });
      return;
    }
    const record: StoredComment = {
      id: commentStore.nextId++,
      repo: `${req.params.owner}/${req.params.repo}`,
      pr: Number(req.params.n),
      body: body.body,
      commit_id: body.commit_id ?? "",
      path: body.path,
      line: body.line ?? 0,
      side: body.side ?? "RIGHT",
    };
    commentStore.items.push(record);
    res.status(201).json(record);
  });

  router.get("/repos/:owner/:repo/pulls/:n/comments", (req: Request, res: Response) => {
    const repo = `${req.params.owner}/${req.params.repo}`;
    const n = Number(req.params.n);
    res.json(commentStore.items.filter((c) => c.repo === repo && c.pr === n));
  });

  return router;
}

/** `POST /trigger/pr?owner=&repo=&pr=` — signs and forwards a synchronize webhook to the gateway. */
function createTriggerRouter(opts: GithubRouterOptions): Router {
  const router = Router();
  const { fixtures, gatewayUrl, webhookSecret } = opts;
  const doFetch = opts.fetchImpl ?? fetch;

  router.post("/trigger/pr", async (req: Request, res: Response) => {
    const owner = String(req.query.owner ?? "");
    const repo = String(req.query.repo ?? "");
    const prNumber = Number(req.query.pr);

    const pr = findPr(fixtures, prNumber);
    if (!owner || !repo || !pr) {
      res.status(404).json({ message: "unknown owner/repo/pr" });
      return;
    }

    const payload = {
      action: "synchronize",
      number: pr.number,
      repository: { full_name: `${owner}/${repo}` },
      pull_request: {
        number: pr.number,
        head: { sha: pr.head_sha },
        base: { ref: pr.base },
      },
    };
    const bodyStr = JSON.stringify(payload);
    const signature = "sha256=" + crypto.createHmac("sha256", webhookSecret).update(bodyStr).digest("hex");

    try {
      const upstream = await doFetch(`${gatewayUrl}/webhooks/github`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": signature,
        },
        body: bodyStr,
      });
      const text = await upstream.text();
      res.status(200).json({ ok: true, gateway_status: upstream.status, gateway_body: safeJson(text) });
    } catch (err) {
      res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** `GET /:owner/:repo/pull/:n/files` — renders the PR diff as a GitHub-like HTML page. */
function createPagesRouter(fixtures: Fixtures, commentStore: CommentStore): Router {
  const router = Router();

  router.get("/:owner/:repo/pull/:n/files", (req: Request, res: Response) => {
    const number = Number(req.params.n);
    const pr = findPr(fixtures, number);
    if (!pr) {
      res.status(404).send("Not Found");
      return;
    }
    const diffText = readPrDiff(fixtures, pr.diff_file);
    const repo = `${req.params.owner}/${req.params.repo}`;
    const comments = commentStore.items.filter((c) => c.repo === repo && c.pr === number);
    const html = renderPrFilesPage({
      owner: req.params.owner,
      repo: req.params.repo,
      pr,
      diffText,
      comments,
    });
    res.type("html").send(html);
  });

  return router;
}

/** Mounts the full `/github` surface: `/api/*`, `/trigger/pr`, and `/:owner/:repo/pull/:n/files`. */
export function createGithubRouter(opts: GithubRouterOptions): Router {
  const router = Router();
  // Shared so a plaque comment POSTed via /api/.../comments shows up when
  // the PR files page is re-rendered (controller ruling, final-review fix
  // wave: beat 6 of the demo now ends on this suggestion actually appearing).
  const commentStore: CommentStore = { items: [], nextId: 1 };
  router.use("/api", createGithubApiRouter(opts.fixtures, commentStore));
  router.use("/", createTriggerRouter(opts));
  router.use("/", createPagesRouter(opts.fixtures, commentStore));
  return router;
}
