import { Hono } from 'hono';
import { wipeDatabase } from '../db/index.ts';
import type { ServiceContext } from '../services/context.ts';
import { stationRoutes } from './station.ts';

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

  // Same sync/disconnect behaviour as a real hub, minus the API key, so the
  // simulator can drive the whole flow from the browser.
  routes.route('/', stationRoutes(ctx));

  return routes;
}
