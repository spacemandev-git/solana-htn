import type { ServerWebSocket } from 'bun';
import { HttpError } from './http.ts';
import type { EventHub } from './hub.ts';
import type { WsData } from './server.ts';

interface PendingReply {
  resolve: (reply: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface LiveDevice {
  ws: ServerWebSocket<WsData>;
  mode: 'canvas' | 'menu';
  pending: Map<number, PendingReply>;
}

export class BadgeRegistry {
  private readonly live = new Map<string, LiveDevice>();
  private nextReplyId = 1;

  constructor(
    private readonly hub: EventHub,
    private readonly replyTimeoutMs: number,
  ) {}

  get(badgeId: string): LiveDevice | null {
    return this.live.get(badgeId) ?? null;
  }

  count(): number {
    return this.live.size;
  }

  attach(badgeId: string, ws: ServerWebSocket<WsData>): void {
    const previous = this.live.get(badgeId);
    const session: LiveDevice = { ws, mode: 'menu', pending: new Map() };
    this.live.set(badgeId, session);
    if (previous && previous.ws !== ws) {
      previous.ws.send(JSON.stringify({ t: 'err', c: 'replaced' }));
      previous.ws.close(4409, 'replaced');
      this.rejectPending(previous, new HttpError(409, 'badge_offline'));
    }
    this.hub.publish(badgeId, { event: 'online', badgeId, at: new Date().toISOString() });
  }

  detach(badgeId: string, ws: ServerWebSocket<WsData>): boolean {
    const session = this.live.get(badgeId);
    if (!session || session.ws !== ws) return false;
    this.live.delete(badgeId);
    this.rejectPending(session, new HttpError(409, 'badge_offline'));
    this.hub.publish(badgeId, { event: 'offline', badgeId, at: new Date().toISOString() });
    return true;
  }

  setMode(badgeId: string, mode: 'canvas' | 'menu'): void {
    const session = this.live.get(badgeId);
    if (session) session.mode = mode;
  }

  send(badgeId: string, data: string | Uint8Array): void {
    const session = this.live.get(badgeId);
    if (!session) throw new HttpError(409, 'badge_offline');
    if (session.ws.send(data) === 0) throw new HttpError(503, 'badge_busy');
  }

  allocateReplyId(): number {
    const id = this.nextReplyId;
    this.nextReplyId = this.nextReplyId >= 2_147_483_647 ? 1 : this.nextReplyId + 1;
    return id;
  }

  request(badgeId: string, id: number, serializedFrame: string): Promise<Record<string, unknown>> {
    const session = this.live.get(badgeId);
    if (!session) return Promise.reject(new HttpError(409, 'badge_offline'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(id);
        reject(new HttpError(504, 'badge_timeout'));
      }, this.replyTimeoutMs);
      session.pending.set(id, { resolve, reject, timer });
      try {
        this.send(badgeId, serializedFrame);
      } catch (error) {
        clearTimeout(timer);
        session.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  resolve(badgeId: string, id: number, reply: Record<string, unknown>): void {
    const pending = this.live.get(badgeId)?.pending.get(id);
    if (!pending) return;
    const session = this.live.get(badgeId);
    session?.pending.delete(id);
    clearTimeout(pending.timer);
    if ('err' in reply) {
      const detail = typeof reply.err === 'string' ? reply.err : JSON.stringify(reply.err);
      pending.reject(new HttpError(502, 'badge_error', detail));
    } else {
      pending.resolve(reply);
    }
  }

  private rejectPending(session: LiveDevice, error: Error): void {
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    session.pending.clear();
  }
}
