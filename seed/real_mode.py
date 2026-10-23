"""Optional "real mode" integrations for seed data.

UNTESTED. These two functions are only exercised when SLACK_BOT_TOKEN /
LINEAR_API_KEY are set in the environment (see docs/contracts.md "Modes").
Every call is wrapped in try/except; any failure (missing token, network
error, unexpected response shape) logs a line and returns None, and the
caller falls back to the usual mock URL. Kept deliberately thin — this is
not part of the demo's critical path, which runs with CHESTERTON_MODE=mock.
"""
from __future__ import annotations

import json
import os
import urllib.request


def _request(url, method="GET", payload=None, headers=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def post_slack_thread(channel: str, messages: list) -> str | None:
    """REAL MODE (untested): post a seeded [{user, text}] thread to Slack.

    Returns the thread's permalink URL, or None if SLACK_BOT_TOKEN is unset
    or anything about the call fails.
    """
    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        return None
    try:
        headers = {
            "Authorization": "Bearer %s" % token,
            "Content-Type": "application/json; charset=utf-8",
        }
        first = messages[0]
        resp = _request(
            "https://slack.com/api/chat.postMessage",
            method="POST",
            payload={"channel": channel, "text": "%s: %s" % (first["user"], first["text"])},
            headers=headers,
        )
        if not resp.get("ok"):
            print("[real-mode] slack postMessage failed: %s" % resp)
            return None
        thread_ts = resp["ts"]
        for msg in messages[1:]:
            _request(
                "https://slack.com/api/chat.postMessage",
                method="POST",
                payload={
                    "channel": channel,
                    "thread_ts": thread_ts,
                    "text": "%s: %s" % (msg["user"], msg["text"]),
                },
                headers=headers,
            )
        permalink_resp = _request(
            "https://slack.com/api/chat.getPermalink?channel=%s&message_ts=%s"
            % (channel, thread_ts),
            method="GET",
            headers=headers,
        )
        return permalink_resp.get("permalink")
    except Exception as exc:  # pragma: no cover - real network path, untested
        print("[real-mode] slack post raised: %s" % exc)
        return None


def create_linear_ticket(title: str, description: str) -> str | None:
    """REAL MODE (untested): create a real Linear issue via its GraphQL API.

    Returns the issue URL, or None if LINEAR_API_KEY is unset or anything
    about the call fails. Note: this creates the issue in whatever team is
    the API key's default; adjust the mutation's `teamId` if you need a
    specific team.
    """
    token = os.environ.get("LINEAR_API_KEY")
    if not token:
        return None
    try:
        headers = {"Authorization": token, "Content-Type": "application/json"}
        body = {
            "query": (
                "mutation($title: String!, $description: String!) {"
                " issueCreate(input: {title: $title, description: $description}) {"
                " success issue { url } } }"
            ),
            "variables": {"title": title, "description": description},
        }
        resp = _request(
            "https://api.linear.app/graphql", method="POST", payload=body, headers=headers
        )
        issue = (resp.get("data") or {}).get("issueCreate", {}).get("issue")
        return issue.get("url") if issue else None
    except Exception as exc:  # pragma: no cover - real network path, untested
        print("[real-mode] linear create raised: %s" % exc)
        return None
