/**
 * HTN OS — the pinned contract between the badge firmware (`firmware/`), the
 * badge proxy service (`apps/badge-service`), and the `/badge` console in the
 * PWA. Everything the three must agree on lives here; `firmware/main/htnos.h`
 * is the one allowed C mirror and marks itself as a copy of this file.
 *
 * Two protocols share one WebSocket per badge:
 *   - the *wire* protocol (badge <-> service): compact JSON text frames plus
 *     binary "blit" frames, documented in docs/HTNOS.md and typed below as
 *     `Wire*`;
 *   - the *public* API (anyone <-> service): REST + SSE + a WebSocket, typed
 *     below as zod schemas the service validates with.
 *
 * This is deliberately separate from the blind-box quest system (`quest.ts`,
 * `api.ts`); nothing here references pairing codes or attendee ids.
 */
import { z } from 'zod';

export const HTNOS_PROTOCOL_VERSION = 1;

/** HTN-ID alphabet: lowercase + digits without 0/1/i/l/o, so ids survive being read off a screen. */
export const HTNOS_ID_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
export const HTNOS_ID_LENGTH = 5;
export const HTNOS_ID_PATTERN = /^[23456789abcdefghjkmnpqrstuvwxyz]{5}$/;

/** App keys are typed on the badge keyboard: printable ASCII, no spaces. */
export const HTNOS_KEY_MIN = 4;
export const HTNOS_KEY_MAX = 32;
export const HTNOS_KEY_PATTERN = /^[\x21-\x7e]{4,32}$/;

/** Where a freshly flashed badge connects. Editable on the badge under Settings → Server. */
export const HTNOS_DEFAULT_SERVICE_URL = 'wss://badge.solana-htn.com/v1/device/ws';

export const HTNOS_SCREEN_WIDTH = 320;
export const HTNOS_SCREEN_HEIGHT = 240;
/** `size` 1–4 selects a bitmap font; the glyph cell is [width, height] in pixels. */
export const HTNOS_TEXT_SIZES = { 1: [6, 12], 2: [8, 16], 3: [12, 24], 4: [16, 32] } as const;
export const HTNOS_TEXT_SIZE_MIN = 1;
export const HTNOS_TEXT_SIZE_MAX = 4;
export const HTNOS_TEXT_MAX = 256;

export const HTNOS_LED_COUNT = 6;
/** Physical order looking at the front of the badge. */
export const HTNOS_LED_NAMES = [
  'upper-left',
  'upper-right',
  'middle-right',
  'bottom-right',
  'bottom-left',
  'middle-left',
] as const;
/** Firmware scales every channel by this / 255 so six white LEDs cannot brown out AA power. */
export const HTNOS_LED_CHANNEL_CAP = 160;

export const HTNOS_BUTTONS = ['a', 'b', 'home', 'down', 'left', 'right', 'up', 'aux1', 'start'] as const;
export type HtnosButton = (typeof HTNOS_BUTTONS)[number];

/** Largest upload the image endpoint accepts (PNG/JPEG bytes, or the base64 form). */
export const HTNOS_IMAGE_MAX_BYTES = 512 * 1024;
/** Largest single WebSocket frame the firmware buffers; binary blits are chunked to fit. */
export const HTNOS_FRAME_MAX_BYTES = 8192;
/** Rows per blit chunk: 320 × 8 × 2 bytes = 5120 B of pixels. */
export const HTNOS_BLIT_ROWS = 8;
/** Text (JSON) frames the service sends to a badge never exceed this. */
export const HTNOS_TEXT_FRAME_MAX_BYTES = 1024;
/** First byte of every binary frame the service sends to a badge. */
export const HTNOS_BLIT_FRAME_TYPE = 0x01;

export const HTNOS_ACCEL_HZ_MAX = 20;
export const HTNOS_NFC_TIMEOUT_MS_MAX = 10_000;
export const HTNOS_NFC_TIMEOUT_MS_DEFAULT = 3_000;
/** How long the service waits for a badge reply before answering 504. */
export const HTNOS_REPLY_TIMEOUT_MS = 5_000;
/** Per-badge command budget the service enforces before forwarding. */
export const HTNOS_RATE_LIMIT = { commandsPerSecond: 20, burst: 40, bytesPerSecond: 400_000 } as const;

/** Convert 8-bit RGB to the RGB565 value the wire carries. */
export function rgb565(r: number, g: number, b: number): number {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

/** Accepts "#rrggbb", "#rgb", or [r, g, b]; returns RGB565. */
export function colorToRgb565(color: HtnosColor): number {
  const [r, g, b] = colorToRgb(color);
  return rgb565(r, g, b);
}

export function colorToRgb(color: HtnosColor): [number, number, number] {
  if (Array.isArray(color)) return [color[0], color[1], color[2]];
  const hex = color.slice(1);
  if (hex.length === 3) {
    const r = hex[0] ?? '0';
    const g = hex[1] ?? '0';
    const b = hex[2] ?? '0';
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)];
  }
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

// ---------------------------------------------------------------------------
// Public API schemas (anyone -> service). Validated by the service, reused by
// the PWA console. Bodies are camelCase and human-friendly; the service
// translates them to the compact wire form.
// ---------------------------------------------------------------------------

const channel = z.number().int().min(0).max(255);

/** "#rrggbb", "#rgb", or [r, g, b]. */
export const HtnosColor = z.union([
  z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'must be #rgb or #rrggbb'),
  z.tuple([channel, channel, channel]),
]);
export type HtnosColor = z.infer<typeof HtnosColor>;

export const HtnosBadgeId = z.string().regex(HTNOS_ID_PATTERN, 'must be a 5-character HTN-ID');
export const HtnosKey = z.string().regex(HTNOS_KEY_PATTERN, 'must be 4–32 printable characters');

const screenX = z.number().int().min(0).max(HTNOS_SCREEN_WIDTH - 1);
const screenY = z.number().int().min(0).max(HTNOS_SCREEN_HEIGHT - 1);

/** POST /v1/badges/:id/clear */
export const ClearRequest = z.object({ color: HtnosColor.default('#000000') });
export type ClearRequest = z.infer<typeof ClearRequest>;

/** POST /v1/badges/:id/text */
export const TextRequest = z.object({
  text: z.string().min(1).max(HTNOS_TEXT_MAX),
  x: screenX.default(0),
  y: screenY.default(0),
  size: z.number().int().min(HTNOS_TEXT_SIZE_MIN).max(HTNOS_TEXT_SIZE_MAX).default(2),
  color: HtnosColor.default('#ffffff'),
  background: HtnosColor.default('#000000'),
  /** Clear the whole screen to `background` before drawing. */
  clear: z.boolean().default(false),
});
export type TextRequest = z.infer<typeof TextRequest>;

/** POST /v1/badges/:id/rect — filled rectangle. */
export const RectRequest = z.object({
  x: screenX,
  y: screenY,
  w: z.number().int().min(1).max(HTNOS_SCREEN_WIDTH),
  h: z.number().int().min(1).max(HTNOS_SCREEN_HEIGHT),
  color: HtnosColor,
});
export type RectRequest = z.infer<typeof RectRequest>;

/**
 * POST /v1/badges/:id/image — JSON form. The raw form is the same options as
 * query parameters with a PNG or JPEG body.
 */
export const ImageRequest = z.object({
  /** base64 PNG or JPEG bytes (a data: URL prefix is tolerated). */
  image: z.string().min(1),
  x: screenX.default(0),
  y: screenY.default(0),
  /** `contain` scales to fit the screen (keeping aspect) and centres; `none` draws 1:1 at x,y and crops. */
  fit: z.enum(['contain', 'none']).default('contain'),
});
export type ImageRequest = z.infer<typeof ImageRequest>;

/** POST /v1/badges/:id/leds — either every LED, or one colour for all. */
export const LedsRequest = z.union([
  z.object({
    /** Six entries in HTNOS_LED_NAMES order; `null` leaves that LED unchanged. */
    leds: z.array(HtnosColor.nullable()).length(HTNOS_LED_COUNT),
  }),
  z.object({ all: HtnosColor }),
]);
export type LedsRequest = z.infer<typeof LedsRequest>;

/** POST /v1/badges/:id/accel/stream */
export const AccelStreamRequest = z.object({ hz: z.number().int().min(0).max(HTNOS_ACCEL_HZ_MAX) });
export type AccelStreamRequest = z.infer<typeof AccelStreamRequest>;

/** POST /v1/badges/:id/nfc */
export const NfcRequest = z.object({
  timeoutMs: z.number().int().min(100).max(HTNOS_NFC_TIMEOUT_MS_MAX).default(HTNOS_NFC_TIMEOUT_MS_DEFAULT),
});
export type NfcRequest = z.infer<typeof NfcRequest>;

/** POST /v1/apps — the app store submission. */
export const AppSubmitRequest = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().min(10).max(500),
  /** Where people go to connect their badge to the app. */
  url: z.url().max(512),
  author: z.string().trim().min(1).max(80),
  sourceUrl: z.url().max(512).optional(),
  kind: z.enum(['server', 'badge-to-badge', 'tool']).default('server'),
});
export type AppSubmitRequest = z.infer<typeof AppSubmitRequest>;

export interface HtnosApp {
  appId: string;
  name: string;
  description: string;
  url: string;
  author: string;
  sourceUrl: string | null;
  kind: 'server' | 'badge-to-badge' | 'tool';
  createdAt: string;
}

/** GET /v1/badges/:id — public, no key needed. */
export interface HtnosBadgeStatus {
  badgeId: string;
  online: boolean;
  /** Whether the owner has set an app key; commands are refused until they do. */
  hasKey: boolean;
  fw: string | null;
  registeredAt: string;
  lastSeenAt: string;
  /** `canvas` while a remote app owns the screen, `menu` otherwise, null when offline. */
  mode: 'canvas' | 'menu' | null;
}

export interface HtnosButtons {
  a: boolean;
  b: boolean;
  home: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  aux1: boolean;
  start: boolean;
}

export interface HtnosAccel {
  /** milli-g */
  x: number;
  y: number;
  z: number;
}

export interface HtnosInfo {
  fw: string;
  ip: string;
  rssi: number;
  heap: number;
  uptimeSeconds: number;
  mode: 'canvas' | 'menu';
}

/** Events fanned out to SSE and app-WebSocket subscribers of a badge. */
export type HtnosEvent =
  | { event: 'button'; badgeId: string; button: HtnosButton; pressed: boolean; at: string }
  | { event: 'accel'; badgeId: string; x: number; y: number; z: number; at: string }
  | { event: 'mode'; badgeId: string; mode: 'canvas' | 'menu'; at: string }
  | { event: 'online'; badgeId: string; at: string }
  | { event: 'offline'; badgeId: string; at: string }
  | { event: 'ping'; at: string };

/**
 * Messages an app sends over GET /v1/badges/:id/ws. `cmd` names the REST
 * endpoint; the rest of the object is that endpoint's body. `id` is echoed
 * on the reply so callers can correlate.
 */
export const AppWsCommand = z.discriminatedUnion('cmd', [
  z.object({ cmd: z.literal('clear'), id: z.string().max(64).optional() }).extend(ClearRequest.shape),
  z.object({ cmd: z.literal('text'), id: z.string().max(64).optional() }).extend(TextRequest.shape),
  z.object({ cmd: z.literal('rect'), id: z.string().max(64).optional() }).extend(RectRequest.shape),
  z.object({ cmd: z.literal('image'), id: z.string().max(64).optional() }).extend(ImageRequest.shape),
  z.object({ cmd: z.literal('leds'), id: z.string().max(64).optional(), body: LedsRequest }),
  z.object({ cmd: z.literal('buttons'), id: z.string().max(64).optional() }),
  z.object({ cmd: z.literal('accel'), id: z.string().max(64).optional() }),
  z.object({ cmd: z.literal('accelStream'), id: z.string().max(64).optional() }).extend(
    AccelStreamRequest.shape,
  ),
  z.object({ cmd: z.literal('nfc'), id: z.string().max(64).optional() }).extend(NfcRequest.shape),
  z.object({ cmd: z.literal('info'), id: z.string().max(64).optional() }),
  z.object({ cmd: z.literal('home'), id: z.string().max(64).optional() }),
]);
export type AppWsCommand = z.infer<typeof AppWsCommand>;

export type AppWsMessage =
  | { type: 'reply'; id: string | null; data: unknown }
  | { type: 'error'; id: string | null; error: string; detail?: string }
  | { type: 'event'; data: HtnosEvent };

// ---------------------------------------------------------------------------
// Wire protocol (badge <-> service). Compact on purpose: the badge parses it
// with cJSON in a few KB of heap. Documented byte-for-byte in docs/HTNOS.md.
// ---------------------------------------------------------------------------

/** Badge -> service. */
export type WireFromBadge =
  | { t: 'hello'; v: number; mac: string; fw: string; id?: string; tok?: string; key?: string }
  | { t: 'key'; k: string }
  | { t: 'mode'; m: 'canvas' | 'menu' }
  | { t: 'btn'; n: HtnosButton; p: 0 | 1 }
  | { t: 'accel'; x: number; y: number; z: number }
  | ({ t: 'r'; i: number } & Record<string, unknown>);

/** Service -> badge. Every command carries the app key `k`; the badge checks it too. */
export type WireToBadge =
  | { t: 'welcome'; id: string; tok?: string }
  | { t: 'err'; c: 'bad_token' | 'bad_hello' | 'replaced' }
  | { t: 'clear'; k: string; c: number }
  | { t: 'text'; k: string; x: number; y: number; s: string; c: number; b: number; z: number; cl?: 1 }
  | { t: 'rect'; k: string; x: number; y: number; w: number; h: number; c: number }
  | { t: 'leds'; k: string; l: ([number, number, number] | null)[] }
  | { t: 'btn'; k: string; i: number }
  | { t: 'accel'; k: string; i: number }
  | { t: 'accel_stream'; k: string; hz: number }
  | { t: 'nfc'; k: string; i: number; ms: number }
  | { t: 'info'; k: string; i: number }
  | { t: 'home'; k: string };

/** Zod for what the service accepts from a badge; anything else closes the socket. */
export const WireFromBadgeSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    v: z.number().int(),
    mac: z.string().regex(/^[0-9a-f]{12}$/),
    fw: z.string().max(32),
    id: HtnosBadgeId.optional(),
    tok: z.string().max(128).optional(),
    key: HtnosKey.optional(),
  }),
  z.object({ t: z.literal('key'), k: z.union([HtnosKey, z.literal('')]) }),
  z.object({ t: z.literal('mode'), m: z.enum(['canvas', 'menu']) }),
  z.object({ t: z.literal('btn'), n: z.enum(HTNOS_BUTTONS), p: z.union([z.literal(0), z.literal(1)]) }),
  z.object({ t: z.literal('accel'), x: z.number(), y: z.number(), z: z.number() }),
  z.object({ t: z.literal('r'), i: z.number().int() }).loose(),
]);

/**
 * Binary blit frame layout (service -> badge), all integers big-endian:
 *
 *   byte 0        HTNOS_BLIT_FRAME_TYPE (0x01)
 *   byte 1        key length L (4..32)
 *   bytes 2..2+L  the app key, ASCII (the badge checks it)
 *   u16 x, u16 y, u16 w, u16 h
 *   w*h*2 bytes   RGB565 pixels, big-endian (ST7789 byte order, DMA-able as-is)
 *
 * The service splits images into chunks of HTNOS_BLIT_ROWS rows so no frame
 * exceeds HTNOS_FRAME_MAX_BYTES.
 */
export function encodeBlitFrame(
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  pixelsBigEndian: Uint8Array,
): Uint8Array {
  if (pixelsBigEndian.byteLength !== w * h * 2) {
    throw new Error('blit pixel buffer must be w*h*2 bytes');
  }
  const keyBytes = new TextEncoder().encode(key);
  const header = 2 + keyBytes.byteLength + 8;
  const out = new Uint8Array(header + pixelsBigEndian.byteLength);
  out[0] = HTNOS_BLIT_FRAME_TYPE;
  out[1] = keyBytes.byteLength;
  out.set(keyBytes, 2);
  const view = new DataView(out.buffer);
  let o = 2 + keyBytes.byteLength;
  view.setUint16(o, x);
  view.setUint16((o += 2), y);
  view.setUint16((o += 2), w);
  view.setUint16((o += 2), h);
  out.set(pixelsBigEndian, header);
  return out;
}
