import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MockAgent, setGlobalDispatcher } from "undici";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPlaqueBody, commentLeaderFor } from "../src/plaque.js";
import { createApp } from "../src/server.js";
import { createRawEventStore, LocalOverrideState } from "../src/store.js";
import type { Flag } from "../src/types.js";

describe("commentLeaderFor", () => {
  it.each([
    [".py", "#"],
    [".js", "//"],
    [".ts", "//"],
    [".go", "//"],
    [".java", "//"],
    [".rs", "//"],
    [".unknown", "#"],
  ])("maps %s -> %s", (ext, leader) => {
    expect(commentLeaderFor(`file${ext}`)).toBe(leader);
  });
});

describe("buildPlaqueBody", () => {
  const flag: Flag = {
    id: 17,
    repo: "acme/storefront",
    pr: 1,
    head_sha: "sha123",
    file: "services/payments/client.py",
    line: 5,
    kind: "contradiction",
    verdict: "YES",
    reason: "MAX_RETRIES=3 caps payment retries after incident ENG-212",
    citations: [
      { type: "slack", url: "http://localhost:4100/slack/archives/oncall/p1700000001", title: "#oncall: payment retries incident" },
      { type: "linear", url: "http://localhost:4100/linear/issue/ENG-212", title: "ENG-212" },
    ],
    hunk_hash: "hashHIGH",
    status: "open",
  };

  it("builds the exact suggestion body for a .py file", () => {
    const body = buildPlaqueBody("#", flag, "MAX_RETRIES = 50");
    expect(body).toBe(
      "Chesterton fence plaque:\n" +
        "```suggestion\n" +
        "# Fence: MAX_RETRIES=3 caps payment retries after incident ENG-212 — see #oncall: payment retries incident (http://localhost:4100/slack/archives/oncall/p1700000001)\n" +
        "MAX_RETRIES = 50\n" +
        "```"
    );
  });

  it("uses // for a .ts file", () => {
    const body = buildPlaqueBody("//", { ...flag, file: "src/client.ts" }, "const MAX = 50;");
    expect(body.split("\n")[2]).toContain("// Fence:");
    expect(body.split("\n")[3]).toBe("const MAX = 50;");
  });
});

let mockAgent: MockAgent;
let tmpDir: string;

beforeEach(() => {
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-plaque-test-"));
});

afterEach(async () => {
  await mockAgent.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function buildApp() {
  const rawEventStore = await createRawEventStore({ mongoUrl: undefined, rawEventsDir: tmpDir });
  const localState = LocalOverrideState.load(path.join(tmpDir, "local-state.json"));
  return createApp({
    analyzerUrl: "http://analyzer.test",
    triageUrl: "http://triage.test",
    verdictUrl: "http://verdict.test",
    ledgerUrl: "http://ledger.test",
    githubApiUrl: "http://github.test",
    githubToken: "",
    webhookSecret: "devsecret",
    rawEventStore,
    localState,
  });
}

const DIFF_TEXT =
  "diff --git a/services/payments/client.py b/services/payments/client.py\n" +
  "index c1f660d..ccc8363 100644\n" +
  "--- a/services/payments/client.py\n" +
  "+++ b/services/payments/client.py\n" +
  "@@ -2,7 +2,7 @@\n \n import time\n \n-MAX_RETRIES = 3\n+MAX_RETRIES = 50\n BACKOFF_SECONDS = 2\n";

const LEDGER_ROW = {
  id: 17,
  repo: "acme/storefront",
  pr: 1,
  head_sha: "sha123",
  hunk_hash: "hashHIGH",
  decision_id: 3,
  verdict: "YES",
  payload: {
    id: 17,
    repo: "acme/storefront",
    pr: 1,
    head_sha: "sha123",
    file: "services/payments/client.py",
    line: 5,
    kind: "contradiction",
    verdict: "YES",
    reason: "MAX_RETRIES=3 caps payment retries after incident ENG-212",
    citations: [{ type: "slack", url: "http://localhost:4100/slack/archives/oncall/p1700000001", title: "#oncall: payment retries incident" }],
    hunk_hash: "hashHIGH",
    status: "open",
  },
};

describe("POST /plaque", () => {
  it("fetches the flag, builds the suggestion comment, and posts it to the GitHub API", async () => {
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/verdicts?repo=acme%2Fstorefront&pr=1", method: "GET" })
      .reply(200, [LEDGER_ROW]);
    mockAgent
      .get("http://github.test")
      .intercept({ path: "/repos/acme/storefront/pulls/1", method: "GET" })
      .reply(200, DIFF_TEXT);
    mockAgent
      .get("http://github.test")
      .intercept({ path: "/repos/acme/storefront/pulls/1/comments", method: "POST" })
      .reply(201, (opts) => {
        const body = JSON.parse(String(opts.body));
        expect(body.commit_id).toBe("sha123");
        expect(body.path).toBe("services/payments/client.py");
        expect(body.line).toBe(5);
        expect(body.side).toBe("RIGHT");
        expect(body.body).toContain("# Fence:");
        expect(body.body).toContain("MAX_RETRIES = 50");
        return { id: 555, ...body };
      });

    const app = await buildApp();
    const res = await request(app).post("/plaque").send({ repo: "acme/storefront", pr: 1, flag_id: 17 });
    expect(res.status).toBe(201);
    expect(res.body.posted).toBe(true);
    expect(res.body.comment.id).toBe(555);
  });

  it("returns 404 when the flag cannot be found anywhere", async () => {
    mockAgent
      .get("http://ledger.test")
      .intercept({ path: "/verdicts?repo=acme%2Fstorefront&pr=1", method: "GET" })
      .reply(200, []);
    const app = await buildApp();
    const res = await request(app).post("/plaque").send({ repo: "acme/storefront", pr: 1, flag_id: 999 });
    expect(res.status).toBe(404);
  });
});
