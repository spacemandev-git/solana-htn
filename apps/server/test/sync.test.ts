import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ANIMALS, animalForBadge, itemForVisit } from '@htn/shared';
import type { SessionView, SyncResponse } from '@htn/shared';
import { createHarness, json, syncBody, type Harness } from './harness.ts';

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

afterEach(() => {
  h.close();
});

describe('first sync', () => {
  test('creates the badge, vault, session and exactly one item', async () => {
    const response = await h.sync(syncBody('badge-1', 'station-north'));
    expect(response.status).toBe(200);

    const body = await json<SyncResponse>(response);
    expect(body.badgeId).toBe('badge-1');
    expect(body.animal).toBe(animalForBadge('badge-1').id);
    expect(ANIMALS.some((a) => a.id === body.animal)).toBe(true);
    expect(body.pairingCode).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    expect(body.url).toBe(`http://localhost:5173/s/${body.pairingCode}`);
    expect(body.itemCount).toBe(1);
    expect(body.granted).toHaveLength(1);

    const expected = itemForVisit('badge-1', 'station-north');
    expect(body.granted[0]).toEqual({
      name: expected.name,
      slot: expected.slot,
      rarity: expected.rarity,
    });

    const view = await json<SessionView>(await h.request(`/api/session/${body.pairingCode}`));
    expect(body.animal).toBe(view.badge.animal);
    expect(view.items).toHaveLength(1);
    expect(view.newItemIds).toEqual([view.items[0]!.id]);
    expect(view.vault.badgeId).toBe('badge-1');
    expect(view.vault.ownerWallet).toBeNull();
    expect(view.session.active).toBe(true);
    expect(view.station.stationId).toBe('station-north');
  });
});

describe('idempotency', () => {
  test('a repeat sync at the same station grants nothing and reuses the code', async () => {
    const first = await json<SyncResponse>(await h.sync(syncBody('badge-2', 'station-north')));

    for (let i = 0; i < 3; i++) {
      const repeat = await json<SyncResponse>(await h.sync(syncBody('badge-2', 'station-north')));
      expect(repeat.pairingCode).toBe(first.pairingCode);
      expect(repeat.granted).toHaveLength(0);
      expect(repeat.itemCount).toBe(1);
    }

    const view = await json<SessionView>(await h.request(`/api/session/${first.pairingCode}`));
    expect(view.items).toHaveLength(1);
  });

  test('a second station grants a second item and a fresh pairing code', async () => {
    const first = await json<SyncResponse>(await h.sync(syncBody('badge-3', 'station-north')));
    const second = await json<SyncResponse>(await h.sync(syncBody('badge-3', 'station-south')));

    expect(second.pairingCode).not.toBe(first.pairingCode);
    expect(second.granted).toHaveLength(1);
    expect(second.itemCount).toBe(2);

    const view = await json<SessionView>(await h.request(`/api/session/${second.pairingCode}`));
    expect(view.items).toHaveLength(2);
    expect(view.items.map((i) => i.stationId).sort()).toEqual(['station-north', 'station-south']);
    // Only the item earned in *this* session animates.
    expect(view.newItemIds).toHaveLength(1);

    // Walking to a new town closes the old session.
    const stale = await json<SessionView>(await h.request(`/api/session/${first.pairingCode}`));
    expect(stale.session.active).toBe(false);
    expect(stale.session.endedAt).not.toBeNull();
  });

  test('returning to the first station does not re-grant its item', async () => {
    await h.sync(syncBody('badge-4', 'station-north'));
    await h.sync(syncBody('badge-4', 'station-south'));
    const back = await json<SyncResponse>(await h.sync(syncBody('badge-4', 'station-north')));

    expect(back.granted).toHaveLength(0);
    expect(back.itemCount).toBe(2);
  });
});

describe('disconnect', () => {
  test('ends the session and the view reports active:false', async () => {
    const synced = await json<SyncResponse>(await h.sync(syncBody('badge-5', 'station-north')));

    const before = await json<SessionView>(await h.request(`/api/session/${synced.pairingCode}`));
    expect(before.session.active).toBe(true);

    const response = await h.disconnect({ badgeId: 'badge-5', stationId: 'station-north' });
    expect(response.status).toBe(200);
    expect(await json<{ ended: boolean }>(response)).toMatchObject({ ended: true });

    const after = await json<SessionView>(await h.request(`/api/session/${synced.pairingCode}`));
    expect(after.session.active).toBe(false);
    expect(after.session.endedAt).not.toBeNull();
    // The hacker keeps their loot after walking into the wilderness.
    expect(after.items).toHaveLength(1);
  });

  test('a disconnect from an unrelated station is a no-op', async () => {
    const synced = await json<SyncResponse>(await h.sync(syncBody('badge-6', 'station-north')));
    await h.disconnect({ badgeId: 'badge-6', stationId: 'station-south' });

    const view = await json<SessionView>(await h.request(`/api/session/${synced.pairingCode}`));
    expect(view.session.active).toBe(true);
  });
});

describe('session view', () => {
  test('unknown pairing codes 404', async () => {
    const response = await h.request('/api/session/ZZZZZZ');
    expect(response.status).toBe(404);
    expect((await json<{ error: string }>(response)).error).toBe('session_not_found');
  });

  test('carries the animal, station and item detail', async () => {
    const synced = await json<SyncResponse>(await h.sync(syncBody('badge-7', 'station-east')));
    const view = await json<SessionView>(await h.request(`/api/session/${synced.pairingCode}`));

    const animal = animalForBadge('badge-7');
    expect(view.animal).toEqual({
      id: animal.id,
      name: animal.name,
      emoji: animal.emoji,
      blurb: animal.blurb,
    });

    const expected = itemForVisit('badge-7', 'station-east');
    expect(view.items[0]).toMatchObject({
      badgeId: 'badge-7',
      stationId: 'station-east',
      itemKey: expected.itemKey,
      name: expected.name,
      slot: expected.slot,
      rarity: expected.rarity,
      code: expected.code,
      withdrawn: false,
    });
    expect(view.station.blurb.length).toBeGreaterThan(0);
  });
});

describe('stations + health', () => {
  test('lists stations that have reported in', async () => {
    await h.sync(syncBody('badge-8', 'station-north', { stationName: 'North Camp' }));
    await h.sync(syncBody('badge-8', 'station-south'));

    const stations = await json<{ stationId: string; name: string; lastSeenAt: string | null }[]>(
      await h.request('/api/stations'),
    );
    expect(stations.map((s) => s.stationId)).toEqual(['station-north', 'station-south']);
    expect(stations[0]!.name).toBe('North Camp');
    expect(stations[0]!.lastSeenAt).not.toBeNull();
  });

  test('health reports the disabled chain client', async () => {
    await h.sync(syncBody('badge-9', 'station-north'));
    const health = await json<{
      ok: boolean;
      chainEnabled: boolean;
      programId: string;
      badgeCount: number;
    }>(await h.request('/api/health'));

    expect(health).toEqual({
      ok: true,
      chainEnabled: false,
      programId: 'BadgeEscrow11111111111111111111111111111111',
      badgeCount: 1,
    });
  });
});
