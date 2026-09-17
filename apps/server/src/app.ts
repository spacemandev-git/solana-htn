import type { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { QuestChain } from '@htn/chain';
import type { ApiError } from '@htn/shared';
import type { ServerConfig } from './config.ts';
import { migrate } from './db/index.ts';
import { HttpError } from './http.ts';
import { LiveHub } from './live.ts';
import { adminRoutes } from './routes/admin.ts';
import { badgeRoutes } from './routes/badge.ts';
import { boxRoutes } from './routes/box.ts';
import { devRoutes } from './routes/dev.ts';
import { questRoutes } from './routes/quest.ts';
import type { ServiceContext } from './services/context.ts';

export interface AppDeps {
  db: Database;
  chain: QuestChain;
  config: ServerConfig;
  live?: LiveHub;
}

export interface App {
  app: Hono;
  ctx: ServiceContext;
}

export function buildApp(deps: AppDeps): Hono {
  return buildAppWithContext(deps).app;
}

export function buildAppWithContext(deps: AppDeps): App {
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
      allowHeaders: ['content-type', 'x-payment'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
    }),
  );

  app.route('/api/box', boxRoutes(ctx));
  app.route('/api/badge', badgeRoutes(ctx));
  app.route('/api/quest', questRoutes(ctx));
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
