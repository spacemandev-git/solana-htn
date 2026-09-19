import {
  HTNOS_BUTTONS,
  HTNOS_IMAGE_MAX_BYTES,
  HTNOS_TEXT_FRAME_MAX_BYTES,
  colorToRgb,
  colorToRgb565,
  encodeBlitFrame,
  type AccelStreamRequest,
  type ClearRequest,
  type HtnosAccel,
  type HtnosButtons,
  type HtnosInfo,
  type LedsRequest,
  type NfcRequest,
  type RectRequest,
  type TextRequest,
  type WireToBadge,
} from '@htn/shared';
import { one, type DeviceRow } from './db.ts';
import { HttpError } from './http.ts';
import { decodeImage, ImageError, planBlits } from './image.ts';
import { sha256Hex, timingSafeEqualHex } from './ids.ts';
import type { ServiceContext } from './server.ts';

const encoder = new TextEncoder();

export class BadgeCommands {
  constructor(private readonly ctx: ServiceContext) {}

  authorize(badgeId: string, key: string, requireOnline = true): DeviceRow {
    const row = one<DeviceRow>(this.ctx.db, 'SELECT * FROM devices WHERE badge_id = ?', badgeId);
    if (!row) throw new HttpError(404, 'badge_not_found');
    if (row.key_hash === null) throw new HttpError(403, 'key_not_set');
    if (!timingSafeEqualHex(sha256Hex(key), row.key_hash)) throw new HttpError(403, 'bad_key');
    if (requireOnline && !this.ctx.registry.get(badgeId)) throw new HttpError(409, 'badge_offline');
    return row;
  }

  private serialize(frame: WireToBadge): string {
    const serialized = JSON.stringify(frame);
    if (encoder.encode(serialized).byteLength > HTNOS_TEXT_FRAME_MAX_BYTES) {
      throw new HttpError(400, 'invalid_request', 'wire frame exceeds maximum size');
    }
    return serialized;
  }

  private send(badgeId: string, key: string, build: () => WireToBadge): void {
    this.authorize(badgeId, key);
    const frame = build();
    const serialized = this.serialize(frame);
    if (!this.ctx.limits.takeBadge(badgeId, encoder.encode(serialized).byteLength)) {
      throw new HttpError(429, 'rate_limited');
    }
    this.ctx.registry.send(badgeId, serialized);
  }

  private request(
    badgeId: string,
    key: string,
    build: (id: number) => WireToBadge,
  ): Promise<Record<string, unknown>> {
    this.authorize(badgeId, key);
    const id = this.ctx.registry.allocateReplyId();
    const serialized = this.serialize(build(id));
    if (!this.ctx.limits.takeBadge(badgeId, encoder.encode(serialized).byteLength)) {
      throw new HttpError(429, 'rate_limited');
    }
    return this.ctx.registry.request(badgeId, id, serialized);
  }

  async clear(badgeId: string, key: string, body: ClearRequest): Promise<void> {
    this.send(badgeId, key, () => ({ t: 'clear', k: key, c: colorToRgb565(body.color) }));
  }

  async text(badgeId: string, key: string, body: TextRequest): Promise<void> {
    this.send(badgeId, key, () => ({
      t: 'text',
      k: key,
      x: body.x,
      y: body.y,
      s: body.text,
      c: colorToRgb565(body.color),
      b: colorToRgb565(body.background),
      z: body.size,
      ...(body.clear ? { cl: 1 as const } : {}),
    }));
  }

  async rect(badgeId: string, key: string, body: RectRequest): Promise<void> {
    this.send(badgeId, key, () => ({
      t: 'rect', k: key, x: body.x, y: body.y, w: body.w, h: body.h, c: colorToRgb565(body.color),
    }));
  }

  async image(
    badgeId: string,
    key: string,
    bytes: Uint8Array,
    opts: { x: number; y: number; fit: 'contain' | 'none' },
  ): Promise<{ width: number; height: number }> {
    this.authorize(badgeId, key);
    if (bytes.byteLength > HTNOS_IMAGE_MAX_BYTES) throw new HttpError(413, 'image_too_large');
    let planned: ReturnType<typeof planBlits>;
    try {
      planned = planBlits(decodeImage(bytes), opts);
    } catch (error) {
      if (error instanceof ImageError) {
        throw new HttpError(error.code === 'image_too_large' ? 413 : 400, error.code);
      }
      throw error;
    }
    const frames = planned.blits.map((blit) =>
      encodeBlitFrame(key, blit.x, blit.y, blit.w, blit.h, blit.pixels),
    );
    const totalBytes = frames.reduce((total, frame) => total + frame.byteLength, 0);
    if (!this.ctx.limits.takeBadge(badgeId, totalBytes)) throw new HttpError(429, 'rate_limited');
    for (const frame of frames) this.ctx.registry.send(badgeId, frame);
    return { width: planned.width, height: planned.height };
  }

  async leds(badgeId: string, key: string, body: LedsRequest): Promise<void> {
    this.send(badgeId, key, () => {
      const leds = 'all' in body
        ? Array.from({ length: 6 }, () => colorToRgb(body.all))
        : body.leds.map((color) => (color === null ? null : colorToRgb(color)));
      return { t: 'leds', k: key, l: leds };
    });
  }

  async buttons(badgeId: string, key: string): Promise<HtnosButtons> {
    const reply = await this.request(badgeId, key, (i) => ({ t: 'btn', k: key, i }));
    const raw = typeof reply.b === 'object' && reply.b !== null ? reply.b as Record<string, unknown> : {};
    return Object.fromEntries(HTNOS_BUTTONS.map((name) => [name, raw[name] === 1])) as unknown as HtnosButtons;
  }

  async accel(badgeId: string, key: string): Promise<HtnosAccel> {
    const reply = await this.request(badgeId, key, (i) => ({ t: 'accel', k: key, i }));
    return { x: numberField(reply, 'x'), y: numberField(reply, 'y'), z: numberField(reply, 'z') };
  }

  async accelStream(badgeId: string, key: string, body: AccelStreamRequest): Promise<void> {
    this.send(badgeId, key, () => ({ t: 'accel_stream', k: key, hz: body.hz }));
  }

  async nfc(badgeId: string, key: string, body: NfcRequest): Promise<{ uid: string | null }> {
    const reply = await this.request(badgeId, key, (i) => ({ t: 'nfc', k: key, i, ms: body.timeoutMs }));
    return { uid: typeof reply.uid === 'string' ? reply.uid : null };
  }

  async info(badgeId: string, key: string): Promise<HtnosInfo> {
    const reply = await this.request(badgeId, key, (i) => ({ t: 'info', k: key, i }));
    return {
      fw: typeof reply.fw === 'string' ? reply.fw : '',
      ip: typeof reply.ip === 'string' ? reply.ip : '',
      rssi: numberField(reply, 'rssi'),
      heap: numberField(reply, 'heap'),
      uptimeSeconds: numberField(reply, 'up'),
      mode: reply.mode === 'canvas' ? 'canvas' : 'menu',
    };
  }

  async home(badgeId: string, key: string): Promise<void> {
    this.send(badgeId, key, () => ({ t: 'home', k: key }));
  }
}

function numberField(reply: Record<string, unknown>, name: string): number {
  return typeof reply[name] === 'number' ? reply[name] : 0;
}
