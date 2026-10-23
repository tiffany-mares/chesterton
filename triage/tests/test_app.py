"""Integration tests for the FastAPI wiring: /healthz and /score."""
from fastapi.testclient import TestClient

import app as app_module
from app import app

client = TestClient(app)


def make_hunk(old_lines, new_lines, file="services/payments/client.py", hunk_hash="abc123"):
    return {
        "file": file,
        "old_start": 10,
        "old_end": 10 + max(len(old_lines) - 1, 0),
        "new_start": 10,
        "new_end": 10 + max(len(new_lines) - 1, 0),
        "old_lines": old_lines,
        "new_lines": new_lines,
        "symbol": "charge",
        "hunk_hash": hunk_hash,
    }


def test_healthz():
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "service": "triage"}


def test_score_response_shape():
    hunk = make_hunk(["MAX_RETRIES = 3"], ["MAX_RETRIES = 50"], hunk_hash="9f2c1a0b4d6e8f10")
    resp = client.post("/score", json={"hunks": [hunk]})
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {"scores"}
    assert len(body["scores"]) == 1
    entry = body["scores"][0]
    assert set(entry.keys()) == {"hunk_hash", "score", "reasons"}
    assert entry["hunk_hash"] == "9f2c1a0b4d6e8f10"
    assert isinstance(entry["score"], float)
    assert isinstance(entry["reasons"], list)


def test_score_retry_cap_demo_hunk_is_flagged():
    hunk = make_hunk(["MAX_RETRIES = 3"], ["MAX_RETRIES = 50"], hunk_hash="retrycap")
    resp = client.post("/score", json={"hunks": [hunk]})
    entry = resp.json()["scores"][0]
    assert entry["score"] >= 0.5


def test_score_rename_refactor_hunk_is_not_flagged():
    hunk = make_hunk(
        ["for item in items:", "    total += item.qty"],
        ["for entry in items:", "    total += entry.qty"],
        file="services/inventory/stock.py",
        hunk_hash="rename1",
    )
    resp = client.post("/score", json={"hunks": [hunk]})
    entry = resp.json()["scores"][0]
    assert entry["score"] < 0.5


def test_score_handles_multiple_hunks_in_order():
    hunk_a = make_hunk(["MAX_RETRIES = 3"], ["MAX_RETRIES = 50"], hunk_hash="hash-a")
    hunk_b = make_hunk(["x = 1"], ["x = 1"], hunk_hash="hash-b")
    resp = client.post("/score", json={"hunks": [hunk_a, hunk_b]})
    scores = resp.json()["scores"]
    assert [s["hunk_hash"] for s in scores] == ["hash-a", "hash-b"]


def test_score_delegates_to_model_when_model_path_is_loaded(monkeypatch):
    """When a model is loaded (MODEL_PATH set + loadable), /score must use it
    instead of rules.score_hunk."""
    import train_torch

    monkeypatch.setattr(app_module, "_model", object())
    monkeypatch.setattr(
        train_torch, "score_with_model", lambda model, hunk: (0.42, ["from_model"])
    )

    hunk = make_hunk(["MAX_RETRIES = 3"], ["MAX_RETRIES = 50"], hunk_hash="model-path")
    resp = client.post("/score", json={"hunks": [hunk]})
    assert resp.status_code == 200
    entry = resp.json()["scores"][0]
    assert entry["score"] == 0.42
    assert entry["reasons"] == ["from_model"]


def test_score_falls_back_to_rules_when_model_scorer_raises(monkeypatch):
    """If the model is loaded but scoring with it raises, the service must
    fall back to the rules-based scorer and still return a valid response."""
    import train_torch

    def _boom(model, hunk):
        raise RuntimeError("model inference blew up")

    monkeypatch.setattr(app_module, "_model", object())
    monkeypatch.setattr(train_torch, "score_with_model", _boom)

    hunk = make_hunk(["MAX_RETRIES = 3"], ["MAX_RETRIES = 50"], hunk_hash="model-fallback")
    resp = client.post("/score", json={"hunks": [hunk]})
    assert resp.status_code == 200
    entry = resp.json()["scores"][0]
    # Falls back to rules.score_hunk, which flags the retry-cap demo hunk.
    assert entry["score"] >= 0.5
    assert "changed_numeric_constant" in entry["reasons"]
