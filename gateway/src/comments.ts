/**
 * Stale-comment extraction heuristic (exact per task clarifications):
 *
 * Within each @@ block of the fetched diff, for every change run, look up
 * to 2 lines above the run's first changed line among CONTEXT lines; if a
 * context line's trimmed text starts with a comment leader (#, //, /*, *,
 * --), emit {file, line: <new-file line number of that context line>, text:
 * <trimmed comment text>, hunk_hash: <hash of the adjacent run>}. Dedupe
 * identical (file, line).
 *
 * "hash of the adjacent run" is resolved by picking the nearest analyzer
 * Hunk at or below the comment's line, in the same file (per task
 * clarification: "a comment belongs to the nearest hunk below it in the
 * same file"). Falls back to the nearest hunk above if none is below
 * (defensive; shouldn't happen for diffs the analyzer actually parsed).
 *
 * Controller ruling (final-review fix wave): the full adjacent Hunk object
 * is embedded INLINE on the comment (not just its hash) so that verdict can
 * still run the stale check for a comment whose adjacent hunk scored below
 * the triage threshold and was filtered out of the `hunks[]` array sent to
 * /judge. Extraction still runs against ALL hunks (not just the filtered
 * ones) -- only the inline attachment is new.
 */

import { parseFileDiffs, type DiffLine } from "./diffUtils.js";
import type { CommentCandidate, Hunk } from "./types.js";

const COMMENT_LEADER_RE = /^(#|\/\/|\/\*|\*|--)/;

function isCommentLeader(trimmed: string): boolean {
  return COMMENT_LEADER_RE.test(trimmed);
}

function hunkPosition(h: Hunk): number {
  return h.new_start > 0 ? h.new_start : h.old_start;
}

function nearestHunk(hunks: Hunk[], file: string, line: number): Hunk | null {
  const inFile = hunks.filter((h) => h.file === file);
  let best: Hunk | null = null;
  let bestPos = Infinity;
  for (const h of inFile) {
    const pos = hunkPosition(h);
    if (pos >= line && pos < bestPos) {
      bestPos = pos;
      best = h;
    }
  }
  if (best) return best;

  let bestAbove: Hunk | null = null;
  let bestAbovePos = -Infinity;
  for (const h of inFile) {
    const pos = hunkPosition(h);
    if (pos < line && pos > bestAbovePos) {
      bestAbovePos = pos;
      bestAbove = h;
    }
  }
  return bestAbove;
}

export function extractComments(diffText: string, hunks: Hunk[]): CommentCandidate[] {
  const fileDiffs = parseFileDiffs(diffText);
  const seen = new Map<string, { file: string; line: number; text: string }>();

  for (const fd of fileDiffs) {
    for (const rawHunk of fd.hunks) {
      const lines: DiffLine[] = rawHunk.lines;
      let runStart: number | null = null;

      for (let idx = 0; idx <= lines.length; idx += 1) {
        const isChange = idx < lines.length && lines[idx].kind !== "context";
        if (isChange) {
          if (runStart === null) runStart = idx;
          continue;
        }
        if (runStart !== null) {
          const precedingStart = Math.max(0, runStart - 2);
          for (let pIdx = precedingStart; pIdx < runStart; pIdx += 1) {
            const pl = lines[pIdx];
            if (pl.kind !== "context" || pl.newLineNo === null) continue;
            const trimmed = pl.content.trim();
            if (!isCommentLeader(trimmed)) continue;
            const key = `${fd.file}:${pl.newLineNo}`;
            if (!seen.has(key)) {
              seen.set(key, { file: fd.file, line: pl.newLineNo, text: trimmed });
            }
          }
          runStart = null;
        }
      }
    }
  }

  return [...seen.values()].map((c) => {
    const hunk = nearestHunk(hunks, c.file, c.line);
    return {
      ...c,
      hunk_hash: hunk?.hunk_hash ?? "",
      hunk,
    };
  });
}
