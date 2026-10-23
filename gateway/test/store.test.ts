import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRawEventStore, JudgeCache, LocalOverrideState } from "../src/store.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-store-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("createRawEventStore", () => {
  it("uses file mode when MONGO_URL is not set", async () => {
    const store = await createRawEventStore({ mongoUrl: undefined, rawEventsDir: tmpDir });
    expect(store.mode).toBe("file");
  });

  it("writes the raw bytes verbatim to a file named <timestamp>-<delivery-id>.json", async () => {
    const store = await createRawEventStore({ mongoUrl: undefined, rawEventsDir: tmpDir });
    const rawBytes = Buffer.from(JSON.stringify({ hello: "world" }));
    await store.save(rawBytes, "abc-123");
    const files = fs.readdirSync(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d+-abc-123\.json$/);
    // Exact byte-for-byte match -- no re-serialization/pretty-printing.
    const written = fs.readFileSync(path.join(tmpDir, files[0]));
    expect(written.equals(rawBytes)).toBe(true);
  });

  it("falls back to a random suffix when no delivery id is given", async () => {
    const store = await createRawEventStore({ mongoUrl: undefined, rawEventsDir: tmpDir });
    await store.save(Buffer.from(JSON.stringify({ a: 1 })));
    const files = fs.readdirSync(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d+-[0-9a-f]+\.json$/);
  });

  it("falls back to file mode if the injected Mongo connect rejects", async () => {
    const store = await createRawEventStore({
      mongoUrl: "mongodb://unreachable:27017/x",
      rawEventsDir: tmpDir,
      connect: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(store.mode).toBe("file");
  });

  it("falls back to file mode if the injected Mongo connect is slower than the timeout", async () => {
    const store = await createRawEventStore({
      mongoUrl: "mongodb://slow:27017/x",
      rawEventsDir: tmpDir,
      connectTimeoutMs: 50,
      connect: () => new Promise((resolve) => setTimeout(resolve, 5000)),
    });
    expect(store.mode).toBe("file");
  });

  it("uses mongo mode and inserts via the injected client when connect succeeds in time", async () => {
    const inserted: unknown[] = [];
    const store = await createRawEventStore({
      mongoUrl: "mongodb://fast:27017/x",
      rawEventsDir: tmpDir,
      connect: async () => ({
        db: () => ({
          collection: () => ({
            insertOne: async (doc: unknown) => {
              inserted.push(doc);
              return { acknowledged: true };
            },
          }),
        }),
        close: async () => {},
      }),
    });
    expect(store.mode).toBe("mongo");
    await store.save(Buffer.from(JSON.stringify({ x: 1 })), "delivery-1");
    expect(inserted).toHaveLength(1);
    const doc = inserted[0] as { delivery_id: string; raw: string; payload: unknown };
    expect(doc.delivery_id).toBe("delivery-1");
    // Raw string is stored verbatim; the parsed copy is a convenience.
    expect(doc.raw).toBe(JSON.stringify({ x: 1 }));
    expect(doc.payload).toEqual({ x: 1 });
  });
});

describe("JudgeCache", () => {
  it("stores and retrieves by repo:pr", () => {
    const cache = new JudgeCache<number[]>();
    cache.set("acme/storefront", 1, [1, 2, 3]);
    expect(cache.get("acme/storefront", 1)).toEqual([1, 2, 3]);
    expect(cache.get("acme/storefront", 2)).toBeUndefined();
  });

  it("evicts the least recently used entry beyond capacity", () => {
    const cache = new JudgeCache<number>(2);
    cache.set("r", 1, 1);
    cache.set("r", 2, 2);
    cache.get("r", 1); // touch r:1, making r:2 the LRU
    cache.set("r", 3, 3); // should evict r:2
    expect(cache.get("r", 1)).toBe(1);
    expect(cache.get("r", 2)).toBeUndefined();
    expect(cache.get("r", 3)).toBe(3);
  });

  it("findEntry locates a value across cached repo:pr keys by predicate", () => {
    const cache = new JudgeCache<{ id: number }[]>();
    cache.set("acme/storefront", 1, [{ id: 10 }, { id: 11 }]);
    cache.set("acme/other", 2, [{ id: 20 }]);
    const found = cache.findEntry((flags) => flags.some((f) => f.id === 20));
    expect(found?.key).toBe("acme/other:2");
  });
});

describe("LocalOverrideState", () => {
  it("loads an empty state when the file does not exist", () => {
    const state = LocalOverrideState.load(path.join(tmpDir, "local-state.json"));
    expect(state.isDismissed(1)).toBe(false);
    expect(state.isOverridden(1)).toBe(false);
  });

  it("persists a dismiss and reloads it from disk", () => {
    const filePath = path.join(tmpDir, "local-state.json");
    const state = LocalOverrideState.load(filePath);
    state.markDismissed(42);
    expect(state.isDismissed(42)).toBe(true);

    const reloaded = LocalOverrideState.load(filePath);
    expect(reloaded.isDismissed(42)).toBe(true);
  });

  it("records a pending override and marks the verdict overridden", () => {
    const filePath = path.join(tmpDir, "local-state.json");
    const state = LocalOverrideState.load(filePath);
    const record = state.addPendingOverride(7, "fence still applies", "alice");
    expect(record.verdict_id).toBe(7);
    expect(state.isOverridden(7)).toBe(true);

    const reloaded = LocalOverrideState.load(filePath);
    expect(reloaded.isOverridden(7)).toBe(true);
  });
});
