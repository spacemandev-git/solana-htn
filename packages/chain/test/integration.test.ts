import { beforeAll, describe, expect, test } from 'bun:test';
import { Connection, Keypair, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

import { createChainClient } from '../src/factory.ts';
import { itemPda, registryPda, vaultPda } from '../src/layout.ts';
import type { ChainClient } from '../src/types.ts';
import { PublicKey } from '@solana/web3.js';

/**
 * Proves the TypeScript client and the deployed Rust program agree about
 * discriminators, PDA seeds, and account byte layouts — the three things that
 * can silently drift between `packages/chain` and `program/`.
 *
 * Requires a local validator with badge_escrow deployed:
 *   ./scripts/localnet.sh start
 * Skips (rather than fails) when one isn't running, so `bun test` stays usable
 * without a chain.
 */

const RPC_URL = process.env.SOLANA_RPC_URL ?? 'http://127.0.0.1:8899';
const PROGRAM_ID = process.env.SOLANA_PROGRAM_ID ?? '6kdZgrhS4FANagxKHiMoJzm2wEp2NRgNYTkjpYYRjtdD';
const AUTHORITY = process.env.SOLANA_AUTHORITY_SECRET_KEY;

async function validatorIsUp(): Promise<boolean> {
  try {
    const info = await new Connection(RPC_URL, 'confirmed').getAccountInfo(
      new PublicKey(PROGRAM_ID),
    );
    return Boolean(info?.executable);
  } catch {
    return false;
  }
}

const live = Boolean(AUTHORITY) && (await validatorIsUp());
const describeLive = live ? describe : describe.skip;

if (!live) {
  console.warn(
    '[chain] skipping on-chain integration tests — run ./scripts/localnet.sh start ' +
      'and export the printed env to enable them',
  );
}

describeLive('badge_escrow on-chain integration', () => {
  let chain: ChainClient;
  let connection: Connection;
  const program = new PublicKey(PROGRAM_ID);

  // A fresh badge id per run keeps reruns from colliding with existing PDAs.
  const badgeId = `it-badge-${Date.now()}`;

  beforeAll(async () => {
    connection = new Connection(RPC_URL, 'confirmed');
    chain = await createChainClient({
      rpcUrl: RPC_URL,
      authoritySecretKey: AUTHORITY,
      programId: PROGRAM_ID,
    });
  });

  /** Stands in for the browser wallet: signs a server-built tx and submits it. */
  async function signAndSend(base64Tx: string, wallet: Keypair): Promise<string> {
    const tx = Transaction.from(Buffer.from(base64Tx, 'base64'));
    return sendAndConfirmTransaction(connection, tx, [wallet], { commitment: 'confirmed' });
  }

  async function fundedWallet(): Promise<Keypair> {
    const wallet = Keypair.generate();
    const signature = await connection.requestAirdrop(wallet.publicKey, 2_000_000_000);
    const latest = await connection.getLatestBlockhash('confirmed');
    await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
    return wallet;
  }

  test('connecting bootstraps the registry under the server authority', async () => {
    expect(chain.enabled).toBe(true);
    const registry = await connection.getAccountInfo(registryPda(program));
    expect(registry).not.toBeNull();
    expect(registry!.owner.toBase58()).toBe(PROGRAM_ID);
  });

  test('ensureVault creates a vault at the PDA the client derives', async () => {
    const result = await chain.ensureVault(badgeId, 4);
    expect(result.address).toBe(vaultPda(program, badgeId).toBase58());
    expect(result.signature).toBeTruthy();

    const vault = await chain.getVault(badgeId);
    expect(vault).not.toBeNull();
    expect(vault!.animalCode).toBe(4);
    expect(vault!.itemCount).toBe(0);
    expect(vault!.owner).toBeNull();
  });

  test('ensureVault is idempotent', async () => {
    const result = await chain.ensureVault(badgeId, 4);
    expect(result.address).toBe(vaultPda(program, badgeId).toBase58());
    expect(result.signature).toBeNull();
  });

  test('minting items writes codes the client reads back correctly', async () => {
    await chain.mintItem({ badgeId, index: 0, code: 0xab01, stationId: 'e7-foundry' });
    await chain.mintItem({ badgeId, index: 1, code: 0xcd02, stationId: 'mc-great-hall' });

    const vault = await chain.getVault(badgeId);
    expect(vault!.itemCount).toBe(2);

    const items = await chain.listItems(badgeId);
    expect(items).toHaveLength(2);
    expect(items[0]!.code).toBe(0xab01);
    expect(items[0]!.index).toBe(0);
    expect(items[0]!.withdrawn).toBe(false);
    expect(items[0]!.mintedAt).toBeGreaterThan(0);
    expect(items[1]!.code).toBe(0xcd02);

    const vaultAddress = new PublicKey(vault!.vaultAddress);
    expect(items[0]!.itemAddress).toBe(itemPda(program, vaultAddress, 0).toBase58());
  });

  test('replaying a mint does not duplicate an item', async () => {
    const result = await chain.mintItem({
      badgeId,
      index: 0,
      code: 0xab01,
      stationId: 'e7-foundry',
    });
    expect(result.signature).toBeNull();
    expect(await chain.listItems(badgeId)).toHaveLength(2);
  });

  test('a wallet claims the vault with a server-built transaction', async () => {
    const wallet = await fundedWallet();
    const unsigned = await chain.buildClaimVaultTransaction(badgeId, wallet.publicKey.toBase58());
    expect(unsigned).toBeTruthy();

    await signAndSend(unsigned!, wallet);

    const vault = await chain.getVault(badgeId);
    expect(vault!.owner).toBe(wallet.publicKey.toBase58());

    // The server can now see the claim, and refuses to hand a build to anyone else.
    const other = Keypair.generate().publicKey.toBase58();
    await expect(chain.claimVault(badgeId, other)).rejects.toThrow(/already claimed/);
  });

  test('the owner withdraws an item out of escrow', async () => {
    // A fresh badge, because the wallet that claimed `badgeId` above is not
    // recoverable here — the whole claim -> withdraw arc is replayed instead.
    const secondBadge = `${badgeId}-b`;
    await chain.ensureVault(secondBadge, 1);
    await chain.mintItem({ badgeId: secondBadge, index: 0, code: 0x1234, stationId: 'slc-hub' });

    const wallet = await fundedWallet();
    const claimTx = await chain.buildClaimVaultTransaction(
      secondBadge,
      wallet.publicKey.toBase58(),
    );
    await signAndSend(claimTx!, wallet);

    const withdrawTx = await chain.buildWithdrawItemTransaction(
      secondBadge,
      0,
      wallet.publicKey.toBase58(),
    );
    await signAndSend(withdrawTx!, wallet);

    const items = await chain.listItems(secondBadge);
    expect(items[0]!.withdrawn).toBe(true);
  });

  test('an unclaimed vault rejects withdrawal', async () => {
    const badge = `${badgeId}-c`;
    await chain.ensureVault(badge, 2);
    await chain.mintItem({ badgeId: badge, index: 0, code: 0x99, stationId: 'dc-library' });

    const wallet = await fundedWallet();
    const tx = await chain.buildWithdrawItemTransaction(badge, 0, wallet.publicKey.toBase58());
    await expect(signAndSend(tx!, wallet)).rejects.toThrow();
  });

  test('the server authority cannot claim a vault on a hacker behalf', async () => {
    const badge = `${badgeId}-d`;
    await chain.ensureVault(badge, 3);
    const authority = Keypair.fromSecretKey(bs58.decode(AUTHORITY!));

    // Nothing stops the server from *building* this, but it is just another
    // wallet claim — it cannot be done silently, and once a hacker has claimed
    // first, the server is locked out.
    const wallet = await fundedWallet();
    const walletTx = await chain.buildClaimVaultTransaction(badge, wallet.publicKey.toBase58());
    await signAndSend(walletTx!, wallet);

    const authorityTx = await chain.buildClaimVaultTransaction(
      badge,
      authority.publicKey.toBase58(),
    );
    await expect(signAndSend(authorityTx!, authority)).rejects.toThrow();
  });
});
