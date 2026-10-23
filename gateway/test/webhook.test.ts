import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MockAgent, setGlobalDispatcher } from "undici";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";
import { createRawEventStore, LocalOverrideState, type RawEventStore } from "../src/store.js";

const SECRET = "devsecret";

function sign(secret: string, body: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

let mockAgent: MockAgent;
let tmpDir: string;

beforeEach(() => {
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-webhook-test-"));
});

afterEach(async () => {
  await mockAgent.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function buildApp() {
  const rawEventStore = await createRawEventStore({ mongoUrl: undefined, rawEventsDir: tmpDir });
  const localState = LocalOverrideState.load(path.join(tmpDir, "local-state.json"));
  const app = createApp({
    analyzerUrl: "http://analyzer.test",
    triageUrl: "http://triage.test",
    verdictUrl: "http://verdict.test",
    ledgerUrl: "http://ledger.test",
    githubApiUrl: "http://github.test",
    githubToken: "",
    webhookSecret: SECRET,
    rawEventStore,
    localState,
  });
  return { app, rawEventStore };
}

const DIFF_TEXT =
  "diff --git a/services/payments/client.py b/services/payments/client.py\n" +
  "index c1f660d..ccc8363 100644\n" +
  "--- a/services/payments/client.py\n" +
  "+++ b/services/payments/client.py\n" +
  "@@ -2,7 +2,7 @@\n \n import time\n \n-MAX_RETRIES = 3\n+MAX_RETRIES = 50\n BACKOFF_SECONDS = 2\n";

const HUNK = {
  file: "services/payments/client.py",
  old_start: 5,
  old_end: 5,
  new_start: 5,
  new_end: 5,
  old_lines: ["MAX_RETRIES = 3"],
  new_lines: ["MAX_RETRIES = 50"],
  symbol: "",
  hunk_hash: "hashHIGH",
};

const FLAG = {
  id: 17,
  repo: "acme/storefront",
  pr: 1,
  head_sha: "sha123",
  file: "services/payments/client.py",
  line: 5,
  kind: "contradiction",
  verdict: "YES",
  reason: "contradicts incident fence",
  citations: [],
  hunk_hash: "hashHIGH",
  status: "open",
};

function stubHappyPathDownstream() {
  mockAgent
    .get("http://github.test")
    .intercept({ path: "/repos/acme/storefront/pulls/1", method: "GET" })
    .reply(200, DIFF_TEXT);
  mockAgent
    .get("http://analyzer.test")
    .intercept({ path: "/analyze", method: "POST" })
    .reply(200, { hunks: [HUNK] });
  mockAgent
    .get("http://triage.test")
    .intercept({ path: "/score", method: "POST" })
    .reply(200, { scores: [{ hunk_hash: "hashHIGH", score: 0.9, reasons: ["changed_numeric_constant"] }] });
  mockAgent
    .get("http://verdict.test")
    .intercept({ path: "/judge", method: "POST" })
    .reply(200, { flags: [FLAG], check_run_id: 42 });
}

const PAYLOAD = {
  action: "synchronize",
  number: 1,
  repository: { full_name: "acme/storefront" },
  pull_request: { number: 1, head: { sha: "sha123" }, base: { ref: "main" } },
};
const PAYLOAD_STR = JSON.stringify(PAYLOAD);

describe("POST /webhooks/github", () => {
  it("rejects a bad signature with 401 and does not store or process the event", async () => {
    const { app } = await buildApp();
    const res = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", "sha256=deadbeef")
      .send(PAYLOAD_STR);

    expect(res.status).toBe(401);
    expect(fs.readdirSync(tmpDir).filter((f) => f !== "local-state.json")).toHaveLength(0);
  });

  it("rejects a missing signature header with 401", async () => {
    const { app } = await buildApp();
    const res = await request(app).post("/webhooks/github").set("Content-Type", "application/json").send(PAYLOAD_STR);
    expect(res.status).toBe(401);
  });

  it("stores the raw payload before processing, runs the full pipeline, and returns {flags: N}", async () => {
    stubHappyPathDownstream();
    const { app } = await buildApp();
    const signature = sign(SECRET, PAYLOAD_STR);

    const res = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", signature)
      .set("X-GitHub-Delivery", "delivery-abc")
      .send(PAYLOAD_STR);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ flags: 1 });

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".json") && f !== "local-state.json");
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/delivery-abc\.json$/);
    const stored = JSON.parse(fs.readFileSync(path.join(tmpDir, files[0]), "utf8"));
    expect(stored.action).toBe("synchronize");
  });

  it("returns {ignored: true} for actions other than opened|synchronize, but still stores the raw payload", async () => {
    const { app } = await buildApp();
    const closedPayload = { ...PAYLOAD, action: "closed" };
    const closedStr = JSON.stringify(closedPayload);
    const signature = sign(SECRET, closedStr);

    const res = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", signature)
      .send(closedStr);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ignored: true });

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".json") && f !== "local-state.json");
    expect(files).toHaveLength(1);
  });

  it("returns 400 for a synchronize payload missing repository/pull_request fields, without crashing", async () => {
    const { app } = await buildApp();
    const malformed = { action: "synchronize" };
    const malformedStr = JSON.stringify(malformed);
    const signature = sign(SECRET, malformedStr);

    const res = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", signature)
      .send(malformedStr);

    expect(res.status).toBe(400);
  });

  it("ignores non-pull_request event types via X-GitHub-Event, even with a pull_request-shaped action", async () => {
    const { app } = await buildApp();
    // action "opened" would normally be handled, but the header says this
    // is an "issues" event, which must be ignored before any action check.
    // No downstream mocks are registered: if the pipeline ran anyway, the
    // MockAgent (disableNetConnect) would throw.
    const issuesPayload = { ...PAYLOAD, action: "opened" };
    const issuesStr = JSON.stringify(issuesPayload);
    const signature = sign(SECRET, issuesStr);

    const res = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", signature)
      .set("X-GitHub-Event", "issues")
      .send(issuesStr);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ignored: true });
  });

  it("treats a missing X-GitHub-Event header as pull_request (mock trigger compatibility)", async () => {
    stubHappyPathDownstream();
    const { app } = await buildApp();
    const signature = sign(SECRET, PAYLOAD_STR);

    // Mirrors mocks/src/github.ts's POST /trigger/pr, which signs and
    // forwards the webhook WITHOUT an X-GitHub-Event header.
    const res = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", signature)
      .send(PAYLOAD_STR);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ flags: 1 });
  });

  it("handles the opened action the same as synchronize", async () => {
    stubHappyPathDownstream();
    const { app } = await buildApp();
    const openedPayload = { ...PAYLOAD, action: "opened" };
    const openedStr = JSON.stringify(openedPayload);
    const signature = sign(SECRET, openedStr);

    const res = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", signature)
      .send(openedStr);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ flags: 1 });
  });
});

describe("resilience: a storage failure degrades gracefully instead of crashing", () => {
  it("continues to the pipeline (and keeps serving subsequent requests) when rawEventStore.save rejects", async () => {
    stubHappyPathDownstream();
    const localState = LocalOverrideState.load(path.join(tmpDir, "local-state.json"));
    const throwingStore: RawEventStore = {
      mode: "file",
      save: async () => {
        throw new Error("disk full");
      },
      close: async () => {},
    };
    const app = createApp({
      analyzerUrl: "http://analyzer.test",
      triageUrl: "http://triage.test",
      verdictUrl: "http://verdict.test",
      ledgerUrl: "http://ledger.test",
      githubApiUrl: "http://github.test",
      githubToken: "",
      webhookSecret: SECRET,
      rawEventStore: throwingStore,
      localState,
    });
    const signature = sign(SECRET, PAYLOAD_STR);

    const res = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", signature)
      .send(PAYLOAD_STR);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ flags: 1 });

    // The process (and this app/server) must still be serving afterwards.
    const health = await request(app).get("/healthz");
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true, service: "gateway" });
  });
});

describe("GET /healthz", () => {
  it("returns ok:true, service:gateway", async () => {
    const { app } = await buildApp();
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, service: "gateway" });
  });
});

describe("CORS", () => {
  it("allows all origins", async () => {
    const { app } = await buildApp();
    const res = await request(app).get("/healthz").set("Origin", "http://example.com");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });
});
