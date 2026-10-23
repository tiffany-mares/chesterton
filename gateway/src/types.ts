/** Shared JSON shapes per docs/contracts.md "Core JSON shapes". */

export interface Hunk {
  file: string;
  old_start: number;
  old_end: number;
  new_start: number;
  new_end: number;
  old_lines: string[];
  new_lines: string[];
  symbol: string;
  hunk_hash: string;
}

export type CitationType = "slack" | "linear" | "pr" | "override";

export interface Citation {
  type: CitationType;
  url: string;
  title: string;
}

export type VerdictLabel = "YES" | "NO" | "NO_EVIDENCE";

export interface Verdict {
  verdict: VerdictLabel;
  reason: string;
  citations: Citation[];
}

export type FlagKind = "contradiction" | "stale_comment";
export type FlagStatus = "open" | "dismissed" | "overridden";

export interface Flag {
  id: number;
  repo: string;
  pr: number;
  head_sha: string;
  file: string;
  line: number;
  kind: FlagKind;
  verdict: VerdictLabel;
  reason: string;
  citations: Citation[];
  hunk_hash: string;
  status: FlagStatus;
}

/**
 * Code comment adjacent to a changed hunk, extracted for stale-comment checks.
 *
 * `hunk` carries the adjacent Hunk object INLINE (not just its hash) so that
 * verdict can run the stale check even when that hunk scored below the
 * triage threshold and was therefore filtered out of the `hunks[]` sent
 * alongside this comment (docs/contracts.md "verdict (Go)" /judge request).
 * `null` only in the defensive case where no hunk exists in the file at all
 * (shouldn't happen for diffs the analyzer actually parsed).
 */
export interface CommentCandidate {
  file: string;
  line: number;
  text: string;
  hunk_hash: string;
  hunk: Hunk | null;
}

export interface HunkScore {
  hunk_hash: string;
  score: number;
  reasons: string[];
}

export interface JudgeRequest {
  repo: string;
  pr: number;
  head_sha: string;
  installation_token: string;
  hunks: Hunk[];
  comments?: CommentCandidate[];
}

export interface JudgeResponse {
  flags: Flag[];
  check_run_id: number;
}

export interface GithubPr {
  number: number;
  title: string;
  state: string;
  head: { sha: string; ref: string };
  base: { ref: string };
}
