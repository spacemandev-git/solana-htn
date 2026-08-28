/**
 * The quest, pinned. Everything both sides must agree on — the server's payer
 * agent, the PWA, the starter kit, and the on-chain program — lives here.
 *
 * The quest: deploy the `htn_quest` Anchor program, store a message in its
 * `["quest"]` PDA, and stand up an x402-paywalled HTTP endpoint that returns
 * that message once paid. The server agent calls the endpoint exactly once,
 * pays up to $1 in USDC over x402, and verifies the response against the chain.
 */

/** Which Solana cluster the quest is running against. */
export type Cluster = 'devnet' | 'mainnet';

/** Seed of the single PDA the hacker's program must own. */
export const QUEST_SEED = 'quest';

/** Longest message the quest account may hold, in bytes. */
export const QUEST_MESSAGE_MAX = 256;

/**
 * Byte offset of the borsh-encoded message string inside the quest account:
 * 8 (anchor discriminator) + 32 (authority address). The string itself is
 * u32-LE length followed by utf-8 bytes.
 */
export const QUEST_MESSAGE_OFFSET = 40;

/** USDC uses 6 decimals on every Solana cluster. */
export const USDC_DECIMALS = 6;

/** The verification pipeline, in the order the server agent runs it. */
export const QUEST_STEPS = ['program', 'state', 'challenge', 'payment', 'proof'] as const;
export type QuestStep = (typeof QUEST_STEPS)[number];

export const QUEST_STEP_LABELS: Record<QuestStep, string> = {
  program: 'program deployed on-chain',
  state: 'quest PDA holds a message',
  challenge: 'endpoint answers 402 with valid terms',
  payment: 'x402 payment settled',
  proof: 'paid response matches on-chain state',
};

export interface ClusterInfo {
  /** CAIP-2 network id (x402 v2). */
  caip2: string;
  /** Legacy x402 v1 network name. */
  v1Network: string;
  /** Canonical USDC mint on this cluster. */
  usdcMint: string;
  /** Query-string suffix for explorer.solana.com links ('' on mainnet). */
  explorerSuffix: string;
  /** Default public RPC. */
  defaultRpcUrl: string;
}

export const CLUSTERS: Record<Cluster, ClusterInfo> = {
  devnet: {
    caip2: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    v1Network: 'solana-devnet',
    usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    explorerSuffix: '?cluster=devnet',
    defaultRpcUrl: 'https://api.devnet.solana.com',
  },
  mainnet: {
    caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    v1Network: 'solana',
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    explorerSuffix: '',
    defaultRpcUrl: 'https://api.mainnet-beta.solana.com',
  },
};

/** All network identifiers (v1 + v2) that count as "this cluster" in a 402. */
export function networksForCluster(cluster: Cluster): string[] {
  const info = CLUSTERS[cluster];
  return [info.caip2, info.v1Network];
}

/** "$0.42" style rendering of a USDC base-unit amount. */
export function atomicToUsd(atomic: number): string {
  return `$${(atomic / 10 ** USDC_DECIMALS).toFixed(2)}`;
}

/** Dollars → USDC base units, rounded down to a whole base unit. */
export function usdToAtomic(usd: number): number {
  return Math.floor(usd * 10 ** USDC_DECIMALS);
}

/** explorer.solana.com link for a transaction signature. */
export function explorerTxUrl(signature: string, cluster: Cluster): string {
  return `https://explorer.solana.com/tx/${signature}${CLUSTERS[cluster].explorerSuffix}`;
}

/** explorer.solana.com link for an address. */
export function explorerAddressUrl(address: string, cluster: Cluster): string {
  return `https://explorer.solana.com/address/${address}${CLUSTERS[cluster].explorerSuffix}`;
}
