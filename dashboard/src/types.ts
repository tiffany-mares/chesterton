/** Shared JSON shapes, per docs/contracts.md. */

export interface Citation {
  type: "slack" | "linear" | "pr" | "override";
  url: string;
  title: string;
}

export type Verdict = "YES" | "NO" | "NO_EVIDENCE";
export type FlagStatus = "open" | "dismissed" | "overridden";
export type FlagKind = "contradiction" | "stale_comment";

export interface Flag {
  id: number;
  repo: string;
  pr: number;
  head_sha: string;
  file: string;
  line: number;
  kind: FlagKind;
  verdict: Verdict;
  reason: string;
  citations: Citation[];
  hunk_hash: string;
  status: FlagStatus;
}

/** Row of `GET /fences/by-file?repo=`. */
export interface FenceByFileRow {
  file: string;
  fence_count: number;
  loc: number;
}

/** Row of `GET /decisions?repo=&file=` (ledger). */
export interface Decision {
  id: number;
  repo: string;
  file: string;
  line_start: number;
  line_end: number;
  summary: string;
  citations: Citation[];
  source: "seed" | "verdict" | "override" | "plaque";
}

/** Row of `GET /overrides?repo=` (joined with verdict info). */
export interface OverrideRow {
  id: number;
  verdict_id: number;
  reason: string;
  author: string;
  created_at?: string;
  verdict?: Partial<Flag> & { payload?: Flag };
}

/** `GET /stats?repo=`. */
export interface Stats {
  verdicts_total: number;
  flags_total: number;
  overrides_total: number;
  false_positive_rate: number;
}
