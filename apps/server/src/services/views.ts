import { CLUSTERS, type Badge, type BadgeView } from '@htn/shared';
import type { ServiceContext } from './context.ts';
import { getBadgeByPairingCode } from './badges.ts';
import { listAwards } from './awards.ts';
import { getQuestSubmission } from './quests.ts';

export function buildBadgeView(ctx: ServiceContext, badge: Badge): BadgeView {
  const cluster = ctx.config.solanaCluster;
  return {
    badge,
    awards: listAwards(ctx.db, badge.badgeId),
    quest: getQuestSubmission(ctx.db, badge.badgeId),
    env: {
      chainEnabled: ctx.chain.enabled,
      cluster,
      network: CLUSTERS[cluster].caip2,
      paymentMint: ctx.config.paymentMint,
      paymentSymbol: ctx.config.paymentSymbol,
      maxRewardAtomic: ctx.config.maxRewardAtomic,
      payerAddress: ctx.chain.payerAddress,
      solanaBoxId: ctx.config.solanaBoxId,
      solanaFinalBoxId: ctx.config.solanaFinalBoxId,
    },
  };
}

export function badgeViewByCode(ctx: ServiceContext, pairingCode: string): BadgeView | null {
  const badge = getBadgeByPairingCode(ctx.db, pairingCode);
  return badge ? buildBadgeView(ctx, badge) : null;
}
