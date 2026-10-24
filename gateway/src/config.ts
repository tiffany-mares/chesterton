import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY_ROOT = path.resolve(__dirname, ".."); // src/.. == gateway/

export interface Config {
  port: number;
  analyzerUrl: string;
  triageUrl: string;
  verdictUrl: string;
  ledgerUrl: string;
  githubApiUrl: string;
  githubWebhookSecret: string;
  githubToken: string;
  estelleUrl: string;
  dashboardUrl: string;
  mongoUrl: string | undefined;
  /** Directory for raw webhook event JSON files when Mongo is unavailable. */
  rawEventsDir: string;
  /** File backing the local dismiss/override resilience state. */
  localStateFile: string;
}

/** Defaults per docs/contracts.md's ports/env-vars table. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = env.GATEWAY_DATA_DIR ?? path.resolve(GATEWAY_ROOT, "data");
  return {
    port: Number(env.PORT ?? 4000),
    analyzerUrl: env.ANALYZER_URL ?? "http://localhost:4200",
    triageUrl: env.TRIAGE_URL ?? "http://localhost:4500",
    verdictUrl: env.VERDICT_URL ?? "http://localhost:4300",
    ledgerUrl: env.LEDGER_URL ?? "http://localhost:4400",
    githubApiUrl: env.GITHUB_API_URL ?? "http://localhost:4100/github/api",
    githubWebhookSecret: env.GITHUB_WEBHOOK_SECRET ?? "devsecret",
    githubToken: env.GITHUB_TOKEN ?? "",
    estelleUrl: env.ESTELLE_URL ?? "http://localhost:4100/estelle",
    dashboardUrl: env.DASHBOARD_URL ?? "http://localhost:4600",
    mongoUrl: env.MONGO_URL || undefined,
    rawEventsDir: env.RAW_EVENTS_DIR ?? path.resolve(dataDir, "raw-events"),
    localStateFile: env.LOCAL_STATE_FILE ?? path.resolve(dataDir, "local-state.json"),
  };
}
