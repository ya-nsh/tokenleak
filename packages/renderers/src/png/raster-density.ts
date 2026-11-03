/** sharp refuses to rasterise an image wider or taller than this many pixels. */
export const SHARP_MAX_DIMENSION = 32_767;
/** sharp's default input pixel limit (0x3FFF × 0x3FFF). */
export const SHARP_MAX_PIXELS = 268_402_689;
/** SVG user units are CSS pixels: 72 of them per inch at density 72. */
const SVG_UNITS_PER_INCH = 72;
/** The lowest density used, so a degenerate size can never yield zero. */
const MIN_DENSITY = 1;

const ROOT_SVG = /<svg\b[^>]*>/;
const WIDTH_ATTRIBUTE = /\swidth="([\d.]+)"/;
const HEIGHT_ATTRIBUTE = /\sheight="([\d.]+)"/;

/** The root `width`/`height` of an SVG, or null when either is missing. */
export function svgSize(svg: string): { width: number; height: number } | null {
  const root = ROOT_SVG.exec(svg)?.[0];
  if (!root) return null;
  const width = Number(WIDTH_ATTRIBUTE.exec(root)?.[1]);
  const height = Number(HEIGHT_ATTRIBUTE.exec(root)?.[1]);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null;
}

/**
 * The density to rasterise `svg` at: `preferred`, lowered just enough that the
 * output stays inside sharp's dimension and pixel-count limits. Cards grow
 * with their content (a multi-year heatmap, a long receipt), so a fixed
 * density eventually makes sharp reject the image outright.
 */
export function rasterDensity(svg: string, preferred: number): number {
  const size = svgSize(svg);
  if (!size) return preferred;
  const maxScale = Math.min(
    SHARP_MAX_DIMENSION / Math.max(size.width, size.height),
    Math.sqrt(SHARP_MAX_PIXELS / (size.width * size.height)),
  );
  const maxDensity = Math.floor(maxScale * SVG_UNITS_PER_INCH);
  return Math.max(MIN_DENSITY, Math.min(preferred, maxDensity));
}
