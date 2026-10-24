"""Tests for seed/seed.py against docs/contracts.md's "Seed outputs" section.

Run with: python -m pytest seed/tests -v   (from the repo root)
"""
from __future__ import annotations

from pathlib import Path

from conftest import git, run_seed

MOCKS_BASE_URL = "http://localhost:4100"
REPO_SLUG = "acme/storefront"


# ---------------------------------------------------------------------------
# demo-repo: branches, backdated history, fence code lines present
# ---------------------------------------------------------------------------


def test_demo_repo_exists(repo_dir):
    assert repo_dir.is_dir()
    assert (repo_dir / ".git").is_dir()


def test_demo_repo_has_exactly_the_three_demo_branches_plus_main(repo_dir):
    out = git(repo_dir, "branch", "--format=%(refname:short)")
    branches = {b.strip() for b in out.splitlines() if b.strip()}
    assert branches == {
        "main",
        "demo/retry-cap-removal",
        "demo/harmless-refactor",
        "demo/timeout-change",
    }


def test_demo_repo_is_checked_out_on_main(repo_dir):
    out = git(repo_dir, "rev-parse", "--abbrev-ref", "HEAD")
    assert out.strip() == "main"


def test_main_has_scaffold_commit_plus_one_fix_commit_per_fence(repo_dir, fences):
    out = git(repo_dir, "log", "--format=%s", "main")
    messages = out.splitlines()
    # one scaffold commit + one fix commit per fence
    assert len(messages) == 1 + len(fences)
    fix_titles = {f["pr"]["title"] for f in fences}
    assert fix_titles.issubset(set(messages))


def test_commits_have_backdated_author_and_several_fake_authors(repo_dir, fences):
    out = git(repo_dir, "log", "--format=%an|%ad", "--date=short", "main")
    lines = [l for l in out.splitlines() if l]
    authors = {l.split("|")[0] for l in lines}
    # several fake authors, including Person 1 and Person 2 per the brief
    assert "Person 1" in authors
    assert "Person 2" in authors
    assert len(authors) >= 4
    # all commit dates are backdated (well before this task was written)
    dates = {l.split("|")[1] for l in lines}
    assert all(d < "2025-01-01" for d in dates)


def test_every_fence_code_line_present_in_its_file(repo_dir, fences):
    for fence in fences:
        content = (repo_dir / fence["file"]).read_text(encoding="utf-8")
        stripped_lines = [l.strip() for l in content.splitlines()]
        assert fence["code"] in stripped_lines, (
            f"fence {fence['id']!r} code line {fence['code']!r} "
            f"not found verbatim in {fence['file']}"
        )


def test_no_leftover_fence_markers(repo_dir, fences):
    files = {fence["file"] for fence in fences}
    for rel_path in files:
        content = (repo_dir / rel_path).read_text(encoding="utf-8")
        assert "@@" not in content, f"leftover marker token in {rel_path}"


# ---------------------------------------------------------------------------
# knowledge.json
# ---------------------------------------------------------------------------


def test_knowledge_json_shape(knowledge):
    assert knowledge["repo"] == REPO_SLUG
    assert isinstance(knowledge["fences"], list)


def test_knowledge_json_has_one_entry_per_fence(knowledge, fences):
    assert len(knowledge["fences"]) == len(fences)
    ids = {f["id"] for f in knowledge["fences"]}
    assert ids == {f["id"] for f in fences}


def test_knowledge_json_line_anchors_point_at_the_right_lines(knowledge, repo_dir):
    for entry in knowledge["fences"]:
        file_path = repo_dir / entry["file"]
        lines = file_path.read_text(encoding="utf-8").splitlines()
        assert entry["line_start"] == entry["line_end"]
        actual_line = lines[entry["line_start"] - 1].strip()
        assert actual_line == entry["code"], (
            f"{entry['id']}: anchor {entry['line_start']} in {entry['file']} "
            f"is {actual_line!r}, expected {entry['code']!r}"
        )


def test_knowledge_json_citations_shape_and_urls(knowledge):
    for entry in knowledge["fences"]:
        assert entry["citations"], f"{entry['id']} has no citations"
        for cite in entry["citations"]:
            assert set(cite.keys()) == {"type", "url", "title"}
            assert cite["type"] in {"slack", "linear", "pr", "override"}
            assert cite["url"].startswith(MOCKS_BASE_URL)


def test_retry_cap_fence_matches_build_plan_example(knowledge):
    by_id = {f["id"]: f for f in knowledge["fences"]}
    retry_cap = by_id["retry-cap"]
    assert retry_cap["file"] == "services/payments/client.py"
    assert retry_cap["code"] == "MAX_RETRIES = 3"
    types = {c["type"] for c in retry_cap["citations"]}
    assert types == {"slack", "linear", "pr"}
    linear_cite = next(c for c in retry_cap["citations"] if c["type"] == "linear")
    assert "ENG-212" in linear_cite["url"] or "ENG-212" in linear_cite["title"]


def test_knowledge_answers_where_is_the_retry_cap_fence(knowledge):
    """Done-when criterion: knowledge.json answers "where is the retry cap fence"."""
    by_id = {f["id"]: f for f in knowledge["fences"]}
    retry_cap = by_id["retry-cap"]
    assert retry_cap["file"] == "services/payments/client.py"
    assert retry_cap["line_start"] > 0


def test_checkout_timeout_comment_fence_anchors_the_comment_not_the_constant(knowledge):
    by_id = {f["id"]: f for f in knowledge["fences"]}
    comment_fence = by_id["checkout-timeout-comment"]
    assert comment_fence["code"] == "# timeout is 30s, see ENG-310"


# ---------------------------------------------------------------------------
# slack.json / linear.json
# ---------------------------------------------------------------------------


def test_slack_json_shape(slack_data, fences):
    assert len(slack_data["threads"]) == len(fences)
    for thread in slack_data["threads"]:
        assert set(thread.keys()) == {"channel", "ts", "title", "messages"}
        assert thread["channel"] == "oncall"
        for msg in thread["messages"]:
            assert set(msg.keys()) == {"user", "text", "ts"}


def test_slack_json_has_unique_ts_values(slack_data):
    # Every message across every thread has its own ts. A thread's own "ts"
    # field is defined as its first message's ts (contracts.md shows the
    # thread permalink as /p{ts} of that first message) so it's expected to
    # duplicate exactly one message ts per thread, not counted here.
    all_message_ts = [
        m["ts"] for thread in slack_data["threads"] for m in thread["messages"]
    ]
    assert len(all_message_ts) == len(set(all_message_ts))
    for thread in slack_data["threads"]:
        assert thread["ts"] == thread["messages"][0]["ts"]


def test_retry_cap_slack_thread_matches_build_plan(slack_data):
    texts = []
    for thread in slack_data["threads"]:
        for msg in thread["messages"]:
            texts.append((msg["user"], msg["text"]))
    assert ("Person 1", "checkout is hammering payments, retries are unbounded") in texts
    assert ("Person 2", "capping at 3 with backoff, ticket incoming") in texts


def test_linear_json_shape(linear_data, fences):
    assert len(linear_data["tickets"]) == len(fences)
    keys = {t["key"] for t in linear_data["tickets"]}
    assert keys == {f["linear"]["key"] for f in fences}
    for ticket in linear_data["tickets"]:
        assert set(ticket.keys()) == {"key", "title", "description", "status", "url"}
        assert ticket["url"].startswith(MOCKS_BASE_URL)


def test_eng_212_ticket_present(linear_data):
    by_key = {t["key"]: t for t in linear_data["tickets"]}
    assert by_key["ENG-212"]["title"] == "Cap payment retries at 3"


# ---------------------------------------------------------------------------
# prs.json + prs/{n}.diff — the three demo PRs and their expected diffs
# ---------------------------------------------------------------------------


def test_prs_json_contains_the_three_demo_prs(prs_data):
    demo_prs = {p["number"]: p for p in prs_data["prs"] if p["number"] in (1, 2, 3)}
    assert set(demo_prs) == {1, 2, 3}
    assert demo_prs[1]["branch"] == "demo/retry-cap-removal"
    assert demo_prs[2]["branch"] == "demo/harmless-refactor"
    assert demo_prs[3]["branch"] == "demo/timeout-change"
    for pr in demo_prs.values():
        assert pr["base"] == "main"
        assert pr["diff_file"] == f"prs/{pr['number']}.diff"
        assert isinstance(pr["head_sha"], str) and len(pr["head_sha"]) == 40


def test_prs_json_head_shas_match_actual_branch_tips(prs_data, repo_dir):
    demo_prs = {p["number"]: p for p in prs_data["prs"] if p["number"] in (1, 2, 3)}
    for number, branch in (
        (1, "demo/retry-cap-removal"),
        (2, "demo/harmless-refactor"),
        (3, "demo/timeout-change"),
    ):
        actual_sha = git(repo_dir, "rev-parse", branch).strip()
        assert demo_prs[number]["head_sha"] == actual_sha


def test_pr1_diff_changes_max_retries_from_3_to_50(seeded_out):
    diff = (seeded_out / "prs" / "1.diff").read_text(encoding="utf-8")
    assert "services/payments/client.py" in diff
    assert "-MAX_RETRIES = 3" in diff
    assert "+MAX_RETRIES = 50" in diff


def test_pr2_diff_is_a_harmless_rename_touching_no_fence_lines(seeded_out, fences):
    diff = (seeded_out / "prs" / "2.diff").read_text(encoding="utf-8")
    assert "services/inventory/stock.py" in diff
    for fence in fences:
        assert f"-{fence['code']}" not in diff, (
            f"PR2 (harmless refactor) unexpectedly touches fence {fence['id']!r} line"
        )


def test_pr3_diff_changes_timeout_and_leaves_comment_intact(seeded_out):
    diff = (seeded_out / "prs" / "3.diff").read_text(encoding="utf-8")
    assert "services/checkout/api.py" in diff
    assert "-CHECKOUT_TIMEOUT_SECONDS = 30" in diff
    assert "+CHECKOUT_TIMEOUT_SECONDS = 5" in diff
    # the comment line above the constant must NOT be removed/changed
    assert "-# timeout is 30s, see ENG-310" not in diff


# ---------------------------------------------------------------------------
# --reset / re-run behaviour
# ---------------------------------------------------------------------------


def test_reset_flag_wipes_and_reseeds(tmp_path):
    out_dir = tmp_path / "out"
    first = run_seed(out_dir)
    assert first.returncode == 0
    marker = out_dir / "demo-repo" / "canary.txt"
    marker.write_text("should be removed by --reset")

    second = run_seed(out_dir, extra_args=["--reset"])
    assert second.returncode == 0
    assert not marker.exists()
    assert (out_dir / "knowledge.json").exists()


def test_seeding_into_existing_empty_dir_succeeds(tmp_path):
    # The compose seed job's --out is a volume MOUNT POINT: it already exists
    # (and is empty) on first run, and can never be rmdir'd. Both runs below
    # must work without removing the directory itself.
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    first = run_seed(out_dir)
    assert first.returncode == 0
    assert (out_dir / "knowledge.json").exists()


def test_reset_preserves_the_out_dir_itself(tmp_path):
    # --reset must clear contents, not delete+recreate the directory, so a
    # mounted volume keeps working (inode stays the same).
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    ino_before = out_dir.stat().st_ino
    assert run_seed(out_dir).returncode == 0
    assert run_seed(out_dir, extra_args=["--reset"]).returncode == 0
    assert out_dir.stat().st_ino == ino_before
    assert (out_dir / "knowledge.json").exists()


def test_rerun_without_reset_errors_cleanly(tmp_path):
    out_dir = tmp_path / "out"
    first = run_seed(out_dir)
    assert first.returncode == 0

    second = run_seed(out_dir)
    assert second.returncode != 0
    assert second.stderr.strip() != ""
    # no raw Python traceback leaking to the user
    assert "Traceback" not in second.stderr
