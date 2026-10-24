export interface Rect { x: number; y: number; w: number; h: number }
export interface Placed<T> extends Rect { item: T }

/** Squarified treemap (Bruls et al.). Values must be > 0. */
export function squarify<T>(items: { item: T; value: number }[], box: Rect): Placed<T>[] {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total || box.w <= 0 || box.h <= 0) return [];
  const scale = (box.w * box.h) / total;
  const nodes = [...items].sort((a, b) => b.value - a.value).map((i) => ({ item: i.item, area: i.value * scale }));
  const out: Placed<T>[] = [];
  let rect = { ...box };
  let row: typeof nodes = [];

  const worst = (r: typeof nodes, side: number) => {
    const s = r.reduce((a, n) => a + n.area, 0);
    const max = Math.max(...r.map((n) => n.area));
    const min = Math.min(...r.map((n) => n.area));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  const layout = (r: typeof nodes) => {
    const s = r.reduce((a, n) => a + n.area, 0);
    if (rect.w >= rect.h) {
      const w = s / rect.h; let y = rect.y;
      for (const n of r) { const h = n.area / w; out.push({ item: n.item, x: rect.x, y, w, h }); y += h; }
      rect = { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h };
    } else {
      const h = s / rect.w; let x = rect.x;
      for (const n of r) { const w = n.area / h; out.push({ item: n.item, x, y: rect.y, w, h }); x += w; }
      rect = { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h };
    }
  };

  for (const n of nodes) {
    const side = Math.min(rect.w, rect.h);
    if (row.length === 0 || worst([...row, n], side) <= worst(row, side)) row.push(n);
    else { layout(row); row = [n]; }
  }
  if (row.length) layout(row);
  return out;
}

export const RAMP_STEPS = 7;
export function rampStep(count: number, max: number) {
  if (max <= 0) return 0;
  return Math.min(RAMP_STEPS - 1, Math.round((count / max) * (RAMP_STEPS - 1)));
}

function lum(hex: string) {
  const v = hex.replace("#", "").match(/.{2}/g)!.map((c) => {
    const s = parseInt(c, 16) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
}
export function contrast(a: string, b: string) {
  const l1 = Math.max(lum(a), lum(b)), l2 = Math.min(lum(a), lum(b));
  return (l1 + 0.05) / (l2 + 0.05);
}
/** Pick whichever of near-black / white reads best (≥4.5:1 for every ramp step). */
export function labelColor(fill: string) {
  return contrast(fill, "#0b0b0b") >= contrast(fill, "#ffffff") ? "#0b0b0b" : "#ffffff";
}

export function middleTruncate(s: string, maxChars: number) {
  if (s.length <= maxChars) return s;
  if (maxChars < 5) return "";
  const keep = maxChars - 1;
  return s.slice(0, Math.ceil(keep / 2)) + "…" + s.slice(s.length - Math.floor(keep / 2));
}
