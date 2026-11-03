import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import { SHARP_MAX_DIMENSION, SHARP_MAX_PIXELS, rasterDensity, svgSize } from './raster-density';

const PREFERRED = 432;
const svg = (width: number, height: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#123"/></svg>`;
const scaled = (size: number, density: number) => Math.ceil((size * density) / 72);

describe('svgSize', () => {
  it('reads the root width and height', () => {
    expect(svgSize(svg(1200, 630))).toEqual({ width: 1200, height: 630 });
  });

  it('ignores sizes on nested elements and handles missing ones', () => {
    expect(svgSize('<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>')).toBeNull();
    expect(svgSize('<svg width="0" height="10"></svg>')).toBeNull();
    expect(svgSize('not svg')).toBeNull();
  });
});

describe('rasterDensity', () => {
  it('keeps the preferred density for ordinary cards', () => {
    expect(rasterDensity(svg(1200, 900), PREFERRED)).toBe(PREFERRED);
  });

  it('lowers the density for a card too wide for sharp', () => {
    const density = rasterDensity(svg(6_100, 900), PREFERRED);
    expect(density).toBeLessThan(PREFERRED);
    expect(scaled(6_100, density)).toBeLessThanOrEqual(SHARP_MAX_DIMENSION);
  });

  it('lowers the density for a card with too many pixels', () => {
    const density = rasterDensity(svg(5_000, 5_000), PREFERRED);
    expect(scaled(5_000, density) ** 2).toBeLessThanOrEqual(SHARP_MAX_PIXELS);
  });

  it('falls back to the preferred density when the size is unknown', () => {
    expect(rasterDensity('<svg viewBox="0 0 1 1"></svg>', PREFERRED)).toBe(PREFERRED);
  });

  it('never returns less than one', () => {
    expect(rasterDensity(svg(10_000_000, 10), PREFERRED)).toBe(1);
  });

  it('produces densities sharp accepts at the limit', async () => {
    const wide = svg(6_100, 900);
    const metadata = await sharp(Buffer.from(wide), { density: rasterDensity(wide, PREFERRED) }).png().toBuffer().then((buffer) => sharp(buffer).metadata());
    expect(metadata.width).toBeLessThanOrEqual(SHARP_MAX_DIMENSION);
  });
});
