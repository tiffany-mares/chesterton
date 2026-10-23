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
	id, err := cc.Post(context.Background(), "acme/storefront", "sha123", "action_required", "- **f:1** — reason", "")
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
	_, err := cc.Post(context.Background(), "repo", "sha", "neutral", "", "")
	if err == nil {
		t.Fatalf("expected error on 500 response")
	}
}

// TestCheckRunClient_Post_Authorization asserts that the check-run POST
// carries "Authorization: Bearer <installationToken>" when a non-empty
// installation token is supplied (real mode), and carries no Authorization
// header at all when the token is empty (mock mode). See
// docs/contracts.md "mocks — GitHub API emulation": "Real mode:
// gateway/verdict send `Authorization: Bearer $GITHUB_TOKEN`."
func TestCheckRunClient_Post_Authorization(t *testing.T) {
	var gotAuth string
	var gotAuthPresent bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_, gotAuthPresent = r.Header["Authorization"]
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(checkRunRow{ID: 1})
	}))
	defer srv.Close()

	cc := newCheckRunClient(srv.URL, http.DefaultClient)

	if _, err := cc.Post(context.Background(), "acme/storefront", "sha123", "neutral", "", "tok-abc123"); err != nil {
		t.Fatalf("Post with token: %v", err)
	}
	if !gotAuthPresent {
		t.Fatalf("expected Authorization header to be present when installationToken is non-empty")
	}
	if gotAuth != "Bearer tok-abc123" {
		t.Fatalf("expected Authorization header %q, got %q", "Bearer tok-abc123", gotAuth)
	}

	if _, err := cc.Post(context.Background(), "acme/storefront", "sha123", "neutral", "", ""); err != nil {
		t.Fatalf("Post without token: %v", err)
	}
	if gotAuthPresent {
		t.Fatalf("expected no Authorization header when installationToken is empty, got %q", gotAuth)
	}
}
