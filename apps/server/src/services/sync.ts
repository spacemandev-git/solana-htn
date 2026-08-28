import type { DisconnectRequest, Session, SyncRequest, SyncResponse } from '@htn/shared';
import { pairingUrl } from '../config.ts';
import { upsertBadge } from './badges.ts';
import type { ServiceContext } from './context.ts';
import { nowIso } from './context.ts';
import { getQuestSubmission } from './quests.ts';
import { buildSessionView, endSessionAtStation, startOrRefreshSession } from './sessions.ts';
import { upsertStation } from './stations.ts';

/** Pushes the current state of a session to any attached PWA. */
export function publishState(ctx: ServiceContext, session: Session): void {
  const view = buildSessionView(ctx, session);
  if (view) ctx.live.publish(session.pairingCode, { type: 'state', view });
}

/**
 * A Sync Station saw a badge.
 *
 * Idempotent by construction: the badge/station upserts are conditional and an
 * already-active session at the same station keeps its pairing code. Hubs can
 * therefore re-POST as often as they like.
 */
export function handleSync(ctx: ServiceContext, request: SyncRequest): SyncResponse {
  const at = nowIso();

  const { badge } = upsertBadge(ctx.db, request.badge, at);
  upsertStation(ctx.db, request.stationId, request.stationName, at);

  const { session, superseded } = startOrRefreshSession(
    ctx.db,
    badge.badgeId,
    request.stationId,
    at,
  );

  if (superseded) {
    ctx.live.publish(superseded.pairingCode, { type: 'disconnected', at });
  }
  publishState(ctx, session);

  return {
    pairingCode: session.pairingCode,
    url: pairingUrl(ctx.config, session.pairingCode),
    badgeId: badge.badgeId,
    questStatus: getQuestSubmission(ctx.db, badge.badgeId)?.status ?? null,
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
