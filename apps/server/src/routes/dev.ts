import { Hono } from 'hono';
import { CLUSTERS } from '@htn/shared';
import { wipeDatabase } from '../db/index.ts';
import type { ServiceContext } from '../services/context.ts';
import { stationRoutes } from './station.ts';

const MOCK_PROGRAM = '11111111111111111111111111111111';

/**
 * Unauthenticated helpers for the local simulator UI. Mounted only when
 * NODE_ENV !== 'production' (see app.ts); the real station endpoints keep
 * their API key either way.
 */
export function devRoutes(ctx: ServiceContext): Hono {
  const routes = new Hono();

  routes.post('/reset', (c) => {
    wipeDatabase(ctx.db);
    ctx.live.clear();
    return c.json({ ok: true, reset: true });
  });

  routes.get('/vendor', (c) => {
    if (c.req.raw.headers.has('x-payment')) {
      return c.json({
        message: 'hello from the mock vendor',
        programId: MOCK_PROGRAM,
      });
    }

    return c.json(
      {
        x402Version: 2,
        accepts: [
          {
            scheme: 'exact',
            network: CLUSTERS[ctx.config.solanaCluster].caip2,
            amount: String(ctx.config.maxRewardAtomic),
            asset: ctx.config.usdcMint,
            payTo: MOCK_PROGRAM,
            resource: c.req.url,
            description: 'HTN mock vendor',
            maxTimeoutSeconds: 300,
          },
        ],
      },
      402,
    );
  });

  // Same sync/disconnect behaviour as a real hub, minus the API key, so the
  // simulator can drive the whole flow from the browser.
  routes.route('/', stationRoutes(ctx));

  return routes;
}
