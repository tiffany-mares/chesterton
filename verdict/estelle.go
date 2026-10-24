package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

// estelleClient wraps the Estelle API: POST /v1/ask and POST /v1/stale
// (docs/contracts.md "mocks — Estelle emulation"). The mock and the real
// service share this surface; any real-API divergence must be translated
// inside this file only (the rest of the service sees Verdict/staleResponse).
type estelleClient struct {
	baseURL string
	apiKey  string // optional; sent as Authorization: Bearer when set (real mode)
	http    *http.Client
}

func newEstelleClient(baseURL string, httpClient *http.Client) *estelleClient {
	return &estelleClient{baseURL: baseURL, http: httpClient}
}

func (c *estelleClient) Ask(ctx context.Context, repo string, hunk Hunk) (Verdict, error) {
	var v Verdict
	err := c.post(ctx, "/v1/ask", askRequest{Repo: repo, Hunk: hunk}, &v)
	return v, err
}

func (c *estelleClient) Stale(ctx context.Context, repo, file, comment string, commentLine int, hunk Hunk) (staleResponse, error) {
	var resp staleResponse
	err := c.post(ctx, "/v1/stale", staleRequest{
		Repo:        repo,
		File:        file,
		Comment:     comment,
		CommentLine: commentLine,
		Hunk:        hunk,
	}, &resp)
	// A backend without a stale endpoint (real Estelle may not have one)
	// degrades to "not stale" rather than failing the whole judge call.
	if errors.Is(err, errEstelleNotFound) {
		return staleResponse{}, nil
	}
	return resp, err
}

// errEstelleNotFound marks a 404 from the Estelle backend, so callers can
// distinguish "endpoint missing" from a genuine failure.
var errEstelleNotFound = errors.New("estelle: endpoint not found")

func (c *estelleClient) post(ctx context.Context, path string, body, out interface{}) error {
	buf, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("estelle: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(buf))
	if err != nil {
		return fmt.Errorf("estelle: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("estelle: request to %s failed: %w", path, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("estelle: %s: %w", path, errEstelleNotFound)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("estelle: %s returned status %d", path, resp.StatusCode)
	}

	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("estelle: decode response from %s: %w", path, err)
	}
	return nil
}
