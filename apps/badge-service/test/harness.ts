import type { Server } from 'bun';
import { HTNOS_PROTOCOL_VERSION } from '@htn/shared';
import { loadConfig } from '../src/config.ts';
import { openDatabase } from '../src/db.ts';
import { createServer, type ServiceContext, type WsData } from '../src/server.ts';

type BadgeFrame = object | Uint8Array;

interface Waiter {
  predicate: (frame: BadgeFrame) => boolean;
  resolve: (frame: BadgeFrame) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  consume: boolean;
}

export interface Harness {
  server: Server<WsData>;
  ctx: ServiceContext;
  base: string;
  request(path: string, init?: RequestInit): Promise<Response>;
  post(path: string, body: unknown): Promise<Response>;
  connectBadge(opts?: { mac?: string; id?: string; tok?: string; key?: string; fw?: string }): Promise<FakeBadge>;
  close(): void;
}

export class FakeBadge {
  badgeId: string;
  token: string;
  readonly frames: BadgeFrame[] = [];
  closeCode: number | null = null;
  private cursor = 0;
  private readonly waiters = new Set<Waiter>();
  private readonly replies = new Map<'btn' | 'accel' | 'nfc' | 'info', object>();

  constructor(
    private readonly ws: WebSocket,
    initial: { id?: string; tok?: string },
  ) {
    this.badgeId = initial.id ?? '';
    this.token = initial.tok ?? '';
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('message', (event) => this.receive(event.data));
    ws.addEventListener('close', (event) => {
      this.closeCode = event.code;
      for (const waiter of this.waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(`badge websocket closed (${event.code})`));
      }
      this.waiters.clear();
    });
  }

  send(obj: object): void {
    this.ws.send(JSON.stringify(obj));
  }

  sendBinary(bytes: Uint8Array): void {
    this.ws.send(bytes);
  }

  next(predicate: (frame: BadgeFrame) => boolean, timeoutMs = 2000): Promise<BadgeFrame> {
    for (let index = this.cursor; index < this.frames.length; index++) {
      const frame = this.frames[index];
      if (frame !== undefined && predicate(frame)) {
        this.cursor = index + 1;
        return Promise.resolve(frame);
      }
    }
    return this.wait(predicate, timeoutMs, true);
  }

  observe(predicate: (frame: BadgeFrame) => boolean, timeoutMs = 2000): Promise<BadgeFrame> {
    for (const frame of this.frames) if (predicate(frame)) return Promise.resolve(frame);
    return this.wait(predicate, timeoutMs, false);
  }

  autoReply(kind: 'btn' | 'accel' | 'nfc' | 'info', reply: object): void {
    this.replies.set(kind, reply);
  }

  async setKey(key: string): Promise<void> {
    this.send({ t: 'key', k: key });
    await Bun.sleep(10);
  }

  setMode(mode: 'canvas' | 'menu'): void {
    this.send({ t: 'mode', m: mode });
  }

  close(): void {
    this.ws.close();
  }

  private wait(
    predicate: (frame: BadgeFrame) => boolean,
    timeoutMs: number,
    consume: boolean,
  ): Promise<BadgeFrame> {
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        predicate,
        resolve,
        reject,
        consume,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error('timed out waiting for badge frame'));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  private receive(data: unknown): void {
    let frame: BadgeFrame;
    if (typeof data === 'string') {
      frame = JSON.parse(data) as object;
    } else if (data instanceof ArrayBuffer) {
      frame = new Uint8Array(data);
    } else if (data instanceof Blob) {
      void data.arrayBuffer().then((buffer) => this.receive(buffer));
      return;
    } else {
      return;
    }
    this.frames.push(frame);
    if (!isBinary(frame)) {
      const record = frame as Record<string, unknown>;
      if (record.t === 'welcome') {
        if (typeof record.id === 'string') this.badgeId = record.id;
        if (typeof record.tok === 'string') this.token = record.tok;
      }
      const kind = record.t;
      if ((kind === 'btn' || kind === 'accel' || kind === 'nfc' || kind === 'info') && typeof record.i === 'number') {
        const reply = this.replies.get(kind);
        if (reply) this.send({ t: 'r', i: record.i, ...reply });
      }
    }
    for (const waiter of [...this.waiters]) {
      if (!waiter.predicate(frame)) continue;
      clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      if (waiter.consume) this.cursor = this.frames.length;
      waiter.resolve(frame);
    }
  }
}

export function createHarness(
  opts: { replyTimeoutMs?: number; adminToken?: string } = {},
): Harness {
  const db = openDatabase(':memory:');
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT: '0',
    DATABASE_PATH: ':memory:',
    CORS_ORIGINS: 'http://localhost:5173',
    PUBLIC_URL: 'http://localhost:3100',
    ADMIN_TOKEN: opts.adminToken,
  });
  const { server, ctx } = createServer({ db, config, port: 0, replyTimeoutMs: opts.replyTimeoutMs });
  const base = `http://localhost:${server.port}`;
  const badges = new Set<FakeBadge>();
  const request = (path: string, init?: RequestInit): Promise<Response> => fetch(`${base}${path}`, init);

  return {
    server,
    ctx,
    base,
    request,
    post: (path, body) => request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    async connectBadge(options = {}) {
      const ws = new WebSocket(`${base.replace('http:', 'ws:')}/v1/device/ws`);
      const badge = new FakeBadge(ws, { id: options.id, tok: options.tok });
      badges.add(badge);
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => resolve(), { once: true });
        ws.addEventListener('error', () => reject(new Error('badge websocket failed to open')), { once: true });
      });
      badge.send({
        t: 'hello',
        v: HTNOS_PROTOCOL_VERSION,
        mac: options.mac ?? 'aabbccddeeff',
        fw: options.fw ?? '0.1.0',
        ...(options.id !== undefined ? { id: options.id } : {}),
        ...(options.tok !== undefined ? { tok: options.tok } : {}),
        ...(options.key !== undefined ? { key: options.key } : {}),
      });
      await badge.observe((frame) => !isBinary(frame) && ['welcome', 'err'].includes(String((frame as Record<string, unknown>).t)));
      return badge;
    },
    close() {
      for (const badge of badges) badge.close();
      server.stop(true);
      db.close();
    },
  };
}

export function isBinary(frame: BadgeFrame): frame is Uint8Array {
  return frame instanceof Uint8Array;
}

export function jsonFrame(frame: BadgeFrame): Record<string, unknown> {
  if (isBinary(frame)) throw new Error('expected a JSON frame');
  return frame as Record<string, unknown>;
}

export async function json<T>(response: Response): Promise<T> {
  return await response.json() as T;
}
