"""Writes seed/out/{knowledge,slack,linear,prs}.json from fences.yaml + the
RepoInfo produced by repo_builder.build_demo_repo().

Shapes follow docs/contracts.md "Seed outputs (seed/out/)" exactly.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import real_mode
from repo_builder import REPO_SLUG, PrEntry, RepoInfo

DEFAULT_MOCKS_BASE_URL = "http://localhost:4100"
SLACK_CHANNEL = "oncall"
SLACK_TS_START = 1700000000


def _mocks_base_url() -> str:
    return os.environ.get("MOCKS_BASE_URL", DEFAULT_MOCKS_BASE_URL)


def _humanize(fence_id: str) -> str:
    return fence_id.replace("-", " ")


def _maybe_real(fences: list) -> dict:
    """Best-effort real-mode posting. Returns {fence_id: {"slack": url|None,
    "linear": url|None}} — only populated when the matching token is set and
    the call succeeds; otherwise the caller falls back to mock URLs. Ends
    with a summary so partial fallbacks are visible, not silent.
    """
    real_urls: dict = {}
    have_slack = bool(os.environ.get("SLACK_BOT_TOKEN"))
    have_linear = bool(os.environ.get("LINEAR_API_KEY"))
    if not have_slack and not have_linear:
        return real_urls

    # chat.postMessage accepts a channel name, but chat.getPermalink wants a
    # channel ID — prefer SLACK_CHANNEL_ID when provided.
    slack_channel = os.environ.get("SLACK_CHANNEL_ID") or SLACK_CHANNEL

    slack_attempted = slack_ok = linear_attempted = linear_ok = 0
    fallbacks: list = []
    for fence in fences:
        entry = {}
        fell_back = False
        if have_slack and fence.get("slack"):
            slack_attempted += 1
            messages = [{"user": u, "text": t} for u, t in fence["slack"]]
            url = real_mode.post_slack_thread(slack_channel, messages)
            if url:
                slack_ok += 1
                entry["slack"] = url
                print("[real-mode] posted slack thread for %s -> %s" % (fence["id"], url))
            else:
                fell_back = True
        if have_linear and fence.get("linear"):
            linear_attempted += 1
            url = real_mode.create_linear_ticket(
                fence["linear"]["title"], fence.get("summary", "")
            )
            if url:
                linear_ok += 1
                entry["linear"] = url
                print("[real-mode] created linear ticket for %s -> %s" % (fence["id"], url))
            else:
                fell_back = True
        if entry:
            real_urls[fence["id"]] = entry
        if fell_back:
            fallbacks.append(fence["id"])

    print(
        "[real-mode summary] slack %d/%d real, linear %d/%d real%s"
        % (
            slack_ok,
            slack_attempted,
            linear_ok,
            linear_attempted,
            "; mock-URL fallbacks: %s" % ", ".join(fallbacks) if fallbacks else "",
        )
    )
    return real_urls


def build_slack_threads(fences: list):
    """Returns (slack_json, thread_by_fence_id)."""
    threads = []
    thread_by_fence_id = {}
    ts_counter = SLACK_TS_START
    for fence in fences:
        slack = fence.get("slack") or []
        if not slack:
            continue
        messages = []
        thread_ts = None
        for user, text in slack:
            ts = str(ts_counter)
            ts_counter += 1
            if thread_ts is None:
                thread_ts = ts
            messages.append({"user": user, "text": text, "ts": ts})
        thread = {
            "channel": SLACK_CHANNEL,
            "ts": thread_ts,
            "title": "#%s: %s" % (SLACK_CHANNEL, _humanize(fence["id"])),
            "messages": messages,
        }
        threads.append(thread)
        thread_by_fence_id[fence["id"]] = thread
    return {"threads": threads}, thread_by_fence_id


def build_linear_json(fences: list, mocks_base: str, real_urls: dict) -> dict:
    tickets = []
    for fence in fences:
        linear = fence.get("linear")
        if not linear:
            continue
        url = real_urls.get(fence["id"], {}).get("linear") or "%s/linear/issue/%s" % (
            mocks_base,
            linear["key"],
        )
        tickets.append(
            {
                "key": linear["key"],
                "title": linear["title"],
                "description": fence.get("summary", ""),
                "status": "Done",
                "url": url,
            }
        )
    return {"tickets": tickets}


def build_knowledge_json(
    fences: list,
    repo_info: RepoInfo,
    mocks_base: str,
    thread_by_fence_id: dict,
    real_urls: dict,
) -> dict:
    pr_by_fence = {
        # historical_prs is one-to-one with fences, in the same order
        fence["id"]: pr
        for fence, pr in zip(fences, repo_info.historical_prs)
    }

    fence_entries = []
    for fence in fences:
        anchor = repo_info.fence_anchors[fence["id"]]
        citations = []

        if fence.get("slack"):
            thread = thread_by_fence_id[fence["id"]]
            url = real_urls.get(fence["id"], {}).get("slack") or "%s/slack/archives/%s/p%s" % (
                mocks_base,
                thread["channel"],
                thread["ts"],
            )
            citations.append(
                {
                    "type": "slack",
                    "url": url,
                    "title": "#%s: %s" % (thread["channel"], _humanize(fence["id"])),
                }
            )

        if fence.get("linear"):
            key = fence["linear"]["key"]
            url = real_urls.get(fence["id"], {}).get("linear") or "%s/linear/issue/%s" % (
                mocks_base,
                key,
            )
            citations.append(
                {"type": "linear", "url": url, "title": "%s: %s" % (key, fence["linear"]["title"])}
            )

        if fence.get("pr"):
            pr: PrEntry = pr_by_fence[fence["id"]]
            # The historical "fix PRs" exist as real commits (not PRs) when the
            # demo repo is pushed to GitHub, so real mode cites the commit URL.
            real_repo_url = os.environ.get("REAL_REPO_URL", "").rstrip("/")
            if real_repo_url:
                url = "%s/commit/%s" % (real_repo_url, pr.head_sha)
            else:
                url = "%s/github/%s/pull/%d/files" % (mocks_base, REPO_SLUG, pr.number)
            citations.append({"type": "pr", "url": url, "title": pr.title})

        fence_entries.append(
            {
                "id": fence["id"],
                "file": anchor["file"],
                "line_start": anchor["line_start"],
                "line_end": anchor["line_end"],
                "code": fence["code"],
                "summary": fence.get("summary", ""),
                "citations": citations,
            }
        )

    return {"repo": REPO_SLUG, "fences": fence_entries}


def _pr_entry_to_dict(pr: PrEntry) -> dict:
    return {
        "number": pr.number,
        "title": pr.title,
        "branch": pr.branch,
        "base": pr.base,
        "head_sha": pr.head_sha,
        "diff_file": pr.diff_file,
        "author": pr.author,
    }


def build_prs_json(repo_info: RepoInfo) -> dict:
    prs = [_pr_entry_to_dict(pr) for pr in repo_info.demo_prs]
    prs.extend(_pr_entry_to_dict(pr) for pr in repo_info.historical_prs)
    return {"prs": prs}


def write_fixtures(fences: list, repo_info: RepoInfo, out_dir: Path) -> None:
    mocks_base = _mocks_base_url()
    real_urls = _maybe_real(fences)

    slack_json, thread_by_fence_id = build_slack_threads(fences)
    linear_json = build_linear_json(fences, mocks_base, real_urls)
    knowledge_json = build_knowledge_json(
        fences, repo_info, mocks_base, thread_by_fence_id, real_urls
    )
    prs_json = build_prs_json(repo_info)

    for name, data in (
        ("slack.json", slack_json),
        ("linear.json", linear_json),
        ("knowledge.json", knowledge_json),
        ("prs.json", prs_json),
    ):
        path = out_dir / name
        path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8", newline="\n")
