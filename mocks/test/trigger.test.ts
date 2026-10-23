import { describe, expect, it, afterEach } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { loadFixtures } from "../src/store.js";
import { createApp } from "../src/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");
const fixtures = loadFixtures({ seedOutDir: FIXTURES_DIR });
const SECRET = "devsecret";

let receiver: http.Server | undefined;

afterEach(() => {
  receiver?.close();
  receiver = undefined;
});

function startReceiver(): Promise<{ url: string; received: Promise<{ body: string; headers: http.IncomingHttpHeaders; path: string | undefined }> }> {
  let resolveReceived: (v: { body: string; headers: http.IncomingHttpHeaders; path: string | undefined }) => void;
  const received = new Promise<{ body: string; headers: http.IncomingHttpHeaders; path: string | undefined }>((resolve) => {
    resolveReceived = resolve;
  });

  return new Promise((resolve) => {
    receiver = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        resolveReceived({ body, headers: req.headers, path: req.url });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ flags: 1 }));
      });
    });
    receiver.listen(0, "127.0.0.1", () => {
      const addr = receiver!.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, received });
    });
  });
}

describe("POST /github/trigger/pr", () => {
  it("signs a synchronize webhook payload and POSTs it to GATEWAY_URL/webhooks/github", async () => {
    const { url, received } = await startReceiver();
    const app = createApp({ fixtures, webhookSecret: SECRET, gatewayUrl: url });

    const res = await request(app).post("/github/trigger/pr").query({ owner: "acme", repo: "storefront", pr: 1 });
    expect(res.status).toBe(200);

    const { body, headers, path: reqPath } = await received;
    expect(reqPath).toBe("/webhooks/github");

    const expectedSig =
      "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");
    expect(headers["x-hub-signature-256"]).toBe(expectedSig);

    const payload = JSON.parse(body);
    expect(payload).toMatchObject({
      action: "synchronize",
      number: 1,
      repository: { full_name: "acme/storefront" },
      pull_request: {
        number: 1,
        head: { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        base: { ref: "main" },
      },
    });
  });

  it("404s when the PR number is not in prs.json", async () => {
    const { url } = await startReceiver();
    const app = createApp({ fixtures, webhookSecret: SECRET, gatewayUrl: url });
    const res = await request(app).post("/github/trigger/pr").query({ owner: "acme", repo: "storefront", pr: 9999 });
    expect(res.status).toBe(404);
  });
});
