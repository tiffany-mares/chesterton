/**
 * Orchestrates the webhook pipeline: fetch diff -> analyzer /analyze ->
 * triage /score -> filter >= 0.5 -> extract adjacent comments -> verdict
 * /judge. Independent of HTTP framing so it's easy to unit test with
 * stubbed downstream services.
 */

import { analyzeDiff } from "./clients/analyzer.js";
import { getPrDiff } from "./clients/github.js";
import { scoreHunks } from "./clients/triage.js";
import { judge } from "./clients/verdictClient.js";
import { extractComments } from "./comments.js";
import type { JudgeCache } from "./store.js";
import type { Flag, Hunk } from "./types.js";

export const SCORE_THRESHOLD = 0.5;

export interface PipelineEvent {
  repo: string;
  pr: number;
  headSha: string;
}

export interface PipelineDeps {
  analyzerUrl: string;
  triageUrl: string;
  verdictUrl: string;
  githubApiUrl: string;
  githubToken: string;
  /** Real mode: mints a GitHub App installation token per run (check runs
   * require App auth, not a PAT). Overrides githubToken when present. */
  getGithubToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  judgeCache?: JudgeCache<Flag[]>;
}

export interface PipelineResult {
  flags: Flag[];
}

export async function runPipeline(event: PipelineEvent, deps: PipelineDeps): Promise<PipelineResult> {
  const githubToken = deps.getGithubToken ? await deps.getGithubToken() : deps.githubToken;
  const diffText = await getPrDiff(deps.githubApiUrl, event.repo, event.pr, githubToken, deps.fetchImpl);
  const hunks: Hunk[] = await analyzeDiff(deps.analyzerUrl, diffText, deps.fetchImpl);

  // Comments are independent of the triage score filter below: they feed
  // verdict's stale-comment check regardless of whether their adjacent
  // hunk passed the contradiction-score threshold.
  const comments = hunks.length > 0 ? extractComments(diffText, hunks) : [];

  let filteredHunks: Hunk[] = [];
  if (hunks.length > 0) {
    const scores = await scoreHunks(deps.triageUrl, hunks, deps.fetchImpl);
    const scoreByHash = new Map(scores.map((s) => [s.hunk_hash, s.score]));
    filteredHunks = hunks.filter((h) => (scoreByHash.get(h.hunk_hash) ?? 0) >= SCORE_THRESHOLD);
  }

  // Controller ruling: ALWAYS call /judge, even with empty hunks[] and
  // comments[]. Verdict is what posts the check run, and a harmless
  // refactor PR (no hunk clears the triage filter, no stale-comment
  // candidates) must still get its neutral check run rather than silently
  // never posting one.
  const judgeResult = await judge(
    deps.verdictUrl,
    {
      repo: event.repo,
      pr: event.pr,
      head_sha: event.headSha,
      installation_token: githubToken ?? "",
      hunks: filteredHunks,
      comments,
    },
    deps.fetchImpl
  );

  deps.judgeCache?.set(event.repo, event.pr, judgeResult.flags);
  return { flags: judgeResult.flags };
}
