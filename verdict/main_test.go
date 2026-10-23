package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthz(t *testing.T) {
	mux := newMux(NewServer(
		newEstelleClient("http://unused", http.DefaultClient),
		newLedgerClient("http://unused", http.DefaultClient),
		newCheckRunClient("http://unused", http.DefaultClient),
		newMemCache(),
	))

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if body["ok"] != true || body["service"] != "verdict" {
		t.Fatalf("unexpected body: %+v", body)
	}
}
