<script lang="ts">
	import { dev } from '$app/environment';
	import { goto } from '$app/navigation';
	import {
		BOX_COUNT,
		DEFAULT_SOLANA_BOX_ID,
		DEFAULT_SOLANA_FINAL_BOX_ID,
		boxName
	} from '@htn/shared';

	const SOLANA_BOX_NAME = boxName(DEFAULT_SOLANA_BOX_ID);
	const SOLANA_FINAL_BOX_NAME = boxName(DEFAULT_SOLANA_FINAL_BOX_ID);

	let code = $state('');

	function open(event: SubmitEvent): void {
		event.preventDefault();
		const pairingCode = code.trim();
		if (pairingCode.length === 0) return;
		void goto(`/s/${encodeURIComponent(pairingCode)}`);
	}

	const FLOW = [
		{ prompt: '01', title: 'tap a box', copy: 'Tap any blind box with your badge.' },
		{ prompt: '02', title: 'scan the QR', copy: 'Your badge shows its permanent console link.' },
		{ prompt: '03', title: 'open your console', copy: 'See all nine items and your quest progress.' },
		{
			prompt: '04',
			title: 'unlock the finale',
			copy: `Tap ${SOLANA_BOX_NAME} for item 8, then finish the quest and tap ${SOLANA_FINAL_BOX_NAME} for item 9.`
		}
	] as const;
</script>

<svelte:head>
	<title>HTN × Solana — Badge Console</title>
</svelte:head>

<main class="shell landing">
	<section class="terminal card">
		<div class="termbar">
			<span class="dot red" aria-hidden="true"></span>
			<span class="dot amber" aria-hidden="true"></span>
			<span class="dot green" aria-hidden="true"></span>
			<span class="label">activation.sh</span>
		</div>

		<div class="content">
			<p class="label label-bright">$ htn badge --collect</p>
			<h1 class="display">{BOX_COUNT} boxes.<br /><span>9 items.</span><br />One quest.</h1>
			<p class="body lede">
				Tap your way through the blind boxes, track your collection here, tap {SOLANA_BOX_NAME} for
				item 8, and finish the quest to unlock item 9 at {SOLANA_FINAL_BOX_NAME}.
			</p>

			<ol class="flow">
				{#each FLOW as step (step.prompt)}
					<li>
						<span class="mono prompt">[{step.prompt}]</span>
						<div>
							<strong>{step.title}</strong>
							<span>{step.copy}</span>
						</div>
					</li>
				{/each}
			</ol>

			<section class="ai-card card">
				<h2 class="h3">AI at Solana scale.</h2>
				<p class="body">
					The quest is built on the same stack the ecosystem uses: MCP servers, agent kits, and
					agentic payments over x402.
				</p>
				<a
					class="btn btn-ghost"
					href="https://solana.com/ai"
					target="_blank"
					rel="noopener"
					aria-label="Explore AI on Solana (opens in a new tab)">Explore AI on Solana ↗</a
				>
			</section>

			<form class="jump" onsubmit={open}>
				<label class="sr-only" for="pairing">Pairing code</label>
				<span class="mono dollar">$</span>
				<input
					id="pairing"
					class="input"
					bind:value={code}
					placeholder="pairing_code"
					autocapitalize="characters"
					autocomplete="off"
					spellcheck="false"
				/>
				<button class="btn" type="submit" disabled={code.trim().length === 0}>Open</button>
			</form>

			{#if dev}
				<a class="simlink btn-link" href="/sim">box simulator →</a>
			{/if}
		</div>
	</section>
</main>

<style>
	.landing {
		min-height: calc(100dvh - var(--bar-h));
		display: grid;
		align-items: center;
		padding: var(--sp-6) 0;
	}

	.terminal {
		max-width: 680px;
		width: 100%;
		margin: 0 auto;
		background: var(--bg-raise);
		overflow: clip;
	}

	.termbar {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		padding: var(--sp-3) var(--sp-4);
		border-bottom: 1px solid var(--rule);
	}

	.termbar .label {
		margin-left: var(--sp-2);
	}

	.termbar .red {
		color: var(--red);
	}

	.termbar .amber {
		color: var(--amber);
	}

	.termbar .green {
		color: var(--green);
	}

	.content {
		padding: clamp(var(--sp-5), 5vw, var(--sp-7));
	}

	.display {
		margin: var(--sp-3) 0 var(--sp-4);
	}

	.display span {
		color: var(--accent);
	}

	.lede {
		max-width: 52ch;
	}

	.flow {
		list-style: none;
		padding: var(--sp-5) 0;
		margin: var(--sp-5) 0;
		border-top: 1px solid var(--rule);
		border-bottom: 1px solid var(--rule);
		display: grid;
		gap: var(--sp-4);
	}

	.flow li {
		display: grid;
		grid-template-columns: 44px 1fr;
		gap: var(--sp-2);
	}

	.prompt {
		color: var(--accent);
	}

	.flow strong,
	.flow span {
		display: block;
	}

	.flow strong {
		font-family: var(--mono);
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--ink);
	}

	.flow li div span {
		font-size: 0.8125rem;
		color: var(--ink-mute);
	}

	.ai-card {
		margin-bottom: var(--sp-5);
		padding: var(--sp-5);
		background: var(--bg-sunken);
	}

	.ai-card p {
		margin: var(--sp-2) 0 var(--sp-4);
	}

	.jump {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--sp-2);
	}

	.dollar {
		color: var(--ink-faint);
	}

	.simlink {
		margin-top: var(--sp-4);
	}

	@media (max-width: 430px) {
		.jump {
			grid-template-columns: auto minmax(0, 1fr);
		}

		.jump .btn {
			grid-column: 1 / -1;
		}
	}
</style>
