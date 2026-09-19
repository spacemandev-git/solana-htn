import { Hono } from 'hono';
import type { LiveEvent } from '@htn/shared';
import { fail } from '../http.ts';
import { getBadgeByPairingCode } from '../services/badges.ts';
import type { ServiceContext } from '../services/context.ts';
import { badgeViewByCode, buildBadgeView } from '../services/views.ts';

const HEARTBEAT_MS = 25_000;
/**
 * Cloud Run counts an open stream as an in-flight request, and the API runs on
 * one instance with a fixed concurrency cap. Abandoned tabs hold streams until
 * the request timeout otherwise, so the server closes every stream after this
 * long; browsers reconnect on their own and the first frame is the full state.
 */
export const STREAM_MAX_MS = 10 * 60_000;

export function badgeRoutes(ctx: ServiceContext): Hono {
  const routes = new Hono();

  routes.get('/:pairingCode', (c) => {
    const view = badgeViewByCode(ctx, c.req.param('pairingCode'));
    if (!view) return fail(c, 404, 'badge_not_found', 'no badge with that pairing code');
    return c.json(view);
  });

  routes.get('/:pairingCode/stream', (c) => {
    const pairingCode = c.req.param('pairingCode');
    const badge = getBadgeByPairingCode(ctx.db, pairingCode);
    if (!badge) return fail(c, 404, 'badge_not_found', 'no badge with that pairing code');

    const encoder = new TextEncoder();
    let unsubscribe: () => void = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let lifetime: ReturnType<typeof setTimeout> | undefined;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;

        const cleanup = () => {
          if (closed) return;
          closed = true;
          if (heartbeat !== undefined) clearInterval(heartbeat);
          if (lifetime !== undefined) clearTimeout(lifetime);
          unsubscribe();
          try {
            controller.close();
          } catch {
            // Already closed by the runtime when the socket dropped.
          }
        };

        const send = (event: LiveEvent) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            cleanup();
          }
        };

        unsubscribe = ctx.live.subscribe(pairingCode, send);
        send({ type: 'state', view: buildBadgeView(ctx, badge) });

        heartbeat = setInterval(() => send({ type: 'ping' }), HEARTBEAT_MS);
        lifetime = setTimeout(cleanup, STREAM_MAX_MS);
        c.req.raw.signal.addEventListener('abort', cleanup, { once: true });
      },
      cancel() {
        if (heartbeat !== undefined) clearInterval(heartbeat);
        if (lifetime !== undefined) clearTimeout(lifetime);
        unsubscribe();
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    });
  });

  return routes;
}
