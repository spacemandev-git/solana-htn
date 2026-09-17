import { z } from 'zod';

/** base58 alphabet; a 32-byte key encodes to 32–44 chars. */
const base58Address = z
  .string()
  .min(32)
  .max(44)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'must be a base58 address');

/**
 * POST /api/box — the blind-box relay webhook.
 *
 * The badge builds this body and the relay POSTs it verbatim; the relay can set
 * no headers, so this endpoint is unauthenticated. Field names are the badge
 * firmware's (snake_case) and must not change. `user_id` is the identity key;
 * when it is empty the server falls back to `public_key`. One of the two must
 * be non-empty.
 */
export const BoxRequest = z
  .object({
    /** Station id from the relay beacon. ASCII, max 39 chars. */
    box: z.string().min(1).max(39).regex(/^[\x21-\x7e]+$/, 'box must be printable ASCII'),
    /** HTN attendee id, as a string. */
    user_id: z.string().max(64).default(''),
    name: z.string().max(120).default(''),
    email: z.string().max(254).default(''),
    /** base58 ed25519 wallet. Empty when the badge has none yet. */
    public_key: z.union([base58Address, z.literal('')]).default(''),
  })
  .refine((body) => body.user_id.length > 0 || body.public_key.length > 0, {
    message: 'user_id or public_key is required',
  });
export type BoxRequest = z.infer<typeof BoxRequest>;

/**
 * The relay returns this body to the badge over BLE untouched. Serialized it
 * must be ≤ BOX_RESPONSE_MAX_BYTES; the server drops `chain_link` (never
 * items) if it would not fit.
 */
export const BoxResponse = z.object({
  /** Item won at this box. Empty string renders "Empty box?" on the badge. */
  new_item: z.string(),
  /** URL behind the badge's QR button. Empty hides the QR. */
  chain_link: z.string(),
  /** Authoritative inventory; the badge replaces its local state with this. */
  all_items: z.array(z.string()),
});
export type BoxResponse = z.infer<typeof BoxResponse>;

/**
 * POST /api/quest/submit — the hacker hands over their endpoint and program.
 *
 * Authenticated by knowing a badge's pairing code. Verification runs
 * asynchronously; progress streams over the badge's SSE channel.
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
