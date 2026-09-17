<script lang="ts">
	import { BOX_RESPONSE_MAX_BYTES, type BadgeSummary, type BoxResponse } from '@htn/shared';
	import { describeError, devReset, getBadges, getHealth, tapBox, type Health } from '$lib/api.ts';
	import { BOXES, SimState } from '$lib/sim.svelte.ts';

	const sim = new SimState();

	let summaries = $state<BadgeSummary[]>([]);
	let health = $state<Health | null>(null);
	let serverError = $state<string | null>(null);
	let refreshing = $state(false);
	let busy = $state<'tap' | 'reset' | null>(null);
	let rawResponse = $state<string | null>(null);
	let responseBytes = $state<number | null>(null);
	let responseOk = $state(true);
	let consoleCode = $state<string | null>(null);

	$effect(() => {
		sim.hydrate();
		void refresh();
		const timer = setInterval(() => void refresh(), 5000);
		return () => clearInterval(timer);
	});

	$effect(() => {
		sim.persist();
	});

	function pairingCodeFrom(chainLink: string): string | null {
		if (chainLink.length === 0) return null;
		try {
			const parsed = new URL(chainLink, window.location.origin);
			const match = parsed.pathname.match(/^\/s\/([^/]+)\/?$/);
			return match?.[1] ? decodeURIComponent(match[1]) : null;
		} catch {
			return null;
		}
	}

	function showResponse(response: BoxResponse): void {
		const compact = JSON.stringify(response);
		rawResponse = JSON.stringify(response, null, 2);
		responseBytes = new TextEncoder().encode(compact).byteLength;
		responseOk = true;
		consoleCode = pairingCodeFrom(response.chain_link);
	}

	async function refresh(): Promise<void> {
		if (refreshing) return;
		refreshing = true;
		try {
			const [rows, status] = await Promise.all([getBadges(), getHealth()]);
			summaries = rows;
			health = status;
			serverError = null;
		} catch (err) {
			serverError = describeError(err);
		} finally {
			refreshing = false;
		}
	}

	async function fireTap(): Promise<void> {
		const badge = sim.badge;
		if (!badge || sim.selectedBox.length === 0) return;
		busy = 'tap';
		try {
			const response = await tapBox({
				box: sim.selectedBox,
				user_id: badge.userId,
				name: badge.name,
				email: badge.email,
				public_key: badge.publicKey
			});
			showResponse(response);
			serverError = null;
			await refresh();
		} catch (err) {
			const message = describeError(err);
			rawResponse = JSON.stringify({ error: message }, null, 2);
			responseBytes = new TextEncoder().encode(rawResponse).byteLength;
			responseOk = false;
			consoleCode = null;
		} finally {
			busy = null;
		}
	}

	async function fireReset(): Promise<void> {
		if (!confirm('Wipe all badges, awards, and quest submissions on the server?')) return;
		busy = 'reset';
		try {
			await devReset();
			rawResponse = null;
			responseBytes = null;
			consoleCode = null;
			serverError = null;
			await refresh();
		} catch (err) {
			serverError = describeError(err);
		} finally {
			busy = null;
		}
	}
</script>

<svelte:head>
	<title>Box simulator · HTN × Solana</title>
</svelte:head>

<main class="shell wide">
	<section class="head">
		<div>
			<p class="label">Development tool</p>
			<h1 class="h2">Blind-box tapper</h1>
		</div>
		<div class="headright">
			<span class="pill" class:ok={health !== null} class:bad={serverError !== null}>
				<span class="dot"></span>
				{serverError ? 'Server down' : health ? 'Server up' : 'Checking'}
			</span>
			{#if health}
				<span class="pill" class:ok={health.chainEnabled}>
					{health.cluster} · chain {health.chainEnabled ? 'on' : 'off'}
				</span>
				<span class="pill">{health.badgeCount} {health.badgeCount === 1 ? 'badge' : 'badges'}</span>
			{/if}
			<button class="btn btn-danger btn-sm" type="button" onclick={fireReset} disabled={busy !== null}>
				{busy === 'reset' ? 'Resetting' : 'Reset server'}
			</button>
		</div>
	</section>

	{#if serverError}
		<p class="note note-error servernote">{serverError}</p>
	{/if}

	<div class="cols">
		<div class="col">
			<section class="panel">
				<p class="label label-bright">$ tap --box</p>
				<h2>Tap a box</h2>

				<label class="field">
					<span class="label">Badge</span>
					<select class="select" bind:value={sim.selectedBadgeId}>
						{#each sim.badges as badge (badge.userId)}
							<option value={badge.userId}>{badge.name} — {badge.userId}</option>
						{/each}
					</select>
				</label>

				<label class="field">
					<span class="label">Box</span>
					<select class="select" bind:value={sim.selectedBox}>
						{#each BOXES as box (box)}
							<option value={box}>
								{box}{health?.solanaBoxId === box ? ' — Solana box' : ''}
							</option>
						{/each}
					</select>
				</label>

				<button
					class="btn btn-green btn-block tap"
					type="button"
					onclick={fireTap}
					disabled={busy !== null || sim.badge === null}
				>
					{busy === 'tap' ? 'Tapping…' : 'Tap box'}
				</button>
			</section>

			<section class="panel">
				<div class="panelhead">
					<p class="label">Raw response</p>
					{#if responseBytes !== null}
						<span class="bytes" class:over={responseBytes > BOX_RESPONSE_MAX_BYTES}>
							{responseBytes}/{BOX_RESPONSE_MAX_BYTES} UTF-8 bytes
						</span>
					{/if}
				</div>
				{#if rawResponse}
					<pre class="pre raw" class:bad={!responseOk}>{rawResponse}</pre>
					{#if responseBytes !== null && responseBytes > BOX_RESPONSE_MAX_BYTES}
						<p class="note note-error sizewarn">Response exceeds the badge relay limit.</p>
					{/if}
					{#if consoleCode}
						<a class="btn btn-ghost btn-block open" href="/s/{encodeURIComponent(consoleCode)}">
							Open console
						</a>
					{/if}
				{:else}
					<p class="label hint">Tap a box to inspect its exact JSON payload.</p>
				{/if}
			</section>
		</div>

		<section class="panel roster">
			<div class="panelhead">
				<div>
					<p class="label">All badges — {summaries.length}</p>
					<p class="label hint">Refreshes every 5 seconds</p>
				</div>
				<button class="linkbtn label" type="button" onclick={() => void refresh()} disabled={refreshing}>
					{refreshing ? 'Refreshing' : 'Refresh'}
				</button>
			</div>

			{#if summaries.length === 0}
				<p class="label empty">
					{serverError ? 'No data — the server is unreachable.' : 'No badges yet. Tap a box.'}
				</p>
			{:else}
				<div class="tablewrap">
					<table class="table">
						<thead>
							<tr>
								<th>Badge id</th>
								<th>Name</th>
								<th>Items</th>
								<th>Quest</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{#each summaries as row (row.badge.badgeId)}
								<tr>
									<td class="mono">{row.badge.badgeId}</td>
									<td>{row.badge.name || '—'}</td>
									<td class="mono items">{row.items.join(', ') || '—'}</td>
									<td><span class="questchip {row.quest?.status ?? 'none'}">{row.quest?.status ?? '—'}</span></td>
									<td class="rowaction">
										<a class="btn btn-ghost btn-sm" href="/s/{encodeURIComponent(row.badge.pairingCode)}">
											Open
										</a>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	</div>
</main>

<style>
	.wide {
		max-width: 1180px;
		padding-top: 28px;
	}

	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
		padding-bottom: 18px;
		border-bottom: 1px solid var(--rule);
	}

	.headright {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.pill.ok {
		color: var(--green);
		border-color: color-mix(in srgb, var(--green) 40%, transparent);
	}

	.pill.bad {
		color: var(--red);
		border-color: color-mix(in srgb, var(--red) 45%, transparent);
	}

	.servernote {
		margin-top: 16px;
	}

	.cols {
		display: grid;
		grid-template-columns: minmax(280px, 0.8fr) minmax(0, 1.5fr);
		gap: 18px;
		align-items: start;
		margin-top: 18px;
	}

	.col {
		display: grid;
		gap: 18px;
	}

	.panel {
		border: 1px solid var(--rule);
		background: var(--bg-raise);
		padding: 18px;
		border-radius: 3px;
	}

	.panel h2 {
		margin: 6px 0 18px;
		font-size: 1.25rem;
	}

	.panelhead {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 12px;
	}

	.field {
		margin-top: 12px;
	}

	.field .label {
		display: block;
		margin-bottom: 5px;
	}

	.tap,
	.open {
		margin-top: 16px;
	}

	.hint {
		margin-top: 7px;
		letter-spacing: 0.08em;
		text-transform: none;
	}

	.raw {
		max-height: 280px;
		overflow: auto;
		border: 1px solid var(--rule);
		border-left: 2px solid var(--green);
		background: var(--bg-sunken);
		padding: 12px;
		border-radius: 2px;
	}

	.raw.bad {
		border-left-color: var(--red);
		color: #ffc9c9;
	}

	.bytes {
		font-family: var(--mono);
		font-size: 0.62rem;
		color: var(--green);
		white-space: nowrap;
	}

	.bytes.over {
		color: var(--red);
		font-weight: 700;
	}

	.sizewarn {
		margin: 10px 0 0;
	}

	.linkbtn {
		appearance: none;
		border: 0;
		background: transparent;
		color: var(--purple);
		cursor: pointer;
		padding: 4px 0;
	}

	.linkbtn:disabled {
		opacity: 0.45;
		cursor: wait;
	}

	.tablewrap {
		overflow-x: auto;
	}

	.table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.76rem;
	}

	.table th,
	.table td {
		padding: 11px 10px;
		border-top: 1px solid var(--rule-soft);
		text-align: left;
		vertical-align: middle;
	}

	.table th {
		font-family: var(--mono);
		font-size: 0.58rem;
		font-weight: 500;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.table .mono {
		font-size: 0.68rem;
	}

	.items {
		color: var(--green);
	}

	.rowaction {
		text-align: right !important;
	}

	.questchip {
		display: inline-block;
		font-family: var(--mono);
		font-size: 0.6rem;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.questchip.verifying {
		color: var(--amber);
	}

	.questchip.completed {
		color: var(--green);
	}

	.questchip.failed {
		color: var(--red);
	}

	.empty {
		padding: 22px 0;
		text-align: center;
	}

	@media (max-width: 820px) {
		.cols {
			grid-template-columns: 1fr;
		}
	}
</style>
