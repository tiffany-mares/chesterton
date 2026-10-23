package main

// overlaps reports whether two 1-based inclusive line ranges intersect.
func overlaps(aStart, aEnd, bStart, bEnd int) bool {
	return aStart <= bEnd && aEnd >= bStart
}

// shouldFlag implements the strictness rule from docs/contracts.md and
// task-6-brief.md: flag only if verdict == YES AND citations.length >= 1 AND
// the cited decision's line anchor overlaps the hunk's old line range.
//
// Citations returned by Estelle never carry anchor fields today (see the
// Citation type), so this is deliberately lenient: a citation with no
// LineStart/LineEnd counts as overlapping. A citation that DOES carry an
// anchor must actually overlap hunk.OldStart..hunk.OldEnd to count. The hunk
// is flagged if at least one citation counts.
func shouldFlag(v Verdict, h Hunk) bool {
	if v.Verdict != "YES" {
		return false
	}
	if len(v.Citations) == 0 {
		return false
	}
	for _, c := range v.Citations {
		if c.LineStart == nil || c.LineEnd == nil {
			return true // no anchor -> lenient pass
		}
		if overlaps(h.OldStart, h.OldEnd, *c.LineStart, *c.LineEnd) {
			return true
		}
	}
	return false
}

// flagLine computes the Flag.line value per docs/contracts.md: "the line in
// the NEW file the flag pins to (for pure deletions, the line before the
// deletion)". A pure deletion has NewStart == NewEnd == 0; we approximate
// "the line before the deletion" using OldStart-1 since we don't have the
// full file's new-line mapping available at this layer.
func flagLine(h Hunk) int {
	if h.NewStart != 0 {
		return h.NewStart
	}
	line := h.OldStart - 1
	if line < 0 {
		line = 0
	}
	return line
}
