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
});
