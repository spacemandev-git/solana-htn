/**
 * The blind-box game, pinned. Eight physical boxes; every box a badge visits
 * hands out one item the badge does not already own. Seven boxes draw from the
 * regular pool. The Solana box hands out item 8 on the first tap like any other
 * box, and item 9 only once the badge has completed the quest.
 *
 * Item ids are strings because the badge firmware compares strings ("1", not
 * 1). Ids outside the compiled palette render as a generic placeholder on the
 * badge, so the pools here can change without a firmware update.
 */

/** Items a regular (non-Solana) box can hand out. One per box visit, never repeated. */
export const REGULAR_ITEMS = ['1', '2', '3', '4', '5', '6', '7'] as const;

/** Item the Solana box hands out on the first tap, no quest required. */
export const SOLANA_BOX_ITEM = '8';

/** Item the Solana box hands out only after the badge completed the quest. */
export const QUEST_REWARD_ITEM = '9';

/** Everything the Solana box can hand out. */
export const SOLANA_ITEMS = [SOLANA_BOX_ITEM, QUEST_REWARD_ITEM] as const;

export const ALL_ITEMS = [...REGULAR_ITEMS, ...SOLANA_ITEMS] as const;
export type ItemId = (typeof ALL_ITEMS)[number];

/** Number of physical boxes on the floor, including the Solana box. */
export const BOX_COUNT = 8;

/** `box` id the relay sends for the Solana station unless SOLANA_BOX_ID overrides it. */
export const DEFAULT_SOLANA_BOX_ID = 'blind-box-01';

/**
 * Hard cap on the box response body, in bytes, including JSON syntax. The BLE
 * relay truncates anything longer and the badge shows "Reply was too long".
 */
export const BOX_RESPONSE_MAX_BYTES = 207;

/** The badge ignores inventory entries beyond this many. */
export const BOX_MAX_ITEMS = ALL_ITEMS.length;

export function isSolanaItem(item: string): boolean {
  return (SOLANA_ITEMS as readonly string[]).includes(item);
}

export function isQuestReward(item: string): boolean {
  return item === QUEST_REWARD_ITEM;
}
