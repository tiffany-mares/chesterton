"""Dump a hunks.json training corpus for train_torch.py.

Feeds every seeded PR diff (seed/out/prs/*.diff — the 3 demo PRs plus the
historical fix PRs) through the running diff-analyzer's POST /analyze and
writes the collected hunks as one JSON list. train_torch.py labels them with
the rules scorer, so no hand labelling is needed.

Usage (analyzer must be running — bare metal or the compose stack):
    python dump_corpus.py [--diff-dir ../seed/out/prs] [--out hunks.json]
Env: ANALYZER_URL (default http://localhost:4200)
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import urllib.request

DEFAULT_DIFF_DIR = os.path.join(os.path.dirname(__file__), "..", "seed", "out", "prs")


def analyze(analyzer_url: str, diff_text: str) -> list[dict]:
    req = urllib.request.Request(
        analyzer_url + "/analyze",
        data=json.dumps({"diff": diff_text}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))["hunks"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--diff-dir", default=DEFAULT_DIFF_DIR)
    parser.add_argument("--out", default="hunks.json")
    args = parser.parse_args()

    analyzer_url = os.environ.get("ANALYZER_URL", "http://localhost:4200")
    diff_paths = sorted(glob.glob(os.path.join(args.diff_dir, "*.diff")))
    if not diff_paths:
        print("no .diff files under %s — run seed/seed.py first" % args.diff_dir, file=sys.stderr)
        return 1

    hunks: list[dict] = []
    for path in diff_paths:
        with open(path, encoding="utf-8") as f:
            diff_text = f.read()
        found = analyze(analyzer_url, diff_text)
        hunks.extend(found)
        print("%s: %d hunks" % (os.path.basename(path), len(found)))

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(hunks, f, indent=2)
    print("wrote %d hunks to %s" % (len(hunks), args.out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
