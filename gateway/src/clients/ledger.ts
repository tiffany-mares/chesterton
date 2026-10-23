/** Thin client for the ledger (Spring Boot) REST surface per docs/contracts.md. */

export interface LedgerVerdictRow {
  id: number;
  repo: string;
  pr: number;
  head_sha: string;
  hunk_hash: string;
  decision_id: number | null;
  verdict: string;
  payload: unknown;
}

export interface UpsertVerdictBody {
  repo: string;
  pr: number;
  head_sha: string;
  hunk_hash: string;
  decision_id: number | null;
  verdict: string;
  payload: unknown;
}

export interface CreateOverrideBody {
  verdict_id: number;
  reason: string;
  author: string;
}

async function asJson<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    throw new Error(`ledger ${label} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

/** `pr` is optional per docs/contracts.md: omitted returns all rows for the repo. */
export async function getVerdicts(
  ledgerUrl: string,
  repo: string,
  pr: number | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<LedgerVerdictRow[]> {
  const params = new URLSearchParams({ repo });
  if (pr !== undefined) params.set("pr", String(pr));
  const res = await fetchImpl(`${ledgerUrl}/verdicts?${params.toString()}`);
  return asJson<LedgerVerdictRow[]>(res, "GET /verdicts");
}

export async function upsertVerdict(
  ledgerUrl: string,
  body: UpsertVerdictBody,
  fetchImpl: typeof fetch = fetch
): Promise<LedgerVerdictRow> {
  const res = await fetchImpl(`${ledgerUrl}/verdicts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return asJson<LedgerVerdictRow>(res, "POST /verdicts");
}

/** Added per controller scope addition: proxy of ledger's `GET /overrides`,
 * consumed by the dashboard's overrides view. */
export async function getOverrides(
  ledgerUrl: string,
  repo: string,
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  const res = await fetchImpl(`${ledgerUrl}/overrides?repo=${encodeURIComponent(repo)}`);
  return asJson<unknown>(res, "GET /overrides");
}

export async function createOverride(
  ledgerUrl: string,
  body: CreateOverrideBody,
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  const res = await fetchImpl(`${ledgerUrl}/overrides`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return asJson<unknown>(res, "POST /overrides");
}

export async function getFencesByFile(
  ledgerUrl: string,
  repo: string,
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  const res = await fetchImpl(`${ledgerUrl}/fences/by-file?repo=${encodeURIComponent(repo)}`);
  return asJson<unknown>(res, "GET /fences/by-file");
}

export async function getStats(
  ledgerUrl: string,
  repo: string,
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  const res = await fetchImpl(`${ledgerUrl}/stats?repo=${encodeURIComponent(repo)}`);
  return asJson<unknown>(res, "GET /stats");
}

/** Added per controller scope addition: straight proxy of ledger's decisions list,
 * consumed by the dashboard's fence side panel. */
export async function getDecisions(
  ledgerUrl: string,
  repo: string,
  file: string | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  const params = new URLSearchParams({ repo });
  if (file) params.set("file", file);
  const res = await fetchImpl(`${ledgerUrl}/decisions?${params.toString()}`);
  return asJson<unknown>(res, "GET /decisions");
}
