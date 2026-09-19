import type { Database } from 'bun:sqlite';
import type { Server, ServerWebSocket } from 'bun';
import { HTNOS_REPLY_TIMEOUT_MS } from '@htn/shared';
import { handleAppClose, handleAppMessage, handleAppOpen } from './app-ws.ts';
import { buildApp } from './app.ts';
import { BadgeCommands } from './commands.ts';
import type { ServiceConfig } from './config.ts';
import { migrate } from './db.ts';
import { handleDeviceClose, handleDeviceMessage, type DeviceSession } from './device-ws.ts';
import { EventHub } from './hub.ts';
import { RateLimiter } from './limits.ts';
import { BadgeRegistry } from './registry.ts';

export type WsData =
  | { kind: 'device'; session: DeviceSession }
  | { kind: 'app'; badgeId: string; key: string; unsubscribe: (() => void) | null };

export interface ServiceContext {
  db: Database;
  config: ServiceConfig;
  hub: EventHub;
  registry: BadgeRegistry;
  limits: RateLimiter;
  commands: BadgeCommands;
  replyTimeoutMs: number;
}

export function createServer(options: {
  db: Database;
  config: ServiceConfig;
  port?: number;
  replyTimeoutMs?: number;
}): { server: Server<WsData>; ctx: ServiceContext } {
  migrate(options.db);
  const hub = new EventHub();
  const replyTimeoutMs = options.replyTimeoutMs ?? HTNOS_REPLY_TIMEOUT_MS;
  const registry = new BadgeRegistry(hub, replyTimeoutMs);
  const ctx = {
    db: options.db,
    config: options.config,
    hub,
    registry,
    limits: new RateLimiter(),
    commands: undefined as unknown as BadgeCommands,
    replyTimeoutMs,
  } satisfies ServiceContext;
  ctx.commands = new BadgeCommands(ctx);
  const app = buildApp(ctx);

  const server = Bun.serve<WsData>({
    port: options.port ?? options.config.port,
    idleTimeout: 0,
    fetch(request, bunServer) {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/v1/device/ws') {
        const session: DeviceSession = { badgeId: null, mac: null, buffer: undefined as never };
        if (bunServer.upgrade(request, { data: { kind: 'device', session } })) return;
        return Response.json({ error: 'upgrade_required' }, { status: 426 });
      }
      const match = request.method === 'GET' ? /^\/v1\/badges\/([^/]+)\/ws$/.exec(url.pathname) : null;
      const encodedBadgeId = match?.[1];
      if (encodedBadgeId !== undefined) {
        let badgeId: string;
        try { badgeId = decodeURIComponent(encodedBadgeId); }
        catch { badgeId = encodedBadgeId; }
        const key = request.headers.get('x-badge-key') ?? url.searchParams.get('key') ?? '';
        if (bunServer.upgrade(request, { data: { kind: 'app', badgeId, key, unsubscribe: null } })) return;
        return Response.json({ error: 'upgrade_required' }, { status: 426 });
      }
      return app.fetch(request, bunServer);
    },
    websocket: {
      open(ws) {
        if (ws.data.kind === 'app') handleAppOpen(ctx, ws as ServerWebSocket<Extract<WsData, { kind: 'app' }>>);
      },
      message(ws, message) {
        if (ws.data.kind === 'device') {
          handleDeviceMessage(ctx, ws as ServerWebSocket<Extract<WsData, { kind: 'device' }>>, message);
        } else {
          void handleAppMessage(ctx, ws as ServerWebSocket<Extract<WsData, { kind: 'app' }>>, message);
        }
      },
      close(ws) {
        if (ws.data.kind === 'device') {
          handleDeviceClose(ctx, ws as ServerWebSocket<Extract<WsData, { kind: 'device' }>>);
        } else {
          handleAppClose(ws as ServerWebSocket<Extract<WsData, { kind: 'app' }>>);
        }
      },
    },
  });
  return { server, ctx };
}
