import { describe, expect, it } from "vitest";
import { contrast, labelColor, middleTruncate, RAMP_STEPS, rampStep, squarify } from "./treemap";

const BOX = { x: 0, y: 0, w: 800, h: 560 };

describe("squarify", () => {
  const items = [
    { item: "a", value: 400 },
    { item: "b", value: 300 },
    { item: "c", value: 200 },
    { item: "d", value: 100 },
  ];

  it("lays out every item exactly once", () => {
    const tiles = squarify(items, BOX);
    expect(tiles.map((t) => t.item).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("tile areas are proportional to values and fill the box", () => {
    const tiles = squarify(items, BOX);
    const total = items.reduce((s, i) => s + i.value, 0);
    const boxArea = BOX.w * BOX.h;
    for (const t of tiles) {
      const value = items.find((i) => i.item === t.item)!.value;
      expect(t.w * t.h).toBeCloseTo((value / total) * boxArea, 5);
    }
    const sum = tiles.reduce((s, t) => s + t.w * t.h, 0);
    expect(sum).toBeCloseTo(boxArea, 5);
  });

  it("keeps every tile inside the box", () => {
    for (const t of squarify(items, BOX)) {
      expect(t.x).toBeGreaterThanOrEqual(BOX.x - 1e-6);
      expect(t.y).toBeGreaterThanOrEqual(BOX.y - 1e-6);
      expect(t.x + t.w).toBeLessThanOrEqual(BOX.x + BOX.w + 1e-6);
      expect(t.y + t.h).toBeLessThanOrEqual(BOX.y + BOX.h + 1e-6);
    }
  });

  it("returns [] for empty input or a degenerate box", () => {
    expect(squarify([], BOX)).toEqual([]);
    expect(squarify(items, { x: 0, y: 0, w: 0, h: 100 })).toEqual([]);
  });
});

describe("rampStep", () => {
  it("maps zero and max onto the ramp ends", () => {
    expect(rampStep(0, 10)).toBe(0);
    expect(rampStep(10, 10)).toBe(RAMP_STEPS - 1);
  });
  it("stays within bounds and handles max=0", () => {
    expect(rampStep(5, 0)).toBe(0);
    for (let c = 0; c <= 10; c++) {
      const s = rampStep(c, 10);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(RAMP_STEPS);
    }
  });
});

describe("labelColor", () => {
  it("chooses a readable ink for light and dark fills", () => {
    expect(labelColor("#dcf0ea")).toBe("#0b0b0b");
    expect(labelColor("#0d4b42")).toBe("#ffffff");
  });
  it("every light-mode ramp step clears 4.5:1 with its chosen ink", () => {
    const ramp = ["#dcf0ea", "#bfe1d8", "#99cec3", "#6db8ab", "#2b8377", "#1a6b61", "#0d4b42"];
    for (const fill of ramp) {
      expect(contrast(fill, labelColor(fill))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("middleTruncate", () => {
  it("leaves short strings alone", () => {
    expect(middleTruncate("short.py", 20)).toBe("short.py");
  });
  it("truncates in the middle, preserving both ends", () => {
    const out = middleTruncate("services/payments/client.py", 15);
    expect(out.length).toBeLessThanOrEqual(15);
    expect(out).toContain("…");
    expect(out.startsWith("service")).toBe(true);
    expect(out.endsWith(".py")).toBe(true);
  });
});
