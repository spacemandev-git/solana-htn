import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import type { SQLQueryBindings } from 'bun:sqlite';
import type { AnimalId, Item, Rarity, Session, Slot, Station, Vault, Badge } from '@htn/shared';
import {
  SCHEMA_SQL,
  TABLES_IN_DELETE_ORDER,
  type BadgeRow,
  type ItemRow,
  type SessionRow,
  type StationRow,
  type VaultRow,
} from './schema.ts';

export const MEMORY_DB = ':memory:';

/** Applies the schema. Idempotent, so it runs on every boot and in every test. */
export function migrate(db: Database): void {
  db.exec(SCHEMA_SQL);
}

export function openDatabase(path: string): Database {
  if (path !== MEMORY_DB) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path, { create: true });
  if (path !== MEMORY_DB) {
    // WAL keeps station syncs from blocking on PWA reads.
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

/** Removes every row. Dev/simulator only — see routes/dev.ts. */
export function wipeDatabase(db: Database): void {
  db.transaction(() => {
    for (const table of TABLES_IN_DELETE_ORDER) {
      db.query(`DELETE FROM ${table}`).run();
    }
    // Restart autoincrement so simulator runs get stable item ids.
    db.query(`DELETE FROM sqlite_sequence WHERE name IN ('items','visits')`).run();
  })();
}

/* ------------------------------------------------------------------ *
 * Thin typed query helpers. bun:sqlite returns `any`; these are the
 * only place that gets narrowed, so no route or service handles raw rows.
 * ------------------------------------------------------------------ */

export function one<T>(db: Database, sql: string, ...params: SQLQueryBindings[]): T | null {
  return db.query(sql).get(...params) as T | null;
}

export function all<T>(db: Database, sql: string, ...params: SQLQueryBindings[]): T[] {
  return db.query(sql).all(...params) as T[];
}

export function run(db: Database, sql: string, ...params: SQLQueryBindings[]): void {
  db.query(sql).run(...params);
}

export function count(db: Database, sql: string, ...params: SQLQueryBindings[]): number {
  const row = one<{ count: number }>(db, sql, ...params);
  return row?.count ?? 0;
}

/* ------------------------------------------------------------------ *
 * Row -> API shape mappers.
 * ------------------------------------------------------------------ */

export function toBadge(row: BadgeRow): Badge {
  return {
    badgeId: row.badge_id,
    name: row.name,
    email: row.email,
    animal: row.animal as AnimalId,
    createdAt: row.created_at,
  };
}

export function toStation(row: StationRow): Station {
  return {
    stationId: row.station_id,
    name: row.name,
    blurb: row.blurb,
    lastSeenAt: row.last_seen_at,
  };
}

export function toSession(row: SessionRow): Session {
  return {
    pairingCode: row.pairing_code,
    badgeId: row.badge_id,
    stationId: row.station_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    active: row.active === 1,
  };
}

export function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    badgeId: row.badge_id,
    stationId: row.station_id,
    itemKey: row.item_key,
    name: row.name,
    slot: row.slot as Slot,
    rarity: row.rarity as Rarity,
    code: row.code,
    mintedAt: row.minted_at,
    assetAddress: row.asset_address,
    signature: row.signature,
    withdrawn: row.withdrawn === 1,
  };
}

export function toVault(row: VaultRow): Vault {
  return {
    badgeId: row.badge_id,
    vaultAddress: row.vault_address,
    ownerWallet: row.owner_wallet,
    claimedAt: row.claimed_at,
  };
}

export { Database };
