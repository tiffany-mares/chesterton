// Pure logic for the Chesterton content script: URL parsing, flag -> DOM row matching,
// and flag-card construction. No chrome.* usage here so this stays testable under
// vitest + jsdom without a browser (see src/api.ts for the chrome.* boundary).
//
// Two DOM contracts are supported:
//
// Classic markup (docs/contracts.md "extension (MV3)"), as rendered by
// mocks/src/pages/prFiles.ts and GitHub's legacy files view:
//   - file container: div[data-tagsearch-path] (fallback: .file-header[data-path]'s
//     ancestor)
//   - line cell: td.blob-num[data-line-number] on the addition side (.blob-num-addition)
//
// Real github.com React diff viewer (the /files URL redirects to /changes; structure
// captured live 2026-10-24, see test/realGithubFixture.ts):
//   - file container: div[id="diff-<sha256(path)>"], matched via its heading text
//     (an h3 whose text is the path wrapped in U+200E marks) — the hashed CSS-module
//     class names are NOT stable and never used here
//   - line cell: td[data-line-number] with data-diff-side ("right" = new side)

export type CitationType = "slack" | "linear" | "pr" | "override";

export interface Citation {
  type: CitationType;
  url: string;
  title: string;
}

export type FlagKind = "contradiction" | "stale_comment";
export type FlagVerdict = "YES" | "NO" | "NO_EVIDENCE";
export type FlagStatus = "open" | "dismissed" | "overridden";

export interface Flag {
  id: number;
  repo: string;
  pr: number;
  head_sha: string;
  file: string;
  line: number;
  kind: FlagKind;
  verdict: FlagVerdict;
  reason: string;
  citations: Citation[];
  hunk_hash: string;
  status: FlagStatus;
}

export interface PrLocation {
  owner: string;
  repo: string;
  pr: number;
}

export type AnchorType = "row" | "header";

export interface Anchor {
  type: AnchorType;
  element: Element;
}

export type InjectResult = "injected-row" | "injected-header" | "skipped-duplicate" | "missing-container";

/**
 * Parses an owner/repo/pr triple out of either a github.com PR-files URL or the
 * local mock GitHub PR-files URL. Returns null for anything else.
 */
export function parsePrUrl(url: string): PrLocation | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);

  // https://github.com/{owner}/{repo}/pull/{n}/files...
  if (parsed.hostname === "github.com") {
    return matchPullFilesSegments(segments, 0);
  }

  // http://localhost:4100/github/{owner}/{repo}/pull/{n}/files...
  if (segments[0] === "github") {
    return matchPullFilesSegments(segments, 1);
  }

  return null;
}

function matchPullFilesSegments(segments: string[], offset: number): PrLocation | null {
  const owner = segments[offset];
  const repo = segments[offset + 1];
  const pullKeyword = segments[offset + 2];
  const prNumber = segments[offset + 3];
  const filesKeyword = segments[offset + 4];

  // github.com now serves the files view at /pull/{n}/changes (the /files
  // URL redirects there); the mock still uses /files.
  if (!owner || !repo || pullKeyword !== "pull" || !prNumber || (filesKeyword !== "files" && filesKeyword !== "changes")) {
    return null;
  }

  const pr = Number(prNumber);
  if (!Number.isInteger(pr)) return null;

  return { owner, repo, pr };
}

/** Escapes a value for safe use inside a CSS attribute selector string. */
function cssAttrEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

/**
 * Finds the file container for `file`, per the DOM contract. Tries the
 * data-tagsearch-path attribute first (mock + modern GitHub markup), then falls
 * back to locating via .file-header[data-path] and walking up to its nearest
 * .file ancestor (or the header's parent if there is no such ancestor).
 */
export function findFileContainer(doc: Document, file: string): Element | null {
  const escaped = cssAttrEscape(file);

  const byTagsearch = doc.querySelector(`[data-tagsearch-path="${escaped}"]`);
  if (byTagsearch) return byTagsearch;

  const header = doc.querySelector(`.file-header[data-path="${escaped}"]`);
  if (header) return header.closest(".file") ?? header.parentElement;

  return findNewViewerContainer(doc, file);
}

/** Strips the U+200E/U+200F directionality marks GitHub wraps path text in. */
function stripDirectionMarks(text: string): string {
  return text.replace(/[‎‏]/g, "").trim();
}

/**
 * Real github.com React diff viewer: each file is a div whose id is
 * "diff-" + sha256(path). Hashing is async in browsers, so the container is
 * matched via its heading text instead (an h3 holding the path).
 */
function findNewViewerContainer(doc: Document, file: string): Element | null {
  for (const heading of Array.from(doc.querySelectorAll('div[id^="diff-"] h3'))) {
    if (stripDirectionMarks(heading.textContent ?? "") === file) {
      return heading.closest('div[id^="diff-"]');
    }
  }
  return null;
}

/**
 * Finds the line cell for `line` within a file container. Prefers the
 * addition-side cell (.blob-num-addition); falls back to any matching cell that
 * isn't a deletion-side cell; falls back to the first match of any kind.
 */
export function findLineCell(container: Element, line: number): Element | null {
  const cells = Array.from(container.querySelectorAll(`td.blob-num[data-line-number="${line}"]`));
  if (cells.length > 0) {
    const addition = cells.find((c) => c.classList.contains("blob-num-addition"));
    if (addition) return addition;

    const nonDeletion = cells.find((c) => !c.classList.contains("blob-num-deletion"));
    if (nonDeletion) return nonDeletion;

    return cells[0];
  }

  // Real github.com React viewer: td[data-line-number] with data-diff-side;
  // "right" is the new side (flags anchor to new-file line numbers).
  const viewerCells = Array.from(container.querySelectorAll(`td[data-line-number="${line}"]`));
  if (viewerCells.length === 0) return null;
  return viewerCells.find((c) => c.getAttribute("data-diff-side") === "right") ?? viewerCells[0];
}

/**
 * Locates where to anchor a flag card for `flag`: the matched diff row if the
 * line is found, else the file's header (never losing the flag silently as long
 * as the file container itself is found). Returns null only when the file
 * container can't be located at all; callers should log a warning in that case.
 */
export function locateAnchor(doc: Document, flag: Pick<Flag, "file" | "line">): Anchor | null {
  const container = findFileContainer(doc, flag.file);
  if (!container) return null;

  const cell = findLineCell(container, flag.line);
  if (cell) {
    const row = cell.closest("tr");
    if (row) return { type: "row", element: row };
  }

  const header =
    container.querySelector(".file-header[data-path]") ??
    container.querySelector(".file-header") ??
    // Real github.com React viewer: the file heading is an h3.
    container.querySelector("h3");
  if (header) return { type: "header", element: header };

  // No header found either (unexpected markup) -- anchor to the container itself.
  return { type: "header", element: container };
}

function dataAttrFlagId(flag: Flag): string {
  return String(flag.id);
}

/**
 * Builds the flag card element: scoped class names + inline styles (amber left
 * border), "⚠ Chesterton" header, reason text, citation links (new tab), and the
 * Dismiss / Override… / Pin reason action buttons (wired up by the caller via
 * data-chesterton-action + data-chesterton-flag-id delegation).
 */
export function buildCardElement(doc: Document, flag: Flag): HTMLElement {
  const card = doc.createElement("div");
  card.className = "chesterton-card";
  card.setAttribute("data-chesterton-card-id", dataAttrFlagId(flag));
  card.style.cssText = [
    "border-left: 4px solid #d4a017",
    "background: #fff8e1",
    "color: #24292f",
    "padding: 10px 12px",
    "margin: 6px 0",
    "border-radius: 4px",
    "font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif",
    "font-size: 13px",
    "line-height: 1.5",
  ].join(";");

  const header = doc.createElement("div");
  header.className = "chesterton-card-header";
  header.style.cssText = "font-weight:600;margin-bottom:4px;color:#7a5200;";
  header.textContent = `⚠ Chesterton — ${flag.kind === "stale_comment" ? "Stale comment" : "Contradiction"}`;
  card.appendChild(header);

  const reason = doc.createElement("div");
  reason.className = "chesterton-card-reason";
  reason.style.cssText = "margin-bottom:6px;";
  reason.textContent = flag.reason;
  card.appendChild(reason);

  if (flag.citations.length > 0) {
    const citesWrap = doc.createElement("div");
    citesWrap.className = "chesterton-card-citations";
    citesWrap.style.cssText = "margin-bottom:6px;";
    for (const citation of flag.citations) {
      const link = doc.createElement("a");
      link.href = citation.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = citation.title || citation.type;
      link.style.cssText = "display:block;color:#0969da;text-decoration:none;";
      citesWrap.appendChild(link);
    }
    card.appendChild(citesWrap);
  }

  const actions = doc.createElement("div");
  actions.className = "chesterton-card-actions";

  const makeButton = (label: string, action: string): HTMLButtonElement => {
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.chestertonAction = action;
    button.dataset.chestertonFlagId = dataAttrFlagId(flag);
    button.style.cssText =
      "margin-right:6px;font-size:12px;padding:3px 8px;border:1px solid #d0d7de;border-radius:4px;background:#fff;cursor:pointer;";
    return button;
  };

  actions.appendChild(makeButton("Dismiss", "dismiss"));
  actions.appendChild(makeButton("Override…", "override"));
  actions.appendChild(makeButton("Pin reason", "pin"));
  card.appendChild(actions);

  return card;
}

/**
 * Injects a flag card into `doc` for `flag`, following locateAnchor. Idempotent:
 * re-scanning the same document for the same flag is a no-op (detected via the
 * card's data-chesterton-card-id marker). Never silently drops a flag: if the
 * line row can't be found the card is appended after the file header instead,
 * and if the file container itself can't be found this logs a console warning
 * and returns "missing-container".
 */
export function injectFlagCard(doc: Document, flag: Flag): InjectResult {
  const existing = doc.querySelector(`[data-chesterton-card-id="${flag.id}"]`);
  if (existing) return "skipped-duplicate";

  const anchor = locateAnchor(doc, flag);
  if (!anchor) {
    console.warn(
      `[chesterton] could not locate file container for "${flag.file}"; flag ${flag.id} was not injected`,
    );
    return "missing-container";
  }

  const card = buildCardElement(doc, flag);

  if (anchor.type === "row") {
    const row = anchor.element;
    const colCount = row.children.length || 1;
    const wrapperRow = doc.createElement("tr");
    wrapperRow.className = "chesterton-flag-row";
    wrapperRow.setAttribute("data-chesterton-flag-row", String(flag.id));
    const td = doc.createElement("td");
    td.colSpan = colCount;
    td.style.cssText = "padding:0;border:none;";
    td.appendChild(card);
    wrapperRow.appendChild(td);
    row.insertAdjacentElement("afterend", wrapperRow);
    return "injected-row";
  }

  anchor.element.insertAdjacentElement("afterend", card);
  return "injected-header";
}

/**
 * Marks a "Pin reason" button as successfully pinned: flips its label to
 * "Pinned ✓" and disables it. Lightweight inline success feedback for a
 * successful POST /plaque (controller ruling, final-review fix wave) --
 * no revert path needed since a plaque, once posted, stays posted.
 */
export function markPinned(button: HTMLElement): void {
  button.textContent = "Pinned ✓";
  if (button instanceof HTMLButtonElement) {
    button.disabled = true;
  }
  button.style.cursor = "default";
}

/**
 * Standard trailing-edge debounce: coalesces rapid calls into one call `wait`ms
 * after the last invocation. Used to debounce MutationObserver callbacks.
 */
export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, wait: number): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, wait);
  };
}
