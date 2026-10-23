// Content script entry point. Runs on both github.com PR-files pages and the
// local mock GitHub PR-files pages (see manifest.json match patterns). Parses the
// current PR from the URL, fetches flags from the gateway, and injects a card
// beside each flagged line. Re-scans (debounced 500ms) on DOM mutation to survive
// GitHub's PJAX navigation, which swaps content without a full page load.

import { debounce, injectFlagCard, markPinned, parsePrUrl, type Flag, type PrLocation } from "./lib.js";
import { createOverride, dismissFlag, fetchVerdicts, getGatewayUrl, pinReason } from "./api.js";

let currentFlags: Map<number, Flag> = new Map();
let currentContext: PrLocation | null = null;
let gatewayUrlCache = "http://localhost:4000";

function scan(): void {
  for (const flag of currentFlags.values()) {
    const result = injectFlagCard(document, flag);
    if (result === "missing-container") {
      console.warn(`[chesterton] file container not found for ${flag.file} (flag ${flag.id})`);
    }
  }
}

async function loadAndScan(): Promise<void> {
  const parsed = parsePrUrl(location.href);
  if (!parsed) return;
  currentContext = parsed;

  try {
    gatewayUrlCache = await getGatewayUrl();
    const flags = await fetchVerdicts(gatewayUrlCache, parsed.owner, parsed.repo, parsed.pr);
    currentFlags = new Map(flags.filter((f) => f.status === "open").map((f) => [f.id, f]));
  } catch (err) {
    console.warn("[chesterton] failed to fetch verdicts from gateway", err);
    return;
  }

  scan();
}

function removeCardForFlag(flagId: number): void {
  const card = document.querySelector(`[data-chesterton-card-id="${flagId}"]`);
  if (!card) return;
  const row = card.closest("tr.chesterton-flag-row");
  (row ?? card).remove();
}

async function handleAction(action: string, flagId: number, button: HTMLElement | null): Promise<void> {
  const flag = currentFlags.get(flagId);
  if (!flag || !currentContext) return;

  if (action === "dismiss") {
    try {
      await dismissFlag(gatewayUrlCache, flagId);
      currentFlags.delete(flagId);
      removeCardForFlag(flagId);
    } catch (err) {
      console.warn("[chesterton] dismiss failed", err);
    }
    return;
  }

  if (action === "override") {
    const reason = window.prompt("Override reason:");
    if (!reason) return;
    try {
      await createOverride(gatewayUrlCache, flagId, reason);
    } catch (err) {
      console.warn("[chesterton] override failed", err);
    }
    return;
  }

  if (action === "pin") {
    try {
      await pinReason(gatewayUrlCache, `${currentContext.owner}/${currentContext.repo}`, currentContext.pr, flagId);
      if (button) markPinned(button);
    } catch (err) {
      console.warn("[chesterton] pin reason failed", err);
    }
  }
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  const button = target?.closest<HTMLElement>("[data-chesterton-action]");
  if (!button) return;

  const action = button.dataset.chestertonAction;
  const flagId = Number(button.dataset.chestertonFlagId);
  if (!action || Number.isNaN(flagId)) return;

  void handleAction(action, flagId, button);
});

const debouncedRescan = debounce(() => {
  void loadAndScan();
}, 500);

const observer = new MutationObserver(() => debouncedRescan());
observer.observe(document.body, { childList: true, subtree: true });

void loadAndScan();
