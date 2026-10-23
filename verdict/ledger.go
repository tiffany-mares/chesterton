package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
)

// ledgerClient wraps POST {LEDGER_URL}/verdicts. Per task-6-brief.md, ledger
// failures must never fail the /judge call: PostVerdict logs and returns
// ok=false instead of an error.
type ledgerClient struct {
	baseURL string
	http    *http.Client
}

func newLedgerClient(baseURL string, httpClient *http.Client) *ledgerClient {
	return &ledgerClient{baseURL: baseURL, http: httpClient}
}

// PostVerdict persists a verdict row. Returns (rowID, true) on success, or
// (0, false) if the ledger is unreachable or returns a non-2xx status — in
// which case the caller should fall back to a deterministic ID and continue.
func (c *ledgerClient) PostVerdict(ctx context.Context, body ledgerVerdictRequest) (int64, bool) {
	buf, err := json.Marshal(body)
	if err != nil {
		log.Printf("ledger: marshal request: %v", err)
		return 0, false
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/verdicts", bytes.NewReader(buf))
	if err != nil {
		log.Printf("ledger: build request: %v", err)
		return 0, false
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		log.Printf("ledger: unreachable (%v); continuing without persistence", err)
		return 0, false
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Printf("ledger: POST /verdicts returned status %d; continuing without persistence", resp.StatusCode)
		return 0, false
	}

	var row ledgerVerdictRow
	if err := json.NewDecoder(resp.Body).Decode(&row); err != nil {
		log.Printf("ledger: decode response: %v; continuing without persistence", err)
		return 0, false
	}
	return row.ID, true
}
