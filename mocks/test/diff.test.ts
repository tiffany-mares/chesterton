import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseUnifiedDiff } from "../src/diff.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = fs.readFileSync(path.join(__dirname, "fixtures/prs/1.diff"), "utf8");

describe("parseUnifiedDiff", () => {
  it("parses the file path", () => {
    const files = parseUnifiedDiff(SAMPLE);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("services/payments/client.py");
  });

  it("tracks old/new line numbers per diff line, including blank context lines", () => {
    const files = parseUnifiedDiff(SAMPLE);
    const lines = files[0].hunks[0].lines;

    const removed = lines.find((l) => l.type === "del");
    const added = lines.find((l) => l.type === "add");
    const blankContext = lines.find((l) => l.type === "context" && l.text === "");
    const backoffContext = lines.find((l) => l.type === "context" && l.text === "BACKOFF_SECONDS = 2");

    expect(removed).toMatchObject({ type: "del", oldLine: 5, text: "MAX_RETRIES = 3" });
    expect(added).toMatchObject({ type: "add", newLine: 5, text: "MAX_RETRIES = 50" });
    expect(blankContext).toMatchObject({ oldLine: 2, newLine: 2 });
    expect(backoffContext).toMatchObject({ oldLine: 6, newLine: 6 });
  });

  it("handles multiple files in one diff", () => {
    const multi = SAMPLE + "diff --git a/b.py b/b.py\n--- a/b.py\n+++ b/b.py\n@@ -1,1 +1,1 @@\n-old\n+new\n";
    const files = parseUnifiedDiff(multi);
    expect(files.map((f) => f.path)).toEqual(["services/payments/client.py", "b.py"]);
  });
});
