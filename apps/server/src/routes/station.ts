import { Hono } from 'hono';
import { DisconnectRequest, SyncRequest } from '@htn/shared';
import { parseJson } from '../http.ts';
import type { ServiceContext } from '../services/context.ts';
import { handleDisconnect, handleSync } from '../services/sync.ts';

/**
 * Sync Station endpoints. Mounted twice: under /api/station (API key required)
 * and, outside production, under /api/dev for the simulator UI.
 */
export function stationRoutes(ctx: ServiceContext): Hono {
  const routes = new Hono();

  routes.post('/sync', async (c) => {
    const request = await parseJson(c, SyncRequest);
    return c.json(await handleSync(ctx, request));
  });

  routes.post('/disconnect', async (c) => {
    const request = await parseJson(c, DisconnectRequest);
    const result = handleDisconnect(ctx, request);
    return c.json({
      ended: result.ended,
      pairingCode: result.session?.pairingCode ?? null,
    });
  });

  return routes;
}
