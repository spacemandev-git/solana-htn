import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ApiError, Badge, BadgeSummary, LiveEvent, QuestStep, QuestSubmission } from '@htn/shared';
import {
  boxBody,
  createHarness,
  json,
  questBody,
  TEST_MESSAGE,
  waitForQuest,
  type Harness,
} from './harness.ts';

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

afterEach(() => {
  h.close();
});

async function pair(badgeId: string): Promise<Badge> {
  await h.box(boxBody(badgeId, `regular-${badgeId}`));
  const summaries = await json<BadgeSummary[]>(await h.request('/api/badges'));
  return summaries.find((summary) => summary.badge.badgeId === badgeId)!.badge;
}

async function errorCode(response: Response): Promise<string> {
  return (await json<ApiError>(response)).error;
}

describe('quest submission credential and state rules', () => {
  test('rejects an unknown pairing code', async () => {
    const response = await h.post('/api/quest/submit', questBody('ZZZZZZ'));
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('badge_not_found');
  });

  test('returns 202 immediately and rejects a concurrent verifying submission', async () => {
    const synced = await pair('badge-running');
    h.chain.programHandler = () => new Promise(() => {});

    const first = await h.post('/api/quest/submit', questBody(synced.pairingCode));
    expect(first.status).toBe(202);
    expect((await json<{ submission: QuestSubmission }>(first)).submission.status).toBe(
      'verifying',
    );

    const second = await h.post('/api/quest/submit', questBody(synced.pairingCode));
    expect(second.status).toBe(409);
    expect(await errorCode(second)).toBe('quest_verifying');
    expect(h.chain.calls.checkProgram).toHaveLength(1);
  });

  test('rejects another submission after completion', async () => {
    const synced = await pair('badge-complete');
    await h.post('/api/quest/submit', questBody(synced.pairingCode));
    await waitForQuest(h, 'badge-complete');

    const response = await h.post('/api/quest/submit', questBody(synced.pairingCode));
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('quest_already_completed');
  });

  test('allows an unpaid failed submission to be replaced', async () => {
    const synced = await pair('badge-retry');
    h.chain.programResult = {
      skipped: false,
      deployed: false,
      executable: false,
      error: 'not deployed',
    };
    await h.post('/api/quest/submit', questBody(synced.pairingCode));
    expect((await waitForQuest(h, 'badge-retry')).paid).toBe(false);

    h.chain.programResult = { skipped: false, deployed: true, executable: true };
    const response = await h.post('/api/quest/submit', {
      ...questBody(synced.pairingCode),
      endpointUrl: 'https://vendor.example/retry',
    });
    expect(response.status).toBe(202);
    const completed = await waitForQuest(h, 'badge-retry');
    expect(completed.status).toBe('completed');
    expect(completed.endpointUrl).toBe('https://vendor.example/retry');
    expect(h.chain.calls.checkProgram).toHaveLength(2);
  });
});

describe('verification pipeline', () => {
  test('publishes the exact successful progress/result/state sequence', async () => {
    const synced = await pair('badge-success');
    const events: LiveEvent[] = [];
    const unsubscribe = h.ctx.live.subscribe(synced.pairingCode, (event) => events.push(event));

    const response = await h.post('/api/quest/submit', questBody(synced.pairingCode));
    expect(response.status).toBe(202);
    const completed = await waitForQuest(h, 'badge-success');
    unsubscribe();

    expect(completed).toMatchObject({
      status: 'completed',
      step: null,
      error: null,
      message: TEST_MESSAGE,
      amountPaidAtomic: 1_000_000,
      paymentSignature: 'payment-signature',
      paid: true,
    });
    expect(h.chain.calls).toEqual({
      checkProgram: ['11111111111111111111111111111111'],
      readQuestMessage: ['11111111111111111111111111111111'],
      probeChallenge: ['https://vendor.example/quest'],
      payEndpoint: ['https://vendor.example/quest'],
    });

    const sequence = events.map((event) => {
      if (event.type === 'quest-progress') {
        return {
          type: event.type,
          badgeId: event.badgeId,
          step: event.step,
          status: event.status,
          ...(event.detail === undefined ? {} : { detail: event.detail }),
        };
      }
      if (event.type === 'quest-result') {
        return { type: event.type, status: event.submission.status };
      }
      if (event.type === 'state') {
        return { type: event.type, status: event.view.quest?.status };
      }
      return { type: event.type };
    });
    expect(sequence).toEqual([
      {
        type: 'quest-progress',
        badgeId: 'badge-success',
        step: 'program',
        status: 'running',
      },
      { type: 'quest-progress', badgeId: 'badge-success', step: 'program', status: 'ok' },
      {
        type: 'quest-progress',
        badgeId: 'badge-success',
        step: 'state',
        status: 'running',
      },
      { type: 'quest-progress', badgeId: 'badge-success', step: 'state', status: 'ok' },
      {
        type: 'quest-progress',
        badgeId: 'badge-success',
        step: 'challenge',
        status: 'running',
      },
      {
        type: 'quest-progress',
        badgeId: 'badge-success',
        step: 'challenge',
        status: 'ok',
        detail: '$1.00 to 11111111111111111111111111111111',
      },
      {
        type: 'quest-progress',
        badgeId: 'badge-success',
        step: 'payment',
        status: 'running',
      },
      { type: 'quest-progress', badgeId: 'badge-success', step: 'payment', status: 'ok' },
      {
        type: 'quest-progress',
        badgeId: 'badge-success',
        step: 'proof',
        status: 'running',
      },
      { type: 'quest-progress', badgeId: 'badge-success', step: 'proof', status: 'ok' },
      { type: 'quest-result', status: 'completed' },
      { type: 'state', status: 'completed' },
    ]);
  });

  const failures: {
    name: string;
    step: QuestStep;
    error: string;
    configure: (harness: Harness) => void;
  }[] = [
    {
      name: 'program',
      step: 'program',
      error: 'program check failed',
      configure: (harness) => {
        harness.chain.programResult = {
          skipped: false,
          deployed: false,
          executable: false,
          error: 'program check failed',
        };
      },
    },
    {
      name: 'state',
      step: 'state',
      error: 'state missing',
      configure: (harness) => {
        harness.chain.stateResult = {
          skipped: false,
          address: null,
          message: null,
          error: 'state missing',
        };
      },
    },
    {
      name: 'challenge',
      step: 'challenge',
      error: 'bad challenge',
      configure: (harness) => {
        harness.chain.challengeResult = {
          ok: false,
          requirement: null,
          error: 'bad challenge',
        };
      },
    },
    {
      name: 'payment',
      step: 'payment',
      error: 'payment rejected',
      configure: (harness) => {
        harness.chain.paymentResult = {
          ok: false,
          simulated: false,
          httpStatus: 402,
          signature: null,
          network: null,
          amountAtomic: null,
          body: null,
          error: 'payment rejected',
        };
      },
    },
    {
      name: 'proof',
      step: 'proof',
      error: 'endpoint returned an invalid quest proof',
      configure: (harness) => {
        harness.chain.paymentResult = { ...harness.chain.paymentResult, body: { nope: true } };
      },
    },
  ];

  for (const failure of failures) {
    test(`${failure.name} failure persists its step and error`, async () => {
      const synced = await pair(`badge-fail-${failure.name}`);
      failure.configure(h);
      const events: LiveEvent[] = [];
      const unsubscribe = h.ctx.live.subscribe(synced.pairingCode, (event) => events.push(event));

      await h.post('/api/quest/submit', questBody(synced.pairingCode));
      const failed = await waitForQuest(h, `badge-fail-${failure.name}`);
      unsubscribe();

      expect(failed).toMatchObject({
        status: 'failed',
        step: failure.step,
        error: failure.error,
      });
      const tail = events.slice(-3);
      expect(tail[0]).toMatchObject({
        type: 'quest-progress',
        step: failure.step,
        status: 'fail',
        detail: failure.error,
      });
      expect(tail[1]).toMatchObject({ type: 'quest-result' });
      expect(tail[2]).toMatchObject({ type: 'state' });
    });
  }

  test('records a real payment before proof failure and permanently blocks resubmission', async () => {
    const synced = await pair('badge-paid-proof-fail');
    h.chain.paymentResult = {
      ...h.chain.paymentResult,
      body: { message: 'a different message' },
    };
    const observation = { paidAtProofStart: false };
    const unsubscribe = h.ctx.live.subscribe(synced.pairingCode, (event) => {
      if (event.type === 'quest-progress' && event.step === 'proof' && event.status === 'running') {
        const row = h.ctx.db
          .query('SELECT paid FROM quest_submissions WHERE badge_id = ?')
          .get('badge-paid-proof-fail') as { paid: number } | null;
        observation.paidAtProofStart = row?.paid === 1;
      }
    });

    await h.post('/api/quest/submit', questBody(synced.pairingCode));
    const failed = await waitForQuest(h, 'badge-paid-proof-fail');
    unsubscribe();

    expect(observation.paidAtProofStart).toBe(true);
    expect(failed).toMatchObject({
      status: 'failed',
      step: 'proof',
      error: 'endpoint returned a different message than the chain',
      paid: true,
      paymentSignature: 'payment-signature',
    });

    const response = await h.post('/api/quest/submit', questBody(synced.pairingCode));
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('quest_already_paid');
    expect(h.chain.calls.payEndpoint).toHaveLength(1);
  });

  test('a failed payment carrying a signature is recorded as paid', async () => {
    const synced = await pair('badge-signed-payment-fail');
    h.chain.paymentResult = {
      ok: false,
      simulated: false,
      httpStatus: 500,
      signature: 'settled-before-http-failure',
      network: 'solana:test-network',
      amountAtomic: 250_000,
      body: null,
      error: 'paid response was unusable',
    };

    await h.post('/api/quest/submit', questBody(synced.pairingCode));
    const failed = await waitForQuest(h, 'badge-signed-payment-fail');

    expect(failed).toMatchObject({
      status: 'failed',
      step: 'payment',
      error: 'paid response was unusable',
      paid: true,
      amountPaidAtomic: 250_000,
      paymentSignature: 'settled-before-http-failure',
      network: 'solana:test-network',
    });
  });
});
