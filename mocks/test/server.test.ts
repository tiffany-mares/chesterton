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

describe("GET /healthz", () => {
  it("reports ok with the service name", async () => {
    const res = await request(app()).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, service: "mocks" });
  });
});

describe("POST /estelle/v1/ask", () => {
  const hunk = {
    file: "services/payments/client.py",
    old_start: 5,
    old_end: 5,
    new_start: 5,
    new_end: 5,
    old_lines: ["MAX_RETRIES = 3"],
    new_lines: ["MAX_RETRIES = 50"],
    symbol: "",
    hunk_hash: "deadbeef",
  };

  it("returns YES with 3 citations for the retry-cap hunk", async () => {
    const res = await request(app()).post("/estelle/v1/ask").send({ repo: "acme/storefront", hunk });
    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe("YES");
    expect(res.body.citations).toHaveLength(3);
  });

  it("is byte-identical across two identical requests", async () => {
    const a = await request(app()).post("/estelle/v1/ask").send({ repo: "acme/storefront", hunk });
    const b = await request(app()).post("/estelle/v1/ask").send({ repo: "acme/storefront", hunk });
    expect(JSON.stringify(a.body)).toBe(JSON.stringify(b.body));
  });

  it("400s on a malformed request body", async () => {
    const res = await request(app()).post("/estelle/v1/ask").send({ repo: "acme/storefront" });
    expect(res.status).toBe(400);
  });
});

describe("POST /estelle/v1/stale", () => {
  it("flags the stale checkout-timeout comment", async () => {
    const res = await request(app())
      .post("/estelle/v1/stale")
      .send({
        repo: "acme/storefront",
        file: "services/checkout/api.py",
        comment: "# timeout is 30s, see ENG-310",
        comment_line: 7,
        hunk: {
          file: "services/checkout/api.py",
          old_start: 8,
          old_end: 8,
          new_start: 8,
          new_end: 8,
          old_lines: ["CHECKOUT_TIMEOUT_SECONDS = 30"],
          new_lines: ["CHECKOUT_TIMEOUT_SECONDS = 5"],
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.stale).toBe(true);
    expect(res.body.citations).toHaveLength(3);
  });
});

describe("POST /estelle/v1/knowledge", () => {
  const fence = {
    id: "override-9",
    file: "services/payments/client.py",
    line_start: 5,
    line_end: 5,
    summary: "Override by sam: cap can move.",
    citations: [{ type: "override", url: "http://localhost:4600/", title: "Override by sam" }],
  };

  it("ingests a fence and the next ask cites it (upsert by id, no duplicates)", async () => {
    const fx = loadFixtures({ seedOutDir: FIXTURES_DIR });
    const server = createApp({ fixtures: fx, webhookSecret: "devsecret", gatewayUrl: "http://localhost:0" });

    const before = fx.knowledge.fences.length;
    const res1 = await request(server).post("/estelle/v1/knowledge").send({ fence });
    expect(res1.status).toBe(201);
    expect(res1.body.fences).toBe(before + 1);

    // Upsert: same id again does not duplicate.
    const res2 = await request(server).post("/estelle/v1/knowledge").send({ fence });
    expect(res2.status).toBe(201);
    expect(res2.body.fences).toBe(before + 1);

    const ask = await request(server).post("/estelle/v1/ask").send({
      repo: "acme/storefront",
      hunk: {
        file: "services/payments/client.py",
        old_start: 5, old_end: 5, new_start: 5, new_end: 5,
        old_lines: ["MAX_RETRIES = 50"], new_lines: ["MAX_RETRIES = 500"],
        symbol: "", hunk_hash: "beefcafe",
      },
    });
    expect(ask.status).toBe(200);
    expect(ask.body.verdict).toBe("YES");
    expect(ask.body.citations[0].type).toBe("override");
  });

  it("rejects a malformed fence", async () => {
    const fx = loadFixtures({ seedOutDir: FIXTURES_DIR });
    const server = createApp({ fixtures: fx, webhookSecret: "devsecret", gatewayUrl: "http://localhost:0" });
    const res = await request(server).post("/estelle/v1/knowledge").send({ fence: { id: "x" } });
    expect(res.status).toBe(400);
  });
});
