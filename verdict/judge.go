// judge.go orchestrates POST /judge: per-hunk Estelle /v1/ask calls (bounded
// concurrency 4), the strictness rule, per-comment /v1/stale checks, ledger
// persistence (best-effort), the GitHub check run, and the cache that lets a
// repeat call for the same repo:head_sha:hunk_hash skip Estelle entirely.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"golang.org/x/sync/errgroup"
)

const maxConcurrentEstelleCalls = 4

// sentinel cache value meaning "this hunk/comment was checked and produced
// no flag" (as opposed to "not cached yet").
const noFlagSentinel = "null"

// Server holds the upstream clients and cache used by handleJudge.
type Server struct {
	estelle   *estelleClient
	ledger    *ledgerClient
	checkRuns *checkRunClient
	cache     cache
}

func NewServer(estelle *estelleClient, ledger *ledgerClient, checkRuns *checkRunClient, c cache) *Server {
	return &Server{estelle: estelle, ledger: ledger, checkRuns: checkRuns, cache: c}
}

// handleJudge implements POST /judge per docs/contracts.md "verdict (Go)".
func (s *Server) handleJudge(w http.ResponseWriter, r *http.Request) {
	var req JudgeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("invalid JSON body: %v", err), http.StatusBadRequest)
		return
	}
	if req.Repo == "" || req.HeadSHA == "" {
		http.Error(w, "repo and head_sha are required", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	hunkByHash := make(map[string]Hunk, len(req.Hunks))
	for _, h := range req.Hunks {
		hunkByHash[h.HunkHash] = h
	}

	hunkFlags := make([]*Flag, len(req.Hunks))
	commentFlags := make([]*Flag, len(req.Comments))

	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(maxConcurrentEstelleCalls)

	for i, h := range req.Hunks {
		i, h := i, h
		g.Go(func() error {
			flag, err := s.processHunk(gctx, req.Repo, req.PR, req.HeadSHA, h)
			if err != nil {
				return err
			}
			hunkFlags[i] = flag
			return nil
		})
	}
	for i, c := range req.Comments {
		i, c := i, c
		g.Go(func() error {
			flag, err := s.processComment(gctx, req.Repo, req.PR, req.HeadSHA, c, hunkByHash)
			if err != nil {
				return err
			}
			commentFlags[i] = flag
			return nil
		})
	}

	if err := g.Wait(); err != nil {
		log.Printf("judge: estelle call failed: %v", err)
		http.Error(w, fmt.Sprintf("judge: %v", err), http.StatusBadGateway)
		return
	}

	flags := make([]Flag, 0, len(hunkFlags)+len(commentFlags))
	for _, f := range hunkFlags {
		if f != nil {
			flags = append(flags, *f)
		}
	}
	for _, f := range commentFlags {
		if f != nil {
			flags = append(flags, *f)
		}
	}

	conclusion := conclusionFor(flags)
	summary := buildSummary(flags)
	checkRunID, err := s.checkRuns.Post(ctx, req.Repo, req.HeadSHA, conclusion, summary)
	if err != nil {
		// The brief only requires ledger failures to be tolerated; a failed
		// check-run post is surfaced as an error since it's a primary
		// deliverable of /judge, not a best-effort side channel.
		log.Printf("judge: check-run post failed: %v", err)
		http.Error(w, fmt.Sprintf("judge: check-run post failed: %v", err), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(JudgeResponse{Flags: flags, CheckRunID: checkRunID})
}

// processHunk asks Estelle (or reuses a cached result), applies the
// strictness rule, persists the outcome to the ledger (flag or no-flag), and
// returns the Flag (nil if not flagged).
func (s *Server) processHunk(ctx context.Context, repo string, pr int, headSHA string, h Hunk) (*Flag, error) {
	key := fmt.Sprintf("%s:%s:%s", repo, headSHA, h.HunkHash)

	if cached, ok, err := s.cache.Get(ctx, key); err == nil && ok {
		return decodeCachedFlag(cached)
	}

	verdict, err := s.estelle.Ask(ctx, repo, h)
	if err != nil {
		return nil, fmt.Errorf("ask estelle for hunk %s: %w", h.HunkHash, err)
	}

	var result *Flag
	if shouldFlag(verdict, h) {
		flag := Flag{
			ID:        fallbackFlagID(repo, headSHA, h.HunkHash),
			Repo:      repo,
			PR:        pr,
			HeadSHA:   headSHA,
			File:      h.File,
			Line:      flagLine(h),
			Kind:      "contradiction",
			Verdict:   verdict.Verdict,
			Reason:    verdict.Reason,
			Citations: verdict.Citations,
			HunkHash:  h.HunkHash,
			Status:    "open",
		}
		s.persistVerdict(ctx, repo, pr, headSHA, h.HunkHash, verdict.Verdict, &flag, true)
		result = &flag
	} else {
		noFlag := Flag{Repo: repo, PR: pr, HeadSHA: headSHA, File: h.File, Kind: "contradiction", Verdict: verdict.Verdict, Reason: verdict.Reason, Citations: verdict.Citations, HunkHash: h.HunkHash}
		s.persistVerdict(ctx, repo, pr, headSHA, h.HunkHash, verdict.Verdict, &noFlag, false)
	}

	s.storeInCache(ctx, key, result)
	return result, nil
}

// processComment asks Estelle's /v1/stale for one comment and, if stale,
// returns a stale_comment Flag pinned at comment.Line. Comments whose
// hunk_hash doesn't match any hunk in the request are skipped (we have no
// hunk context to send Estelle).
func (s *Server) processComment(ctx context.Context, repo string, pr int, headSHA string, c Comment, hunkByHash map[string]Hunk) (*Flag, error) {
	hunk, ok := hunkByHash[c.HunkHash]
	if !ok {
		log.Printf("judge: comment at %s:%d references unknown hunk_hash %q; skipping stale check", c.File, c.Line, c.HunkHash)
		return nil, nil
	}

	key := fmt.Sprintf("%s:%s:stale:%s:%d", repo, headSHA, c.File, c.Line)
	if cached, ok, err := s.cache.Get(ctx, key); err == nil && ok {
		return decodeCachedFlag(cached)
	}

	resp, err := s.estelle.Stale(ctx, repo, c.File, c.Text, c.Line, hunk)
	if err != nil {
		return nil, fmt.Errorf("stale check for %s:%d: %w", c.File, c.Line, err)
	}

	verdictValue := "NO"
	if resp.Stale {
		verdictValue = "YES"
	}

	var result *Flag
	if resp.Stale {
		flag := Flag{
			ID:        fallbackFlagID(repo, headSHA, fmt.Sprintf("stale:%s:%d", c.File, c.Line)),
			Repo:      repo,
			PR:        pr,
			HeadSHA:   headSHA,
			File:      c.File,
			Line:      c.Line,
			Kind:      "stale_comment",
			Verdict:   verdictValue,
			Reason:    resp.Reason,
			Citations: resp.Citations,
			HunkHash:  c.HunkHash,
			Status:    "open",
		}
		s.persistVerdict(ctx, repo, pr, headSHA, c.HunkHash, verdictValue, &flag, true)
		result = &flag
	} else {
		noFlag := Flag{Repo: repo, PR: pr, HeadSHA: headSHA, File: c.File, Line: c.Line, Kind: "stale_comment", Verdict: verdictValue, Reason: resp.Reason, Citations: resp.Citations, HunkHash: c.HunkHash}
		s.persistVerdict(ctx, repo, pr, headSHA, c.HunkHash, verdictValue, &noFlag, false)
	}

	s.storeInCache(ctx, key, result)
	return result, nil
}

// persistVerdict posts one row to the ledger (flag or no-flag; decision_id
// is always null here, since the verdict service doesn't have a ledger
// decision id to reference). If the ledger accepts it and isFlag is true,
// the ledger-assigned row id overwrites the flag's fallback id
// (task-6-brief.md: "use that as the Flag id when available"). Ledger
// failures are logged and otherwise ignored — they must never fail /judge.
func (s *Server) persistVerdict(ctx context.Context, repo string, pr int, headSHA, hunkHash, verdictValue string, record *Flag, isFlag bool) {
	payload, err := json.Marshal(record)
	if err != nil {
		log.Printf("judge: marshal ledger payload: %v", err)
		return
	}

	rowID, ok := s.ledger.PostVerdict(ctx, ledgerVerdictRequest{
		Repo:       repo,
		PR:         pr,
		HeadSHA:    headSHA,
		HunkHash:   hunkHash,
		DecisionID: nil,
		Verdict:    verdictValue,
		Payload:    payload,
	})
	if ok && isFlag {
		record.ID = rowID
	}
}

func (s *Server) storeInCache(ctx context.Context, key string, flag *Flag) {
	if flag == nil {
		if err := s.cache.Set(ctx, key, noFlagSentinel); err != nil {
			log.Printf("judge: cache set failed for %s: %v", key, err)
		}
		return
	}
	b, err := json.Marshal(flag)
	if err != nil {
		log.Printf("judge: marshal flag for cache: %v", err)
		return
	}
	if err := s.cache.Set(ctx, key, string(b)); err != nil {
		log.Printf("judge: cache set failed for %s: %v", key, err)
	}
}

func decodeCachedFlag(cached string) (*Flag, error) {
	if cached == noFlagSentinel {
		return nil, nil
	}
	var flag Flag
	if err := json.Unmarshal([]byte(cached), &flag); err != nil {
		return nil, fmt.Errorf("decode cached flag: %w", err)
	}
	return &flag, nil
}
