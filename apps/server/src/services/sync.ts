import type { DisconnectRequest, Session, SyncRequest, SyncResponse } from '@htn/shared';
import { pairingUrl } from '../config.ts';
import { animalFor, upsertBadge } from './badges.ts';
import type { ServiceContext } from './context.ts';
import { nowIso } from './context.ts';
import { itemCount, recordVisit } from './items.ts';
import {
  buildSessionView,
  endSessionAtStation,
  startOrRefreshSession,
} from './sessions.ts';
import { upsertStation } from './stations.ts';
import { ensureVault } from './vaults.ts';

/** Pushes the current state of a session to any attached PWA. */
export function publishState(ctx: ServiceContext, session: Session): void {
  const view = buildSessionView(ctx.db, session);
  if (view) ctx.live.publish(session.pairingCode, { type: 'state', view });
}

/**
 * A Sync Station saw a badge.
 *
 * Idempotent by construction: the badge/station upserts are conditional, the
 * visit insert is guarded by a unique constraint, and an already-active session
 * at the same station keeps its pairing code. Hubs can therefore re-POST as often
 * as they like (they do — every few seconds while a hacker is in range).
 */
export async function handleSync(ctx: ServiceContext, request: SyncRequest): Promise<SyncResponse> {
  const at = nowIso();

  const { badge } = upsertBadge(ctx.db, request.badge, at);
  upsertStation(ctx.db, request.stationId, request.stationName, at);
  await ensureVault(ctx.db, ctx.chain, badge, at);

  const { session, superseded } = startOrRefreshSession(
    ctx.db,
    badge.badgeId,
    request.stationId,
    at,
  );

  // The hacker crossed the wilderness: tell the old station's page it went stale.
  if (superseded) {
    ctx.live.publish(superseded.pairingCode, { type: 'disconnected', at });
  }

  const granted = await recordVisit(ctx.db, ctx.chain, {
    badgeId: badge.badgeId,
    stationId: request.stationId,
    pairingCode: session.pairingCode,
    rssi: request.rssi,
    at,
  });

  if (granted) {
    ctx.live.publish(session.pairingCode, { type: 'item', item: granted });
  }
  publishState(ctx, session);

  return {
    pairingCode: session.pairingCode,
    url: pairingUrl(ctx.config, session.pairingCode),
    badgeId: badge.badgeId,
    animal: animalFor(badge).id,
    granted: granted
      ? [{ name: granted.name, slot: granted.slot, rarity: granted.rarity }]
      : [],
    itemCount: itemCount(ctx.db, badge.badgeId),
  };
}

export interface DisconnectResult {
  ended: boolean;
  session: Session | null;
}

/** The badge dropped out of ESP-NOW range of the station that reported it. */
export function handleDisconnect(
  ctx: ServiceContext,
  request: DisconnectRequest,
): DisconnectResult {
  const at = nowIso();
  const session = endSessionAtStation(ctx.db, request.badgeId, request.stationId, at);
  if (!session) return { ended: false, session: null };

  ctx.live.publish(session.pairingCode, { type: 'disconnected', at });
  publishState(ctx, session);
  return { ended: true, session };
}
