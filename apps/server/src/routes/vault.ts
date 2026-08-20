import { Hono } from 'hono';
import {
  ClaimRequest,
  ClaimTxRequest,
  WithdrawRequest,
  WithdrawTxRequest,
  claimMessage,
  withdrawMessage,
} from '@htn/shared';
import { HttpError, parseJson } from '../http.ts';
import type { ServiceContext } from '../services/context.ts';
import { nowIso } from '../services/context.ts';
import { getItem, getItemIndex, withdrawItem } from '../services/items.ts';
import { getSession } from '../services/sessions.ts';
import { publishState } from '../services/sync.ts';
import { claimVault, getVault, verifyWalletSignature } from '../services/vaults.ts';

export function vaultRoutes(ctx: ServiceContext): Hono {
  const routes = new Hono();

  routes.post('/claim', async (c) => {
    const request = await parseJson(c, ClaimRequest);

    // Any known session identifies the badge — including an ended one, so a
    // hacker can still claim after walking away from the station.
    const session = getSession(ctx.db, request.pairingCode);
    if (!session) throw new HttpError(404, 'session_not_found', 'no session for that pairing code');

    const vault = getVault(ctx.db, session.badgeId);
    if (!vault) throw new HttpError(404, 'vault_not_found', 'this badge has no vault yet');

    // Signature first: otherwise an unauthenticated caller could probe which
    // wallet owns a vault by watching for a 409 instead of a 401.
    const message = claimMessage(request.pairingCode, request.wallet);
    if (!verifyWalletSignature(message, request.wallet, request.signature)) {
      throw new HttpError(401, 'bad_signature', 'signature does not match the wallet');
    }

    if (vault.ownerWallet && vault.ownerWallet !== request.wallet) {
      throw new HttpError(409, 'vault_already_claimed', 'this vault belongs to another wallet');
    }

    const claimed = await claimVault(ctx.db, ctx.chain, session.badgeId, request.wallet, nowIso());

    ctx.live.publish(session.pairingCode, { type: 'vault-claimed', wallet: request.wallet });
    publishState(ctx, session);

    return c.json({ vault: claimed });
  });

  /**
   * Builds the transaction that moves the vault from escrow to a wallet.
   *
   * Deliberately unauthenticated beyond knowing the pairing code: the result is
   * an *unsigned* transaction, useless without the wallet's own signature, and
   * the program rejects a second claim anyway.
   */
  routes.post('/claim-tx', async (c) => {
    const request = await parseJson(c, ClaimTxRequest);
    const session = getSession(ctx.db, request.pairingCode);
    if (!session) throw new HttpError(404, 'session_not_found', 'no session for that pairing code');

    const vault = getVault(ctx.db, session.badgeId);
    if (!vault) throw new HttpError(404, 'vault_not_found', 'this badge has no vault yet');
    if (vault.ownerWallet && vault.ownerWallet !== request.wallet) {
      throw new HttpError(409, 'vault_already_claimed', 'this vault belongs to another wallet');
    }

    const transaction = await ctx.chain.buildClaimVaultTransaction(
      session.badgeId,
      request.wallet,
    );
    return c.json({ transaction, chainEnabled: ctx.chain.enabled });
  });

  /** Builds the unsigned `withdraw_item` transaction for the claiming wallet. */
  routes.post('/withdraw-tx', async (c) => {
    const request = await parseJson(c, WithdrawTxRequest);
    const session = getSession(ctx.db, request.pairingCode);
    if (!session) throw new HttpError(404, 'session_not_found', 'no session for that pairing code');

    const vault = getVault(ctx.db, session.badgeId);
    if (!vault?.ownerWallet) {
      throw new HttpError(403, 'vault_not_claimed', 'claim the vault with a wallet first');
    }
    if (vault.ownerWallet !== request.wallet) {
      throw new HttpError(403, 'not_vault_owner', 'this vault belongs to another wallet');
    }

    const item = getItem(ctx.db, request.itemId);
    if (!item || item.badgeId !== session.badgeId) {
      throw new HttpError(404, 'item_not_found', 'no such item on this badge');
    }
    if (item.withdrawn) {
      throw new HttpError(409, 'item_already_withdrawn', 'this item has already left escrow');
    }
    const index = getItemIndex(ctx.db, item.id);
    if (index === null) throw new HttpError(404, 'item_not_found', 'no such item on this badge');

    const transaction = await ctx.chain.buildWithdrawItemTransaction(
      session.badgeId,
      index,
      request.wallet,
    );
    return c.json({ transaction, chainEnabled: ctx.chain.enabled });
  });

  routes.post('/withdraw', async (c) => {
    const request = await parseJson(c, WithdrawRequest);

    const session = getSession(ctx.db, request.pairingCode);
    if (!session) throw new HttpError(404, 'session_not_found', 'no session for that pairing code');

    const vault = getVault(ctx.db, session.badgeId);
    if (!vault?.ownerWallet) {
      throw new HttpError(403, 'vault_not_claimed', 'claim the vault with a wallet first');
    }

    const message = withdrawMessage(request.pairingCode, request.itemId, request.wallet);
    if (!verifyWalletSignature(message, request.wallet, request.signature)) {
      throw new HttpError(401, 'bad_signature', 'signature does not match the wallet');
    }
    if (vault.ownerWallet !== request.wallet) {
      throw new HttpError(403, 'not_vault_owner', 'this vault belongs to another wallet');
    }

    const item = getItem(ctx.db, request.itemId);
    if (!item || item.badgeId !== session.badgeId) {
      throw new HttpError(404, 'item_not_found', 'no such item on this badge');
    }
    if (item.withdrawn) {
      throw new HttpError(409, 'item_already_withdrawn', 'this item has already left escrow');
    }

    const updated = await withdrawItem(ctx.db, ctx.chain, session.badgeId, item);
    publishState(ctx, session);

    return c.json({ item: updated, wallet: vault.ownerWallet });
  });

  return routes;
}
