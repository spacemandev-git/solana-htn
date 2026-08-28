import type { Database } from 'bun:sqlite';
import type { Badge, BadgeSummary } from '@htn/shared';
import { all, count, one, run, toBadge } from '../db/index.ts';
import type { BadgeRow } from '../db/schema.ts';
import { getQuestSubmission } from './quests.ts';
import { getActiveSession } from './sessions.ts';

export interface UpsertBadgeInput {
  badgeId: string;
  name: string;
  email: string;
}

export function getBadge(db: Database, badgeId: string): Badge | null {
  const row = one<BadgeRow>(db, 'SELECT * FROM badges WHERE badge_id = ?', badgeId);
  return row ? toBadge(row) : null;
}

export function badgeCount(db: Database): number {
  return count(db, 'SELECT COUNT(*) AS count FROM badges');
}

/** Later syncs may correct the hacker's name/email as registration data changes. */
export function upsertBadge(
  db: Database,
  input: UpsertBadgeInput,
  at: string,
): { badge: Badge; created: boolean } {
  const existing = getBadge(db, input.badgeId);
  if (!existing) {
    run(
      db,
      'INSERT INTO badges (badge_id, name, email, created_at) VALUES (?, ?, ?, ?)',
      input.badgeId,
      input.name,
      input.email,
      at,
    );
    const badge = getBadge(db, input.badgeId);
    if (!badge) throw new Error(`badge ${input.badgeId} vanished during insert`);
    return { badge, created: true };
  }

  if (existing.name !== input.name || existing.email !== input.email) {
    run(
      db,
      'UPDATE badges SET name = ?, email = ? WHERE badge_id = ?',
      input.name,
      input.email,
      input.badgeId,
    );
    return { badge: { ...existing, name: input.name, email: input.email }, created: false };
  }

  return { badge: existing, created: false };
}

export function listBadges(db: Database): Badge[] {
  return all<BadgeRow>(db, 'SELECT * FROM badges ORDER BY created_at ASC, badge_id ASC').map(
    toBadge,
  );
}

/** Dashboard rows: one per badge with its current session and quest run. */
export function listBadgeSummaries(db: Database): BadgeSummary[] {
  return listBadges(db).map((badge) => ({
    badge,
    activeSession: getActiveSession(db, badge.badgeId),
    quest: getQuestSubmission(db, badge.badgeId),
  }));
}
