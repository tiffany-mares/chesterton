"""Shared pytest fixtures for seed/tests.

Runs `python seed.py --out <tmp>` once per test session and hands the
resulting output directory to every test that needs it, so we don't pay the
cost of re-running the full git history build for every assertion.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

SEED_DIR = Path(__file__).resolve().parent.parent
SEED_PY = SEED_DIR / "seed.py"
FENCES_YAML = SEED_DIR / "fences.yaml"


def run_seed(out_dir, extra_args=None, env=None):
    args = [sys.executable, str(SEED_PY), "--out", str(out_dir)]
    if extra_args:
        args.extend(extra_args)
    return subprocess.run(args, capture_output=True, text=True, env=env)


@pytest.fixture(scope="session")
def fences():
    with open(FENCES_YAML, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)["fences"]


@pytest.fixture(scope="session")
def seeded_out(tmp_path_factory):
    """Run seed.py once into a session-scoped tmp dir; return the out dir."""
    out_dir = tmp_path_factory.mktemp("seed_out") / "out"
    result = run_seed(out_dir)
    assert result.returncode == 0, (
        f"seed.py failed (code {result.returncode}):\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
    return out_dir


@pytest.fixture(scope="session")
def repo_dir(seeded_out):
    return seeded_out / "demo-repo"


@pytest.fixture(scope="session")
def knowledge(seeded_out):
    with open(seeded_out / "knowledge.json", "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="session")
def slack_data(seeded_out):
    with open(seeded_out / "slack.json", "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="session")
def linear_data(seeded_out):
    with open(seeded_out / "linear.json", "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="session")
def prs_data(seeded_out):
    with open(seeded_out / "prs.json", "r", encoding="utf-8") as f:
        return json.load(f)


def git(repo_dir, *args):
    result = subprocess.run(
        ["git", *args], cwd=repo_dir, capture_output=True, text=True
    )
    assert result.returncode == 0, (
        f"git {' '.join(args)} failed:\n{result.stdout}\n{result.stderr}"
    )
    return result.stdout
