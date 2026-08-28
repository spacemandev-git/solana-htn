import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import type { SQLQueryBindings } from 'bun:sqlite';
import type { Badge, QuestStep, QuestSubmission, QuestStatus, Session, Station } from '@htn/shared';
import {
  SCHEMA_SQL,
  TABLES_IN_DELETE_ORDER,
  type BadgeRow,
  type QuestSubmissionRow,
  type SessionRow,
  type StationRow,
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
    createdAt: row.created_at,
  };
}

export function toStation(row: StationRow): Station {
  return {
    stationId: row.station_id,
    name: row.name,
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

export function toQuestSubmission(row: QuestSubmissionRow): QuestSubmission {
  return {
    badgeId: row.badge_id,
    endpointUrl: row.endpoint_url,
    programId: row.program_id,
    status: row.status as QuestStatus,
    step: row.step as QuestStep | null,
    error: row.error,
    message: row.message,
    amountPaidAtomic: row.amount_paid_atomic,
    paymentSignature: row.payment_signature,
    network: row.network,
    paid: row.paid === 1,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
  };
}

export { Database };
