import type { Cluster } from '@htn/shared';

/**
 * FROZEN CONTRACT — the server codes against exactly this surface.
 *
 * Two implementations ship: a live one (x402 payer + Solana RPC reads) and a
 * disabled one used when no payer key is configured. The server must work end
 * to end with the disabled client so the badge + PWA loop can be demoed with
 * no chain and no money.
 */

export interface QuestChainConfig {
  cluster: Cluster;
  /** Defaults to the cluster's public RPC when omitted. */
  rpcUrl?: string | undefined;
  /** base58-encoded 64-byte secret key of the paying agent. Absent → disabled. */
  payerSecretKey?: string | undefined;
  /** The only asset the agent will pay in. */
  usdcMint: string;
  /** Hard ceiling per payment AND per badge, in USDC base units. */
  maxPaymentAtomic: number;
}

/** Result of checking that the hacker's program is actually deployed. */
export interface ProgramCheckResult {
  /** True when the chain is disabled and the check did not really run. */
  skipped: boolean;
  deployed: boolean;
  executable: boolean;
  error?: string;
}

/** Result of reading the `["quest"]` PDA owned by the hacker's program. */
export interface QuestStateResult {
  skipped: boolean;
  /** The PDA address, when derivable. */
  address: string | null;
  /** The borsh string stored at QUEST_MESSAGE_OFFSET, when readable. */
  message: string | null;
  error?: string;
}

/** The single accepted payment option extracted from a 402 challenge. */
export interface ChallengeRequirement {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  amountAtomic: number;
  description?: string;
}

export interface ChallengeResult {
  ok: boolean;
  /** The requirement that passed validation (right cluster, USDC, under cap). */
  requirement: ChallengeRequirement | null;
  error?: string;
}

export interface PaymentOutcome {
  ok: boolean;
  /** True when the chain is disabled and no real money moved. */
  simulated: boolean;
  httpStatus: number;
  /** Settlement signature from X-PAYMENT-RESPONSE, when the facilitator returned one. */
  signature: string | null;
  network: string | null;
  amountAtomic: number | null;
  /** Parsed JSON body of the paid response; null if it was not JSON. */
  body: unknown;
  error?: string;
}

export interface QuestChain {
  /** False for the disabled client. The server surfaces this in /api/health. */
  readonly enabled: boolean;
  readonly cluster: Cluster;
  /** The paying agent's public address; null when disabled. */
  readonly payerAddress: string | null;
  /** Is `programId` a live, executable program on the cluster? */
  checkProgram(programId: string): Promise<ProgramCheckResult>;
  /** Read the message out of PDA(["quest"], programId). */
  readQuestMessage(programId: string): Promise<QuestStateResult>;
  /**
   * GET the endpoint expecting a 402, and validate the challenge: exact
   * scheme, this cluster's network id (v1 or CAIP-2), the configured USDC
   * mint, and an amount within the cap. Never pays. Works even when disabled.
   */
  probeChallenge(endpointUrl: string): Promise<ChallengeResult>;
  /**
   * Pay the endpoint once over x402 and return the settled outcome. The cap
   * is enforced again here, independently of probeChallenge. When disabled,
   * sends a simulated X-PAYMENT header instead of real money (the dev mock
   * vendor accepts it; real endpoints will reject it, which is correct).
   */
  payEndpoint(endpointUrl: string): Promise<PaymentOutcome>;
}
