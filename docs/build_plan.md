
Chesterton: Build Plan
Solo build, Fate Labs Estelle track. Hours assume a 24 to 36 hour hackathon; a 12 hour version is at the end.
Rules for the build
Protect the floor first: PR webhook, Estelle verdict with citations, check run, inline flag on one planted PR.
Every phase has a done-when line. Don't start the next phase until it's true.
Record a backup demo video as soon as the floor works, then again at the end.
Behind schedule? Cut scope from the cut order. Never extend a phase.
Repo layout
chesterton/
  seed/            Python: creates demo repo, Slack, Linear, PRs
  gateway/         Node.js + TypeScript: webhooks, REST API
  diff-analyzer/   Rust: hunks, symbols, line anchors
  verdict/         Go: Estelle queries, rules, check runs
  ledger/          Spring Boot: decisions, verdicts, overrides
  triage/          Python + PyTorch (FastAPI): hunk scoring
  extension/       TypeScript Chrome extension (MV3)
  dashboard/       React + TypeScript: fence map
  infra/           docker-compose.yml, k8s/ (stretch)
  .github/workflows/
Phase 0: Setup and access checks (1.5h)
Get Estelle access. Point it at a hello-world repo and ask one question.
Confirm Estelle can ingest Slack and Linear. If not, switch to the GitHub-only fallback now (reasons live in PR discussions and Issues).
Create the free Slack workspace, #oncall channel and a bot with chat:write and chat:write.customize.
Create the free Linear workspace, an API key, and turn on the GitHub integration.
Create a GitHub App: pull_request webhook, Checks write, Pull requests write, Contents read.
Start a Cloudflare Tunnel to localhost for webhooks. Set an AWS billing alarm.
Scaffold the monorepo and an empty docker-compose.yml with Postgres, Redis and MongoDB.
Done when: Estelle answers a test question with a citation, and a test webhook reaches your laptop.
Phase 1: Seed the demo world (2.5h)
One YAML config describes every fence: the code, the Slack thread, the Linear ticket and the PR.
seed.py creates the storefront repo with backdated commits from several fake authors (GIT_AUTHOR_DATE and GIT_COMMITTER_DATE).
Posts each Slack thread with a custom username per speaker, creates each Linear ticket, opens and merges each fix PR linking the ticket.
Plant 3 full demo fences plus about 15 lighter ones spread unevenly (heavy in payments and checkout) for the fence map.
Push the demo branches that will be opened live: retry cap removal, harmless refactor, timeout constant change.
Add a --reset flag that wipes and re-seeds everything.
fences:
  - id: retry-cap
    file: services/payments/client.py
    code: "MAX_RETRIES = 3"
    slack: [["Person 1", "checkout is hammering payments, retries are unbounded"],
            ["Person 2", "capping at 3 with backoff, ticket incoming"]]
    linear: {key: ENG-212, title: "Cap payment retries at 3"}
    pr: {title: "Cap payment retries (fixes ENG-212)", author: "Person 2"}
Done when: Asking Estelle "why is MAX_RETRIES 3?" returns the Slack thread, ENG-212 and the fix PR.
Phase 2: The floor (3h)
gateway: POST /webhooks/github verifies the signature, stores the raw payload, and on pull_request opened or synchronize fetches the diff.
Send the changed lines to Estelle with the verdict prompt (below). Parse the answer into JSON.
Post a GitHub check run: neutral if no evidence, action_required if contradicted, with citations in the summary.
Hardcode the happy path for the retry cap PR. Generalize later.
Verdict prompt (per hunk):
Lines changed: <file>:<start>-<end>
Before: <old code>   After: <new code>
1. Is there a recorded reason for the old lines? Cite it.
2. Does the change contradict that reason? Answer YES, NO, or NO_EVIDENCE.
Return JSON: {verdict, reason, citations: [{type, url, title}]}
Done when: Opening the retry cap PR produces a check run citing all three sources. Commit and record backup video #1.
Phase 3: Rust diff analyzer and Go verdict service (4h)
Rust (axum): POST /analyze takes a unified diff, returns hunks with file, line range, enclosing symbol (tree-sitter) and a stable hunk hash.
Rust also maps old line anchors to new positions so fences survive moved code.
Go: receives hunks from the gateway, queries Estelle per hunk concurrently (errgroup, bounded to 4), applies strictness rules, posts the check run.
Strictness rules: flag only if verdict is YES, at least one citation, and the cited reason's anchor overlaps the hunk's lines.
Done when: All three demo PRs get the right verdict and the refactor PR is silent.
Phase 4: Browser extension (3h)
MV3 content script on github.com/*/pull/*/files. Pin to one diff layout and note the selectors in a single file.
Fetch GET /verdicts?repo=&pr= from the gateway, find each flagged line, insert a flag card beside it.
Card shows the reason, clickable citations, Dismiss, Override with reason and Pin reason buttons.
Handle GitHub's client-side navigation with a MutationObserver.
Done when: Flags appear next to the exact lines on all demo PRs, and citations open the right Slack, Linear and PR pages.
Phase 5: Ledger, cache and storage (3h)
Spring Boot ledger with REST endpoints for decisions, verdicts and overrides.
Redis: cache verdicts by head SHA plus hunk hash. A cache hit returns the identical stored JSON.
MongoDB: raw webhook payloads only.
CREATE TABLE decision (
  id SERIAL PRIMARY KEY, repo TEXT, file TEXT,
  line_start INT, line_end INT, summary TEXT,
  citations JSONB, source TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE verdict (
  id SERIAL PRIMARY KEY, repo TEXT, pr INT, head_sha TEXT,
  hunk_hash TEXT, decision_id INT REFERENCES decision,
  verdict TEXT, payload JSONB, created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (repo, head_sha, hunk_hash));
CREATE TABLE override (
  id SERIAL PRIMARY KEY, verdict_id INT REFERENCES verdict,
  reason TEXT, author TEXT, created_at TIMESTAMPTZ DEFAULT now());
Done when: Re-running a PR returns the same verdict from cache, and rows appear in all three tables.
Phase 6: Fence plaque and fence map (3h)
Plaque: Pin reason calls POST /plaque; the gateway posts a review comment with a GitHub suggestion block adding one comment line above the guarded line.
```suggestion
# Fence: retry cap, see ENG-212 and incident thread (link)
MAX_RETRIES = 3
```
Fence map: GET /fences/by-file returns file, lines of code and fence count from one SQL query on decision.
React dashboard draws a greyscale treemap (d3-hierarchy). Clicking a tile lists that file's fences and citations.
Done when: Committing the plaque suggestion adds the comment to the branch, and the map shows payments and checkout as hot spots.
Phase 7: Triage model, stale comments, overrides (3h)
Start with rules: deleted conditionals, changed numeric constants, removed retry or timeout calls.
Then train a tiny PyTorch classifier on about 200 hunks labelled by the rules plus your corrections. CPU only, small MLP on simple diff features.
Serve it from FastAPI. Only hunks scoring above the threshold go to Estelle.
Stale comment check: if a hunk changes code under a comment, ask Estelle whether the comment still matches.
Overrides write a new decision row, so the next PR cites the override.
Done when: The refactor PR sends zero hunks to Estelle, and the timeout PR gets a stale-comment flag.
Phase 8: CI/CD, deploy, polish (2h)
GitHub Actions: one job per service (build and test), plus image builds. Chesterton runs as a required status check on the demo repo.
docker compose up brings up the whole stack on Linux.
Deploy the same compose file to one EC2 instance as a fallback.
Kubernetes on kind only if everything else is done.
Write the README and Devpost entry.
Done when: A fresh clone runs with one command, and CI is green.
Phase 9: Demo prep (1.5h)
Run seed.py --reset, then run every demo PR once to warm the cache.
Write a script that opens each demo PR with gh pr create, one command per beat.
Set up browser tabs in order: PR, Slack, Linear, dashboard.
Rehearse three times against the clock. Record backup video #2.
Done when: You can run the full demo in under 3 minutes without looking at notes.
Time summary
Phase
Work
Hours
0
Setup and access checks
1.5
1
Seed the demo world
2.5
2
The floor
3
3
Rust and Go services
4
4
Browser extension
3
5
Ledger, cache, storage
3
6
Plaque and fence map
3
7
Triage, stale comments, overrides
3
8
CI/CD, deploy, polish
2
9
Demo prep
1.5

Total build time
26.5

Leave the rest of the event for sleep, meals and slack time. Things will break.
If you only have 12 hours
Do phases 0, 1, 2, 4 and 9 fully.
Phase 3: Rust analyzer only; keep verdict logic in Node.
Phase 6: plaque only; replace the fence map with a ranked table.
Skip phases 5, 7 and 8 except a single GitHub Actions workflow.
Cut order
Kubernetes
MongoDB (use Postgres jsonb)
PyTorch model (keep the rules)
Fence map treemap (ranked table instead)
Spring Boot (fold the ledger into Node + Postgres)
Stale comment mode
Fence plaque
Biggest risks
Estelle can't read Slack or Linear: decided in Phase 0, GitHub-only fallback is ready.
Estelle answers are slow: the Redis cache and pre-warming hide it on stage.
GitHub DOM changes break the extension: the check run still shows the verdict.
False positives: strictness rules require explicit, overlapping citations.