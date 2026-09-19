import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  AccelStreamRequest,
  ClearRequest,
  ImageRequest,
  LedsRequest,
  NfcRequest,
  RectRequest,
  TextRequest,
} from '@htn/shared';
import { one, toBadgeStatus, type DeviceRow } from '../db.ts';
import { HttpError, parseJson } from '../http.ts';
import { decodeBase64Image, ImageError } from '../image.ts';
import type { ServiceContext } from '../server.ts';

function key(c: { req: { header(name: string): string | undefined; query(name: string): string | undefined } }): string {
  return c.req.header('x-badge-key') ?? c.req.query('key') ?? '';
}

function invalidIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((issue) => `${issue.path.join('.') || '(request)'}: ${issue.message}`).join('; ');
}

export function badgeRoutes(ctx: ServiceContext): Hono {
  const routes = new Hono();

  routes.get('/badges/:id', (c) => {
    const badgeId = c.req.param('id');
    const row = one<DeviceRow>(ctx.db, 'SELECT * FROM devices WHERE badge_id = ?', badgeId);
    if (!row) throw new HttpError(404, 'badge_not_found');
    const live = ctx.registry.get(badgeId);
    return c.json(toBadgeStatus(row, live !== null, live?.mode ?? null));
  });

  routes.post('/badges/:id/clear', async (c) => {
    await ctx.commands.clear(c.req.param('id'), key(c), await parseJson(c, ClearRequest));
    return c.json({ ok: true });
  });
  routes.post('/badges/:id/text', async (c) => {
    await ctx.commands.text(c.req.param('id'), key(c), await parseJson(c, TextRequest));
    return c.json({ ok: true });
  });
  routes.post('/badges/:id/rect', async (c) => {
    await ctx.commands.rect(c.req.param('id'), key(c), await parseJson(c, RectRequest));
    return c.json({ ok: true });
  });
  routes.post('/badges/:id/leds', async (c) => {
    await ctx.commands.leds(c.req.param('id'), key(c), await parseJson(c, LedsRequest));
    return c.json({ ok: true });
  });
  routes.get('/badges/:id/buttons', async (c) =>
    c.json({ buttons: await ctx.commands.buttons(c.req.param('id'), key(c)) }));
  routes.get('/badges/:id/accel', async (c) =>
    c.json(await ctx.commands.accel(c.req.param('id'), key(c))));
  routes.post('/badges/:id/accel/stream', async (c) => {
    await ctx.commands.accelStream(c.req.param('id'), key(c), await parseJson(c, AccelStreamRequest));
    return c.json({ ok: true });
  });
  routes.post('/badges/:id/nfc', async (c) =>
    c.json(await ctx.commands.nfc(c.req.param('id'), key(c), await parseJson(c, NfcRequest))));
  routes.get('/badges/:id/info', async (c) =>
    c.json(await ctx.commands.info(c.req.param('id'), key(c))));
  routes.post('/badges/:id/home', async (c) => {
    await ctx.commands.home(c.req.param('id'), key(c));
    return c.json({ ok: true });
  });

  routes.post('/badges/:id/image', async (c) => {
    const contentType = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    let bytes: Uint8Array;
    let options: { x: number; y: number; fit: 'contain' | 'none' };
    if (contentType === 'application/json') {
      const body = await parseJson(c, ImageRequest);
      try { bytes = decodeBase64Image(body.image); }
      catch (error) {
        if (error instanceof ImageError) throw new HttpError(400, error.code);
        throw error;
      }
      options = body;
    } else if (contentType === 'image/png' || contentType === 'image/jpeg') {
      const raw: Record<string, unknown> = {};
      const x = c.req.query('x');
      const y = c.req.query('y');
      const fit = c.req.query('fit');
      if (x !== undefined) raw.x = Number(x);
      if (y !== undefined) raw.y = Number(y);
      if (fit !== undefined) raw.fit = fit;
      const parsed = ImageRequest.omit({ image: true }).safeParse(raw);
      if (!parsed.success) throw new HttpError(400, 'invalid_request', invalidIssues(parsed.error.issues));
      options = parsed.data;
      bytes = new Uint8Array(await c.req.arrayBuffer());
    } else {
      throw new HttpError(400, 'invalid_request', 'content-type must be application/json, image/png, or image/jpeg');
    }
    const dimensions = await ctx.commands.image(c.req.param('id'), key(c), bytes, options);
    return c.json({ ok: true, ...dimensions });
  });

  routes.get('/badges/:id/events', (c) => {
    const badgeId = c.req.param('id');
    ctx.commands.authorize(badgeId, key(c), false);
    return streamSSE(c, async (stream) => {
      let finished = false;
      let finish: (() => void) | undefined;
      const done = new Promise<void>((resolve) => { finish = resolve; });
      const cleanup = () => {
        if (finished) return;
        finished = true;
        clearInterval(ping);
        unsubscribe();
        finish?.();
      };
      const unsubscribe = ctx.hub.subscribe(badgeId, (event) => {
        void stream.writeSSE({ event: event.event, data: JSON.stringify(event) }).catch(cleanup);
      });
      const ping = setInterval(() => {
        const event = { event: 'ping' as const, at: new Date().toISOString() };
        void stream.writeSSE({ event: 'ping', data: JSON.stringify(event) }).catch(cleanup);
      }, 25_000);
      stream.onAbort(cleanup);
      // Bun flushes the response headers with the first chunk, so a client
      // fetch() would hang until the first badge event without this.
      await stream
        .writeSSE({ event: 'ping', data: JSON.stringify({ event: 'ping', at: new Date().toISOString() }) })
        .catch(cleanup);
      await done;
    });
  });

  return routes;
}
