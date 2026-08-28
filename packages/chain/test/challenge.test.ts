import { describe, expect, test } from 'bun:test';
import { CLUSTERS } from '@htn/shared';

import {
  parseChallengeResponse,
  validateChallengeEnvelope,
} from '../src/challenge.ts';

const config = {
  cluster: 'devnet' as const,
  usdcMint: CLUSTERS.devnet.usdcMint,
  maxPaymentAtomic: 1_000_000,
};

function requirement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scheme: 'exact',
    network: CLUSTERS.devnet.caip2,
    asset: CLUSTERS.devnet.usdcMint,
    payTo: 'vendor-wallet',
    amount: '420000',
    description: 'quest message',
    ...overrides,
  };
}

describe('x402 challenge validation', () => {
  test('accepts a v2 body amount', () => {
    const result = validateChallengeEnvelope(
      { x402Version: 2, accepts: [requirement()] },
      config,
    );
    expect(result).toEqual({
      ok: true,
      requirement: {
        scheme: 'exact',
        network: CLUSTERS.devnet.caip2,
        asset: CLUSTERS.devnet.usdcMint,
        payTo: 'vendor-wallet',
        amountAtomic: 420_000,
        description: 'quest message',
      },
    });
  });

  test('accepts a v1 numeric maxAmountRequired', () => {
    const entry = requirement({
      network: CLUSTERS.devnet.v1Network,
      amount: undefined,
      maxAmountRequired: 500_000,
    });
    const result = validateChallengeEnvelope({ x402Version: 1, accepts: [entry] }, config);
    expect(result.ok).toBe(true);
    expect(result.requirement?.amountAtomic).toBe(500_000);
    expect(result.requirement?.network).toBe(CLUSTERS.devnet.v1Network);
  });

  test('falls back to a header-only envelope', async () => {
    const envelope = { x402Version: 2, accepts: [requirement()] };
    const encoded = Buffer.from(JSON.stringify(envelope)).toString('base64');
    const response = new Response('', {
      status: 402,
      headers: { 'PAYMENT-REQUIRED': encoded },
    });
    expect((await parseChallengeResponse(response, config)).ok).toBe(true);
  });

  test('rejects the wrong network and names the allowed identifiers', () => {
    const result = validateChallengeEnvelope(
      { accepts: [requirement({ network: CLUSTERS.mainnet.caip2 })] },
      config,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain(CLUSTERS.devnet.caip2);
    expect(result.error).toContain(CLUSTERS.devnet.v1Network);
  });

  test('rejects the wrong asset', () => {
    const result = validateChallengeEnvelope(
      { accepts: [requirement({ asset: CLUSTERS.mainnet.usdcMint })] },
      config,
    );
    expect(result).toMatchObject({ ok: false, requirement: null });
    expect(result.error).toContain(CLUSTERS.devnet.usdcMint);
  });

  test('rejects an over-cap amount precisely', () => {
    const result = validateChallengeEnvelope(
      { accepts: [requirement({ amount: '2000000' })] },
      config,
    );
    expect(result.error).toBe('asks 2000000 base units, cap is 1000000');
  });

  test('rejects a non-402 response', async () => {
    const response = Response.json({ accepts: [requirement()] }, { status: 200 });
    expect(await parseChallengeResponse(response, config)).toEqual({
      ok: false,
      requirement: null,
      error: 'expected 402, got 200',
    });
  });

  test('returns malformed JSON instead of throwing', async () => {
    const response = new Response('{not-json', { status: 402 });
    const result = await parseChallengeResponse(response, config);
    expect(result.ok).toBe(false);
    expect(result.error).toStartWith('malformed challenge JSON:');
  });
});
