import type { PrEntry } from "../types.js";
import { parseUnifiedDiff, type DiffLine } from "../diff.js";
import { escapeHtml, htmlDocument } from "./layout.js";

const STYLE = `
  body { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; background: #f6f8fa; color: #24292f; margin: 0; }
  .pr-header { background: #fff; border-bottom: 1px solid #d0d7de; padding: 16px 24px; }
  .pr-header h1 { font-size: 18px; margin: 0 0 6px; }
  .pr-header .branches code { background: #eef1f4; padding: 2px 6px; border-radius: 4px; }
  .pr-meta { color: #57606a; font-size: 13px; }
  .file { margin: 16px 24px; border: 1px solid #d0d7de; border-radius: 6px; overflow: hidden; background: #fff; }
  .file-header { background: #f6f8fa; padding: 8px 12px; font-size: 13px; font-weight: 600; border-bottom: 1px solid #d0d7de; }
  table.diff { width: 100%; border-collapse: collapse; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
  td.blob-num { width: 1%; min-width: 40px; text-align: right; padding: 0 10px; color: #57606a; user-select: none; border-right: 1px solid #d0d7de; white-space: nowrap; }
  td.blob-code { padding: 0 10px; white-space: pre; }
  tr.diff-line-add td.blob-code, tr.diff-line-add td.blob-num-addition { background: #e6ffec; }
  tr.diff-line-del td.blob-code, tr.diff-line-del td.blob-num-deletion { background: #ffebe9; }
  .review-comments { padding: 10px 12px; border-top: 1px solid #d0d7de; background: #f6f8fa; }
  .review-comment { margin-bottom: 8px; }
  .review-comment:last-child { margin-bottom: 0; }
  .review-comment p { margin: 0 0 6px; font-size: 13px; }
  .review-comment pre.suggestion { margin: 0; background: #fff; border: 1px solid #d0d7de; border-radius: 4px; padding: 8px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; overflow-x: auto; }
`;

/** A review comment stored by the mock GitHub API, relevant to one file. */
export interface StoredReviewComment {
  path: string;
  line: number;
  body: string;
}

export interface RenderPrFilesPageOptions {
  owner: string;
  repo: string;
  pr: PrEntry;
  diffText: string;
  /** Stored review comments for this PR (across all files); filtered by path per file block. */
  comments?: StoredReviewComment[];
}

const SUGGESTION_BLOCK_RE = /```suggestion\n([\s\S]*?)```/;

/**
 * Renders one stored review comment's body. Per controller ruling
 * (final-review fix wave), a ```suggestion fenced block is rendered as a
 * simple <pre> (not a live diff); any text before/after the fence is shown
 * as plain paragraphs. Minimal styling.
 */
function renderComment(comment: StoredReviewComment): string {
  const match = SUGGESTION_BLOCK_RE.exec(comment.body);
  if (!match) {
    return `<div class="review-comment"><p>${escapeHtml(comment.body)}</p></div>`;
  }

  const before = comment.body.slice(0, match.index).trim();
  const after = comment.body.slice(match.index + match[0].length).trim();
  const suggestion = match[1].replace(/\n$/, "");

  return `<div class="review-comment">
  ${before ? `<p>${escapeHtml(before)}</p>` : ""}
  <pre class="suggestion">${escapeHtml(suggestion)}</pre>
  ${after ? `<p>${escapeHtml(after)}</p>` : ""}
</div>`;
}

function lineMarker(line: DiffLine): string {
  if (line.type === "add") return "+";
  if (line.type === "del") return "-";
  return " ";
}

function renderRow(line: DiffLine): string {
  const rowClass =
    line.type === "add" ? "diff-line-add" : line.type === "del" ? "diff-line-del" : "diff-line-context";
  const oldNumClass = line.type === "del" ? "blob-num blob-num-deletion" : "blob-num";
  const newNumClass = line.type === "add" ? "blob-num blob-num-addition" : "blob-num";
  const oldNum = line.oldLine ?? "";
  const newNum = line.newLine ?? "";
  const code = `${lineMarker(line)}${line.text}`;

  return `<tr class="${rowClass}">
<td class="${oldNumClass}" data-line-number="${oldNum}"></td>
<td class="${newNumClass}" data-line-number="${newNum}"></td>
<td class="blob-code">${escapeHtml(code)}</td>
</tr>`;
}

export function renderPrFilesPage(opts: RenderPrFilesPageOptions): string {
  const { owner, repo, pr, diffText, comments = [] } = opts;
  const files = parseUnifiedDiff(diffText);
  const fullName = `${owner}/${repo}`;

  const fileBlocks = files
    .map((file) => {
      const rows = file.hunks.flatMap((h) => h.lines).map(renderRow).join("\n");
      const fileComments = comments.filter((c) => c.path === file.path).sort((a, b) => a.line - b.line);
      const commentsHtml = fileComments.length
        ? `\n  <div class="review-comments">\n${fileComments.map(renderComment).join("\n")}\n  </div>`
        : "";
      return `<div class="file" data-tagsearch-path="${escapeHtml(file.path)}">
  <div class="file-header" data-path="${escapeHtml(file.path)}">${escapeHtml(file.path)}</div>
  <table class="diff">
    <tbody>
${rows}
    </tbody>
  </table>${commentsHtml}
</div>`;
    })
    .join("\n");

  const body = `
<div class="pr-header">
  <h1>${escapeHtml(fullName)} #${pr.number}: ${escapeHtml(pr.title)}</h1>
  <div class="branches"><code>${escapeHtml(pr.branch)}</code> &rarr; <code>${escapeHtml(pr.base)}</code></div>
  <div class="pr-meta">opened by ${escapeHtml(pr.author)}</div>
</div>
${fileBlocks}
`;

  return htmlDocument(`${fullName} #${pr.number} · Files changed`, STYLE, body);
}
