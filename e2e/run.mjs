#!/usr/bin/env node
/**
 * Chesterton end-to-end floor test.
 *
 * Boots the real stack (seed -> mocks -> analyzer -> triage -> verdict ->
 * ledger -> gateway), waits for every /healthz, imports seed/out/knowledge.json
 * into the ledger, fires the three demo PRs through the mock GitHub trigger,
 * and asserts the outcomes documented in docs/contracts.md ("The three demo
 * PRs and expected outcomes").
 *
 * Usage:
 *   node e2e/run.mjs                 # boot, assert, tear down, exit 0/1
 *   node e2e/run.mjs --keep-alive    # on PASS, also boot the dashboard
 *                                    # (vite dev, port 4600) and leave the
 *                                    # whole stack running for the demo
 *
 * Env:
 *   SKIP_LEDGER=1   # don't boot ledger; gateway relies on in-memory fallback
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const isWin = process.platform === "win32";
const KEEP_ALIVE = process.argv.includes("--keep-alive");
const SKIP_LEDGER = process.env.SKIP_LEDGER === "1";

const URLS = {
  gateway: "http://localhost:4000",
  mocks: "http://localhost:4100",
  analyzer: "http://localhost:4200",
  verdict: "http://localhost:4300",
  ledger: "http://localhost:4400",
  triage: "http://localhost:4500",
};
const PORTS = { gateway: 4000, mocks: 4100, analyzer: 4200, verdict: 4300, ledger: 4400, triage: 4500 };

// The dashboard is deliberately NOT part of URLS/PORTS above: it's only
// booted (and only preflight-checked) under --keep-alive, after assertions
// pass -- it must never be part of the assertion phase or a non-keep-alive
// run (scripts/print-tabs.mjs and the README demo script are the only other
// things that know this URL).
const DASHBOARD_URL = "http://localhost:4600";
const DASHBOARD_PORT = 4600;

// ---------------------------------------------------------------- utilities

function log(name, msg) {
  console.log(`[${name}] ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const children = []; // { name, proc }
let shuttingDown = false;
// Exit code used by the SIGINT/SIGTERM handlers below. Stays 1 (interrupted
// mid-run = failure) until the run has fully passed and is blocking in
// --keep-alive mode, at which point Ctrl+C is the expected/successful way
// to end the demo, so it flips to 0.
let interruptExitCode = 1;

function pushTail(tail, data) {
  const lines = data.toString().split(/\r?\n/).filter(Boolean);
  for (const l of lines) {
    tail.push(l);
    if (tail.length > 300) tail.shift();
  }
}

function dumpTail(name, tail, n = 60) {
  console.error(`----- last output from [${name}] -----`);
  for (const l of tail.slice(-n)) console.error(`[${name}] ${l}`);
  console.error(`----- end [${name}] -----`);
}

function registerChild(name, proc) {
  const tail = [];
  proc.stdout?.on("data", (d) => pushTail(tail, d));
  proc.stderr?.on("data", (d) => pushTail(tail, d));
  proc.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`[${name}] exited unexpectedly (code=${code} signal=${signal})`);
      dumpTail(name, tail);
    }
  });
  const entry = { name, proc, tail };
  children.push(entry);
  return entry;
}

/** Removes a tracked child from the cleanup list (e.g. once it has exited
 * normally and no longer needs to be killed on a later failure path). */
function removeChild(entry) {
  const idx = children.indexOf(entry);
  if (idx !== -1) children.splice(idx, 1);
}

function killTree(pid) {
  if (isWin) {
    try {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      /* best effort */
    }
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already dead */
      }
    }
  }
}

function killAll() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { name, proc } of children.slice().reverse()) {
    if (proc.pid && proc.exitCode === null && !proc.killed) {
      log(name, `killing pid ${proc.pid} (tree)`);
      killTree(proc.pid);
    }
  }
}

process.on("exit", killAll);
process.on("SIGINT", () => {
  killAll();
  process.exit(interruptExitCode);
});
process.on("SIGTERM", () => {
  killAll();
  process.exit(interruptExitCode);
});
process.on("uncaughtException", (err) => {
  console.error("uncaught exception:", err);
  killAll();
  process.exit(1);
});

/** Spawns a long-running service process and tracks it for cleanup. */
function spawnService(name, command, args, opts = {}) {
  const proc = spawn(command, args, {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...(opts.env ?? {}) },
    shell: opts.shell ?? false,
    windowsHide: true,
    stdio: "pipe",
  });
  registerChild(name, proc);
  log(name, `spawned pid=${proc.pid} (${command} ${args.join(" ")})`);
  return proc;
}

/**
 * Runs a one-shot build/setup command to completion; rejects on non-zero
 * exit. Tracked in the same `children` cleanup list as long-running
 * services (and removed once it exits normally) so that if it's one of
 * several run in parallel (e.g. the analyzer/verdict builds below) and a
 * *sibling* fails first, killAll() on the resulting failure path also
 * kills this one instead of leaving it to finish (or hang) unsupervised.
 */
function runToCompletion(name, command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    log(name, `running: ${command} ${args.join(" ")}`);
    const proc = spawn(command, args, {
      cwd: opts.cwd ?? ROOT,
      env: { ...process.env, ...(opts.env ?? {}) },
      shell: opts.shell ?? false,
      windowsHide: true,
      stdio: "pipe",
    });
    const entry = { name, proc, tail: [] };
    children.push(entry);
    let out = "";
    proc.stdout?.on("data", (d) => (out += d.toString()));
    proc.stderr?.on("data", (d) => (out += d.toString()));
    proc.on("error", (err) => {
      removeChild(entry);
      reject(err);
    });
    proc.on("exit", (code) => {
      removeChild(entry);
      if (code === 0) {
        resolve(out);
      } else {
        console.error(out);
        reject(new Error(`${name} failed with exit code ${code}`));
      }
    });
  });
}

function checkPortFree(port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const done = (free) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(free);
    };
    sock.setTimeout(300);
    sock.once("connect", () => done(false));
    sock.once("timeout", () => done(true));
    sock.once("error", () => done(true));
    sock.connect(port, "127.0.0.1");
  });
}

async function waitForHealthz(name, url, timeoutMs) {
  const start = Date.now();
  let lastErr = "no attempt made";
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (body && body.ok) {
          log(name, `healthy after ${Date.now() - start}ms`);
          return true;
        }
      }
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await sleep(500);
  }
  log(name, `healthz timeout after ${timeoutMs}ms (last error: ${lastErr})`);
  return false;
}

/**
 * Waits for a plain HTTP 200 on `url` -- for services with no /healthz
 * (e.g. vite's dev server, which returns 200 HTML on `/`). A simple
 * TCP-connect-and-fetch check is enough; there's no JSON body contract to
 * validate like waitForHealthz above.
 */
async function waitForHttp200(name, url, timeoutMs) {
  const start = Date.now();
  let lastErr = "no attempt made";
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        log(name, `responding (HTTP ${res.status}) after ${Date.now() - start}ms`);
        return true;
      }
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await sleep(500);
  }
  log(name, `HTTP 200 wait timeout after ${timeoutMs}ms (last error: ${lastErr})`);
  return false;
}

/**
 * Resolves the triage service's Python interpreter. Prefers the project's
 * own venv (triage/.venv) -- Scripts/python.exe on Windows, bin/python
 * elsewhere -- and falls back to the system interpreter (with a clear log
 * line) if that venv hasn't been created yet, so a fresh clone that has run
 * `pip install -r triage/requirements.txt` into a system/other interpreter
 * (per README "First-time setup") can still boot triage.
 */
function resolveTriagePython() {
  const venvPython = path.join(ROOT, "triage", ".venv", isWin ? "Scripts" : "bin", isWin ? "python.exe" : "python");
  if (fs.existsSync(venvPython)) return venvPython;
  const fallback = isWin ? "python" : "python3";
  log(
    "triage",
    `no venv interpreter found at ${venvPython}; falling back to system "${fallback}" on PATH ` +
      `(create the venv with: python -m venv triage/.venv && triage/.venv/${isWin ? "Scripts" : "bin"}/pip install -r triage/requirements.txt)`
  );
  return fallback;
}

// ---------------------------------------------------------------- results

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  const tag = pass ? "PASS" : "FAIL";
  console.log(`${tag} - ${name}${detail ? ": " + detail : ""}`);
}

/** Records an informational line that is NOT counted in the pass/fail tally
 * (e.g. a step intentionally skipped via SKIP_LEDGER=1, as opposed to a step
 * that was supposed to run and didn't). */
function recordSkip(name, detail) {
  results.push({ name, pass: true, detail, skip: true });
  console.log(`SKIP - ${name}${detail ? ": " + detail : ""}`);
}

// ---------------------------------------------------------------- main

async function main() {
  console.log("=== Chesterton e2e floor test ===");
  console.log(`root: ${ROOT}`);
  if (SKIP_LEDGER) console.log("SKIP_LEDGER=1: ledger will not be booted, gateway falls back to its in-memory cache.");

  // --- preflight: ports must be free, never kill unknown processes ---
  const activePorts = SKIP_LEDGER ? Object.entries(PORTS).filter(([n]) => n !== "ledger") : Object.entries(PORTS);
  if (KEEP_ALIVE) activePorts.push(["dashboard", DASHBOARD_PORT]);
  for (const [name, port] of activePorts) {
    const free = await checkPortFree(port);
    if (!free) {
      console.error(
        `Port ${port} (${name}) is already in use by another process. Refusing to proceed ` +
          `(will not kill unknown processes). Free the port and re-run.`
      );
      process.exitCode = 1;
      return;
    }
  }
  log("preflight", "all required ports are free");

  // --- seed ---
  await runToCompletion("seed", "python", ["seed/seed.py", "--reset"], { cwd: ROOT });
  log("seed", "seed/out regenerated");

  const knowledge = JSON.parse(fs.readFileSync(path.join(ROOT, "seed/out/knowledge.json"), "utf8"));
  const prs = JSON.parse(fs.readFileSync(path.join(ROOT, "seed/out/prs.json"), "utf8"));
  const repo = knowledge.repo; // e.g. "acme/storefront" -- read from seed output, not hardcoded.
  const [owner, repoName] = repo.split("/");
  const shaByPr = new Map(prs.prs.map((p) => [p.number, p.head_sha]));
  log("seed", `repo=${repo} prs=${[...shaByPr.keys()].slice(0, 3).join(",")}`);

  // --- build native binaries once, up front (avoids `cargo run`/`go run`
  // wrapper processes that complicate cleanup) ---
  await Promise.all([
    runToCompletion("analyzer-build", "cargo", ["build", "--release"], { cwd: path.join(ROOT, "diff-analyzer") }),
    runToCompletion("verdict-build", "go", ["build", "-o", isWin ? "verdict_e2e.exe" : "verdict_e2e", "."], {
      cwd: path.join(ROOT, "verdict"),
    }),
  ]);

  // --- boot order: start the slowest (ledger) first, then everything else
  // in parallel where there's no startup dependency ---
  let ledgerUp = false;
  if (!SKIP_LEDGER) {
    const mvnCmd = path.join(ROOT, "ledger", isWin ? "mvnw.cmd" : "mvnw");
    spawnService("ledger", isWin ? "cmd.exe" : mvnCmd, isWin ? ["/c", mvnCmd, "-q", "spring-boot:run"] : ["-q", "spring-boot:run"], {
      cwd: path.join(ROOT, "ledger"),
    });
  }

  spawnService("mocks", isWin ? "npx.cmd" : "npx", ["tsx", "src/index.ts"], {
    cwd: path.join(ROOT, "mocks"),
    env: { PORT: "4100", GATEWAY_URL: URLS.gateway, GITHUB_WEBHOOK_SECRET: "devsecret" },
    shell: isWin,
  });

  spawnService("triage", resolveTriagePython(), ["app.py"], {
    cwd: path.join(ROOT, "triage"),
    env: { PORT: "4500" },
  });

  spawnService(
    "analyzer",
    path.join(ROOT, "diff-analyzer", "target", "release", isWin ? "diff-analyzer.exe" : "diff-analyzer"),
    [],
    { cwd: path.join(ROOT, "diff-analyzer"), env: { PORT: "4200" } }
  );

  const [mocksUp, triageUp, analyzerUp] = await Promise.all([
    waitForHealthz("mocks", URLS.mocks, 20000),
    waitForHealthz("triage", URLS.triage, 20000),
    waitForHealthz("analyzer", URLS.analyzer, 20000),
  ]);
  if (!mocksUp || !triageUp || !analyzerUp) throw new Error("one or more base services failed to become healthy");

  spawnService("verdict", path.join(ROOT, "verdict", isWin ? "verdict_e2e.exe" : "./verdict_e2e"), [], {
    cwd: path.join(ROOT, "verdict"),
    env: {
      PORT: "4300",
      ESTELLE_URL: `${URLS.mocks}/estelle`,
      GITHUB_API_URL: `${URLS.mocks}/github/api`,
      LEDGER_URL: URLS.ledger,
    },
  });
  if (!(await waitForHealthz("verdict", URLS.verdict, 15000))) throw new Error("verdict failed to become healthy");

  spawnService("gateway", isWin ? "npx.cmd" : "npx", ["tsx", "src/index.ts"], {
    cwd: path.join(ROOT, "gateway"),
    env: {
      PORT: "4000",
      ANALYZER_URL: URLS.analyzer,
      TRIAGE_URL: URLS.triage,
      VERDICT_URL: URLS.verdict,
      LEDGER_URL: URLS.ledger,
      GITHUB_API_URL: `${URLS.mocks}/github/api`,
      GITHUB_WEBHOOK_SECRET: "devsecret",
    },
    shell: isWin,
  });
  if (!(await waitForHealthz("gateway", URLS.gateway, 15000))) throw new Error("gateway failed to become healthy");

  if (!SKIP_LEDGER) {
    ledgerUp = await waitForHealthz("ledger", URLS.ledger, 150000);
  }

  // --- import knowledge into the ledger ---
  if (ledgerUp) {
    try {
      const res = await fetch(`${URLS.ledger}/decisions/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(knowledge),
      });
      const body = await res.json().catch(() => null);
      record("ledger import knowledge.json", res.ok, `HTTP ${res.status} ${JSON.stringify(body)}`);
    } catch (err) {
      record("ledger import knowledge.json", false, err instanceof Error ? err.message : String(err));
    }
  } else if (SKIP_LEDGER) {
    // Intentionally skipped (not a failure): the ledger was never asked to
    // boot in this mode, so there's nothing to import into and gateway is
    // expected to run on its in-memory fallback. Excluded from the
    // pass/fail tally so SKIP_LEDGER=1 can still exit 0.
    recordSkip("ledger import knowledge.json", "SKIP_LEDGER=1: ledger intentionally not booted");
  } else {
    // The ledger WAS supposed to come up (SKIP_LEDGER not set) but didn't
    // (boot timeout) -- that's a real failure, not a skip.
    record("ledger import knowledge.json", false, "ledger failed to become healthy within the boot timeout");
  }

  // --- helpers against the running stack ---
  async function triggerPr(prNumber) {
    const url = `${URLS.mocks}/github/trigger/pr?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repoName)}&pr=${prNumber}`;
    const res = await fetch(url, { method: "POST" });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }

  async function getVerdicts(prNumber) {
    const res = await fetch(`${URLS.gateway}/verdicts?repo=${encodeURIComponent(repo)}&pr=${prNumber}`);
    if (!res.ok) throw new Error(`GET /verdicts?pr=${prNumber} -> HTTP ${res.status}`);
    const body = await res.json();
    return body.flags ?? [];
  }

  async function getCheckRuns(headSha) {
    const res = await fetch(`${URLS.mocks}/github/api/repos/${owner}/${repoName}/commits/${headSha}/check-runs`);
    if (!res.ok) throw new Error(`GET check-runs -> HTTP ${res.status}`);
    const body = await res.json();
    return body.check_runs ?? [];
  }

  // --- PR1: retry-cap removal -> 1 contradiction flag, 3 citations, action_required ---
  const t1 = await triggerPr(1);
  record("PR1 trigger accepted by gateway", t1.status === 200 && t1.body?.ok === true, JSON.stringify(t1.body));

  const flags1 = await getVerdicts(1);
  record("PR1 exactly 1 flag", flags1.length === 1, `got ${flags1.length}: ${JSON.stringify(flags1.map((f) => f.kind))}`);
  const f1 = flags1[0];
  record("PR1 flag kind=contradiction", f1?.kind === "contradiction", `got ${f1?.kind}`);
  record("PR1 flag has 3 citations", f1?.citations?.length === 3, `got ${f1?.citations?.length}`);

  const cr1 = await getCheckRuns(shaByPr.get(1));
  const lastCr1 = cr1[cr1.length - 1];
  record("PR1 check run conclusion=action_required", lastCr1?.conclusion === "action_required", `got ${lastCr1?.conclusion}`);

  // --- PR2: harmless rename -> 0 flags, neutral check run ---
  const t2 = await triggerPr(2);
  record("PR2 trigger accepted by gateway", t2.status === 200 && t2.body?.ok === true, JSON.stringify(t2.body));

  const flags2 = await getVerdicts(2);
  record("PR2 exactly 0 flags", flags2.length === 0, `got ${flags2.length}`);

  const cr2 = await getCheckRuns(shaByPr.get(2));
  const lastCr2 = cr2[cr2.length - 1];
  record("PR2 check run conclusion=neutral", lastCr2?.conclusion === "neutral", `got ${lastCr2?.conclusion}`);

  // --- PR3: timeout change w/ stale comment -> 1 stale_comment flag, no contradiction ---
  const t3 = await triggerPr(3);
  record("PR3 trigger accepted by gateway", t3.status === 200 && t3.body?.ok === true, JSON.stringify(t3.body));

  const flags3 = await getVerdicts(3);
  const kinds3 = flags3.map((f) => f.kind);
  record(
    "PR3 exactly 1 stale_comment flag",
    kinds3.filter((k) => k === "stale_comment").length === 1,
    `got kinds=${JSON.stringify(kinds3)}`
  );
  record("PR3 no contradiction flag", kinds3.filter((k) => k === "contradiction").length === 0, `got kinds=${JSON.stringify(kinds3)}`);

  // --- Re-fire PR1: cache determinism -> byte-identical flag JSON ---
  const firstJson = JSON.stringify(flags1);
  const tRefire = await triggerPr(1);
  record("PR1 re-fire accepted by gateway", tRefire.status === 200 && tRefire.body?.ok === true, JSON.stringify(tRefire.body));
  const flags1b = await getVerdicts(1);
  const secondJson = JSON.stringify(flags1b);
  record(
    "PR1 re-fire flag JSON byte-identical (cache determinism)",
    firstJson === secondJson,
    firstJson === secondJson ? "identical" : `first=${firstJson}\n  second=${secondJson}`
  );

  // --- summary ---
  console.log("\n=== SUMMARY ===");
  for (const r of results) {
    console.log(`${r.skip ? "SKIP" : r.pass ? "PASS" : "FAIL"} - ${r.name}`);
  }
  // SKIP entries (e.g. "ledger import knowledge.json" under SKIP_LEDGER=1)
  // are informational and excluded from the tally entirely -- they are
  // neither a pass nor a fail -- so SKIP_LEDGER mode can still exit 0.
  const tallied = results.filter((r) => !r.skip);
  const failed = tallied.filter((r) => !r.pass);
  console.log(`\n${tallied.length - failed.length}/${tallied.length} assertions passed.`);

  if (failed.length === 0) {
    console.log("\nALL GREEN.");
    if (KEEP_ALIVE) {
      // Controller ruling (final-review fix wave): the dashboard is only
      // booted here, on PASS, under --keep-alive -- never during the
      // assertion phase and never on a plain (non-keep-alive) run, since
      // nothing above this line depends on it.
      console.log("\n--keep-alive: booting the dashboard (vite dev, port 4600) for the demo...");
      spawnService("dashboard", isWin ? "npm.cmd" : "npm", ["run", "dev"], {
        cwd: path.join(ROOT, "dashboard"),
        env: { VITE_GATEWAY_URL: URLS.gateway },
        shell: isWin,
      });
      const dashboardUp = await waitForHttp200("dashboard", DASHBOARD_URL, 30000);
      if (!dashboardUp) {
        console.error(`dashboard did not respond on ${DASHBOARD_URL} within 30s -- it will be omitted below, but is still running/retrying; check its log output above.`);
      }

      console.log("\n--keep-alive: leaving the stack running. URLs:");
      for (const [name, url] of Object.entries(URLS)) {
        if (name === "ledger" && !ledgerUp) continue;
        console.log(`  ${name.padEnd(9)} ${url}`);
      }
      if (dashboardUp) {
        console.log(`  ${"dashboard".padEnd(9)} ${DASHBOARD_URL}`);
      }
      console.log("\nPress Ctrl+C to stop all services.");
      // The run passed and we're now just holding the stack up for the
      // demo -- Ctrl+C from here is the expected, successful way to end
      // it, so it should exit 0, not the default "interrupted" exit 1.
      interruptExitCode = 0;
      await new Promise(() => {}); // block forever until SIGINT/SIGTERM
      return;
    }
    killAll();
    process.exit(0);
  } else {
    console.log(`\n${failed.length} assertion(s) FAILED.`);
    killAll();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\ne2e run crashed:", err instanceof Error ? err.stack ?? err.message : err);
  console.log("\n=== SUMMARY (partial -- run crashed before completing) ===");
  for (const r of results) {
    console.log(`${r.skip ? "SKIP" : r.pass ? "PASS" : "FAIL"} - ${r.name}`);
  }
  killAll();
  process.exit(1);
});
