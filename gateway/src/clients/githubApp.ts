/**
 * GitHub App installation-token minting. Real check runs can only be created
 * with an App installation token (a classic PAT cannot), so in real mode the
 * gateway signs an RS256 app JWT, exchanges it for an installation token,
 * and hands that token to its own GitHub calls and to verdict (as
 * `installation_token` in /judge). Mock mode never constructs this: the mock
 * GitHub API ignores auth entirely.
 */

import crypto from "node:crypto";

export interface AppAuthConfig {
  appId: string;
  /** PEM private key. Literal "\n" escapes (common in env files) are unescaped by loadAppAuthConfig. */
  privateKey: string;
  installationId: string;
  githubApiUrl: string;
}

/** Reads GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_APP_INSTALLATION_ID.
 * Returns undefined unless all three are present (mock mode / PAT mode). */
export function loadAppAuthConfig(env: NodeJS.ProcessEnv = process.env): AppAuthConfig | undefined {
  const appId = env.GITHUB_APP_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;
  const installationId = env.GITHUB_APP_INSTALLATION_ID;
  if (!appId || !privateKey || !installationId) return undefined;
  return {
    appId,
    privateKey: privateKey.replace(/\\n/g, "\n"),
    installationId,
    githubApiUrl: env.GITHUB_API_URL ?? "https://api.github.com",
  };
}

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}

/** A short-lived JWT identifying the App itself (GitHub caps exp at 10 min;
 * iat is backdated 60s to absorb clock drift, per GitHub's own docs). */
function buildAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }));
  const signature = crypto
    .sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey)
    .toString("base64url");
  return `${header}.${payload}.${signature}`;
}

/** Refresh when the cached token is within this window of its expiry. */
const EXPIRY_SKEW_MS = 5 * 60_000;

/**
 * Returns a getToken() that mints installation tokens on demand and caches
 * them until ~5 minutes before expiry (GitHub issues 1-hour tokens).
 */
export function createInstallationTokenProvider(
  cfg: AppAuthConfig,
  fetchImpl: typeof fetch = fetch
): () => Promise<string> {
  let cached: { token: string; expiresAtMs: number } | undefined;

  return async function getToken(): Promise<string> {
    if (cached && Date.now() < cached.expiresAtMs - EXPIRY_SKEW_MS) {
      return cached.token;
    }

    const res = await fetchImpl(
      `${cfg.githubApiUrl}/app/installations/${cfg.installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${buildAppJwt(cfg.appId, cfg.privateKey)}`,
          accept: "application/vnd.github+json",
          "user-agent": "chesterton-gateway",
        },
      }
    );
    if (res.status !== 201) {
      const body = await res.text().catch(() => "");
      throw new Error(`github app: minting installation token failed with ${res.status}: ${body}`);
    }
    const data = (await res.json()) as { token: string; expires_at: string };
    cached = { token: data.token, expiresAtMs: Date.parse(data.expires_at) };
    return data.token;
  };
}
