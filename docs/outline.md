
Chesterton
Project outline. Track: Fate Labs, Best use of Estelle.
One-liner
Other tools tell you why the fence is there if you think to ask. Chesterton taps you on the shoulder before you tear it down.
Problem
Code often exists for a reason recorded somewhere else: an incident Slack thread, a Linear ticket, an old PR.
The developer changing that code usually doesn't know the reason exists, so they never look it up.
Existing tools (Unblocked, Pruve, GitLens, git-why) explain history on demand. None lead with catching a PR that undoes a past decision.
Solution
On every PR, Chesterton finds changed lines that have a recorded reason behind them.
Estelle checks whether the change contradicts that reason.
If it does, Chesterton flags it inline on github.com with citations (PR, Slack thread, Linear ticket).
If there is no evidence, it stays silent. No guesses.
Second mode: flags code comments the PR makes stale.
How it works
Developer opens or updates a PR. GitHub sends a webhook to the Node gateway.
Rust diff analyzer splits the diff into hunks and maps them to symbols and line history.
Python triage model scores each hunk; only safeguard-like changes move on.
Go verdict service asks Estelle, per hunk: is there a recorded reason for these lines, and does this change contradict it?
Verdict is cached in Redis and stored in the Spring Boot ledger.
Go posts a GitHub check run with the verdict and citations.
The extension reads the verdicts and pins flags beside the exact lines in the PR diff.
Reviewer can dismiss a flag or override it with a reason. The override becomes new memory for next time.
Features
Core (must ship)
GitHub webhook to verdict pipeline
Contradiction verdict with citations, posted as a check run
Inline flags in the PR diff via the extension
Silence when there is no evidence
Stretch
Stale comment mode
Override with reason, written back as memory
Dashboard with accuracy and false-positive stats
Merge blocking as a required status check
Chosen add-ons
Fence map: repo heatmap showing where recorded reasons (fences) cluster. Each tile is a file, sized by lines of code and shaded by fence count. Click a tile to list its fences with citations.
Built from the decision ledger: every verdict and confirmed decision is anchored to a file and line range, so counts per file come from one SQL query.
Rust analyzer keeps anchors accurate as lines move, so the map doesn't drift after refactors.
Rendered in the React dashboard as a treemap (plain greyscale shading).
Fence plaque: a "Pin reason" button on every flag in the extension. One click adds a short comment above the guarded line linking the decision.
Posted as a GitHub suggested change on the PR, so a human still clicks "Commit suggestion". Chesterton never pushes code on its own.
Plaque format: one line, e.g. // Fence: retry cap, see incident #212, plus a link to the citation trail.
The plaque link opens the full citation trail, so the reason travels with the code even if Chesterton is removed.
Architecture and tech stack
Component
Tech
Role
Browser extension
TypeScript, HTML/CSS
Injects inline flags into the github.com PR diff view
Gateway
Node.js (TS), REST
Receives GitHub, Slack and Linear webhooks; single API for the extension
Diff analyzer
Rust
Parses diffs, maps hunks to symbols and line ranges, tracks lines across commits. Deterministic and fast
Hunk triage
Python + PyTorch
Small CPU model scoring which hunks look like removed safeguards (deleted guards, changed limits, dropped retries) so only those go to Estelle
Verdict service
Go
Queries Estelle for each flagged hunk concurrently, applies strictness rules, posts the GitHub check run
Decision ledger
Spring Boot + PostgreSQL (SQL)
Stores verdicts, citations, overrides and reviewer feedback; powers the accuracy stat
Cache
Redis
Verdicts keyed by PR head SHA + hunk hash, so the same input always returns the same answer; rate limiting
Raw events
MongoDB
Raw webhook payloads from GitHub, Slack and Linear
Dashboard
React + TypeScript
Fence map treemap, verdict history, override log, false-positive rate
Plaque service
Node.js + GitHub REST API
Turns a Pin reason click into a suggested-change review comment on the PR
Code agent
Estelle
Indexes the repo and cited memory; answers whether a change contradicts a recorded reason
CI/CD
GitHub Actions
Builds and tests every service; Chesterton itself runs as a required status check
Infra
Docker Compose, Linux
One-command local stack
Cloud
AWS (free tier/credits)
One small EC2 instance to host the stack for live webhooks; billing alarm on day one
Stretch
Kubernetes (kind)
Local only, first thing cut

Coverage: 20 of 24 technologies, 21 with Kubernetes.
Cut on purpose: C/C++, C#/.NET, Ruby on Rails (no honest role), TensorFlow (redundant with PyTorch).
Demo data
Seeded repo for a fake company (small storefront: checkout, payments, inventory services).
Seeded Slack workspace with an #oncall channel and incident threads.
Seeded Linear project with tickets linked to PRs.
Planted history: three past decisions that a future PR could undo.
Enough seeded decisions (around 15 to 20) spread unevenly across services so the fence map has visible hot spots.
Pre-built PRs ready to open live (see demo script).
Demo script (about 3 minutes)
Hook (10s): a one-line PR removes a retry cap. Looks harmless. Ask the room if they'd approve it.
The catch (40s): open the PR. Chesterton flags the line: this cap exists because of incident #212, cites the #oncall thread, the Linear ticket and the original fix PR. Click each citation.
The silence (20s): open a harmless refactor PR. No flags. Chesterton only speaks with evidence.
Stale comment (20s): a PR changes a timeout constant; the comment above it still says the old value. Flagged with the PR that changed the behavior.
Same input, same answer (15s): re-run the first PR. Identical verdict and citations. This is the Estelle reliability point.
Fence plaque (20s): click Pin reason on the retry cap flag. A suggested comment appears above the line; commit it. The reason now lives in the code.
Memory grows (20s): reviewer overrides a flag with a reason. Open a new PR touching the same lines; Chesterton now cites the override.
Close on the fence map (25s): the heatmap lights up payments and checkout. Click the hottest tile to show its fences and citations. End on the one-liner.
Demo safety
Record a backup video of the full run.
Pre-warm the Redis cache so live verdicts return instantly.
Keep a local fallback if webhooks or Wi-Fi fail.
Phase 0 checks (before writing code)
Estelle access: API from our own services, which languages it indexes, whether it can ingest a seeded Slack and Linear workspace.
Whether Estelle can answer a contradiction question directly, or only retrieve. This decides how much reasoning lives in the Go service.
GitHub App setup: webhooks, check runs, read access to PRs, and pull request write access for plaque suggestions.
Extension: confirm content-script selectors on the github.com PR files view (fragile; pin to one layout).
Webhook tunnel: Cloudflare Tunnel (free) or the EC2 instance.
Build order
Seed the repo, Slack and Linear history.
Webhook to Node to Estelle to check run, for one hardcoded PR. This is the floor.
Rust diff analyzer and Go verdict service.
Extension inline flags.
Redis cache, Spring Boot ledger, Postgres.
Fence plaque button and suggested-change comment.
Dashboard with the fence map.
Python triage model, stale comment mode, overrides.
CI/CD, Docker Compose polish, EC2 deploy, Kubernetes if time.
Cut order
Kubernetes
MongoDB (use Postgres jsonb)
PyTorch triage (replace with rules)
Fence map polish (fall back to a ranked table of files by fence count)
Spring Boot (fold the ledger into Node + Postgres)
Stale comment mode
Fence plaque
Floor: PR webhook, Estelle verdict with citations, check run, inline flag on one planted PR.
Unique add-ons
Fence expiry: some decisions are temporary ("until we migrate to v2"). When the linked Linear ticket closes, Chesterton says the fence can come down and opens a removal PR. No other tool runs in this direction.
Ping the original thread: when a PR contradicts a decision, Chesterton replies in the original Slack thread so the people who made the call can weigh in before merge.
AI agent guard: PRs written by coding agents get the same check, and Chesterton is exposed as a tool so an agent can ask before it edits a fenced line. Timely pitch: agents don't know your history either.
Fence map: a repo heatmap in the dashboard showing where recorded reasons cluster. Instantly shows judges the riskiest areas of the codebase.
Who to ask: if the original author has left, cite who else was in the decision thread or reviewed the fix.
Fence plaque: one click adds a short comment linking the decision above the guarded line, so the reason travels with the code.
Chosen for this build: fence map and fence plaque (see Features). The others stay as future work.
Risks
False positives destroy trust. Only flag when the cited reason is explicit and the diff touches the exact lines it was about.
Only knows what was written down. Decisions made in person are invisible.
Judges may compare it to Unblocked. Answer: one job, a hard evidence rule, and the same verdict every time.
GitHub DOM changes can break the extension. The check run works even if the extension fails.
Cost
Expected $0: Docker Compose locally, GitHub Actions free on public repos, Cloudflare Tunnel free.
EC2 under free tier or credits. Set a billing alarm on day one.
Confirm Estelle access is free for participants.