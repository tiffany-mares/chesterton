# Chesterton — Adapted Implementation Plan

Derived from `build_plan.md` / `outline.md`, adapted for this environment:
no external credentials are available, so everything runs in **mock mode**
(see `docs/contracts.md`); real-API code paths exist behind env config but are
untested. Docker daemon not running; services must run bare-metal with
in-memory/file fallbacks for Redis/Mongo/Postgres.

## Global Constraints

- Windows dev machine. All scripts/tests must run on Windows (Git Bash available). No `make` assumed.
- Every service conforms to `docs/contracts.md` exactly — ports, env vars, JSON shapes, hash formula.
- Deterministic verdicts: same input → byte-identical verdict JSON (the demo's reliability point).
- Silence without evidence: never flag without `verdict==YES` + ≥1 citation + anchor overlap.
- Toolchain: Node 22, Rust 1.98 (cargo), Go 1.26, Java 26 (no system Maven — use wrapper), Python 3.13.
- Each service exposes `GET /healthz`.
- TDD per superpowers:test-driven-development. Commit per task with a descriptive message.
- No external network calls in tests (mocks/fixtures only). Exception: dependency installs.

## Task 1: Scaffold (done by controller)

Repo layout, docs, .gitignore, .env.example. Already complete.

## Task 2: Seed the demo world (`seed/`, Python)

Build `seed/` exactly per the "Seed outputs" section of `docs/contracts.md` (read it first).

- `seed/fences.yaml`: declarative config for every fence. 3 full demo fences (retry-cap in
  `services/payments/client.py`, idempotency-key check in `services/checkout/api.py`,
  inventory oversell guard in `services/inventory/stock.py`) + 15 lighter fences spread
  unevenly: ~6 in payments, ~5 in checkout, ~2 in inventory, ~2 in a `services/shared/` util.
  Each fence: `id, file, code (the exact guarded line), summary, slack (list of [user, text]),
  linear ({key, title}), pr ({title, author})`. The retry-cap fence must match the example in
  build_plan.md (Person 1/Person 2 dialogue, ENG-212).
- `seed/seed.py` (CLI, `python seed.py [--reset] [--out seed/out]`):
  1. Generates the storefront demo repo at `seed/out/demo-repo` — a plausible small Python
     codebase (~8-12 files across checkout/payments/inventory/shared) where every fence's
     `code` line actually appears. Creates it as a real git repo with backdated commits
     (GIT_AUTHOR_DATE/GIT_COMMITTER_DATE, several fake authors incl. Person 1 and Person 2): an
     initial scaffold commit, then one "fix" commit per fence (message references the Linear
     key, e.g. "Cap payment retries (fixes ENG-212)").
  2. Creates the three demo branches with exactly the changes specified in contracts.md
     ("demo PRs and expected outcomes"), writes `prs/{n}.diff` via `git diff main...branch`
     and `prs.json` with real head SHAs.
  3. Writes `knowledge.json` with each fence's resolved current line anchor (find the `code`
     line's line number in the file on main) and citations whose URLs point at
     `{MOCKS_BASE_URL or http://localhost:4100}` mock pages (slack/linear) and the demo PR page.
  4. Writes `slack.json` and `linear.json` from fences.yaml.
  5. `--reset` deletes `seed/out` first. Running twice without --reset errors cleanly.
  6. Deterministic: fixed dates, fixed ordering (so head SHAs are stable across runs on the
     same machine given same git version — best effort; tests must not assert exact SHAs).
- Optional real mode (untested, keep thin, clearly marked): if `SLACK_BOT_TOKEN` /
  `LINEAR_API_KEY` env vars set, post threads / create tickets via their REST APIs and use
  the returned URLs in knowledge.json. Guard with try/except and clear log lines.
- Dependencies: `pyyaml` only (requirements.txt). Use subprocess for git.
- Tests (pytest, `seed/tests/`): run seed into a tmp dir; assert demo-repo exists with 3
  branches; every fence code line present in its file; knowledge.json anchors point at the
  right lines; the 3 diffs contain the expected changes; timeout PR's comment line intact.

Done when: pytest passes; `python seed/seed.py --reset` runs clean and
`seed/out/knowledge.json` answers "where is the retry cap fence" correctly.

## Task 3: Mock external services (`mocks/`, Node + TypeScript)

Implement the whole `mocks/` service per contracts.md sections: Estelle emulation, GitHub API
emulation, demo trigger & pages. Read `docs/contracts.md` first — it is the spec.

- Express (or Fastify) + TypeScript, port 4100, `npm run dev` (tsx) and `npm test` (vitest + supertest).
- Loads `seed/out/knowledge.json`, `slack.json`, `linear.json`, `prs.json` at startup
  (paths from env `SEED_OUT_DIR`, default `../seed/out` relative to mocks/).
- Estelle `/v1/ask` mock logic (deterministic): find fences where `hunk.file == fence.file`
  AND old-line range overlaps `[fence.line_start, fence.line_end]`. If a matching fence's
  `code` appears in `old_lines` but NOT in `new_lines` → verdict YES, reason template
  `"<code> exists because: <summary>. This change removes or alters it."`, citations =
  fence.citations. If fence matches but code unchanged in new_lines → NO. No matching
  fence → NO_EVIDENCE with empty citations. Sort object keys / citations stably.
- `/v1/stale`: stale=true iff the comment text contains a number or value that appears in
  `old_lines` but not in `new_lines` (e.g. comment says "30" and 30 was removed). Citations:
  any fence overlapping the comment's line, else empty.
- GitHub API mock per contracts.md: pulls (JSON + `.diff` via Accept header, diff text read
  from `seed/out/prs/{n}.diff`), check-runs (in-memory store), review comments (in-memory).
- `POST /github/trigger/pr` per contracts.md: constructs a minimal `pull_request` webhook
  payload `{action:"synchronize", number, repository:{full_name}, pull_request:{number,
  head:{sha}, base:{ref}}}`, signs body with HMAC-SHA256 `sha256=<hex>` using
  `GITHUB_WEBHOOK_SECRET` (default `devsecret`), POSTs to `{GATEWAY_URL}/webhooks/github`.
- HTML pages (server-rendered, simple but presentable, inline CSS, no CDN):
  - PR files page `/github/{owner}/{repo}/pull/{n}/files`: renders the unified diff as a
    GitHub-like two-column table. MUST use the DOM contract from contracts.md:
    each file in `<div class="file" data-tagsearch-path="<path>">` with a
    `.file-header[data-path]`, lines in `<tr>` with `td.blob-num[data-line-number]` and
    addition rows marked `.blob-num-addition` on the new-side cell. Include the repo name,
    PR title, branch names in the header.
  - Slack thread page `/slack/archives/{channel}/p{ts}`: dark sidebar aesthetic, messages
    with avatars (initials), usernames, timestamps.
  - Linear ticket page `/linear/issue/{KEY}`: title, status chip, description.
- Tests: Estelle ask YES/NO/NO_EVIDENCE cases against a fixture knowledge.json; determinism
  (two identical asks → identical JSON string); diff endpoint content-type switch; trigger
  signs correctly (spin a tiny receiver in the test and verify HMAC); PR files page contains
  the DOM-contract selectors.

Done when: `npm test` passes; with real seed output present, `curl /estelle/v1/ask` for the
retry-cap hunk returns YES with 3 citations.

## Task 4: Rust diff analyzer (`diff-analyzer/`)

Per contracts.md "diff-analyzer" section. Rust, axum, port 4200.

- Parse unified diffs (write the parser by hand or use the `unidiff`/`patch` crate — your
  call; hand-rolled is fine and dependency-light). Split each @@ hunk into minimal change
  runs: a maximal run of consecutive `-`/`+` lines (with no interleaved context line) is one
  Hunk; context lines break runs. Compute old/new ranges per contracts.md (0/0 conventions).
- `hunk_hash`: EXACTLY the formula in contracts.md (sha256 hex, first 16 chars). Use the
  `sha2` crate.
- `symbol`: nearest enclosing function/class found by scanning the diff's context lines and,
  when insufficient, a regex heuristic over preceding lines for `def |class |fn |func |function |public .*\(`.
  Best-effort; `""` when unknown. Do NOT add tree-sitter (keep build light).
- `POST /remap` per contracts.md: apply the diff's line offsets to anchors; an anchor is
  `alive:false` if any of its lines were deleted without replacement.
- Unit tests for: single-line modification, pure addition, pure deletion, multi-run hunk,
  hash stability (assert one known hash computed from the formula), remap shift and kill.
  Integration test for the HTTP layer (axum + `tower::ServiceExt::oneshot`).

Done when: `cargo test` passes; POSTing the seeded PR-1 diff returns one hunk for
`services/payments/client.py` with old_lines `["MAX_RETRIES = 3"]`.

## Task 5: Python triage service (`triage/`)

Per contracts.md "triage" section. FastAPI + uvicorn, port 4500.

- Rules-based scorer (primary, always on). Score in [0,1], sum of signals capped at 1.0:
  - removed/weakened conditional (`-` line matches `if |elif |guard|raise|return` and no
    equivalent `+` line): +0.6, reason `removed_conditional`
  - numeric constant changed (same identifier, different number between old/new): +0.5,
    `changed_numeric_constant`
  - retry/timeout/limit/cap keyword in removed lines: +0.4, `removed_retry_or_timeout`
  - removed try/except/catch/error handling: +0.5, `removed_error_handling`
  - comment-only change: score 0.0 regardless, reason `comment_only_change`
  - pure rename (old/new identical after identifier-level diff — keep simple: identical
    when numbers and strings match and only identifiers differ): −0.5 floor at 0, `rename_only`
- `POST /score` per contracts.md. Keep model optional: `triage/train_torch.py` trains a tiny
  MLP on rule-labelled hunks ONLY if torch is importable; `requirements.txt` must NOT include
  torch (`requirements-ml.txt` does). Service uses the model iff `MODEL_PATH` env set and
  loadable, else rules. Document in `triage/README.md`.
- Tests (pytest + httpx/TestClient): each rule fires on a crafted hunk; refactor hunk scores
  < 0.5; retry-cap hunk scores ≥ 0.5; response shape matches contract.

Done when: pytest passes; retry-cap hunk ≥ 0.5, rename hunk < 0.5.

## Task 6: Go verdict service (`verdict/`)

Per contracts.md "verdict" section. Go, net/http (or chi), port 4300.

- `POST /judge` exactly per contract. Per-hunk Estelle calls with `errgroup` bounded to 4.
- Strictness: flag only if YES + ≥1 citation + citation anchor overlaps hunk old-range.
  (Citations carry no anchor fields from Estelle — strictness check uses the decision anchors:
  ask Estelle, then verify overlap using `line_start/line_end` IF present on a citation;
  citations without anchors count as overlapping. Keep this lenient rule documented.)
- Stale comments: for each entry in `comments[]`, call `/v1/stale`; stale=true → Flag with
  kind `stale_comment`, line = comment_line.
- Cache: `REDIS_URL` via go-redis if reachable at startup, else in-process map (log which).
  Key `repo:head_sha:hunk_hash` (and `:stale:<line>` for stale checks); value = stored flag
  JSON (or sentinel for no-flag). Cache hit skips Estelle and returns identical JSON.
- Ledger persistence: `POST {LEDGER_URL}/verdicts` per flag AND per no-flag hunk (verdict
  NO/NO_EVIDENCE with null decision). If ledger unreachable, log and continue (do not fail
  the judge call) — flags are still returned and the check run still posts.
- Check run: POST to `{GITHUB_API_URL}/repos/{repo}/check-runs`, name `Chesterton`,
  conclusion `neutral` (no flags) / `action_required` (any flag), summary = markdown list:
  one bullet per flag: `**file:line** — reason` + citation links.
- Tests (httptest servers for Estelle/ledger/github): flagged hunk produces flag + check run
  `action_required`; NO_EVIDENCE produces no flag + `neutral`; cache hit does not re-call
  Estelle (count calls); bounded concurrency (no assertion needed, just use errgroup).

Done when: `go test ./...` passes.

## Task 7: Node gateway (`gateway/`)

Per contracts.md "gateway" section. Express/Fastify + TypeScript, port 4000, vitest tests.

- `POST /webhooks/github`: raw-body HMAC verify (`X-Hub-Signature-256`, timing-safe compare);
  reject 401 on bad sig. Store raw payload: Mongo if `MONGO_URL` connects within 1s at
  startup, else append JSON files under `gateway/data/raw-events/` (gitignored). On
  pull_request opened/synchronize: fetch diff (`GITHUB_API_URL`, Accept diff header) →
  analyzer `/analyze` → triage `/score` → filter ≥ 0.5 → extract adjacent comments for stale
  checks (a changed hunk whose old context includes a line starting with a comment leader
  directly above the hunk — fetch the new file content? Keep simple: scan the DIFF text for
  comment lines within 2 lines above a change in the same @@ block; include as `comments[]`)
  → verdict `/judge`. Return `{"flags": N}`.
- `GET /verdicts?repo=&pr=`: read ledger `GET /verdicts`, return `{"flags": [payload...]}`
  with dismissed/overridden status applied. If ledger down, serve from an in-memory copy of
  the last judge response (keep a small LRU) so the demo never 500s.
- `POST /flags/{id}/dismiss`, `POST /overrides`, `POST /plaque`, `GET /fences/by-file`,
  `GET /stats` per contracts.md. Plaque comment-leader table per contract.
- CORS allow-all. `GET /healthz`.
- Tests: signature verify (valid/invalid); webhook happy path with all downstream services
  stubbed via nock/undici MockAgent (assert the pipeline order and the filter); verdicts
  endpoint merges overrides; plaque builds the right suggestion body for a .py file.

Done when: `npm test` passes.

## Task 8: Spring Boot ledger (`ledger/`)

Per contracts.md "ledger" section. Spring Boot 3 (Java 21+ toolchain syntax OK on 26),
Maven WRAPPER committed (`mvnw`, `mvnw.cmd`, `.mvn/wrapper/`) so no system Maven needed.
Generate the project skeleton from `https://start.spring.io` (curl the zip:
`curl "https://start.spring.io/starter.zip?type=maven-project&language=java&bootVersion=3.4.1&javaVersion=21&dependencies=web,data-jpa,postgresql,h2" -o starter.zip`)
or hand-write the pom — your call, wrapper must work offline after first run.

- Entities/tables exactly per the SQL in build_plan.md Phase 5 (decision, verdict, override),
  JSONB columns as `TEXT` holding JSON when on H2 (profile-dependent column type is fine).
- Profiles: default = H2 in-memory (so `./mvnw test` and bare-metal dev need no Postgres);
  `postgres` profile uses `DATABASE_URL`.
- REST endpoints exactly per contracts.md, incl. the override side effect (new decision row
  anchored to the overridden verdict's file/lines, source `override`) and `/fences/by-file`
  (GROUP BY file over decision). `/stats` per contract.
- Seed import: `POST /decisions/import` accepting the whole `knowledge.json` (repo + fences
  array), inserting one decision per fence (source `seed`). The demo script uses this.
- Port 4400 (`server.port=4400`).
- Tests: MockMvc/WebTestClient tests for each endpoint, upsert behavior on verdicts unique
  key, override side effect, by-file aggregation.

Done when: `./mvnw -q test` passes on H2.

## Task 9: Browser extension (`extension/`, TypeScript MV3)

Per contracts.md "extension" section.

- MV3 `manifest.json`: content script on both match patterns from the contract; permissions
  `storage`; host permissions for `http://localhost:4000/*` (gateway) and `http://localhost:4100/*`.
- Source TS compiled with esbuild (`npm run build` → `extension/dist/` loadable unpacked).
- Content script: parse owner/repo/pr from URL; fetch flags from gateway; for each flag find
  the file container + line cell per the DOM contract; inject a flag card (shadow DOM or
  scoped class names, inline styles, amber left border, "⚠ Chesterton" header, reason text,
  citation links opening in new tab, buttons Dismiss / Override… / Pin reason wired to the
  gateway endpoints per contract). Re-scan on MutationObserver (debounced 500ms) for GitHub
  PJAX navigation. If a flag's line isn't found, append the card to the file header instead
  (never lose a flag silently).
- Options page (simple HTML) to set gateway URL into `chrome.storage.sync`.
- Pure logic (URL parsing, flag→row matching given a DOM snapshot, card HTML building) in
  `src/lib.ts`, tested with vitest + jsdom against a fixture of the mock PR-files page DOM
  (copy the structure the mocks service renders). No browser needed for tests.

Done when: `npm test` + `npm run build` pass; `dist/` loads as unpacked extension without errors.

## Task 10: React dashboard (`dashboard/`)

Per contracts.md + outline "Fence map". Vite + React + TS, served on 4600 (`npm run dev`),
`npm run build` works. Read the dataviz guidance: greyscale treemap per the outline.

- Views (tabs or simple router): Fence Map, Verdicts, Overrides, Stats.
- Fence map: `GET {GATEWAY_URL}/fences/by-file` → treemap via `d3-hierarchy` (tile area ∝
  max(loc,1), fill = greyscale shade scaled by fence_count, min-contrast labels). Click a
  tile → side panel lists that file's fences with citations (needs `GET /decisions?repo=&file=`
  — add a gateway proxy for it if missing: flag to controller instead of hacking).
- Verdicts view: table of flags (file, line, kind, verdict, reason, citations, status).
- Overrides view: table from `/overrides`. Stats view: big-number tiles from `/stats`.
- `GATEWAY_URL` from `VITE_GATEWAY_URL` env, default `http://localhost:4000`. Repo selector
  defaults to `acme/storefront`.
- Tests: vitest for the treemap layout helper (data → rectangles) and the shade scale;
  smoke-render App with fetch mocked.

Done when: `npm test` and `npm run build` pass.

## Task 11: End-to-end floor test (`e2e/`)

The plan's "floor", verified: webhook → gateway → analyzer → triage → verdict → Estelle(mock)
→ check run + ledger + flags.

- `e2e/run.mjs` (Node, no deps beyond what's in repo): boots seed (`python seed/seed.py --reset`),
  then starts mocks, analyzer (cargo run --release or debug), triage (uvicorn), verdict (go run),
  gateway, ledger (`./mvnw spring-boot:run` — if boot takes too long, allow `SKIP_LEDGER=1`
  mode where gateway uses its in-memory fallback) — waits for all /healthz.
- Imports knowledge into ledger (`POST /decisions/import`) when ledger is up.
- Fires `POST {MOCKS_URL}/github/trigger/pr` for PRs 1–3 and asserts via gateway `/verdicts`
  and mock check-runs endpoint, exactly the expected outcomes listed at the bottom of
  contracts.md (PR1: 1 contradiction flag w/ 3 citations + action_required; PR2: 0 flags +
  neutral; PR3: 1 stale_comment flag). Re-fires PR1 and asserts the returned flag JSON is
  byte-identical (determinism/cache).
- Kills all children on exit (also on failure). Prints a clear PASS/FAIL summary.
- Wire as `npm run e2e` at repo root (root package.json with workspaces optional — a plain
  script is fine).

Done when: `node e2e/run.mjs` prints PASS for all assertions on this machine.

## Task 12: Infra, CI, README, demo script

- `infra/docker-compose.yml`: postgres, redis, mongo + every service built from per-service
  Dockerfiles (write simple multi-stage Dockerfiles for gateway, mocks, analyzer, verdict,
  triage, ledger, dashboard). Compose must be syntactically valid (`docker compose config`)
  — daemon may be down, so building is not required for done.
- `.github/workflows/ci.yml`: jobs per service (node test ×3, cargo test, go test, pytest ×2,
  mvnw test), triggered on push/PR. Use setup actions with caches.
- Root `README.md`: what Chesterton is (from outline one-liner), architecture table, quickstart
  (bare-metal: the e2e script; docker: compose up), mock vs real mode, how to load the
  extension, demo script (the 8 beats from the outline), cut/risk notes, credential setup for
  real mode (GitHub App, Slack, Linear, Estelle) as a checklist for the human.
- `scripts/demo.ps1` + `scripts/demo.sh`: start everything (reuse e2e boot logic or document
  `node e2e/run.mjs --keep-alive` — add that flag in task 11 or here), open browser tabs
  (PR files page on mocks, slack thread, linear ticket, dashboard).

Done when: compose config validates, CI yaml lints (actionlint not required — YAML parse is
enough), README accurate, demo script starts the stack with `--keep-alive`.
