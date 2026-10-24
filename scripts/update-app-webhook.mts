// Points the GitHub App's webhook at a (new) tunnel URL. Quick tunnels get
// a fresh hostname every run, so re-run this after every `cloudflared
// tunnel --url http://localhost:4000`. Uses an App JWT
// (PATCH /app/hook/config is App-authenticated, not installation/user).
import fs from "node:fs";
import crypto from "node:crypto";

const TUNNEL = process.argv[2];
if (!TUNNEL?.startsWith("https://")) {
  console.error("usage: npx tsx scripts/update-app-webhook.mts https://<tunnel-host>");
  process.exit(1);
}

const env: Record<string, string> = {};
for (const line of fs.readFileSync("C:/Users/tiffm/Desktop/chesterton/.env", "utf-8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) env[line.slice(0, i)] = line.slice(i + 1);
}
const pem = env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n");

const now = Math.floor(Date.now() / 1000);
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const header = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
const payload = b64(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID }));
const sig = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), pem).toString("base64url");
const jwt = `${header}.${payload}.${sig}`;

const res = await fetch("https://api.github.com/app/hook/config", {
  method: "PATCH",
  headers: {
    authorization: `Bearer ${jwt}`,
    accept: "application/vnd.github+json",
    "user-agent": "chesterton-setup",
    "content-type": "application/json",
  },
  body: JSON.stringify({ url: `${TUNNEL}/webhooks/github`, content_type: "json" }),
});
const body = (await res.json()) as { url?: string; content_type?: string };
console.log("PATCH /app/hook/config:", res.status, "| url now:", body.url, "| content_type:", body.content_type);
process.exit(res.status === 200 ? 0 : 1);
