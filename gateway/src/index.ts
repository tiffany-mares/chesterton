import { createInstallationTokenProvider, loadAppAuthConfig } from "./clients/githubApp.js";
import { loadConfig } from "./config.js";
import { createApp } from "./server.js";
import { createRawEventStore, LocalOverrideState } from "./store.js";

const config = loadConfig();

// Real mode: when GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY /
// GITHUB_APP_INSTALLATION_ID are all set, GitHub calls use minted App
// installation tokens (check runs require App auth); otherwise GITHUB_TOKEN
// (or nothing, in mock mode) is used as-is.
const appAuth = loadAppAuthConfig();
const getGithubToken = appAuth ? createInstallationTokenProvider(appAuth) : undefined;

const rawEventStore = await createRawEventStore({
  mongoUrl: config.mongoUrl,
  rawEventsDir: config.rawEventsDir,
});
const localState = LocalOverrideState.load(config.localStateFile);

const app = createApp({
  analyzerUrl: config.analyzerUrl,
  triageUrl: config.triageUrl,
  verdictUrl: config.verdictUrl,
  ledgerUrl: config.ledgerUrl,
  githubApiUrl: config.githubApiUrl,
  githubToken: config.githubToken,
  getGithubToken,
  estelleUrl: config.estelleUrl,
  dashboardUrl: config.dashboardUrl,
  webhookSecret: config.githubWebhookSecret,
  rawEventStore,
  localState,
});

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`gateway listening on http://localhost:${config.port} (raw events: ${rawEventStore.mode})`);
});
