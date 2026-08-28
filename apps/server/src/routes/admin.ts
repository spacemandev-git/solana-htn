import { Hono } from 'hono';
import { fail } from '../http.ts';
import { badgeCount, getBadge, listBadgeSummaries } from '../services/badges.ts';
import type { ServiceContext } from '../services/context.ts';
import { getQuestSubmission } from '../services/quests.ts';
import { listSessionsForBadge } from '../services/sessions.ts';
import { listStations } from '../services/stations.ts';

/** Read-only surfaces for the operator dashboard, the simulator and monitoring. */
export function adminRoutes(ctx: ServiceContext): Hono {
  const routes = new Hono();

  routes.get('/badges', (c) => c.json(listBadgeSummaries(ctx.db)));

  routes.get('/badges/:badgeId', (c) => {
    const badge = getBadge(ctx.db, c.req.param('badgeId'));
    if (!badge) return fail(c, 404, 'badge_not_found', 'no badge with that id');

    return c.json({
      badge,
      sessions: listSessionsForBadge(ctx.db, badge.badgeId),
      quest: getQuestSubmission(ctx.db, badge.badgeId),
    });
  });

  routes.get('/stations', (c) => c.json(listStations(ctx.db)));

  routes.get('/health', (c) =>
    c.json({
      ok: true,
      chainEnabled: ctx.chain.enabled,
      cluster: ctx.config.solanaCluster,
      payerAddress: ctx.chain.payerAddress,
      maxRewardAtomic: ctx.config.maxRewardAtomic,
      badgeCount: badgeCount(ctx.db),
    }),
  );

  return routes;
}
