import { Hono } from 'hono';
import { QuestSubmitRequest } from '@htn/shared';
import { parseJson } from '../http.ts';
import type { ServiceContext } from '../services/context.ts';
import { QuestService } from '../services/quests.ts';

export function questRoutes(ctx: ServiceContext): Hono {
  const routes = new Hono();
  const quests = new QuestService(ctx);

  routes.post('/submit', async (c) => {
    const request = await parseJson(c, QuestSubmitRequest);
    return c.json({ submission: quests.submit(request) }, 202);
  });

  return routes;
}
