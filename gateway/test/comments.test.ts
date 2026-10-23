import { describe, expect, it } from "vitest";
import { extractComments } from "../src/comments.js";
import type { Hunk } from "../src/types.js";

// Mirrors seed/out/prs/3.diff's checkout timeout scenario: a comment
// ("# timeout is 30s, see ENG-310") sits 1 line above a changed constant.
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
  " def checkout(cart, idempotency_key, shipping_address, currency=\"USD\"):\n";

function hunkFor(file: string, newStart: number, hunkHash: string): Hunk {
  return {
    file,
    old_start: newStart,
    old_end: newStart,
    new_start: newStart,
    new_end: newStart,
    old_lines: ["CHECKOUT_TIMEOUT_SECONDS = 30"],
    new_lines: ["CHECKOUT_TIMEOUT_SECONDS = 5"],
    symbol: "",
    hunk_hash: hunkHash,
  };
}

describe("extractComments", () => {
  it("picks up a comment line 1 line above a change run and tags it with the adjacent hunk's hash", () => {
    const hunks = [hunkFor("services/checkout/api.py", 8, "abcdef0123456789")];
    const comments = extractComments(TIMEOUT_DIFF, hunks);
    expect(comments).toEqual([
      {
        file: "services/checkout/api.py",
        line: 7,
        text: "# timeout is 30s, see ENG-310",
        hunk_hash: "abcdef0123456789",
        hunk: hunks[0],
      },
    ]);
  });

  it("does not flag a blank context line 2 lines above as a comment", () => {
    const hunks = [hunkFor("services/checkout/api.py", 8, "abcdef0123456789")];
    const comments = extractComments(TIMEOUT_DIFF, hunks);
    expect(comments.some((c) => c.line === 6)).toBe(false);
  });

  it("recognizes //, /*, * and -- comment leaders", () => {
    const diff =
      "diff --git a/a.js b/a.js\nindex 1..2 100644\n--- a/a.js\n+++ b/a.js\n@@ -1,4 +1,4 @@\n" +
      " // retry cap\n-const MAX = 3;\n+const MAX = 50;\n const DONE = true;\n";
    const hunks = [
      {
        file: "a.js",
        old_start: 2,
        old_end: 2,
        new_start: 2,
        new_end: 2,
        old_lines: ["const MAX = 3;"],
        new_lines: ["const MAX = 50;"],
        symbol: "",
        hunk_hash: "hash1",
      },
    ];
    const comments = extractComments(diff, hunks);
    expect(comments).toEqual([{ file: "a.js", line: 1, text: "// retry cap", hunk_hash: "hash1", hunk: hunks[0] }]);
  });

  it("ignores context lines that are not comments", () => {
    const diff =
      "diff --git a/a.py b/a.py\nindex 1..2 100644\n--- a/a.py\n+++ b/a.py\n@@ -1,3 +1,3 @@\n" +
      " x = 1\n-y = 2\n+y = 3\n z = 4\n";
    const hunks = [
      {
        file: "a.py",
        old_start: 2,
        old_end: 2,
        new_start: 2,
        new_end: 2,
        old_lines: ["y = 2"],
        new_lines: ["y = 3"],
        symbol: "",
        hunk_hash: "hashX",
      },
    ];
    expect(extractComments(diff, hunks)).toEqual([]);
  });

  it("dedupes identical (file, line) candidates across separate @@ blocks", () => {
    // Two @@ blocks in the same file that both surface the same comment line
    // (new line 1) immediately above their respective change run. Must
    // collapse to a single comment entry for (file, line).
    const diff =
      "diff --git a/a.py b/a.py\nindex 1..2 100644\n--- a/a.py\n+++ b/a.py\n" +
      "@@ -1,3 +1,3 @@\n # shared note\n-a = 1\n+a = 10\n" +
      "@@ -1,3 +1,3 @@\n # shared note\n-b = 2\n+b = 20\n";
    const hunks = [
      {
        file: "a.py",
        old_start: 2,
        old_end: 2,
        new_start: 2,
        new_end: 2,
        old_lines: ["a = 1"],
        new_lines: ["a = 10"],
        symbol: "",
        hunk_hash: "hashA",
      },
      {
        file: "a.py",
        old_start: 2,
        old_end: 2,
        new_start: 2,
        new_end: 2,
        old_lines: ["b = 2"],
        new_lines: ["b = 20"],
        symbol: "",
        hunk_hash: "hashB",
      },
    ];
    const comments = extractComments(diff, hunks);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toEqual({ file: "a.py", line: 1, text: "# shared note", hunk_hash: "hashA", hunk: hunks[0] });
  });
});
