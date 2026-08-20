import { Hono } from 'hono';
import { fail } from '../http.ts';
import {
  animalFor,
  badgeCount,
  getBadge,
  listBadgeSummaries,
} from '../services/badges.ts';
import type { ServiceContext } from '../services/context.ts';
import { listItems, listVisits } from '../services/items.ts';
import { listSessionsForBadge } from '../services/sessions.ts';
import { listStations } from '../services/stations.ts';
import { emptyVault, getVault } from '../services/vaults.ts';

/** Read-only surfaces for the operator dashboard, the simulator and monitoring. */
export function adminRoutes(ctx: ServiceContext): Hono {
  const routes = new Hono();

  routes.get('/badges', (c) => c.json(listBadgeSummaries(ctx.db)));

  routes.get('/badges/:badgeId', (c) => {
    const badge = getBadge(ctx.db, c.req.param('badgeId'));
    if (!badge) return fail(c, 404, 'badge_not_found', 'no badge with that id');

    const animal = animalFor(badge);
    return c.json({
      badge,
      animal: { id: animal.id, name: animal.name, emoji: animal.emoji, blurb: animal.blurb },
      items: listItems(ctx.db, badge.badgeId),
      visits: listVisits(ctx.db, badge.badgeId),
      // Same substitution as /api/badges, so both endpoints agree on the shape.
      vault: getVault(ctx.db, badge.badgeId) ?? emptyVault(badge.badgeId),
      sessions: listSessionsForBadge(ctx.db, badge.badgeId),
    });
  });

  routes.get('/stations', (c) => c.json(listStations(ctx.db)));

  routes.get('/health', (c) =>
    c.json({
      ok: true,
      chainEnabled: ctx.chain.enabled,
      programId: ctx.chain.programId,
      badgeCount: badgeCount(ctx.db),
    }),
  );

  return routes;
}
