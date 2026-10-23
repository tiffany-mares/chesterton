// Gateway + chrome.storage.sync boundary. This is the ONLY file (besides content.ts
// wiring) that touches the chrome.* global, so src/lib.ts stays testable under plain
// vitest + jsdom without a browser. Falls back sanely when chrome.storage is not
// available (e.g. under test, or if somehow loaded outside an extension context).

import type { Flag } from "./lib.js";

export const DEFAULT_GATEWAY_URL = "http://localhost:4000";
const STORAGE_KEY = "gatewayUrl";

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && !!chrome?.storage?.sync;
}

/** Reads the configured gateway base URL from chrome.storage.sync (default http://localhost:4000). */
export function getGatewayUrl(): Promise<string> {
  if (!hasChromeStorage()) return Promise.resolve(DEFAULT_GATEWAY_URL);
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEY], (items: Record<string, unknown>) => {
      const value = items?.[STORAGE_KEY];
      resolve(typeof value === "string" && value.length > 0 ? value : DEFAULT_GATEWAY_URL);
    });
  });
}

/** Persists the gateway base URL to chrome.storage.sync. */
export function setGatewayUrl(url: string): Promise<void> {
  if (!hasChromeStorage()) return Promise.resolve();
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEY]: url }, () => resolve());
  });
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status}`);
  return res.json().catch(() => ({}));
}

/** GET {gatewayUrl}/verdicts?repo=owner/repo&pr=n */
export async function fetchVerdicts(gatewayUrl: string, owner: string, repo: string, pr: number): Promise<Flag[]> {
  const url = `${gatewayUrl}/verdicts?repo=${encodeURIComponent(`${owner}/${repo}`)}&pr=${pr}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const data = (await res.json()) as { flags?: Flag[] };
  return data.flags ?? [];
}

/** POST {gatewayUrl}/flags/{id}/dismiss */
export function dismissFlag(gatewayUrl: string, flagId: number): Promise<unknown> {
  return postJson(`${gatewayUrl}/flags/${flagId}/dismiss`, {});
}

/** POST {gatewayUrl}/overrides {verdict_id, reason, author} */
export function createOverride(
  gatewayUrl: string,
  verdictId: number,
  reason: string,
  author = "chesterton-extension",
): Promise<unknown> {
  return postJson(`${gatewayUrl}/overrides`, { verdict_id: verdictId, reason, author });
}

/** POST {gatewayUrl}/plaque {repo, pr, flag_id} */
export function pinReason(gatewayUrl: string, repo: string, pr: number, flagId: number): Promise<unknown> {
  return postJson(`${gatewayUrl}/plaque`, { repo, pr, flag_id: flagId });
}
