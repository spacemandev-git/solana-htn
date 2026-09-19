<script lang="ts">
	import { HTNOS_ID_LENGTH } from '@htn/shared';
	import { onDestroy, onMount, tick } from 'svelte';
	import { RpsGame, type Phase } from '$lib/rps-game.svelte.ts';
	import { beatsSentence } from '$lib/rps.ts';

	const game = new RpsGame();
	let badgeId = $state('');
	let appKey = $state('');
	let opponentId = $state('');
	let opponentKey = $state('');
	let mounted = $state(false);
	let localError = $state<string | null>(null);
	let logViewport = $state<HTMLElement | null>(null);

	onMount(() => {
		badgeId = (localStorage.getItem('htnos.badgeId') ?? '').toLowerCase().slice(0, HTNOS_ID_LENGTH);
		appKey = localStorage.getItem('htnos.key') ?? '';
		mounted = true;
	});

	onDestroy(() => game.stop());

	$effect(() => {
		const id = badgeId.trim();
		const key = appKey;
		if (!mounted) return;
		localStorage.setItem('htnos.badgeId', id);
		localStorage.setItem('htnos.key', key);
	});

	$effect(() => {
		game.log.length;
		void tick().then(() => {
			if (logViewport) logViewport.scrollTop = logViewport.scrollHeight;
		});
	});

	function normalizeBadgeId(event: Event, opponent: boolean): void {
		const value = (event.currentTarget as HTMLInputElement).value
			.toLowerCase()
			.slice(0, HTNOS_ID_LENGTH);
		if (opponent) opponentId = value;
		else badgeId = value;
	}

	function startGame(): void {
		const id = badgeId.trim();
		const key = appKey.trim();
		const otherId = opponentId.trim();
		const otherKey = opponentKey.trim();
		if (!id || !key) return;
		if ((otherId && !otherKey) || (!otherId && otherKey)) {
			localError = 'Enter both opponent fields, or leave both empty to play the computer.';
			return;
		}
		localError = null;
		game.start({ badgeId: id, key }, otherId && otherKey ? { badgeId: otherId, key: otherKey } : undefined);
	}

	function phaseClass(phase: Phase): string {
		if (phase === 'connecting') return 'pill pill-warn';
		if (phase === 'error') return 'pill pill-bad';
		if (phase === 'prompt' || phase === 'resolving' || phase === 'result') return 'pill pill-ok';
		return 'pill';
	}

	function resultSentence(): string {
		const result = game.lastResult;
		if (!result) return '';
		const verdict = result.outcome === 'win' ? 'you win' : result.outcome === 'lose' ? 'you lose' : 'draw';
		return `${result.mine} vs ${result.theirs}: ${beatsSentence(result.mine, result.theirs) || 'same pick'} — ${verdict}.`;
	}
</script>

<svelte:head>
	<title>HTN OS — rock paper scissors</title>
	<meta
		name="description"
		content="Play rock, paper, scissors against the computer or another HTN OS badge."
	/>
</svelte:head>

<main class="shell rps-page">
	<header class="hero">
		<a class="btn-link" href="/badge">← Back to HTN OS</a>
		<p class="label label-bright">$ htn badge --play rps</p>
		<h1 class="h1">Rock, paper, scissors</h1>
		<p class="body">
			Your badge shows the prompt, you answer with Left / Up / Right, and this page referees;
			add a second badge to play someone else.
		</p>
	</header>

	<section class="card panel" aria-labelledby="players-title">
		<h2 class="h2" id="players-title">Players</h2>
		<div class="form-grid">
			<label class="field">
				<span class="label">Your HTN-ID</span>
				<input
					class="input"
					value={badgeId}
					oninput={(event) => normalizeBadgeId(event, false)}
					maxlength={HTNOS_ID_LENGTH}
					autocapitalize="none"
					autocomplete="off"
					spellcheck="false"
					placeholder="xb2b9"
				/>
			</label>
			<label class="field">
				<span class="label">App key</span>
				<input
					class="input"
					type="text"
					bind:value={appKey}
					autocapitalize="none"
					autocomplete="off"
					spellcheck="false"
					placeholder="Set on badge"
				/>
			</label>
			<label class="field">
				<span class="label">Opponent HTN-ID (optional)</span>
				<input
					class="input"
					value={opponentId}
					oninput={(event) => normalizeBadgeId(event, true)}
					maxlength={HTNOS_ID_LENGTH}
					autocapitalize="none"
					autocomplete="off"
					spellcheck="false"
					placeholder="Empty plays CPU"
				/>
			</label>
			<label class="field">
				<span class="label">Opponent app key (optional)</span>
				<input
					class="input"
					type="text"
					bind:value={opponentKey}
					autocapitalize="none"
					autocomplete="off"
					spellcheck="false"
					placeholder="Empty plays CPU"
				/>
			</label>
		</div>
		<div class="actions">
			<button class="btn" type="button" disabled={!badgeId.trim() || !appKey.trim()} onclick={startGame}>
				Start game
			</button>
			{#if game.phase !== 'idle'}
				<button class="btn btn-ghost" type="button" onclick={() => game.stop()}>Stop</button>
			{/if}
		</div>
		{#if localError}
			<p class="note note-error inline-error" role="alert">{localError}</p>
		{/if}
	</section>

	<section class="card panel" aria-labelledby="table-title">
		<div class="section-head">
			<h2 class="h2" id="table-title">Table</h2>
			<span class={phaseClass(game.phase)} role="status" aria-live="polite">{game.phase}</span>
		</div>
		<div class="score-line tnum">
			<span>Round {game.round}</span>
			<span>W{game.score.wins} L{game.score.losses} D{game.score.draws}</span>
		</div>
		<div class="player-grid">
			{#each game.players as player (player.label)}
				<article class="player-card">
					<div class="player-head">
						<h3 class="h3">{player.label}</h3>
						<span class:connected={player.connected} class="connection">
							{player.connected ? 'connected' : 'offline'}
						</span>
					</div>
					<p class="mono player-id">{player.badgeId}</p>
					<p class="body choice">
						{#if (game.phase === 'resolving' || game.phase === 'result') && player.choice}
							{player.choice}
						{:else if player.choice}
							locked in
						{:else}
							waiting
						{/if}
					</p>
				</article>
			{/each}
			{#if game.players.length === 1}
				<article class="player-card">
					<div class="player-head">
						<h3 class="h3">Computer</h3>
						<span class="connection connected">ready</span>
					</div>
					<p class="mono player-id">CPU</p>
					<p class="body choice">
						{game.phase === 'result' && game.lastResult ? game.lastResult.theirs : 'waiting'}
					</p>
				</article>
			{/if}
		</div>
		{#if game.lastResult}
			<p class="body result-line">{resultSentence()}</p>
		{/if}
		{#if game.error}
			<p class="note note-error inline-error" role="alert">{game.error}</p>
		{/if}
	</section>

	<section class="card panel" aria-labelledby="log-title">
		<h2 class="h2" id="log-title">Log</h2>
		<div class="log-viewport" bind:this={logViewport}>
			<pre class="pre">{game.log.length > 0 ? game.log.join('\n') : 'No badge traffic yet.'}</pre>
		</div>
	</section>

	<p class="note">
		Button events only flow while the badge is in canvas mode; the first command puts it there.
		Hold Home to leave canvas mode.
	</p>
</main>

<style>
	.rps-page {
		display: grid;
		gap: var(--sp-4);
		padding-top: var(--sp-6);
		padding-bottom: var(--sp-8);
	}

	.hero {
		padding-bottom: var(--sp-3);
	}

	.hero .label,
	.hero .h1,
	.hero .body {
		margin-top: var(--sp-3);
	}

	.hero .body {
		max-width: 66ch;
	}

	.panel {
		padding: clamp(var(--sp-4), 4vw, var(--sp-6));
	}

	.form-grid,
	.player-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--sp-3);
		margin-top: var(--sp-4);
	}

	.field .label {
		display: block;
		margin-bottom: var(--sp-2);
	}

	.actions,
	.section-head,
	.score-line,
	.player-head {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
	}

	.actions {
		margin-top: var(--sp-4);
		flex-wrap: wrap;
	}

	.section-head,
	.score-line,
	.player-head {
		justify-content: space-between;
	}

	.score-line {
		margin-top: var(--sp-4);
		font-family: var(--mono);
		color: var(--ink-mute);
	}

	.player-card {
		padding: var(--sp-4);
		border: 1px solid var(--rule-soft);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
	}

	.connection {
		font-family: var(--mono);
		font-size: 0.75rem;
		color: var(--ink-faint);
	}

	.connection.connected {
		color: var(--green);
	}

	.player-id,
	.choice {
		margin: var(--sp-2) 0 0;
	}

	.choice {
		color: var(--ink);
	}

	.result-line,
	.inline-error {
		margin-top: var(--sp-4);
	}

	.log-viewport {
		max-height: calc(var(--sp-8) * 3);
		overflow: auto;
		margin-top: var(--sp-4);
		padding: var(--sp-3);
		border: 1px solid var(--rule-soft);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
	}

	@media (max-width: 620px) {
		.form-grid,
		.player-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
