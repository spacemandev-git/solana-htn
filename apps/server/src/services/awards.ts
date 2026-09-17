import type { Database } from 'bun:sqlite';
import type { Award } from '@htn/shared';
import { all, run, toAward } from '../db/index.ts';
import type { AwardRow } from '../db/schema.ts';

export function listAwards(db: Database, badgeId: string): Award[] {
  return all<AwardRow>(
    db,
    'SELECT * FROM awards WHERE badge_id = ? ORDER BY awarded_at ASC, item ASC',
    badgeId,
  ).map(toAward);
}

export function awardsAtBox(db: Database, badgeId: string, box: string): Award[] {
  return all<AwardRow>(
    db,
    `SELECT * FROM awards
     WHERE badge_id = ? AND box = ?
     ORDER BY awarded_at ASC, item ASC`,
    badgeId,
    box,
  ).map(toAward);
}

export function grantAward(
  db: Database,
  badgeId: string,
  item: string,
  box: string,
  at: string,
): void {
  run(
    db,
    `INSERT OR IGNORE INTO awards (badge_id, item, box, awarded_at)
     VALUES (?, ?, ?, ?)`,
    badgeId,
    item,
    box,
    at,
  );
}
