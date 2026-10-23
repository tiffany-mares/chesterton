import { loadConfig } from "./config.js";
import { createApp } from "./server.js";
import { createRawEventStore, LocalOverrideState } from "./store.js";

const config = loadConfig();

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
  webhookSecret: config.githubWebhookSecret,
  rawEventStore,
  localState,
});

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`gateway listening on http://localhost:${config.port} (raw events: ${rawEventStore.mode})`);
});
