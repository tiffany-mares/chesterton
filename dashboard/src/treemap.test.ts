import { describe, expect, it } from "vitest";
import { layoutTreemap, shadeScale, type FenceByFile } from "./treemap";

describe("layoutTreemap", () => {
  it("returns one rectangle filling the whole container for a single file", () => {
    const data: FenceByFile[] = [{ file: "a.py", fence_count: 3, loc: 100 }];
    const rects = layoutTreemap(data, 200, 100);
    expect(rects).toHaveLength(1);
    const [r] = rects;
    expect(r.file).toBe("a.py");
    expect(r.x0).toBe(0);
    expect(r.y0).toBe(0);
    expect(r.x1).toBe(200);
    expect(r.y1).toBe(100);
  });

  it("splits area proportionally to max(loc, 1)", () => {
    // Equal loc -> equal area.
    const data: FenceByFile[] = [
      { file: "a.py", fence_count: 1, loc: 50 },
      { file: "b.py", fence_count: 1, loc: 50 },
    ];
    const rects = layoutTreemap(data, 200, 100);
    expect(rects).toHaveLength(2);
    const totalArea = 200 * 100;
    for (const r of rects) {
      const area = (r.x1 - r.x0) * (r.y1 - r.y0);
      expect(area).toBeCloseTo(totalArea / 2, 0);
    }
  });

  it("treats loc=0 as max(loc,1)=1, giving it nonzero area", () => {
    const data: FenceByFile[] = [
      { file: "zero.py", fence_count: 0, loc: 0 },
      { file: "big.py", fence_count: 0, loc: 3 },
    ];
    const rects = layoutTreemap(data, 400, 100);
    const total = 400 * 100;
    const zero = rects.find((r) => r.file === "zero.py")!;
    const big = rects.find((r) => r.file === "big.py")!;
    const zeroArea = (zero.x1 - zero.x0) * (zero.y1 - zero.y0);
    const bigArea = (big.x1 - big.x0) * (big.y1 - big.y0);
    // zero.py gets weight 1, big.py gets weight 3 -> ratio 1:3 of total area
    expect(zeroArea).toBeCloseTo(total * (1 / 4), 0);
    expect(bigArea).toBeCloseTo(total * (3 / 4), 0);
  });

  it("returns an empty array for empty data", () => {
    expect(layoutTreemap([], 200, 100)).toEqual([]);
  });

  it("every rectangle carries a fill and labelColor from the shade scale", () => {
    const data: FenceByFile[] = [
      { file: "a.py", fence_count: 0, loc: 10 },
      { file: "b.py", fence_count: 10, loc: 10 },
    ];
    const rects = layoutTreemap(data, 200, 100);
    for (const r of rects) {
      expect(r.fill).toMatch(/^rgb\(/);
      expect(["#000000", "#ffffff"]).toContain(r.labelColor);
    }
    // Highest fence_count tile should be darker (lower channel value) than lowest.
    const low = rects.find((r) => r.file === "a.py")!;
    const high = rects.find((r) => r.file === "b.py")!;
    const channel = (rgb: string) => Number(rgb.match(/\d+/)![0]);
    expect(channel(high.fill)).toBeLessThan(channel(low.fill));
  });
});

describe("shadeScale", () => {
  it("returns the lightest fill at fence_count=0", () => {
    const { fill } = shadeScale(0, 10);
    const channel = Number(fill.match(/\d+/)![0]);
    expect(channel).toBeGreaterThan(200);
  });

  it("returns the darkest fill at the max fence_count", () => {
    const { fill } = shadeScale(10, 10);
    const channel = Number(fill.match(/\d+/)![0]);
    expect(channel).toBeLessThan(60);
  });

  it("handles maxFenceCount=0 without dividing by zero", () => {
    const { fill, labelColor } = shadeScale(0, 0);
    expect(fill).toMatch(/^rgb\(/);
    expect(["#000000", "#ffffff"]).toContain(labelColor);
  });

  it("picks a label color with WCAG-AA contrast (>=4.5:1) against the fill", () => {
    for (const fc of [0, 2, 4, 6, 8, 10]) {
      const { fill, labelColor } = shadeScale(fc, 10);
      const v = Number(fill.match(/\d+/)![0]) / 255;
      const toLinear = (c: number) =>
        c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      const fillLum = toLinear(v); // R=G=B so luminance == linearized channel
      const textLum = labelColor === "#ffffff" ? 1 : 0;
      const lighter = Math.max(fillLum, textLum);
      const darker = Math.min(fillLum, textLum);
      const contrast = (lighter + 0.05) / (darker + 0.05);
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("is monotonic: higher fence_count never produces a lighter fill", () => {
    const values = [0, 1, 2, 5, 8, 10].map((fc) => {
      const { fill } = shadeScale(fc, 10);
      return Number(fill.match(/\d+/)![0]);
    });
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
    }
  });
});
