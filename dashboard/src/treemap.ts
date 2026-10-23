import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";

/** One row of the `GET /fences/by-file` response. */
export interface FenceByFile {
  file: string;
  fence_count: number;
  loc: number;
}

/** A laid-out tile: the source data plus pixel rect and computed shading. */
export interface TreemapRect extends FenceByFile {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  fill: string;
  labelColor: string;
}

interface RootDatum {
  children: FenceByFile[];
}

/**
 * Pure layout function: data -> rectangles.
 *
 * Tile area is proportional to max(loc, 1) (a file with unknown/zero loc still
 * gets a visible sliver). Fill + label color come from `shadeScale`, driven by
 * `fence_count` relative to the max fence_count in the dataset.
 */
export function layoutTreemap(
  data: FenceByFile[],
  width: number,
  height: number,
): TreemapRect[] {
  if (data.length === 0) return [];

  const maxFenceCount = Math.max(0, ...data.map((d) => d.fence_count));

  const root = hierarchy<RootDatum | FenceByFile>({ children: data }, (d) =>
    "children" in d ? d.children : undefined,
  ).sum((d) => ("loc" in d ? Math.max(d.loc, 1) : 0));

  const laidOut = treemap<RootDatum | FenceByFile>()
    .tile(treemapSquarify)
    .round(true)
    .size([width, height])(root);

  return laidOut.leaves().map((leaf) => {
    const datum = leaf.data as FenceByFile;
    const { fill, labelColor } = shadeScale(datum.fence_count, maxFenceCount);
    return {
      file: datum.file,
      fence_count: datum.fence_count,
      loc: datum.loc,
      x0: leaf.x0,
      y0: leaf.y0,
      x1: leaf.x1,
      y1: leaf.y1,
      fill,
      labelColor,
    };
  });
}

const LIGHTEST_CHANNEL = 232; // near-white
const DARKEST_CHANNEL = 40; // near-black

/** sRGB relative luminance of a single channel value (0-255), per WCAG. */
function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function contrastRatio(lumA: number, lumB: number): number {
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Greyscale shade scale: fence_count -> fill color + a min-contrast label
 * color. Fill darkens linearly as fence_count approaches maxFenceCount (more
 * fences => darker tile). Label color is chosen (black or white) to maximize
 * contrast against the fill, guaranteeing WCAG-AA (>=4.5:1) readability on
 * every tile regardless of how light or dark it is.
 */
export function shadeScale(
  fenceCount: number,
  maxFenceCount: number,
): { fill: string; labelColor: string } {
  const t = maxFenceCount > 0 ? clamp01(fenceCount / maxFenceCount) : 0;
  const channel = Math.round(
    LIGHTEST_CHANNEL - t * (LIGHTEST_CHANNEL - DARKEST_CHANNEL),
  );
  const fill = `rgb(${channel}, ${channel}, ${channel})`;

  const fillLum = channelLuminance(channel);
  const contrastWithBlack = contrastRatio(fillLum, 0);
  const contrastWithWhite = contrastRatio(fillLum, 1);
  const labelColor = contrastWithBlack >= contrastWithWhite ? "#000000" : "#ffffff";

  return { fill, labelColor };
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
