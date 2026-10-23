import type { Hunk, HunkScore } from "../types.js";

export async function scoreHunks(
  triageUrl: string,
  hunks: Hunk[],
  fetchImpl: typeof fetch = fetch
): Promise<HunkScore[]> {
  const res = await fetchImpl(`${triageUrl}/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hunks }),
  });
  if (!res.ok) {
    throw new Error(`triage /score failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { scores: HunkScore[] };
  return data.scores;
}
