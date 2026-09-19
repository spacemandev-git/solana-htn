import type { ServerWebSocket } from 'bun';
import { WireFromBadgeSchema, type WireFromBadge } from '@htn/shared';
import { one, run, type DeviceRow } from './db.ts';
import { mintBadgeId, mintToken, sha256Hex, timingSafeEqualHex } from './ids.ts';
import type { ServiceContext, WsData } from './server.ts';

export interface DeviceSession {
  badgeId: string | null;
  mac: string | null;
  buffer: never;
}

type DeviceSocket = ServerWebSocket<Extract<WsData, { kind: 'device' }>>;

function sendControl(ws: DeviceSocket, frame: object): void {
  ws.send(JSON.stringify(frame));
}

export function handleDeviceMessage(
  ctx: ServiceContext,
  ws: DeviceSocket,
  message: string | Buffer,
): void {
  let raw: unknown;
  try {
    raw = JSON.parse(typeof message === 'string' ? message : message.toString('utf8'));
  } catch {
    return invalidFrame(ctx, ws);
  }
  const parsed = WireFromBadgeSchema.safeParse(raw);
  if (!parsed.success) return invalidFrame(ctx, ws);
  const frame = parsed.data;
  if (ws.data.session.badgeId === null) {
    if (frame.t !== 'hello') return badHello(ws);
    handleHello(ctx, ws, frame);
    return;
  }
  if (frame.t === 'hello') {
    handleHello(ctx, ws, frame);
    return;
  }
  handleAuthenticated(ctx, ws, frame);
}

function invalidFrame(ctx: ServiceContext, ws: DeviceSocket): void {
  if (ws.data.session.badgeId === null) badHello(ws);
  else if (!ctx.config.isProduction) console.warn('[badge] ignored invalid device frame');
}

function badHello(ws: DeviceSocket): void {
  sendControl(ws, { t: 'err', c: 'bad_hello' });
  ws.close(4400);
}

function handleHello(
  ctx: ServiceContext,
  ws: DeviceSocket,
  hello: Extract<WireFromBadge, { t: 'hello' }>,
): void {
  const now = new Date().toISOString();
  let row: DeviceRow | null = null;
  let token: string | null = null;

  if (hello.id !== undefined && hello.tok !== undefined) {
    row = one<DeviceRow>(ctx.db, 'SELECT * FROM devices WHERE badge_id = ?', hello.id);
    if (!row || !timingSafeEqualHex(sha256Hex(hello.tok), row.token_hash)) {
      sendControl(ws, { t: 'err', c: 'bad_token' });
      return;
    }
  } else if (hello.id === undefined && hello.tok === undefined) {
    row = one<DeviceRow>(ctx.db, 'SELECT * FROM devices WHERE mac = ?', hello.mac);
    token = mintToken();
    if (row) {
      run(ctx.db, 'UPDATE devices SET token_hash = ?, fw = ?, last_seen_at = ? WHERE badge_id = ?',
        sha256Hex(token), hello.fw, now, row.badge_id);
      row = { ...row, token_hash: sha256Hex(token), fw: hello.fw, last_seen_at: now };
    } else {
      const badgeId = mintBadgeId(ctx.db);
      run(ctx.db,
        'INSERT INTO devices (badge_id, mac, token_hash, key_hash, fw, registered_at, last_seen_at) VALUES (?, ?, ?, NULL, ?, ?, ?)',
        badgeId, hello.mac, sha256Hex(token), hello.fw, now, now);
      row = one<DeviceRow>(ctx.db, 'SELECT * FROM devices WHERE badge_id = ?', badgeId);
    }
  } else {
    sendControl(ws, { t: 'err', c: 'bad_token' });
    return;
  }

  if (!row) return;
  run(ctx.db, 'UPDATE devices SET fw = ?, last_seen_at = ? WHERE badge_id = ?', hello.fw, now, row.badge_id);
  if (hello.key !== undefined) {
    run(ctx.db, 'UPDATE devices SET key_hash = ? WHERE badge_id = ?', sha256Hex(hello.key), row.badge_id);
  }
  ws.data.session.badgeId = row.badge_id;
  ws.data.session.mac = hello.mac;
  sendControl(ws, token === null ? { t: 'welcome', id: row.badge_id } : { t: 'welcome', id: row.badge_id, tok: token });
  ctx.registry.attach(row.badge_id, ws);
}

function handleAuthenticated(
  ctx: ServiceContext,
  ws: DeviceSocket,
  frame: Exclude<WireFromBadge, { t: 'hello' }>,
): void {
  const badgeId = ws.data.session.badgeId;
  if (badgeId === null) return;
  const at = new Date().toISOString();
  switch (frame.t) {
    case 'key':
      run(ctx.db, 'UPDATE devices SET key_hash = ? WHERE badge_id = ?', frame.k ? sha256Hex(frame.k) : null, badgeId);
      break;
    case 'mode':
      ctx.registry.setMode(badgeId, frame.m);
      ctx.hub.publish(badgeId, { event: 'mode', badgeId, mode: frame.m, at });
      break;
    case 'btn':
      ctx.hub.publish(badgeId, { event: 'button', badgeId, button: frame.n, pressed: frame.p === 1, at });
      break;
    case 'accel':
      ctx.hub.publish(badgeId, { event: 'accel', badgeId, x: frame.x, y: frame.y, z: frame.z, at });
      break;
    case 'r':
      ctx.registry.resolve(badgeId, frame.i, frame);
      break;
  }
}

export function handleDeviceClose(ctx: ServiceContext, ws: DeviceSocket): void {
  const badgeId = ws.data.session.badgeId;
  if (badgeId === null) return;
  run(ctx.db, 'UPDATE devices SET last_seen_at = ? WHERE badge_id = ?', new Date().toISOString(), badgeId);
  ctx.registry.detach(badgeId, ws);
}
