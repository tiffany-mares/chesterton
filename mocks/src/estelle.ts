import { Router, type Request, type Response } from "express";
import type { Fixtures } from "./store.js";
import type { Citation, Fence, Hunk, StaleRequest, StaleResponse, Verdict } from "./types.js";

/** 1-based inclusive line range overlap. (0,0) never overlaps (pure additions have no old range). */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  if (aStart === 0 && aEnd === 0) return false;
  return aStart <= bEnd && aEnd >= bStart;
}

function fencesOverlappingHunk(fixtures: Fixtures, hunk: Hunk): Fence[] {
  return fixtures.knowledge.fences
    .filter((f) => f.file === hunk.file && overlaps(hunk.old_start, hunk.old_end, f.line_start, f.line_end))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Deterministic Estelle /v1/ask emulation.
 *
 * Among fences whose file matches and whose line range overlaps the hunk's old-line
 * range, the first (by fence id) whose exact `code` line is present in `old_lines`
 * decides the verdict: YES if that code is absent from `new_lines` (removed/altered),
 * NO if it survives unchanged. If no overlapping fence's code appears in old_lines at
 * all, the verdict is NO_EVIDENCE with no citations.
 */
export function computeAsk(fixtures: Fixtures, _repo: string, hunk: Hunk): Verdict {
  const candidates = fencesOverlappingHunk(fixtures, hunk);

  for (const fence of candidates) {
    // Ingested decision memory (code === null, e.g. an override pushed via
    // POST /v1/knowledge) covers its whole line range: any overlapping hunk
    // is by definition a change to those lines, so it cites the decision.
    if (fence.code === null) {
      return {
        verdict: "YES",
        reason: `A recorded decision covers these lines: ${fence.summary} This change alters them.`,
        citations: fence.citations,
      };
    }

    if (!hunk.old_lines.includes(fence.code)) continue;

    if (!hunk.new_lines.includes(fence.code)) {
      return {
        verdict: "YES",
        reason: `${fence.code} exists because: ${fence.summary} This change removes or alters it.`,
        citations: fence.citations,
      };
    }

    return {
      verdict: "NO",
      reason: `${fence.code} exists because: ${fence.summary} This change does not alter it.`,
      citations: fence.citations,
    };
  }

  return {
    verdict: "NO_EVIDENCE",
    reason: "No recorded decision covers this change.",
    citations: [],
  };
}

function extractNumbers(text: string): string[] {
  return Array.from(text.matchAll(/\d+/g)).map((m) => m[0]);
}

/**
 * Deterministic Estelle /v1/stale emulation: stale iff a number mentioned in the
 * comment appears among old_lines' own numbers but not among new_lines' numbers
 * (i.e. the value the comment refers to was removed/changed by this hunk).
 * Citations are drawn from any fence overlapping the comment's line, regardless
 * of staleness.
 */
export function computeStale(fixtures: Fixtures, req: StaleRequest): StaleResponse {
  const { hunk, comment, file, comment_line } = req;

  const oldNums = new Set(hunk.old_lines.flatMap(extractNumbers));
  const newNums = new Set(hunk.new_lines.flatMap(extractNumbers));
  const commentNums = extractNumbers(comment);

  const staleNumber = commentNums.find((n) => oldNums.has(n) && !newNums.has(n));

  const citingFences = fixtures.knowledge.fences
    .filter((f) => f.file === file && overlaps(comment_line, comment_line, f.line_start, f.line_end))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  const citations: Citation[] = citingFences.flatMap((f) => f.citations);

  if (staleNumber !== undefined) {
    return {
      stale: true,
      reason: `Comment references ${staleNumber}, which this change removed or altered.`,
      citations,
    };
  }

  return {
    stale: false,
    reason: "Comment still matches the current code.",
    citations,
  };
}

export function createEstelleRouter(fixtures: Fixtures): Router {
  const router = Router();

  router.post("/v1/ask", (req: Request, res: Response) => {
    const body = req.body as { repo?: string; hunk?: Hunk };
    if (!body || typeof body.repo !== "string" || !body.hunk) {
      res.status(400).json({ error: "expected { repo, hunk }" });
      return;
    }
    res.json(computeAsk(fixtures, body.repo, body.hunk));
  });

  // Runtime knowledge ingestion: how new memory (e.g. a reviewer override)
  // reaches the mock's corpus without re-seeding. Real Estelle would get the
  // same write through its own ingestion API. Upserts by fence id so
  // re-pushing the same decision never duplicates it.
  router.post("/v1/knowledge", (req: Request, res: Response) => {
    const body = req.body as { fence?: Partial<Fence> };
    const fence = body?.fence;
    if (
      !fence ||
      typeof fence.id !== "string" ||
      typeof fence.file !== "string" ||
      typeof fence.line_start !== "number" ||
      typeof fence.line_end !== "number" ||
      typeof fence.summary !== "string" ||
      !Array.isArray(fence.citations)
    ) {
      res.status(400).json({ error: "expected { fence: {id, file, line_start, line_end, summary, citations[], code?} }" });
      return;
    }

    const normalized: Fence = {
      id: fence.id,
      file: fence.file,
      line_start: fence.line_start,
      line_end: fence.line_end,
      code: typeof fence.code === "string" ? fence.code : null,
      summary: fence.summary,
      citations: fence.citations as Fence["citations"],
    };

    const existing = fixtures.knowledge.fences.findIndex((f) => f.id === normalized.id);
    if (existing >= 0) {
      fixtures.knowledge.fences[existing] = normalized;
    } else {
      fixtures.knowledge.fences.push(normalized);
    }
    res.status(201).json({ ok: true, fences: fixtures.knowledge.fences.length });
  });

  router.post("/v1/stale", (req: Request, res: Response) => {
    const body = req.body as Partial<StaleRequest>;
    if (
      !body ||
      typeof body.repo !== "string" ||
      typeof body.file !== "string" ||
      typeof body.comment !== "string" ||
      typeof body.comment_line !== "number" ||
      !body.hunk
    ) {
      res.status(400).json({ error: "expected { repo, file, comment, comment_line, hunk }" });
      return;
    }
    res.json(computeStale(fixtures, body as StaleRequest));
  });

  return router;
}
