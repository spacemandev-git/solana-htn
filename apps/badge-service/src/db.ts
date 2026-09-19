import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import type { SQLQueryBindings } from 'bun:sqlite';
import type { HtnosApp, HtnosBadgeStatus } from '@htn/shared';

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS devices (
  badge_id      TEXT PRIMARY KEY,
  mac           TEXT NOT NULL UNIQUE,
  token_hash    TEXT NOT NULL,
  key_hash      TEXT,
  fw            TEXT,
  registered_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS apps (
  app_id      TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  url         TEXT NOT NULL,
  author      TEXT NOT NULL,
  source_url  TEXT,
  kind        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_apps_created ON apps(created_at DESC);
`;

export interface DeviceRow {
  badge_id: string;
  mac: string;
  token_hash: string;
  key_hash: string | null;
  fw: string | null;
  registered_at: string;
  last_seen_at: string;
}

export interface AppRow {
  app_id: string;
  name: string;
  description: string;
  url: string;
  author: string;
  source_url: string | null;
  kind: string;
  created_at: string;
}

export function migrate(db: Database): void {
  db.exec(SCHEMA_SQL);
}

export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

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
  return one<{ count: number }>(db, sql, ...params)?.count ?? 0;
}

export function toApp(row: AppRow): HtnosApp {
  return {
    appId: row.app_id,
    name: row.name,
    description: row.description,
    url: row.url,
    author: row.author,
    sourceUrl: row.source_url,
    kind: row.kind as HtnosApp['kind'],
    createdAt: row.created_at,
  };
}

export function toBadgeStatus(
  row: DeviceRow,
  online: boolean,
  mode: 'canvas' | 'menu' | null,
): HtnosBadgeStatus {
  return {
    badgeId: row.badge_id,
    online,
    hasKey: row.key_hash !== null,
    fw: row.fw,
    registeredAt: row.registered_at,
    lastSeenAt: row.last_seen_at,
    mode: online ? mode : null,
  };
}

export { Database };
