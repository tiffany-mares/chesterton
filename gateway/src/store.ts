/**
 * Persistence for the gateway:
 *  - RawEventStore: stores every webhook payload verbatim, before any
 *    pipeline processing. Mongo if MONGO_URL connects within ~1s at
 *    startup, else JSON files under <rawEventsDir>/<timestamp>-<delivery-id>.json
 *    (random suffix if no delivery id header was sent).
 *  - JudgeCache: small in-memory LRU of the last judge() response per
 *    "repo:pr", so GET /verdicts never 500s when the ledger is down.
 *  - LocalOverrideState: a JSON file recording dismiss/override status
 *    overlays, so a dismiss is never lost even if the ledger write fails.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// RawEventStore
// ---------------------------------------------------------------------------

export interface RawEventStore {
  readonly mode: "mongo" | "file";
  /** `rawBody` is the exact bytes of the webhook request body (the same
   * Buffer captured for HMAC verification), stored verbatim. */
  save(rawBody: Buffer, deliveryId?: string): Promise<void>;
  close(): Promise<void>;
}

export interface MongoLikeClient {
  db(): { collection(name: string): { insertOne(doc: unknown): Promise<unknown> } };
  close(): Promise<void>;
}

export interface CreateRawEventStoreOptions {
  mongoUrl: string | undefined;
  rawEventsDir: string;
  /** Injectable for tests; defaults to a real `mongodb` MongoClient.connect. */
  connect?: (url: string) => Promise<MongoLikeClient>;
  /** Max time to wait for Mongo to connect before falling back to files. */
  connectTimeoutMs?: number;
}

async function defaultConnect(url: string): Promise<MongoLikeClient> {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 1000, connectTimeoutMS: 1000 });
  await client.connect();
  return client as unknown as MongoLikeClient;
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
}

function fileSafeId(): string {
  return crypto.randomBytes(6).toString("hex");
}

function makeFileStore(rawEventsDir: string): RawEventStore {
  return {
    mode: "file",
    async save(rawBody: Buffer, deliveryId?: string) {
      await fsp.mkdir(rawEventsDir, { recursive: true });
      const suffix = deliveryId && deliveryId.length > 0 ? deliveryId : fileSafeId();
      const filename = `${Date.now()}-${suffix}.json`;
      // Write the raw bytes verbatim (no re-serialization) so the stored
      // payload is byte-identical to what GitHub sent / what HMAC verified.
      await fsp.writeFile(path.join(rawEventsDir, filename), rawBody);
    },
    async close() {
      // nothing to close for file mode
    },
  };
}

function makeMongoStore(client: MongoLikeClient): RawEventStore {
  const collection = client.db().collection("raw_events");
  return {
    mode: "mongo",
    async save(rawBody: Buffer, deliveryId?: string) {
      const raw = rawBody.toString("utf8");
      // Parsed copy is a convenience for querying in Mongo; the raw string
      // above remains the source of truth for the exact bytes received.
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = undefined;
      }
      await collection.insertOne({
        received_at: new Date().toISOString(),
        delivery_id: deliveryId ?? null,
        raw,
        payload,
      });
    },
    async close() {
      await client.close();
    },
  };
}

/** Attempts Mongo (if `mongoUrl` is set) within `connectTimeoutMs` (~1s
 * default); falls back to the file store on any failure or timeout. */
export async function createRawEventStore(opts: CreateRawEventStoreOptions): Promise<RawEventStore> {
  const { mongoUrl, rawEventsDir, connectTimeoutMs = 1000 } = opts;
  const connect = opts.connect ?? defaultConnect;

  if (!mongoUrl) {
    return makeFileStore(rawEventsDir);
  }

  try {
    const client = await Promise.race([connect(mongoUrl), timeout(connectTimeoutMs)]);
    return makeMongoStore(client);
  } catch {
    return makeFileStore(rawEventsDir);
  }
}

// ---------------------------------------------------------------------------
// JudgeCache (LRU of last judge() flags per repo:pr)
// ---------------------------------------------------------------------------

export class JudgeCache<T = unknown> {
  private readonly map = new Map<string, T>();

  constructor(private readonly maxEntries = 20) {}

  key(repo: string, pr: number): string {
    return `${repo}:${pr}`;
  }

  set(repo: string, pr: number, value: T): void {
    const k = this.key(repo, pr);
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, value);
    while (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      this.map.delete(oldestKey);
    }
  }

  get(repo: string, pr: number): T | undefined {
    const k = this.key(repo, pr);
    const v = this.map.get(k);
    if (v !== undefined) {
      // touch for LRU recency
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }

  /** Finds a value (across all cached repo:pr entries) via a predicate. Used
   * by best-effort ledger-less lookups (e.g. dismiss/plaque by flag id). */
  findEntry(predicate: (value: T, key: string) => boolean): { key: string; value: T } | undefined {
    for (const [key, value] of this.map.entries()) {
      if (predicate(value, key)) return { key, value };
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// LocalOverrideState (resilience overlay for dismiss/override, JSON file)
// ---------------------------------------------------------------------------

export interface LocalOverrideRecord {
  id: number;
  verdict_id: number;
  reason: string;
  author: string;
  created_at: string;
}

interface LocalStateShape {
  dismissed: number[];
  overridden: number[];
  overrides: LocalOverrideRecord[];
  nextOverrideId: number;
}

function emptyState(): LocalStateShape {
  return { dismissed: [], overridden: [], overrides: [], nextOverrideId: 1 };
}

export class LocalOverrideState {
  private state: LocalStateShape;

  private constructor(private readonly filePath: string, state: LocalStateShape) {
    this.state = state;
  }

  static load(filePath: string): LocalOverrideState {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<LocalStateShape>;
      return new LocalOverrideState(filePath, {
        dismissed: parsed.dismissed ?? [],
        overridden: parsed.overridden ?? [],
        overrides: parsed.overrides ?? [],
        nextOverrideId: parsed.nextOverrideId ?? 1,
      });
    } catch {
      return new LocalOverrideState(filePath, emptyState());
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  markDismissed(flagId: number): void {
    if (!this.state.dismissed.includes(flagId)) {
      this.state.dismissed.push(flagId);
      this.persist();
    }
  }

  isDismissed(flagId: number): boolean {
    return this.state.dismissed.includes(flagId);
  }

  markOverridden(verdictId: number): void {
    if (!this.state.overridden.includes(verdictId)) {
      this.state.overridden.push(verdictId);
      this.persist();
    }
  }

  isOverridden(verdictId: number): boolean {
    return this.state.overridden.includes(verdictId);
  }

  addPendingOverride(verdictId: number, reason: string, author: string): LocalOverrideRecord {
    const record: LocalOverrideRecord = {
      id: this.state.nextOverrideId,
      verdict_id: verdictId,
      reason,
      author,
      created_at: new Date().toISOString(),
    };
    this.state.nextOverrideId += 1;
    this.state.overrides.push(record);
    this.markOverridden(verdictId);
    this.persist();
    return record;
  }
}
