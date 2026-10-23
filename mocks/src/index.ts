import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./server.js";
import { loadFixtures } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCKS_ROOT = path.resolve(__dirname, ".."); // src/.. == mocks/

const PORT = Number(process.env.PORT ?? 4100);
const SEED_OUT_DIR = process.env.SEED_OUT_DIR ?? path.resolve(MOCKS_ROOT, "../seed/out");
const KNOWLEDGE_FILE = process.env.KNOWLEDGE_FILE;
const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:4000";
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "devsecret";

const fixtures = loadFixtures({ seedOutDir: SEED_OUT_DIR, knowledgeFile: KNOWLEDGE_FILE });

const app = createApp({
  fixtures,
  gatewayUrl: GATEWAY_URL,
  webhookSecret: GITHUB_WEBHOOK_SECRET,
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`mocks listening on http://localhost:${PORT} (SEED_OUT_DIR=${SEED_OUT_DIR})`);
});
