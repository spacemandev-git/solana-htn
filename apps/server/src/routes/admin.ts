import { Hono } from 'hono';
import { badgeCount, listBadgeSummaries } from '../services/badges.ts';
import type { ServiceContext } from '../services/context.ts';

/** Read-only surfaces for the operator dashboard, simulator and monitoring. */
export function adminRoutes(ctx: ServiceContext): Hono {
  const routes = new Hono();

  routes.get('/badges', (c) => c.json(listBadgeSummaries(ctx.db)));

  routes.get('/health', (c) =>
    c.json({
      ok: true,
      chainEnabled: ctx.chain.enabled,
      cluster: ctx.config.solanaCluster,
      payerAddress: ctx.chain.payerAddress,
      maxRewardAtomic: ctx.config.maxRewardAtomic,
      badgeCount: badgeCount(ctx.db),
      solanaBoxId: ctx.config.solanaBoxId,
      solanaFinalBoxId: ctx.config.solanaFinalBoxId,
    }),
  );

  return routes;
}
