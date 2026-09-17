import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { BadgeSummary, BoxResponse } from '@htn/shared';
import {
  boxBody,
  createHarness,
  json,
  questBody,
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

describe('badge administration', () => {
  test('lists item ids and current quest for each badge', async () => {
    const first = await json<BoxResponse>(await h.box(boxBody('badge-a', 'hardware-hub')));
    await h.box(boxBody('badge-a', 'extended-bay'));
    await h.box(boxBody('badge-b', 'mentor-cafe'));
    const pairingCode = first.chain_link.split('/').at(-1)!;
    await h.post('/api/quest/submit', questBody(pairingCode));
    await waitForQuest(h, 'badge-a');

    const summaries = await json<BadgeSummary[]>(await h.request('/api/badges'));
    const byId = new Map(summaries.map((summary) => [summary.badge.badgeId, summary]));
    expect(byId.get('badge-a')?.items).toHaveLength(2);
    expect(byId.get('badge-a')?.quest?.status).toBe('completed');
    expect(byId.get('badge-b')?.items).toHaveLength(1);
    expect(byId.get('badge-b')?.quest).toBeNull();
  });

  test('reset wipes badges, awards and quests', async () => {
    const response = await json<BoxResponse>(await h.box(boxBody('badge-c', 'hardware-hub')));
    await h.post('/api/quest/submit', questBody(response.chain_link.split('/').at(-1)!));
    await waitForQuest(h, 'badge-c');
    expect(await json<BadgeSummary[]>(await h.request('/api/badges'))).toHaveLength(1);

    expect((await h.post('/api/dev/reset', {})).status).toBe(200);
    expect(await json<BadgeSummary[]>(await h.request('/api/badges'))).toEqual([]);
  });

  test('removed dashboard routes return 404', async () => {
    expect((await h.request('/api/badges/nope')).status).toBe(404);
    expect((await h.request('/api/stations')).status).toBe(404);
  });
});
