# Chesterton demo-day runbook

Everything below was verified live on 2026-10-24. Three deployment modes exist;
the demo uses **mock** (fully offline) or **hybrid** (real GitHub + real
Slack/Linear citations, mock Estelle). Full-real waits on Estelle credentials.

| Mode | GitHub | Slack/Linear citations | Estelle | Use for |
|---|---|---|---|---|
| mock | mocks service | mock pages | mock | offline fallback, e2e, CI |
| hybrid | api.github.com (App auth) | real workspaces | mock | the live demo |
| real | api.github.com | real | real (`ESTELLE_URL`/`ESTELLE_API_KEY`) | when Fate Labs credentials land |

Secrets live in the gitignored `.env` at the repo root (GitHub App id/key/
installation, webhook secret, Slack bot token + channel id, Linear key + team
id, `REAL_REPO_URL`). The GitHub App private key is also at
`C:/Users/tiffm/.chesterton/github-app.private-key.pem`.

## Boot — mock mode (offline fallback)

Bare metal (also what `scripts/demo.ps1` does):

```bash
node e2e/run.mjs --keep-alive   # seeds, boots everything, fires the 3 PRs, starts the dashboard
```

Docker:

```bash
cd infra && docker compose up -d
# one-time per fresh volume: import knowledge into the ledger
docker exec infra-mocks-1 cat /seed/out/knowledge.json > knowledge.json   # MSYS: prefix with MSYS_NO_PATHCONV=1
curl -X POST -H "Content-Type: application/json" --data @knowledge.json http://localhost:4400/decisions/import
# warm the cache / create the demo verdicts:
for n in 1 2 3; do curl -X POST "http://localhost:4100/github/trigger/pr?owner=acme&repo=storefront&pr=$n"; done
```

## Boot — hybrid mode (the live demo)

```bash
cd infra
docker compose --env-file ../.env -f docker-compose.yml -f docker-compose.real.yml up -d
```

Then the webhook path (quick tunnels mint a NEW hostname every run):

```bash
"C:/Program Files (x86)/cloudflared/cloudflared.exe" tunnel --url http://localhost:4000
# in another terminal, repoint the GitHub App webhook at the printed URL:
cd gateway && npx tsx ../scripts/update-app-webhook.mts https://<new-host>.trycloudflare.com
```

Live-loop smoke test: push any commit to a demo branch of
`tiffany-mares/chesterton-demo-storefront` (even `--allow-empty`) and watch the
Chesterton check run appear on the PR. Without the tunnel, the same pipeline
can be driven by delivering an HMAC-signed webhook to localhost — see
`scripts/`-adjacent history or re-create from `docs/contracts.md` (the gateway
verifies `X-Hub-Signature-256` over the raw body with `GITHUB_WEBHOOK_SECRET`).

Note: the mocks `POST /github/trigger/pr` helper signs with ITS OWN
`GITHUB_WEBHOOK_SECRET` (compose default `devsecret`), which hybrid gateway
(real secret) rejects with 401. In hybrid mode, drive real PRs instead.

## Resetting demo state

- **Verdict cache + mock-Estelle memory** (e.g. after showing the override
  beat): `docker exec infra-redis-1 redis-cli FLUSHALL` then
  `docker compose ... restart mocks`, re-fire the PRs. Overrides ingested into
  mock Estelle live in mocks' memory only — a mocks restart clears them.
- **Everything including the ledger**: `docker compose down -v` then boot
  again (volumes are wiped; re-import knowledge).
- **Do not re-run real-mode seeding casually**: every run posts 18 Slack
  threads and creates 18 Linear tickets again. A clean re-seed means:
  archive `#oncall` → create a fresh channel (new `SLACK_CHANNEL_ID` in
  `.env`) → trash the team's issues in Linear → `docker compose --env-file
  ../.env -f docker-compose.yml -f docker-compose.real.yml run --rm seed`.

## The demo beats

The 8-beat script is in `README.md` ("Demo script"). Pre-warm by firing the
three PRs once (the keep-alive boot and the hybrid smoke test both do this).
The backup video is regenerated with `node scripts/record-demo.mjs` against a
warmed mock stack → `docs/demo-backup/chesterton-demo-backup.mp4`.

## Known gotchas (each cost us time once)

1. **Docker Desktop auto-update kills every container mid-session** (exit 255
   across the board; it did this on 2026-10-24, 29.5.3 → 29.9.2). Disable
   Docker Desktop auto-update before demo day.
2. **Quick-tunnel URLs rotate** on every cloudflared restart — re-run
   `scripts/update-app-webhook.mts` each time.
3. **cloudflared is not on PATH** in Git Bash — use the full
   `C:/Program Files (x86)/cloudflared/cloudflared.exe` path.
4. **Branded Chrome dropped `--load-extension`** — automated extension loading
   (the demo recorder) must use Playwright's bundled Chromium. Manual "Load
   unpacked" in chrome://extensions still works fine for the live demo.
5. **github.com serves the files view at `/pull/N/changes`** now (old `/files`
   redirects); the extension handles both, but share links accordingly.
6. **Local Postgres owns host port 5432** — compose publishes on 5433 (the
   stack's internal wiring is unaffected).
7. **A stray test override can shadow the retry-cap citations** (an ingested
   `override-*` fence sorts first and answers YES with the override citation).
   If PR 1's flag cites an override instead of the incident thread, do the
   state reset above.

## After the hackathon

- Rotate `SLACK_BOT_TOKEN` (Slack app → OAuth) and `LINEAR_API_KEY` (Linear →
  Security & access) — both transited a chat session on 2026-10-24.
- Optionally regenerate the GitHub App webhook secret and private key.
- Stop the tunnel; consider the EC2 deploy (plan Phase 6) for a durable URL.
