import type { Cluster, QuestStep } from './quest.ts';

/**
 * A hacker's badge. `badgeId` is the HTN attendee id the relay sends as
 * `user_id`, falling back to the wallet public key when that is empty.
 */
export interface Badge {
  badgeId: string;
  name: string;
  email: string;
  /** base58 ed25519 wallet burned into the badge. Empty when the badge sent none. */
  publicKey: string;
  /** The badge's permanent pairing code; the quest console lives at /s/<code>. */
  pairingCode: string;
  createdAt: string;
  lastSeenAt: string;
}

/** One item a badge has won, and the box that handed it out. */
export interface Award {
  badgeId: string;
  item: string;
  box: string;
  awardedAt: string;
}

export type QuestStatus = 'verifying' | 'completed' | 'failed';

/**
 * One badge's quest run. A badge has at most one submission; resubmitting
 * before completion overwrites it and restarts verification.
 */
export interface QuestSubmission {
  badgeId: string;
  /** The hacker's x402-paywalled endpoint. */
  endpointUrl: string;
  /** The hacker's deployed program (base58). */
  programId: string;
  status: QuestStatus;
  /** Step currently running, or the step that failed. Null before any ran. */
  step: QuestStep | null;
  /** Human-readable failure, when status === 'failed'. */
  error: string | null;
  /** The message read from the quest PDA, once the `state` step passed. */
  message: string | null;
  /** USDC base units actually paid, once payment settled. */
  amountPaidAtomic: number | null;
  /** Settlement transaction signature, null while unpaid or simulated. */
  paymentSignature: string | null;
  /** Network id the payment settled on. */
  network: string | null;
  /** True once a payment has settled for this badge — the server never pays twice. */
  paid: boolean;
  submittedAt: string;
  completedAt: string | null;
}

/** Quest environment the PWA needs to render instructions and links. */
export interface QuestEnv {
  /** False when the server has no payer key: payments are simulated. */
  chainEnabled: boolean;
  cluster: Cluster;
  /** CAIP-2 network id of the cluster. */
  network: string;
  usdcMint: string;
  /** The reward ceiling, in USDC base units. */
  maxRewardAtomic: number;
  /** The server agent's paying address, so hackers can pre-fund checks. Null when disabled. */
  payerAddress: string | null;
  /** The `box` id of the Solana station, so the PWA can label it. */
  solanaBoxId: string;
}

/** Everything the one-page console renders for a badge. */
export interface BadgeView {
  badge: Badge;
  /** Every item won so far, oldest first. */
  awards: Award[];
  quest: QuestSubmission | null;
  env: QuestEnv;
}

/** Aggregate row for the operator/simulator dashboard. */
export interface BadgeSummary {
  badge: Badge;
  /** Item ids won so far, oldest first. */
  items: string[];
  quest: QuestSubmission | null;
}

/** Server -> PWA push events over SSE. */
export type LiveEvent =
  | { type: 'state'; view: BadgeView }
  | {
      type: 'quest-progress';
      badgeId: string;
      step: QuestStep;
      status: 'running' | 'ok' | 'fail';
      detail?: string;
    }
  | { type: 'quest-result'; submission: QuestSubmission }
  | { type: 'ping' };
