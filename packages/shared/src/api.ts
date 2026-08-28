import { z } from 'zod';
import type { QuestStatus } from './types.ts';

/** Header the beacons authenticate with. */
export const API_KEY_HEADER = 'x-station-key';

const badgeId = z.string().min(1).max(64).regex(/^[a-zA-Z0-9._-]+$/, 'badge id must be url-safe');
const stationId = z.string().min(1).max(64).regex(/^[a-zA-Z0-9._-]+$/, 'station id must be url-safe');

/** base58 alphabet; a 32-byte key encodes to 32–44 chars. */
const base58Address = z
  .string()
  .min(32)
  .max(44)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'must be a base58 address');

/**
 * POST /api/station/sync
 * Sent by a beacon when a badge announces itself over ESP-NOW.
 * Idempotent: repeated syncs for a badge already at that beacon just refresh it.
 */
export const SyncRequest = z.object({
  stationId,
  stationName: z.string().min(1).max(120).optional(),
  badge: z.object({
    badgeId,
    name: z.string().min(1).max(120),
    email: z.email().max(254),
  }),
  /** Signal strength, purely informational. */
  rssi: z.number().int().min(-127).max(0).optional(),
});
export type SyncRequest = z.infer<typeof SyncRequest>;

export const SyncResponse = z.object({
  pairingCode: z.string(),
  /** The URL the badge shows as a QR code. */
  url: z.string(),
  badgeId: z.string(),
  /** Null until the badge has submitted the quest. */
  questStatus: z.enum(['verifying', 'completed', 'failed']).nullable(),
});
export type SyncResponse = z.infer<typeof SyncResponse> & { questStatus: QuestStatus | null };

/**
 * POST /api/station/disconnect
 * Sent when the badge drops out of ESP-NOW range.
 */
export const DisconnectRequest = z.object({ stationId, badgeId });
export type DisconnectRequest = z.infer<typeof DisconnectRequest>;

/**
 * POST /api/quest/submit — the hacker hands over their endpoint and program.
 *
 * Authenticated by knowing an *active* pairing code. Verification runs
 * asynchronously; progress streams over the session's SSE channel.
 */
export const QuestSubmitRequest = z.object({
  pairingCode: z.string().min(1).max(32),
  /** The hacker's x402-paywalled endpoint. Must be http(s). */
  endpointUrl: z
    .url()
    .max(512)
    .refine((u) => u.startsWith('http://') || u.startsWith('https://'), {
      message: 'endpoint must be http or https',
    }),
  /** The hacker's deployed program id. */
  programId: base58Address,
});
export type QuestSubmitRequest = z.infer<typeof QuestSubmitRequest>;

/**
 * What the hacker's endpoint must return (JSON) once the payment clears.
 * Extra fields are fine; `message` must equal the string in the quest PDA.
 */
export const QuestProof = z.object({
  message: z.string().min(1).max(256),
  programId: z.string().optional(),
});
export type QuestProof = z.infer<typeof QuestProof>;

export const ApiError = z.object({ error: z.string(), detail: z.string().optional() });
export type ApiError = z.infer<typeof ApiError>;
