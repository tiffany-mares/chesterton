import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_GATEWAY_URL, getGatewayUrl, setGatewayUrl, fetchVerdicts, dismissFlag, createOverride, pinReason } from "../src/api.js";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // Ensure no chrome global leaks between tests.
  // @ts-expect-error -- test-only cleanup of a global that may not exist in this env.
  delete globalThis.chrome;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("getGatewayUrl / setGatewayUrl without a chrome global", () => {
  it("falls back to the default gateway URL when chrome.storage is unavailable", async () => {
    expect(await getGatewayUrl()).toBe(DEFAULT_GATEWAY_URL);
  });

  it("setGatewayUrl resolves without throwing when chrome.storage is unavailable", async () => {
    await expect(setGatewayUrl("http://example.test")).resolves.toBeUndefined();
  });
});

describe("getGatewayUrl / setGatewayUrl with a mocked chrome global", () => {
  it("reads the stored value via chrome.storage.sync.get", async () => {
    globalThis.chrome = {
      storage: {
        sync: {
          get: (_keys: string[], cb: (items: Record<string, unknown>) => void) => cb({ gatewayUrl: "http://example.test" }),
          set: (_items: Record<string, unknown>, cb: () => void) => cb(),
        },
      },
    } as unknown as typeof chrome;
    expect(await getGatewayUrl()).toBe("http://example.test");
  });

  it("falls back to default when storage has no stored value", async () => {
    globalThis.chrome = {
      storage: { sync: { get: (_keys: string[], cb: (items: Record<string, unknown>) => void) => cb({}) } },
    } as unknown as typeof chrome;
    expect(await getGatewayUrl()).toBe(DEFAULT_GATEWAY_URL);
  });
});

describe("gateway HTTP calls", () => {
  it("fetchVerdicts builds the correct URL and returns the flags array", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ flags: [{ id: 1 }] }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const flags = await fetchVerdicts("http://localhost:4000", "acme", "storefront", 1);

    expect(flags).toEqual([{ id: 1 }]);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/verdicts?repo=acme%2Fstorefront&pr=1");
  });

  it("fetchVerdicts throws on a non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    await expect(fetchVerdicts("http://localhost:4000", "a", "b", 1)).rejects.toThrow("500");
  });

  it("dismissFlag posts to /flags/{id}/dismiss", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await dismissFlag("http://localhost:4000", 17);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/flags/17/dismiss",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("createOverride posts verdict_id, reason, and author", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await createOverride("http://localhost:4000", 17, "approved by on-call");

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      verdict_id: 17,
      reason: "approved by on-call",
      author: "chesterton-extension",
    });
  });

  it("pinReason posts repo, pr, and flag_id to /plaque", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await pinReason("http://localhost:4000", "acme/storefront", 1, 17);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4000/plaque");
    expect(JSON.parse(init.body)).toEqual({ repo: "acme/storefront", pr: 1, flag_id: 17 });
  });
});
