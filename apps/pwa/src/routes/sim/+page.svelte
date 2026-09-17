<script lang="ts">
	import { BOXES, BOX_RESPONSE_MAX_BYTES, type BadgeSummary, type BoxResponse } from '@htn/shared';
	import { describeError, devReset, getBadges, getHealth, tapBox, type Health } from '$lib/api.ts';
	import { SimState } from '$lib/sim.svelte.ts';
	import { onMount } from 'svelte';

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
	let resetDialog = $state<HTMLDialogElement | null>(null);

	// onMount runs untracked: hydrate() and refresh() write state this block would
	// otherwise depend on, which made an $effect here loop until Svelte gave up.
	onMount(() => {
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

	async function confirmReset(): Promise<void> {
		resetDialog?.close();
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
			<h1 class="h1">Blind-box tapper</h1>
		</div>
		<div class="headright">
			<span
				class="pill"
				class:pill-ok={health !== null && serverError === null}
				class:pill-bad={serverError !== null}
			>
				<span class="dot"></span>
				{serverError ? 'Server down' : health ? 'Server up' : 'Checking'}
			</span>
			{#if health}
				<span class="pill" class:pill-ok={health.chainEnabled}>
					{health.cluster} · chain {health.chainEnabled ? 'on' : 'off'}
				</span>
				<span class="pill tnum">{health.badgeCount} {health.badgeCount === 1 ? 'badge' : 'badges'}</span>
			{/if}
			<button
				class="btn btn-danger"
				type="button"
				onclick={() => resetDialog?.showModal()}
				disabled={busy !== null}
			>
				{busy === 'reset' ? 'Resetting' : 'Reset server'}
			</button>
		</div>
	</section>

	<dialog class="dialog" bind:this={resetDialog} aria-labelledby="reset-dialog-title">
		<p class="label">Destructive</p>
		<h2 class="h3" id="reset-dialog-title">Reset the server?</h2>
		<p class="body">This wipes all badges, awards, and quest submissions.</p>
		<div class="dialog-actions">
			<button class="btn btn-ghost" type="button" onclick={() => resetDialog?.close()}>Cancel</button>
			<button class="btn btn-danger" type="button" onclick={confirmReset}>Reset server</button>
		</div>
	</dialog>

	{#if serverError}
		<p class="note note-error servernote">{serverError}</p>
	{/if}

	<div class="cols">
		<div class="col">
			<section class="panel card">
				<p class="label label-bright">$ tap --box</p>
				<h2 class="h2">Tap a box</h2>

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
						{#each BOXES as box (box.id)}
							<option value={box.id}>
								{box.name} ({box.id}) → item {box.item}{health?.solanaBoxId === box.id
									? ' — Solana box (item 8)'
									: health?.solanaFinalBoxId === box.id
										? ' — Solana final box (item 9, quest-gated)'
										: ''}
							</option>
						{/each}
					</select>
				</label>

				<button
					class="btn btn-block tap"
					type="button"
					onclick={fireTap}
					disabled={busy !== null || sim.badge === null}
				>
					{busy === 'tap' ? 'Tapping…' : 'Tap box'}
				</button>
			</section>

			<section class="panel card">
				<div class="panelhead">
					<p class="label">Raw response</p>
					{#if responseBytes !== null}
						<span class="bytes tnum" class:over={responseBytes > BOX_RESPONSE_MAX_BYTES}>
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
					<p class="caption">Tap a box to inspect its exact JSON payload.</p>
				{/if}
			</section>
		</div>

		<section class="panel card roster">
			<div class="panelhead">
				<div>
					<p class="label tnum">All badges — {summaries.length}</p>
					<p class="caption">Refreshes every 5 seconds</p>
				</div>
				<button class="btn-link" type="button" onclick={() => void refresh()} disabled={refreshing}>
					{refreshing ? 'Refreshing' : 'Refresh'}
				</button>
			</div>

			{#if summaries.length === 0}
				<div class="empty">
					{#if serverError}
						<p class="body">No data — the server is unreachable.</p>
					{:else}
						<p class="body">No badges yet.</p>
						<p class="caption">Pick a badge and a box on the left, then tap it.</p>
					{/if}
				</div>
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
									<td class="mono tnum">{row.badge.badgeId}</td>
									<td>{row.badge.name || '—'}</td>
									<td class="mono items">{row.items.join(', ') || '—'}</td>
									<td><span class="questchip {row.quest?.status ?? 'none'}">{row.quest?.status ?? '—'}</span></td>
									<td class="rowaction">
										<a class="btn btn-ghost" href="/s/{encodeURIComponent(row.badge.pairingCode)}">
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
		padding-top: var(--sp-6);
	}

	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--sp-4);
		flex-wrap: wrap;
		padding-bottom: var(--sp-4);
		border-bottom: 1px solid var(--rule);
	}

	.headright {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		flex-wrap: wrap;
	}

	.servernote {
		margin-top: var(--sp-4);
	}

	.cols {
		display: grid;
		grid-template-columns: minmax(280px, 0.8fr) minmax(0, 1.5fr);
		gap: var(--sp-4);
		align-items: start;
		margin-top: var(--sp-4);
	}

	.col {
		display: grid;
		gap: var(--sp-4);
	}

	.panel {
		padding: var(--sp-4);
	}

	.panel h2 {
		margin: var(--sp-2) 0 var(--sp-4);
	}

	.panelhead {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--sp-3);
		margin-bottom: var(--sp-3);
	}

	.field {
		margin-top: var(--sp-3);
	}

	.field .label {
		display: block;
		margin-bottom: var(--sp-1);
	}

	.tap,
	.open {
		margin-top: var(--sp-4);
	}

	.raw {
		max-height: 280px;
		overflow: auto;
		border: 1px solid var(--rule);
		border-left: 2px solid var(--green);
		background: var(--bg-sunken);
		padding: var(--sp-3);
		border-radius: var(--radius-sm);
	}

	.raw.bad {
		border-left-color: var(--red);
		color: var(--ink);
	}

	.bytes {
		font-family: var(--mono);
		font-size: 0.75rem;
		color: var(--ink-mute);
		white-space: nowrap;
	}

	.bytes.over {
		color: var(--red);
		font-weight: 700;
	}

	.sizewarn {
		margin: var(--sp-3) 0 0;
	}

	.tablewrap {
		overflow-x: auto;
	}

	.table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}

	.table th,
	.table td {
		padding: var(--sp-3) var(--sp-2);
		border-top: 1px solid var(--rule-soft);
		text-align: left;
		vertical-align: middle;
	}

	.table th {
		font-family: var(--mono);
		font-size: 0.75rem;
		font-weight: 500;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.table .mono {
		font-size: 0.75rem;
	}

	.items {
		color: var(--ink);
	}

	.table td.rowaction {
		text-align: right;
	}

	.questchip {
		display: inline-block;
		font-family: var(--mono);
		font-size: 0.75rem;
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
		padding: var(--sp-6) 0;
		text-align: center;
		display: grid;
		gap: var(--sp-1);
	}

	@media (max-width: 820px) {
		.cols {
			grid-template-columns: 1fr;
		}
	}
</style>
