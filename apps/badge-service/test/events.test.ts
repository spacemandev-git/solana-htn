import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeEach(() => { h = createHarness(); });
afterEach(() => { h.close(); });

describe('badge events', () => {
  test('streams button, mode, and offline events over SSE', async () => {
    const badge = await h.connectBadge({ key: 'test-key' });
    const abort = new AbortController();
    const response = await h.request(`/v1/badges/${badge.badgeId}/events?key=test-key`, { signal: abort.signal });
    expect(response.status).toBe(200);
    const events = new SseReader(response);

    badge.send({ t: 'btn', n: 'a', p: 1 });
    expect(await events.next('button')).toMatchObject({ event: 'button', badgeId: badge.badgeId, button: 'a', pressed: true });
    badge.setMode('canvas');
    expect(await events.next('mode')).toMatchObject({ event: 'mode', badgeId: badge.badgeId, mode: 'canvas' });
    badge.close();
    expect(await events.next('offline')).toMatchObject({ event: 'offline', badgeId: badge.badgeId });
    abort.abort();
  });

  test('app websocket runs commands, receives events, and reports invalid commands', async () => {
    const badge = await h.connectBadge({ key: 'test-key' });
    badge.autoReply('accel', { x: 1, y: 2, z: 3 });
    const app = await AppClient.connect(`${h.base.replace('http:', 'ws:')}/v1/badges/${badge.badgeId}/ws?key=test-key`);

    app.send({ cmd: 'accel', id: 'a1' });
    expect(await app.next((message) => message.type === 'reply')).toEqual({
      type: 'reply', id: 'a1', data: { x: 1, y: 2, z: 3 },
    });
    badge.send({ t: 'btn', n: 'b', p: 1 });
    expect(await app.next((message) => message.type === 'event')).toMatchObject({
      type: 'event', data: { event: 'button', badgeId: badge.badgeId, button: 'b', pressed: true },
    });
    app.send({ cmd: 'nope' });
    expect(await app.next((message) => message.type === 'error')).toMatchObject({
      type: 'error', id: null, error: 'invalid_request',
    });
    app.close();
  });

  test('closes app sockets with protocol auth codes', async () => {
    const badge = await h.connectBadge({ key: 'test-key' });
    const bad = await closeCode(`${h.base.replace('http:', 'ws:')}/v1/badges/${badge.badgeId}/ws?key=wrong-key`);
    expect(bad).toBe(4403);
    const missing = await closeCode(`${h.base.replace('http:', 'ws:')}/v1/badges/zzzzz/ws?key=test-key`);
    expect(missing).toBe(4404);
  });
});

class SseReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = '';

  constructor(response: Response) {
    if (!response.body) throw new Error('SSE response has no body');
    this.reader = response.body.getReader();
  }

  async next(name: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 2000;
    for (;;) {
      let boundary: number;
      while ((boundary = this.buffer.indexOf('\n\n')) >= 0) {
        const block = this.buffer.slice(0, boundary);
        this.buffer = this.buffer.slice(boundary + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (event === name && data !== undefined) return JSON.parse(data) as Record<string, unknown>;
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for SSE event ${name}`);
      const result = await this.reader.read();
      if (result.done) throw new Error('SSE stream ended');
      this.buffer += this.decoder.decode(result.value, { stream: true }).replaceAll('\r\n', '\n');
    }
  }
}

class AppClient {
  private readonly messages: Record<string, unknown>[] = [];
  private readonly waiters: { predicate: (value: Record<string, unknown>) => boolean; resolve(value: Record<string, unknown>): void }[] = [];

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      const value = JSON.parse(String(event.data)) as Record<string, unknown>;
      const waiterIndex = this.waiters.findIndex((waiter) => waiter.predicate(value));
      if (waiterIndex >= 0) {
        const waiter = this.waiters.splice(waiterIndex, 1)[0];
        waiter?.resolve(value);
      } else {
        this.messages.push(value);
      }
    });
  }

  static async connect(url: string): Promise<AppClient> {
    const ws = new WebSocket(url);
    const client = new AppClient(ws);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('app websocket failed')), { once: true });
    });
    return client;
  }

  send(value: object): void { this.ws.send(JSON.stringify(value)); }

  next(predicate: (value: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
    const index = this.messages.findIndex(predicate);
    if (index >= 0) {
      const value = this.messages.splice(index, 1)[0];
      if (value) return Promise.resolve(value);
    }
    return Promise.race([
      new Promise<Record<string, unknown>>((resolve) => this.waiters.push({ predicate, resolve })),
      Bun.sleep(2000).then(() => { throw new Error('timed out waiting for app websocket message'); }),
    ]);
  }

  close(): void { this.ws.close(); }
}

function closeCode(url: string): Promise<number> {
  const ws = new WebSocket(url);
  return new Promise((resolve, reject) => {
    ws.addEventListener('close', (event) => resolve(event.code), { once: true });
    ws.addEventListener('error', () => reject(new Error('websocket failed before close')), { once: true });
  });
}
