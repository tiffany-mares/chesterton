"""Tests for the optional PyTorch triage trainer (train_torch.py).

Two groups:
- torch-less safety: train_torch must be safe to import and run even when
  torch is not installed (requirements.txt deliberately omits torch; see
  requirements-ml.txt) — it is an optional trainer, never a hard dependency.
- model behaviour: skipped unless torch is installed; verifies a trained
  model lands on the right side of the gateway's 0.5 filter.
"""
from __future__ import annotations

import subprocess
import sys

import pytest

import train_torch


# ---------------------------------------------------------------------------
# torch-less safety (runs with or without torch installed)
# ---------------------------------------------------------------------------


def test_module_imports_without_torch_installed():
    # If this import succeeded at all, torch-less import works. Module-level
    # TORCH_AVAILABLE must reflect actual importability, not be hardcoded.
    import importlib.util

    expected = importlib.util.find_spec("torch") is not None
    assert train_torch.TORCH_AVAILABLE == expected


def test_train_returns_none_when_torch_unavailable(monkeypatch):
    monkeypatch.setattr(train_torch, "TORCH_AVAILABLE", False)
    monkeypatch.setattr(train_torch, "torch", None)
    result = train_torch.train([{"old_lines": ["x = 1"], "new_lines": ["x = 2"]}])
    assert result is None


def test_running_as_script_does_not_crash_without_torch():
    proc = subprocess.run(
        [sys.executable, "train_torch.py"],
        cwd=".",
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert proc.returncode == 0


# ---------------------------------------------------------------------------
# model behaviour (requires torch; skipped on the torch-free CI install).
# NOT a module-level importorskip: that would skip the torch-less tests above.
# ---------------------------------------------------------------------------

requires_torch = pytest.mark.skipif(
    not train_torch.TORCH_AVAILABLE, reason="torch not installed (requirements-ml.txt)"
)

RETRY_HUNK = {
    "file": "services/payments/client.py", "symbol": "", "hunk_hash": "x",
    "old_start": 5, "old_end": 5, "new_start": 5, "new_end": 5,
    "old_lines": ["MAX_RETRIES = 3"], "new_lines": ["MAX_RETRIES = 50"],
}
RENAME_HUNK = {
    "file": "services/checkout/cart.py", "symbol": "", "hunk_hash": "y",
    "old_start": 1, "old_end": 1, "new_start": 1, "new_end": 1,
    "old_lines": ["total_price = price * qty"], "new_lines": ["total_cost = price * qty"],
}


@requires_torch
def test_trained_model_separates_safeguard_from_rename():
    # Train on just the two archetypes; the model must land on the right
    # side of the gateway's 0.5 filter for both (the demo depends on it).
    model = train_torch.train([RETRY_HUNK, RENAME_HUNK])
    retry_score, retry_reasons = train_torch.score_with_model(model, RETRY_HUNK)
    rename_score, rename_reasons = train_torch.score_with_model(model, RENAME_HUNK)

    assert retry_score >= 0.5
    assert rename_score < 0.5
    assert "changed_numeric_constant" in retry_reasons
    assert "rename_only" in rename_reasons


@requires_torch
def test_saved_model_roundtrips_and_scores(tmp_path):
    import torch

    model = train_torch.train([RETRY_HUNK, RENAME_HUNK])
    path = tmp_path / "model.pt"
    torch.save(model, path)
    loaded = torch.load(path, weights_only=False)
    loaded.eval()
    score, _ = train_torch.score_with_model(loaded, RETRY_HUNK)
    assert score >= 0.5
