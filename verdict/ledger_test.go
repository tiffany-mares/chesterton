package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLedgerClient_PostVerdict_Success(t *testing.T) {
	var gotBody ledgerVerdictRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/verdicts" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("decode: %v", err)
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(ledgerVerdictRow{ID: 42})
	}))
	defer srv.Close()

	lc := newLedgerClient(srv.URL, http.DefaultClient)
	id, ok := lc.PostVerdict(context.Background(), ledgerVerdictRequest{
		Repo: "acme/storefront", PR: 1, HeadSHA: "sha", HunkHash: "hh", Verdict: "YES",
		Payload: json.RawMessage(`{"a":1}`),
	})
	if !ok {
		t.Fatalf("expected ok=true")
	}
	if id != 42 {
		t.Fatalf("expected id 42, got %d", id)
	}
	if gotBody.Repo != "acme/storefront" {
		t.Fatalf("unexpected body sent: %+v", gotBody)
	}
}

func TestLedgerClient_PostVerdict_Unreachable(t *testing.T) {
	// Nothing listens here; the request should fail fast and return ok=false
	// without panicking, per "ledger failure tolerated" in task-6-brief.md.
	lc := newLedgerClient("http://127.0.0.1:1", http.DefaultClient)
	id, ok := lc.PostVerdict(context.Background(), ledgerVerdictRequest{Repo: "r"})
	if ok {
		t.Fatalf("expected ok=false for unreachable ledger")
	}
	if id != 0 {
		t.Fatalf("expected id 0 on failure, got %d", id)
	}
}

func TestLedgerClient_PostVerdict_NonCreatedStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	lc := newLedgerClient(srv.URL, http.DefaultClient)
	_, ok := lc.PostVerdict(context.Background(), ledgerVerdictRequest{Repo: "r"})
	if ok {
		t.Fatalf("expected ok=false on 500 response")
	}
}
