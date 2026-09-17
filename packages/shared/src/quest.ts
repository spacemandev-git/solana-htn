/**
 * The quest, pinned. Everything both sides must agree on — the server's payer
 * agent, the PWA, the starter kit, and the on-chain program — lives here.
 *
 * The quest: deploy the `htn_quest` Anchor program, store a message in its
 * `["quest"]` PDA, and stand up an x402-paywalled HTTP endpoint that returns
 * that message once paid. The server agent calls the endpoint exactly once,
 * pays up to 1.00 of the cluster's payment token over x402, and verifies the
 * response against the chain.
 *
 * The payment token is USDC on mainnet. On devnet it is HTN Bucks (`HTN`), a
 * plain SPL token we mint ourselves so nobody has to beg a USDC faucet; the
 * agent's wallet holds the whole supply. Both use six decimals, so "1.00" is
 * always 1_000_000 base units.
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

/** Base-unit decimals of the payment token (USDC and HTN Bucks both use 6). */
export const PAYMENT_DECIMALS = 6;

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
  /** The SPL mint the agent pays in and the starter kit charges in. */
  paymentMint: string;
  /** Ticker rendered next to amounts of `paymentMint`. */
  paymentSymbol: string;
  /** Query-string suffix for explorer.solana.com links ('' on mainnet). */
  explorerSuffix: string;
  /** Default public RPC. */
  defaultRpcUrl: string;
}

export const CLUSTERS: Record<Cluster, ClusterInfo> = {
  devnet: {
    caip2: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    v1Network: 'solana-devnet',
    // HTN Bucks: SPL Token (not 2022), 6 decimals, minted by the agent wallet.
    paymentMint: 'HTNBUCKS_MINT_PLACEHOLDER',
    paymentSymbol: 'HTN',
    explorerSuffix: '?cluster=devnet',
    defaultRpcUrl: 'https://api.devnet.solana.com',
  },
  mainnet: {
    caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    v1Network: 'solana',
    paymentMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    paymentSymbol: 'USDC',
    explorerSuffix: '',
    defaultRpcUrl: 'https://api.mainnet-beta.solana.com',
  },
};

/** All network identifiers (v1 + v2) that count as "this cluster" in a 402. */
export function networksForCluster(cluster: Cluster): string[] {
  const info = CLUSTERS[cluster];
  return [info.caip2, info.v1Network];
}

/** "0.42 HTN" style rendering of a payment-token base-unit amount. */
export function formatAtomic(atomic: number, symbol: string): string {
  return `${(atomic / 10 ** PAYMENT_DECIMALS).toFixed(2)} ${symbol}`;
}

/** Whole tokens → base units, rounded down to a whole base unit. */
export function toAtomic(units: number): number {
  return Math.floor(units * 10 ** PAYMENT_DECIMALS);
}

/** explorer.solana.com link for a transaction signature. */
export function explorerTxUrl(signature: string, cluster: Cluster): string {
  return `https://explorer.solana.com/tx/${signature}${CLUSTERS[cluster].explorerSuffix}`;
}

/** explorer.solana.com link for an address. */
export function explorerAddressUrl(address: string, cluster: Cluster): string {
  return `https://explorer.solana.com/address/${address}${CLUSTERS[cluster].explorerSuffix}`;
}
