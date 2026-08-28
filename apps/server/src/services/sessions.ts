import { randomBytes } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { CLUSTERS, type Session, type SessionView } from '@htn/shared';
import { all, one, run, toSession } from '../db/index.ts';
import type { SessionRow } from '../db/schema.ts';
import { getBadge } from './badges.ts';
import type { ServiceContext } from './context.ts';
import { getQuestSubmission } from './quests.ts';
import { getStation } from './stations.ts';

/** Crockford-ish: no 0/O/1/I/L, so a code read off a badge screen can't be mistyped. */
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

/** Codes are the public URL, so collisions must be resolved, not tolerated. */
export function generatePairingCode(db: Database): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    const code = randomCode();
    const taken = one<SessionRow>(db, 'SELECT * FROM sessions WHERE pairing_code = ?', code);
    if (!taken) return code;
  }
  throw new Error('could not allocate a unique pairing code');
}

export function getSession(db: Database, pairingCode: string): Session | null {
  const row = one<SessionRow>(db, 'SELECT * FROM sessions WHERE pairing_code = ?', pairingCode);
  return row ? toSession(row) : null;
}

export function getActiveSession(db: Database, badgeId: string): Session | null {
  const row = one<SessionRow>(
    db,
    'SELECT * FROM sessions WHERE badge_id = ? AND active = 1',
    badgeId,
  );
  return row ? toSession(row) : null;
}

export function listSessionsForBadge(db: Database, badgeId: string): Session[] {
  return all<SessionRow>(
    db,
    'SELECT * FROM sessions WHERE badge_id = ? ORDER BY started_at DESC, pairing_code DESC',
    badgeId,
  ).map(toSession);
}

export interface SessionTransition {
  session: Session;
  /** True when the badge was already paired to this station (repeat sync). */
  reused: boolean;
  /** Session at a *different* station that this sync superseded, if any. */
  superseded: Session | null;
}

/**
 * The pairing state machine for a sync:
 *  - same station, still active  -> keep the code, bump last_seen_at
 *  - different station           -> end the old session, mint a new code
 *  - nothing active              -> new session
 */
export function startOrRefreshSession(
  db: Database,
  badgeId: string,
  stationId: string,
  at: string,
): SessionTransition {
  const existing = getActiveSession(db, badgeId);

  if (existing && existing.stationId === stationId) {
    run(db, 'UPDATE sessions SET last_seen_at = ? WHERE pairing_code = ?', at, existing.pairingCode);
    return { session: existing, reused: true, superseded: null };
  }

  let superseded: Session | null = null;
  if (existing) {
    superseded = endSessionByCode(db, existing.pairingCode, at) ?? null;
  }

  const pairingCode = generatePairingCode(db);
  run(
    db,
    `INSERT INTO sessions (pairing_code, badge_id, station_id, started_at, ended_at, last_seen_at, active)
     VALUES (?, ?, ?, ?, NULL, ?, 1)`,
    pairingCode,
    badgeId,
    stationId,
    at,
    at,
  );

  const session = getSession(db, pairingCode);
  if (!session) throw new Error(`session ${pairingCode} vanished during insert`);
  return { session, reused: false, superseded };
}

export function endSessionByCode(db: Database, pairingCode: string, at: string): Session | null {
  run(
    db,
    'UPDATE sessions SET active = 0, ended_at = ? WHERE pairing_code = ? AND active = 1',
    at,
    pairingCode,
  );
  return getSession(db, pairingCode);
}

/** Ends the badge's active session, but only if it is the station that reported it. */
export function endSessionAtStation(
  db: Database,
  badgeId: string,
  stationId: string,
  at: string,
): Session | null {
  const active = getActiveSession(db, badgeId);
  if (!active || active.stationId !== stationId) return null;
  return endSessionByCode(db, active.pairingCode, at);
}

/** Assembles everything the PWA renders. Null when a referenced row is missing. */
export function buildSessionView(ctx: ServiceContext, session: Session): SessionView | null {
  const badge = getBadge(ctx.db, session.badgeId);
  const station = getStation(ctx.db, session.stationId);
  if (!badge || !station) return null;

  return {
    session,
    badge,
    station,
    quest: getQuestSubmission(ctx.db, badge.badgeId),
    env: {
      chainEnabled: ctx.chain.enabled,
      cluster: ctx.config.solanaCluster,
      network: CLUSTERS[ctx.config.solanaCluster].caip2,
      usdcMint: ctx.config.usdcMint,
      maxRewardAtomic: ctx.config.maxRewardAtomic,
      payerAddress: ctx.chain.payerAddress,
    },
  };
}

export function sessionViewByCode(ctx: ServiceContext, pairingCode: string): SessionView | null {
  const session = getSession(ctx.db, pairingCode);
  return session ? buildSessionView(ctx, session) : null;
}
