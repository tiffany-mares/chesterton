# seed/

Builds the Chesterton demo world: a fake storefront git repo with planted
history, plus the JSON fixtures (`knowledge.json`, `slack.json`,
`linear.json`, `prs.json`) that the mock Estelle and mock GitHub services
read. See `docs/contracts.md` ("Seed outputs (`seed/out/`)") for the exact
output shapes, and `docs/build_plan.md` (Phase 1) for the narrative this
models.

## Setup

Only dependency is `pyyaml` (used to parse `fences.yaml`). Either:

```bash
pip install --user -r seed/requirements.txt
```

or, if you'd rather isolate it:

```bash
python -m venv seed/.venv
seed/.venv/Scripts/pip install -r seed/requirements.txt   # Windows
seed/.venv/bin/pip install -r seed/requirements.txt       # macOS/Linux
```

`pytest` is also required to run the test suite (not listed in
`requirements.txt` since it's a dev-only dependency — `pip install pytest`
or `pip install --user pytest`).

## Running

```bash
python seed/seed.py --reset
```

- `--reset` wipes `seed/out/` first. Without it, running into an existing
  `seed/out/` exits with a clear error (exit code 1) instead of partially
  overwriting anything.
- `--out <dir>` overrides the output location (default: `seed/out`, next to
  this script, regardless of current working directory).

Output: `seed/out/demo-repo` (a real git repo, branches `main` +
`demo/retry-cap-removal` + `demo/harmless-refactor` + `demo/timeout-change`),
`seed/out/knowledge.json`, `seed/out/slack.json`, `seed/out/linear.json`,
`seed/out/prs.json`, `seed/out/prs/*.diff`. `seed/out/` is gitignored.

Everything is deterministic: fixed backdated commit dates/authors, fixed
fence ordering, fixed Slack timestamps. Re-running `--reset` on the same
machine with the same git version reproduces the same tree (and, in
practice, the same commit hashes) — but nothing downstream should assume
exact SHAs since that's best-effort, not guaranteed across git versions.

## Testing

```bash
python -m pytest seed/tests -v
```

Tests invoke `seed.py` as a subprocess into a temp directory (so the actual
CLI, including `--reset` and the "already exists" error path, is exercised)
and then assert against the real git repo and JSON files it produces:
branches, backdated authors, every fence's `code` line present verbatim,
`knowledge.json` line anchors pointing at the right line, the three demo
diffs matching `docs/contracts.md`'s expected changes, and the PR3 comment
line surviving untouched.

## Files

- `fences.yaml` — declarative config for all 18 fences (3 full + 15 lighter).
- `repo_builder.py` — builds `demo-repo`: scaffold commit (fence lines as
  `# TODO(seed): ...` placeholders) + one fix commit per fence (swaps the
  placeholder for the real line; commit message is the fence's `pr.title`,
  author is `pr.author`), then the three demo branches off main's tip.
- `fixtures.py` — turns `fences.yaml` + the built repo into
  `knowledge.json` / `slack.json` / `linear.json` / `prs.json`.
- `real_mode.py` — optional, untested: if `SLACK_BOT_TOKEN` / `LINEAR_API_KEY`
  are set, posts real Slack threads / creates real Linear tickets and uses
  those URLs instead of mock ones. Every call is wrapped in try/except and
  falls back to the mock URL on any failure. Not exercised by the test
  suite — mock mode (the default) is what's tested.
- `seed.py` — CLI entrypoint tying the above together.
- `tests/` — pytest suite (see Testing above).

## Env vars

- `MOCKS_BASE_URL` (default `http://localhost:4100`) — base URL baked into
  citation/ticket/thread URLs in the generated fixtures.
- `SLACK_BOT_TOKEN`, `LINEAR_API_KEY` — optional, enable real mode (see
  `real_mode.py`).
