import { randomBytes } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import type { Badge, BadgeSummary } from '@htn/shared';
import { all, count, one, run, toBadge } from '../db/index.ts';
import type { BadgeRow } from '../db/schema.ts';
import { listAwards } from './awards.ts';
import { getQuestSubmission } from './quests.ts';

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;

function randomCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return code;
}

export function generatePairingCode(db: Database): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    const code = randomCode();
    const taken = one<BadgeRow>(db, 'SELECT * FROM badges WHERE pairing_code = ?', code);
    if (!taken) return code;
  }
  throw new Error('could not allocate a unique pairing code');
}

export function getBadge(db: Database, badgeId: string): Badge | null {
  const row = one<BadgeRow>(db, 'SELECT * FROM badges WHERE badge_id = ?', badgeId);
  return row ? toBadge(row) : null;
}

export function getBadgeByPairingCode(db: Database, pairingCode: string): Badge | null {
  const row = one<BadgeRow>(db, 'SELECT * FROM badges WHERE pairing_code = ?', pairingCode);
  return row ? toBadge(row) : null;
}

export function badgeCount(db: Database): number {
  return count(db, 'SELECT COUNT(*) AS count FROM badges');
}

export function listBadges(db: Database): Badge[] {
  return all<BadgeRow>(db, 'SELECT * FROM badges ORDER BY created_at ASC, badge_id ASC').map(
    toBadge,
  );
}

export function upsertBadge(
  db: Database,
  input: { badgeId: string; name: string; email: string; publicKey: string },
  at: string,
): Badge {
  const existing = getBadge(db, input.badgeId);
  if (!existing) {
    const pairingCode = generatePairingCode(db);
    run(
      db,
      `INSERT INTO badges
         (badge_id, name, email, public_key, pairing_code, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      input.badgeId,
      input.name,
      input.email,
      input.publicKey,
      pairingCode,
      at,
      at,
    );
  } else {
    run(
      db,
      `UPDATE badges SET
         name = CASE WHEN ? <> '' THEN ? ELSE name END,
         email = CASE WHEN ? <> '' THEN ? ELSE email END,
         public_key = CASE WHEN ? <> '' THEN ? ELSE public_key END,
         last_seen_at = ?
       WHERE badge_id = ?`,
      input.name,
      input.name,
      input.email,
      input.email,
      input.publicKey,
      input.publicKey,
      at,
      input.badgeId,
    );
  }

  const badge = getBadge(db, input.badgeId);
  if (!badge) throw new Error(`badge ${input.badgeId} vanished during upsert`);
  return badge;
}

export function listBadgeSummaries(db: Database): BadgeSummary[] {
  return listBadges(db).map((badge) => ({
    badge,
    items: listAwards(db, badge.badgeId).map((award) => award.item),
    quest: getQuestSubmission(db, badge.badgeId),
  }));
}
