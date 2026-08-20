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
  animal     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stations (
  station_id   TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  blurb        TEXT NOT NULL,
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

-- One row per (badge, station) pair, ever. Its absence is what makes a station
-- "new" and therefore worth an item.
CREATE TABLE IF NOT EXISTS visits (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  badge_id      TEXT NOT NULL REFERENCES badges(badge_id) ON DELETE CASCADE,
  station_id    TEXT NOT NULL REFERENCES stations(station_id) ON DELETE CASCADE,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  visit_count   INTEGER NOT NULL DEFAULT 1,
  last_rssi     INTEGER,
  UNIQUE(badge_id, station_id)
);
CREATE INDEX IF NOT EXISTS idx_visits_badge ON visits(badge_id);
CREATE INDEX IF NOT EXISTS idx_visits_station ON visits(station_id);

CREATE TABLE IF NOT EXISTS items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  badge_id        TEXT NOT NULL REFERENCES badges(badge_id) ON DELETE CASCADE,
  station_id      TEXT NOT NULL REFERENCES stations(station_id) ON DELETE CASCADE,
  -- 0-based position within this badge's vault; what the on-chain item PDA is seeded by.
  item_index      INTEGER NOT NULL,
  item_key        TEXT NOT NULL,
  name            TEXT NOT NULL,
  slot            TEXT NOT NULL,
  rarity          TEXT NOT NULL,
  code            INTEGER NOT NULL,
  minted_at       TEXT NOT NULL,
  asset_address   TEXT,
  signature       TEXT,
  withdrawn       INTEGER NOT NULL DEFAULT 0,
  -- Session the item was earned in, so the PWA can play the unlock animation once.
  granted_session TEXT REFERENCES sessions(pairing_code) ON DELETE SET NULL,
  UNIQUE(badge_id, station_id),
  UNIQUE(badge_id, item_index)
);
CREATE INDEX IF NOT EXISTS idx_items_badge ON items(badge_id);
CREATE INDEX IF NOT EXISTS idx_items_session ON items(granted_session);

CREATE TABLE IF NOT EXISTS vaults (
  badge_id      TEXT PRIMARY KEY REFERENCES badges(badge_id) ON DELETE CASCADE,
  vault_address TEXT,
  owner_wallet  TEXT,
  claimed_at    TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vaults_owner ON vaults(owner_wallet);
`;

/** Child-first order, so wiping in dev never trips a foreign key. */
export const TABLES_IN_DELETE_ORDER = [
  'items',
  'visits',
  'sessions',
  'vaults',
  'badges',
  'stations',
] as const;

export interface BadgeRow {
  badge_id: string;
  name: string;
  email: string;
  animal: string;
  created_at: string;
}

export interface StationRow {
  station_id: string;
  name: string;
  blurb: string;
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

export interface ItemRow {
  id: number;
  badge_id: string;
  station_id: string;
  item_index: number;
  item_key: string;
  name: string;
  slot: string;
  rarity: string;
  code: number;
  minted_at: string;
  asset_address: string | null;
  signature: string | null;
  withdrawn: number;
  granted_session: string | null;
}

export interface VisitRow {
  id: number;
  badge_id: string;
  station_id: string;
  first_seen_at: string;
  last_seen_at: string;
  visit_count: number;
  last_rssi: number | null;
}

export interface VaultRow {
  badge_id: string;
  vault_address: string | null;
  owner_wallet: string | null;
  claimed_at: string | null;
  created_at: string;
}

export interface CountRow {
  count: number;
}
