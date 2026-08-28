import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CLUSTERS, type SessionView, type SyncResponse } from '@htn/shared';
import { createHarness, json, syncBody, type Harness } from './harness.ts';

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

afterEach(() => {
  h.close();
});

describe('station sync', () => {
  test('creates a badge and session without invoking the chain', async () => {
    const response = await h.sync(syncBody('badge-1', 'station-north'));
    expect(response.status).toBe(200);

    const body = await json<SyncResponse>(response);
    expect(body).toEqual({
      pairingCode: body.pairingCode,
      url: `http://localhost:5173/s/${body.pairingCode}`,
      badgeId: 'badge-1',
      questStatus: null,
    });
    expect(body.pairingCode).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    expect(h.chain.calls.checkProgram).toEqual([]);
    expect(h.chain.calls.payEndpoint).toEqual([]);

    const view = await json<SessionView>(await h.request(`/api/session/${body.pairingCode}`));
    expect(view.session.active).toBe(true);
    expect(view.badge).toMatchObject({ badgeId: 'badge-1' });
    expect(view.station).toMatchObject({ stationId: 'station-north' });
    expect(view.quest).toBeNull();
    expect(view.env).toEqual({
      chainEnabled: true,
      cluster: 'devnet',
      network: CLUSTERS.devnet.caip2,
      usdcMint: CLUSTERS.devnet.usdcMint,
      maxRewardAtomic: 1_000_000,
      payerAddress: '11111111111111111111111111111111',
    });
  });

  test('repeat syncs reuse the pairing code and update registration data', async () => {
    const first = await json<SyncResponse>(await h.sync(syncBody('badge-2', 'station-north')));
    const second = await json<SyncResponse>(
      await h.sync(
        syncBody('badge-2', 'station-north', {
          name: 'Updated Hacker',
          email: 'updated@example.com',
          stationName: 'Updated Station',
        }),
      ),
    );

    expect(second.pairingCode).toBe(first.pairingCode);
    const view = await json<SessionView>(await h.request(`/api/session/${first.pairingCode}`));
    expect(view.badge.name).toBe('Updated Hacker');
    expect(view.badge.email).toBe('updated@example.com');
    expect(view.station.name).toBe('Updated Station');
  });

  test('a different station supersedes the old session and publishes disconnect', async () => {
    const first = await json<SyncResponse>(await h.sync(syncBody('badge-3', 'station-north')));
    const events: unknown[] = [];
    const unsubscribe = h.ctx.live.subscribe(first.pairingCode, (event) => events.push(event));

    const second = await json<SyncResponse>(await h.sync(syncBody('badge-3', 'station-south')));
    unsubscribe();

    expect(second.pairingCode).not.toBe(first.pairingCode);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'disconnected' });
    const stale = await json<SessionView>(await h.request(`/api/session/${first.pairingCode}`));
    expect(stale.session.active).toBe(false);
    expect(stale.session.endedAt).not.toBeNull();
  });
});

describe('disconnect and reads', () => {
  test('disconnect ends only the matching active station session', async () => {
    const synced = await json<SyncResponse>(await h.sync(syncBody('badge-4', 'station-north')));
    const unrelated = await h.disconnect({ badgeId: 'badge-4', stationId: 'station-south' });
    expect(await json<{ ended: boolean }>(unrelated)).toMatchObject({ ended: false });

    const ended = await h.disconnect({ badgeId: 'badge-4', stationId: 'station-north' });
    expect(await json<{ ended: boolean; pairingCode: string | null }>(ended)).toEqual({
      ended: true,
      pairingCode: synced.pairingCode,
    });
    const view = await json<SessionView>(await h.request(`/api/session/${synced.pairingCode}`));
    expect(view.session.active).toBe(false);
  });

  test('unknown pairing codes 404', async () => {
    const response = await h.request('/api/session/ZZZZZZ');
    expect(response.status).toBe(404);
    expect((await json<{ error: string }>(response)).error).toBe('session_not_found');
  });

  test('lists stations and reports the exact health shape', async () => {
    await h.sync(syncBody('badge-5', 'station-north', { stationName: 'North Camp' }));
    await h.sync(syncBody('badge-5', 'station-south'));

    const stations = await json<{ stationId: string; name: string; lastSeenAt: string | null }[]>(
      await h.request('/api/stations'),
    );
    expect(stations.map((station) => station.stationId)).toEqual([
      'station-north',
      'station-south',
    ]);
    expect(stations[0]!.name).toBe('North Camp');

    expect(await json<unknown>(await h.request('/api/health'))).toEqual({
      ok: true,
      chainEnabled: true,
      cluster: 'devnet',
      payerAddress: '11111111111111111111111111111111',
      maxRewardAtomic: 1_000_000,
      badgeCount: 1,
    });
  });
});
