import type { JudgeRequest, JudgeResponse } from "../types.js";

export async function judge(
  verdictUrl: string,
  request: JudgeRequest,
  fetchImpl: typeof fetch = fetch
): Promise<JudgeResponse> {
  const res = await fetchImpl(`${verdictUrl}/judge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    throw new Error(`verdict /judge failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as JudgeResponse;
}
