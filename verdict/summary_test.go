package main

import "testing"

func TestBuildSummary_NoFlags(t *testing.T) {
	got := buildSummary(nil)
	if got != "No contradictions or stale comments detected." {
		t.Fatalf("unexpected summary: %q", got)
	}
}

func TestBuildSummary_OneFlagWithCitations(t *testing.T) {
	flags := []Flag{
		{
			File:   "services/payments/client.py",
			Line:   12,
			Reason: "MAX_RETRIES=3 exists because of an incident.",
			Citations: []Citation{
				{Type: "slack", URL: "http://x/slack", Title: "#oncall"},
				{Type: "linear", URL: "http://x/linear", Title: "ENG-212"},
			},
		},
	}
	got := buildSummary(flags)
	want := "- **services/payments/client.py:12** — MAX_RETRIES=3 exists because of an incident. [#oncall](http://x/slack) [ENG-212](http://x/linear)"
	if got != want {
		t.Fatalf("summary mismatch:\n got:  %q\n want: %q", got, want)
	}
}

func TestConclusion_NoFlagsIsNeutral(t *testing.T) {
	if got := conclusionFor(nil); got != "neutral" {
		t.Fatalf("expected neutral, got %q", got)
	}
}

func TestConclusion_AnyFlagIsActionRequired(t *testing.T) {
	if got := conclusionFor([]Flag{{}}); got != "action_required" {
		t.Fatalf("expected action_required, got %q", got)
	}
}

func TestFallbackFlagID_Deterministic(t *testing.T) {
	id1 := fallbackFlagID("acme/storefront", "sha1", "hh1")
	id2 := fallbackFlagID("acme/storefront", "sha1", "hh1")
	if id1 != id2 {
		t.Fatalf("expected deterministic id, got %d != %d", id1, id2)
	}
	if id1 <= 0 {
		t.Fatalf("expected positive id, got %d", id1)
	}
}

func TestFallbackFlagID_DiffersByInput(t *testing.T) {
	id1 := fallbackFlagID("acme/storefront", "sha1", "hh1")
	id2 := fallbackFlagID("acme/storefront", "sha1", "hh2")
	if id1 == id2 {
		t.Fatalf("expected different ids for different hunk hashes")
	}
}
