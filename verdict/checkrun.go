package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// checkRunClient wraps POST {GITHUB_API_URL}/repos/{owner}/{repo}/check-runs
// (docs/contracts.md "mocks — GitHub API emulation").
type checkRunClient struct {
	baseURL string
	http    *http.Client
}

func newCheckRunClient(baseURL string, httpClient *http.Client) *checkRunClient {
	return &checkRunClient{baseURL: baseURL, http: httpClient}
}

// Post creates a check run named "Chesterton" with the given conclusion and
// markdown summary. When installationToken is non-empty, the request carries
// `Authorization: Bearer <installationToken>` (docs/contracts.md "mocks —
// GitHub API emulation": "Real mode: gateway/verdict send `Authorization:
// Bearer $GITHUB_TOKEN`"); when empty (mock mode), no Authorization header is
// sent. Returns the created row's id.
func (c *checkRunClient) Post(ctx context.Context, repo, headSHA, conclusion, summary, installationToken string) (int64, error) {
	body := checkRunRequest{
		Name:       "Chesterton",
		HeadSHA:    headSHA,
		Status:     "completed",
		Conclusion: conclusion,
		Output: checkRunOutput{
			Title:   "Chesterton verdict",
			Summary: summary,
		},
	}

	buf, err := json.Marshal(body)
	if err != nil {
		return 0, fmt.Errorf("checkrun: marshal request: %w", err)
	}

	url := fmt.Sprintf("%s/repos/%s/check-runs", c.baseURL, repo)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(buf))
	if err != nil {
		return 0, fmt.Errorf("checkrun: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if installationToken != "" {
		req.Header.Set("Authorization", "Bearer "+installationToken)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return 0, fmt.Errorf("checkrun: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, fmt.Errorf("checkrun: POST check-runs returned status %d", resp.StatusCode)
	}

	var row checkRunRow
	if err := json.NewDecoder(resp.Body).Decode(&row); err != nil {
		return 0, fmt.Errorf("checkrun: decode response: %w", err)
	}
	return row.ID, nil
}
