import type { AnimalId, Rarity, Slot } from './catalog.ts';

/** A hacker's badge. The `badgeId` is the id burned into the ESP32-C3. */
export interface Badge {
  badgeId: string;
  name: string;
  email: string;
  animal: AnimalId;
  createdAt: string;
}

/** A Sync Station: an ESP32 hub that badges announce themselves to over ESP-NOW. */
export interface Station {
  stationId: string;
  name: string;
  /** Flavour text shown in the PWA when a hacker arrives. */
  blurb: string;
  lastSeenAt: string | null;
}

/** One earned item. `assetAddress` is null until the chain write confirms. */
export interface Item {
  id: number;
  badgeId: string;
  stationId: string;
  itemKey: string;
  name: string;
  slot: Slot;
  rarity: Rarity;
  code: number;
  mintedAt: string;
  /** On-chain item record PDA, once minted. */
  assetAddress: string | null;
  /** Transaction signature of the mint, once confirmed. */
  signature: string | null;
  /** Whether the hacker has withdrawn this out of escrow to their own wallet. */
  withdrawn: boolean;
}

/**
 * A live pairing between a badge and a station. Created when a station POSTs a
 * sync, ended when it POSTs a disconnect (hacker walked into the wilderness).
 */
export interface Session {
  pairingCode: string;
  badgeId: string;
  stationId: string;
  startedAt: string;
  endedAt: string | null;
  active: boolean;
}

/** The escrow vault holding a badge's assets until a wallet claims it. */
export interface Vault {
  badgeId: string;
  /** PDA address of the vault, once initialized on-chain. */
  vaultAddress: string | null;
  /** Wallet that has claimed this vault. Null while still in escrow. */
  ownerWallet: string | null;
  claimedAt: string | null;
}

/** Everything the PWA renders for a paired hacker. */
export interface SessionView {
  session: Session;
  badge: Badge;
  station: Station;
  animal: { id: AnimalId; name: string; emoji: string; blurb: string };
  items: Item[];
  /** Items earned during *this* session, so the PWA can play an unlock animation. */
  newItemIds: number[];
  vault: Vault;
}

/** Aggregate row for the operator/simulator dashboard. */
export interface BadgeSummary {
  badge: Badge;
  itemCount: number;
  stationsVisited: number;
  activeSession: Session | null;
  vault: Vault;
}

/** Server -> PWA push events over SSE. */
export type LiveEvent =
  | { type: 'state'; view: SessionView }
  | { type: 'item'; item: Item }
  | { type: 'disconnected'; at: string }
  | { type: 'vault-claimed'; wallet: string }
  | { type: 'ping' };
