"""Unit tests for seed/real_mode.py and the real-mode plumbing in
fixtures.py. No network: real_mode._request / the real_mode functions are
monkeypatched. These cover the real-mode fixes (Linear teamId, Slack channel
id + pacing, 429 backoff, end-of-run summary) — the actual API calls remain
exercisable only with real tokens.
"""
from __future__ import annotations

import io
import json
import sys
import urllib.error
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import fixtures
import real_mode


# ---------------------------------------------------------------------------
# create_linear_ticket: teamId handling
# ---------------------------------------------------------------------------


def test_linear_ticket_includes_team_id(monkeypatch):
    monkeypatch.setenv("LINEAR_API_KEY", "lin_test")
    monkeypatch.setenv("LINEAR_TEAM_ID", "team-123")
    captured = {}

    def fake_request(url, method="GET", payload=None, headers=None):
        captured["payload"] = payload
        return {"data": {"issueCreate": {"success": True, "issue": {"url": "https://linear.app/x/issue/ENG-1"}}}}

    monkeypatch.setattr(real_mode, "_request", fake_request)
    url = real_mode.create_linear_ticket("t", "d")
    assert url == "https://linear.app/x/issue/ENG-1"
    assert captured["payload"]["variables"]["teamId"] == "team-123"
    assert "$teamId" in captured["payload"]["query"]


def test_linear_ticket_without_team_id_fails_safe(monkeypatch, capsys):
    monkeypatch.setenv("LINEAR_API_KEY", "lin_test")
    monkeypatch.delenv("LINEAR_TEAM_ID", raising=False)
    monkeypatch.setattr(
        real_mode, "_request", lambda *a, **k: pytest.fail("must not call API without teamId")
    )
    assert real_mode.create_linear_ticket("t", "d") is None
    assert "LINEAR_TEAM_ID" in capsys.readouterr().out


# ---------------------------------------------------------------------------
# _request: 429 backoff
# ---------------------------------------------------------------------------


def test_request_retries_on_429(monkeypatch):
    calls = {"n": 0}
    slept = []

    def fake_urlopen(req, timeout=10):
        calls["n"] += 1
        if calls["n"] == 1:
            raise urllib.error.HTTPError(
                req.full_url, 429, "rate limited", {"Retry-After": "2"}, io.BytesIO(b"{}")
            )
        return io.BytesIO(json.dumps({"ok": True}).encode("utf-8"))

    monkeypatch.setattr(real_mode.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(real_mode.time, "sleep", slept.append)
    resp = real_mode._request("https://slack.com/api/x", method="POST", payload={})
    assert resp == {"ok": True}
    assert calls["n"] == 2
    assert slept == [2.0]


def test_request_gives_up_after_max_429s(monkeypatch):
    def always_429(req, timeout=10):
        raise urllib.error.HTTPError(
            req.full_url, 429, "rate limited", {"Retry-After": "1"}, io.BytesIO(b"{}")
        )

    monkeypatch.setattr(real_mode.urllib.request, "urlopen", always_429)
    monkeypatch.setattr(real_mode.time, "sleep", lambda s: None)
    with pytest.raises(urllib.error.HTTPError):
        real_mode._request("https://slack.com/api/x", method="POST", payload={})


# ---------------------------------------------------------------------------
# post_slack_thread: paced replies
# ---------------------------------------------------------------------------


def test_slack_thread_paces_messages(monkeypatch):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    slept = []
    monkeypatch.setattr(real_mode.time, "sleep", slept.append)
    responses = iter(
        [
            {"ok": True, "ts": "1.0"},
            {"ok": True, "ts": "1.1"},
            {"ok": True, "ts": "1.2"},
            {"permalink": "https://acme.slack.com/archives/C1/p10"},
        ]
    )
    monkeypatch.setattr(real_mode, "_request", lambda *a, **k: next(responses))
    url = real_mode.post_slack_thread(
        "C1",
        [{"user": "a", "text": "x"}, {"user": "b", "text": "y"}, {"user": "c", "text": "z"}],
    )
    assert url == "https://acme.slack.com/archives/C1/p10"
    # one pause per message after the first
    assert len(slept) == 2


# ---------------------------------------------------------------------------
# fixtures._maybe_real: channel id + end-of-run summary
# ---------------------------------------------------------------------------


def _two_fences():
    return [
        {
            "id": "retry-cap",
            "slack": [["priya", "incident"]],
            "linear": {"key": "ENG-212", "title": "Cap retries"},
        },
        {
            "id": "oversell-guard",
            "slack": [["marcus", "oversold"]],
            "linear": {"key": "ENG-300", "title": "Guard stock"},
        },
    ]


def test_maybe_real_uses_slack_channel_id_env(monkeypatch):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setenv("SLACK_CHANNEL_ID", "C0ONCALL")
    monkeypatch.delenv("LINEAR_API_KEY", raising=False)
    channels = []

    def fake_post(channel, messages):
        channels.append(channel)
        return "https://acme.slack.com/archives/C0ONCALL/p1"

    monkeypatch.setattr(fixtures.real_mode, "post_slack_thread", fake_post)
    fixtures._maybe_real(_two_fences())
    assert channels == ["C0ONCALL", "C0ONCALL"]


def test_maybe_real_prints_fallback_summary(monkeypatch, capsys):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setenv("LINEAR_API_KEY", "lin_test")
    monkeypatch.delenv("SLACK_CHANNEL_ID", raising=False)
    # slack succeeds for the first fence only; linear always fails
    monkeypatch.setattr(
        fixtures.real_mode,
        "post_slack_thread",
        lambda channel, messages: "https://x/p1" if messages[0]["user"] == "priya" else None,
    )
    monkeypatch.setattr(fixtures.real_mode, "create_linear_ticket", lambda t, d: None)
    fixtures._maybe_real(_two_fences())
    out = capsys.readouterr().out
    assert "real-mode summary" in out
    assert "slack 1/2" in out
    assert "linear 0/2" in out
    assert "oversell-guard" in out  # named as a fallback
