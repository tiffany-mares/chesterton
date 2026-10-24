import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  parsePrUrl,
  findFileContainer,
  findLineCell,
  locateAnchor,
  buildCardElement,
  injectFlagCard,
  debounce,
  markPinned,
  type Flag,
} from "../src/lib.js";
import { PAYMENTS_FILE, paymentsFileLines, renderFileBlock, renderPrPage } from "./fixtures.js";
import { realGithubChangesDom } from "./realGithubFixture.js";

function makeFlag(overrides: Partial<Flag> = {}): Flag {
  return {
    id: 17,
    repo: "acme/storefront",
    pr: 1,
    head_sha: "abc123",
    file: PAYMENTS_FILE,
    line: 12,
    kind: "contradiction",
    verdict: "YES",
    reason: "MAX_RETRIES=3 was set to cap payment retries after incident ENG-212; raising it contradicts that decision.",
    citations: [
      { type: "slack", url: "http://localhost:4100/slack/archives/oncall/p1700000001", title: "#oncall: payment retries incident" },
      { type: "linear", url: "http://localhost:4100/linear/issue/ENG-212", title: "ENG-212" },
    ],
    hunk_hash: "9f2c1a0b4d6e8f10",
    status: "open",
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("parsePrUrl", () => {
  it("parses a github.com PR files URL", () => {
    expect(parsePrUrl("https://github.com/acme/storefront/pull/1/files")).toEqual({
      owner: "acme",
      repo: "storefront",
      pr: 1,
    });
  });

  it("parses a github.com PR files URL with query/hash", () => {
    expect(parsePrUrl("https://github.com/acme/storefront/pull/42/files?diff=split#diff-1")).toEqual({
      owner: "acme",
      repo: "storefront",
      pr: 42,
    });
  });

  it("parses the local mock GitHub PR files URL", () => {
    expect(parsePrUrl("http://localhost:4100/github/acme/storefront/pull/1/files")).toEqual({
      owner: "acme",
      repo: "storefront",
      pr: 1,
    });
  });

  it("returns null for non-PR-files URLs", () => {
    expect(parsePrUrl("https://github.com/acme/storefront/issues/1")).toBeNull();
    expect(parsePrUrl("https://github.com/acme/storefront/pull/1")).toBeNull();
    expect(parsePrUrl("not a url")).toBeNull();
  });

  it("parses the new github.com /changes URL (the /files URL now redirects there)", () => {
    expect(parsePrUrl("https://github.com/acme/storefront/pull/7/changes")).toEqual({
      owner: "acme",
      repo: "storefront",
      pr: 7,
    });
    expect(parsePrUrl("https://github.com/acme/storefront/pull/7/changes?w=1#diff-x")).toEqual({
      owner: "acme",
      repo: "storefront",
      pr: 7,
    });
  });
});

describe("findFileContainer", () => {
  it("finds the container via data-tagsearch-path", () => {
    document.body.innerHTML = renderPrPage([renderFileBlock(PAYMENTS_FILE, paymentsFileLines)]);
    const container = findFileContainer(document, PAYMENTS_FILE);
    expect(container).not.toBeNull();
    expect(container?.getAttribute("data-tagsearch-path")).toBe(PAYMENTS_FILE);
  });

  it("falls back to .file-header[data-path] when data-tagsearch-path is absent", () => {
    document.body.innerHTML = `<div class="file">
      <div class="file-header" data-path="${PAYMENTS_FILE}">${PAYMENTS_FILE}</div>
      <table class="diff"><tbody></tbody></table>
    </div>`;
    const container = findFileContainer(document, PAYMENTS_FILE);
    expect(container).not.toBeNull();
    expect(container?.querySelector(".file-header")).not.toBeNull();
  });

  it("returns null when the file is not present", () => {
    document.body.innerHTML = renderPrPage([renderFileBlock(PAYMENTS_FILE, paymentsFileLines)]);
    expect(findFileContainer(document, "services/other/file.py")).toBeNull();
  });
});

describe("findLineCell", () => {
  it("prefers the addition-side cell when a line number appears on both del and add rows", () => {
    document.body.innerHTML = renderFileBlock(PAYMENTS_FILE, paymentsFileLines);
    const container = document.querySelector(".file") as Element;
    const cell = findLineCell(container, 12);
    expect(cell).not.toBeNull();
    expect(cell?.classList.contains("blob-num-addition")).toBe(true);
  });

  it("finds a context line (old === new line number)", () => {
    document.body.innerHTML = renderFileBlock(PAYMENTS_FILE, paymentsFileLines);
    const container = document.querySelector(".file") as Element;
    const cell = findLineCell(container, 10);
    expect(cell).not.toBeNull();
    expect(cell?.closest("tr")?.textContent).toContain("def charge");
  });

  it("returns null when the line is not present", () => {
    document.body.innerHTML = renderFileBlock(PAYMENTS_FILE, paymentsFileLines);
    const container = document.querySelector(".file") as Element;
    expect(findLineCell(container, 999)).toBeNull();
  });
});

describe("locateAnchor", () => {
  it("anchors to the matched row when the line is found", () => {
    document.body.innerHTML = renderFileBlock(PAYMENTS_FILE, paymentsFileLines);
    const anchor = locateAnchor(document, makeFlag({ line: 12 }));
    expect(anchor?.type).toBe("row");
    expect(anchor?.element.tagName).toBe("TR");
  });

  it("falls back to the file header when the line is not found", () => {
    document.body.innerHTML = renderFileBlock(PAYMENTS_FILE, paymentsFileLines);
    const anchor = locateAnchor(document, makeFlag({ line: 999 }));
    expect(anchor?.type).toBe("header");
    expect(anchor?.element.className).toContain("file-header");
  });

  it("returns null when the file container cannot be found", () => {
    document.body.innerHTML = renderFileBlock(PAYMENTS_FILE, paymentsFileLines);
    const anchor = locateAnchor(document, makeFlag({ file: "no/such/file.py" }));
    expect(anchor).toBeNull();
  });
});

describe("buildCardElement", () => {
  it("builds a card with the Chesterton header, reason, citation links, and action buttons", () => {
    const flag = makeFlag();
    const card = buildCardElement(document, flag);
    expect(card.textContent).toContain("⚠ Chesterton");
    expect(card.textContent).toContain(flag.reason);
    // jsdom normalizes hex colors to rgb() when read back via CSSOM.
    expect(card.style.borderLeft).toContain("rgb(212, 160, 23)");

    const links = Array.from(card.querySelectorAll("a"));
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.target).toBe("_blank");
    }
    expect(links[0].href).toBe(flag.citations[0].url);

    const buttons = Array.from(card.querySelectorAll("button")).map((b) => b.dataset.chestertonAction);
    expect(buttons).toEqual(["dismiss", "override", "pin"]);

    const dismissBtn = card.querySelector('button[data-chesterton-action="dismiss"]') as HTMLButtonElement;
    expect(dismissBtn.dataset.chestertonFlagId).toBe(String(flag.id));
  });

  it("marks the card with a data attribute carrying the flag id for idempotency checks", () => {
    const card = buildCardElement(document, makeFlag({ id: 99 }));
    expect(card.getAttribute("data-chesterton-card-id")).toBe("99");
  });
});

describe("injectFlagCard", () => {
  it("injects the card as a new row right after the matched tr", () => {
    document.body.innerHTML = renderFileBlock(PAYMENTS_FILE, paymentsFileLines);
    const flag = makeFlag({ line: 12 });
    const result = injectFlagCard(document, flag);
    expect(result).toBe("injected-row");

    const card = document.querySelector('[data-chesterton-card-id="17"]');
    expect(card).not.toBeNull();
    // the card's row should immediately follow the row containing "MAX_RETRIES = 50"
    const cardRow = card?.closest("tr");
    const prevRow = cardRow?.previousElementSibling;
    expect(prevRow?.textContent).toContain("MAX_RETRIES = 50");
  });

  it("appends after the file header when the line is not found", () => {
    document.body.innerHTML = renderFileBlock(PAYMENTS_FILE, paymentsFileLines);
    const flag = makeFlag({ line: 999 });
    const result = injectFlagCard(document, flag);
    expect(result).toBe("injected-header");

    const card = document.querySelector('[data-chesterton-card-id="17"]');
    expect(card).not.toBeNull();
    const header = document.querySelector(".file-header");
    expect(header?.nextElementSibling).toBe(card);
  });

  it("logs a console warning and reports missing-container when the file cannot be found", () => {
    document.body.innerHTML = renderFileBlock(PAYMENTS_FILE, paymentsFileLines);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const flag = makeFlag({ file: "no/such/file.py" });
    const result = injectFlagCard(document, flag);
    expect(result).toBe("missing-container");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("is idempotent across re-scans (no duplicate cards for the same flag)", () => {
    document.body.innerHTML = renderFileBlock(PAYMENTS_FILE, paymentsFileLines);
    const flag = makeFlag({ line: 12 });
    injectFlagCard(document, flag);
    const second = injectFlagCard(document, flag);
    expect(second).toBe("skipped-duplicate");
    expect(document.querySelectorAll('[data-chesterton-card-id="17"]')).toHaveLength(1);
  });

  it("wraps the card in a table row matching the matched row's column count", () => {
    document.body.innerHTML = renderFileBlock(PAYMENTS_FILE, paymentsFileLines);
    injectFlagCard(document, makeFlag({ line: 12 }));
    const card = document.querySelector('[data-chesterton-card-id="17"]') as HTMLElement;
    const wrapperTd = card.closest("td") as HTMLTableCellElement;
    expect(wrapperTd.colSpan).toBe(3);
  });
});

describe("markPinned", () => {
  it("flips a button's label to Pinned ✓ and disables it", () => {
    const card = buildCardElement(document, makeFlag());
    const pinBtn = card.querySelector('button[data-chesterton-action="pin"]') as HTMLButtonElement;
    expect(pinBtn.disabled).toBe(false);

    markPinned(pinBtn);

    expect(pinBtn.textContent).toBe("Pinned ✓");
    expect(pinBtn.disabled).toBe(true);
  });

  it("sets textContent even on a non-button element without throwing", () => {
    const div = document.createElement("div");
    expect(() => markPinned(div)).not.toThrow();
    expect(div.textContent).toBe("Pinned ✓");
  });
});

describe("debounce", () => {
  it("coalesces rapid calls into a single trailing call", async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 500);
    debounced();
    debounced();
    debounced();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(499);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("real github.com React diff viewer (/changes markup)", () => {
  const FILE = "services/payments/client.py";

  function mountRealDom(): void {
    document.body.innerHTML = realGithubChangesDom();
  }

  it("finds the file container via its header text (ids are sha256 hashes)", () => {
    mountRealDom();
    const container = findFileContainer(document, FILE);
    expect(container).not.toBeNull();
    expect(container?.id.startsWith("diff-")).toBe(true);
    expect(container?.querySelector("table")).not.toBeNull();
  });

  it("does not confuse files (README.md container is distinct)", () => {
    mountRealDom();
    const container = findFileContainer(document, "README.md");
    expect(container).not.toBeNull();
    expect(container?.textContent).toContain("README.md");
    expect(container?.textContent).not.toContain("client.py");
  });

  it("finds the new-side line cell by data-line-number + data-diff-side", () => {
    mountRealDom();
    const container = findFileContainer(document, FILE)!;
    const cell = findLineCell(container, 5);
    expect(cell).not.toBeNull();
    expect(cell?.getAttribute("data-diff-side")).toBe("right");
    expect(cell?.getAttribute("data-line-number")).toBe("5");
  });

  it("injects the flag card as a row after the matched line's tr", () => {
    mountRealDom();
    const result = injectFlagCard(document, makeFlag({ file: FILE, line: 5 }));
    expect(result).toBe("injected-row");
    const card = document.querySelector("[data-chesterton-card-id]");
    expect(card).not.toBeNull();
    const row = card?.closest("tr");
    expect(row?.previousElementSibling?.querySelector('[data-line-number="5"]')).not.toBeNull();
  });

  it("falls back to the file heading when the line is not in the DOM (virtualized rows)", () => {
    mountRealDom();
    const result = injectFlagCard(document, makeFlag({ id: 99, file: FILE, line: 400 }));
    expect(result).toBe("injected-header");
    const card = document.querySelector('[data-chesterton-card-id="99"]');
    expect(card).not.toBeNull();
    // Anchored inside the right file's container, never lost silently.
    expect(card?.closest('div[id^="diff-"]')?.textContent).toContain(FILE);
  });
});
