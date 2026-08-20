/**
 * Game content catalog: the animals hackers are assigned on first sync, and the
 * funky clothing they earn for each new Sync Station they visit.
 *
 * Everything here is deterministic. Given a badge id (and a station id) the same
 * animal / item comes out every time, on the server, in the PWA, and in tests.
 * That means no content state has to be synced anywhere — it is derived.
 */

export const ANIMALS = [
  { id: 'fox', name: 'Fox', emoji: '\u{1F98A}', blurb: 'Quick, clever, always three tabs ahead.' },
  { id: 'otter', name: 'Otter', emoji: '\u{1F9A6}', blurb: 'Floats through demos holding hands.' },
  { id: 'moose', name: 'Moose', emoji: '\u{1FACE}', blurb: 'Immovable once the commit lands.' },
  { id: 'beaver', name: 'Beaver', emoji: '\u{1F9AB}', blurb: 'Ships infrastructure nobody asked for.' },
  { id: 'loon', name: 'Loon', emoji: '\u{1F426}', blurb: 'Screams at 4am. Beautifully.' },
  { id: 'lynx', name: 'Lynx', emoji: '\u{1F408}', blurb: 'Seen only near the snack table.' },
  { id: 'goose', name: 'Goose', emoji: '\u{1F9A2}', blurb: 'Waterloo campus final boss.' },
  { id: 'raccoon', name: 'Raccoon', emoji: '\u{1F99D}', blurb: 'Trash panda, elite debugger.' },
  { id: 'bear', name: 'Bear', emoji: '\u{1F43B}', blurb: 'Hibernates between hackathons.' },
  { id: 'caribou', name: 'Caribou', emoji: '\u{1F98C}', blurb: 'Migrates toward free stickers.' },
] as const;

export type AnimalId = (typeof ANIMALS)[number]['id'];
export type Animal = (typeof ANIMALS)[number];

/** Equipment slots. One item per slot is worn; extras stay in the vault. */
export const SLOTS = ['head', 'face', 'torso', 'hands', 'feet', 'back', 'aura'] as const;
export type Slot = (typeof SLOTS)[number];

export const RARITIES = ['common', 'uncommon', 'rare', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

/** Adjective x noun per slot -> a large, funky, deterministic item space. */
const ADJECTIVES = [
  'Neon', 'Cursed', 'Holographic', 'Recursive', 'Overclocked', 'Sentient', 'Quantum',
  'Deprecated', 'Artisanal', 'Unhinged', 'Load-Bearing', 'Rubber-Duck', 'Caffeinated',
  'Bootleg', 'Immutable', 'Zero-Knowledge', 'Nocturnal', 'Suspicious', 'Glacial', 'Maple-Glazed',
] as const;

const NOUNS: Record<Slot, readonly string[]> = {
  head: ['Beanie', 'Visor', 'Crown', 'Bucket Hat', 'Headlamp', 'Antlers'],
  face: ['Shades', 'Monocle', 'Snorkel', 'War Paint', 'Moustache', 'LED Mask'],
  torso: ['Hoodie', 'Lab Coat', 'Puffer Vest', 'Flannel', 'Poncho', 'Hackathon Tee'],
  hands: ['Mittens', 'Gauntlets', 'Wrist Wraps', 'Oven Mitts', 'Fingerless Gloves', 'Claws'],
  feet: ['Crocs', 'Snowshoes', 'Sneakers', 'Rain Boots', 'Slippers', 'Skates'],
  back: ['Backpack', 'Cape', 'Jetpack', 'Turtle Shell', 'Solar Panel', 'Bedroll'],
  aura: ['Glow', 'Static Field', 'Snow Flurry', 'Firefly Swarm', 'Pixel Haze', 'Steam Cloud'],
};

/** FNV-1a. Small, dependency-free, and stable across every runtime we use. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function pick<T>(list: readonly T[], seed: number): T {
  // Callers only ever pass non-empty catalog arrays, so this index is always populated.
  return list[seed % list.length]!;
}

/** The animal a badge is born with. Stable for the life of the badge. */
export function animalForBadge(badgeId: string): Animal {
  return pick(ANIMALS, hash32(`animal:${badgeId}`));
}

/**
 * Rarity curve. Legendary is deliberately rare enough that seeing one at the
 * hackathon is a moment, but common enough to actually happen over ~10 stations.
 */
function rarityFor(seed: number): Rarity {
  const roll = seed % 100;
  if (roll < 55) return 'common';
  if (roll < 85) return 'uncommon';
  if (roll < 97) return 'rare';
  return 'legendary';
}

export interface GeneratedItem {
  /** Deterministic content id, e.g. "neon-jetpack". Not the on-chain address. */
  itemKey: string;
  name: string;
  slot: Slot;
  rarity: Rarity;
  /** Numeric encoding written on-chain (u32). Lets the program stay content-agnostic. */
  code: number;
}

/**
 * The reward for `badgeId` visiting `stationId` for the first time.
 *
 * Seeded by both ids: two hackers at the same station get different loot, and
 * the same hacker returning to a station they already cleared would regenerate
 * the identical item (the server only ever grants it once).
 */
export function itemForVisit(badgeId: string, stationId: string): GeneratedItem {
  const seed = hash32(`item:${badgeId}:${stationId}`);
  const slot = pick(SLOTS, seed);
  const adjective = pick(ADJECTIVES, seed >>> 3);
  const noun = pick(NOUNS[slot], seed >>> 7);
  const rarity = rarityFor(seed >>> 11);
  const name = `${adjective} ${noun}`;
  return {
    itemKey: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
    slot,
    rarity,
    // Packed so the on-chain record can be rendered without an off-chain lookup:
    // low 16 bits = content hash, next 3 = slot index, next 2 = rarity index.
    code: (seed & 0xffff) | (SLOTS.indexOf(slot) << 16) | (RARITIES.indexOf(rarity) << 19),
  };
}

/** Inverse of the packing in `itemForVisit`, for decoding on-chain item records. */
export function decodeItemCode(code: number): { slot: Slot; rarity: Rarity } {
  return {
    slot: SLOTS[(code >>> 16) & 0b111] ?? 'head',
    rarity: RARITIES[(code >>> 19) & 0b11] ?? 'common',
  };
}
