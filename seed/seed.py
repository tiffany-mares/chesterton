#!/usr/bin/env python
"""Seed the Chesterton demo world.

Builds seed/out/demo-repo (a real git repo for the fake "acme/storefront"
storefront, with backdated commits and three demo branches) plus the JSON
fixtures the mock Estelle and mock GitHub services read: knowledge.json,
slack.json, linear.json, prs.json and prs/{n}.diff.

See docs/contracts.md "Seed outputs (seed/out/)" for the exact shapes, and
docs/build_plan.md Phase 1 for the narrative this models.

Usage:
    python seed.py [--reset] [--out seed/out]

Optional real mode: set SLACK_BOT_TOKEN / LINEAR_API_KEY to post real Slack
threads / create real Linear tickets instead of relying purely on mock URLs
(see real_mode.py — untested, best-effort, falls back to mocks on failure).
"""
from __future__ import annotations

import argparse
import os
import shutil
import stat
import sys
from pathlib import Path

import yaml

from fixtures import write_fixtures
from repo_builder import build_demo_repo

SEED_DIR = Path(__file__).resolve().parent
DEFAULT_OUT = SEED_DIR / "out"
FENCES_FILE = SEED_DIR / "fences.yaml"


def load_fences() -> list:
    with open(FENCES_FILE, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return data["fences"]


def _rmtree(path: Path) -> None:
    """shutil.rmtree, but tolerant of git's read-only object files on Windows.

    Chmod only on failure: pre-chmodding everything to S_IWRITE (0o200)
    strips read/execute from directories on POSIX, which makes them
    untraversable and breaks the removal it was trying to help.
    """

    def _onexc(func, p, _exc):
        os.chmod(p, stat.S_IWRITE)
        func(p)

    shutil.rmtree(path, onexc=_onexc)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--reset", action="store_true", help="delete the output directory first"
    )
    parser.add_argument(
        "--out",
        default=str(DEFAULT_OUT),
        help="output directory (default: seed/out, next to this script)",
    )
    args = parser.parse_args(argv)

    out_dir = Path(args.out).resolve()

    if args.reset and out_dir.exists():
        _rmtree(out_dir)

    if out_dir.exists():
        print(
            "error: %s already exists. Re-run with --reset to wipe and re-seed."
            % out_dir,
            file=sys.stderr,
        )
        return 1

    out_dir.mkdir(parents=True, exist_ok=False)

    fences = load_fences()
    print("Seeding demo world into %s (%d fences) ..." % (out_dir, len(fences)))

    repo_info = build_demo_repo(fences, out_dir)
    write_fixtures(fences, repo_info, out_dir)

    print("Done.")
    print("  demo repo: %s" % repo_info.repo_dir)
    print("  fixtures:  %s" % out_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
