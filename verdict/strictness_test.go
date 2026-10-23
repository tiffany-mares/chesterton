package main

import "testing"

func TestShouldFlag_YesWithUnanchoredCitation(t *testing.T) {
	v := Verdict{Verdict: "YES", Citations: []Citation{{Type: "slack", URL: "u", Title: "t"}}}
	h := Hunk{OldStart: 5, OldEnd: 5}
	if !shouldFlag(v, h) {
		t.Fatalf("expected flag: YES + unanchored citation counts as overlapping")
	}
}

func TestShouldFlag_NoVerdict(t *testing.T) {
	v := Verdict{Verdict: "NO", Citations: []Citation{{Type: "slack", URL: "u", Title: "t"}}}
	h := Hunk{OldStart: 5, OldEnd: 5}
	if shouldFlag(v, h) {
		t.Fatalf("NO verdict must never flag")
	}
}

func TestShouldFlag_NoEvidence(t *testing.T) {
	v := Verdict{Verdict: "NO_EVIDENCE", Citations: nil}
	h := Hunk{OldStart: 5, OldEnd: 5}
	if shouldFlag(v, h) {
		t.Fatalf("NO_EVIDENCE must never flag")
	}
}

func TestShouldFlag_YesButNoCitations(t *testing.T) {
	v := Verdict{Verdict: "YES", Citations: []Citation{}}
	h := Hunk{OldStart: 5, OldEnd: 5}
	if shouldFlag(v, h) {
		t.Fatalf("YES with zero citations must not flag")
	}
}

func intp(i int) *int { return &i }

func TestShouldFlag_AnchoredCitationOverlap(t *testing.T) {
	v := Verdict{Verdict: "YES", Citations: []Citation{{Type: "slack", URL: "u", Title: "t", LineStart: intp(4), LineEnd: intp(6)}}}
	h := Hunk{OldStart: 5, OldEnd: 5}
	if !shouldFlag(v, h) {
		t.Fatalf("expected flag: anchored citation overlaps hunk old range")
	}
}

func TestShouldFlag_AnchoredCitationNoOverlap(t *testing.T) {
	v := Verdict{Verdict: "YES", Citations: []Citation{{Type: "slack", URL: "u", Title: "t", LineStart: intp(100), LineEnd: intp(102)}}}
	h := Hunk{OldStart: 5, OldEnd: 5}
	if shouldFlag(v, h) {
		t.Fatalf("anchored citation that does not overlap must not flag")
	}
}

func TestFlagLine_ModifiedHunk(t *testing.T) {
	h := Hunk{OldStart: 10, OldEnd: 12, NewStart: 10, NewEnd: 12}
	if got := flagLine(h); got != 10 {
		t.Fatalf("expected 10, got %d", got)
	}
}

func TestFlagLine_PureDeletion(t *testing.T) {
	h := Hunk{OldStart: 10, OldEnd: 12, NewStart: 0, NewEnd: 0}
	if got := flagLine(h); got != 9 {
		t.Fatalf("expected 9 (line before deletion), got %d", got)
	}
}
