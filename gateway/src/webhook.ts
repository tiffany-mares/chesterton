/**
 * GitHub webhook intake: raw-body HMAC verification (timing-safe) and the
 * pull_request action filter. Raw payload is always stored (via the
 * injected RawEventStore) BEFORE any pipeline processing, but AFTER
 * signature verification succeeds (an unauthenticated POST is rejected
 * outright and never persisted or processed).
 */

import crypto from "node:crypto";
import type { Request, Response } from "express";
import { runPipeline, type PipelineDeps } from "./pipeline.js";
import type { RawEventStore } from "./store.js";

export function verifyGithubSignature(secret: string, rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

const HANDLED_ACTIONS = new Set(["opened", "synchronize"]);

export interface WebhookDeps extends PipelineDeps {
  webhookSecret: string;
  rawEventStore: RawEventStore;
}

interface PullRequestWebhookBody {
  action?: string;
  repository?: { full_name?: string };
  pull_request?: { number?: number; head?: { sha?: string } };
  number?: number;
}

export function createWebhookHandler(deps: WebhookDeps) {
  return async function handleWebhook(req: Request, res: Response): Promise<void> {
    const signatureHeader = req.header("x-hub-signature-256");
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

    if (!rawBody || !verifyGithubSignature(deps.webhookSecret, rawBody, signatureHeader)) {
      res.status(401).json({ error: "invalid signature" });
      return;
    }

    const body = req.body as PullRequestWebhookBody;
    const deliveryId = req.header("x-github-delivery");

    // Stored before any processing of the payload, using the exact raw
    // bytes (not the parsed-and-reserialized body). Guarded: a storage
    // failure (disk full, Mongo hiccup, etc.) must not crash the process or
    // block pipeline processing -- log and continue.
    try {
      await deps.rawEventStore.save(rawBody, deliveryId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("gateway: rawEventStore.save failed, continuing", err instanceof Error ? err.message : err);
    }

    // Route on the event type when GitHub sends it. The demo's mock trigger
    // (mocks/src/github.ts `POST /trigger/pr`) does not set X-GitHub-Event,
    // so a missing header is treated as "pull_request" for mock
    // compatibility; a present header that isn't "pull_request" is ignored
    // outright (e.g. issues, push) before any action-based branching.
    const eventType = req.header("x-github-event");
    if (eventType && eventType !== "pull_request") {
      res.status(200).json({ ignored: true });
      return;
    }

    const action = body.action;
    if (!action || !HANDLED_ACTIONS.has(action)) {
      res.status(200).json({ ignored: true });
      return;
    }

    const repo = body.repository?.full_name;
    const pr = body.pull_request?.number ?? body.number;
    const headSha = body.pull_request?.head?.sha;

    if (!repo || pr === undefined || !headSha) {
      res.status(400).json({ error: "missing repository.full_name, pull_request.number, or pull_request.head.sha" });
      return;
    }

    try {
      const result = await runPipeline({ repo, pr, headSha }, deps);
      res.status(200).json({ flags: result.flags.length });
    } catch (err) {
      res.status(502).json({ error: "pipeline failed", message: err instanceof Error ? err.message : String(err) });
    }
  };
}
