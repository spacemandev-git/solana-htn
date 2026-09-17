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
  badge_id     TEXT PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  public_key   TEXT NOT NULL DEFAULT '',
  pairing_code TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS awards (
  badge_id   TEXT NOT NULL REFERENCES badges(badge_id) ON DELETE CASCADE,
  item       TEXT NOT NULL,
  box        TEXT NOT NULL,
  awarded_at TEXT NOT NULL,
  PRIMARY KEY (badge_id, item)
);
CREATE INDEX IF NOT EXISTS idx_awards_badge_box ON awards(badge_id, box);

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
export const TABLES_IN_DELETE_ORDER = ['quest_submissions', 'awards', 'badges'] as const;

export interface BadgeRow {
  badge_id: string;
  name: string;
  email: string;
  public_key: string;
  pairing_code: string;
  created_at: string;
  last_seen_at: string;
}

export interface AwardRow {
  badge_id: string;
  item: string;
  box: string;
  awarded_at: string;
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
