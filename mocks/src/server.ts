import express, { type Express } from "express";
import type { Fixtures } from "./store.js";
import { createEstelleRouter } from "./estelle.js";
import { createGithubRouter } from "./github.js";
import { createSlackRouter } from "./slackRouter.js";
import { createLinearRouter } from "./linearRouter.js";

export interface CreateAppOptions {
  fixtures: Fixtures;
  /** Where `POST /github/trigger/pr` forwards the signed webhook (GATEWAY_URL). */
  gatewayUrl: string;
  /** Shared secret used to sign the webhook body (GITHUB_WEBHOOK_SECRET). */
  webhookSecret: string;
  /** Injectable fetch for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export function createApp(opts: CreateAppOptions): Express {
  const app = express();
  app.use(express.json());

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, service: "mocks" });
  });

  app.use("/estelle", createEstelleRouter(opts.fixtures));
  app.use(
    "/github",
    createGithubRouter({
      fixtures: opts.fixtures,
      gatewayUrl: opts.gatewayUrl,
      webhookSecret: opts.webhookSecret,
      fetchImpl: opts.fetchImpl,
    })
  );
  app.use("/slack", createSlackRouter(opts.fixtures));
  app.use("/linear", createLinearRouter(opts.fixtures));

  return app;
}
