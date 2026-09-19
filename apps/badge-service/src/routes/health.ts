import { Hono } from 'hono';
import { count } from '../db.ts';
import type { ServiceContext } from '../server.ts';

export function healthRoutes(ctx: ServiceContext): Hono {
  const routes = new Hono();
  routes.get('/health', (c) => c.json({
    ok: true,
    badgesRegistered: count(ctx.db, 'SELECT COUNT(*) AS count FROM devices'),
    badgesOnline: ctx.registry.count(),
    apps: count(ctx.db, 'SELECT COUNT(*) AS count FROM apps'),
    publicUrl: ctx.config.publicUrl,
  }));
  return routes;
}
