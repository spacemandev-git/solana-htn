/**
 * The blind-box game, pinned. Eight physical boxes on the floor; every box
 * hands out one fixed item. The Solana booth hands out item 8 on the first tap
 * like any other box, and item 9 only once the badge has completed the quest.
 *
 * Item ids are strings because the badge firmware compares strings ("1", not
 * 1). Ids outside the compiled palette render as a generic placeholder on the
 * badge, so the table here can change without a firmware update.
 */

export interface BoxInfo {
  /** The `box` id the relay beacon sends. */
  id: string;
  /** Human-readable zone name for the console and simulator. */
  name: string;
  /** The item this box hands out. */
  item: string;
}

/** Item the Solana booth hands out on the first tap, no quest required. */
export const SOLANA_BOX_ITEM = '8';

/** Item the Solana booth hands out only after the badge completed the quest. */
export const QUEST_REWARD_ITEM = '9';

/** Every box, in floor order. The Solana booth is first. */
export const BOXES: readonly BoxInfo[] = [
  { id: 'solana-booth', name: 'Solana Booth', item: SOLANA_BOX_ITEM },
  { id: 'hardware-hub', name: 'Hardware Hub', item: '1' },
  { id: 'extended-bay', name: 'Extended Sponsor Bay', item: '2' },
  { id: 'mentor-cafe', name: 'Mentor Cafe', item: '3' },
  { id: 'third-floor', name: 'Third Floor Hacking Space', item: '4' },
  { id: 'fourth-floor', name: 'Fourth Floor Hacking Space', item: '5' },
  { id: 'fifth-floor', name: 'Fifth Floor Hacking Space', item: '6' },
  { id: 'seventh-floor', name: 'Seventh Floor', item: '7' },
];

/** `box` id of the Solana station unless SOLANA_BOX_ID overrides it. */
export const DEFAULT_SOLANA_BOX_ID = 'solana-booth';

/** Number of physical boxes on the floor, including the Solana booth. */
export const BOX_COUNT = BOXES.length;

/** Items the regular (non-Solana) boxes hand out, in box order. */
export const REGULAR_ITEMS: readonly string[] = BOXES.filter(
  (box) => box.id !== DEFAULT_SOLANA_BOX_ID,
).map((box) => box.item);

/** Everything the Solana booth can hand out. */
export const SOLANA_ITEMS = [SOLANA_BOX_ITEM, QUEST_REWARD_ITEM] as const;

/** Every item id, in display order "1" … "9". */
export const ALL_ITEMS: readonly string[] = [...REGULAR_ITEMS, ...SOLANA_ITEMS];

/**
 * Hard cap on the box response body, in bytes, including JSON syntax. The BLE
 * relay truncates anything longer and the badge shows "Reply was too long".
 */
export const BOX_RESPONSE_MAX_BYTES = 207;

/** The badge ignores inventory entries beyond this many. */
export const BOX_MAX_ITEMS = ALL_ITEMS.length;

export function boxById(id: string): BoxInfo | undefined {
  return BOXES.find((box) => box.id === id);
}

/** Zone name for a box id, falling back to the raw id for unknown boxes. */
export function boxName(id: string): string {
  return boxById(id)?.name ?? id;
}

export function isSolanaItem(item: string): boolean {
  return (SOLANA_ITEMS as readonly string[]).includes(item);
}

export function isQuestReward(item: string): boolean {
  return item === QUEST_REWARD_ITEM;
}
