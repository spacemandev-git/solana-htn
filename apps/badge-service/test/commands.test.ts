import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { HTNOS_RATE_LIMIT, rgb565 } from '@htn/shared';
import { createHarness, json, jsonFrame, type FakeBadge, type Harness } from './harness.ts';

let h: Harness;
beforeEach(() => { h = createHarness(); });
afterEach(() => { h.close(); });

function keyed(path: string, key: string, body?: unknown): Promise<Response> {
  return h.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-badge-key': key },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function ready(): Promise<FakeBadge> {
  const badge = await h.connectBadge({ key: 'test-key' });
  return badge;
}

describe('badge commands', () => {
  test('enforces badge, key, and online checks in order', async () => {
    const badge = await h.connectBadge();
    expect((await keyed(`/v1/badges/${badge.badgeId}/clear`, 'test-key', {})).status).toBe(403);
    expect(await json<unknown>(await keyed(`/v1/badges/${badge.badgeId}/clear`, 'test-key', {}))).toEqual({ error: 'key_not_set' });
    await badge.setKey('test-key');
    expect(await json<unknown>(await keyed(`/v1/badges/${badge.badgeId}/clear`, 'wrong-key', {}))).toEqual({ error: 'bad_key' });
    expect(await json<unknown>(await keyed('/v1/badges/zzzzz/clear', 'test-key', {}))).toEqual({ error: 'badge_not_found' });
    badge.close();
    await Bun.sleep(20);
    expect(await json<unknown>(await keyed(`/v1/badges/${badge.badgeId}/clear`, 'test-key', {}))).toEqual({ error: 'badge_offline' });
  });

  test('translates text, clear, rect, leds, and home exactly', async () => {
    const badge = await ready();
    expect((await keyed(`/v1/badges/${badge.badgeId}/text`, 'test-key', {
      text: 'HELLO', x: 8, y: 9, size: 3, color: '#14f195', background: '#000', clear: true,
    })).status).toBe(200);
    expect(jsonFrame(await badge.next((frame) => jsonFrame(frame).t === 'text'))).toEqual({
      t: 'text', k: 'test-key', x: 8, y: 9, s: 'HELLO',
      c: rgb565(0x14, 0xf1, 0x95), b: 0, z: 3, cl: 1,
    });

    await keyed(`/v1/badges/${badge.badgeId}/text`, 'test-key', { text: 'NO CLEAR' });
    const noClear = jsonFrame(await badge.next((frame) => jsonFrame(frame).t === 'text'));
    expect(noClear.cl).toBeUndefined();

    await keyed(`/v1/badges/${badge.badgeId}/clear`, 'test-key', { color: '#fff' });
    expect(jsonFrame(await badge.next((frame) => jsonFrame(frame).t === 'clear'))).toEqual({
      t: 'clear', k: 'test-key', c: 65_535,
    });

    await keyed(`/v1/badges/${badge.badgeId}/rect`, 'test-key', { x: 1, y: 2, w: 3, h: 4, color: '#00ff00' });
    expect(jsonFrame(await badge.next((frame) => jsonFrame(frame).t === 'rect'))).toEqual({
      t: 'rect', k: 'test-key', x: 1, y: 2, w: 3, h: 4, c: 2016,
    });

    await keyed(`/v1/badges/${badge.badgeId}/leds`, 'test-key', { all: '#ff0000' });
    expect(jsonFrame(await badge.next((frame) => jsonFrame(frame).t === 'leds'))).toEqual({
      t: 'leds', k: 'test-key', l: Array.from({ length: 6 }, () => [255, 0, 0]),
    });
    await keyed(`/v1/badges/${badge.badgeId}/leds`, 'test-key', {
      leds: [null, '#00f', null, null, null, null],
    });
    expect(jsonFrame(await badge.next((frame) => jsonFrame(frame).t === 'leds'))).toEqual({
      t: 'leds', k: 'test-key', l: [null, [0, 0, 255], null, null, null, null],
    });

    await keyed(`/v1/badges/${badge.badgeId}/home`, 'test-key', {});
    expect(jsonFrame(await badge.next((frame) => jsonFrame(frame).t === 'home'))).toEqual({ t: 'home', k: 'test-key' });
  });

  test('maps button, accel, nfc, and info replies', async () => {
    const badge = await ready();
    badge.autoReply('btn', { b: { a: 1, b: 0, home: 0, down: 1, left: 0, right: 1, up: 0, aux1: 1, start: 0 } });
    badge.autoReply('accel', { x: -12, y: 4, z: 1002 });
    badge.autoReply('nfc', { uid: null });
    badge.autoReply('info', { fw: '0.1.0', ip: '10.0.0.7', rssi: -51, heap: 143120, up: 812, mode: 'canvas' });

    expect(await json<unknown>(await keyed(`/v1/badges/${badge.badgeId}/buttons`, 'test-key'))).toEqual({
      buttons: { a: true, b: false, home: false, down: true, left: false, right: true, up: false, aux1: true, start: false },
    });
    expect(await json<unknown>(await keyed(`/v1/badges/${badge.badgeId}/accel`, 'test-key'))).toEqual({ x: -12, y: 4, z: 1002 });
    expect(await json<unknown>(await keyed(`/v1/badges/${badge.badgeId}/nfc`, 'test-key', {}))).toEqual({ uid: null });
    expect(await json<unknown>(await keyed(`/v1/badges/${badge.badgeId}/info`, 'test-key'))).toEqual({
      fw: '0.1.0', ip: '10.0.0.7', rssi: -51, heap: 143120, uptimeSeconds: 812, mode: 'canvas',
    });
  });

  test('times out unanswered requests', async () => {
    const local = createHarness({ replyTimeoutMs: 200 });
    try {
      const badge = await local.connectBadge({ key: 'test-key' });
      const response = await local.request(`/v1/badges/${badge.badgeId}/accel`, { headers: { 'x-badge-key': 'test-key' } });
      expect(response.status).toBe(504);
      expect(await json<unknown>(response)).toEqual({ error: 'badge_timeout' });
    } finally {
      local.close();
    }
  });

  test('rejects the burst plus one command', async () => {
    const badge = await ready();
    const responses = await Promise.all(Array.from({ length: HTNOS_RATE_LIMIT.burst + 1 }, () =>
      keyed(`/v1/badges/${badge.badgeId}/text`, 'test-key', { text: 'x' })));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(HTNOS_RATE_LIMIT.burst);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
  });
});
