import type { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ChainClient } from '@htn/chain';
import type { ApiError } from '@htn/shared';
import { stationAuth } from './auth.ts';
import type { ServerConfig } from './config.ts';
import { migrate } from './db/index.ts';
import { HttpError } from './http.ts';
import { LiveHub } from './live.ts';
import { adminRoutes } from './routes/admin.ts';
import { devRoutes } from './routes/dev.ts';
import { sessionRoutes } from './routes/session.ts';
import { stationRoutes } from './routes/station.ts';
import { vaultRoutes } from './routes/vault.ts';
import type { ServiceContext } from './services/context.ts';

export interface AppDeps {
  db: Database;
  chain: ChainClient;
  config: ServerConfig;
  /** Supply your own to observe pushes in tests. */
  live?: LiveHub;
}

export interface App {
  app: Hono;
  ctx: ServiceContext;
}

/** Wires the routes onto a Hono app. Tests import this directly — no socket needed. */
export function buildApp(deps: AppDeps): Hono {
  return buildAppWithContext(deps).app;
}

export function buildAppWithContext(deps: AppDeps): App {
  // Idempotent, so callers may hand over a bare `new Database(':memory:')`.
  migrate(deps.db);

  const ctx: ServiceContext = {
    db: deps.db,
    chain: deps.chain,
    config: deps.config,
    live: deps.live ?? new LiveHub(),
  };

  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: ctx.config.pwaOrigin,
      credentials: true,
      allowHeaders: ['content-type', 'x-station-key'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
    }),
  );

  // Station endpoints are the only authenticated surface.
  app.use('/api/station/*', stationAuth(ctx.config.stationApiKey));
  app.route('/api/station', stationRoutes(ctx));

  app.route('/api/session', sessionRoutes(ctx));
  app.route('/api/vault', vaultRoutes(ctx));
  app.route('/api', adminRoutes(ctx));

  if (ctx.config.devRoutesEnabled) {
    app.route('/api/dev', devRoutes(ctx));
  }

  app.notFound((c) => c.json<ApiError>({ error: 'not_found', detail: c.req.path }, 404));

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json(err.toApiError(), err.status);
    }
    console.error('[server] unhandled error', err);
    return c.json<ApiError>({ error: 'internal_error', detail: 'unexpected server error' }, 500);
  });

  return { app, ctx };
}
