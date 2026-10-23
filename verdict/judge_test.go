package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

// testDeps wires up httptest servers for Estelle, ledger, and GitHub
// check-runs, plus counters used to assert call counts (cache-hit behavior).
type testDeps struct {
	estelleSrv    *httptest.Server
	ledgerSrv     *httptest.Server
	checkRunSrv   *httptest.Server
	askCalls      atomic.Int64
	staleCalls    atomic.Int64
	ledgerCalls   atomic.Int64
	checkRunCalls atomic.Int64

	askVerdict  Verdict
	staleResp   staleResponse
	ledgerFails bool
}

func newTestServer(t *testing.T, flagged bool) (*Server, *testDeps) {
	t.Helper()
	d := &testDeps{}

	d.estelleSrv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/ask":
			d.askCalls.Add(1)
			json.NewEncoder(w).Encode(d.askVerdict)
		case "/v1/stale":
			d.staleCalls.Add(1)
			json.NewEncoder(w).Encode(d.staleResp)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))

	d.ledgerSrv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		d.ledgerCalls.Add(1)
		if d.ledgerFails {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(ledgerVerdictRow{ID: 999})
	}))

	d.checkRunSrv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		d.checkRunCalls.Add(1)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(checkRunRow{ID: 12})
	}))

	if flagged {
		d.askVerdict = Verdict{Verdict: "YES", Reason: "contradiction reason", Citations: []Citation{{Type: "slack", URL: "http://x", Title: "t"}}}
	} else {
		d.askVerdict = Verdict{Verdict: "NO_EVIDENCE", Reason: "no decision covers this", Citations: nil}
	}
	d.staleResp = staleResponse{Stale: false, Reason: "still fresh", Citations: nil}

	srv := NewServer(
		newEstelleClient(d.estelleSrv.URL, http.DefaultClient),
		newLedgerClient(d.ledgerSrv.URL, http.DefaultClient),
		newCheckRunClient(d.checkRunSrv.URL, http.DefaultClient),
		newMemCache(),
	)
	return srv, d
}

func (d *testDeps) close() {
	d.estelleSrv.Close()
	d.ledgerSrv.Close()
	d.checkRunSrv.Close()
}

func doJudge(t *testing.T, srv *Server, req JudgeRequest) (*httptest.ResponseRecorder, JudgeResponse) {
	t.Helper()
	buf, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	httpReq := httptest.NewRequest(http.MethodPost, "/judge", bytes.NewReader(buf))
	httpReq.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.handleJudge(rec, httpReq)

	var resp JudgeResponse
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal response: %v (body: %s)", err, rec.Body.String())
		}
	}
	return rec, resp
}

func sampleHunk() Hunk {
	return Hunk{
		File:     "services/payments/client.py",
		OldStart: 5, OldEnd: 5,
		NewStart: 5, NewEnd: 5,
		OldLines: []string{"MAX_RETRIES = 3"},
		NewLines: []string{"MAX_RETRIES = 50"},
		HunkHash: "hh1",
	}
}

func TestHandleJudge_FlaggedHunk_ProducesFlagAndActionRequiredCheckRun(t *testing.T) {
	srv, d := newTestServer(t, true)
	defer d.close()

	rec, resp := doJudge(t, srv, JudgeRequest{
		Repo: "acme/storefront", PR: 1, HeadSHA: "sha1",
		Hunks: []Hunk{sampleHunk()},
	})

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(resp.Flags) != 1 {
		t.Fatalf("expected 1 flag, got %d: %+v", len(resp.Flags), resp.Flags)
	}
	f := resp.Flags[0]
	if f.Kind != "contradiction" || f.Verdict != "YES" || f.File != "services/payments/client.py" {
		t.Fatalf("unexpected flag: %+v", f)
	}
	if f.ID != 999 {
		t.Fatalf("expected ledger-assigned id 999, got %d", f.ID)
	}
	if resp.CheckRunID != 12 {
		t.Fatalf("expected check_run_id 12, got %d", resp.CheckRunID)
	}
	if d.checkRunCalls.Load() != 1 {
		t.Fatalf("expected exactly 1 check-run post")
	}
}

func TestHandleJudge_NoEvidence_ProducesNoFlagAndNeutralCheckRun(t *testing.T) {
	srv, d := newTestServer(t, false)
	defer d.close()

	rec, resp := doJudge(t, srv, JudgeRequest{
		Repo: "acme/storefront", PR: 2, HeadSHA: "sha2",
		Hunks: []Hunk{sampleHunk()},
	})

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(resp.Flags) != 0 {
		t.Fatalf("expected 0 flags, got %d: %+v", len(resp.Flags), resp.Flags)
	}
	if resp.CheckRunID != 12 {
		t.Fatalf("expected check_run_id 12, got %d", resp.CheckRunID)
	}
	// Still persisted to ledger even with no flag (verdict NO_EVIDENCE, null decision).
	if d.ledgerCalls.Load() != 1 {
		t.Fatalf("expected 1 ledger call for the no-flag hunk, got %d", d.ledgerCalls.Load())
	}
}

func TestHandleJudge_CacheHit_SkipsEstelleAndReturnsIdenticalFlag(t *testing.T) {
	srv, d := newTestServer(t, true)
	defer d.close()

	req := JudgeRequest{Repo: "acme/storefront", PR: 1, HeadSHA: "sha1", Hunks: []Hunk{sampleHunk()}}

	_, resp1 := doJudge(t, srv, req)
	if d.askCalls.Load() != 1 {
		t.Fatalf("expected 1 Estelle /v1/ask call after first judge, got %d", d.askCalls.Load())
	}

	_, resp2 := doJudge(t, srv, req)
	if d.askCalls.Load() != 1 {
		t.Fatalf("expected Estelle ask call count to stay at 1 after cache hit, got %d", d.askCalls.Load())
	}

	b1, _ := json.Marshal(resp1.Flags)
	b2, _ := json.Marshal(resp2.Flags)
	if string(b1) != string(b2) {
		t.Fatalf("expected byte-identical flag JSON on cache hit:\n%s\nvs\n%s", b1, b2)
	}
}

func TestHandleJudge_LedgerUnreachable_StillReturnsFlagsAndChecksRun(t *testing.T) {
	srv, d := newTestServer(t, true)
	d.ledgerFails = true
	defer d.close()

	rec, resp := doJudge(t, srv, JudgeRequest{
		Repo: "acme/storefront", PR: 1, HeadSHA: "sha3",
		Hunks: []Hunk{sampleHunk()},
	})

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 even with ledger down, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(resp.Flags) != 1 {
		t.Fatalf("expected flag still returned despite ledger failure, got %d", len(resp.Flags))
	}
	if resp.Flags[0].ID == 0 {
		t.Fatalf("expected a fallback (nonzero) flag id when ledger is unreachable")
	}
	if resp.CheckRunID != 12 {
		t.Fatalf("expected check run still posted, got %d", resp.CheckRunID)
	}
}

func TestHandleJudge_StaleComment_ProducesStaleFlag(t *testing.T) {
	srv, d := newTestServer(t, false)
	d.staleResp = staleResponse{Stale: true, Reason: "comment references removed value", Citations: []Citation{{Type: "linear", URL: "http://x", Title: "ENG-310"}}}
	defer d.close()

	hunk := Hunk{
		File: "services/checkout/api.py", OldStart: 30, OldEnd: 30, NewStart: 30, NewEnd: 30,
		OldLines: []string{"CHECKOUT_TIMEOUT_SECONDS = 30"}, NewLines: []string{"CHECKOUT_TIMEOUT_SECONDS = 5"},
		HunkHash: "hh-timeout",
	}
	rec, resp := doJudge(t, srv, JudgeRequest{
		Repo: "acme/storefront", PR: 3, HeadSHA: "sha4",
		Hunks:    []Hunk{hunk},
		Comments: []Comment{{File: "services/checkout/api.py", Line: 29, Text: "# timeout is 30s, see ENG-310", HunkHash: "hh-timeout"}},
	})

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(resp.Flags) != 1 {
		t.Fatalf("expected exactly 1 flag (stale comment, no contradiction), got %d: %+v", len(resp.Flags), resp.Flags)
	}
	f := resp.Flags[0]
	if f.Kind != "stale_comment" {
		t.Fatalf("expected kind stale_comment, got %q", f.Kind)
	}
	if f.Line != 29 {
		t.Fatalf("expected flag line to be comment_line 29, got %d", f.Line)
	}
}

func TestHandleJudge_RejectsMissingRepo(t *testing.T) {
	srv, d := newTestServer(t, false)
	defer d.close()

	rec, _ := doJudge(t, srv, JudgeRequest{HeadSHA: "sha", Hunks: nil})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing repo, got %d", rec.Code)
	}
}
