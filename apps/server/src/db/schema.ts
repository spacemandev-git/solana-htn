/**
 * The whole persistence layer, as plain SQL. Executed on every boot; every
 * statement is `IF NOT EXISTS` so it doubles as the migration.
 *
 * Column naming is snake_case in SQLite and camelCase in the API; the mappers in
 * ./index.ts are the only place that bridge translates.
 */
export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS badges (
  badge_id   TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stations (
  station_id   TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  pairing_code TEXT PRIMARY KEY,
  badge_id     TEXT NOT NULL REFERENCES badges(badge_id) ON DELETE CASCADE,
  station_id   TEXT NOT NULL REFERENCES stations(station_id) ON DELETE CASCADE,
  started_at   TEXT NOT NULL,
  ended_at     TEXT,
  last_seen_at TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sessions_badge ON sessions(badge_id, active);
CREATE INDEX IF NOT EXISTS idx_sessions_station ON sessions(station_id);
-- A badge can only be paired to one station at a time: walking to a new hub ends
-- the old session before the new one is inserted.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_one_active_per_badge
  ON sessions(badge_id) WHERE active = 1;

CREATE TABLE IF NOT EXISTS quest_submissions (
  badge_id           TEXT PRIMARY KEY REFERENCES badges(badge_id) ON DELETE CASCADE,
  endpoint_url       TEXT NOT NULL,
  program_id         TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'verifying',
  step               TEXT,
  error              TEXT,
  message            TEXT,
  amount_paid_atomic INTEGER,
  payment_signature  TEXT,
  network            TEXT,
  paid               INTEGER NOT NULL DEFAULT 0,
  submitted_at       TEXT NOT NULL,
  completed_at       TEXT
);
`;

/** Child-first order, so wiping in dev never trips a foreign key. */
export const TABLES_IN_DELETE_ORDER = [
  'quest_submissions',
  'sessions',
  'badges',
  'stations',
] as const;

export interface BadgeRow {
  badge_id: string;
  name: string;
  email: string;
  created_at: string;
}

export interface StationRow {
  station_id: string;
  name: string;
  last_seen_at: string | null;
}

export interface SessionRow {
  pairing_code: string;
  badge_id: string;
  station_id: string;
  started_at: string;
  ended_at: string | null;
  last_seen_at: string;
  active: number;
}

export interface QuestSubmissionRow {
  badge_id: string;
  endpoint_url: string;
  program_id: string;
  status: string;
  step: string | null;
  error: string | null;
  message: string | null;
  amount_paid_atomic: number | null;
  payment_signature: string | null;
  network: string | null;
  paid: number;
  submitted_at: string;
  completed_at: string | null;
}

export interface CountRow {
  count: number;
}
