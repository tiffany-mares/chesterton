import { describe, expect, it, beforeEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { loadFixtures } from "../src/store.js";
import { createApp } from "../src/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");
const fixtures = loadFixtures({ seedOutDir: FIXTURES_DIR });

function app() {
  return createApp({ fixtures, webhookSecret: "devsecret", gatewayUrl: "http://localhost:0" });
}

describe("GET /github/api/repos/:owner/:repo/pulls/:n", () => {
  it("returns PR metadata as JSON by default", async () => {
    const res = await request(app()).get("/github/api/repos/acme/storefront/pulls/1");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      number: 1,
      title: "Bump payment retry limit for a flaky provider",
      state: "open",
      head: { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ref: "demo/retry-cap-removal" },
      base: { ref: "main" },
    });
  });

  it("returns the unified diff text when Accept is the v3 diff media type", async () => {
    const res = await request(app())
      .get("/github/api/repos/acme/storefront/pulls/1")
      .set("Accept", "application/vnd.github.v3.diff");
    expect(res.status).toBe(200);
    expect(res.text).toContain("-MAX_RETRIES = 3");
    expect(res.text).toContain("+MAX_RETRIES = 50");
  });

  it("serves historical PRs (101+) from prs.json alone", async () => {
    const json = await request(app()).get("/github/api/repos/acme/storefront/pulls/101");
    expect(json.status).toBe(200);
    expect(json.body.head.ref).toBe("fix/retry-cap");

    const diff = await request(app())
      .get("/github/api/repos/acme/storefront/pulls/101")
      .set("Accept", "application/vnd.github.v3.diff");
    expect(diff.text).toContain("+MAX_RETRIES = 3");
  });

  it("404s for an unknown PR number", async () => {
    const res = await request(app()).get("/github/api/repos/acme/storefront/pulls/9999");
    expect(res.status).toBe(404);
  });
});

describe("check-runs", () => {
  it("stores a check run and lists it by commit sha", async () => {
    const a = app();
    const create = await request(a).post("/github/api/repos/acme/storefront/check-runs").send({
      name: "chesterton",
      head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "completed",
      conclusion: "action_required",
      output: { title: "1 flag", summary: "- flag 1" },
    });
    expect(create.status).toBe(201);
    expect(create.body.id).toBeTypeOf("number");
    expect(create.body.name).toBe("chesterton");

    const list = await request(a).get(
      "/github/api/repos/acme/storefront/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/check-runs"
    );
    expect(list.status).toBe(200);
    expect(list.body.check_runs).toHaveLength(1);
    expect(list.body.check_runs[0].id).toBe(create.body.id);
  });

  it("isolates check-run state per app instance", async () => {
    const a = app();
    const b = app();
    await request(a).post("/github/api/repos/acme/storefront/check-runs").send({
      name: "x",
      head_sha: "s1",
      status: "completed",
      conclusion: "neutral",
      output: { title: "t", summary: "s" },
    });
    const list = await request(b).get("/github/api/repos/acme/storefront/commits/s1/check-runs");
    expect(list.body.check_runs).toHaveLength(0);
  });
});

describe("review comments", () => {
  it("stores a PR comment and lists it", async () => {
    const a = app();
    const create = await request(a).post("/github/api/repos/acme/storefront/pulls/1/comments").send({
      body: "Fence: payment retries are capped at 3 — see ENG-212",
      commit_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      path: "services/payments/client.py",
      line: 5,
      side: "RIGHT",
    });
    expect(create.status).toBe(201);
    expect(create.body.id).toBeTypeOf("number");

    const list = await request(a).get("/github/api/repos/acme/storefront/pulls/1/comments");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].body).toContain("ENG-212");
  });
});
