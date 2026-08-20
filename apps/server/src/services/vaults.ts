import type { Database } from 'bun:sqlite';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import type { ChainClient } from '@htn/chain';
import type { Badge, Vault } from '@htn/shared';
import { one, run, toVault } from '../db/index.ts';
import type { VaultRow } from '../db/schema.ts';
import { animalCodeFor } from './badges.ts';

/**
 * The shape returned for a badge whose vault row does not exist yet, so every
 * endpoint reports the same thing rather than some returning null.
 */
export function emptyVault(badgeId: string): Vault {
  return { badgeId, vaultAddress: null, ownerWallet: null, claimedAt: null };
}

export function getVault(db: Database, badgeId: string): Vault | null {
  const row = one<VaultRow>(db, 'SELECT * FROM vaults WHERE badge_id = ?', badgeId);
  return row ? toVault(row) : null;
}

function requireVault(db: Database, badgeId: string): Vault {
  const vault = getVault(db, badgeId);
  if (!vault) throw new Error(`vault for ${badgeId} vanished`);
  return vault;
}

/**
 * Makes sure the badge has an escrow vault locally and on chain.
 *
 * Both halves are idempotent. With the disabled chain client the returned
 * address is empty, so `vault_address` simply stays null until a real client
 * writes one.
 */
export async function ensureVault(
  db: Database,
  chain: ChainClient,
  badge: Badge,
  at: string,
): Promise<Vault> {
  run(
    db,
    `INSERT INTO vaults (badge_id, vault_address, owner_wallet, claimed_at, created_at)
     VALUES (?, NULL, NULL, NULL, ?)
     ON CONFLICT(badge_id) DO NOTHING`,
    badge.badgeId,
    at,
  );

  const result = await chain.ensureVault(badge.badgeId, animalCodeFor(badge));
  if (result.address) {
    run(
      db,
      'UPDATE vaults SET vault_address = ? WHERE badge_id = ? AND (vault_address IS NULL OR vault_address <> ?)',
      result.address,
      badge.badgeId,
      result.address,
    );
  }

  return requireVault(db, badge.badgeId);
}

/** Binds a wallet to the vault. Re-claiming with the same wallet is a no-op. */
export async function claimVault(
  db: Database,
  chain: ChainClient,
  badgeId: string,
  wallet: string,
  at: string,
): Promise<Vault> {
  const result = await chain.claimVault(badgeId, wallet);
  run(
    db,
    'UPDATE vaults SET owner_wallet = ?, claimed_at = ?, vault_address = COALESCE(NULLIF(?, \'\'), vault_address) WHERE badge_id = ?',
    wallet,
    at,
    result.address,
    badgeId,
  );
  return requireVault(db, badgeId);
}

/**
 * Proves the caller controls `wallet` by checking an ed25519 signature over the
 * exact message from @htn/shared. Any malformed input is a failed verification,
 * never an exception.
 */
export function verifyWalletSignature(
  message: string,
  wallet: string,
  signature: string,
): boolean {
  let publicKey: Uint8Array;
  let signatureBytes: Uint8Array;
  try {
    publicKey = bs58.decode(wallet);
    signatureBytes = bs58.decode(signature);
  } catch {
    return false;
  }
  if (publicKey.length !== 32 || signatureBytes.length !== 64) return false;

  try {
    return nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      signatureBytes,
      publicKey,
    );
  } catch {
    return false;
  }
}
