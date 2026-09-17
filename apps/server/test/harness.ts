import { Database } from 'bun:sqlite';
import type {
  ChallengeResult,
  PaymentOutcome,
  ProgramCheckResult,
  QuestChain,
  QuestStateResult,
} from '@htn/chain';
import {
  CLUSTERS,
  type BadgeSummary,
  type BadgeView,
  type BoxResponse,
  type Cluster,
  type QuestSubmission,
} from '@htn/shared';
import { buildAppWithContext } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import type { ServiceContext } from '../src/services/context.ts';
import { getQuestSubmission } from '../src/services/quests.ts';

export const TEST_PROGRAM_ID = '11111111111111111111111111111111';
export const TEST_MESSAGE = 'hello from chain state';
export const TEST_ENDPOINT = 'https://vendor.example/quest';

export class FakeQuestChain implements QuestChain {
  readonly enabled: boolean;
  readonly cluster: Cluster;
  readonly payerAddress: string | null;

  programResult: ProgramCheckResult = {
    skipped: false,
    deployed: true,
    executable: true,
  };
  stateResult: QuestStateResult = {
    skipped: false,
    address: TEST_PROGRAM_ID,
    message: TEST_MESSAGE,
  };
  challengeResult: ChallengeResult = {
    ok: true,
    requirement: {
      scheme: 'exact',
      network: CLUSTERS.devnet.caip2,
      asset: CLUSTERS.devnet.usdcMint,
      payTo: TEST_PROGRAM_ID,
      amountAtomic: 1_000_000,
    },
  };
  paymentResult: PaymentOutcome = {
    ok: true,
    simulated: false,
    httpStatus: 200,
    signature: 'payment-signature',
    network: CLUSTERS.devnet.caip2,
    amountAtomic: 1_000_000,
    body: { message: TEST_MESSAGE, programId: TEST_PROGRAM_ID },
  };

  programHandler: ((programId: string) => Promise<ProgramCheckResult>) | null = null;
  stateHandler: ((programId: string) => Promise<QuestStateResult>) | null = null;
  challengeHandler: ((endpointUrl: string) => Promise<ChallengeResult>) | null = null;
  paymentHandler: ((endpointUrl: string) => Promise<PaymentOutcome>) | null = null;

  readonly calls = {
    checkProgram: [] as string[],
    readQuestMessage: [] as string[],
    probeChallenge: [] as string[],
    payEndpoint: [] as string[],
  };

  constructor(options: { enabled?: boolean; cluster?: Cluster; payerAddress?: string | null } = {}) {
    this.enabled = options.enabled ?? true;
    this.cluster = options.cluster ?? 'devnet';
    this.payerAddress = options.payerAddress ?? TEST_PROGRAM_ID;
  }

  checkProgram(programId: string): Promise<ProgramCheckResult> {
    this.calls.checkProgram.push(programId);
    return this.programHandler?.(programId) ?? Promise.resolve(this.programResult);
  }

  readQuestMessage(programId: string): Promise<QuestStateResult> {
    this.calls.readQuestMessage.push(programId);
    return this.stateHandler?.(programId) ?? Promise.resolve(this.stateResult);
  }

  probeChallenge(endpointUrl: string): Promise<ChallengeResult> {
    this.calls.probeChallenge.push(endpointUrl);
    return this.challengeHandler?.(endpointUrl) ?? Promise.resolve(this.challengeResult);
  }

  payEndpoint(endpointUrl: string): Promise<PaymentOutcome> {
    this.calls.payEndpoint.push(endpointUrl);
    return this.paymentHandler?.(endpointUrl) ?? Promise.resolve(this.paymentResult);
  }
}

export interface Harness {
  ctx: ServiceContext;
  chain: FakeQuestChain;
  request(path: string, init?: RequestInit): Promise<Response>;
  box(body: unknown): Promise<Response>;
  post(path: string, body: unknown): Promise<Response>;
  close(): void;
}

export function createHarness(chain = new FakeQuestChain()): Harness {
  const db = new Database(':memory:');
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    PUBLIC_APP_URL: 'http://localhost:5173',
    PWA_ORIGIN: 'http://localhost:5173',
    SOLANA_CLUSTER: chain.cluster,
    SOLANA_BOX_ID: 'solana-booth',
    MAX_REWARD_USD: '1',
  });

  const { app, ctx } = buildAppWithContext({ db, chain, config });
  const request = async (path: string, init?: RequestInit): Promise<Response> =>
    app.request(path, init);
  const post = (path: string, body: unknown): Promise<Response> =>
    request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  return {
    ctx,
    chain,
    request,
    box: (body) => post('/api/box', body),
    post,
    close: () => db.close(),
  };
}

export function boxBody(
  userId: string,
  box: string,
  overrides: { name?: string; email?: string; public_key?: string } = {},
) {
  return {
    box,
    user_id: userId,
    name: overrides.name ?? `Hacker ${userId}`,
    email: overrides.email ?? `${userId}@example.com`,
    public_key: overrides.public_key ?? '',
  };
}

export function questBody(pairingCode: string) {
  return { pairingCode, endpointUrl: TEST_ENDPOINT, programId: TEST_PROGRAM_ID };
}

export async function waitForQuest(
  h: Harness,
  badgeId: string,
  predicate: (submission: QuestSubmission) => boolean = (submission) =>
    submission.status !== 'verifying',
): Promise<QuestSubmission> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const submission = getQuestSubmission(h.ctx.db, badgeId);
    if (submission && predicate(submission)) return submission;
    await Promise.resolve();
  }
  throw new Error(`quest for ${badgeId} did not reach the expected state`);
}

export async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export type { BadgeSummary, BadgeView, BoxResponse };
