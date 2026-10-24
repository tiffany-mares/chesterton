import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixtures } from "../src/store.js";
import { computeAsk, computeStale } from "../src/estelle.js";
import type { Hunk } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");
const fixtures = loadFixtures({ seedOutDir: FIXTURES_DIR });

function hunk(overrides: Partial<Hunk>): Hunk {
  return {
    file: "services/payments/client.py",
    old_start: 5,
    old_end: 5,
    new_start: 5,
    new_end: 5,
    old_lines: [],
    new_lines: [],
    symbol: "",
    hunk_hash: "deadbeef",
    ...overrides,
  };
}

describe("computeAsk", () => {
  it("returns YES with the fence's citations when the guarded line is removed", () => {
    const result = computeAsk(fixtures, "acme/storefront", hunk({
      old_lines: ["MAX_RETRIES = 3"],
      new_lines: ["MAX_RETRIES = 50"],
    }));

    expect(result.verdict).toBe("YES");
    expect(result.citations).toHaveLength(3);
    expect(result.reason).toBe(
      "MAX_RETRIES = 3 exists because: Payment retries are capped at 3 with backoff, after checkout started hammering the payments provider with unbounded retries during an incident. This change removes or alters it."
    );
  });

  it("returns NO when the fenced line survives unchanged in new_lines", () => {
    const result = computeAsk(fixtures, "acme/storefront", hunk({
      file: "services/inventory/stock.py",
      old_start: 16,
      old_end: 16,
      old_lines: ["if quantity > self.available:", "x = 1"],
      new_lines: ["if quantity > self.available:", "x = 2"],
    }));

    expect(result.verdict).toBe("NO");
    expect(result.citations).toHaveLength(1);
  });

  it("returns NO_EVIDENCE with empty citations when no fence matches", () => {
    const result = computeAsk(fixtures, "acme/storefront", hunk({
      file: "services/unknown/thing.py",
      old_start: 1,
      old_end: 1,
      old_lines: ["X = 1"],
      new_lines: ["X = 2"],
    }));

    expect(result.verdict).toBe("NO_EVIDENCE");
    expect(result.citations).toEqual([]);
  });

  it("returns NO_EVIDENCE when the line range does not overlap any fence", () => {
    const result = computeAsk(fixtures, "acme/storefront", hunk({
      old_start: 100,
      old_end: 100,
      old_lines: ["MAX_RETRIES = 3"],
      new_lines: [],
    }));

    expect(result.verdict).toBe("NO_EVIDENCE");
  });

  it("is deterministic: identical input yields byte-identical JSON", () => {
    const h = hunk({ old_lines: ["MAX_RETRIES = 3"], new_lines: ["MAX_RETRIES = 50"] });
    const a = JSON.stringify(computeAsk(fixtures, "acme/storefront", h));
    const b = JSON.stringify(computeAsk(fixtures, "acme/storefront", h));
    expect(a).toBe(b);
  });
});

describe("computeStale", () => {
  it("flags stale when a number in the comment was removed from old_lines", () => {
    const result = computeStale(fixtures, {
      repo: "acme/storefront",
      file: "services/checkout/api.py",
      comment: "# timeout is 30s, see ENG-310",
      comment_line: 7,
      hunk: hunk({
        file: "services/checkout/api.py",
        old_start: 8,
        old_end: 8,
        new_start: 8,
        new_end: 8,
        old_lines: ["CHECKOUT_TIMEOUT_SECONDS = 30"],
        new_lines: ["CHECKOUT_TIMEOUT_SECONDS = 5"],
      }),
    });

    expect(result.stale).toBe(true);
    expect(result.citations).toHaveLength(3);
  });

  it("does not flag stale when the referenced number survives in new_lines", () => {
    const result = computeStale(fixtures, {
      repo: "acme/storefront",
      file: "services/checkout/api.py",
      comment: "# timeout is 30s, see ENG-310",
      comment_line: 7,
      hunk: hunk({
        file: "services/checkout/api.py",
        old_start: 8,
        old_end: 8,
        new_start: 8,
        new_end: 8,
        old_lines: ["CHECKOUT_TIMEOUT_SECONDS = 30"],
        new_lines: ["CHECKOUT_TIMEOUT_SECONDS = 30"],
      }),
    });

    expect(result.stale).toBe(false);
  });

  it("returns empty citations when no fence overlaps the comment line", () => {
    const result = computeStale(fixtures, {
      repo: "acme/storefront",
      file: "services/checkout/api.py",
      comment: "# nothing special here",
      comment_line: 999,
      hunk: hunk({ old_lines: [], new_lines: [] }),
    });

    expect(result.citations).toEqual([]);
  });
});

describe("override memory (code: null fences via /v1/knowledge ingestion)", () => {
  // Fresh fixtures per test: these mutate the knowledge base.
  function freshFixtures() {
    return loadFixtures({ seedOutDir: FIXTURES_DIR });
  }

  const overrideFence = {
    id: "override-7",
    file: "services/payments/client.py",
    line_start: 5,
    line_end: 5,
    code: null,
    summary: "Override by sam: provider now autoscales, cap can move.",
    citations: [{ type: "override" as const, url: "http://localhost:4600/", title: "Override by sam" }],
  };

  it("computeAsk cites an ingested override fence for any overlapping change", () => {
    const fx = freshFixtures();
    fx.knowledge.fences.push(overrideFence);
    const result = computeAsk(fx, "acme/storefront", hunk({
      old_lines: ["MAX_RETRIES = 50"],
      new_lines: ["MAX_RETRIES = 500"],
    }));
    expect(result.verdict).toBe("YES");
    expect(result.citations).toEqual(overrideFence.citations);
    expect(result.reason).toContain("provider now autoscales");
  });

  it("computeAsk is unchanged for files the override does not cover", () => {
    const fx = freshFixtures();
    fx.knowledge.fences.push({ ...overrideFence, file: "services/other/file.py" });
    const result = computeAsk(fx, "acme/storefront", hunk({
      old_lines: ["MAX_RETRIES = 3"],
      new_lines: ["MAX_RETRIES = 50"],
    }));
    expect(result.verdict).toBe("YES");
    expect(result.citations).toHaveLength(3); // the seeded retry-cap fence, not the override
  });
});
