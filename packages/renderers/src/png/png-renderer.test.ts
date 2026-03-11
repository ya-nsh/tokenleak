import { describe, expect, it } from 'bun:test';
import { PngRenderer } from './png-renderer';
import {
  createOutput,
  createRenderOptions,
} from '../__test-fixtures__';

/** PNG magic bytes: 0x89 P N G */
const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4e, 0x47];

describe('PngRenderer', () => {
  const renderer = new PngRenderer();

  it('has format set to png', () => {
    expect(renderer.format).toBe('png');
  });

  it('output starts with PNG magic bytes', async () => {
    const result = await renderer.render(createOutput(), createRenderOptions({ format: 'png' }));
    const buffer = Buffer.from(result);

    expect(buffer[0]).toBe(PNG_MAGIC_BYTES[0]);
    expect(buffer[1]).toBe(PNG_MAGIC_BYTES[1]);
    expect(buffer[2]).toBe(PNG_MAGIC_BYTES[2]);
    expect(buffer[3]).toBe(PNG_MAGIC_BYTES[3]);
  });

  it('output buffer has non-zero length', async () => {
    const result = await renderer.render(createOutput(), createRenderOptions({ format: 'png' }));
    expect(result.length).toBeGreaterThan(0);
  });

  it('dark vs light theme produces different buffers', async () => {
    const output = createOutput();
    const darkBuffer = await renderer.render(output, createRenderOptions({ format: 'png', theme: 'dark' }));
    const lightBuffer = await renderer.render(output, createRenderOptions({ format: 'png', theme: 'light' }));

    // Both should be valid PNGs
    expect(darkBuffer[0]).toBe(PNG_MAGIC_BYTES[0]);
    expect(lightBuffer[0]).toBe(PNG_MAGIC_BYTES[0]);

    // They should differ (different background colors at minimum)
    const darkHex = Buffer.from(darkBuffer).toString('hex');
    const lightHex = Buffer.from(lightBuffer).toString('hex');
    expect(darkHex).not.toBe(lightHex);
  });

  it('returns a Buffer instance', async () => {
    const result = await renderer.render(createOutput(), createRenderOptions({ format: 'png' }));
    expect(Buffer.isBuffer(result)).toBe(true);
  });
});
