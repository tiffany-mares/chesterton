"""Builds the storefront demo repo at seed/out/demo-repo.

Produces a real git repository with backdated commits from several fake
authors: an initial scaffold commit (every fence still a `@@<fence-id>@@`
placeholder), then one "fix" commit per fence that swaps the placeholder for
the fence's exact `code` line. The fix commit message is the fence's
`pr.title` (e.g. "Cap payment retries (fixes ENG-212)"), authored by
`pr.author`.

After history is built, three demo branches are created off main's tip with
exactly the changes described in docs/contracts.md, and their diffs are
written to seed/out/prs/{1,2,3}.diff.

All dates/authors/content are fixed strings — no wall-clock or random input
anywhere — so re-running on the same machine with the same git version
reproduces the same tree and (best effort) the same commit hashes.
"""
from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from demo_repo_content import FILE_TEMPLATES, STATIC_FILES

REPO_OWNER = "acme"
REPO_NAME = "storefront"
REPO_SLUG = f"{REPO_OWNER}/{REPO_NAME}"

# Fixed, backdated clock. No use of datetime.now() anywhere in this module.
SCAFFOLD_DATE = datetime(2023, 11, 1, 9, 0, 0)
DEMO_BRANCH_DATE = datetime(2024, 1, 15, 10, 0, 0)
TZ_OFFSET = "-08:00"

AUTHORS = {
    "Person 5": "person5@storefront.example",
    "Person 2": "person2@storefront.example",
    "Person 1": "person1@storefront.example",
    "Person 7": "person7@storefront.example",
    "Person 3": "person3@storefront.example",
    "Person 4": "person4@storefront.example",
    "Person 6": "person6@storefront.example",
}

SCAFFOLD_AUTHOR = "Person 5"


def _marker(fence_id: str) -> str:
    return "@@%s@@" % fence_id


def _placeholder(fence_id: str, linear_key: str) -> str:
    return "# TODO(seed): fence %s pending fix (%s)" % (fence_id, linear_key)


def _git(repo_dir: Path, args, env=None):
    result = subprocess.run(
        ["git", *args],
        cwd=repo_dir,
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "git %s failed:\nstdout: %s\nstderr: %s"
            % (" ".join(args), result.stdout, result.stderr)
        )
    return result.stdout


def _write(repo_dir: Path, rel_path: str, content: str) -> None:
    path = repo_dir / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    # Explicit newline="\n" keeps commits byte-for-byte deterministic
    # regardless of platform line-ending defaults.
    path.write_text(content, encoding="utf-8", newline="\n")


def _commit(repo_dir: Path, base_env, message: str, author: str, when: datetime) -> str:
    email = AUTHORS[author]
    date_str = when.strftime("%Y-%m-%dT%H:%M:%S") + TZ_OFFSET
    env = dict(base_env)
    env.update(
        {
            "GIT_AUTHOR_NAME": author,
            "GIT_AUTHOR_EMAIL": email,
            "GIT_AUTHOR_DATE": date_str,
            "GIT_COMMITTER_NAME": author,
            "GIT_COMMITTER_EMAIL": email,
            "GIT_COMMITTER_DATE": date_str,
        }
    )
    _git(repo_dir, ["commit", "-q", "-m", message], env=env)
    return _git(repo_dir, ["rev-parse", "HEAD"], env=env).strip()


@dataclass
class PrEntry:
    number: int
    title: str
    branch: str
    base: str
    head_sha: str
    diff_file: str
    author: str


@dataclass
class RepoInfo:
    repo_dir: Path
    fence_anchors: dict  # fence_id -> {"file": str, "line_start": int, "line_end": int}
    demo_prs: list = field(default_factory=list)  # list[PrEntry]
    historical_prs: list = field(default_factory=list)  # list[PrEntry]


def _resolve_line_number(content: str, code: str) -> int:
    lines = content.splitlines()
    for i, line in enumerate(lines, start=1):
        if line.strip() == code:
            return i
    raise AssertionError("code line %r not found in content" % code)


def build_demo_repo(fences: list, out_dir: Path) -> RepoInfo:
    repo_dir = out_dir / "demo-repo"
    repo_dir.mkdir(parents=True, exist_ok=True)

    base_env = dict(os.environ)
    # Deterministic committer/author identity regardless of global git config.
    base_env.pop("GIT_AUTHOR_NAME", None)
    base_env.pop("GIT_AUTHOR_EMAIL", None)
    base_env.pop("GIT_COMMITTER_NAME", None)
    base_env.pop("GIT_COMMITTER_EMAIL", None)

    _git(repo_dir, ["init", "-q"], env=base_env)
    _git(repo_dir, ["symbolic-ref", "HEAD", "refs/heads/main"], env=base_env)
    # Full local control over line endings so diffs are byte-stable.
    _git(repo_dir, ["config", "core.autocrlf", "false"], env=base_env)
    _git(repo_dir, ["config", "core.safecrlf", "false"], env=base_env)

    # 1. Write scaffold content: every fence marker -> a pending placeholder.
    current_content = {}
    fences_by_id = {f["id"]: f for f in fences}
    for rel_path, template in FILE_TEMPLATES.items():
        content = template
        for fence_id, fence in fences_by_id.items():
            marker = _marker(fence_id)
            if marker in content:
                placeholder = _placeholder(fence_id, fence["linear"]["key"])
                content = content.replace(marker, placeholder)
        current_content[rel_path] = content
        _write(repo_dir, rel_path, content)

    for rel_path, content in STATIC_FILES.items():
        _write(repo_dir, rel_path, content)

    _git(repo_dir, ["add", "-A"], env=base_env)
    scaffold_sha = _commit(
        repo_dir,
        base_env,
        "Initial storefront scaffold",
        SCAFFOLD_AUTHOR,
        SCAFFOLD_DATE,
    )

    # 2. One fix commit per fence: swap the placeholder for the real code.
    historical_prs = []
    parent_sha = scaffold_sha
    for idx, fence in enumerate(fences):
        rel_path = fence["file"]
        placeholder = _placeholder(fence["id"], fence["linear"]["key"])
        before = current_content[rel_path]
        after = before.replace(placeholder, fence["code"])
        if after == before:
            raise AssertionError(
                "fix for fence %r made no change to %s" % (fence["id"], rel_path)
            )
        current_content[rel_path] = after
        _write(repo_dir, rel_path, after)

        _git(repo_dir, ["add", rel_path], env=base_env)
        commit_date = SCAFFOLD_DATE + timedelta(days=idx + 1)
        fix_sha = _commit(
            repo_dir,
            base_env,
            fence["pr"]["title"],
            fence["pr"]["author"],
            commit_date,
        )

        diff_text = _git(repo_dir, ["diff", parent_sha, fix_sha, "--", rel_path], env=base_env)
        number = 101 + idx
        historical_prs.append(
            PrEntry(
                number=number,
                title=fence["pr"]["title"],
                branch="fix/%s" % fence["id"],
                base="main",
                head_sha=fix_sha,
                diff_file="prs/%d.diff" % number,
                author=fence["pr"]["author"],
            )
        )
        (out_dir / "prs").mkdir(parents=True, exist_ok=True)
        (out_dir / "prs" / ("%d.diff" % number)).write_text(
            diff_text, encoding="utf-8", newline="\n"
        )

        parent_sha = fix_sha

    main_tip = parent_sha

    # Sanity check: every fence's code line is now really in its file.
    fence_anchors = {}
    for fence in fences:
        content = current_content[fence["file"]]
        line_no = _resolve_line_number(content, fence["code"])
        fence_anchors[fence["id"]] = {
            "file": fence["file"],
            "line_start": line_no,
            "line_end": line_no,
        }

    # 3. Demo branches off main's tip, each with exactly one contrived change.
    demo_prs = []

    def make_demo_branch(number, branch_name, rel_path, old_text, new_text, message, author, minute_offset):
        _git(repo_dir, ["checkout", "-q", "-b", branch_name, "main"], env=base_env)
        content = current_content[rel_path]
        if old_text not in content:
            raise AssertionError(
                "demo branch %r: %r not found in %s" % (branch_name, old_text, rel_path)
            )
        new_content = content.replace(old_text, new_text, 1)
        _write(repo_dir, rel_path, new_content)
        _git(repo_dir, ["add", rel_path], env=base_env)
        commit_date = DEMO_BRANCH_DATE + timedelta(minutes=minute_offset)
        head_sha = _commit(repo_dir, base_env, message, author, commit_date)
        diff_text = _git(repo_dir, ["diff", "main...%s" % branch_name], env=base_env)
        (out_dir / "prs").mkdir(parents=True, exist_ok=True)
        (out_dir / "prs" / ("%d.diff" % number)).write_text(
            diff_text, encoding="utf-8", newline="\n"
        )
        demo_prs.append(
            PrEntry(
                number=number,
                title=message,
                branch=branch_name,
                base="main",
                head_sha=head_sha,
                diff_file="prs/%d.diff" % number,
                author=author,
            )
        )
        _git(repo_dir, ["checkout", "-q", "main"], env=base_env)

    # PR 1: retry-cap-removal — MAX_RETRIES = 3 -> 50 (contradicts retry-cap fence)
    make_demo_branch(
        1,
        "demo/retry-cap-removal",
        "services/payments/client.py",
        "MAX_RETRIES = 3",
        "MAX_RETRIES = 50",
        "Bump payment retry limit for a flaky provider",
        "Person 2",
        0,
    )

    # PR 2: harmless-refactor — rename a local variable, touches no fence line
    make_demo_branch(
        2,
        "demo/harmless-refactor",
        "services/inventory/stock.py",
        'label = "%s: %d available" % (stock.sku, stock.available)\n    return label',
        'summary_text = "%s: %d available" % (stock.sku, stock.available)\n    return summary_text',
        "Refactor: rename local variable in stock describe() for clarity",
        "Person 4",
        5,
    )

    # PR 3: timeout-change — CHECKOUT_TIMEOUT_SECONDS = 30 -> 5, comment untouched
    make_demo_branch(
        3,
        "demo/timeout-change",
        "services/checkout/api.py",
        "CHECKOUT_TIMEOUT_SECONDS = 30",
        "CHECKOUT_TIMEOUT_SECONDS = 5",
        "Reduce checkout timeout for faster failover",
        "Person 7",
        10,
    )

    assert main_tip == _git(repo_dir, ["rev-parse", "main"], env=base_env).strip()

    return RepoInfo(
        repo_dir=repo_dir,
        fence_anchors=fence_anchors,
        demo_prs=demo_prs,
        historical_prs=historical_prs,
    )
