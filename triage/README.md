# triage (Python FastAPI)

Scores hunks for likely contradiction with recorded decisions. Rules-based
scorer is primary and always on; an optional torch MLP can replace it when
`MODEL_PATH` is set and loadable. See `docs/contracts.md` ("triage (Python
FastAPI)") for the full API contract.

## Setup

```bash
cd triage
python -m venv .venv
source .venv/Scripts/activate   # Windows Git Bash; use .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
```

Optional (only needed to actually run `train_torch.py`; the base service
never requires torch):

```bash
pip install -r requirements-ml.txt
```

## Run

```bash
python app.py            # listens on $PORT, default 4500
# or
uvicorn app:app --host 0.0.0.0 --port 4500
```

Env vars:
- `PORT` — listen port (default `4500`).
- `MODEL_PATH` — optional path to a torch model checkpoint saved by
  `train_torch.py`. If unset, not loadable, or torch isn't installed, the
  service falls back to the rules-based scorer with no error.

## Test

```bash
python -m pytest -q
```

## Manual smoke test

```bash
curl http://localhost:4500/healthz

curl -X POST http://localhost:4500/score -H "Content-Type: application/json" -d '{
  "hunks": [{
    "file": "services/payments/client.py",
    "old_start": 10, "old_end": 10, "new_start": 10, "new_end": 10,
    "old_lines": ["MAX_RETRIES = 3"], "new_lines": ["MAX_RETRIES = 50"],
    "symbol": "charge", "hunk_hash": "9f2c1a0b4d6e8f10"
  }]
}'
```

## Scoring rules (`rules.py`)

Pure functions, no framework dependency. Score starts at 0, signals below are
summed and capped at 1.0, then the rename penalty (if any) is applied with a
floor of 0:

| Signal | Weight | Reason string |
|---|---|---|
| Removed/weakened conditional (`if`/`elif`/`guard`/`raise`/`return` removed, no equivalent added) | +0.6 | `removed_conditional` |
| Numeric constant changed (same identifier, different number) | +0.5 | `changed_numeric_constant` |
| Retry/timeout/limit/cap keyword in removed lines | +0.4 | `removed_retry_or_timeout` |
| Removed try/except/catch/error handling (no equivalent added) | +0.5 | `removed_error_handling` |
| Comment-only change | forces score to `0.0` regardless of anything else | `comment_only_change` |
| Pure rename (identical except identifier names) | −0.5, floored at 0 | `rename_only` |

Demo-critical outcomes (see `docs/contracts.md` PRs 1 and 2):
- `MAX_RETRIES = 3` → `MAX_RETRIES = 50` scores `0.9` (≥ 0.5, gets forwarded to verdict).
- A pure local-variable rename scores `0.0` (< 0.5, filtered out before verdict).

## Optional model path (`train_torch.py`)

`requirements.txt` deliberately does NOT include torch — the rules scorer is
the only hard dependency. `train_torch.py`:
- No-ops safely (prints a message, exits 0) if torch isn't importable.
- Otherwise trains a tiny MLP on rule-labelled hunks (features = which rule
  reasons fired) and saves a checkpoint via `torch.save`.

To use a trained model instead of rules at request time, set `MODEL_PATH` to
the checkpoint path before starting `app.py`; if torch isn't installed or the
file fails to load, the service silently falls back to rules — this is
covered by `tests/test_train_torch.py` and the `_load_model` guard in
`app.py`.

### End-to-end training walkthrough (verified)

```bash
pip install -r requirements-ml.txt       # torch (CPU build is fine)
python ../seed/seed.py --reset           # if seed/out doesn't exist yet
# start the analyzer (bare metal `cargo run` or the compose stack), then:
python dump_corpus.py                    # seed PR diffs -> analyzer -> hunks.json
MODEL_PATH=model.pt python train_torch.py hunks.json
MODEL_PATH=model.pt python app.py        # service now scores with the MLP
```

`train_torch.py` ends with a probe of the demo's retry-cap hunk and warns if
the trained model scores it under the gateway's 0.5 filter (that would
silently kill demo PR 1). With the default 500 epochs on the seeded corpus it
lands ~0.9, and a pure rename ~0.0 — same side of the threshold as the rules.
