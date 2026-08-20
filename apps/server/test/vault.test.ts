import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { claimMessage, withdrawMessage } from '@htn/shared';
import type { ApiError, Item, SessionView, SyncResponse, Vault } from '@htn/shared';
import { createHarness, json, syncBody, type Harness } from './harness.ts';

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

afterEach(() => {
  h.close();
});

interface Wallet {
  address: string;
  sign(message: string): string;
}

function makeWallet(): Wallet {
  const keypair = nacl.sign.keyPair();
  return {
    address: bs58.encode(keypair.publicKey),
    sign: (message) =>
      bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey)),
  };
}

async function syncOnce(badgeId: string, stationId: string): Promise<SyncResponse> {
  return json<SyncResponse>(await h.sync(syncBody(badgeId, stationId)));
}

/** Withdrawal needs the same wallet proof as claiming. */
function withdrawBody(pairingCode: string, itemId: number, wallet: Wallet) {
  return {
    pairingCode,
    itemId,
    wallet: wallet.address,
    signature: wallet.sign(withdrawMessage(pairingCode, itemId, wallet.address)),
  };
}

describe('vault claim', () => {
  test('rejects a signature that does not match the wallet', async () => {
    const { pairingCode } = await syncOnce('badge-c1', 'station-north');
    const wallet = makeWallet();
    const impostor = makeWallet();

    const response = await h.post('/api/vault/claim', {
      pairingCode,
      wallet: wallet.address,
      signature: impostor.sign(claimMessage(pairingCode, wallet.address)),
    });

    expect(response.status).toBe(401);
    expect((await json<ApiError>(response)).error).toBe('bad_signature');
  });

  test('rejects a signature over the wrong message', async () => {
    const { pairingCode } = await syncOnce('badge-c2', 'station-north');
    const wallet = makeWallet();

    const response = await h.post('/api/vault/claim', {
      pairingCode,
      wallet: wallet.address,
      signature: wallet.sign(claimMessage('WRONG1', wallet.address)),
    });

    expect(response.status).toBe(401);
  });

  test('rejects signature garbage without throwing', async () => {
    const { pairingCode } = await syncOnce('badge-c3', 'station-north');
    const wallet = makeWallet();

    const response = await h.post('/api/vault/claim', {
      pairingCode,
      wallet: wallet.address,
      signature: 'not-base58-!!!',
    });

    expect(response.status).toBe(401);
  });

  test('accepts a valid signature and records the wallet', async () => {
    const { pairingCode } = await syncOnce('badge-c4', 'station-north');
    const wallet = makeWallet();

    const response = await h.post('/api/vault/claim', {
      pairingCode,
      wallet: wallet.address,
      signature: wallet.sign(claimMessage(pairingCode, wallet.address)),
    });

    expect(response.status).toBe(200);
    const { vault } = await json<{ vault: Vault }>(response);
    expect(vault.ownerWallet).toBe(wallet.address);
    expect(vault.claimedAt).not.toBeNull();

    const view = await json<SessionView>(await h.request(`/api/session/${pairingCode}`));
    expect(view.vault.ownerWallet).toBe(wallet.address);
  });

  test('a different wallet cannot take over a claimed vault', async () => {
    const { pairingCode } = await syncOnce('badge-c5', 'station-north');
    const first = makeWallet();
    const second = makeWallet();

    await h.post('/api/vault/claim', {
      pairingCode,
      wallet: first.address,
      signature: first.sign(claimMessage(pairingCode, first.address)),
    });

    const response = await h.post('/api/vault/claim', {
      pairingCode,
      wallet: second.address,
      signature: second.sign(claimMessage(pairingCode, second.address)),
    });

    expect(response.status).toBe(409);
    expect((await json<ApiError>(response)).error).toBe('vault_already_claimed');
  });

  test('unknown pairing codes 404', async () => {
    const wallet = makeWallet();
    const response = await h.post('/api/vault/claim', {
      pairingCode: 'ZZZZZZ',
      wallet: wallet.address,
      signature: wallet.sign(claimMessage('ZZZZZZ', wallet.address)),
    });
    expect(response.status).toBe(404);
  });
});

describe('vault withdraw', () => {
  test('is rejected before the vault is claimed, and succeeds after', async () => {
    const { pairingCode } = await syncOnce('badge-w1', 'station-north');
    const view = await json<SessionView>(await h.request(`/api/session/${pairingCode}`));
    const itemId = view.items[0]!.id;

    const wallet = makeWallet();
    const before = await h.post('/api/vault/withdraw', withdrawBody(pairingCode, itemId, wallet));
    expect(before.status).toBe(403);
    expect((await json<ApiError>(before)).error).toBe('vault_not_claimed');

    await h.post('/api/vault/claim', {
      pairingCode,
      wallet: wallet.address,
      signature: wallet.sign(claimMessage(pairingCode, wallet.address)),
    });

    const after = await h.post('/api/vault/withdraw', withdrawBody(pairingCode, itemId, wallet));
    expect(after.status).toBe(200);
    const { item } = await json<{ item: Item }>(after);
    expect(item.id).toBe(itemId);
    expect(item.withdrawn).toBe(true);

    const refreshed = await json<SessionView>(await h.request(`/api/session/${pairingCode}`));
    expect(refreshed.items[0]!.withdrawn).toBe(true);
  });

  test('cannot be repeated for the same item', async () => {
    const { pairingCode } = await syncOnce('badge-w2', 'station-north');
    const view = await json<SessionView>(await h.request(`/api/session/${pairingCode}`));
    const itemId = view.items[0]!.id;
    const wallet = makeWallet();

    await h.post('/api/vault/claim', {
      pairingCode,
      wallet: wallet.address,
      signature: wallet.sign(claimMessage(pairingCode, wallet.address)),
    });
    await h.post('/api/vault/withdraw', withdrawBody(pairingCode, itemId, wallet));

    const repeat = await h.post('/api/vault/withdraw', withdrawBody(pairingCode, itemId, wallet));
    expect(repeat.status).toBe(409);
    expect((await json<ApiError>(repeat)).error).toBe('item_already_withdrawn');
  });

  test("cannot withdraw another badge's item", async () => {
    const mine = await syncOnce('badge-w3', 'station-north');
    const theirs = await syncOnce('badge-w4', 'station-south');
    const theirView = await json<SessionView>(await h.request(`/api/session/${theirs.pairingCode}`));

    const wallet = makeWallet();
    await h.post('/api/vault/claim', {
      pairingCode: mine.pairingCode,
      wallet: wallet.address,
      signature: wallet.sign(claimMessage(mine.pairingCode, wallet.address)),
    });

    const response = await h.post(
      '/api/vault/withdraw',
      withdrawBody(mine.pairingCode, theirView.items[0]!.id, wallet),
    );
    expect(response.status).toBe(404);
    expect((await json<ApiError>(response)).error).toBe('item_not_found');
  });

  test('a wallet that did not claim the vault cannot withdraw from it', async () => {
    const { pairingCode } = await syncOnce('badge-w5', 'station-north');
    const view = await json<SessionView>(await h.request(`/api/session/${pairingCode}`));
    const itemId = view.items[0]!.id;

    const owner = makeWallet();
    await h.post('/api/vault/claim', {
      pairingCode,
      wallet: owner.address,
      signature: owner.sign(claimMessage(pairingCode, owner.address)),
    });

    // A stranger who has seen the badge screen knows the pairing code, but that
    // is not enough to move someone else's assets.
    const stranger = makeWallet();
    const response = await h.post(
      '/api/vault/withdraw',
      withdrawBody(pairingCode, itemId, stranger),
    );
    expect(response.status).toBe(403);
    expect((await json<ApiError>(response)).error).toBe('not_vault_owner');

    const refreshed = await json<SessionView>(await h.request(`/api/session/${pairingCode}`));
    expect(refreshed.items[0]!.withdrawn).toBe(false);
  });

  test('a forged signature is rejected even from the owning wallet address', async () => {
    const { pairingCode } = await syncOnce('badge-w6', 'station-north');
    const view = await json<SessionView>(await h.request(`/api/session/${pairingCode}`));
    const itemId = view.items[0]!.id;

    const owner = makeWallet();
    await h.post('/api/vault/claim', {
      pairingCode,
      wallet: owner.address,
      signature: owner.sign(claimMessage(pairingCode, owner.address)),
    });

    const impostor = makeWallet();
    const response = await h.post('/api/vault/withdraw', {
      pairingCode,
      itemId,
      wallet: owner.address,
      signature: impostor.sign(withdrawMessage(pairingCode, itemId, owner.address)),
    });
    expect(response.status).toBe(401);
    expect((await json<ApiError>(response)).error).toBe('bad_signature');
  });
});
