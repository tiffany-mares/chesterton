import type { Decision, FenceByFileRow, Flag, OverrideRow, Stats } from "./types";

/**
 * Base URL of the gateway service. Configurable via VITE_GATEWAY_URL,
 * defaulting to http://localhost:4000 per docs/contracts.md.
 */
export const GATEWAY_URL: string =
  (import.meta.env.VITE_GATEWAY_URL as string | undefined) ?? "http://localhost:4000";

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${GATEWAY_URL}${path}`);
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export function getFencesByFile(repo: string): Promise<FenceByFileRow[]> {
  return getJSON<FenceByFileRow[]>(`/fences/by-file?repo=${encodeURIComponent(repo)}`);
}

export async function getVerdicts(repo: string, pr?: number): Promise<Flag[]> {
  const qs = new URLSearchParams({ repo });
  if (pr != null) qs.set("pr", String(pr));
  const data = await getJSON<{ flags: Flag[] } | Flag[]>(`/verdicts?${qs.toString()}`);
  return Array.isArray(data) ? data : data.flags;
}

export function getOverrides(repo: string): Promise<OverrideRow[]> {
  return getJSON<OverrideRow[]>(`/overrides?repo=${encodeURIComponent(repo)}`);
}

export function getStats(repo: string): Promise<Stats> {
  return getJSON<Stats>(`/stats?repo=${encodeURIComponent(repo)}`);
}

/**
 * GET {GATEWAY_URL}/decisions?repo=&file= — proxies the ledger's
 * GET /decisions?repo=&file= (docs/contracts.md "gateway (Node)"). Used by
 * the FenceMap side panel to list a file's fences and citations.
 */
export function getDecisions(repo: string, file: string): Promise<Decision[]> {
  const qs = new URLSearchParams({ repo, file });
  return getJSON<Decision[]>(`/decisions?${qs.toString()}`);
}
