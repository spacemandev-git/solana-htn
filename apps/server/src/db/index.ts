import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import type { SQLQueryBindings } from 'bun:sqlite';
import type { Award, Badge, QuestStep, QuestSubmission, QuestStatus } from '@htn/shared';
import {
  SCHEMA_SQL,
  TABLES_IN_DELETE_ORDER,
  type AwardRow,
  type BadgeRow,
  type QuestSubmissionRow,
} from './schema.ts';

export const MEMORY_DB = ':memory:';

interface TableInfoRow {
  name: string;
}

/** Applies the schema. Idempotent, so it runs on every boot and in every test. */
export function migrate(db: Database): void {
  // Legacy migration: the pre-blind-box schema had sessions and stations tables
  // and a badges table without pairing codes. That data is disposable.
  db.exec('DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS stations;');
  const badgeColumns = db.query('PRAGMA table_info(badges)').all() as TableInfoRow[];
  if (badgeColumns.length > 0 && !badgeColumns.some((column) => column.name === 'pairing_code')) {
    db.exec('DROP TABLE IF EXISTS quest_submissions; DROP TABLE IF EXISTS badges;');
  }
  db.exec(SCHEMA_SQL);
}

export function openDatabase(path: string): Database {
  if (path !== MEMORY_DB) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path, { create: true });
  if (path !== MEMORY_DB) {
    // WAL keeps box webhooks from blocking on PWA reads.
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

export function toBadge(row: BadgeRow): Badge {
  return {
    badgeId: row.badge_id,
    name: row.name,
    email: row.email,
    publicKey: row.public_key,
    pairingCode: row.pairing_code,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function toAward(row: AwardRow): Award {
  return {
    badgeId: row.badge_id,
    item: row.item,
    box: row.box,
    awardedAt: row.awarded_at,
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
