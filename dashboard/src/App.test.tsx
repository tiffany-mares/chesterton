import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App from "./App";

function jsonResponse(data: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(data),
  } as Response);
}

describe("App (smoke, fetch mocked)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/fences/by-file")) {
          return jsonResponse([{ file: "services/payments/client.py", fence_count: 2, loc: 40 }]);
        }
        if (url.includes("/verdicts")) {
          return jsonResponse({ flags: [] });
        }
        if (url.includes("/overrides")) {
          return jsonResponse([]);
        }
        if (url.includes("/stats")) {
          return jsonResponse({
            verdicts_total: 3,
            flags_total: 1,
            overrides_total: 0,
            false_positive_rate: 0,
          });
        }
        if (url.includes("/decisions")) {
          return jsonResponse([]);
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders all four tabs and the repo selector defaults to acme/storefront", async () => {
    render(<App />);
    expect(screen.getByRole("tab", { name: "Fence Map" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Verdicts" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overrides" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Stats" })).toBeInTheDocument();
    expect(screen.getByLabelText("repo")).toHaveValue("acme/storefront");
    // Let the initial fence-map fetch settle so no act() warning leaks past this test.
    await screen.findAllByTestId("fence-tile");
  });

  it("loads the fence map tab by default and renders a tile from the mocked gateway", async () => {
    render(<App />);
    const tiles = await screen.findAllByTestId("fence-tile");
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toHaveAttribute("data-file", "services/payments/client.py");
  });

  it("clicking a tile populates the side panel", async () => {
    render(<App />);
    const [tile] = await screen.findAllByTestId("fence-tile");
    fireEvent.click(tile);
    const panel = screen.getByTestId("side-panel");
    await within(panel).findByText("services/payments/client.py");
  });

  it("switches to the Verdicts tab and shows the empty-state message", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Verdicts" }));
    await screen.findByText(/No flags for acme\/storefront/);
  });

  it("switches to the Overrides tab and shows the empty-state message", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Overrides" }));
    await screen.findByText(/No overrides for acme\/storefront/);
  });

  it("switches to the Stats tab and renders big-number tiles from /stats", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Stats" }));
    const grid = await screen.findByTestId("stats-grid");
    expect(within(grid).getByText("3")).toBeInTheDocument();
    expect(within(grid).getByText("1")).toBeInTheDocument();
  });

  it("changing the repo selector refetches data for the new repo", async () => {
    render(<App />);
    await screen.findAllByTestId("fence-tile");
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();

    const input = screen.getByLabelText("repo") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "acme/other-repo" } });
    expect(input.value).toBe("acme/other-repo");

    // Let the refetch (triggered by the repo change) settle, and confirm it
    // targeted the new repo.
    await screen.findAllByTestId("fence-tile");
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((u) => u.includes("repo=acme%2Fother-repo"))).toBe(true);
  });
});
