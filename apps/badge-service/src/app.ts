import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ApiError } from '@htn/shared';
import { HttpError } from './http.ts';
import { appsRoutes } from './routes/apps.ts';
import { badgeRoutes } from './routes/badges.ts';
import { healthRoutes } from './routes/health.ts';
import type { ServiceContext } from './server.ts';

export function buildApp(ctx: ServiceContext): Hono {
  const app = new Hono();
  app.use('*', cors({
    origin: ctx.config.corsOrigins,
    allowHeaders: ['content-type', 'x-badge-key', 'authorization'],
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  }));
  app.route('/v1', healthRoutes(ctx));
  app.route('/v1', badgeRoutes(ctx));
  app.route('/v1', appsRoutes(ctx));
  app.notFound((c) => c.json<ApiError>({ error: 'not_found', detail: c.req.path }, 404));
  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json(error.toApiError(), error.status);
    console.error('[badge] unhandled error', error);
    return c.json<ApiError>({ error: 'internal_error', detail: 'unexpected server error' }, 500);
  });
  return app;
}
