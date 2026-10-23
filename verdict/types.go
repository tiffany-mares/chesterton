// Package main implements the Chesterton verdict service (docs/contracts.md,
// "verdict (Go)" section). This file holds the JSON shapes shared across the
// service: the contract types (Hunk, Citation, Verdict, Flag) plus the
// request/response envelopes for /judge and the upstream APIs it calls.
package main

import "encoding/json"

// Hunk is produced by diff-analyzer and forwarded to us (via gateway/triage)
// unchanged. See docs/contracts.md "Hunk".
type Hunk struct {
	File     string   `json:"file"`
	OldStart int      `json:"old_start"`
	OldEnd   int      `json:"old_end"`
	NewStart int      `json:"new_start"`
	NewEnd   int      `json:"new_end"`
	OldLines []string `json:"old_lines"`
	NewLines []string `json:"new_lines"`
	Symbol   string   `json:"symbol,omitempty"`
	HunkHash string   `json:"hunk_hash"`
}

// Citation points at the evidence for a decision. Per docs/contracts.md,
// Estelle citations never carry line anchors today, but LineStart/LineEnd
// are modeled (and used by the strictness check below when present) so the
// anchor-overlap rule is forward-compatible rather than dead code.
type Citation struct {
	Type      string `json:"type"`
	URL       string `json:"url"`
	Title     string `json:"title"`
	LineStart *int   `json:"line_start,omitempty"`
	LineEnd   *int   `json:"line_end,omitempty"`
}

// Verdict is Estelle's /v1/ask answer shape (also the stored-verdict payload
// shape per docs/contracts.md).
type Verdict struct {
	Verdict   string     `json:"verdict"` // YES | NO | NO_EVIDENCE
	Reason    string     `json:"reason"`
	Citations []Citation `json:"citations"`
}

// Flag is what the extension/dashboard consume (docs/contracts.md "Flag").
type Flag struct {
	ID        int64      `json:"id"`
	Repo      string     `json:"repo"`
	PR        int        `json:"pr"`
	HeadSHA   string     `json:"head_sha"`
	File      string     `json:"file"`
	Line      int        `json:"line"`
	Kind      string     `json:"kind"` // contradiction | stale_comment
	Verdict   string     `json:"verdict"`
	Reason    string     `json:"reason"`
	Citations []Citation `json:"citations"`
	HunkHash  string     `json:"hunk_hash"`
	Status    string     `json:"status"` // open | dismissed | overridden
}

// Comment is an optional entry in JudgeRequest for stale-comment checks.
//
// Hunk carries the adjacent Hunk object INLINE. Gateway extracts comments
// against ALL hunks the analyzer produced, but only forwards hunks scoring
// >= 0.5 in JudgeRequest.Hunks -- a comment next to a hunk that scored below
// that threshold would otherwise have no hunk context here. processComment
// prefers this inline Hunk and falls back to a HunkHash lookup against
// JudgeRequest.Hunks only for backward compatibility (docs/contracts.md
// "verdict (Go)" /judge request).
type Comment struct {
	File     string `json:"file"`
	Line     int    `json:"line"`
	Text     string `json:"text"`
	HunkHash string `json:"hunk_hash"`
	Hunk     *Hunk  `json:"hunk,omitempty"`
}

// JudgeRequest is the POST /judge body.
type JudgeRequest struct {
	Repo              string    `json:"repo"`
	PR                int       `json:"pr"`
	HeadSHA           string    `json:"head_sha"`
	InstallationToken string    `json:"installation_token"`
	Hunks             []Hunk    `json:"hunks"`
	Comments          []Comment `json:"comments"`
}

// JudgeResponse is the POST /judge reply.
type JudgeResponse struct {
	Flags      []Flag `json:"flags"`
	CheckRunID int64  `json:"check_run_id"`
}

// --- Estelle client shapes ---

type askRequest struct {
	Repo string `json:"repo"`
	Hunk Hunk   `json:"hunk"`
}

type staleRequest struct {
	Repo        string `json:"repo"`
	File        string `json:"file"`
	Comment     string `json:"comment"`
	CommentLine int    `json:"comment_line"`
	Hunk        Hunk   `json:"hunk"`
}

type staleResponse struct {
	Stale     bool       `json:"stale"`
	Reason    string     `json:"reason"`
	Citations []Citation `json:"citations"`
}

// --- Ledger client shapes ---

type ledgerVerdictRequest struct {
	Repo       string          `json:"repo"`
	PR         int             `json:"pr"`
	HeadSHA    string          `json:"head_sha"`
	HunkHash   string          `json:"hunk_hash"`
	DecisionID *int64          `json:"decision_id"`
	Verdict    string          `json:"verdict"`
	Payload    json.RawMessage `json:"payload"`
}

type ledgerVerdictRow struct {
	ID int64 `json:"id"`
}

// --- GitHub check-runs client shapes ---

type checkRunOutput struct {
	Title   string `json:"title"`
	Summary string `json:"summary"`
}

type checkRunRequest struct {
	Name       string         `json:"name"`
	HeadSHA    string         `json:"head_sha"`
	Status     string         `json:"status"`
	Conclusion string         `json:"conclusion"`
	Output     checkRunOutput `json:"output"`
}

type checkRunRow struct {
	ID int64 `json:"id"`
}
