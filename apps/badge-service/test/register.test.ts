import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { HTNOS_ID_PATTERN } from '@htn/shared';
import { createHarness, json, jsonFrame, type Harness } from './harness.ts';

let h: Harness;

beforeEach(() => { h = createHarness(); });
afterEach(() => { h.close(); });

describe('badge registration', () => {
  test('registers, reconnects, rotates a bad token, and reports status', async () => {
    const first = await h.connectBadge({ key: 'test-key', fw: '0.2.0' });
    expect(first.badgeId).toMatch(HTNOS_ID_PATTERN);
    expect(first.badgeId).toHaveLength(5);
    expect(first.token.length).toBeGreaterThan(20);

    const status = await json<Record<string, unknown>>(await h.request(`/v1/badges/${first.badgeId}`));
    expect(status).toMatchObject({
      badgeId: first.badgeId, online: true, hasKey: true, mode: 'menu', fw: '0.2.0',
    });

    first.close();
    await waitUntil(async () => {
      const current = await json<Record<string, unknown>>(await h.request(`/v1/badges/${first.badgeId}`));
      return current.online === false;
    });

    const reconnect = await h.connectBadge({ id: first.badgeId, tok: first.token, key: 'test-key' });
    const reconnectWelcome = jsonFrame(await reconnect.next((frame) => jsonFrame(frame).t === 'welcome'));
    expect(reconnectWelcome).toEqual({ t: 'welcome', id: first.badgeId });
    reconnect.close();
    await Bun.sleep(10);

    const wrong = await h.connectBadge({ id: first.badgeId, tok: 'wrong-token', mac: 'aabbccddeeff' });
    expect(wrong.frames.map(jsonFrame)).toContainEqual({ t: 'err', c: 'bad_token' });
    wrong.send({ t: 'hello', v: 1, mac: 'aabbccddeeff', fw: '0.3.0' });
    const fresh = jsonFrame(await wrong.next((frame) => jsonFrame(frame).t === 'welcome'));
    expect(fresh.id).toBe(first.badgeId);
    expect(fresh.tok).not.toBe(first.token);
  });

  test('a new socket replaces the old live socket', async () => {
    const first = await h.connectBadge({ key: 'test-key' });
    const second = await h.connectBadge({ id: first.badgeId, tok: first.token });
    expect(jsonFrame(await first.next((frame) => jsonFrame(frame).c === 'replaced'))).toEqual({ t: 'err', c: 'replaced' });
    await waitUntil(() => Promise.resolve(first.closeCode === 4409));
    const status = await json<Record<string, unknown>>(await h.request(`/v1/badges/${second.badgeId}`));
    expect(status.online).toBe(true);
  });

  test('rejects a non-hello first frame with close code 4400', async () => {
    const ws = new WebSocket(`${h.base.replace('http:', 'ws:')}/v1/device/ws`);
    const result = await new Promise<{ message: unknown; code: number }>((resolve, reject) => {
      let message: unknown;
      ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'key', k: 'test-key' })));
      ws.addEventListener('message', (event) => { message = JSON.parse(String(event.data)); });
      ws.addEventListener('close', (event) => resolve({ message, code: event.code }));
      ws.addEventListener('error', () => reject(new Error('websocket error')));
    });
    expect(result.message).toEqual({ t: 'err', c: 'bad_hello' });
    expect(result.code).toBe(4400);
  });
});

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition did not become true');
    await Bun.sleep(5);
  }
}
