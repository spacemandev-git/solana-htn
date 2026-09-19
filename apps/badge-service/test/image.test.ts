import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PNG } from 'pngjs';
import { HTNOS_IMAGE_MAX_BYTES, rgb565 } from '@htn/shared';
import { planBlits } from '../src/image.ts';
import { createHarness, isBinary, json, type Harness } from './harness.ts';

let h: Harness;
beforeEach(() => { h = createHarness(); });
afterEach(() => { h.close(); });

describe('image planning', () => {
  test('keeps a 4x2 image at its requested origin with big-endian RGB565 pixels', () => {
    const rgba = new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
      0, 0, 0, 255, 20, 241, 149, 255, 128, 64, 32, 255, 1, 2, 3, 255,
    ]);
    const plan = planBlits({ width: 4, height: 2, rgba }, { x: 10, y: 20, fit: 'none' });
    expect(plan.width).toBe(4);
    expect(plan.height).toBe(2);
    expect(plan.blits).toHaveLength(1);
    expect(plan.blits[0]).toMatchObject({ x: 10, y: 20, w: 4, h: 2 });
    const colors = [
      rgb565(255, 0, 0), rgb565(0, 255, 0), rgb565(0, 0, 255), rgb565(255, 255, 255),
      rgb565(0, 0, 0), rgb565(20, 241, 149), rgb565(128, 64, 32), rgb565(1, 2, 3),
    ];
    expect([...plan.blits[0]!.pixels]).toEqual(colors.flatMap((color) => [color >> 8, color & 0xff]));
  });

  test('scales full-size content into 30 eight-row blits and centers smaller content', () => {
    const large = planBlits(
      { width: 640, height: 480, rgba: new Uint8Array(640 * 480 * 4) },
      { x: 99, y: 99, fit: 'contain' },
    );
    expect({ width: large.width, height: large.height }).toEqual({ width: 320, height: 240 });
    expect(large.blits).toHaveLength(30);
    expect(large.blits[0]).toMatchObject({ x: 0, y: 0, w: 320, h: 8 });
    expect(large.blits[29]).toMatchObject({ x: 0, y: 232, w: 320, h: 8 });

    const small = planBlits(
      { width: 100, height: 100, rgba: new Uint8Array(100 * 100 * 4) },
      { x: 0, y: 0, fit: 'contain' },
    );
    expect(small.blits[0]).toMatchObject({ x: 110, y: 70, w: 100, h: 8 });
  });
});

describe('image endpoint', () => {
  test('sends raw PNG and JSON base64 uploads as exact binary blit frames', async () => {
    const badge = await h.connectBadge({ key: 'test-key' });
    const png = makePng();
    const raw = await h.request(`/v1/badges/${badge.badgeId}/image?x=10&y=20&fit=none`, {
      method: 'POST',
      headers: { 'content-type': 'image/png', 'x-badge-key': 'test-key' },
      body: png as unknown as BodyInit,
    });
    expect(await json<unknown>(raw)).toEqual({ ok: true, width: 2, height: 1 });
    const frame = await badge.next(isBinary);
    expect(isBinary(frame)).toBe(true);
    if (!isBinary(frame)) throw new Error('expected binary frame');
    const colorA = rgb565(255, 0, 0);
    const colorB = rgb565(0, 255, 0);
    expect([...frame]).toEqual([
      0x01, 8, ...new TextEncoder().encode('test-key'),
      0, 10, 0, 20, 0, 2, 0, 1,
      colorA >> 8, colorA & 0xff, colorB >> 8, colorB & 0xff,
    ]);

    const encoded = Buffer.from(png).toString('base64');
    const jsonResponse = await h.request(`/v1/badges/${badge.badgeId}/image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-badge-key': 'test-key' },
      body: JSON.stringify({ image: `data:image/png;base64,${encoded}`, x: 1, y: 2, fit: 'none' }),
    });
    expect(await json<unknown>(jsonResponse)).toEqual({ ok: true, width: 2, height: 1 });
    const jsonFrame = await badge.next(isBinary);
    if (!isBinary(jsonFrame)) throw new Error('expected binary frame');
    expect([...jsonFrame.slice(10, 18)]).toEqual([0, 1, 0, 2, 0, 2, 0, 1]);
  });

  test('rejects invalid and oversized images', async () => {
    const badge = await h.connectBadge({ key: 'test-key' });
    const invalid = await h.request(`/v1/badges/${badge.badgeId}/image`, {
      method: 'POST', headers: { 'content-type': 'image/png', 'x-badge-key': 'test-key' },
      body: new Uint8Array([1, 2, 3]) as unknown as BodyInit,
    });
    expect(invalid.status).toBe(400);
    expect(await json<unknown>(invalid)).toEqual({ error: 'image_invalid' });

    const oversized = await h.request(`/v1/badges/${badge.badgeId}/image`, {
      method: 'POST', headers: { 'content-type': 'image/png', 'x-badge-key': 'test-key' },
      body: new Uint8Array(HTNOS_IMAGE_MAX_BYTES + 1) as unknown as BodyInit,
    });
    expect(oversized.status).toBe(413);
    expect(await json<unknown>(oversized)).toEqual({ error: 'image_too_large' });
  });
});

function makePng(): Uint8Array {
  const png = new PNG({ width: 2, height: 1 });
  png.data.set([255, 0, 0, 255, 0, 255, 0, 255]);
  return new Uint8Array(PNG.sync.write(png));
}
