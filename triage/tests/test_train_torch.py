"""train_torch.py must be safe to import and run even when torch is not
installed (requirements.txt deliberately omits torch; see requirements-ml.txt).
It is an optional, best-effort trainer, never a hard dependency of the service.
"""
import subprocess
import sys

import train_torch


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
