import {
  BOX_RESPONSE_MAX_BYTES,
  QUEST_REWARD_ITEM,
  SOLANA_BOX_ITEM,
  boxById,
  isSolanaItem,
  type Award,
  type Badge,
  type BoxRequest,
  type BoxResponse,
} from '@htn/shared';
import { pairingUrl } from '../config.ts';
import { grantAward, listAwards } from './awards.ts';
import { upsertBadge } from './badges.ts';
import type { ServiceContext } from './context.ts';
import { nowIso } from './context.ts';
import { getQuestSubmission } from './quests.ts';
import { buildBadgeView } from './views.ts';

export interface BoxDecision {
  badge: Badge;
  newItem: string;
  awards: Award[];
}

export function decideBox(ctx: ServiceContext, request: BoxRequest): BoxDecision {
  const at = nowIso();
  const badgeId = request.user_id !== '' ? request.user_id : request.public_key;
  const badge = upsertBadge(
    ctx.db,
    {
      badgeId,
      name: request.name,
      email: request.email,
      publicKey: request.public_key,
    },
    at,
  );

  const owned = new Set(listAwards(ctx.db, badgeId).map((award) => award.item));
  let newItem = '';
  if (request.box === ctx.config.solanaBoxId) {
    // The first Solana box always hands out (or replays) item 8.
    if (!owned.has(SOLANA_BOX_ITEM)) {
      grantAward(ctx.db, badgeId, SOLANA_BOX_ITEM, request.box, at);
    }
    newItem = SOLANA_BOX_ITEM;
  } else if (request.box === ctx.config.solanaFinalBoxId) {
    // The final Solana box is empty until the quest is complete, then hands
    // out (or replays) item 9.
    const completed = getQuestSubmission(ctx.db, badgeId)?.status === 'completed';
    if (completed) {
      if (!owned.has(QUEST_REWARD_ITEM)) {
        grantAward(ctx.db, badgeId, QUEST_REWARD_ITEM, request.box, at);
      }
      newItem = QUEST_REWARD_ITEM;
    }
  } else {
    // Regular boxes hand out one fixed non-Solana item. Unknown box ids and
    // Solana items reached through this branch are empty boxes.
    const item = boxById(request.box)?.item;
    if (item !== undefined && !isSolanaItem(item)) {
      if (!owned.has(item)) grantAward(ctx.db, badgeId, item, request.box, at);
      newItem = item;
    }
  }

  const awards = listAwards(ctx.db, badgeId);
  ctx.live.publish(badge.pairingCode, { type: 'state', view: buildBadgeView(ctx, badge) });
  return { badge, newItem, awards };
}

export function fitBoxResponse(response: BoxResponse): BoxResponse {
  if (Buffer.byteLength(JSON.stringify(response), 'utf8') > BOX_RESPONSE_MAX_BYTES) {
    return { ...response, chain_link: '' };
  }
  return response;
}

export function handleBox(ctx: ServiceContext, request: BoxRequest): BoxResponse {
  const decision = decideBox(ctx, request);
  return fitBoxResponse({
    new_item: decision.newItem,
    chain_link: pairingUrl(ctx.config, decision.badge.pairingCode),
    all_items: decision.awards.map((award) => award.item),
  });
}
