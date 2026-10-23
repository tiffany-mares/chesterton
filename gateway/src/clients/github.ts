/** Thin client for the GitHub API (real or mocked via GITHUB_API_URL) per docs/contracts.md. */

import type { GithubPr } from "../types.js";

const DIFF_ACCEPT = "application/vnd.github.v3.diff";

function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  return { owner, name };
}

function authHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getPr(
  githubApiUrl: string,
  repo: string,
  pr: number,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<GithubPr> {
  const { owner, name } = splitRepo(repo);
  const res = await fetchImpl(`${githubApiUrl}/repos/${owner}/${name}/pulls/${pr}`, {
    headers: { ...authHeaders(token) },
  });
  if (!res.ok) {
    throw new Error(`GitHub GET pulls/${pr} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as GithubPr;
}

export async function getPrDiff(
  githubApiUrl: string,
  repo: string,
  pr: number,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const { owner, name } = splitRepo(repo);
  const res = await fetchImpl(`${githubApiUrl}/repos/${owner}/${name}/pulls/${pr}`, {
    headers: { Accept: DIFF_ACCEPT, ...authHeaders(token) },
  });
  if (!res.ok) {
    throw new Error(`GitHub GET pulls/${pr} (diff) failed: ${res.status} ${await res.text()}`);
  }
  return res.text();
}

export interface ReviewCommentBody {
  body: string;
  commit_id: string;
  path: string;
  line: number;
  side: "RIGHT" | "LEFT";
}

export async function postReviewComment(
  githubApiUrl: string,
  repo: string,
  pr: number,
  comment: ReviewCommentBody,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  const { owner, name } = splitRepo(repo);
  const res = await fetchImpl(`${githubApiUrl}/repos/${owner}/${name}/pulls/${pr}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(comment),
  });
  if (!res.ok) {
    throw new Error(`GitHub POST pulls/${pr}/comments failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}
