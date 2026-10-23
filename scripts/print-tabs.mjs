#!/usr/bin/env node
/**
 * Prints the browser tab order for the Chesterton demo script (see
 * docs/outline.md "Demo script"): the three mock PR pages, the retry-cap
 * incident Slack thread, its Linear ticket, and the dashboard.
 *
 * Reads real URLs from seed/out/prs.json + seed/out/knowledge.json when
 * present (i.e. seed.py has already run); otherwise falls back to the
 * known defaults for the shipped demo world (acme/storefront, fences.yaml).
 *
 * Shared by scripts/demo.sh and scripts/demo.ps1 so both wrappers print the
 * exact same tab list.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "seed", "out");

const MOCKS_URL = "http://localhost:4100";
const DASHBOARD_URL = "http://localhost:4600";

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const knowledge = readJson(path.join(OUT_DIR, "knowledge.json"));
const prs = readJson(path.join(OUT_DIR, "prs.json"));

// Defaults match the shipped seed/fences.yaml -- stable even before the
// first `seed.py --reset` run (e.g. a fresh clone that hasn't booted yet).
let repo = "acme/storefront";
let prPages = [1, 2, 3].map((n) => ({ n, title: null }));
let slackUrl = `${MOCKS_URL}/slack/archives/oncall/p1700000000`;
let slackTitle = "#oncall: retry cap";
let linearUrl = `${MOCKS_URL}/linear/issue/ENG-212`;
let linearTitle = "ENG-212: Cap payment retries at 3";

if (knowledge?.repo) {
  repo = knowledge.repo;
}

if (prs?.prs?.length) {
  prPages = [1, 2, 3].map((n) => {
    const pr = prs.prs.find((p) => p.number === n);
    return { n, title: pr?.title ?? null };
  });
}

if (knowledge?.fences?.length) {
  const retryFence = knowledge.fences.find(
    (f) => f.id === "retry-cap" || /MAX_RETRIES/.test(f.code ?? "")
  );
  const slackCitation = retryFence?.citations?.find((c) => c.type === "slack");
  const linearCitation = retryFence?.citations?.find((c) => c.type === "linear");
  if (slackCitation) {
    slackUrl = slackCitation.url;
    slackTitle = slackCitation.title ?? slackTitle;
  }
  if (linearCitation) {
    linearUrl = linearCitation.url;
    linearTitle = linearCitation.title ?? linearTitle;
  }
}

const [owner, repoName] = repo.split("/");

console.log("=== Chesterton demo -- open these tabs in order ===\n");

let i = 1;
for (const { n, title } of prPages) {
  const url = `${MOCKS_URL}/github/${owner}/${repoName}/pull/${n}/files`;
  console.log(`${i++}. PR ${n}${title ? ` -- ${title}` : ""}\n   ${url}`);
}
console.log(`${i++}. Slack thread -- ${slackTitle}\n   ${slackUrl}`);
console.log(`${i++}. Linear ticket -- ${linearTitle}\n   ${linearUrl}`);
console.log(`${i++}. Dashboard\n   ${DASHBOARD_URL}`);

console.log(
  "\n(If seed/out is missing or stale, these are the known defaults for the " +
    "shipped demo world; run `python seed/seed.py --reset` and re-run this " +
    "script for exact titles.)"
);
