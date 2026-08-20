<script lang="ts">
	import { page } from '$app/state';
	import { claimMessage, withdrawMessage, type Item, type SessionView } from '@htn/shared';
	import {
		buildClaimTx,
		buildWithdrawTx,
		claimVault,
		decodeBase64,
		describeError,
		getHealth,
		getSession,
		withdrawItem,
		type Health
	} from '$lib/api.ts';
	import { WalletHub, WALLET_LINKS, type UsableWallet } from '$lib/wallet.svelte.ts';
	import ItemCard from '$lib/components/ItemCard.svelte';
	import { shortAddress, since } from '$lib/format.ts';

	const initialPairing = page.url.searchParams.get('pairing') ?? '';

	const hub = new WalletHub();

	let pairing = $state(initialPairing);
	let view = $state<SessionView | null>(null);
	let health = $state<Health | null>(null);
	let loading = $state(false);
	let busy = $state(false);
	let withdrawing = $state<number | null>(null);
	let error = $state<string | null>(null);
	let success = $state<string | null>(null);
	/** Why an on-chain step was skipped, when it was. */
	let chainNote = $state<string | null>(null);
	/** Confirmed transaction signatures, newest first. */
	let txLog = $state<{ label: string; signature: string }[]>([]);

	$effect(() => {
		hub.start();
		void refreshHealth();
		if (initialPairing.trim().length > 0) void load(initialPairing.trim());
		return () => hub.stop();
	});

	let address = $derived(hub.address);
	let claimed = $derived(view?.vault.ownerWallet ?? null);
	let message = $derived(
		pairing.trim().length > 0 && address ? claimMessage(pairing.trim(), address) : null
	);
	let escrowed = $derived((view?.items ?? []).filter((i) => !i.withdrawn));
	let withdrawn = $derived((view?.items ?? []).filter((i) => i.withdrawn));
	let canWithdraw = $derived(Boolean(claimed) && claimed === address);
	let cluster = $derived((hub.chain ?? 'solana:devnet').split(':')[1] ?? 'devnet');

	function explorer(signature: string): string {
		return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
	}

	async function refreshHealth(): Promise<void> {
		try {
			health = await getHealth();
		} catch {
			health = null;
		}
	}

	async function load(code: string): Promise<void> {
		loading = true;
		error = null;
		try {
			view = await getSession(code);
		} catch (err) {
			view = null;
			error = describeError(err);
		} finally {
			loading = false;
		}
	}

	function submitPairing(event: SubmitEvent): void {
		event.preventDefault();
		const code = pairing.trim();
		if (code.length === 0) return;
		success = null;
		void load(code);
	}

	async function connect(entry: UsableWallet): Promise<void> {
		error = null;
		try {
			await hub.connect(entry.wallet);
		} catch (err) {
			error = describeError(err);
		}
	}

	/**
	 * Runs the on-chain half of a vault action: the server builds an unsigned
	 * transaction, the wallet signs and broadcasts it. Everything here is
	 * optional — with no chain client, or a message-only wallet, the flow falls
	 * through to the signature-only path and says so.
	 */
	async function runOnChain(
		label: string,
		build: () => Promise<{ transaction: string | null; chainEnabled: boolean }>
	): Promise<void> {
		let built: { transaction: string | null; chainEnabled: boolean };
		try {
			built = await build();
		} catch (err) {
			chainNote = `On-chain ${label} skipped: ${describeError(err)}`;
			return;
		}
		if (!built.chainEnabled || !built.transaction) {
			chainNote = `The server has no chain client configured, so ${label} was recorded off-chain only.`;
			return;
		}
		if (!hub.canTransact) {
			chainNote = `${hub.connected?.name ?? 'This wallet'} cannot sign transactions, so ${label} was recorded off-chain only.`;
			return;
		}
		const signature = await hub.sendTransaction(decodeBase64(built.transaction));
		txLog = [{ label, signature }, ...txLog].slice(0, 6);
	}

	async function claim(): Promise<void> {
		const code = pairing.trim();
		busy = true;
		error = null;
		success = null;
		chainNote = null;
		try {
			if (code.length === 0) throw new Error('Enter your pairing code first.');
			if (!address) throw new Error('Connect a wallet first.');
			await runOnChain('the vault claim', () => buildClaimTx({ pairingCode: code, wallet: address }));
			const signature = await hub.signMessageBase58(claimMessage(code, address));
			await claimVault({ pairingCode: code, wallet: address, signature });
			success = 'Vault claimed. Your escrowed items are now withdrawable.';
			await load(code);
		} catch (err) {
			error = describeError(err);
		} finally {
			busy = false;
		}
	}

	async function withdraw(item: Item): Promise<void> {
		const code = pairing.trim();
		withdrawing = item.id;
		error = null;
		success = null;
		chainNote = null;
		try {
			if (!address) throw new Error('Connect a wallet first.');
			await runOnChain(`the withdrawal of ${item.name}`, () =>
				buildWithdrawTx({ pairingCode: code, itemId: item.id, wallet: address })
			);
			const signature = await hub.signMessageBase58(withdrawMessage(code, item.id, address));
			await withdrawItem({ pairingCode: code, itemId: item.id, wallet: address, signature });
			success = `${item.name} sent to ${shortAddress(address, 4)}.`;
			await load(code);
		} catch (err) {
			error = describeError(err);
		} finally {
			withdrawing = null;
		}
	}
</script>

<svelte:head>
	<title>Claim your vault · HTN × Solana</title>
</svelte:head>

<main class="shell">
	<section class="head">
		<div class="headrow">
			<p class="label">Escrow</p>
			<span class="pill" class:on={health?.chainEnabled} class:off={health && !health.chainEnabled}>
				<span class="dot"></span>
				{health ? (health.chainEnabled ? 'Chain live' : 'Chain disabled') : 'Chain unknown'}
			</span>
		</div>
		<h1 class="display">Claim your vault.</h1>
		<p class="body lede">
			Your badge's gear is minted into an on-chain escrow vault. Sign one message with a Solana
			wallet to prove the badge is yours, then withdraw items whenever you like.
		</p>
	</section>

	<hr class="rule" />

	<section class="block">
		<p class="label">1 — Pairing code</p>
		<form class="row" onsubmit={submitPairing}>
			<input
				class="input"
				bind:value={pairing}
				placeholder="PAIRING CODE"
				autocapitalize="characters"
				autocomplete="off"
				spellcheck="false"
			/>
			<button class="btn btn-ghost" type="submit" disabled={pairing.trim().length === 0 || loading}>
				{loading ? 'Loading' : 'Load'}
			</button>
		</form>
		{#if view}
			<div class="badgecard card">
				<span class="emoji" aria-hidden="true">{view.animal.emoji}</span>
				<div class="badgemeta">
					<span class="bname">{view.badge.name}</span>
					<span class="label">{view.animal.name} · {view.badge.badgeId}</span>
					<span class="label">
						{view.items.length} items · vault {claimed ? 'claimed' : 'in escrow'}
					</span>
				</div>
				<a class="btn btn-ghost btn-sm" href="/s/{encodeURIComponent(pairing.trim())}">Phone view</a>
			</div>
		{/if}
	</section>

	<hr class="rule" />

	<section class="block">
		<p class="label">2 — Wallet</p>
		{#if address}
			<div class="row connected">
				<div class="wmeta">
					<span class="wname">{hub.connected?.name}</span>
					<span class="mono addr">{address}</span>
					<span class="label">
						{hub.chain ?? 'solana'} · {hub.canSendTransaction
							? 'signs and sends transactions'
							: hub.canSignTransaction
								? 'signs transactions (broadcast via RPC)'
								: 'messages only — no on-chain writes'}
					</span>
				</div>
				<button class="btn btn-ghost btn-sm" onclick={() => hub.disconnect()}>Disconnect</button>
			</div>
		{:else if hub.available.length > 0}
			<ul class="wallets">
				{#each hub.available as entry (entry.name)}
					<li>
						<button class="walletbtn" onclick={() => connect(entry)} disabled={hub.connecting}>
							<img src={entry.icon} alt="" width="24" height="24" />
							<span class="wname">{entry.name}</span>
							<span class="label go">{hub.connecting ? '…' : 'Connect'}</span>
						</button>
					</li>
				{/each}
			</ul>
			{#if hub.incompatible.length > 0}
				<p class="label note-inline">
					Ignored (no Solana signMessage): {hub.incompatible.join(', ')}
				</p>
			{/if}
		{:else if hub.scanned}
			<div class="note">
				<strong>No Solana wallet detected in this browser.</strong>
				<p class="body">
					Install a Wallet Standard wallet, then reload this page. On mobile, open this link inside
					your wallet's built-in browser.
				</p>
				<p class="links">
					{#each WALLET_LINKS as link (link.name)}
						<a class="label wl" href={link.url} target="_blank" rel="noreferrer noopener"
							>{link.name} ↗</a
						>
					{/each}
				</p>
			</div>
		{:else}
			<p class="body">Looking for wallets…</p>
		{/if}
	</section>

	<hr class="rule" />

	<section class="block">
		<p class="label">3 — Sign &amp; claim</p>
		{#if claimed}
			<p class="note note-ok">
				Vault claimed by <span class="mono">{shortAddress(claimed, 6)}</span>
				{view?.vault.claimedAt ? `· ${since(view.vault.claimedAt)}` : ''}
			</p>
		{:else}
			<p class="body">
				You will sign this exact message. It is not a transaction and costs nothing.
				{#if health?.chainEnabled}
					A <span class="mono">claim_vault</span> transaction is signed alongside it.
				{/if}
			</p>
			{#if message}
				<pre class="pre msg">{message}</pre>
			{:else}
				<pre class="pre msg dim">Enter a pairing code and connect a wallet to preview the message.</pre>
			{/if}
			<button
				class="btn btn-block"
				onclick={claim}
				disabled={busy || !address || pairing.trim().length === 0}
			>
				{busy ? 'Waiting for wallet…' : 'Sign and claim vault'}
			</button>
		{/if}
	</section>

	{#if error}
		<p class="note note-error">{error}</p>
	{/if}
	{#if success}
		<p class="note note-ok">{success}</p>
	{/if}
	{#if chainNote}
		<p class="note">{chainNote}</p>
	{/if}
	{#if txLog.length > 0}
		<section class="block">
			<p class="label">On-chain transactions</p>
			<ul class="txlist">
				{#each txLog as tx (tx.signature)}
					<li>
						<span class="label">{tx.label}</span>
						<a class="mono txsig" href={explorer(tx.signature)} target="_blank" rel="noreferrer">
							{shortAddress(tx.signature, 8)} ↗
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if view}
		<hr class="rule" />
		<section class="block">
			<div class="sechead">
				<p class="label">4 — Escrowed items</p>
				<span class="label">{escrowed.length} held · {withdrawn.length} withdrawn</span>
			</div>
			{#if !canWithdraw}
				<p class="label note-inline">
					{claimed
						? 'Connect the wallet that claimed this vault to withdraw.'
						: 'Claim the vault first to enable withdrawals.'}
				</p>
			{:else}
				<p class="label note-inline">
					Each withdrawal is signed: you approve a message naming the item and your wallet.
				</p>
			{/if}
			{#if view.items.length === 0}
				<p class="body">This badge has not earned anything yet.</p>
			{:else}
				<div class="grid">
					{#each view.items as item (item.id)}
						<ItemCard {item}>
							{#snippet action(current)}
								{#if !current.withdrawn}
									<button
										class="btn btn-green btn-sm btn-block"
										disabled={!canWithdraw || withdrawing !== null}
										onclick={() => withdraw(current)}
									>
										{withdrawing === current.id ? 'Withdrawing…' : 'Withdraw to wallet'}
									</button>
								{/if}
							{/snippet}
						</ItemCard>
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</main>

<style>
	main {
		padding-top: 40px;
	}

	.head {
		padding-bottom: 30px;
	}

	.headrow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.pill.on {
		color: var(--green);
		border-color: color-mix(in srgb, var(--green) 40%, transparent);
	}

	.pill.off {
		color: var(--ink-faint);
	}

	.display {
		margin: 12px 0 16px;
	}

	.lede {
		max-width: 52ch;
	}

	.block {
		padding: 26px 0;
	}

	.row {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-top: 12px;
		flex-wrap: wrap;
	}

	.row .input {
		flex: 1 1 200px;
		text-transform: uppercase;
		letter-spacing: 0.16em;
	}

	.connected {
		justify-content: space-between;
		border: 1px solid var(--rule);
		border-radius: 3px;
		padding: 12px;
	}

	.wmeta {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
		flex: 1 1 240px;
	}

	.badgecard {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px;
		margin-top: 14px;
	}

	.badgecard .emoji {
		font-size: 34px;
		line-height: 1;
	}

	.badgemeta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}

	.bname {
		font-weight: 620;
		letter-spacing: -0.02em;
	}

	.wallets {
		list-style: none;
		margin: 12px 0 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	.walletbtn {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px;
		background: var(--bg-sunken);
		border: 1px solid var(--rule);
		border-radius: 3px;
		color: var(--ink);
		font: inherit;
		cursor: pointer;
		text-align: left;
	}

	.walletbtn:hover:not(:disabled) {
		border-color: var(--purple);
	}

	.walletbtn:disabled {
		opacity: 0.5;
		cursor: progress;
	}

	.walletbtn img {
		border-radius: 5px;
		flex: none;
	}

	.wname {
		flex: 1;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.go {
		color: var(--purple);
	}

	.addr {
		color: var(--green);
		word-break: break-all;
	}

	.msg {
		border: 1px solid var(--rule);
		border-left: 2px solid var(--purple);
		background: var(--bg-sunken);
		padding: 12px 14px;
		margin: 12px 0 16px;
		border-radius: 2px;
		color: var(--ink);
	}

	.msg.dim {
		color: var(--ink-faint);
		border-left-color: var(--rule-strong);
	}

	.note-inline {
		margin-top: 10px;
		color: var(--ink-faint);
	}

	.links {
		display: flex;
		gap: 16px;
		margin: 10px 0 0;
	}

	.wl {
		color: var(--purple);
	}

	.note p {
		margin: 8px 0 0;
	}

	.txlist {
		list-style: none;
		margin: 12px 0 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	.txlist li {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		border-top: 1px solid var(--rule-soft);
		padding-top: 8px;
	}

	.txsig {
		color: var(--green);
	}

	.sechead {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
		gap: 10px;
		margin-top: 14px;
	}

	@media (max-width: 420px) {
		.grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
