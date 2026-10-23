/**
 * Hand-rolled unified diff parser, mirroring diff-analyzer/src/parser.rs closely
 * enough that "a run of consecutive -/+ lines" means the same thing in both
 * places. We don't need full hunk-splitting here (the analyzer already gives
 * us that via Hunk[]); we only need per-line old/new line numbers so we can
 * (a) find comment lines 1-2 positions above a change run, and (b) look up
 * "the current new-file line content" for a given file+line (used by the
 * plaque suggestion body).
 */

import crypto from "node:crypto";

export type DiffLineKind = "context" | "add" | "remove";

export interface DiffLine {
  kind: DiffLineKind;
  /** Line content with the leading diff marker (' ', '-', '+') stripped. */
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

export interface RawHunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface FileDiff {
  file: string;
  hunks: RawHunk[];
}

function stripAbPrefix(p: string): string | null {
  const trimmed = p.trim();
  if (trimmed === "/dev/null") return null;
  if (trimmed.startsWith("a/")) return trimmed.slice(2);
  if (trimmed.startsWith("b/")) return trimmed.slice(2);
  return trimmed;
}

function parseHunkHeader(line: string): { oldStart: number; newStart: number } | null {
  if (!line.startsWith("@@ ")) return null;
  const rest = line.slice(3);
  const endIdx = rest.indexOf(" @@");
  if (endIdx < 0) return null;
  const ranges = rest.slice(0, endIdx);
  const parts = ranges.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const oldPart = parts[0];
  const newPart = parts[1];
  if (!oldPart.startsWith("-") || !newPart.startsWith("+")) return null;
  const oldStart = Number(oldPart.slice(1).split(",")[0]);
  const newStart = Number(newPart.slice(1).split(",")[0]);
  if (Number.isNaN(oldStart) || Number.isNaN(newStart)) return null;
  return { oldStart, newStart };
}

/** Parses unified diff text into a per-file list of hunks, each hunk's lines
 * carrying their old/new line numbers (null where not applicable). */
export function parseFileDiffs(diffText: string): FileDiff[] {
  const lines = diffText.split("\n");
  const files: FileDiff[] = [];
  let currentFile: string | null = null;
  let oldFilePath: string | null = null;

  const getOrCreateFile = (name: string): FileDiff => {
    let fd = files.find((f) => f.file === name);
    if (!fd) {
      fd = { file: name, hunks: [] };
      files.push(fd);
    }
    return fd;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("diff --git ")) {
      currentFile = null;
      oldFilePath = null;
      i += 1;
      continue;
    }

    if (line.startsWith("--- ")) {
      oldFilePath = stripAbPrefix(line.slice(4));
      i += 1;
      continue;
    }

    if (line.startsWith("+++ ")) {
      const newPath = stripAbPrefix(line.slice(4));
      currentFile = newPath ?? oldFilePath;
      i += 1;
      continue;
    }

    const header = parseHunkHeader(line);
    if (header) {
      const fileName = currentFile ?? "";
      i += 1;
      let oldLn = header.oldStart;
      let newLn = header.newStart;
      const body: DiffLine[] = [];

      while (i < lines.length) {
        const l = lines[i];
        if (l.startsWith("@@ ") || l.startsWith("diff --git ") || l.startsWith("--- ")) {
          break;
        }
        if (l.startsWith("\\")) {
          // "\ No newline at end of file" - doesn't advance counters.
          i += 1;
          continue;
        }
        if (l.startsWith(" ")) {
          body.push({ kind: "context", content: l.slice(1), oldLineNo: oldLn, newLineNo: newLn });
          oldLn += 1;
          newLn += 1;
        } else if (l.startsWith("-")) {
          body.push({ kind: "remove", content: l.slice(1), oldLineNo: oldLn, newLineNo: null });
          oldLn += 1;
        } else if (l.startsWith("+")) {
          body.push({ kind: "add", content: l.slice(1), oldLineNo: null, newLineNo: newLn });
          newLn += 1;
        } else if (l === "") {
          // A genuine blank line inside a hunk body always carries a leading
          // context space in real unified diffs; an empty line here means
          // we've run past the hunk (e.g. trailing blank at end of text).
          break;
        } else {
          break;
        }
        i += 1;
      }

      getOrCreateFile(fileName).hunks.push({ oldStart: header.oldStart, newStart: header.newStart, lines: body });
      continue;
    }

    i += 1;
  }

  return files;
}

/** Finds the new-file-side content of `file`:`line` by scanning the parsed
 * diff's context/add lines. Returns null if not present in the diff (e.g.
 * the line wasn't touched or shown as context in any hunk). */
export function findNewLineContent(diffText: string, file: string, line: number): string | null {
  const fileDiffs = parseFileDiffs(diffText);
  const fd = fileDiffs.find((f) => f.file === file);
  if (!fd) return null;
  for (const hunk of fd.hunks) {
    for (const dl of hunk.lines) {
      if (dl.newLineNo === line && (dl.kind === "context" || dl.kind === "add")) {
        return dl.content;
      }
    }
  }
  return null;
}

/** `hunk_hash` per docs/contracts.md: first 16 hex chars of
 * sha256(file + "\n" + old_lines.join("\n") + "\n=>\n" + new_lines.join("\n")).
 * Not used on the hot path (the analyzer is the source of truth for hashes),
 * but kept for parity/tests since comment association reasons about hashes.
 */
export function computeHunkHash(file: string, oldLines: string[], newLines: string[]): string {
  const input = `${file}\n${oldLines.join("\n")}\n=>\n${newLines.join("\n")}`;
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}
