import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CLUSTERS } from '@htn/shared';
import { createHarness, json, type Harness } from './harness.ts';

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

afterEach(() => {
  h.close();
});

describe('mock x402 vendor', () => {
  test('returns the exact challenge shape without payment', async () => {
    const response = await h.request('/api/dev/vendor');
    expect(response.status).toBe(402);
    expect(await json<unknown>(response)).toEqual({
      x402Version: 2,
      accepts: [
        {
          scheme: 'exact',
          network: CLUSTERS.devnet.caip2,
          amount: '1000000',
          asset: CLUSTERS.devnet.usdcMint,
          payTo: '11111111111111111111111111111111',
          resource: 'http://localhost/api/dev/vendor',
          description: 'HTN mock vendor',
          maxTimeoutSeconds: 300,
        },
      ],
    });
  });

  test('returns the proof body with any X-PAYMENT header', async () => {
    const response = await h.request('/api/dev/vendor', {
      headers: { 'X-PAYMENT': 'simulated-payment' },
    });
    expect(response.status).toBe(200);
    expect(await json<unknown>(response)).toEqual({
      message: 'hello from the mock vendor',
      programId: '11111111111111111111111111111111',
    });
  });
});
