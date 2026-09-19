import { Hono } from 'hono';
import { AppSubmitRequest } from '@htn/shared';
import { all, one, run, toApp, type AppRow } from '../db.ts';
import { HttpError, parseJson } from '../http.ts';
import { mintAppId } from '../ids.ts';
import type { ServiceContext } from '../server.ts';

export function appsRoutes(ctx: ServiceContext): Hono {
  const routes = new Hono();

  routes.get('/apps', (c) => {
    const rows = all<AppRow>(ctx.db, 'SELECT * FROM apps ORDER BY created_at DESC, rowid DESC');
    return c.json({ apps: rows.map(toApp) });
  });

  routes.post('/apps', async (c) => {
    const body = await parseJson(c, AppSubmitRequest);
    const forwarded = c.req.header('x-forwarded-for');
    const ip = forwarded?.split(',')[0]?.trim() || 'local';
    if (!ctx.limits.takeSubmission(ip)) throw new HttpError(429, 'rate_limited');
    const appId = mintAppId(ctx.db);
    const createdAt = new Date().toISOString();
    run(ctx.db,
      'INSERT INTO apps (app_id, name, description, url, author, source_url, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      appId, body.name, body.description, body.url, body.author, body.sourceUrl ?? null, body.kind, createdAt);
    const row = one<AppRow>(ctx.db, 'SELECT * FROM apps WHERE app_id = ?', appId);
    if (!row) throw new Error('inserted app was not found');
    return c.json({ app: toApp(row) });
  });

  routes.delete('/apps/:appId', (c) => {
    if (!ctx.config.adminToken) throw new HttpError(404, 'not_found');
    if (c.req.header('authorization') !== `Bearer ${ctx.config.adminToken}`) {
      throw new HttpError(403, 'forbidden');
    }
    const appId = c.req.param('appId');
    if (!one(ctx.db, 'SELECT 1 FROM apps WHERE app_id = ?', appId)) {
      throw new HttpError(404, 'app_not_found');
    }
    run(ctx.db, 'DELETE FROM apps WHERE app_id = ?', appId);
    return c.json({ ok: true });
  });

  return routes;
}
