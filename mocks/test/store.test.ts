import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixtures, readPrDiff } from "../src/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");

describe("loadFixtures", () => {
  it("loads knowledge, slack, linear, and prs from the seed-out directory", () => {
    const fixtures = loadFixtures({ seedOutDir: FIXTURES_DIR });

    expect(fixtures.knowledge.repo).toBe("acme/storefront");
    expect(fixtures.knowledge.fences.map((f) => f.id)).toContain("retry-cap");
    expect(fixtures.slack.threads.length).toBeGreaterThan(0);
    expect(fixtures.linear.tickets.length).toBeGreaterThan(0);
    expect(fixtures.prs.prs.map((p) => p.number)).toEqual([1, 2, 3, 101]);
  });

  it("honors a knowledgeFile override independent of seedOutDir", () => {
    const override = path.join(FIXTURES_DIR, "knowledge.json");
    const fixtures = loadFixtures({ seedOutDir: FIXTURES_DIR, knowledgeFile: override });
    expect(fixtures.knowledge.fences.length).toBeGreaterThan(0);
  });
});

describe("readPrDiff", () => {
  it("reads a PR's diff file relative to seedOutDir", () => {
    const fixtures = loadFixtures({ seedOutDir: FIXTURES_DIR });
    const diff = readPrDiff(fixtures, "prs/1.diff");
    expect(diff).toContain("MAX_RETRIES = 3");
    expect(diff).toContain("MAX_RETRIES = 50");
  });
});
