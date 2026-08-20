import type { Database } from 'bun:sqlite';
import {
  ANIMALS,
  animalForBadge,
  type Animal,
  type AnimalId,
  type Badge,
  type BadgeSummary,
} from '@htn/shared';
import { all, count, one, run, toBadge } from '../db/index.ts';
import type { BadgeRow } from '../db/schema.ts';
import { getActiveSession } from './sessions.ts';
import { emptyVault, getVault } from './vaults.ts';

export interface UpsertBadgeInput {
  badgeId: string;
  name: string;
  email: string;
}

/** Resolves the catalog animal from the stored id, re-deriving if it ever drifts. */
export function animalFor(badge: Badge): Animal {
  return ANIMALS.find((a) => a.id === badge.animal) ?? animalForBadge(badge.badgeId);
}

/** u8 written to the vault account so the chain can render the animal. */
export function animalCodeFor(badge: Badge): number {
  const index = ANIMALS.findIndex((a) => a.id === badge.animal);
  return index >= 0 ? index : 0;
}

export function getBadge(db: Database, badgeId: string): Badge | null {
  const row = one<BadgeRow>(db, 'SELECT * FROM badges WHERE badge_id = ?', badgeId);
  return row ? toBadge(row) : null;
}

export function badgeCount(db: Database): number {
  return count(db, 'SELECT COUNT(*) AS count FROM badges');
}

/**
 * First sight assigns the animal, which is then frozen for the badge's life.
 * Later syncs may correct the hacker's name/email (registration data changes).
 */
export function upsertBadge(
  db: Database,
  input: UpsertBadgeInput,
  at: string,
): { badge: Badge; created: boolean } {
  const existing = getBadge(db, input.badgeId);
  if (!existing) {
    const animal: AnimalId = animalForBadge(input.badgeId).id;
    run(
      db,
      `INSERT INTO badges (badge_id, name, email, animal, created_at) VALUES (?, ?, ?, ?, ?)`,
      input.badgeId,
      input.name,
      input.email,
      animal,
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

/** Dashboard rows: one per badge, with the counts the operator cares about. */
export function listBadgeSummaries(db: Database): BadgeSummary[] {
  return listBadges(db).map((badge) => ({
    badge,
    itemCount: count(db, 'SELECT COUNT(*) AS count FROM items WHERE badge_id = ?', badge.badgeId),
    stationsVisited: count(
      db,
      'SELECT COUNT(*) AS count FROM visits WHERE badge_id = ?',
      badge.badgeId,
    ),
    activeSession: getActiveSession(db, badge.badgeId),
    vault: getVault(db, badge.badgeId) ?? emptyVault(badge.badgeId),
  }));
}
