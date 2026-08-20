import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { animalForBadge, claimMessage } from '@htn/shared';
import type { Badge, BadgeSummary, Item, Session, SyncResponse, Vault } from '@htn/shared';
import { createHarness, json, syncBody, type Harness } from './harness.ts';

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

afterEach(() => {
  h.close();
});

interface BadgeDetail {
  badge: Badge;
  animal: { id: string; name: string; emoji: string; blurb: string };
  items: Item[];
  visits: { stationId: string; visitCount: number }[];
  vault: Vault;
  sessions: Session[];
}

describe('GET /api/badges', () => {
  test('aggregates counts, sessions and vaults across badges', async () => {
    // Badge A: two towns, still paired to the second one.
    await h.sync(syncBody('badge-a', 'station-north'));
    await h.sync(syncBody('badge-a', 'station-south'));
    // Badge B: one town, then walks off into the wilderness.
    const bSync = await json<SyncResponse>(await h.sync(syncBody('badge-b', 'station-north')));
    await h.disconnect({ badgeId: 'badge-b', stationId: 'station-north' });
    // Badge C: repeats at one town — one item only.
    await h.sync(syncBody('badge-c', 'station-east'));
    await h.sync(syncBody('badge-c', 'station-east'));

    const summaries = await json<BadgeSummary[]>(await h.request('/api/badges'));
    expect(summaries).toHaveLength(3);

    const byId = new Map(summaries.map((s) => [s.badge.badgeId, s]));

    const a = byId.get('badge-a')!;
    expect(a.itemCount).toBe(2);
    expect(a.stationsVisited).toBe(2);
    expect(a.activeSession?.stationId).toBe('station-south');
    expect(a.badge.animal).toBe(animalForBadge('badge-a').id);
    expect(a.vault.ownerWallet).toBeNull();

    const b = byId.get('badge-b')!;
    expect(b.itemCount).toBe(1);
    expect(b.stationsVisited).toBe(1);
    expect(b.activeSession).toBeNull();
    expect(bSync.itemCount).toBe(1);

    const c = byId.get('badge-c')!;
    expect(c.itemCount).toBe(1);
    expect(c.stationsVisited).toBe(1);
    expect(c.activeSession?.stationId).toBe('station-east');
  });

  test('reflects a claimed vault', async () => {
    const synced = await json<SyncResponse>(await h.sync(syncBody('badge-v', 'station-north')));
    const keypair = nacl.sign.keyPair();
    const wallet = bs58.encode(keypair.publicKey);
    const signature = bs58.encode(
      nacl.sign.detached(
        new TextEncoder().encode(claimMessage(synced.pairingCode, wallet)),
        keypair.secretKey,
      ),
    );
    await h.post('/api/vault/claim', { pairingCode: synced.pairingCode, wallet, signature });

    const summaries = await json<BadgeSummary[]>(await h.request('/api/badges'));
    expect(summaries[0]!.vault.ownerWallet).toBe(wallet);
  });

  test('is empty on a fresh database', async () => {
    expect(await json<BadgeSummary[]>(await h.request('/api/badges'))).toEqual([]);
  });
});

describe('GET /api/badges/:badgeId', () => {
  test('returns badge, items, visits, vault and sessions', async () => {
    await h.sync(syncBody('badge-d', 'station-north'));
    await h.sync(syncBody('badge-d', 'station-north'));
    await h.sync(syncBody('badge-d', 'station-south'));

    const detail = await json<BadgeDetail>(await h.request('/api/badges/badge-d'));
    expect(detail.badge.badgeId).toBe('badge-d');
    expect(detail.animal.id).toBe(animalForBadge('badge-d').id);
    expect(detail.items).toHaveLength(2);
    expect(detail.visits).toHaveLength(2);
    expect(detail.visits.find((v) => v.stationId === 'station-north')!.visitCount).toBe(2);
    expect(detail.vault.badgeId).toBe('badge-d');
    expect(detail.sessions).toHaveLength(2);
    expect(detail.sessions.filter((s) => s.active)).toHaveLength(1);
  });

  test('404s for an unknown badge', async () => {
    const response = await h.request('/api/badges/nope');
    expect(response.status).toBe(404);
  });
});

describe('POST /api/dev/reset', () => {
  test('wipes every table', async () => {
    await h.sync(syncBody('badge-e', 'station-north'));
    expect(await json<BadgeSummary[]>(await h.request('/api/badges'))).toHaveLength(1);

    const response = await h.post('/api/dev/reset', {});
    expect(response.status).toBe(200);

    expect(await json<BadgeSummary[]>(await h.request('/api/badges'))).toEqual([]);
    expect(await json<unknown[]>(await h.request('/api/stations'))).toEqual([]);
  });
});
