import type { Hunk } from "../types.js";

export async function analyzeDiff(
  analyzerUrl: string,
  diff: string,
  fetchImpl: typeof fetch = fetch
): Promise<Hunk[]> {
  const res = await fetchImpl(`${analyzerUrl}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ diff }),
  });
  if (!res.ok) {
    throw new Error(`analyzer /analyze failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { hunks: Hunk[] };
  return data.hunks;
}
