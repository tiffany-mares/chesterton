"""Unit tests for the rules-based triage scorer.

Each rule from the task brief must fire in isolation on a crafted hunk, and the
two demo-critical hunks (retry-cap removal vs. harmless rename) must land on
the correct side of the 0.5 threshold.
"""
import pytest

from rules import score_hunk


def make_hunk(old_lines, new_lines, file="services/payments/client.py"):
    return {
        "file": file,
        "old_start": 10,
        "old_end": 10 + max(len(old_lines) - 1, 0),
        "new_start": 10,
        "new_end": 10 + max(len(new_lines) - 1, 0),
        "old_lines": old_lines,
        "new_lines": new_lines,
        "symbol": "charge",
        "hunk_hash": "deadbeefcafef00d",
    }


def test_removed_conditional_fires():
    hunk = make_hunk(
        old_lines=["if not is_authorized(user):", "    raise PermissionError()"],
        new_lines=[],
    )
    score, reasons = score_hunk(hunk)
    assert "removed_conditional" in reasons
    assert score >= 0.6


def test_changed_numeric_constant_fires():
    hunk = make_hunk(old_lines=["BATCH_SIZE = 10"], new_lines=["BATCH_SIZE = 1000"])
    score, reasons = score_hunk(hunk)
    assert "changed_numeric_constant" in reasons
    assert score >= 0.5


def test_removed_retry_or_timeout_fires():
    hunk = make_hunk(
        old_lines=["response = call_with_timeout(req, timeout=5)"],
        new_lines=["response = call(req)"],
    )
    score, reasons = score_hunk(hunk)
    assert "removed_retry_or_timeout" in reasons
    assert score >= 0.4


def test_removed_error_handling_fires():
    hunk = make_hunk(
        old_lines=["try:", "    charge(user)", "except PaymentError:", "    log.error('failed')"],
        new_lines=["charge(user)"],
    )
    score, reasons = score_hunk(hunk)
    assert "removed_error_handling" in reasons
    assert score >= 0.5


def test_comment_only_change_forces_zero():
    hunk = make_hunk(
        old_lines=["# old explanation of retry cap"],
        new_lines=["# updated explanation of retry cap"],
    )
    score, reasons = score_hunk(hunk)
    assert score == 0.0
    assert reasons == ["comment_only_change"]


def test_rename_only_penalizes_to_floor_zero():
    hunk = make_hunk(
        old_lines=["total_price = unit_price * quantity"],
        new_lines=["grand_total = unit_cost * quantity"],
    )
    score, reasons = score_hunk(hunk)
    assert "rename_only" in reasons
    assert score == 0.0


def test_score_is_capped_at_one():
    hunk = make_hunk(
        old_lines=[
            "try:",
            "    if not is_authorized(user):",
            "        raise PermissionError()",
            "    response = call_with_timeout(req, timeout=5, retries=3)",
            "except PaymentError:",
            "    log.error('failed')",
        ],
        new_lines=["response = call(req)"],
    )
    score, reasons = score_hunk(hunk)
    assert score <= 1.0
    assert score == 1.0


def test_retry_cap_demo_hunk_scores_at_least_half():
    hunk = make_hunk(old_lines=["MAX_RETRIES = 3"], new_lines=["MAX_RETRIES = 50"])
    score, reasons = score_hunk(hunk)
    assert score >= 0.5
    assert "changed_numeric_constant" in reasons


def test_rename_refactor_demo_hunk_scores_below_half():
    hunk = make_hunk(
        old_lines=["for item in items:", "    total += item.qty"],
        new_lines=["for entry in items:", "    total += entry.qty"],
        file="services/inventory/stock.py",
    )
    score, reasons = score_hunk(hunk)
    assert score < 0.5


def test_keyword_inside_identifier_does_not_fire_removed_conditional():
    # "if" is a keyword, but "skip_if_empty" is a single identifier token -
    # removing/adding this line must not be treated as removing a conditional.
    hunk = make_hunk(
        old_lines=["skip_if_empty = True"],
        new_lines=["skip_if_empty = False"],
    )
    score, reasons = score_hunk(hunk)
    assert "removed_conditional" not in reasons


def test_max_retries_identifier_still_fires_removed_retry_or_timeout():
    hunk = make_hunk(
        old_lines=["MAX_RETRIES = 3"],
        new_lines=["call(req)"],
    )
    score, reasons = score_hunk(hunk)
    assert "removed_retry_or_timeout" in reasons


def test_identifier_substring_does_not_falsely_match_keywords():
    # "classify" contains "if" and "class" as substrings, but is one
    # identifier token and must not fire any keyword-based rule.
    hunk = make_hunk(
        old_lines=["classify(record)"],
        new_lines=[],
    )
    score, reasons = score_hunk(hunk)
    assert "removed_conditional" not in reasons
    assert "removed_error_handling" not in reasons
    assert "removed_retry_or_timeout" not in reasons
