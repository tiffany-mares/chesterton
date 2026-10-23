import { MockAgent, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeDiff } from "../src/clients/analyzer.js";
import { scoreHunks } from "../src/clients/triage.js";
import { judge } from "../src/clients/verdictClient.js";
import { getVerdicts, upsertVerdict, getDecisions, getOverrides } from "../src/clients/ledger.js";
import { getPrDiff, postReviewComment } from "../src/clients/github.js";
import type { Hunk } from "../src/types.js";

let mockAgent: MockAgent;

beforeEach(() => {
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(async () => {
  await mockAgent.close();
});

const SAMPLE_HUNK: Hunk = {
  file: "a.py",
  old_start: 1,
  old_end: 1,
  new_start: 1,
  new_end: 1,
  old_lines: ["x = 1"],
  new_lines: ["x = 2"],
  symbol: "",
  hunk_hash: "hash1",
};

describe("analyzer client", () => {
  it("POSTs /analyze and returns hunks", async () => {
    const pool = mockAgent.get("http://analyzer.test");
    pool
      .intercept({ path: "/analyze", method: "POST", body: JSON.stringify({ diff: "DIFF" }) })
      .reply(200, { hunks: [SAMPLE_HUNK] });

    const hunks = await analyzeDiff("http://analyzer.test", "DIFF");
    expect(hunks).toEqual([SAMPLE_HUNK]);
  });

  it("throws on non-2xx", async () => {
    const pool = mockAgent.get("http://analyzer.test");
    pool.intercept({ path: "/analyze", method: "POST" }).reply(500, "boom");
    await expect(analyzeDiff("http://analyzer.test", "DIFF")).rejects.toThrow(/analyzer \/analyze failed/);
  });
});

describe("triage client", () => {
  it("POSTs /score and returns scores", async () => {
    const pool = mockAgent.get("http://triage.test");
    pool
      .intercept({ path: "/score", method: "POST" })
      .reply(200, { scores: [{ hunk_hash: "hash1", score: 0.9, reasons: ["changed_numeric_constant"] }] });

    const scores = await scoreHunks("http://triage.test", [SAMPLE_HUNK]);
    expect(scores).toEqual([{ hunk_hash: "hash1", score: 0.9, reasons: ["changed_numeric_constant"] }]);
  });
});

describe("verdict client", () => {
  it("POSTs /judge and returns flags + check_run_id", async () => {
    const pool = mockAgent.get("http://verdict.test");
    pool.intercept({ path: "/judge", method: "POST" }).reply(200, { flags: [], check_run_id: 7 });

    const result = await judge("http://verdict.test", {
      repo: "acme/storefront",
      pr: 1,
      head_sha: "sha1",
      installation_token: "",
      hunks: [SAMPLE_HUNK],
    });
    expect(result).toEqual({ flags: [], check_run_id: 7 });
  });
});

describe("ledger client", () => {
  it("GETs /verdicts with repo & pr query params", async () => {
    const pool = mockAgent.get("http://ledger.test");
    pool
      .intercept({ path: "/verdicts?repo=acme%2Fstorefront&pr=1", method: "GET" })
      .reply(200, [{ id: 1, repo: "acme/storefront", pr: 1, head_sha: "s", hunk_hash: "h", decision_id: null, verdict: "YES", payload: {} }]);

    const rows = await getVerdicts("http://ledger.test", "acme/storefront", 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
  });

  it("POSTs /verdicts upsert", async () => {
    const pool = mockAgent.get("http://ledger.test");
    pool.intercept({ path: "/verdicts", method: "POST" }).reply(200, { id: 5 });
    const row = await upsertVerdict("http://ledger.test", {
      repo: "acme/storefront",
      pr: 1,
      head_sha: "s",
      hunk_hash: "h",
      decision_id: null,
      verdict: "YES",
      payload: { status: "dismissed" },
    });
    expect(row).toEqual({ id: 5 });
  });

  it("GETs /decisions proxying repo & file query params", async () => {
    const pool = mockAgent.get("http://ledger.test");
    pool
      .intercept({ path: "/decisions?repo=acme%2Fstorefront&file=services%2Fpayments%2Fclient.py", method: "GET" })
      .reply(200, [{ id: 1, file: "services/payments/client.py" }]);

    const rows = await getDecisions("http://ledger.test", "acme/storefront", "services/payments/client.py");
    expect(rows).toEqual([{ id: 1, file: "services/payments/client.py" }]);
  });

  it("GETs /verdicts with only repo when pr is omitted", async () => {
    const pool = mockAgent.get("http://ledger.test");
    pool
      .intercept({ path: "/verdicts?repo=acme%2Fstorefront", method: "GET" })
      .reply(200, [{ id: 2, repo: "acme/storefront", pr: 2, head_sha: "s", hunk_hash: "h", decision_id: null, verdict: "YES", payload: {} }]);

    const rows = await getVerdicts("http://ledger.test", "acme/storefront", undefined);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(2);
  });

  it("GETs /overrides proxying the repo query param", async () => {
    const pool = mockAgent.get("http://ledger.test");
    pool
      .intercept({ path: "/overrides?repo=acme%2Fstorefront", method: "GET" })
      .reply(200, [{ id: 1, verdict_id: 17, reason: "fence still applies", author: "alice" }]);

    const rows = await getOverrides("http://ledger.test", "acme/storefront");
    expect(rows).toEqual([{ id: 1, verdict_id: 17, reason: "fence still applies", author: "alice" }]);
  });
});

describe("github client", () => {
  it("GETs the PR diff with the diff Accept header", async () => {
    const pool = mockAgent.get("http://github.test");
    pool
      .intercept({
        path: "/repos/acme/storefront/pulls/1",
        method: "GET",
        headers: { accept: "application/vnd.github.v3.diff" },
      })
      .reply(200, "DIFF TEXT");

    const diff = await getPrDiff("http://github.test", "acme/storefront", 1, "");
    expect(diff).toBe("DIFF TEXT");
  });

  it("POSTs a review comment", async () => {
    const pool = mockAgent.get("http://github.test");
    pool
      .intercept({ path: "/repos/acme/storefront/pulls/1/comments", method: "POST" })
      .reply(201, { id: 99 });

    const result = await postReviewComment(
      "http://github.test",
      "acme/storefront",
      1,
      { body: "hi", commit_id: "sha", path: "a.py", line: 1, side: "RIGHT" },
      ""
    );
    expect(result).toEqual({ id: 99 });
  });
});
