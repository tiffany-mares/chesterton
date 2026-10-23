"""Rules-based triage scorer.

Pure functions: given a Hunk (see docs/contracts.md), decide whether it looks
like it contradicts a recorded decision. No I/O, no framework dependencies —
this module is deliberately standalone so it can be unit tested in isolation
and reused by both the FastAPI app and the optional torch trainer.
"""
import re
from typing import Iterable

# Weights and reason strings per task-5-brief.md / docs/contracts.md. Keep in
# sync with the "triage (Python FastAPI)" section of docs/contracts.md.
WEIGHT_REMOVED_CONDITIONAL = 0.6
WEIGHT_CHANGED_NUMERIC_CONSTANT = 0.5
WEIGHT_REMOVED_RETRY_OR_TIMEOUT = 0.4
WEIGHT_REMOVED_ERROR_HANDLING = 0.5
RENAME_PENALTY = 0.5

REASON_REMOVED_CONDITIONAL = "removed_conditional"
REASON_CHANGED_NUMERIC_CONSTANT = "changed_numeric_constant"
REASON_REMOVED_RETRY_OR_TIMEOUT = "removed_retry_or_timeout"
REASON_REMOVED_ERROR_HANDLING = "removed_error_handling"
REASON_COMMENT_ONLY_CHANGE = "comment_only_change"
REASON_RENAME_ONLY = "rename_only"

_CONDITIONAL_KEYWORDS = {"if", "elif", "guard", "raise", "return"}
_ERROR_HANDLING_KEYWORDS = {"try", "except", "catch", "error"}
_RETRY_TIMEOUT_KEYWORDS = {"retry", "timeout", "limit", "cap"}
_NUMERIC_ASSIGNMENT_RE = re.compile(r"([A-Za-z_]\w*)\s*=\s*(-?\d+(?:\.\d+)?)")
_COMMENT_LINE_RE = re.compile(r"^\s*(#|//|/\*|\*)")
_TOKEN_RE = re.compile(r"[A-Za-z_]\w*|\d+\.\d+|\d+|'[^']*'|\"[^\"]*\"|\S")
_IDENTIFIER_TOKEN_RE = re.compile(r"^[A-Za-z_]\w*$")
# camelCase/underscore sub-word splitting for identifiers: runs of uppercase
# letters followed by lowercase/digits, or runs of lowercase/digits.
_CAMEL_SUBWORD_RE = re.compile(r"[A-Z]+[a-z0-9]*|[a-z0-9]+")
# Suffixes stripped (with their replacement) to normalize simple plural/verb
# forms before comparing a sub-word against a keyword, e.g. "retries" -> "retry".
_SUBWORD_SUFFIXES = (("ies", "y"), ("ying", "y"), ("ing", ""), ("ed", ""), ("es", ""), ("s", ""))


def _line_has_keyword_token(line: str, keywords: set[str]) -> bool:
    """True iff `line` contains one of `keywords` as a standalone code token.

    Tokens are produced by `_TOKEN_RE`, which already groups letters, digits,
    and underscores into a single identifier token - so `skip_if_empty` is one
    token and never equals the keyword `if`.
    """
    for token in _TOKEN_RE.findall(line):
        if token.lower() in keywords:
            return True
    return False


def _any_line_has_keyword_token(lines: Iterable[str], keywords: set[str]) -> bool:
    return any(_line_has_keyword_token(line, keywords) for line in lines)


def _split_identifier_subwords(identifier: str) -> list[str]:
    """Split an identifier into lowercase sub-words on `_` and camelCase."""
    subwords: list[str] = []
    for part in identifier.split("_"):
        if not part:
            continue
        subwords.extend(_CAMEL_SUBWORD_RE.findall(part))
    return [w.lower() for w in subwords if w]


def _stem_subword(word: str) -> str:
    """Strip a simple plural/verb suffix so e.g. "retries" stems to "retry"."""
    for suffix, replacement in _SUBWORD_SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            return word[: -len(suffix)] + replacement
    return word


def _line_has_retry_timeout_subword(line: str) -> bool:
    for token in _TOKEN_RE.findall(line):
        if not _IDENTIFIER_TOKEN_RE.match(token):
            continue
        for subword in _split_identifier_subwords(token):
            if subword in _RETRY_TIMEOUT_KEYWORDS or _stem_subword(subword) in _RETRY_TIMEOUT_KEYWORDS:
                return True
    return False


def _any_line_has_retry_timeout_subword(lines: Iterable[str]) -> bool:
    return any(_line_has_retry_timeout_subword(line) for line in lines)


def _is_comment_only_change(old_lines: list[str], new_lines: list[str]) -> bool:
    all_lines = old_lines + new_lines
    if not all_lines:
        return False
    return all(_COMMENT_LINE_RE.match(line) for line in all_lines)


def _removed_conditional(old_lines: list[str], new_lines: list[str]) -> bool:
    return _any_line_has_keyword_token(
        old_lines, _CONDITIONAL_KEYWORDS
    ) and not _any_line_has_keyword_token(new_lines, _CONDITIONAL_KEYWORDS)


def _numeric_assignments(lines: Iterable[str]) -> dict[str, str]:
    assignments: dict[str, str] = {}
    for line in lines:
        for identifier, number in _NUMERIC_ASSIGNMENT_RE.findall(line):
            assignments[identifier] = number
    return assignments


def _changed_numeric_constant(old_lines: list[str], new_lines: list[str]) -> bool:
    old_assignments = _numeric_assignments(old_lines)
    new_assignments = _numeric_assignments(new_lines)
    for identifier, old_value in old_assignments.items():
        new_value = new_assignments.get(identifier)
        if new_value is not None and new_value != old_value:
            return True
    return False


def _removed_retry_or_timeout(old_lines: list[str]) -> bool:
    return _any_line_has_retry_timeout_subword(old_lines)


def _removed_error_handling(old_lines: list[str], new_lines: list[str]) -> bool:
    return _any_line_has_keyword_token(
        old_lines, _ERROR_HANDLING_KEYWORDS
    ) and not _any_line_has_keyword_token(new_lines, _ERROR_HANDLING_KEYWORDS)


def _is_rename_only(old_lines: list[str], new_lines: list[str]) -> bool:
    if not old_lines or len(old_lines) != len(new_lines):
        return False
    if old_lines == new_lines:
        # Identical lines aren't a rename - nothing changed at all.
        return False
    for old_line, new_line in zip(old_lines, new_lines):
        old_tokens = _TOKEN_RE.findall(old_line)
        new_tokens = _TOKEN_RE.findall(new_line)
        if len(old_tokens) != len(new_tokens):
            return False
        for old_token, new_token in zip(old_tokens, new_tokens):
            old_is_identifier = bool(_IDENTIFIER_TOKEN_RE.match(old_token))
            new_is_identifier = bool(_IDENTIFIER_TOKEN_RE.match(new_token))
            if old_is_identifier and new_is_identifier:
                continue  # identifiers may differ - that's the rename
            if old_token != new_token:
                return False
    return True


def score_hunk(hunk: dict) -> tuple[float, list[str]]:
    """Score a single Hunk dict per docs/contracts.md. Returns (score, reasons)."""
    old_lines = hunk.get("old_lines") or []
    new_lines = hunk.get("new_lines") or []

    if _is_comment_only_change(old_lines, new_lines):
        return 0.0, [REASON_COMMENT_ONLY_CHANGE]

    score = 0.0
    reasons: list[str] = []

    if _removed_conditional(old_lines, new_lines):
        score += WEIGHT_REMOVED_CONDITIONAL
        reasons.append(REASON_REMOVED_CONDITIONAL)
    if _changed_numeric_constant(old_lines, new_lines):
        score += WEIGHT_CHANGED_NUMERIC_CONSTANT
        reasons.append(REASON_CHANGED_NUMERIC_CONSTANT)
    if _removed_retry_or_timeout(old_lines):
        score += WEIGHT_REMOVED_RETRY_OR_TIMEOUT
        reasons.append(REASON_REMOVED_RETRY_OR_TIMEOUT)
    if _removed_error_handling(old_lines, new_lines):
        score += WEIGHT_REMOVED_ERROR_HANDLING
        reasons.append(REASON_REMOVED_ERROR_HANDLING)

    score = min(score, 1.0)

    if _is_rename_only(old_lines, new_lines):
        score = max(0.0, score - RENAME_PENALTY)
        reasons.append(REASON_RENAME_ONLY)

    return round(score, 4), reasons
