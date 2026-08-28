<script lang="ts">
	import { dev } from '$app/environment';
	import { goto } from '$app/navigation';

	let code = $state('');

	function open(event: SubmitEvent): void {
		event.preventDefault();
		const pairingCode = code.trim();
		if (pairingCode.length === 0) return;
		void goto(`/s/${encodeURIComponent(pairingCode)}`);
	}

	const FLOW = [
		{ prompt: '01', title: 'badge', copy: 'Your ESP32-C3 announces itself nearby.' },
		{ prompt: '02', title: 'beacon', copy: 'A station opens one live pairing session.' },
		{ prompt: '03', title: 'QR', copy: 'Scan the code to open your quest console.' },
		{ prompt: '04', title: 'quest', copy: 'Deploy, serve, and submit your build.' },
		{ prompt: '05', title: 'get paid', copy: 'The agent verifies it and settles in USDC.' }
	] as const;
</script>

<svelte:head>
	<title>HTN × Solana — Quest Activation</title>
</svelte:head>

<main class="shell landing">
	<section class="terminal card">
		<div class="termbar">
			<span class="dot red"></span>
			<span class="dot amber"></span>
			<span class="dot green"></span>
			<span class="label">activation.sh</span>
		</div>

		<div class="content">
			<p class="label label-bright">$ htn quest --start</p>
			<h1 class="display">Build it.<br /><span>Prove it.</span><br />Get paid.</h1>
			<p class="body lede">
				One badge. One quest. Ship a Solana program and an x402 endpoint; the agent pays once,
				then verifies your proof on-chain.
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
				<a class="simlink label" href="/sim">operator simulator →</a>
			{/if}
		</div>
	</section>
</main>

<style>
	.landing {
		min-height: calc(100dvh - 52px);
		display: grid;
		align-items: center;
		padding-top: 28px;
		padding-bottom: 28px;
	}

	.terminal {
		max-width: 680px;
		width: 100%;
		margin: 0 auto;
		background: var(--bg-sunken);
		overflow: hidden;
	}

	.termbar {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 11px 14px;
		border-bottom: 1px solid var(--rule);
	}

	.termbar .label {
		margin-left: 7px;
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
		padding: clamp(22px, 6vw, 42px);
	}

	.display {
		margin: 14px 0 18px;
	}

	.display span {
		color: var(--green);
	}

	.lede {
		max-width: 52ch;
	}

	.flow {
		list-style: none;
		padding: 20px 0;
		margin: 24px 0;
		border-top: 1px solid var(--rule);
		border-bottom: 1px solid var(--rule);
		display: grid;
		gap: 13px;
	}

	.flow li {
		display: grid;
		grid-template-columns: 38px 1fr;
		gap: 9px;
	}

	.prompt {
		color: var(--purple);
	}

	.flow strong,
	.flow span {
		display: block;
	}

	.flow strong {
		font-family: var(--mono);
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--ink);
	}

	.flow li div span {
		font-size: 0.82rem;
		color: var(--ink-faint);
	}

	.jump {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 8px;
	}

	.dollar {
		color: var(--green);
	}

	.jump .input {
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}

	.simlink {
		display: inline-block;
		margin-top: 18px;
		color: var(--purple);
	}

	.simlink:hover {
		color: var(--green);
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
