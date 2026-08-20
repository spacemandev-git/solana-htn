import type { Database } from 'bun:sqlite';
import { hash32, type Station } from '@htn/shared';
import { all, one, run, toStation } from '../db/index.ts';
import type { StationRow } from '../db/schema.ts';

/** Wilderness-and-towns flavour text, picked deterministically per station id. */
const BLURBS = [
  'A warm hub of cables and questionable coffee.',
  'Someone left a soldering iron on. Again.',
  'The whiteboard here has never been erased.',
  'Beanbags, blue light, and the hum of a fan.',
  'A quiet corner where the wifi actually works.',
  'Snack table adjacent. Strategically placed.',
  'Cardboard signage, industrial-grade optimism.',
  'The projector shows a terminal nobody owns.',
  'Extension cords braided like river reeds.',
  'A town at the edge of the wilderness.',
] as const;

export function blurbForStation(stationId: string): string {
  return BLURBS[hash32(`station:${stationId}`) % BLURBS.length]!;
}

/** Falls back to a readable label when a station POSTs without a name. */
export function defaultStationName(stationId: string): string {
  return stationId
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || stationId;
}

export function getStation(db: Database, stationId: string): Station | null {
  const row = one<StationRow>(db, 'SELECT * FROM stations WHERE station_id = ?', stationId);
  return row ? toStation(row) : null;
}

export function listStations(db: Database): Station[] {
  return all<StationRow>(db, 'SELECT * FROM stations ORDER BY station_id ASC').map(toStation);
}

/**
 * Registers the station on first contact and refreshes `last_seen_at` after.
 * A name is only overwritten when the station actually sent one.
 */
export function upsertStation(
  db: Database,
  stationId: string,
  stationName: string | undefined,
  at: string,
): Station {
  run(
    db,
    `INSERT INTO stations (station_id, name, blurb, last_seen_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(station_id) DO NOTHING`,
    stationId,
    stationName ?? defaultStationName(stationId),
    blurbForStation(stationId),
    at,
  );
  if (stationName) {
    run(db, 'UPDATE stations SET name = ? WHERE station_id = ?', stationName, stationId);
  }
  run(db, 'UPDATE stations SET last_seen_at = ? WHERE station_id = ?', at, stationId);

  const station = getStation(db, stationId);
  if (!station) throw new Error(`station ${stationId} vanished during upsert`);
  return station;
}
