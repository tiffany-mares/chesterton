package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
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
	checkRunAuth  atomic.Value // string, last Authorization header seen (may be absent -> "")

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
		d.checkRunAuth.Store(r.Header.Get("Authorization"))
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

// TestHandleJudge_InstallationToken_ThreadsAuthorizationHeader asserts that
// JudgeRequest.InstallationToken is forwarded to the check-run POST as
// "Authorization: Bearer <token>" when present, and that no Authorization
// header is sent when the request omits the token (mock mode). See
// docs/contracts.md "verdict (Go)" and "mocks — GitHub API emulation".
func TestHandleJudge_InstallationToken_ThreadsAuthorizationHeader(t *testing.T) {
	srv, d := newTestServer(t, true)
	defer d.close()

	rec, _ := doJudge(t, srv, JudgeRequest{
		Repo: "acme/storefront", PR: 1, HeadSHA: "sha1",
		InstallationToken: "tok-xyz789",
		Hunks:             []Hunk{sampleHunk()},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if got := d.checkRunAuth.Load(); got != "Bearer tok-xyz789" {
		t.Fatalf("expected Authorization header %q, got %q", "Bearer tok-xyz789", got)
	}

	// Different head_sha avoids the per-request cache from the previous call.
	rec2, _ := doJudge(t, srv, JudgeRequest{
		Repo: "acme/storefront", PR: 1, HeadSHA: "sha1-no-token",
		Hunks: []Hunk{sampleHunk()},
	})
	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec2.Code, rec2.Body.String())
	}
	if got := d.checkRunAuth.Load(); got != "" {
		t.Fatalf("expected no Authorization header when installation_token is empty, got %q", got)
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
	// Controller ruling: for stale_comment flags, the PUBLIC HunkHash is the
	// synthetic "stale:<file>:<line>" key, NOT the inherited real hunk_hash
	// ("hh-timeout") -- the same key the ledger row is upserted under. This
	// keeps gateway's POST /flags/:id/dismiss (which upserts the ledger by
	// flag.hunk_hash) targeting the same row the ledger already has.
	wantHunkHash := "stale:services/checkout/api.py:29"
	if f.HunkHash != wantHunkHash {
		t.Fatalf("expected flag hunk_hash %q (synthetic ledger key), got %q", wantHunkHash, f.HunkHash)
	}
}

// TestHandleJudge_StaleCommentAdjacentToItsHunk_DoesNotCollideInLedger
// reproduces an e2e-only bug (task-11): extractComments assigns a comment the
// hunk_hash of its nearest hunk below it (per docs/contracts.md), so a
// comment directly above its only adjacent hunk shares that hunk's
// hunk_hash. The ledger upserts verdict rows on (repo, head_sha, hunk_hash)
// alone, so if processHunk's "no flag" write and processComment's "stale
// flag" write both use that same hunk_hash, one silently overwrites the
// other depending on goroutine completion order -- nondeterministically
// losing the stale_comment flag. This is exactly PR3 from docs/contracts.md
// ("the three demo PRs"): one hunk (CHECKOUT_TIMEOUT_SECONDS), one comment
// directly above it, NO_EVIDENCE on the hunk itself, stale on the comment.
//
// The simple httptest ledger mock used by the other tests above always
// returns the same fixed ID and never tracks per-key state, so it can't
// catch this -- this test uses a stateful mock that performs the real
// upsert-by-(repo,head_sha,hunk_hash) ledger does, to assert both verdicts
// land in distinct rows.
func TestHandleJudge_StaleCommentAdjacentToItsHunk_DoesNotCollideInLedger(t *testing.T) {
	d := &testDeps{}
	d.askVerdict = Verdict{Verdict: "NO_EVIDENCE", Reason: "no decision covers this", Citations: nil}
	d.staleResp = staleResponse{Stale: true, Reason: "comment references removed value", Citations: []Citation{{Type: "linear", URL: "http://x", Title: "ENG-310"}}}

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
	defer d.estelleSrv.Close()

	// Stateful ledger mock: real upsert-by-(repo,head_sha,hunk_hash), like
	// the actual Spring Boot ledger service (VerdictService.upsert).
	type row struct {
		id      int64
		verdict string
		payload string
	}
	var mu sync.Mutex
	rows := map[string]*row{}
	var nextID int64
	d.ledgerSrv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		d.ledgerCalls.Add(1)
		var body ledgerVerdictRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		key := body.Repo + ":" + body.HeadSHA + ":" + body.HunkHash
		mu.Lock()
		rec, ok := rows[key]
		if !ok {
			nextID++
			rec = &row{id: nextID}
			rows[key] = rec
		}
		rec.verdict = body.Verdict
		rec.payload = string(body.Payload)
		id := rec.id
		mu.Unlock()
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(ledgerVerdictRow{ID: id})
	}))
	defer d.ledgerSrv.Close()

	d.checkRunSrv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		d.checkRunCalls.Add(1)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(checkRunRow{ID: 12})
	}))
	defer d.checkRunSrv.Close()

	srv := NewServer(
		newEstelleClient(d.estelleSrv.URL, http.DefaultClient),
		newLedgerClient(d.ledgerSrv.URL, http.DefaultClient),
		newCheckRunClient(d.checkRunSrv.URL, http.DefaultClient),
		newMemCache(),
	)

	hunk := Hunk{
		File: "services/checkout/api.py", OldStart: 8, OldEnd: 8, NewStart: 8, NewEnd: 8,
		OldLines: []string{"CHECKOUT_TIMEOUT_SECONDS = 30"}, NewLines: []string{"CHECKOUT_TIMEOUT_SECONDS = 5"},
		HunkHash: "hh-timeout",
	}
	rec, resp := doJudge(t, srv, JudgeRequest{
		Repo: "acme/storefront", PR: 3, HeadSHA: "shaPR3",
		Hunks:    []Hunk{hunk},
		Comments: []Comment{{File: "services/checkout/api.py", Line: 7, Text: "# timeout is 30s, see ENG-310", HunkHash: "hh-timeout"}},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	if len(resp.Flags) != 1 || resp.Flags[0].Kind != "stale_comment" {
		t.Fatalf("expected exactly 1 stale_comment flag in the response, got %+v", resp.Flags)
	}
	// Controller ruling: the public Flag.HunkHash for a stale_comment flag
	// is the synthetic ledger key, not the inherited real hunk_hash
	// ("hh-timeout") -- one variable, used for both the ledger upsert and
	// the Flag field, so they can never diverge.
	wantHunkHash := "stale:services/checkout/api.py:7"
	if resp.Flags[0].HunkHash != wantHunkHash {
		t.Fatalf("expected flag hunk_hash %q (synthetic ledger key), got %q", wantHunkHash, resp.Flags[0].HunkHash)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(rows) != 2 {
		t.Fatalf("expected 2 distinct ledger rows (hunk ask-check + comment stale-check), got %d: %+v", len(rows), rows)
	}
	hunkKey := "acme/storefront:shaPR3:hh-timeout"
	hr, ok := rows[hunkKey]
	if !ok {
		t.Fatalf("expected a ledger row for the hunk's own ask-check at key %q, rows: %+v", hunkKey, rows)
	}
	if hr.verdict != "NO_EVIDENCE" {
		t.Fatalf("hunk ask-check row was overwritten by the comment's stale-check write: verdict=%q payload=%s", hr.verdict, hr.payload)
	}
	commentKey := "acme/storefront:shaPR3:" + wantHunkHash
	cr, ok := rows[commentKey]
	if !ok {
		t.Fatalf("expected a ledger row for the comment's stale-check at the SAME key as flag.hunk_hash (%q), rows: %+v", commentKey, rows)
	}
	if cr.verdict != "YES" {
		t.Fatalf("expected comment stale-check row verdict YES, got %q", cr.verdict)
	}
}

// TestHandleJudge_StaleComment_InlineHunkWithNoMatchingRequestHunk_StillChecked
// is the final-review fix for a dropped-flag bug: gateway extracts comments
// against ALL hunks the analyzer produced, but only forwards hunks scoring
// >= 0.5 in JudgeRequest.Hunks. Before this fix, processComment looked up a
// comment's hunk solely via hunkByHash (built from JudgeRequest.Hunks), so a
// comment adjacent to a low-scoring (filtered-out) hunk had no hunk context
// and its stale check was silently skipped. Embedding the hunk inline on the
// Comment (Comment.Hunk) fixes this -- assert the stale check still runs
// when the request's Hunks[] does NOT contain a hunk matching the comment's
// hunk_hash, as long as the comment carries its own inline Hunk.
func TestHandleJudge_StaleComment_InlineHunkWithNoMatchingRequestHunk_StillChecked(t *testing.T) {
	srv, d := newTestServer(t, false)
	d.staleResp = staleResponse{Stale: true, Reason: "comment references removed value", Citations: []Citation{{Type: "linear", URL: "http://x", Title: "ENG-310"}}}
	defer d.close()

	inlineHunk := Hunk{
		File: "services/checkout/api.py", OldStart: 30, OldEnd: 30, NewStart: 30, NewEnd: 30,
		OldLines: []string{"CHECKOUT_TIMEOUT_SECONDS = 30"}, NewLines: []string{"CHECKOUT_TIMEOUT_SECONDS = 5"},
		HunkHash: "hh-filtered-out",
	}

	rec, resp := doJudge(t, srv, JudgeRequest{
		Repo: "acme/storefront", PR: 3, HeadSHA: "sha-inline-hunk",
		// Hunks[] is empty: the adjacent hunk scored below the triage
		// threshold and was filtered out before reaching /judge.
		Hunks: nil,
		Comments: []Comment{{
			File: "services/checkout/api.py", Line: 29, Text: "# timeout is 30s, see ENG-310",
			HunkHash: "hh-filtered-out", Hunk: &inlineHunk,
		}},
	})

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if d.staleCalls.Load() != 1 {
		t.Fatalf("expected the stale check to run using the comment's inline hunk, got %d /v1/stale calls", d.staleCalls.Load())
	}
	if len(resp.Flags) != 1 {
		t.Fatalf("expected exactly 1 stale_comment flag, got %d: %+v", len(resp.Flags), resp.Flags)
	}
	f := resp.Flags[0]
	if f.Kind != "stale_comment" {
		t.Fatalf("expected kind stale_comment, got %q", f.Kind)
	}
	if f.Line != 29 {
		t.Fatalf("expected flag line 29, got %d", f.Line)
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
