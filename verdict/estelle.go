package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// estelleClient wraps the mocks' Estelle emulation: POST /v1/ask and
// POST /v1/stale (docs/contracts.md "mocks — Estelle emulation").
type estelleClient struct {
	baseURL string
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
	return resp, err
}

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

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("estelle: request to %s failed: %w", path, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("estelle: %s returned status %d", path, resp.StatusCode)
	}

	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("estelle: decode response from %s: %w", path, err)
	}
	return nil
}
