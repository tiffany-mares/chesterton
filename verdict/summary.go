package main

import (
	"fmt"
	"hash/fnv"
	"strings"
)

// buildSummary renders the check-run output.summary: a markdown bullet list,
// one line per flag, "**file:line** — reason" followed by citation links.
func buildSummary(flags []Flag) string {
	if len(flags) == 0 {
		return "No contradictions or stale comments detected."
	}

	lines := make([]string, 0, len(flags))
	for _, f := range flags {
		line := fmt.Sprintf("- **%s:%d** — %s", f.File, f.Line, f.Reason)
		if len(f.Citations) > 0 {
			links := make([]string, 0, len(f.Citations))
			for _, c := range f.Citations {
				links = append(links, fmt.Sprintf("[%s](%s)", c.Title, c.URL))
			}
			line += " " + strings.Join(links, " ")
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n")
}

// conclusionFor returns the check-run conclusion: "neutral" if there are no
// flags, "action_required" if there is at least one.
func conclusionFor(flags []Flag) string {
	if len(flags) == 0 {
		return "neutral"
	}
	return "action_required"
}

// fallbackFlagID computes a deterministic id for a flag when the ledger is
// unreachable, per task-6-brief.md: FNV-1a hash of repo+head_sha+hunk_hash
// (or repo+head_sha+stale-discriminator for stale-comment flags), truncated
// to fit a JSON-safe positive integer.
func fallbackFlagID(repo, headSHA, discriminator string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(repo + "|" + headSHA + "|" + discriminator))
	// Mask to 48 bits so the value round-trips safely through float64 JSON
	// numbers (and stays positive).
	return int64(h.Sum64() & 0x0000FFFFFFFFFFFF)
}
