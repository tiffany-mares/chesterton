import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const JSON_HEADERS = { "Content-Type": "application/json" };

function okJson(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
}

beforeEach(() => {
  window.location.hash = "";
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/fences/by-file")) return Promise.resolve(okJson([{ file: "services/payments/client.py", fence_count: 6, loc: 120 }]));
      if (u.includes("/verdicts")) return Promise.resolve(okJson({ flags: [] }));
      if (u.includes("/overrides")) return Promise.resolve(okJson([]));
      if (u.includes("/stats")) return Promise.resolve(okJson({ verdicts_total: 14, flags_total: 2, overrides_total: 1, false_positive_rate: 0.5 }));
      return Promise.resolve(new Response("not found", { status: 404 }));
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("renders the header, tagline and all four tabs", async () => {
    render(<App />);
    expect(screen.getByText(/Mind the/)).toBeInTheDocument();
    for (const label of ["Fence Map", "Verdicts", "Overrides", "Stats"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("renders the fence map by default with fetched data", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText(/client\.py, 6 fences/)).toBeInTheDocument());
  });

  it("shows the offline banner with sample data when the gateway is down", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))));
    render(<App />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Gateway unreachable/));
    expect(screen.getByRole("alert")).toHaveTextContent(/sample data/i);
  });

  it("stats tab renders the four tiles from /stats", async () => {
    window.location.hash = "#stats";
    render(<App />);
    await waitFor(() => expect(screen.getByText(/False-positive rate/)).toBeInTheDocument());
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("50.0%")).toBeInTheDocument();
  });

  it("theme toggle cycles system -> light -> dark and stamps the html attribute", async () => {
    render(<App />);
    const btn = screen.getByRole("button", { name: /Theme/ });
    btn.click();
    await waitFor(() => expect(localStorage.getItem("chesterton.theme")).toBe("light"));
    expect(document.documentElement.dataset.theme).toBe("light");
    btn.click();
    await waitFor(() => expect(localStorage.getItem("chesterton.theme")).toBe("dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
