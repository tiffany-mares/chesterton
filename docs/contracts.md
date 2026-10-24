# Chesterton — Shared Contracts

Single source of truth for ports, env vars, and JSON contracts between services.
Every service MUST conform to this document. If a task needs to change a contract,
it must be flagged to the controller, not changed unilaterally.

## Modes

`CHESTERTON_MODE=mock` (default) — all external systems (Estelle, GitHub, Slack, Linear)
are emulated by the local `mocks/` service. `CHESTERTON_MODE=real` switches base URLs to
the real APIs (credentials via env). All services are written against the same HTTP
contracts in both modes.

## Ports and base URLs (local dev)

| Service        | Port | Env var for others to reach it            |
|----------------|------|-------------------------------------------|
| gateway (Node) | 4000 | `GATEWAY_URL=http://localhost:4000`       |
| mocks (Node)   | 4100 | `MOCKS_URL=http://localhost:4100`         |
| diff-analyzer (Rust) | 4200 | `ANALYZER_URL=http://localhost:4200` |
| verdict (Go)   | 4300 | `VERDICT_URL=http://localhost:4300`       |
| ledger (Spring)| 4400 | `LEDGER_URL=http://localhost:4400`        |
| triage (Python)| 4500 | `TRIAGE_URL=http://localhost:4500`        |
| dashboard (React)| 4600 | served statically / vite dev            |

External-system URLs (mock defaults):

- `ESTELLE_URL=http://localhost:4100/estelle`  (real: provided by Fate Labs)
- `GITHUB_API_URL=http://localhost:4100/github/api`  (real: `https://api.github.com`)
- `GITHUB_WEBHOOK_SECRET=devsecret`
- `REDIS_URL=redis://localhost:6379` (optional — services fall back to in-memory)
- `DATABASE_URL=postgres://chesterton:chesterton@localhost:5432/chesterton` (ledger; H2 fallback)
- `MONGO_URL=mongodb://localhost:27017/chesterton` (optional — gateway falls back to file storage under `gateway/data/raw-events/`)

Every HTTP service exposes `GET /healthz` → `200 {"ok":true,"service":"<name>"}`.

## Core JSON shapes

### Hunk (produced by diff-analyzer)

```json
{
  "file": "services/payments/client.py",
  "old_start": 10, "old_end": 12,
  "new_start": 10, "new_end": 12,
  "old_lines": ["MAX_RETRIES = 3"],
  "new_lines": ["MAX_RETRIES = 50"],
  "symbol": "charge",
  "hunk_hash": "9f2c1a0b4d6e8f10"
}
```

- `old_start`/`old_end`: 1-based inclusive line range in the OLD file (0/0 for pure additions).
- `new_start`/`new_end`: same for the NEW file (0/0 for pure deletions).
- `symbol`: nearest enclosing function/class name, or `""` if none found.
- `hunk_hash`: first 16 hex chars of sha256 over `file + "\n" + old_lines joined + "\n=>\n" + new_lines joined` (exact: `sha256(file + "\n" + old_lines.join("\n") + "\n=>\n" + new_lines.join("\n"))[:16]`).

### Citation

```json
{"type": "slack", "url": "http://localhost:4100/slack/archives/oncall/p1700000001", "title": "#oncall: payment retries incident"}
```

`type` ∈ `slack | linear | pr | override`.

### Verdict (Estelle answer / stored verdict payload)

```json
{
  "verdict": "YES",
  "reason": "MAX_RETRIES=3 was set to cap payment retries after incident ENG-212; raising it contradicts that decision.",
  "citations": [ Citation, ... ]
}
```

`verdict` ∈ `YES | NO | NO_EVIDENCE`. YES = change contradicts a recorded reason.
Rule (strictness, enforced in the Go verdict service): a hunk is FLAGGED only if
`verdict == "YES"` AND `citations.length >= 1` AND the cited decision's line anchor
overlaps the hunk's old line range.

### Flag (what the extension and dashboard consume)

```json
{
  "id": 17,
  "repo": "acme/storefront",
  "pr": 1,
  "head_sha": "abc123...",
  "file": "services/payments/client.py",
  "line": 12,
  "kind": "contradiction",
  "verdict": "YES",
  "reason": "...",
  "citations": [ Citation, ... ],
  "hunk_hash": "9f2c1a0b4d6e8f10",
  "status": "open"
}
```

`kind` ∈ `contradiction | stale_comment`. `line` is the line in the NEW file the flag pins to
(for pure deletions, the line before the deletion). `status` ∈ `open | dismissed | overridden`.
For `stale_comment` flags, `hunk_hash` is the synthetic key `stale:<file>:<line>` (also the ledger/cache row key).

## Service APIs

### mocks — Estelle emulation

`POST {ESTELLE_URL}/v1/ask`
Request: `{"repo": "acme/storefront", "hunk": Hunk}`
Response: Verdict (shape above). Deterministic: same input → byte-identical output.

`POST {ESTELLE_URL}/v1/stale`
Request: `{"repo": ..., "file": ..., "comment": "## retry cap is 3", "comment_line": 9, "hunk": Hunk}`
Response: `{"stale": true|false, "reason": "...", "citations": [Citation]}`

`POST {ESTELLE_URL}/v1/knowledge`
Request: `{"fence": {id, file, line_start, line_end, summary, citations: [Citation], code?}}`
Response: `201 {"ok": true, "fences": N}`. Upserts by fence id (re-pushing never duplicates).
Runtime memory ingestion — the gateway calls this after a successful override so the next PR
touching those lines cites it. A fence with `code: null` matches ANY hunk overlapping its line
range in `/v1/ask` (decision memory over a range, vs. the seeded fences' exact guarded line) and
answers YES with reason `A recorded decision covers these lines: <summary> This change alters them.`

Mock knowledge comes from `seed/out/knowledge.json` (path via env `KNOWLEDGE_FILE`).

### mocks — GitHub API emulation (subset)

Base: `{GITHUB_API_URL}` = `http://localhost:4100/github/api`

- `GET /repos/{owner}/{repo}/pulls/{n}` → `{"number", "title", "state", "head": {"sha", "ref"}, "base": {"ref"}}`
- `GET /repos/{owner}/{repo}/pulls/{n}` with header `Accept: application/vnd.github.v3.diff` → unified diff text
- `POST /repos/{owner}/{repo}/check-runs` body `{name, head_sha, status, conclusion, output:{title, summary}}` → stores it, returns `{"id": N, ...echo}`
- `GET /repos/{owner}/{repo}/commits/{sha}/check-runs` → `{"check_runs": [...]}`
- `POST /repos/{owner}/{repo}/pulls/{n}/comments` body `{body, commit_id, path, line, side}` → stores review comment (plaque suggestions), returns it with `id`
- `GET /repos/{owner}/{repo}/pulls/{n}/comments` → list

Auth: mock ignores auth headers. Real mode: gateway/verdict send `Authorization: Bearer $GITHUB_TOKEN`.

### mocks — demo trigger & pages

- `POST /github/trigger/pr?owner=&repo=&pr=` — mock signs (HMAC-SHA256, `GITHUB_WEBHOOK_SECRET`) and POSTs a `pull_request` webhook (action `synchronize`) to `{GATEWAY_URL}/webhooks/github`. Used by the demo script and e2e test.
- `GET /github/{owner}/{repo}/pull/{n}/files` — HTML page rendering the PR diff in a GitHub-like DOM (see extension contract below).
- `GET /slack/archives/{channel}/p{ts}` — HTML page of a seeded Slack thread.
- `GET /linear/issue/{KEY}` — HTML page of a seeded Linear ticket.

### diff-analyzer (Rust)

`POST /analyze`
Request: `{"diff": "<unified diff text>"}`
Response: `{"hunks": [Hunk, ...]}`
Splits each diff hunk into minimal change runs (consecutive removed/added lines form one Hunk; context lines split runs).

`POST /remap`
Request: `{"diff": "<unified diff>", "anchors": [{"file": "...", "line_start": 10, "line_end": 12}]}`
Response: `{"anchors": [{"file": ..., "line_start": <new>, "line_end": <new>, "alive": true|false}]}`
Maps old-file anchors to new-file positions; `alive:false` when the anchored lines were deleted.

### triage (Python FastAPI)

`POST /score`
Request: `{"hunks": [Hunk, ...]}`
Response: `{"scores": [{"hunk_hash": "...", "score": 0.0–1.0, "reasons": ["removed_conditional", ...]}]}`
Gateway forwards to verdict only hunks with `score >= 0.5`.
Rule reasons vocabulary: `removed_conditional`, `changed_numeric_constant`, `removed_retry_or_timeout`, `removed_error_handling`, `comment_only_change`, `rename_only`.

### verdict (Go)

`POST /judge`
Request:
```json
{"repo": "acme/storefront", "pr": 1, "head_sha": "...", "installation_token": "",
 "hunks": [Hunk, ...],
 "comments": [{"file": ..., "line": 9, "text": "# retry cap is 3", "hunk_hash": "...", "hunk": Hunk}]}
```
`comments` (optional) = code comments adjacent to changed hunks, for stale-comment checks.
Each comment's `hunk` is its adjacent Hunk object, embedded INLINE — not merely looked up by
`hunk_hash` against the request's `hunks[]`. Gateway extracts comments against ALL hunks the
analyzer produced, but only forwards hunks scoring `>= 0.5` in `hunks[]` (see triage above); without
the inline `hunk`, a stale-comment candidate whose adjacent hunk scored below that threshold would
have no hunk context in `/judge` and its stale check would be silently skipped. Verdict runs the
stale check using the inline `hunk` when present, falling back to a `hunk_hash` lookup against
`hunks[]` only for backward compatibility.
Response: `{"flags": [Flag, ...], "check_run_id": 12}`
Behavior: per hunk (bounded concurrency 4) ask Estelle `/v1/ask`; apply strictness rules; for each
comment ask `/v1/stale`. Cache key `repo + ":" + head_sha + ":" + hunk_hash` in Redis (fallback:
in-process map); cache hit returns the stored JSON verbatim. Persist flags via ledger
`POST /verdicts`. Post one check run: conclusion `neutral` if no flags, `action_required` if any;
summary is markdown listing each flag with citations.

### ledger (Spring Boot)

- `POST /decisions` `{repo, file, line_start, line_end, summary, citations: [Citation], source}` → row with `id`. `source` ∈ `seed | verdict | override | plaque`.
- `GET /decisions?repo=&file=` → list
- `POST /verdicts` `{repo, pr, head_sha, hunk_hash, decision_id|null, verdict, payload}` — upsert on `(repo, head_sha, hunk_hash)`; `payload` is the full Flag JSON → returns row with `id`
- `GET /verdicts?repo=&pr=` → `[{id, ..., payload}]`; `pr` optional — omitted returns all rows for the repo
- `POST /overrides` `{verdict_id, reason, author}` → row; side effect: inserts a new `decision` (source `override`) anchored to the verdict's file/lines so future PRs cite it. (The gateway additionally pushes the override into Estelle's knowledge — see `POST {ESTELLE_URL}/v1/knowledge` — so a NEW PR touching the same lines cites the override.)
- `GET /overrides?repo=` → list joined with verdict info
- `GET /fences/by-file?repo=` → `[{file, fence_count, loc}]` (`loc` = lines of code if known, else 0)
- `GET /stats?repo=` → `{verdicts_total, flags_total, overrides_total, false_positive_rate}` (fp rate = overrides/flags, 0 if no flags)

### gateway (Node)

- `POST /webhooks/github` — verifies `X-Hub-Signature-256` HMAC with `GITHUB_WEBHOOK_SECRET`; on `pull_request` action `opened|synchronize`: stores raw payload (Mongo or file fallback), fetches PR diff from GitHub API, calls analyzer `/analyze`, triage `/score`, filters, calls verdict `/judge`. Responds `202 {"accepted":true}` immediately is NOT required — synchronous processing is fine for demo, respond `200` with `{"flags": N}` when done.
- `GET /verdicts?repo=&pr=` → `{"flags": [Flag, ...]}` (reads ledger; merges override/dismiss status). `pr` optional — omitted returns all flags for the repo (dashboard verdict history).
- `POST /flags/{id}/dismiss` → marks flag dismissed (ledger payload status update)
- `POST /overrides` `{verdict_id, reason, author}` → proxies ledger, returns created override
- `GET /overrides?repo=` → proxy of ledger (dashboard overrides view)
- `POST /plaque` `{repo, pr, flag_id}` → posts a GitHub review comment with a ```suggestion block inserting one fence comment line above the guarded line. Comment line format: `<comment-leader> Fence: <summary> — see <first citation title> (<first citation url>)` where comment-leader matches the file type (`#` for .py, `//` for js/ts/go/java/rs).
- `GET /fences/by-file?repo=` → proxy of ledger
- `GET /decisions?repo=&file=` → proxy of ledger (dashboard fence side panel)
- `GET /stats?repo=` → proxy of ledger
- CORS: allow all origins (extension + dashboard).

### extension (MV3)

Content script matches `https://github.com/*/*/pull/*/files*` AND `http://localhost:4100/github/*/*/pull/*/files*`.
Reads gateway base URL from extension storage (default `http://localhost:4000`).
Fetches `GET {GATEWAY_URL}/verdicts?repo={owner}/{repo}&pr={n}`; for each flag locates the diff row
for `flag.file` + `flag.line` and injects a flag card.

DOM contract it pins to (both github.com and the mock page):
- file container: `div[data-tagsearch-path]` or `.file` with `.file-header[data-path]`
- line cell: `td.blob-num[data-line-number]` on the addition side (`.blob-num-addition` or right side)
Card shows: kind badge, reason, citation links, buttons `Dismiss`, `Override…` (prompt for reason), `Pin reason` (calls `/plaque`).

## Seed outputs (`seed/out/`)

- `demo-repo/` — git repo (storefront: `services/checkout/`, `services/payments/`, `services/inventory/`), backdated commits, branches `main`, `demo/retry-cap-removal`, `demo/harmless-refactor`, `demo/timeout-change`.
- `knowledge.json` — `{"repo": "acme/storefront", "fences": [{"id", "file", "line_start", "line_end", "code", "summary", "citations": [Citation]}]}`
- `slack.json` — `{"threads": [{"channel": "oncall", "ts": "1700000001", "title", "messages": [{"user", "text", "ts"}]}]}`
- `linear.json` — `{"tickets": [{"key": "ENG-212", "title", "description", "status", "url"}]}`
- `prs.json` — `{"prs": [{"number": 1, "title", "branch", "base": "main", "head_sha", "diff_file": "prs/1.diff", "author"}]}`
- `prs/{n}.diff` — unified diff for each demo PR (git diff main...branch).

Note: prs.json contains the 3 live demo PRs (numbers 1–3) **plus ~18 "historical" fix PRs
(numbers 101–118, branch `fix/<fence-id>`)** that fence citations point at. Historical PRs
exist only as metadata + a diff file — their branches are NOT git refs in demo-repo. The mock
GitHub service must serve PR pages/API for them from prs.json alone.

The three demo PRs and expected outcomes (the e2e acceptance):
1. PR 1 `demo/retry-cap-removal` — changes `MAX_RETRIES = 3` → `MAX_RETRIES = 50` in `services/payments/client.py` → **1 contradiction flag** citing slack + linear + pr (3 citations).
2. PR 2 `demo/harmless-refactor` — renames a local variable in `services/inventory/stock.py` → **0 flags**.
3. PR 3 `demo/timeout-change` — changes `CHECKOUT_TIMEOUT_SECONDS = 30` → `= 5` in `services/checkout/api.py`, where the comment above still says `# timeout is 30s, see ENG-310` → **1 stale_comment flag** (and NO contradiction flag unless a fence says otherwise — fence ENG-310 anchors the comment, not the constant).
