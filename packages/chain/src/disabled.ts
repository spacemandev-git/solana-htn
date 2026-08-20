import type { ChainClient, ChainWriteResult, OnChainItem, OnChainVault } from './types.ts';

/**
 * Stand-in used when SOLANA_RPC_URL / the server keypair are not configured.
 *
 * It records nothing and signs nothing: every write resolves with a null
 * signature so the caller can persist "not yet on chain" rather than failing.
 * This keeps the badge -> station -> PWA loop fully demoable with no validator.
 */
export class DisabledChainClient implements ChainClient {
  readonly enabled = false;
  readonly programId: string;

  constructor(programId: string) {
    this.programId = programId;
  }

  private static noop(address = ''): Promise<ChainWriteResult> {
    return Promise.resolve({ address, signature: null });
  }

  ensureVault(): Promise<ChainWriteResult> {
    return DisabledChainClient.noop();
  }
  mintItem(): Promise<ChainWriteResult> {
    return DisabledChainClient.noop();
  }
  claimVault(): Promise<ChainWriteResult> {
    return DisabledChainClient.noop();
  }
  withdrawItem(): Promise<ChainWriteResult> {
    return DisabledChainClient.noop();
  }
  buildClaimVaultTransaction(): Promise<string | null> {
    return Promise.resolve(null);
  }
  buildWithdrawItemTransaction(): Promise<string | null> {
    return Promise.resolve(null);
  }
  getVault(): Promise<OnChainVault | null> {
    return Promise.resolve(null);
  }
  listItems(): Promise<OnChainItem[]> {
    return Promise.resolve([]);
  }
}
