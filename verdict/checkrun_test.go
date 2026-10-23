package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCheckRunClient_Post(t *testing.T) {
	var gotBody checkRunRequest
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("decode: %v", err)
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(checkRunRow{ID: 12})
	}))
	defer srv.Close()

	cc := newCheckRunClient(srv.URL, http.DefaultClient)
	id, err := cc.Post(context.Background(), "acme/storefront", "sha123", "action_required", "- **f:1** — reason")
	if err != nil {
		t.Fatalf("Post: %v", err)
	}
	if id != 12 {
		t.Fatalf("expected id 12, got %d", id)
	}
	if gotPath != "/repos/acme/storefront/check-runs" {
		t.Fatalf("unexpected path %s", gotPath)
	}
	if gotBody.Name != "Chesterton" || gotBody.HeadSHA != "sha123" || gotBody.Conclusion != "action_required" {
		t.Fatalf("unexpected body: %+v", gotBody)
	}
	if gotBody.Output.Summary != "- **f:1** — reason" {
		t.Fatalf("unexpected summary: %q", gotBody.Output.Summary)
	}
}

func TestCheckRunClient_Post_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	cc := newCheckRunClient(srv.URL, http.DefaultClient)
	_, err := cc.Post(context.Background(), "repo", "sha", "neutral", "")
	if err == nil {
		t.Fatalf("expected error on 500 response")
	}
}
