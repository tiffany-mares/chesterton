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

func TestEstelleClient_Ask_SendsAPIKeyWhenSet(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(Verdict{Verdict: "NO"})
	}))
	defer srv.Close()

	ec := newEstelleClient(srv.URL, http.DefaultClient)
	ec.apiKey = "sk-estelle-test"
	if _, err := ec.Ask(context.Background(), "repo", Hunk{}); err != nil {
		t.Fatalf("Ask: %v", err)
	}
	if gotAuth != "Bearer sk-estelle-test" {
		t.Fatalf("expected Authorization header, got %q", gotAuth)
	}

	// Without a key, no Authorization header is sent (mock mode).
	ec2 := newEstelleClient(srv.URL, http.DefaultClient)
	if _, err := ec2.Ask(context.Background(), "repo", Hunk{}); err != nil {
		t.Fatalf("Ask: %v", err)
	}
	if gotAuth != "" {
		t.Fatalf("expected no Authorization header without key, got %q", gotAuth)
	}
}

func TestEstelleClient_Stale_404DegradesToNotStale(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	ec := newEstelleClient(srv.URL, http.DefaultClient)
	resp, err := ec.Stale(context.Background(), "repo", "f.py", "# c", 1, Hunk{})
	if err != nil {
		t.Fatalf("expected graceful degrade on 404, got error: %v", err)
	}
	if resp.Stale {
		t.Fatalf("expected stale=false on 404 degrade, got %+v", resp)
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
