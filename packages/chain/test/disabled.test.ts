import { expect, test } from 'bun:test';
import { CLUSTERS } from '@htn/shared';

import { createQuestChain } from '../src/factory.ts';

test('disabled client probes normally and pays once with a simulated header', async () => {
  let paidRequests = 0;
  let simulatedPayload: unknown = null;
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const payment = request.headers.get('X-PAYMENT');
      if (payment === null) {
        return Response.json(
          {
            x402Version: 2,
            accepts: [
              {
                scheme: 'exact',
                network: CLUSTERS.devnet.caip2,
                asset: CLUSTERS.devnet.usdcMint,
                payTo: 'vendor-wallet',
                amount: '750000',
              },
            ],
          },
          { status: 402 },
        );
      }

      paidRequests += 1;
      simulatedPayload = JSON.parse(Buffer.from(payment, 'base64').toString('utf8')) as unknown;
      return Response.json({ message: 'paid quest' });
    },
  });

  try {
    const chain = await createQuestChain({
      cluster: 'devnet',
      usdcMint: CLUSTERS.devnet.usdcMint,
      maxPaymentAtomic: 1_000_000,
    });
    expect(chain.enabled).toBe(false);
    expect(chain.payerAddress).toBeNull();

    const endpoint = new URL('/vendor', server.url).toString();
    const challenge = await chain.probeChallenge(endpoint);
    expect(challenge.ok).toBe(true);
    expect(challenge.requirement?.amountAtomic).toBe(750_000);

    const outcome = await chain.payEndpoint(endpoint);
    expect(outcome).toMatchObject({
      ok: true,
      simulated: true,
      httpStatus: 200,
      signature: null,
      network: null,
      amountAtomic: null,
      body: { message: 'paid quest' },
    });
    expect(paidRequests).toBe(1);
    expect(simulatedPayload).toEqual({ x402Version: 2, simulated: true });

    expect(await chain.checkProgram('not-a-program')).toEqual({
      skipped: true,
      deployed: false,
      executable: false,
    });
    expect(await chain.readQuestMessage('not-a-program')).toEqual({
      skipped: true,
      address: null,
      message: null,
    });
  } finally {
    server.stop(true);
  }
});
