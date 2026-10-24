import * as fx from "./fixtures";

export type CitationType = "slack" | "linear" | "pr" | "override";
export interface Citation { type: CitationType; url: string; title: string }
export interface FileFences { file: string; fence_count: number; loc: number }
export interface Decision {
  id: number; file: string; line_start: number; line_end: number; summary: string;
  citations: Citation[]; source: "seed" | "verdict" | "override" | "plaque";
}
export interface Flag {
  id: number; repo: string; pr: number; head_sha: string; file: string; line: number;
  kind: "contradiction" | "stale_comment"; verdict: "YES" | "NO" | "NO_EVIDENCE";
  reason: string; citations: Citation[]; hunk_hash: string;
  status: "open" | "dismissed" | "overridden";
}
export interface Override { id: number; verdict_id: number; reason: string; author: string; created_at: string; verdict: Flag }
export interface Stats { verdicts_total: number; flags_total: number; overrides_total: number; false_positive_rate: number }

export const DEFAULT_GATEWAY =
  (import.meta.env['VITE_GATEWAY_URL'] as string | undefined) ?? "http://localhost:4000";

async function get<T>(gw: string, path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${gw.replace(/\/$/, "")}${path}?${qs}`);
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  fencesByFile: (gw: string, repo: string) => get<FileFences[]>(gw, "/fences/by-file", { repo }),
  decisions: (gw: string, repo: string, file: string) => get<Decision[]>(gw, "/decisions", { repo, file }),
  verdicts: async (gw: string, repo: string) => (await get<{ flags: Flag[] }>(gw, "/verdicts", { repo })).flags,
  overrides: (gw: string, repo: string) => get<Override[]>(gw, "/overrides", { repo }),
  stats: (gw: string, repo: string) => get<Stats>(gw, "/stats", { repo }),
};

export const fixtures = {
  fencesByFile: () => fx.files,
  decisions: (file: string) => fx.decisions.filter((d) => d.file === file),
  verdicts: () => fx.flags,
  overrides: () => fx.overrides,
  stats: () => fx.stats,
};
