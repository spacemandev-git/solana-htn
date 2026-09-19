import type { ServerWebSocket } from 'bun';
import { AppWsCommand, type AppWsMessage } from '@htn/shared';
import { one, type DeviceRow } from './db.ts';
import { HttpError } from './http.ts';
import { decodeBase64Image, ImageError } from './image.ts';
import { sha256Hex, timingSafeEqualHex } from './ids.ts';
import type { ServiceContext, WsData } from './server.ts';

type AppSocket = ServerWebSocket<Extract<WsData, { kind: 'app' }>>;

function send(ws: AppSocket, message: AppWsMessage): void {
  ws.send(JSON.stringify(message));
}

export function handleAppOpen(ctx: ServiceContext, ws: AppSocket): void {
  const { badgeId, key } = ws.data;
  const row = one<DeviceRow>(ctx.db, 'SELECT * FROM devices WHERE badge_id = ?', badgeId);
  if (!row) return ws.close(4404, 'badge_not_found');
  if (row.key_hash === null) return ws.close(4403, 'key_not_set');
  if (!timingSafeEqualHex(sha256Hex(key), row.key_hash)) return ws.close(4403, 'bad_key');
  ws.data.unsubscribe = ctx.hub.subscribe(badgeId, (event) => send(ws, { type: 'event', data: event }));
}

export async function handleAppMessage(
  ctx: ServiceContext,
  ws: AppSocket,
  message: string | Buffer,
): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(typeof message === 'string' ? message : message.toString('utf8'));
  } catch {
    send(ws, { type: 'error', id: null, error: 'invalid_request', detail: 'message must be valid JSON' });
    return;
  }
  const parsed = AppWsCommand.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(message)'}: ${issue.message}`).join('; ');
    send(ws, { type: 'error', id: null, error: 'invalid_request', detail });
    return;
  }
  const cmd = parsed.data;
  const id = cmd.id ?? null;
  try {
    let data: unknown;
    switch (cmd.cmd) {
      case 'clear': await ctx.commands.clear(ws.data.badgeId, ws.data.key, cmd); data = { ok: true }; break;
      case 'text': await ctx.commands.text(ws.data.badgeId, ws.data.key, cmd); data = { ok: true }; break;
      case 'rect': await ctx.commands.rect(ws.data.badgeId, ws.data.key, cmd); data = { ok: true }; break;
      case 'image': {
        let bytes: Uint8Array;
        try { bytes = decodeBase64Image(cmd.image); }
        catch (error) {
          if (error instanceof ImageError) throw new HttpError(400, error.code);
          throw error;
        }
        const dimensions = await ctx.commands.image(ws.data.badgeId, ws.data.key, bytes, cmd);
        data = { ok: true, ...dimensions };
        break;
      }
      case 'leds': await ctx.commands.leds(ws.data.badgeId, ws.data.key, cmd.body); data = { ok: true }; break;
      case 'buttons': data = { buttons: await ctx.commands.buttons(ws.data.badgeId, ws.data.key) }; break;
      case 'accel': data = await ctx.commands.accel(ws.data.badgeId, ws.data.key); break;
      case 'accelStream': await ctx.commands.accelStream(ws.data.badgeId, ws.data.key, cmd); data = { ok: true }; break;
      case 'nfc': data = await ctx.commands.nfc(ws.data.badgeId, ws.data.key, cmd); break;
      case 'info': data = await ctx.commands.info(ws.data.badgeId, ws.data.key); break;
      case 'home': await ctx.commands.home(ws.data.badgeId, ws.data.key); data = { ok: true }; break;
    }
    send(ws, { type: 'reply', id, data });
  } catch (error) {
    if (error instanceof HttpError) {
      send(ws, { type: 'error', id, error: error.code, ...(error.detail ? { detail: error.detail } : {}) });
    } else {
      console.error('[badge] app websocket error', error);
      send(ws, { type: 'error', id, error: 'internal_error' });
    }
  }
}

export function handleAppClose(ws: AppSocket): void {
  ws.data.unsubscribe?.();
  ws.data.unsubscribe = null;
}
