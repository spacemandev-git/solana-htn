import { randomInt } from 'node:crypto';
import {
  BOX_RESPONSE_MAX_BYTES,
  QUEST_REWARD_ITEM,
  REGULAR_ITEMS,
  SOLANA_BOX_ITEM,
  type Award,
  type Badge,
  type BoxRequest,
  type BoxResponse,
} from '@htn/shared';
import { pairingUrl } from '../config.ts';
import { awardsAtBox, grantAward, listAwards } from './awards.ts';
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
    // Item 8 comes free on the first tap; item 9 waits for the quest. A badge
    // that finished the quest before ever tapping gets both at once.
    const completed = getQuestSubmission(ctx.db, badgeId)?.status === 'completed';
    if (!owned.has(SOLANA_BOX_ITEM)) {
      grantAward(ctx.db, badgeId, SOLANA_BOX_ITEM, request.box, at);
      if (completed) grantAward(ctx.db, badgeId, QUEST_REWARD_ITEM, request.box, at);
      newItem = SOLANA_BOX_ITEM;
    } else if (completed && !owned.has(QUEST_REWARD_ITEM)) {
      grantAward(ctx.db, badgeId, QUEST_REWARD_ITEM, request.box, at);
      newItem = QUEST_REWARD_ITEM;
    } else {
      // Replay: the most recent thing this box handed out.
      const prior = awardsAtBox(ctx.db, badgeId, request.box);
      newItem = prior.at(-1)?.item ?? '';
    }
  } else {
    const prior = awardsAtBox(ctx.db, badgeId, request.box);
    if (prior.length > 0) {
      newItem = prior[0]!.item;
    } else {
      const remaining = REGULAR_ITEMS.filter((item) => !owned.has(item));
      if (remaining.length > 0) {
        newItem = remaining[randomInt(remaining.length)]!;
        grantAward(ctx.db, badgeId, newItem, request.box, at);
      }
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
