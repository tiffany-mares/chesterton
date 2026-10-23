"""Triage service: FastAPI wiring for POST /score and GET /healthz.

Scoring logic lives in rules.py (pure functions, no framework dependency) so
it can be unit tested directly and reused by train_torch.py. This module's
only job is HTTP plumbing plus the optional model-vs-rules switch described
in docs/contracts.md and task-5-brief.md.
"""
import os
from typing import Optional

from fastapi import FastAPI
from pydantic import BaseModel

import rules

SERVICE_NAME = "triage"

app = FastAPI(title="chesterton-triage")


class Hunk(BaseModel):
    file: str
    old_start: int
    old_end: int
    new_start: int
    new_end: int
    old_lines: list[str]
    new_lines: list[str]
    symbol: str = ""
    hunk_hash: str


class ScoreRequest(BaseModel):
    hunks: list[Hunk]


class HunkScore(BaseModel):
    hunk_hash: str
    score: float
    reasons: list[str]


class ScoreResponse(BaseModel):
    scores: list[HunkScore]


def _load_model():
    """Load an optional torch model iff MODEL_PATH is set and loadable.

    Returns None (falling back to rules) on any failure: missing env var,
    torch not installed, or a bad/missing checkpoint file.
    """
    model_path = os.environ.get("MODEL_PATH")
    if not model_path:
        return None
    try:
        import torch  # noqa: F401 - only imported when a model is requested
    except ImportError:
        return None
    try:
        model = torch.load(model_path, weights_only=False)
        model.eval()
        return model
    except Exception:
        return None


_model = _load_model()


def score_hunk_dict(hunk: dict) -> tuple[float, list[str]]:
    """Score a single hunk, using the loaded model if available, else rules."""
    if _model is not None:
        try:
            from train_torch import score_with_model

            return score_with_model(_model, hunk)
        except Exception:
            pass
    return rules.score_hunk(hunk)


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True, "service": SERVICE_NAME}


@app.post("/score", response_model=ScoreResponse)
def score(request: ScoreRequest) -> ScoreResponse:
    scores = []
    for hunk in request.hunks:
        value, reasons = score_hunk_dict(hunk.model_dump())
        scores.append(HunkScore(hunk_hash=hunk.hunk_hash, score=value, reasons=reasons))
    return ScoreResponse(scores=scores)


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "4500"))
    uvicorn.run(app, host="0.0.0.0", port=port)
