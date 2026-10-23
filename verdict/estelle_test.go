package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEstelleClient_Ask(t *testing.T) {
	var gotBody askRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/ask" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("decode: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(Verdict{Verdict: "YES", Reason: "r", Citations: []Citation{{Type: "slack", URL: "u", Title: "t"}}})
	}))
	defer srv.Close()

	ec := newEstelleClient(srv.URL, http.DefaultClient)
	v, err := ec.Ask(context.Background(), "acme/storefront", Hunk{File: "f.py", HunkHash: "abc"})
	if err != nil {
		t.Fatalf("Ask: %v", err)
	}
	if v.Verdict != "YES" || len(v.Citations) != 1 {
		t.Fatalf("unexpected verdict: %+v", v)
	}
	if gotBody.Repo != "acme/storefront" || gotBody.Hunk.File != "f.py" {
		t.Fatalf("unexpected request body sent: %+v", gotBody)
	}
}

func TestEstelleClient_Ask_NonOKStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	ec := newEstelleClient(srv.URL, http.DefaultClient)
	_, err := ec.Ask(context.Background(), "repo", Hunk{})
	if err == nil {
		t.Fatalf("expected error on 500 response")
	}
}

func TestEstelleClient_Stale(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/stale" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(staleResponse{Stale: true, Reason: "stale!", Citations: nil})
	}))
	defer srv.Close()

	ec := newEstelleClient(srv.URL, http.DefaultClient)
	resp, err := ec.Stale(context.Background(), "acme/storefront", "f.py", "# comment", 9, Hunk{})
	if err != nil {
		t.Fatalf("Stale: %v", err)
	}
	if !resp.Stale || resp.Reason != "stale!" {
		t.Fatalf("unexpected response: %+v", resp)
	}
}
