import { Hono } from 'hono';
import { BoxRequest } from '@htn/shared';
import { parseJson } from '../http.ts';
import { handleBox } from '../services/boxes.ts';
import type { ServiceContext } from '../services/context.ts';

export function boxRoutes(ctx: ServiceContext): Hono {
  const routes = new Hono();

  routes.post('/', async (c) => {
    const body = await parseJson(c, BoxRequest);
    return c.json(handleBox(ctx, body));
  });

  return routes;
}
