import { DisabledChainClient } from './disabled.ts';
import type { ChainClient } from './types.ts';

export interface ChainConfig {
  /** e.g. http://127.0.0.1:8899. When absent the disabled client is returned. */
  rpcUrl?: string | undefined;
  /** base58-encoded 64-byte secret key for the server's mint authority. */
  authoritySecretKey?: string | undefined;
  programId: string;
}

/**
 * Builds the chain client. Falls back to {@link DisabledChainClient} whenever the
 * program is not deployed or credentials are missing, so the server never fails
 * to boot just because there is no validator around.
 */
export async function createChainClient(config: ChainConfig): Promise<ChainClient> {
  if (!config.rpcUrl || !config.authoritySecretKey) {
    return new DisabledChainClient(config.programId);
  }
  const { SolanaChainClient } = await import('./solana.ts');
  return SolanaChainClient.connect(config);
}
