// Shared JSON shapes. Mirrors docs/contracts.md.

export type CitationType = "slack" | "linear" | "pr" | "override";

export interface Citation {
  type: CitationType;
  url: string;
  title: string;
}

export interface Fence {
  id: string;
  file: string;
  line_start: number;
  line_end: number;
  /** The exact guarded line, or null for ingested decision memory (e.g. an
   * override) that covers a line range rather than one literal line. */
  code: string | null;
  summary: string;
  citations: Citation[];
}

export interface Knowledge {
  repo: string;
  fences: Fence[];
}

export interface SlackMessage {
  user: string;
  text: string;
  ts: string;
}

export interface SlackThread {
  channel: string;
  ts: string;
  title: string;
  messages: SlackMessage[];
}

export interface SlackData {
  threads: SlackThread[];
}

export interface LinearTicket {
  key: string;
  title: string;
  description: string;
  status: string;
  url: string;
}

export interface LinearData {
  tickets: LinearTicket[];
}

export interface PrEntry {
  number: number;
  title: string;
  branch: string;
  base: string;
  head_sha: string;
  diff_file: string;
  author: string;
}

export interface PrsData {
  prs: PrEntry[];
}

export interface Hunk {
  file: string;
  old_start: number;
  old_end: number;
  new_start: number;
  new_end: number;
  old_lines: string[];
  new_lines: string[];
  symbol?: string;
  hunk_hash?: string;
}

export type VerdictValue = "YES" | "NO" | "NO_EVIDENCE";

export interface Verdict {
  verdict: VerdictValue;
  reason: string;
  citations: Citation[];
}

export interface AskRequest {
  repo: string;
  hunk: Hunk;
}

export interface StaleRequest {
  repo: string;
  file: string;
  comment: string;
  comment_line: number;
  hunk: Hunk;
}

export interface StaleResponse {
  stale: boolean;
  reason: string;
  citations: Citation[];
}
