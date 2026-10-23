// Command verdict runs the Chesterton verdict service: POST /judge per
// docs/contracts.md "verdict (Go)". See task-6-brief.md for the scope.
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"
)

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// newMux wires the service's HTTP surface.
func newMux(s *Server) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "service": "verdict"})
	})
	mux.HandleFunc("POST /judge", s.handleJudge)
	return mux
}

func main() {
	estelleURL := getenv("ESTELLE_URL", "http://localhost:4100/estelle")
	githubAPIURL := getenv("GITHUB_API_URL", "http://localhost:4100/github/api")
	ledgerURL := getenv("LEDGER_URL", "http://localhost:4400")
	redisURL := os.Getenv("REDIS_URL")
	port := getenv("PORT", "4300")

	httpClient := &http.Client{Timeout: 20 * time.Second}

	startCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, backend := newCache(startCtx, redisURL)
	log.Printf("verdict: using %s cache backend", backend)

	s := NewServer(
		newEstelleClient(estelleURL, httpClient),
		newLedgerClient(ledgerURL, httpClient),
		newCheckRunClient(githubAPIURL, httpClient),
		c,
	)

	addr := ":" + port
	log.Printf("verdict: listening on %s (estelle=%s github=%s ledger=%s)", addr, estelleURL, githubAPIURL, ledgerURL)
	if err := http.ListenAndServe(addr, newMux(s)); err != nil {
		log.Fatalf("verdict: server error: %v", err)
	}
}
