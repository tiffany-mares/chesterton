import { describe, expect, it } from "vitest";
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

describe("GET /github/:owner/:repo/pull/:n/files", () => {
  it("renders the DOM contract the extension pins to, for a live demo PR", async () => {
    const res = await request(app()).get("/github/acme/storefront/pull/1/files");
    expect(res.status).toBe(200);
    expect(res.type).toBe("text/html");

    const html = res.text;
    expect(html).toContain('data-tagsearch-path="services/payments/client.py"');
    expect(html).toMatch(/class="file-header"[^>]*data-path="services\/payments\/client\.py"/);
    expect(html).toMatch(/<td class="blob-num[^"]*" data-line-number="5"/);
    expect(html).toMatch(/class="[^"]*blob-num-addition[^"]*" data-line-number="5"/);
    expect(html).toContain("acme/storefront");
    expect(html).toContain("Bump payment retry limit for a flaky provider");
    expect(html).toContain("demo/retry-cap-removal");
    expect(html).toContain("main");
  });

  it("renders historical PRs (101+) from prs.json alone", async () => {
    const res = await request(app()).get("/github/acme/storefront/pull/101/files");
    expect(res.status).toBe(200);
    expect(res.text).toContain("fix/retry-cap");
    expect(res.text).toContain("Cap payment retries (fixes ENG-212)");
  });

  it("404s for an unknown PR", async () => {
    const res = await request(app()).get("/github/acme/storefront/pull/9999/files");
    expect(res.status).toBe(404);
  });

  it("renders a stored review comment (e.g. a plaque suggestion) under the matching file", async () => {
    const a = app();
    await request(a)
      .post("/github/api/repos/acme/storefront/pulls/1/comments")
      .send({
        body: "Chesterton fence plaque:\n```suggestion\n# Fence: MAX_RETRIES=3 — see ENG-212 (http://localhost:4100/linear/issue/ENG-212)\nMAX_RETRIES = 50\n```",
        commit_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        path: "services/payments/client.py",
        line: 5,
        side: "RIGHT",
      });

    const res = await request(a).get("/github/acme/storefront/pull/1/files");
    expect(res.status).toBe(200);
    expect(res.text).toContain("review-comments");
    expect(res.text).toContain("Chesterton fence plaque:");
    expect(res.text).toContain("# Fence: MAX_RETRIES=3");
    // the suggestion block is rendered as a plain <pre>, not a live diff.
    expect(res.text).toMatch(/<pre class="suggestion">[\s\S]*MAX_RETRIES = 50[\s\S]*<\/pre>/);
  });

  it("does not render review comments for other PRs or other files", async () => {
    const a = app();
    await request(a)
      .post("/github/api/repos/acme/storefront/pulls/1/comments")
      .send({
        body: "unrelated comment",
        commit_id: "sha",
        path: "services/other/file.py",
        line: 1,
        side: "RIGHT",
      });

    const res = await request(a).get("/github/acme/storefront/pull/1/files");
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("unrelated comment");
  });
});

describe("GET /slack/archives/:channel/p:ts", () => {
  it("renders the seeded thread with usernames and message text", async () => {
    const res = await request(app()).get("/slack/archives/oncall/p1700000000");
    expect(res.status).toBe(200);
    expect(res.type).toBe("text/html");
    expect(res.text).toContain("Person 1");
    expect(res.text).toContain("Person 2");
    expect(res.text).toContain("checkout is hammering payments, retries are unbounded");
    expect(res.text).toContain("#oncall: retry cap");
  });

  it("404s for an unknown thread", async () => {
    const res = await request(app()).get("/slack/archives/oncall/p9999999999");
    expect(res.status).toBe(404);
  });
});

describe("GET /linear/issue/:key", () => {
  it("renders the ticket's title, status, and description", async () => {
    const res = await request(app()).get("/linear/issue/ENG-212");
    expect(res.status).toBe(200);
    expect(res.type).toBe("text/html");
    expect(res.text).toContain("Cap payment retries at 3");
    expect(res.text).toContain("Done");
    expect(res.text).toContain("Payment retries are capped at 3");
  });

  it("404s for an unknown ticket", async () => {
    const res = await request(app()).get("/linear/issue/ENG-9999");
    expect(res.status).toBe(404);
  });
});
