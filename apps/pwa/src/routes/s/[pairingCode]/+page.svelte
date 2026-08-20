<script lang="ts">
	import { page } from '$app/state';
	import { LiveSession } from '$lib/live.svelte.ts';
	import ItemCard from '$lib/components/ItemCard.svelte';
	import StatusPill from '$lib/components/StatusPill.svelte';
	import { clockTime, shortAddress, since } from '$lib/format.ts';

	let code = $derived(page.params.pairingCode ?? '');
	let live = $state<LiveSession | null>(null);

	$effect(() => {
		const pairingCode = code;
		if (pairingCode.length === 0) return;
		const session = new LiveSession(pairingCode);
		live = session;
		void session.start();
		return () => {
			session.stop();
			live = null;
		};
	});

	let view = $derived(live?.view ?? null);
	let status = $derived(live?.status ?? 'loading');
	let wilderness = $derived(status === 'wilderness');
	let items = $derived(view?.items ?? []);
	let stationCount = $derived(new Set(items.map((i) => i.stationId)).size);
	let worn = $derived.by(() => {
		// One item per slot is worn: the most recently minted one in that slot.
		const bySlot = new Map<string, number>();
		for (const item of items) {
			const current = bySlot.get(item.slot);
			if (current === undefined || item.id > current) bySlot.set(item.slot, item.id);
		}
		return new Set(bySlot.values());
	});
	let fresh = $derived(new Set(live?.freshIds ?? []));
	let drop = $derived(live?.latestDrop ?? null);
</script>

<svelte:head>
	<title>{view ? `${view.badge.name} — ${view.animal.name}` : 'Badge session'} · HTN × Solana</title>
</svelte:head>

<div class="phone" class:cold={wilderness}>
	<header class="bar">
		<a class="mark" href="/">HTN <span class="x">×</span> SOLANA</a>
		<StatusPill {status} />
	</header>

	{#if !view}
		<section class="pad center">
			{#if status === 'unreachable'}
				<p class="label">Offline</p>
				<h1 class="h2">Can't reach the server</h1>
				<p class="body">{live?.error}</p>
				<button class="btn btn-ghost" onclick={() => live?.retry()}>Retry</button>
			{:else if status === 'missing'}
				<p class="label">Pairing {code}</p>
				<h1 class="h2">No session for this code</h1>
				<p class="body">
					Pairing codes expire when a badge leaves the hub. Walk back up to a Sync Station to get a
					fresh one.
				</p>
				<a class="btn btn-ghost" href="/">Back</a>
			{:else}
				<div class="spinner" aria-hidden="true"></div>
				<p class="label">Pairing {code}</p>
			{/if}
		</section>
	{:else}
		<section class="hero">
			<div class="halo" class:muted={wilderness}>
				<span class="emoji" aria-hidden="true">{view.animal.emoji}</span>
			</div>
			<h1 class="animal">{view.animal.name}</h1>
			<p class="blurb">{view.animal.blurb}</p>
			<div class="who">
				<span class="name">{view.badge.name}</span>
				<span class="label badgeid">{view.badge.badgeId}</span>
			</div>
		</section>

		{#if wilderness}
			<section class="band wild">
				<p class="label">Signal lost</p>
				<h2 class="bandtitle">You've wandered into the wilderness</h2>
				<p class="body">
					No Sync Station in range{view.session.endedAt
						? ` since ${clockTime(view.session.endedAt)}`
						: ''}. Your gear is safe in escrow — reach the next hub to keep collecting.
				</p>
			</section>
		{:else}
			<section class="band">
				<div class="bandhead">
					<p class="label">Currently at</p>
					<span class="label since">{since(view.session.startedAt)}</span>
				</div>
				<h2 class="bandtitle">{view.station.name}</h2>
				<p class="body">{view.station.blurb}</p>
			</section>
		{/if}

		<section class="stats">
			<div class="stat">
				<span class="statnum">{items.length}</span>
				<span class="label">Items</span>
			</div>
			<div class="stat">
				<span class="statnum">{stationCount}</span>
				<span class="label">Stations</span>
			</div>
			<div class="stat">
				<span class="statnum" class:claimed={view.vault.ownerWallet}>
					{view.vault.ownerWallet ? 'YES' : 'NO'}
				</span>
				<span class="label">Claimed</span>
			</div>
		</section>

		<section class="pad">
			<div class="sechead">
				<p class="label">Wardrobe</p>
				<span class="label">{items.length} owned</span>
			</div>
			{#if items.length === 0}
				<p class="body empty">
					Nothing yet. Your first station visit drops your first piece of gear.
				</p>
			{:else}
				<div class="grid">
					{#each items as item (item.id)}
						<ItemCard {item} fresh={fresh.has(item.id)} worn={worn.has(item.id)} />
					{/each}
				</div>
			{/if}
		</section>

		<section class="pad vault">
			<div class="sechead">
				<p class="label">Escrow vault</p>
			</div>
			{#if view.vault.ownerWallet}
				<p class="body">
					Claimed by <span class="mono addr">{shortAddress(view.vault.ownerWallet, 6)}</span>
					{view.vault.claimedAt ? `· ${since(view.vault.claimedAt)}` : ''}
				</p>
				<a class="btn btn-ghost btn-block" href="/wallet?pairing={encodeURIComponent(code)}">
					Withdraw items
				</a>
			{:else}
				<p class="body">
					Everything you earn is held in an on-chain escrow vault for badge
					<span class="mono">{view.badge.badgeId}</span>. Connect a Solana wallet to take ownership.
				</p>
				<a class="btn btn-block" href="/wallet?pairing={encodeURIComponent(code)}">
					Claim with wallet
				</a>
			{/if}
			<p class="label vaultaddr">
				Vault {view.vault.vaultAddress ? shortAddress(view.vault.vaultAddress, 6) : 'pending'}
			</p>
		</section>
	{/if}

	{#if drop}
		<div class="dropbanner" role="status">
			<button class="dropinner" onclick={() => live?.dismissDrop()}>
				<span class="label droplabel">New drop unlocked</span>
				<span class="dropname">{drop.name}</span>
				<span class="label dropmeta">{drop.slot} · {drop.rarity}</span>
			</button>
		</div>
	{/if}
</div>

<style>
	.phone {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		padding-bottom: calc(28px + var(--safe-b));
		transition: filter 400ms ease;
	}

	.phone.cold {
		filter: saturate(0.55);
	}

	.bar {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px max(16px, var(--safe-r)) 10px max(16px, var(--safe-l));
		padding-top: calc(10px + var(--safe-t));
		background: color-mix(in srgb, var(--bg) 86%, transparent);
		backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--rule);
	}

	.mark {
		font-family: var(--mono);
		font-size: 0.6rem;
		letter-spacing: 0.2em;
		color: var(--ink-mute);
	}

	.x {
		color: var(--purple);
	}

	.pad {
		padding: 22px max(16px, var(--safe-l)) 22px max(16px, var(--safe-r));
	}

	.center {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: 10px;
	}

	.center .body {
		max-width: 30ch;
	}

	.center .btn {
		margin-top: 10px;
	}

	.spinner {
		width: 26px;
		height: 26px;
		border: 1px solid var(--rule-strong);
		border-top-color: var(--purple);
		border-radius: 50%;
		animation: spin 900ms linear infinite;
		margin-bottom: 6px;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.hero {
		text-align: center;
		padding: 30px 16px 26px;
		border-bottom: 1px solid var(--rule);
	}

	.halo {
		width: 132px;
		height: 132px;
		margin: 0 auto 16px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background:
			radial-gradient(circle at 50% 42%, var(--purple-wash), transparent 68%),
			var(--bg-sunken);
		border: 1px solid var(--rule-strong);
		box-shadow: 0 0 46px -14px var(--purple);
		transition:
			box-shadow 500ms ease,
			border-color 500ms ease;
	}

	.halo.muted {
		box-shadow: none;
		border-color: var(--rule);
	}

	.emoji {
		font-size: 68px;
		line-height: 1;
	}

	.animal {
		font-size: 2.6rem;
		font-weight: 700;
		letter-spacing: -0.045em;
		line-height: 1;
		margin: 0;
	}

	.blurb {
		color: var(--ink-mute);
		font-size: 0.92rem;
		margin: 8px auto 0;
		max-width: 30ch;
	}

	.who {
		margin-top: 18px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.name {
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.badgeid {
		color: var(--ink-faint);
	}

	.band {
		padding: 20px max(16px, var(--safe-l));
		border-bottom: 1px solid var(--rule);
		background: linear-gradient(180deg, var(--purple-wash), transparent 78%);
	}

	.band.wild {
		background: linear-gradient(180deg, rgba(255, 182, 72, 0.09), transparent 78%);
	}

	.bandhead {
		display: flex;
		justify-content: space-between;
		gap: 10px;
	}

	.since {
		color: var(--ink-faint);
	}

	.bandtitle {
		font-size: 1.4rem;
		font-weight: 660;
		letter-spacing: -0.035em;
		margin: 6px 0 6px;
		line-height: 1.05;
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		border-bottom: 1px solid var(--rule);
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding: 16px 6px;
		border-right: 1px solid var(--rule);
	}

	.stat:last-child {
		border-right: 0;
	}

	.statnum {
		font-family: var(--mono);
		font-size: 1.35rem;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.statnum.claimed {
		color: var(--green);
	}

	.sechead {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 12px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}

	.empty {
		border: 1px dashed var(--rule-strong);
		padding: 18px;
		border-radius: 3px;
		text-align: center;
	}

	.vault {
		border-top: 1px solid var(--rule);
	}

	.vault .body {
		margin-bottom: 14px;
	}

	.addr {
		color: var(--green);
	}

	.vaultaddr {
		margin-top: 10px;
		text-align: center;
	}

	.dropbanner {
		position: fixed;
		left: 0;
		right: 0;
		bottom: calc(14px + var(--safe-b));
		display: flex;
		justify-content: center;
		padding: 0 14px;
		z-index: 50;
		pointer-events: none;
	}

	.dropinner {
		pointer-events: auto;
		width: 100%;
		max-width: 420px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		padding: 12px 14px;
		border: 1px solid var(--green);
		border-radius: 3px;
		background: linear-gradient(180deg, rgba(20, 241, 149, 0.16), var(--bg-deep) 85%);
		color: var(--ink);
		text-align: left;
		cursor: pointer;
		font: inherit;
		box-shadow: 0 12px 40px -18px var(--green);
		animation: rise 460ms cubic-bezier(0.2, 0.9, 0.25, 1) both;
	}

	.droplabel {
		color: var(--green);
	}

	.dropname {
		font-size: 1.1rem;
		font-weight: 650;
		letter-spacing: -0.03em;
	}

	.dropmeta {
		color: var(--ink-faint);
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(22px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	@media (min-width: 560px) {
		.phone {
			max-width: 480px;
			margin: 0 auto;
			border-left: 1px solid var(--rule);
			border-right: 1px solid var(--rule);
		}

		.grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
