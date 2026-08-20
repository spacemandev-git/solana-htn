<script lang="ts">
	import { goto } from '$app/navigation';
	import { getStations, describeError, type Health, getHealth } from '$lib/api.ts';
	import type { Station } from '@htn/shared';

	let code = $state('');
	let stations = $state<Station[]>([]);
	let health = $state<Health | null>(null);
	let serverNote = $state<string | null>(null);

	$effect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const [s, h] = await Promise.all([getStations(), getHealth()]);
				if (cancelled) return;
				stations = s;
				health = h;
				serverNote = null;
			} catch (err) {
				if (cancelled) return;
				stations = [];
				health = null;
				serverNote = describeError(err);
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	function open(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = code.trim();
		if (trimmed.length === 0) return;
		void goto(`/s/${encodeURIComponent(trimmed)}`);
	}

	const STEPS = [
		{
			n: '01',
			t: 'Walk up to a Sync Station',
			d: 'Your ESP32-C3 badge announces itself over ESP-NOW. The station relays it to the server and gets back a pairing code.'
		},
		{
			n: '02',
			t: 'Open your link',
			d: 'The station shows a short URL. Open it and your phone goes LIVE for as long as you are standing in the hub.'
		},
		{
			n: '03',
			t: 'Collect funky gear',
			d: 'Every station you reach for the first time drops one piece of clothing for your animal. Rarity is rolled on arrival.'
		},
		{
			n: '04',
			t: 'Claim the vault',
			d: 'Assets sit in an on-chain escrow vault. Connect a Solana wallet, sign one message, and they are yours to withdraw.'
		}
	] as const;
</script>

<svelte:head>
	<title>HTN × Solana — Badge Activation</title>
</svelte:head>

<main class="shell">
	<section class="hero">
		<p class="label">Hack the North × Solana</p>
		<h1 class="display">
			Your badge is a<br /><span class="grad">wandering animal.</span>
		</h1>
		<p class="body lede">
			Hubs are towns. Everything between them is wilderness. Sync at a station, wear what you earn,
			and pull it all out of escrow when you connect a wallet.
		</p>

		<form class="jump" onsubmit={open}>
			<label class="sr-only" for="pairing">Pairing code</label>
			<input
				id="pairing"
				class="input"
				bind:value={code}
				placeholder="PAIRING CODE"
				autocapitalize="characters"
				autocomplete="off"
				spellcheck="false"
			/>
			<button class="btn" type="submit" disabled={code.trim().length === 0}>Open</button>
		</form>
		<p class="label hint">The station prints this on its display when you arrive.</p>
	</section>

	<hr class="rule" />

	<section class="steps">
		{#each STEPS as step (step.n)}
			<article class="step">
				<span class="label num">{step.n}</span>
				<h2 class="stitle">{step.t}</h2>
				<p class="body">{step.d}</p>
			</article>
		{/each}
	</section>

	<hr class="rule" />

	<section class="ways">
		<a class="way" href="/sim">
			<span class="label">Operator</span>
			<h2 class="h2">Simulator</h2>
			<p class="body">
				Fire badge syncs and disconnects at fake stations, watch every hacker's inventory update
				live, and deep-link to any phone view. No hardware required.
			</p>
			<span class="cta">Open simulator →</span>
		</a>
		<a class="way" href="/wallet">
			<span class="label">Hacker</span>
			<h2 class="h2">Claim your vault</h2>
			<p class="body">
				Connect any Wallet Standard Solana wallet, sign the claim message for your pairing code, and
				withdraw escrowed items to your own address.
			</p>
			<span class="cta">Connect wallet →</span>
		</a>
	</section>

	<hr class="rule" />

	<section class="stations">
		<div class="sechead">
			<p class="label">Sync stations</p>
			{#if health}
				<span class="label chain" class:off={!health.chainEnabled}>
					chain {health.chainEnabled ? 'enabled' : 'disabled'} · {health.badgeCount} badges
				</span>
			{/if}
		</div>
		{#if serverNote}
			<p class="note">{serverNote}</p>
		{:else if stations.length === 0}
			<p class="body">No stations have reported in yet.</p>
		{:else}
			<ul class="stationlist">
				{#each stations as station (station.stationId)}
					<li>
						<span class="sname">{station.name}</span>
						<span class="sblurb">{station.blurb}</span>
						<span class="label sid">{station.stationId}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</main>

<style>
	main {
		padding-top: 48px;
	}

	.hero {
		padding-bottom: 44px;
	}

	.display {
		margin: 14px 0 18px;
	}

	.grad {
		background: linear-gradient(96deg, var(--purple) 0%, var(--green) 92%);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}

	.lede {
		max-width: 46ch;
		font-size: 1.02rem;
	}

	.jump {
		display: flex;
		gap: 8px;
		margin-top: 26px;
		max-width: 420px;
	}

	.jump .input {
		text-transform: uppercase;
		letter-spacing: 0.18em;
	}

	.hint {
		margin-top: 8px;
	}

	.steps {
		display: grid;
		gap: 0;
		grid-template-columns: 1fr;
	}

	.step {
		padding: 22px 0;
		border-bottom: 1px solid var(--rule-soft);
	}

	.step:last-child {
		border-bottom: 0;
	}

	.num {
		color: var(--purple);
	}

	.stitle {
		font-size: 1.15rem;
		font-weight: 640;
		letter-spacing: -0.03em;
		margin: 6px 0 6px;
	}

	.ways {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0;
	}

	.way {
		display: block;
		padding: 28px 0;
		border-bottom: 1px solid var(--rule-soft);
	}

	.way:last-child {
		border-bottom: 0;
	}

	.way .h2 {
		margin: 8px 0 10px;
	}

	.way .body {
		max-width: 52ch;
	}

	.cta {
		display: inline-block;
		margin-top: 14px;
		font-family: var(--mono);
		font-size: 0.65rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--purple);
	}

	.way:hover .cta {
		color: var(--green);
	}

	.stations {
		padding: 28px 0 8px;
	}

	.sechead {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
		margin-bottom: 14px;
	}

	.chain {
		color: var(--green);
	}

	.chain.off {
		color: var(--ink-faint);
	}

	.stationlist {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0;
	}

	.stationlist li {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 2px 12px;
		padding: 12px 0;
		border-top: 1px solid var(--rule-soft);
	}

	.sname {
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.sblurb {
		grid-column: 1;
		color: var(--ink-faint);
		font-size: 0.85rem;
	}

	.sid {
		grid-row: 1 / span 2;
		grid-column: 2;
		align-self: center;
	}

	@media (min-width: 700px) {
		main {
			padding-top: 72px;
		}

		.steps {
			grid-template-columns: 1fr 1fr;
			column-gap: 32px;
		}

		.step:nth-last-child(2) {
			border-bottom: 0;
		}

		.ways {
			grid-template-columns: 1fr 1fr;
			column-gap: 32px;
		}

		.way {
			border-bottom: 0;
		}
	}
</style>
