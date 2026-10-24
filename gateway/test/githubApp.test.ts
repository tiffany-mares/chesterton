import crypto from "node:crypto";
import { MockAgent, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInstallationTokenProvider, loadAppAuthConfig } from "../src/clients/githubApp.js";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

let mockAgent: MockAgent;

beforeEach(() => {
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(async () => {
  await mockAgent.close();
});

function b64urlJson(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf-8"));
}

function interceptTokenMint(expiresAt: string, token: string, headerSink?: Record<string, string>) {
  mockAgent
    .get("https://api.github.com")
    .intercept({
      path: "/app/installations/42/access_tokens",
      method: "POST",
    })
    .reply(201, { token, expires_at: expiresAt }, { headers: { "content-type": "application/json" } })
    .times(1);
}

const CONFIG = {
  appId: "12345",
  privateKey: PRIVATE_PEM,
  installationId: "42",
  githubApiUrl: "https://api.github.com",
};

describe("createInstallationTokenProvider", () => {
  it("mints an installation token with a valid RS256 app JWT", async () => {
    let authHeader = "";
    mockAgent
      .get("https://api.github.com")
      .intercept({
        path: "/app/installations/42/access_tokens",
        method: "POST",
        headers: (h) => {
          authHeader = h.authorization ?? "";
          return true;
        },
      })
      .reply(
        201,
        { token: "ghs_minted", expires_at: new Date(Date.now() + 3600_000).toISOString() },
        { headers: { "content-type": "application/json" } }
      );

    const getToken = createInstallationTokenProvider(CONFIG);
    expect(await getToken()).toBe("ghs_minted");

    expect(authHeader).toMatch(/^Bearer /);
    const jwt = authHeader.slice("Bearer ".length);
    const [headerB64, payloadB64, sigB64] = jwt.split(".");
    expect(b64urlJson(headerB64)).toEqual({ alg: "RS256", typ: "JWT" });
    const payload = b64urlJson(payloadB64) as { iss: string; iat: number; exp: number };
    expect(payload.iss).toBe("12345");
    expect(payload.exp).toBeGreaterThan(payload.iat);

    const verified = crypto.verify(
      "RSA-SHA256",
      Buffer.from(`${headerB64}.${payloadB64}`),
      publicKey,
      Buffer.from(sigB64, "base64url")
    );
    expect(verified).toBe(true);
  });

  it("caches the token until near expiry", async () => {
    interceptTokenMint(new Date(Date.now() + 3600_000).toISOString(), "ghs_cached");
    const getToken = createInstallationTokenProvider(CONFIG);
    expect(await getToken()).toBe("ghs_cached");
    // Second call must come from cache -- the single interception above is
    // already consumed, so a real second request would throw.
    expect(await getToken()).toBe("ghs_cached");
  });

  it("re-mints when the cached token is close to expiry", async () => {
    interceptTokenMint(new Date(Date.now() + 2 * 60_000).toISOString(), "ghs_shortlived");
    const getToken = createInstallationTokenProvider(CONFIG);
    expect(await getToken()).toBe("ghs_shortlived");

    interceptTokenMint(new Date(Date.now() + 3600_000).toISOString(), "ghs_fresh");
    expect(await getToken()).toBe("ghs_fresh");
  });

  it("throws a clear error on a non-201 response", async () => {
    mockAgent
      .get("https://api.github.com")
      .intercept({ path: "/app/installations/42/access_tokens", method: "POST" })
      .reply(401, { message: "bad credentials" });
    const getToken = createInstallationTokenProvider(CONFIG);
    await expect(getToken()).rejects.toThrow(/401/);
  });
});

describe("loadAppAuthConfig", () => {
  it("returns undefined unless all three app vars are set", () => {
    expect(loadAppAuthConfig({ GITHUB_API_URL: "https://api.github.com" })).toBeUndefined();
    expect(
      loadAppAuthConfig({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: "k" })
    ).toBeUndefined();
  });

  it("unescapes literal \\n sequences in the private key", () => {
    const cfg = loadAppAuthConfig({
      GITHUB_APP_ID: "1",
      GITHUB_APP_PRIVATE_KEY: "line1\\nline2",
      GITHUB_APP_INSTALLATION_ID: "7",
      GITHUB_API_URL: "https://api.github.com",
    });
    expect(cfg).toBeDefined();
    expect(cfg?.privateKey).toBe("line1\nline2");
    expect(cfg?.installationId).toBe("7");
  });
});
