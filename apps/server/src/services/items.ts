import type { Database } from 'bun:sqlite';
import type { ChainClient } from '@htn/chain';
import { itemForVisit, type Item } from '@htn/shared';
import { all, count, one, run, toItem } from '../db/index.ts';
import type { ItemRow, VisitRow } from '../db/schema.ts';

export interface VisitDetail {
  badgeId: string;
  stationId: string;
  stationName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  visitCount: number;
  lastRssi: number | null;
}

export function listItems(db: Database, badgeId: string): Item[] {
  return all<ItemRow>(
    db,
    'SELECT * FROM items WHERE badge_id = ? ORDER BY item_index ASC',
    badgeId,
  ).map(toItem);
}

export function getItem(db: Database, itemId: number): Item | null {
  const row = one<ItemRow>(db, 'SELECT * FROM items WHERE id = ?', itemId);
  return row ? toItem(row) : null;
}

/** The on-chain index for an item, which the API shape deliberately hides. */
export function getItemIndex(db: Database, itemId: number): number | null {
  const row = one<{ item_index: number }>(db, 'SELECT item_index FROM items WHERE id = ?', itemId);
  return row ? row.item_index : null;
}

export function itemCount(db: Database, badgeId: string): number {
  return count(db, 'SELECT COUNT(*) AS count FROM items WHERE badge_id = ?', badgeId);
}

export function newItemIdsForSession(db: Database, pairingCode: string): number[] {
  return all<{ id: number }>(
    db,
    'SELECT id FROM items WHERE granted_session = ? ORDER BY id ASC',
    pairingCode,
  ).map((row) => row.id);
}

export function listVisits(db: Database, badgeId: string): VisitDetail[] {
  return all<VisitRow & { station_name: string | null }>(
    db,
    `SELECT v.*, s.name AS station_name
       FROM visits v
       LEFT JOIN stations s ON s.station_id = v.station_id
      WHERE v.badge_id = ?
      ORDER BY v.first_seen_at ASC, v.id ASC`,
    badgeId,
  ).map((row) => ({
    badgeId: row.badge_id,
    stationId: row.station_id,
    stationName: row.station_name,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    visitCount: row.visit_count,
    lastRssi: row.last_rssi,
  }));
}

/**
 * Records the badge being seen at a station and, if this is the first time,
 * grants the deterministic reward for that pair.
 *
 * The `visits` unique constraint is the source of truth for "new station": the
 * insert either wins (first visit, item granted) or does nothing (repeat sync,
 * no item). That makes repeated syncs safe even if two hubs report at once.
 *
 * Returns null on a repeat visit.
 */
export async function recordVisit(
  db: Database,
  chain: ChainClient,
  args: {
    badgeId: string;
    stationId: string;
    pairingCode: string;
    rssi: number | undefined;
    at: string;
  },
): Promise<Item | null> {
  const { badgeId, stationId, pairingCode, rssi, at } = args;

  const inserted = one<{ id: number }>(
    db,
    `INSERT INTO visits (badge_id, station_id, first_seen_at, last_seen_at, visit_count, last_rssi)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(badge_id, station_id) DO NOTHING
     RETURNING id`,
    badgeId,
    stationId,
    at,
    at,
    rssi ?? null,
  );

  if (!inserted) {
    run(
      db,
      `UPDATE visits
          SET last_seen_at = ?, visit_count = visit_count + 1, last_rssi = COALESCE(?, last_rssi)
        WHERE badge_id = ? AND station_id = ?`,
      at,
      rssi ?? null,
      badgeId,
      stationId,
    );
    return null;
  }

  const generated = itemForVisit(badgeId, stationId);
  const index = itemCount(db, badgeId);

  const created = one<{ id: number }>(
    db,
    `INSERT INTO items
       (badge_id, station_id, item_index, item_key, name, slot, rarity, code, minted_at, granted_session)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
    badgeId,
    stationId,
    index,
    generated.itemKey,
    generated.name,
    generated.slot,
    generated.rarity,
    generated.code,
    at,
    pairingCode,
  );
  if (!created) throw new Error(`failed to grant item for ${badgeId} at ${stationId}`);

  // Chain write happens after the local grant so a flaky RPC can never cost a
  // hacker their loot; assetAddress/signature stay null until it lands.
  const result = await chain.mintItem({
    badgeId,
    index,
    code: generated.code,
    stationId,
  });
  if (result.address || result.signature) {
    run(
      db,
      'UPDATE items SET asset_address = COALESCE(NULLIF(?, \'\'), asset_address), signature = COALESCE(?, signature) WHERE id = ?',
      result.address,
      result.signature,
      created.id,
    );
  }

  const item = getItem(db, created.id);
  if (!item) throw new Error(`item ${created.id} vanished after insert`);
  return item;
}

/** Moves an item out of escrow. Caller must have verified the vault is claimed. */
export async function withdrawItem(
  db: Database,
  chain: ChainClient,
  badgeId: string,
  item: Item,
): Promise<Item> {
  const index = getItemIndex(db, item.id);
  if (index === null) throw new Error(`item ${item.id} has no index`);

  const result = await chain.withdrawItem(badgeId, index);
  run(
    db,
    'UPDATE items SET withdrawn = 1, signature = COALESCE(?, signature) WHERE id = ?',
    result.signature,
    item.id,
  );

  const updated = getItem(db, item.id);
  if (!updated) throw new Error(`item ${item.id} vanished during withdraw`);
  return updated;
}
