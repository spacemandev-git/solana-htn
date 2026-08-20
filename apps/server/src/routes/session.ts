import { Hono } from 'hono';
import type { LiveEvent } from '@htn/shared';
import { fail } from '../http.ts';
import type { ServiceContext } from '../services/context.ts';
import { buildSessionView, getSession } from '../services/sessions.ts';

/** Long enough to beat proxy idle timeouts, short enough to detect dead peers. */
const HEARTBEAT_MS = 25_000;

export function sessionRoutes(ctx: ServiceContext): Hono {
  const routes = new Hono();

  // Ended sessions are still readable so the PWA can render "you walked away".
  routes.get('/:pairingCode', (c) => {
    const session = getSession(ctx.db, c.req.param('pairingCode'));
    if (!session) return fail(c, 404, 'session_not_found', 'no session for that pairing code');

    const view = buildSessionView(ctx.db, session);
    if (!view) return fail(c, 404, 'session_incomplete', 'session is missing its badge or station');

    return c.json(view);
  });

  routes.get('/:pairingCode/stream', (c) => {
    const pairingCode = c.req.param('pairingCode');
    const session = getSession(ctx.db, pairingCode);
    if (!session) return fail(c, 404, 'session_not_found', 'no session for that pairing code');

    const encoder = new TextEncoder();
    let unsubscribe: () => void = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;

        const cleanup = () => {
          if (closed) return;
          closed = true;
          if (heartbeat !== undefined) clearInterval(heartbeat);
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

        const view = buildSessionView(ctx.db, session);
        if (view) send({ type: 'state', view });

        heartbeat = setInterval(() => send({ type: 'ping' }), HEARTBEAT_MS);
        c.req.raw.signal.addEventListener('abort', cleanup, { once: true });
      },
      cancel() {
        if (heartbeat !== undefined) clearInterval(heartbeat);
        unsubscribe();
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // Stops nginx-style proxies from buffering the stream into uselessness.
        'x-accel-buffering': 'no',
      },
    });
  });

  return routes;
}
