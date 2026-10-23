export type DiffLineType = "context" | "add" | "del";

export interface DiffLine {
  type: DiffLineType;
  /** 1-based old-file line number; absent for pure additions. */
  oldLine?: number;
  /** 1-based new-file line number; absent for pure deletions. */
  newLine?: number;
  text: string;
}

export interface DiffHunk {
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  hunks: DiffHunk[];
}

const FILE_HEADER_RE = /^diff --git a\/(.+) b\/(.+)$/;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parses unified git-diff text (as produced by `git diff`) into a per-file,
 * per-hunk line list with old/new line numbers attached. Handles the subset
 * of the format seed/seed.py actually emits: `diff --git`, `index`, `---`,
 * `+++`, `@@ ... @@` headers, and ` `/`+`/`-`-prefixed body lines. Ignores
 * `\ No newline at end of file` markers.
 */
export function parseUnifiedDiff(diffText: string): DiffFile[] {
  const lines = diffText.split("\n");
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of lines) {
    const fileMatch = raw.match(FILE_HEADER_RE);
    if (fileMatch) {
      currentFile = { path: fileMatch[2], hunks: [] };
      currentHunk = null;
      files.push(currentFile);
      continue;
    }

    if (raw.startsWith("index ") || raw.startsWith("--- ") || raw.startsWith("+++ ")) {
      continue;
    }

    const hunkMatch = raw.match(HUNK_HEADER_RE);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[3], 10);
      currentHunk = { lines: [] };
      currentFile?.hunks.push(currentHunk);
      continue;
    }

    if (!currentFile || !currentHunk) continue;
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    if (raw.length === 0) continue; // trailing blank line from split("\n")

    const marker = raw[0];
    const text = raw.slice(1);

    if (marker === " ") {
      currentHunk.lines.push({ type: "context", oldLine, newLine, text });
      oldLine++;
      newLine++;
    } else if (marker === "-") {
      currentHunk.lines.push({ type: "del", oldLine, text });
      oldLine++;
    } else if (marker === "+") {
      currentHunk.lines.push({ type: "add", newLine, text });
      newLine++;
    }
    // any other leading character is not part of the body grammar; ignore.
  }

  return files;
}
