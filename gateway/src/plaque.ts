/**
 * POST /plaque: fetch the flag, build a review comment with a ```suggestion
 * block inserting one fence comment line above the guarded line, and post
 * it to the GitHub API.
 *
 * Design choices (documented per task instructions, since the brief left
 * these open):
 *  - "the current line content": fetched fresh from the PR diff (GitHub API,
 *    same diff endpoint the webhook pipeline uses) rather than from a cached
 *    Hunk's new_lines. This keeps /plaque stateless and correct even after a
 *    gateway restart, since the Flag shape itself (per contracts.md) does
 *    not carry the full Hunk (only hunk_hash) - and we always have repo+pr
 *    in the request, so re-fetching the diff is cheap and authoritative.
 *  - "<summary>" in the suggestion line: the Flag shape has no separate
 *    `summary` field, so we use `flag.reason` (the closest analogue - the
 *    human-readable reason the verdict service recorded).
 */

import { getPrDiff, postReviewComment, type ReviewCommentBody } from "./clients/github.js";
import { getVerdicts } from "./clients/ledger.js";
import { findNewLineContent } from "./diffUtils.js";
import type { JudgeCache } from "./store.js";
import type { Flag } from "./types.js";

export interface ResolveFlagDeps {
  ledgerUrl: string;
  judgeCache: JudgeCache<Flag[]>;
  fetchImpl?: typeof fetch;
}

export async function resolveFlag(deps: ResolveFlagDeps, repo: string, pr: number, flagId: number): Promise<Flag | undefined> {
  try {
    const rows = await getVerdicts(deps.ledgerUrl, repo, pr, deps.fetchImpl);
    const row = rows.find((r) => r.id === flagId);
    if (row) return { ...(row.payload as Flag), id: row.id };
  } catch {
    // fall through to cache
  }
  const cached = deps.judgeCache.get(repo, pr);
  return cached?.find((f) => f.id === flagId);
}

const COMMENT_LEADER_BY_EXT: Record<string, string> = {
  ".py": "#",
  ".js": "//",
  ".ts": "//",
  ".go": "//",
  ".java": "//",
  ".rs": "//",
};

export function commentLeaderFor(file: string): string {
  const dotIdx = file.lastIndexOf(".");
  const ext = dotIdx >= 0 ? file.slice(dotIdx) : "";
  return COMMENT_LEADER_BY_EXT[ext] ?? "#";
}

export function buildPlaqueBody(leader: string, flag: Flag, currentLineContent: string): string {
  const firstCitation = flag.citations[0];
  const title = firstCitation?.title ?? "";
  const url = firstCitation?.url ?? "";
  const suggestionLine = `${leader} Fence: ${flag.reason} — see ${title} (${url})`;
  return `Chesterton fence plaque:\n\`\`\`suggestion\n${suggestionLine}\n${currentLineContent}\n\`\`\``;
}

export interface BuildPlaqueDeps {
  githubApiUrl: string;
  githubToken: string;
  fetchImpl?: typeof fetch;
}

export async function buildAndPostPlaqueComment(deps: BuildPlaqueDeps, repo: string, pr: number, flag: Flag): Promise<unknown> {
  const diffText = await getPrDiff(deps.githubApiUrl, repo, pr, deps.githubToken, deps.fetchImpl);
  const currentLineContent = findNewLineContent(diffText, flag.file, flag.line) ?? "";
  const leader = commentLeaderFor(flag.file);
  const body = buildPlaqueBody(leader, flag, currentLineContent);

  const comment: ReviewCommentBody = {
    body,
    commit_id: flag.head_sha,
    path: flag.file,
    line: flag.line,
    side: "RIGHT",
  };
  return postReviewComment(deps.githubApiUrl, repo, pr, comment, deps.githubToken, deps.fetchImpl);
}
