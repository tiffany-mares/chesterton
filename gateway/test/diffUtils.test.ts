import { describe, expect, it } from "vitest";
import { computeHunkHash, findNewLineContent, parseFileDiffs } from "../src/diffUtils.js";

const SINGLE_LINE_MOD =
  "diff --git a/services/payments/client.py b/services/payments/client.py\n" +
  "index c1f660d..ccc8363 100644\n" +
  "--- a/services/payments/client.py\n" +
  "+++ b/services/payments/client.py\n" +
  "@@ -2,7 +2,7 @@\n" +
  " \n" +
  " import time\n" +
  " \n" +
  "-MAX_RETRIES = 3\n" +
  "+MAX_RETRIES = 50\n" +
  " BACKOFF_SECONDS = 2\n" +
  " TIMEOUT_SECONDS = 10\n" +
  " DEFAULT_CURRENCY = \"USD\"\n";

describe("parseFileDiffs", () => {
  it("assigns correct old/new line numbers to each line kind", () => {
    const files = parseFileDiffs(SINGLE_LINE_MOD);
    expect(files).toHaveLength(1);
    expect(files[0].file).toBe("services/payments/client.py");
    const lines = files[0].hunks[0].lines;
    const removed = lines.find((l) => l.kind === "remove");
    const added = lines.find((l) => l.kind === "add");
    expect(removed?.content).toBe("MAX_RETRIES = 3");
    expect(removed?.oldLineNo).toBe(5);
    expect(removed?.newLineNo).toBeNull();
    expect(added?.content).toBe("MAX_RETRIES = 50");
    expect(added?.newLineNo).toBe(5);
    expect(added?.oldLineNo).toBeNull();
  });

  it("handles multi-file diffs, assigning hunks to the right file", () => {
    const addition =
      "diff --git a/foo.py b/foo.py\nindex 1111111..2222222 100644\n--- a/foo.py\n+++ b/foo.py\n@@ -1,2 +1,3 @@\n a = 1\n+b = 2\n c = 3\n";
    const deletion =
      "diff --git a/bar.py b/bar.py\nindex 1111111..2222222 100644\n--- a/bar.py\n+++ b/bar.py\n@@ -1,3 +1,2 @@\n a = 1\n-b = 2\n c = 3\n";
    const files = parseFileDiffs(addition + deletion);
    expect(files.map((f) => f.file)).toEqual(["foo.py", "bar.py"]);
  });
});

describe("findNewLineContent", () => {
  it("finds the new-file content of a context line", () => {
    const content = findNewLineContent(SINGLE_LINE_MOD, "services/payments/client.py", 6);
    expect(content).toBe("BACKOFF_SECONDS = 2");
  });

  it("finds the new-file content of an added line", () => {
    const content = findNewLineContent(SINGLE_LINE_MOD, "services/payments/client.py", 5);
    expect(content).toBe("MAX_RETRIES = 50");
  });

  it("returns null for a file not present in the diff", () => {
    expect(findNewLineContent(SINGLE_LINE_MOD, "nope.py", 5)).toBeNull();
  });
});

describe("computeHunkHash", () => {
  it("matches the known test vector from diff-analyzer/src/hash.rs", () => {
    const hash = computeHunkHash("services/payments/client.py", ["MAX_RETRIES = 3"], ["MAX_RETRIES = 50"]);
    expect(hash).toBe("165b1d6186de254f");
    expect(hash).toHaveLength(16);
  });

  it("is deterministic", () => {
    const a = computeHunkHash("f.py", ["x"], ["y"]);
    const b = computeHunkHash("f.py", ["x"], ["y"]);
    expect(a).toBe(b);
  });
});
