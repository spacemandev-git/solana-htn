import { z } from 'zod';

/** Header the Sync Stations authenticate with. */
export const API_KEY_HEADER = 'x-station-key';

const badgeId = z.string().min(1).max(64).regex(/^[a-zA-Z0-9._-]+$/, 'badge id must be url-safe');
const stationId = z.string().min(1).max(64).regex(/^[a-zA-Z0-9._-]+$/, 'station id must be url-safe');

/**
 * POST /api/station/sync
 * Sent by a Sync Station when a badge announces itself over ESP-NOW.
 * Idempotent: repeated syncs for a badge already at that station just refresh it.
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
  url: z.string(),
  badgeId: z.string(),
  animal: z.string(),
  /** Items granted by this particular sync (empty on a repeat visit). */
  granted: z.array(z.object({ name: z.string(), slot: z.string(), rarity: z.string() })),
  itemCount: z.number().int(),
});
export type SyncResponse = z.infer<typeof SyncResponse>;

/**
 * POST /api/station/disconnect
 * Sent when the badge drops out of ESP-NOW range.
 */
export const DisconnectRequest = z.object({ stationId, badgeId });
export type DisconnectRequest = z.infer<typeof DisconnectRequest>;

/** POST /api/vault/claim — a hacker binds their wallet to their badge's vault. */
export const ClaimRequest = z.object({
  pairingCode: z.string().min(1).max(32),
  wallet: z.string().min(32).max(44),
  /** base58 signature over `claimMessage(pairingCode, wallet)`, proving wallet control. */
  signature: z.string().min(1),
});
export type ClaimRequest = z.infer<typeof ClaimRequest>;

/**
 * POST /api/vault/claim-tx — ask the server to build the unsigned `claim_vault`
 * transaction. Handing this out grants nothing: the hacker's wallet still has to
 * sign it, which is exactly the point — the server cannot claim on their behalf.
 */
export const ClaimTxRequest = z.object({
  pairingCode: z.string().min(1).max(32),
  wallet: z.string().min(32).max(44),
});
export type ClaimTxRequest = z.infer<typeof ClaimTxRequest>;

/** POST /api/vault/withdraw-tx — unsigned `withdraw_item` for the wallet to sign. */
export const WithdrawTxRequest = z.object({
  pairingCode: z.string().min(1).max(32),
  itemId: z.number().int().nonnegative(),
  wallet: z.string().min(32).max(44),
});
export type WithdrawTxRequest = z.infer<typeof WithdrawTxRequest>;

/** `transaction` is base64 of a serialized unsigned legacy transaction. */
export const BuildTxResponse = z.object({
  transaction: z.string().nullable(),
  chainEnabled: z.boolean(),
});
export type BuildTxResponse = z.infer<typeof BuildTxResponse>;

/**
 * POST /api/vault/withdraw — move one escrowed item to the claimed wallet.
 *
 * Requires the same wallet proof as claiming. The pairing code alone is not a
 * credential worth moving assets on: it is short, printed on a badge screen, and
 * readable by anyone standing nearby.
 */
export const WithdrawRequest = z.object({
  pairingCode: z.string().min(1).max(32),
  itemId: z.number().int().nonnegative(),
  wallet: z.string().min(32).max(44),
  /** base58 signature over `withdrawMessage(pairingCode, itemId, wallet)`. */
  signature: z.string().min(1),
});
export type WithdrawRequest = z.infer<typeof WithdrawRequest>;

/**
 * The exact message a wallet signs to prove ownership before claiming a vault.
 * Kept here so the server and the PWA can never disagree about the bytes.
 */
export function claimMessage(pairingCode: string, wallet: string): string {
  return `Hack the North x Solana\nClaim badge vault\npairing: ${pairingCode}\nwallet: ${wallet}`;
}

/** The exact message a wallet signs to authorize withdrawing one item. */
export function withdrawMessage(pairingCode: string, itemId: number, wallet: string): string {
  return (
    'Hack the North x Solana\nWithdraw item from escrow\n' +
    `pairing: ${pairingCode}\nitem: ${itemId}\nwallet: ${wallet}`
  );
}

export const ApiError = z.object({ error: z.string(), detail: z.string().optional() });
export type ApiError = z.infer<typeof ApiError>;
