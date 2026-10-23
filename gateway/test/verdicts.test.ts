import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MockAgent, setGlobalDispatcher } from "undici";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";
import { createRawEventStore, LocalOverrideState } from "../src/store.js";

let mockAgent: MockAgent;
let tmpDir: string;

beforeEach(() => {
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-verdicts-test-"));
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
    webhookSecret: "devsecret",
    rawEventStore,
    localState,
  });
  return { app, localState };
}

const LEDGER_ROW = {
  id: 17,
  repo: "acme/storefront",
  pr: 1,
  head_sha: "sha123",
  hunk_hash: "hashHIGH",
  decision_id: 3,
  verdict: "YES",
  payload: {
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
  },
};

describe("GET /verdicts", () => {
  it("reads the ledger and returns {flags: [...]} using the ledger row id", async () => {
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/verdicts?repo=acme%2Fstorefront&pr=1", method: "GET" })
      .reply(200, [LEDGER_ROW]);
    const { app } = await buildApp();

    const res = await request(app).get("/verdicts").query({ repo: "acme/storefront", pr: 1 });
    expect(res.status).toBe(200);
    expect(res.body.flags).toHaveLength(1);
    expect(res.body.flags[0].status).toBe("open");
  });

  it("applies a locally recorded dismiss on top of the ledger's payload status", async () => {
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/verdicts?repo=acme%2Fstorefront&pr=1", method: "GET" })
      .reply(200, [LEDGER_ROW]);
    const { app, localState } = await buildApp();
    localState.markDismissed(17);

    const res = await request(app).get("/verdicts").query({ repo: "acme/storefront", pr: 1 });
    expect(res.status).toBe(200);
    expect(res.body.flags[0].status).toBe("dismissed");
  });

  it("applies a locally recorded override on top of the ledger's payload status", async () => {
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/verdicts?repo=acme%2Fstorefront&pr=1", method: "GET" })
      .reply(200, [LEDGER_ROW]);
    const { app, localState } = await buildApp();
    localState.markOverridden(17);

    const res = await request(app).get("/verdicts").query({ repo: "acme/storefront", pr: 1 });
    expect(res.body.flags[0].status).toBe("overridden");
  });

  it("falls back to an empty list (never 500s) when the ledger is unreachable and nothing is cached", async () => {
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/verdicts?repo=acme%2Fstorefront&pr=99", method: "GET" })
      .replyWithError(new Error("ECONNREFUSED"));
    const { app } = await buildApp();

    const res = await request(app).get("/verdicts").query({ repo: "acme/storefront", pr: 99 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ flags: [] });
  });

  it("falls back to the in-memory judge cache when the ledger is down", async () => {
    mockAgent
      .get("http://github.test")
      .intercept({ path: "/repos/acme/storefront/pulls/1", method: "GET" })
      .reply(
        200,
        "diff --git a/services/payments/client.py b/services/payments/client.py\nindex 1..2 100644\n--- a/services/payments/client.py\n+++ b/services/payments/client.py\n@@ -5,1 +5,1 @@\n-MAX_RETRIES = 3\n+MAX_RETRIES = 50\n"
      );
    mockAgent
      .get("http://analyzer.test")
      .intercept({ path: "/analyze", method: "POST" })
      .reply(200, {
        hunks: [
          {
            file: "services/payments/client.py",
            old_start: 5,
            old_end: 5,
            new_start: 5,
            new_end: 5,
            old_lines: ["MAX_RETRIES = 3"],
            new_lines: ["MAX_RETRIES = 50"],
            symbol: "",
            hunk_hash: "hashHIGH",
          },
        ],
      });
    mockAgent
      .get("http://triage.test")
      .intercept({ path: "/score", method: "POST" })
      .reply(200, { scores: [{ hunk_hash: "hashHIGH", score: 0.9, reasons: [] }] });
    mockAgent
      .get("http://verdict.test")
      .intercept({ path: "/judge", method: "POST" })
      .reply(200, { flags: [LEDGER_ROW.payload], check_run_id: 1 });

    const { app } = await buildApp();
    const crypto = await import("node:crypto");
    const payload = {
      action: "synchronize",
      number: 1,
      repository: { full_name: "acme/storefront" },
      pull_request: { number: 1, head: { sha: "sha123" } },
    };
    const payloadStr = JSON.stringify(payload);
    const signature = "sha256=" + crypto.createHmac("sha256", "devsecret").update(payloadStr).digest("hex");
    await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", signature)
      .send(payloadStr);

    // Now the ledger is down for the GET.
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/verdicts?repo=acme%2Fstorefront&pr=1", method: "GET" })
      .replyWithError(new Error("ECONNREFUSED"));

    const res = await request(app).get("/verdicts").query({ repo: "acme/storefront", pr: 1 });
    expect(res.status).toBe(200);
    expect(res.body.flags).toHaveLength(1);
    expect(res.body.flags[0].hunk_hash).toBe("hashHIGH");
  });

  it("returns 400 when repo or pr query params are missing", async () => {
    const { app } = await buildApp();
    const res = await request(app).get("/verdicts").query({ repo: "acme/storefront" });
    expect(res.status).toBe(400);
  });
});

describe("POST /flags/:id/dismiss", () => {
  it("marks the flag dismissed locally even when the ledger is unreachable", async () => {
    const { app, localState } = await buildApp();
    const res = await request(app).post("/flags/17/dismiss").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, id: 17, status: "dismissed" });
    expect(localState.isDismissed(17)).toBe(true);
  });
});

describe("POST /overrides", () => {
  it("proxies to the ledger and returns the created override", async () => {
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/overrides", method: "POST" })
      .reply(201, { id: 1, verdict_id: 17, reason: "fence still applies", author: "alice" });
    const { app } = await buildApp();

    const res = await request(app).post("/overrides").send({ verdict_id: 17, reason: "fence still applies", author: "alice" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 1, verdict_id: 17, reason: "fence still applies", author: "alice" });
  });

  it("never loses the override when the ledger is down: records it locally and marks pending_sync", async () => {
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/overrides", method: "POST" })
      .replyWithError(new Error("ECONNREFUSED"));
    const { app, localState } = await buildApp();

    const res = await request(app).post("/overrides").send({ verdict_id: 17, reason: "fence still applies", author: "alice" });
    expect(res.status).toBe(201);
    expect(res.body.pending_sync).toBe(true);
    expect(localState.isOverridden(17)).toBe(true);
  });
});

describe("GET /fences/by-file, /stats, /decisions proxies", () => {
  it("proxies GET /fences/by-file", async () => {
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/fences/by-file?repo=acme%2Fstorefront", method: "GET" })
      .reply(200, [{ file: "services/payments/client.py", fence_count: 2, loc: 120 }]);
    const { app } = await buildApp();
    const res = await request(app).get("/fences/by-file").query({ repo: "acme/storefront" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ file: "services/payments/client.py", fence_count: 2, loc: 120 }]);
  });

  it("proxies GET /stats", async () => {
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/stats?repo=acme%2Fstorefront", method: "GET" })
      .reply(200, { verdicts_total: 10, flags_total: 3, overrides_total: 1, false_positive_rate: 0.33 });
    const { app } = await buildApp();
    const res = await request(app).get("/stats").query({ repo: "acme/storefront" });
    expect(res.status).toBe(200);
    expect(res.body.flags_total).toBe(3);
  });

  it("proxies GET /decisions with repo & file query params", async () => {
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/decisions?repo=acme%2Fstorefront&file=services%2Fpayments%2Fclient.py", method: "GET" })
      .reply(200, [{ id: 1, file: "services/payments/client.py", summary: "retry cap fence" }]);
    const { app } = await buildApp();
    const res = await request(app)
      .get("/decisions")
      .query({ repo: "acme/storefront", file: "services/payments/client.py" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 1, file: "services/payments/client.py", summary: "retry cap fence" }]);
  });

  it("proxies GET /decisions with only repo (no file)", async () => {
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/decisions?repo=acme%2Fstorefront", method: "GET" })
      .reply(200, []);
    const { app } = await buildApp();
    const res = await request(app).get("/decisions").query({ repo: "acme/storefront" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
