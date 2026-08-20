/** Vault state as stored by the `badge_escrow` program. */
export interface OnChainVault {
  vaultAddress: string;
  badgeHash: string;
  /** null while the vault is still in escrow (on-chain owner is the zero address). */
  owner: string | null;
  animalCode: number;
  itemCount: number;
}

/** One escrowed item record. */
export interface OnChainItem {
  itemAddress: string;
  index: number;
  code: number;
  stationHash: string;
  mintedAt: number;
  withdrawn: boolean;
}

export interface ChainWriteResult {
  address: string;
  signature: string | null;
}

/**
 * Everything the server needs from Solana.
 *
 * Two implementations ship: a live one that talks to the `badge_escrow` Anchor
 * program, and a disabled one used when no RPC/keypair is configured. The server
 * must work end to end with the disabled client so the badge + PWA flow can be
 * demoed without a validator running.
 */
export interface ChainClient {
  /** False for the disabled client. The server surfaces this in /api/health. */
  readonly enabled: boolean;
  readonly programId: string;
  /** Idempotent: creates the badge's escrow vault if it does not exist yet. */
  ensureVault(badgeId: string, animalCode: number): Promise<ChainWriteResult>;
  /** Mints item `index` into the badge's vault, held in escrow. Idempotent per index. */
  mintItem(args: {
    badgeId: string;
    index: number;
    code: number;
    stationId: string;
  }): Promise<ChainWriteResult>;
  /**
   * Reports the on-chain claim state for `wallet`.
   *
   * The server deliberately cannot claim on a hacker's behalf: `claim_vault`
   * requires the hacker's wallet to sign. This resolves the vault address and
   * reports the signature only if the claim has already landed on chain.
   */
  claimVault(badgeId: string, wallet: string): Promise<ChainWriteResult>;
  /** Reports the on-chain withdrawal state for one item. Same signing caveat. */
  withdrawItem(badgeId: string, index: number): Promise<ChainWriteResult>;
  /**
   * Builds the unsigned `claim_vault` transaction for the hacker's wallet to
   * sign in the browser. Base64 of a serialized legacy transaction, or null
   * when the chain is disabled.
   */
  buildClaimVaultTransaction(badgeId: string, wallet: string): Promise<string | null>;
  /** Builds the unsigned `withdraw_item` transaction for the hacker to sign. */
  buildWithdrawItemTransaction(
    badgeId: string,
    index: number,
    wallet: string,
  ): Promise<string | null>;
  getVault(badgeId: string): Promise<OnChainVault | null>;
  listItems(badgeId: string): Promise<OnChainItem[]>;
}
