"""Optional tiny MLP trainer for triage scoring.

This is NOT part of the required scoring path - the service (app.py) always
has the rules-based scorer (rules.py) available and uses it unless MODEL_PATH
points at a loadable checkpoint. This script only does anything if torch is
importable (install requirements-ml.txt to get it); otherwise every function
here is a safe no-op so `requirements.txt` can stay torch-free.

Usage (after `pip install -r requirements-ml.txt`):
    python train_torch.py hunks.json          # trains, saves to $MODEL_PATH or model.pt
"""
import json
import os
import sys

import rules

try:
    import torch
    import torch.nn as nn

    TORCH_AVAILABLE = True
except ImportError:
    torch = None
    nn = None
    TORCH_AVAILABLE = False

# Feature order must match between training and inference (score_with_model).
FEATURE_REASONS = [
    rules.REASON_REMOVED_CONDITIONAL,
    rules.REASON_CHANGED_NUMERIC_CONSTANT,
    rules.REASON_REMOVED_RETRY_OR_TIMEOUT,
    rules.REASON_REMOVED_ERROR_HANDLING,
    rules.REASON_RENAME_ONLY,
]


def hunk_features_and_label(hunk: dict) -> tuple[list[float], float]:
    """Derive an MLP feature vector and rule-based label for one hunk."""
    label, reasons = rules.score_hunk(hunk)
    features = [1.0 if reason in reasons else 0.0 for reason in FEATURE_REASONS]
    return features, label


def _build_model():
    if not TORCH_AVAILABLE:
        return None
    return nn.Sequential(
        nn.Linear(len(FEATURE_REASONS), 8),
        nn.ReLU(),
        nn.Linear(8, 1),
        nn.Sigmoid(),
    )


def train(hunks: list[dict], epochs: int = 500, lr: float = 0.01):
    """Train a tiny MLP on rule-labelled hunks. Returns the model, or None if
    torch isn't installed."""
    if not TORCH_AVAILABLE:
        print("torch is not installed; skipping training. Install requirements-ml.txt to enable.")
        return None

    model = _build_model()
    rows = [hunk_features_and_label(h) for h in hunks]
    if not rows:
        return model
    features = torch.tensor([row[0] for row in rows], dtype=torch.float32)
    labels = torch.tensor([[row[1]] for row in rows], dtype=torch.float32)

    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    loss_fn = nn.MSELoss()
    for _ in range(epochs):
        optimizer.zero_grad()
        predictions = model(features)
        loss = loss_fn(predictions, labels)
        loss.backward()
        optimizer.step()
    return model


def score_with_model(model, hunk: dict) -> tuple[float, list[str]]:
    """Inference path used by app.py when MODEL_PATH is set and loadable.

    Falls back to the rule reasons that match the model's own feature vector
    so the response still carries an explainable reasons list.
    """
    features, _ = hunk_features_and_label(hunk)
    with torch.no_grad():
        output = model(torch.tensor([features], dtype=torch.float32))
    score = float(output.item())
    reasons = [reason for reason, flag in zip(FEATURE_REASONS, features) if flag]
    return round(min(max(score, 0.0), 1.0), 4), reasons


def main() -> None:
    if not TORCH_AVAILABLE:
        print("torch is not importable; nothing to do.")
        return

    hunks_path = sys.argv[1] if len(sys.argv) > 1 else None
    if hunks_path is None:
        print("usage: python train_torch.py <hunks.json>")
        return

    out_path = os.environ.get("MODEL_PATH", "model.pt")
    with open(hunks_path) as f:
        hunks = json.load(f)

    model = train(hunks)
    if model is not None:
        torch.save(model, out_path)
        print(f"saved model to {out_path}")
        # Sanity-check against the demo's make-or-break threshold (the
        # gateway filters at score >= 0.5): a model that scores the
        # retry-cap hunk below it would silently kill the demo.
        retry_probe = {
            "file": "services/payments/client.py", "symbol": "", "hunk_hash": "probe",
            "old_start": 5, "old_end": 5, "new_start": 5, "new_end": 5,
            "old_lines": ["MAX_RETRIES = 3"], "new_lines": ["MAX_RETRIES = 50"],
        }
        score, _ = score_with_model(model, retry_probe)
        print(f"retry-cap probe score: {score} ({'OK' if score >= 0.5 else 'WARNING: below the 0.5 pipeline threshold'})")


if __name__ == "__main__":
    main()
