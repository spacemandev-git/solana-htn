import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Badge, BadgeSummary, QuestSubmission, Session, SyncResponse } from '@htn/shared';
import {
  createHarness,
  json,
  questBody,
  syncBody,
  waitForQuest,
  type Harness,
} from './harness.ts';

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

afterEach(() => {
  h.close();
});

interface BadgeDetail {
  badge: Badge;
  sessions: Session[];
  quest: QuestSubmission | null;
}

describe('badge administration', () => {
  test('lists the active session and current quest for each badge', async () => {
    await h.sync(syncBody('badge-a', 'station-north'));
    const current = await json<SyncResponse>(await h.sync(syncBody('badge-a', 'station-south')));
    const second = await json<SyncResponse>(await h.sync(syncBody('badge-b', 'station-east')));
    await h.disconnect({ badgeId: 'badge-b', stationId: 'station-east' });
    await h.post('/api/quest/submit', questBody(current.pairingCode));
    await waitForQuest(h, 'badge-a');

    const summaries = await json<BadgeSummary[]>(await h.request('/api/badges'));
    const byId = new Map(summaries.map((summary) => [summary.badge.badgeId, summary]));
    expect(byId.get('badge-a')?.activeSession?.stationId).toBe('station-south');
    expect(byId.get('badge-a')?.quest?.status).toBe('completed');
    expect(byId.get('badge-b')?.activeSession).toBeNull();
    expect(byId.get('badge-b')?.quest).toBeNull();
    expect(second.questStatus).toBeNull();
  });

  test('badge detail contains only badge, sessions and quest', async () => {
    await h.sync(syncBody('badge-c', 'station-north'));
    const current = await json<SyncResponse>(await h.sync(syncBody('badge-c', 'station-south')));
    await h.post('/api/quest/submit', questBody(current.pairingCode));
    await waitForQuest(h, 'badge-c');

    const detail = await json<BadgeDetail>(await h.request('/api/badges/badge-c'));
    expect(Object.keys(detail).sort()).toEqual(['badge', 'quest', 'sessions']);
    expect(detail.sessions).toHaveLength(2);
    expect(detail.quest?.status).toBe('completed');
  });

  test('unknown badges 404 and reset wipes all tables', async () => {
    expect((await h.request('/api/badges/nope')).status).toBe(404);
    await h.sync(syncBody('badge-d', 'station-north'));
    expect(await json<BadgeSummary[]>(await h.request('/api/badges'))).toHaveLength(1);

    expect((await h.post('/api/dev/reset', {})).status).toBe(200);
    expect(await json<BadgeSummary[]>(await h.request('/api/badges'))).toEqual([]);
    expect(await json<unknown[]>(await h.request('/api/stations'))).toEqual([]);
  });
});
