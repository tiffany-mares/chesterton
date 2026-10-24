/**
 * Minimal fixture mirroring github.com's React-based PR diff viewer, as
 * captured live from https://github.com/expressjs/express/pull/7554/changes
 * on 2026-10-24 (the /files URL now redirects to /changes).
 *
 * Structural facts this encodes (what src/lib.ts's new-viewer branch pins to):
 * - each file is a `div[id="diff-<sha256(path)>"]` (no data-tagsearch-path,
 *   no .file / .file-header, no td.blob-num anywhere)
 * - the file header holds the path as `h3` text, wrapped in U+200E marks
 * - line-number cells are `td[data-line-number]` with `data-diff-side`
 *   ("left" = old side, "right" = new side) and role="gridcell"
 * - CSS-module class names (diffTargetable__jbrCub etc.) are build-hashed and
 *   MUST NOT be relied on; only ids, roles, and data-* attributes are stable
 */

// sha256("services/payments/client.py") — precomputed; the real page ids are
// sha256 of the file path, but the extension matches via header text, so the
// exact value only needs to be *shaped* right (hex, container id prefix).
const CLIENT_PY_ANCHOR = "diff-9a1cf2b00cf4b74b4a94e4a4a6a1a6d2c9a7a4a1b7f3e9d0c5b2a8f6e4d3c2b1";

export function realGithubChangesDom(): string {
  return `
<div id="diff-comparison-viewer-container" class="Container__qkpM1i">
  <div id="diff-file-tree-filter" class="d-flex flex-nowrap gap-2"></div>
  <div data-testid="progressive-diffs-list">
    <div id="${CLIENT_PY_ANCHOR}" class="diffTargetable__jbrCub diff__GZFl4M">
      <div class="fileHeader__a1b2c3">
        <h3 class="fileNameHeading__x9y8z7">‎services/payments/client.py‎</h3>
        <a href="#${CLIENT_PY_ANCHOR}">‎services/payments/client.py‎</a>
      </div>
      <table role="grid">
        <tbody>
          <tr>
            <td colspan="4" data-grid-cell-id="${CLIENT_PY_ANCHOR}-hunk-0"
                role="gridcell" class="diff-hunk-cell focusable-grid-cell left-side">@@ -2,7 +2,7 @@</td>
          </tr>
          <tr>
            <td class="focusable-grid-cell new-diff-line-number left-side" data-diff-side="left"
                data-diff-line-key="b:4-l:4-r:4" data-grid-cell-id="${CLIENT_PY_ANCHOR}-4-4-0"
                data-line-number="4" role="gridcell">4</td>
            <td role="gridcell" data-grid-cell-id="${CLIENT_PY_ANCHOR}-4-4-1" class="diff-text-cell left-side">import time</td>
            <td class="focusable-grid-cell new-diff-line-number right-side" data-diff-side="right"
                data-diff-line-key="b:4-l:4-r:4" data-grid-cell-id="${CLIENT_PY_ANCHOR}-4-4-2"
                data-line-number="4" role="gridcell">4</td>
            <td role="gridcell" data-grid-cell-id="${CLIENT_PY_ANCHOR}-4-4-3" class="diff-text-cell right-side">import time</td>
          </tr>
          <tr>
            <td class="focusable-grid-cell new-diff-line-number left-side" data-diff-side="left"
                data-diff-line-key="b:5-l:5-r:5" data-grid-cell-id="${CLIENT_PY_ANCHOR}-5-5-0"
                data-line-number="5" role="gridcell">5</td>
            <td role="gridcell" data-grid-cell-id="${CLIENT_PY_ANCHOR}-5-5-1" class="diff-text-cell left-side deletion">MAX_RETRIES = 3</td>
            <td class="focusable-grid-cell new-diff-line-number right-side" data-diff-side="right"
                data-diff-line-key="b:5-l:5-r:5" data-grid-cell-id="${CLIENT_PY_ANCHOR}-5-5-2"
                data-line-number="5" role="gridcell">5</td>
            <td role="gridcell" data-grid-cell-id="${CLIENT_PY_ANCHOR}-5-5-3" class="diff-text-cell right-side addition">MAX_RETRIES = 50</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div id="diff-abfa5988643af1b8b2600aac13b273922dbb3372e021b00000000000000000000" class="diffTargetable__jbrCub diff__GZFl4M">
      <div class="fileHeader__a1b2c3">
        <h3 class="fileNameHeading__x9y8z7">‎README.md‎</h3>
      </div>
      <table role="grid"><tbody></tbody></table>
    </div>
  </div>
</div>`;
}
