import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MockAgent, setGlobalDispatcher } from "undici";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/server.js";
import { createRawEventStore, JudgeCache, LocalOverrideState } from "../src/store.js";
import type { Flag } from "../src/types.js";

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

async function buildApp(judgeCache?: JudgeCache<Flag[]>) {
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
    judgeCache,
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

  // Regression (task-11 e2e): verdict persists every check it attempts to
  // the ledger, not just the ones that produced a flag (docs/contracts.md:
  // "still persisted to the ledger even with no flag"). A hunk's own
  // non-flagged contradiction-check row shares the PR with a legitimately
  // flagged stale_comment row for an adjacent comment -- exactly PR3 from
  // docs/contracts.md's "three demo PRs" (CHECKOUT_TIMEOUT_SECONDS hunk:
  // NO_EVIDENCE/no flag; its comment: stale/flagged). The no-flag row's
  // payload never sets `status`, so it must not come back as a Flag.
  it("excludes no-flag placeholder ledger rows (verdict checked, nothing to flag) from /verdicts", async () => {
    const noFlagRow = {
      id: 5,
      repo: "acme/storefront",
      pr: 3,
      head_sha: "sha3",
      hunk_hash: "hh-timeout",
      decision_id: null,
      verdict: "NO_EVIDENCE",
      payload: {
        id: 0,
        repo: "acme/storefront",
        pr: 3,
        head_sha: "sha3",
        file: "services/checkout/api.py",
        line: 0,
        kind: "contradiction",
        verdict: "NO_EVIDENCE",
        reason: "No recorded decision covers this change.",
        citations: [],
        hunk_hash: "hh-timeout",
        status: "",
      },
    };
    const staleFlagRow = {
      id: 6,
      repo: "acme/storefront",
      pr: 3,
      head_sha: "sha3",
      hunk_hash: "stale:services/checkout/api.py:7",
      decision_id: null,
      verdict: "YES",
      payload: {
        id: 6,
        repo: "acme/storefront",
        pr: 3,
        head_sha: "sha3",
        file: "services/checkout/api.py",
        line: 7,
        kind: "stale_comment",
        verdict: "YES",
        reason: "Comment references 30, which this change removed or altered.",
        citations: [],
        // Controller ruling (task-11 review finding 1): a stale_comment
        // Flag's public hunk_hash is the synthetic ledger key, matching
        // the ledger row's own hunk_hash above -- not the inherited real
        // hunk_hash ("hh-timeout").
        hunk_hash: "stale:services/checkout/api.py:7",
        status: "open",
      },
    };
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/verdicts?repo=acme%2Fstorefront&pr=3", method: "GET" })
      .reply(200, [noFlagRow, staleFlagRow]);
    const { app } = await buildApp();

    const res = await request(app).get("/verdicts").query({ repo: "acme/storefront", pr: 3 });
    expect(res.status).toBe(200);
    expect(res.body.flags).toHaveLength(1);
    expect(res.body.flags[0].kind).toBe("stale_comment");
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

  it("returns 400 when repo is missing (pr is now optional)", async () => {
    const { app } = await buildApp();
    const res = await request(app).get("/verdicts").query({ pr: 1 });
    expect(res.status).toBe(400);
  });

  it("omits pr and returns all flags for the repo from the ledger", async () => {
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/verdicts?repo=acme%2Fstorefront", method: "GET" })
      .reply(200, [LEDGER_ROW, { ...LEDGER_ROW, id: 18, pr: 2, payload: { ...LEDGER_ROW.payload, id: 18, pr: 2 } }]);
    const { app } = await buildApp();

    const res = await request(app).get("/verdicts").query({ repo: "acme/storefront" });
    expect(res.status).toBe(200);
    expect(res.body.flags).toHaveLength(2);
    expect(res.body.flags.map((f: { pr: number }) => f.pr).sort()).toEqual([1, 2]);
  });

  it("without pr, falls back to an empty list (never 500s) when the ledger is unreachable", async () => {
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/verdicts?repo=acme%2Fstorefront", method: "GET" })
      .replyWithError(new Error("ECONNREFUSED"));
    const { app } = await buildApp();

    const res = await request(app).get("/verdicts").query({ repo: "acme/storefront" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ flags: [] });
  });
});

describe("GET /overrides", () => {
  it("proxies to the ledger and returns its JSON verbatim", async () => {
    const overridesPayload = [{ id: 1, verdict_id: 17, reason: "fence still applies", author: "alice" }];
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/overrides?repo=acme%2Fstorefront", method: "GET" })
      .reply(200, overridesPayload);
    const { app } = await buildApp();

    const res = await request(app).get("/overrides").query({ repo: "acme/storefront" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(overridesPayload);
  });

  it("returns 502 when the ledger is unreachable", async () => {
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/overrides?repo=acme%2Fstorefront", method: "GET" })
      .replyWithError(new Error("ECONNREFUSED"));
    const { app } = await buildApp();

    const res = await request(app).get("/overrides").query({ repo: "acme/storefront" });
    expect(res.status).toBe(502);
  });
});

describe("resilience: an unexpected throw inside a route is caught by the global error middleware", () => {
  it("returns a 500 JSON error instead of crashing, and the server keeps serving afterwards", async () => {
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/verdicts?repo=acme%2Fstorefront&pr=1", method: "GET" })
      .reply(200, [LEDGER_ROW]);
    const { app, localState } = await buildApp();
    // Simulate an unexpected failure deep in a dependency that isn't
    // guarded by a route-local try/catch (here: the local-overlay lookup
    // that runs after the ledger fetch succeeds).
    vi.spyOn(localState, "isDismissed").mockImplementation(() => {
      throw new Error("corrupted local state");
    });

    const res = await request(app).get("/verdicts").query({ repo: "acme/storefront", pr: 1 });
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();

    const health = await request(app).get("/healthz");
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true, service: "gateway" });
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

  it("still returns the local result when the local-state storage write itself throws", async () => {
    const { app, localState } = await buildApp();
    vi.spyOn(localState, "markDismissed").mockImplementation(() => {
      throw new Error("ENOSPC: no space left on device");
    });

    const res = await request(app).post("/flags/17/dismiss").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, id: 17, status: "dismissed" });

    // The server must keep serving afterwards too.
    const health = await request(app).get("/healthz");
    expect(health.status).toBe(200);
  });

  // Regression (controller ruling, task-11 review finding 1): verdict now
  // sets a stale_comment Flag's PUBLIC hunk_hash to the SAME synthetic
  // "stale:<file>:<line>" key it upserts the ledger row under (instead of
  // the inherited real hunk_hash it diverged from before). This test proves
  // that invariant is actually load-bearing for dismiss durability: the
  // dismiss route's best-effort ledger write
  // (`upsertVerdict(..., hunk_hash: flag.hunk_hash, ...)`) must land on the
  // SAME row the ledger already has for this flag, not a second row under a
  // different key -- otherwise a dismissed stale flag could resurface as
  // open after a gateway restart (GET /verdicts would read the original,
  // still-open row).
  it("durability: dismissing a stale_comment flag upserts the ledger row under the SAME hunk_hash the flag carries (same row, not a duplicate)", async () => {
    const flag: Flag = {
      id: 6,
      repo: "acme/storefront",
      pr: 3,
      head_sha: "sha3",
      file: "services/checkout/api.py",
      line: 7,
      kind: "stale_comment",
      verdict: "YES",
      reason: "Comment references 30, which this change removed or altered.",
      citations: [],
      hunk_hash: "stale:services/checkout/api.py:7",
      status: "open",
    };

    // Stateful ledger mock: upserts on (repo, head_sha, hunk_hash), like the
    // real Spring Boot ledger (VerdictService.upsert). Pre-seeded with the
    // row verdict's original /judge persistVerdict call created for this
    // flag -- keyed by flag.hunk_hash, exactly as the controller ruling
    // requires.
    const rows = new Map<string, { id: number; payload: unknown }>();
    rows.set(`${flag.repo}:${flag.head_sha}:${flag.hunk_hash}`, { id: flag.id, payload: { ...flag } });
    let postCount = 0;
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/verdicts", method: "POST" })
      .reply(200, (opts) => {
        postCount += 1;
        const body = JSON.parse(String(opts.body)) as {
          repo: string;
          head_sha: string;
          hunk_hash: string;
          verdict: string;
          payload: unknown;
        };
        const key = `${body.repo}:${body.head_sha}:${body.hunk_hash}`;
        const existing = rows.get(key);
        const id = existing ? existing.id : 1000 + rows.size;
        rows.set(key, { id, payload: body.payload });
        return { id };
      });

    const judgeCache = new JudgeCache<Flag[]>();
    judgeCache.set(flag.repo, flag.pr, [flag]);
    const { app } = await buildApp(judgeCache);

    const res = await request(app).post(`/flags/${flag.id}/dismiss`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, id: flag.id, status: "dismissed" });

    expect(postCount).toBe(1);
    expect(rows.size).toBe(1); // no duplicate row under a different key
    const updated = rows.get(`${flag.repo}:${flag.head_sha}:${flag.hunk_hash}`);
    expect(updated?.id).toBe(flag.id); // same row updated, not a new one
    expect((updated?.payload as { status: string }).status).toBe("dismissed");
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

describe("POST /overrides — override becomes Estelle memory", () => {
  function cacheWithFlag(): JudgeCache<Flag[]> {
    const cache = new JudgeCache<Flag[]>();
    cache.set("acme/storefront", 1, [LEDGER_ROW.payload as Flag]);
    return cache;
  }

  async function buildAppWithEstelle(judgeCache?: JudgeCache<Flag[]>) {
    const rawEventStore = await createRawEventStore({ mongoUrl: undefined, rawEventsDir: tmpDir });
    const localState = LocalOverrideState.load(path.join(tmpDir, "local-state2.json"));
    const app = createApp({
      analyzerUrl: "http://analyzer.test",
      triageUrl: "http://triage.test",
      verdictUrl: "http://verdict.test",
      ledgerUrl: "http://ledger.test",
      githubApiUrl: "http://github.test",
      githubToken: "",
      webhookSecret: "devsecret",
      estelleUrl: "http://estelle.test",
      dashboardUrl: "http://dash.test",
      rawEventStore,
      localState,
      judgeCache,
    });
    return { app, localState };
  }

  it("pushes a code:null fence to Estelle's knowledge API after a successful override", async () => {
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/overrides", method: "POST" })
      .reply(201, { id: 5, verdict_id: 17, reason: "provider autoscales now", author: "sam" });
    let knowledgeBody: unknown;
    mockAgent
      .get("http://estelle.test")
      .intercept({ path: "/v1/knowledge", method: "POST" })
      .reply(201, (opts) => {
        knowledgeBody = JSON.parse(String(opts.body));
        return { ok: true, fences: 19 };
      });

    const { app } = await buildAppWithEstelle(cacheWithFlag());
    const res = await request(app).post("/overrides").send({ verdict_id: 17, reason: "provider autoscales now", author: "sam" });
    expect(res.status).toBe(201);

    const fence = (knowledgeBody as { fence: Record<string, unknown> }).fence;
    expect(fence.id).toBe("override-5");
    expect(fence.file).toBe("services/payments/client.py");
    expect(fence.line_start).toBe(5);
    expect(fence.line_end).toBe(5);
    expect(fence.code).toBeNull();
    expect(String(fence.summary)).toContain("sam");
    expect(String(fence.summary)).toContain("provider autoscales now");
    const citations = fence.citations as Array<Record<string, string>>;
    expect(citations[0].type).toBe("override");
    expect(citations[0].url).toBe("http://dash.test");
  });

  it("still returns 201 when the Estelle knowledge push fails (best-effort)", async () => {
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/overrides", method: "POST" })
      .reply(201, { id: 6, verdict_id: 17, reason: "r", author: "a" });
    mockAgent
      .get("http://estelle.test")
      .intercept({ path: "/v1/knowledge", method: "POST" })
      .replyWithError(new Error("ECONNREFUSED"));

    const { app } = await buildAppWithEstelle(cacheWithFlag());
    const res = await request(app).post("/overrides").send({ verdict_id: 17, reason: "r", author: "a" });
    expect(res.status).toBe(201);
  });

  it("skips the push without failing when the flag is not in the judge cache", async () => {
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/overrides", method: "POST" })
      .reply(201, { id: 7, verdict_id: 99, reason: "r", author: "a" });
    // No estelle intercept: a push attempt would throw MockNotMatchedError.

    const { app } = await buildAppWithEstelle(new JudgeCache<Flag[]>());
    const res = await request(app).post("/overrides").send({ verdict_id: 99, reason: "r", author: "a" });
    expect(res.status).toBe(201);
  });
});
