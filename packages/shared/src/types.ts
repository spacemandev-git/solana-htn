import type { Cluster, QuestStep } from './quest.ts';

/** A hacker's badge. The `badgeId` is the id burned into the ESP32-C3. */
export interface Badge {
  badgeId: string;
  name: string;
  email: string;
  createdAt: string;
}

/** A beacon: an ESP32 hub that badges announce themselves to over ESP-NOW. */
export interface Station {
  stationId: string;
  name: string;
  lastSeenAt: string | null;
}

/**
 * A live pairing between a badge and a beacon. Created when a beacon POSTs a
 * sync, ended when it POSTs a disconnect (hacker walked away).
 */
export interface Session {
  pairingCode: string;
  badgeId: string;
  stationId: string;
  startedAt: string;
  endedAt: string | null;
  active: boolean;
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
}

/** Everything the PWA renders for a paired hacker. */
export interface SessionView {
  session: Session;
  badge: Badge;
  station: Station;
  quest: QuestSubmission | null;
  env: QuestEnv;
}

/** Aggregate row for the operator/simulator dashboard. */
export interface BadgeSummary {
  badge: Badge;
  activeSession: Session | null;
  quest: QuestSubmission | null;
}

/** Server -> PWA push events over SSE. */
export type LiveEvent =
  | { type: 'state'; view: SessionView }
  | {
      type: 'quest-progress';
      badgeId: string;
      step: QuestStep;
      status: 'running' | 'ok' | 'fail';
      detail?: string;
    }
  | { type: 'quest-result'; submission: QuestSubmission }
  | { type: 'disconnected'; at: string }
  | { type: 'ping' };
