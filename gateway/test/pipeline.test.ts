import { MockAgent, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPipeline } from "../src/pipeline.js";
import { JudgeCache } from "../src/store.js";
import type { Flag, Hunk } from "../src/types.js";

let mockAgent: MockAgent;
let order: string[];

beforeEach(() => {
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  order = [];
});

afterEach(async () => {
  await mockAgent.close();
});

const DIFF_TEXT =
  "diff --git a/services/payments/client.py b/services/payments/client.py\n" +
  "index c1f660d..ccc8363 100644\n" +
  "--- a/services/payments/client.py\n" +
  "+++ b/services/payments/client.py\n" +
  "@@ -2,7 +2,7 @@\n \n import time\n \n-MAX_RETRIES = 3\n+MAX_RETRIES = 50\n BACKOFF_SECONDS = 2\n";

const HUNK_HIGH: Hunk = {
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
const HUNK_LOW: Hunk = {
  ...HUNK_HIGH,
  old_lines: ["BACKOFF_SECONDS = 2"],
  new_lines: ["BACKOFF_SECONDS = 20"],
  hunk_hash: "hashLOW",
};

const FLAG: Flag = {
  id: 1,
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

function setupHappyPathMocks() {
  const githubPool = mockAgent.get("http://github.test");
  githubPool
    .intercept({ path: "/repos/acme/storefront/pulls/1", method: "GET" })
    .reply(200, () => {
      order.push("github");
      return DIFF_TEXT;
    });

  const analyzerPool = mockAgent.get("http://analyzer.test");
  analyzerPool
    .intercept({ path: "/analyze", method: "POST" })
    .reply(200, () => {
      order.push("analyzer");
      return { hunks: [HUNK_HIGH, HUNK_LOW] };
    });

  const triagePool = mockAgent.get("http://triage.test");
  triagePool
    .intercept({ path: "/score", method: "POST" })
    .reply(200, () => {
      order.push("triage");
      return {
        scores: [
          { hunk_hash: "hashHIGH", score: 0.9, reasons: ["changed_numeric_constant"] },
          { hunk_hash: "hashLOW", score: 0.2, reasons: [] },
        ],
      };
    });

  const verdictPool = mockAgent.get("http://verdict.test");
  verdictPool
    .intercept({ path: "/judge", method: "POST" })
    .reply(200, (opts) => {
      order.push("verdict");
      const body = JSON.parse(String(opts.body));
      // The filter must have already dropped the low-scoring hunk by the
      // time verdict is called.
      expect(body.hunks).toHaveLength(1);
      expect(body.hunks[0].hunk_hash).toBe("hashHIGH");
      return { flags: [FLAG], check_run_id: 42 };
    });
}

const baseDeps = {
  analyzerUrl: "http://analyzer.test",
  triageUrl: "http://triage.test",
  verdictUrl: "http://verdict.test",
  githubApiUrl: "http://github.test",
  githubToken: "",
};

describe("runPipeline", () => {
  it("calls github -> analyzer -> triage -> verdict in order, filtering hunks below 0.5", async () => {
    setupHappyPathMocks();
    const result = await runPipeline(
      { repo: "acme/storefront", pr: 1, headSha: "sha123" },
      baseDeps
    );
    expect(order).toEqual(["github", "analyzer", "triage", "verdict"]);
    expect(result.flags).toEqual([FLAG]);
  });

  it("populates the judge cache keyed by repo:pr with the flags from verdict", async () => {
    setupHappyPathMocks();
    const cache = new JudgeCache<Flag[]>();
    await runPipeline(
      { repo: "acme/storefront", pr: 1, headSha: "sha123" },
      { ...baseDeps, judgeCache: cache }
    );
    expect(cache.get("acme/storefront", 1)).toEqual([FLAG]);
  });

  it("skips triage (nothing to score) but still calls verdict with empty hunks/comments when the analyzer returns no hunks", async () => {
    // Controller ruling: verdict posts the check run, so it must be called
    // even with empty inputs -- the demo's harmless-refactor PR must still
    // get its neutral check run.
    const githubPool = mockAgent.get("http://github.test");
    githubPool.intercept({ path: "/repos/acme/storefront/pulls/2", method: "GET" }).reply(200, "no-op diff");
    const analyzerPool = mockAgent.get("http://analyzer.test");
    analyzerPool.intercept({ path: "/analyze", method: "POST" }).reply(200, { hunks: [] });
    // No interceptor registered for triage -> an unexpected call would throw
    // (disableNetConnect + no matching mock), proving triage is still skipped.
    const verdictPool = mockAgent.get("http://verdict.test");
    verdictPool
      .intercept({ path: "/judge", method: "POST" })
      .reply(200, (opts) => {
        const body = JSON.parse(String(opts.body));
        expect(body.hunks).toEqual([]);
        expect(body.comments).toEqual([]);
        return { flags: [], check_run_id: 99 };
      });

    const result = await runPipeline({ repo: "acme/storefront", pr: 2, headSha: "sha456" }, baseDeps);
    expect(result.flags).toEqual([]);
  });

  it("still calls verdict with empty filtered hunks when all hunks score below 0.5 and there are no stale-comment candidates", async () => {
    const githubPool = mockAgent.get("http://github.test");
    githubPool.intercept({ path: "/repos/acme/storefront/pulls/3", method: "GET" }).reply(200, DIFF_TEXT);
    const analyzerPool = mockAgent.get("http://analyzer.test");
    analyzerPool.intercept({ path: "/analyze", method: "POST" }).reply(200, { hunks: [HUNK_LOW] });
    const triagePool = mockAgent.get("http://triage.test");
    triagePool
      .intercept({ path: "/score", method: "POST" })
      .reply(200, { scores: [{ hunk_hash: "hashLOW", score: 0.1, reasons: [] }] });
    const verdictPool = mockAgent.get("http://verdict.test");
    verdictPool
      .intercept({ path: "/judge", method: "POST" })
      .reply(200, (opts) => {
        const body = JSON.parse(String(opts.body));
        // The low-scoring hunk must have been filtered out before verdict.
        expect(body.hunks).toEqual([]);
        return { flags: [], check_run_id: 100 };
      });

    const result = await runPipeline({ repo: "acme/storefront", pr: 3, headSha: "sha789" }, baseDeps);
    expect(result.flags).toEqual([]);
  });

  it("includes a stale-comment candidate's inline hunk even when that hunk is filtered out for scoring below 0.5", async () => {
    // Controller ruling (final-review fix wave): a comment's adjacent hunk is
    // extracted against ALL hunks, but only hunks scoring >= 0.5 are sent in
    // `hunks[]` to verdict. Without embedding the hunk INLINE on the
    // comment, verdict's processComment has no hunk context for a comment
    // whose adjacent hunk was filtered out, and silently skips its stale
    // check. This reproduces that scenario end to end through the pipeline.
    const TIMEOUT_DIFF =
      "diff --git a/services/checkout/api.py b/services/checkout/api.py\n" +
      "index 98be817..00cbdd7 100644\n" +
      "--- a/services/checkout/api.py\n" +
      "+++ b/services/checkout/api.py\n" +
      "@@ -5,7 +5,7 @@ from services.payments import client as payments_client\n" +
      " SEEN_IDEMPOTENCY_KEYS = set()\n" +
      " \n" +
      " # timeout is 30s, see ENG-310\n" +
      "-CHECKOUT_TIMEOUT_SECONDS = 30\n" +
      "+CHECKOUT_TIMEOUT_SECONDS = 5\n" +
      " \n" +
      " \n" +
      ' def checkout(cart, idempotency_key, shipping_address, currency="USD"):\n';

    const HUNK_TIMEOUT_LOW: Hunk = {
      file: "services/checkout/api.py",
      old_start: 8,
      old_end: 8,
      new_start: 8,
      new_end: 8,
      old_lines: ["CHECKOUT_TIMEOUT_SECONDS = 30"],
      new_lines: ["CHECKOUT_TIMEOUT_SECONDS = 5"],
      symbol: "",
      hunk_hash: "hh-timeout-low",
    };

    const githubPool = mockAgent.get("http://github.test");
    githubPool.intercept({ path: "/repos/acme/storefront/pulls/4", method: "GET" }).reply(200, TIMEOUT_DIFF);
    const analyzerPool = mockAgent.get("http://analyzer.test");
    analyzerPool.intercept({ path: "/analyze", method: "POST" }).reply(200, { hunks: [HUNK_TIMEOUT_LOW] });
    const triagePool = mockAgent.get("http://triage.test");
    triagePool
      .intercept({ path: "/score", method: "POST" })
      .reply(200, { scores: [{ hunk_hash: "hh-timeout-low", score: 0.1, reasons: [] }] });
    const verdictPool = mockAgent.get("http://verdict.test");
    verdictPool
      .intercept({ path: "/judge", method: "POST" })
      .reply(200, (opts) => {
        const body = JSON.parse(String(opts.body));
        // The hunk itself was filtered out of hunks[] (score 0.1 < 0.5)...
        expect(body.hunks).toEqual([]);
        // ...but the adjacent stale-comment candidate still reaches verdict,
        // carrying that hunk INLINE so verdict can run the stale check
        // regardless of the triage filter outcome.
        expect(body.comments).toHaveLength(1);
        expect(body.comments[0].hunk_hash).toBe("hh-timeout-low");
        expect(body.comments[0].hunk).toEqual(HUNK_TIMEOUT_LOW);
        return { flags: [], check_run_id: 101 };
      });

    const result = await runPipeline({ repo: "acme/storefront", pr: 4, headSha: "shaTimeout" }, baseDeps);
    expect(result.flags).toEqual([]);
  });

  it("uses getGithubToken (App installation token) for the diff fetch and installation_token", async () => {
    let diffAuth = "";
    const githubPool = mockAgent.get("http://github.test");
    githubPool
      .intercept({
        path: "/repos/acme/storefront/pulls/1",
        method: "GET",
        headers: (h) => {
          diffAuth = h.authorization ?? "";
          return true;
        },
      })
      .reply(200, DIFF_TEXT);
    const analyzerPool = mockAgent.get("http://analyzer.test");
    analyzerPool.intercept({ path: "/analyze", method: "POST" }).reply(200, { hunks: [] });
    const verdictPool = mockAgent.get("http://verdict.test");
    verdictPool.intercept({ path: "/judge", method: "POST" }).reply(200, (opts) => {
      const body = JSON.parse(String(opts.body));
      expect(body.installation_token).toBe("ghs_minted");
      return { flags: [], check_run_id: 7 };
    });

    await runPipeline(
      { repo: "acme/storefront", pr: 1, headSha: "sha123" },
      { ...baseDeps, githubToken: "pat-should-be-ignored", getGithubToken: async () => "ghs_minted" }
    );
    expect(diffAuth).toBe("Bearer ghs_minted");
  });
});
