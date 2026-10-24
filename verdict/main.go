// Command verdict runs the Chesterton verdict service: POST /judge per
// docs/contracts.md "verdict (Go)". See task-6-brief.md for the scope.
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"
)

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// getenvSeconds reads an integer-seconds env var, falling back on unset or
// unparseable values. Real Estelle backends can be much slower than the mock,
// so both HTTP and judge budgets are tunable.
func getenvSeconds(key string, fallback time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		log.Printf("verdict: ignoring invalid %s=%q (want integer seconds)", key, v)
		return fallback
	}
	return time.Duration(n) * time.Second
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

	httpClient := &http.Client{Timeout: getenvSeconds("VERDICT_HTTP_TIMEOUT_SECONDS", 20*time.Second)}
	judgeTimeout = getenvSeconds("VERDICT_JUDGE_TIMEOUT_SECONDS", judgeTimeout)

	startCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, backend := newCache(startCtx, redisURL)
	log.Printf("verdict: using %s cache backend", backend)

	estelle := newEstelleClient(estelleURL, httpClient)
	estelle.apiKey = os.Getenv("ESTELLE_API_KEY")

	s := NewServer(
		estelle,
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
