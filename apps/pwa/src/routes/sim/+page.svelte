<script lang="ts">
	import type { BadgeSummary, QuestStatus, SyncResponse } from '@htn/shared';
	import {
		describeError,
		devReset,
		getBadges,
		getHealth,
		stationDisconnect,
		stationSync,
		type Health,
		type StationRoute
	} from '$lib/api.ts';
	import QrCode from '$lib/components/QrCode.svelte';
	import { phoneUrl, since } from '$lib/format.ts';
	import { SimLog, SimState, type SimBadge, type SimStation } from '$lib/sim.svelte.ts';

	const MOCK_VENDOR = 'http://localhost:3000/api/dev/vendor';
	const sim = new SimState();
	const log = new SimLog();

	let summaries = $state<BadgeSummary[]>([]);
	let health = $state<Health | null>(null);
	let serverError = $state<string | null>(null);
	let refreshing = $state(false);
	let lastRefresh = $state<number | null>(null);
	let busy = $state<'sync' | 'disconnect' | 'reset' | null>(null);
	let rawResponse = $state<string | null>(null);
	let rawOk = $state(true);
	let lastSync = $state<SyncResponse | null>(null);
	let qrCode = $state<string | null>(null);
	let newStation = $state<SimStation>({ stationId: '', name: '' });
	let newBadge = $state<SimBadge>({ badgeId: '', name: '', email: '' });
	let rosterOpen = $state(false);

	$effect(() => {
		sim.hydrate();
		void refresh();
	});

	$effect(() => {
		sim.persist();
	});

	$effect(() => {
		if (!sim.autoRefresh) return;
		const timer = setInterval(() => void refresh(), 3000);
		return () => clearInterval(timer);
	});

	let phoneTarget = $derived(qrCode ? phoneUrl(qrCode) : null);
	/** Dev routes drop the API key requirement; station routes are the real path. */
	let route = $derived<StationRoute>(sim.useDevRoutes ? 'dev' : 'station');
	let canFire = $derived(sim.useDevRoutes || sim.apiKey.length > 0);

	async function refresh(): Promise<void> {
		if (refreshing) return;
		refreshing = true;
		try {
			const [rows, status] = await Promise.all([getBadges(), getHealth()]);
			summaries = rows;
			health = status;
			serverError = null;
			lastRefresh = Date.now();
		} catch (err) {
			serverError = describeError(err);
			health = null;
		} finally {
			refreshing = false;
		}
	}

	function show(ok: boolean, payload: unknown): void {
		rawOk = ok;
		rawResponse = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
	}

	async function fireSync(): Promise<void> {
		const station = sim.station;
		const badge = sim.badge;
		if (!station || !badge) return;
		busy = 'sync';
		try {
			const res = await stationSync(
				sim.apiKey,
				{
					stationId: station.stationId,
					stationName: station.name,
					badge: { badgeId: badge.badgeId, name: badge.name, email: badge.email },
					rssi: -40 - Math.floor(Math.random() * 45)
				},
				route
			);
			lastSync = res;
			qrCode = res.pairingCode;
			show(true, res);
			log.push(
				true,
				`SYNC ${badge.badgeId} @ ${station.stationId}`,
				`pairing ${res.pairingCode} · quest ${res.questStatus ?? 'not submitted'}`
			);
			await refresh();
		} catch (err) {
			const message = describeError(err);
			show(false, message);
			log.push(false, `SYNC ${badge.badgeId} @ ${station.stationId}`, message);
		} finally {
			busy = null;
		}
	}

	async function fireDisconnect(): Promise<void> {
		const station = sim.station;
		const badge = sim.badge;
		if (!station || !badge) return;
		busy = 'disconnect';
		try {
			const res = await stationDisconnect(
				sim.apiKey,
				{ stationId: station.stationId, badgeId: badge.badgeId },
				route
			);
			show(true, res);
			log.push(
				true,
				`DISCONNECT ${badge.badgeId} @ ${station.stationId}`,
				res.ended ? `ended ${res.pairingCode ?? ''}` : 'no active session there'
			);
			await refresh();
		} catch (err) {
			const message = describeError(err);
			show(false, message);
			log.push(false, `DISCONNECT ${badge.badgeId} @ ${station.stationId}`, message);
		} finally {
			busy = null;
		}
	}

	async function fireReset(): Promise<void> {
		if (!confirm('Wipe all badges, sessions, and quest submissions on the server?')) return;
		busy = 'reset';
		try {
			const res = await devReset();
			show(true, res ?? { ok: true });
			log.push(true, 'RESET', 'server state wiped');
			lastSync = null;
			qrCode = null;
			await refresh();
		} catch (err) {
			const message = describeError(err);
			show(false, message);
			log.push(false, 'RESET', message);
		} finally {
			busy = null;
		}
	}

	function addStation(event: SubmitEvent): void {
		event.preventDefault();
		const id = newStation.stationId.trim();
		const name = newStation.name.trim();
		if (id.length === 0 || name.length === 0) return;
		sim.addStation({ stationId: id, name });
		newStation = { stationId: '', name: '' };
	}

	function addBadge(event: SubmitEvent): void {
		event.preventDefault();
		const id = newBadge.badgeId.trim();
		const name = newBadge.name.trim();
		const email = newBadge.email.trim();
		if (id.length === 0 || name.length === 0 || email.length === 0) return;
		sim.addBadge({ badgeId: id, name, email });
		newBadge = { badgeId: '', name: '', email: '' };
	}

	function stationLabel(stationId: string): string {
		return sim.stations.find((station) => station.stationId === stationId)?.name ?? stationId;
	}

	function questTone(status: QuestStatus | null): string {
		return status ?? 'none';
	}

	async function copy(value: string, title: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(value);
			log.push(true, title, value);
		} catch {
			log.push(false, title, 'Clipboard blocked — select the text and copy manually.');
		}
	}
</script>

<svelte:head>
	<title>Quest simulator · HTN × Solana</title>
</svelte:head>

<main class="shell wide">
	<section class="head">
		<div>
			<p class="label">Operator console</p>
			<h1 class="h2">Quest simulator</h1>
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
			<button class="btn btn-danger btn-sm" onclick={fireReset} disabled={busy !== null}>
				{busy === 'reset' ? 'Resetting' : 'Reset server'}
			</button>
		</div>
	</section>

	{#if serverError}
		<p class="note note-error servernote">{serverError}</p>
	{/if}

	<section class="vendor card">
		<div>
			<p class="label">Offline demo endpoint</p>
			<code>mock vendor for demos: {MOCK_VENDOR}</code>
		</div>
		<button class="btn btn-ghost btn-sm" onclick={() => copy(MOCK_VENDOR, 'COPY VENDOR')}>
			Copy
		</button>
	</section>

	<div class="cols">
		<div class="col">
			<section class="panel">
				<p class="label">Station API key</p>
				<input
					class="input"
					type="password"
					bind:value={sim.apiKey}
					placeholder="STATION_API_KEY"
					autocomplete="off"
					spellcheck="false"
				/>
				<p class="label hint">
					Sent as <span class="mono">x-station-key</span>. Stored in this browser only.
				</p>
				<label class="toggle label devtoggle">
					<input type="checkbox" bind:checked={sim.useDevRoutes} />
					Use /api/dev/* (no key, dev builds only)
				</label>
			</section>

			<section class="panel">
				<div class="panelhead">
					<p class="label">Fire an event</p>
					<button class="linkbtn label" onclick={() => (rosterOpen = !rosterOpen)}>
						{rosterOpen ? 'Hide roster' : 'Edit roster'}
					</button>
				</div>

				<label class="field">
					<span class="label">Station</span>
					<select class="select" bind:value={sim.stationId}>
						{#each sim.stations as station (station.stationId)}
							<option value={station.stationId}>{station.name} — {station.stationId}</option>
						{/each}
					</select>
				</label>

				<label class="field">
					<span class="label">Badge</span>
					<select class="select" bind:value={sim.badgeId}>
						{#each sim.badges as badge (badge.badgeId)}
							<option value={badge.badgeId}>{badge.name} — {badge.badgeId}</option>
						{/each}
					</select>
				</label>

				<div class="btnrow">
					<button class="btn" onclick={fireSync} disabled={busy !== null || !canFire}>
						{busy === 'sync' ? 'Syncing…' : 'Sync badge'}
					</button>
					<button
						class="btn btn-ghost"
						onclick={fireDisconnect}
						disabled={busy !== null || !canFire}
					>
						{busy === 'disconnect' ? 'Sending…' : 'Disconnect'}
					</button>
				</div>
				<p class="label hint">
					POSTing to <span class="mono">/api/{route === 'dev' ? 'dev' : 'station'}/*</span>
				</p>
				{#if !canFire}
					<p class="label warn">Enter the station API key, or switch on the dev routes.</p>
				{/if}

				{#if rosterOpen}
					<div class="roster">
						<form class="addform" onsubmit={addStation}>
							<p class="label">Add station</p>
							<input class="input" bind:value={newStation.stationId} placeholder="station-id" />
							<input class="input" bind:value={newStation.name} placeholder="Station name" />
							<button class="btn btn-ghost btn-sm" type="submit">Add station</button>
						</form>
						<form class="addform" onsubmit={addBadge}>
							<p class="label">Add badge</p>
							<input class="input" bind:value={newBadge.badgeId} placeholder="badge-id" />
							<input class="input" bind:value={newBadge.name} placeholder="Full name" />
							<input class="input" bind:value={newBadge.email} placeholder="email@school.ca" />
							<button class="btn btn-ghost btn-sm" type="submit">Add badge</button>
						</form>
						<div class="chips">
							{#each sim.stations as station (station.stationId)}
								<span class="chip">
									{station.stationId}
									<button
										class="chipx"
										aria-label="Remove {station.stationId}"
										onclick={() => sim.removeStation(station.stationId)}>×</button
									>
								</span>
							{/each}
						</div>
						<div class="chips">
							{#each sim.badges as badge (badge.badgeId)}
								<span class="chip">
									{badge.badgeId}
									<button
										class="chipx"
										aria-label="Remove {badge.badgeId}"
										onclick={() => sim.removeBadge(badge.badgeId)}>×</button
									>
								</span>
							{/each}
						</div>
						<button class="btn btn-ghost btn-sm" onclick={() => sim.resetRoster()}>
							Restore seeded roster
						</button>
					</div>
				{/if}
			</section>

			<section class="panel">
				<p class="label">Raw response</p>
				{#if rawResponse}
					<pre class="pre raw" class:bad={!rawOk}>{rawResponse}</pre>
				{:else}
					<p class="label hint">Nothing fired yet.</p>
				{/if}
				{#if lastSync}
					<div class="synced">
						<span class="label">Pairing code</span>
						<span class="code">{lastSync.pairingCode}</span>
						<span class="label">Server URL</span>
						<span class="mono url">{lastSync.url}</span>
					</div>
				{/if}
			</section>

			{#if qrCode && phoneTarget}
				<section class="panel">
					<div class="panelhead">
						<p class="label">Quest view — {qrCode}</p>
						<button class="linkbtn label" onclick={() => (qrCode = null)}>Hide</button>
					</div>
					<div class="qrrow">
						<QrCode value={phoneTarget} size={150} />
						<div class="qrmeta">
							<span class="mono url">{phoneTarget}</span>
							<div class="btnrow">
								<a class="btn btn-sm" href="/s/{encodeURIComponent(qrCode)}">Open</a>
								<button class="btn btn-ghost btn-sm" onclick={() => copy(phoneTarget, 'COPY LINK')}>
									Copy link
								</button>
							</div>
						</div>
					</div>
				</section>
			{/if}

			<section class="panel">
				<div class="panelhead">
					<p class="label">Operator log</p>
					<button class="linkbtn label" onclick={() => log.clear()} disabled={log.entries.length === 0}>
						Clear
					</button>
				</div>
				{#if log.entries.length === 0}
					<p class="label hint">Actions you fire show up here.</p>
				{:else}
					<ul class="log">
						{#each log.entries as entry (entry.id)}
							<li class:bad={!entry.ok}>
								<span class="label time">{entry.at}</span>
								<span class="logtitle">{entry.title}</span>
								<span class="label logdetail">{entry.detail}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>

		<div class="col">
			<section class="panel">
				<div class="panelhead">
					<p class="label">All badges — {summaries.length}</p>
					<div class="panelactions">
						<label class="toggle label">
							<input type="checkbox" bind:checked={sim.autoRefresh} />
							Auto
						</label>
						<button class="linkbtn label" onclick={() => void refresh()} disabled={refreshing}>
							{refreshing ? 'Refreshing' : 'Refresh'}
						</button>
					</div>
				</div>

				{#if summaries.length === 0}
					<p class="label hint">
						{serverError ? 'No data — the server is unreachable.' : 'No badges yet. Fire a sync.'}
					</p>
				{:else}
					<div class="tablewrap">
						<table class="table">
							<thead>
								<tr>
									<th>Badge</th>
									<th>Active station</th>
									<th>Pairing code</th>
									<th>Quest</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								{#each summaries as row (row.badge.badgeId)}
									<tr>
										<td>
											<span class="badge-name">{row.badge.name}</span>
											<span class="label">{row.badge.badgeId}</span>
										</td>
										<td>
											{#if row.activeSession}
												<span>{stationLabel(row.activeSession.stationId)}</span>
												<span class="label">{row.activeSession.stationId}</span>
											{:else}
												<span class="label muted">—</span>
											{/if}
										</td>
										<td>
											{#if row.activeSession}
												<a class="pairing" href="/s/{row.activeSession.pairingCode}">
													{row.activeSession.pairingCode}
												</a>
											{:else}
												<span class="label muted">—</span>
											{/if}
										</td>
										<td>
											<span class="questchip {questTone(row.quest?.status ?? null)}">
												{row.quest?.status ?? '—'}
											</span>
										</td>
										<td class="rowaction">
											{#if row.activeSession}
												<button
													class="btn btn-ghost btn-sm"
													onclick={() => (qrCode = row.activeSession?.pairingCode ?? null)}
												>
													QR
												</button>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<p class="label hint">
						{lastRefresh ? `Updated ${since(new Date(lastRefresh).toISOString())}` : ''}
						{sim.autoRefresh ? ' · polling every 3s' : ' · auto-refresh off'}
					</p>
				{/if}
			</section>
		</div>
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

	.vendor {
		margin-top: 18px;
		padding: 14px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		background: var(--bg-sunken);
	}

	.vendor code {
		display: block;
		margin-top: 5px;
		font-family: var(--mono);
		font-size: 0.75rem;
		color: var(--green);
		word-break: break-all;
	}

	.cols {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0 28px;
	}

	.col {
		min-width: 0;
	}

	.panel {
		padding: 20px 0;
		border-bottom: 1px solid var(--rule);
	}

	.panelhead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 10px;
	}

	.panelactions {
		display: flex;
		align-items: center;
		gap: 14px;
	}

	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
		color: var(--ink-mute);
	}

	.toggle input {
		accent-color: var(--purple);
		width: 13px;
		height: 13px;
	}

	.linkbtn {
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		color: var(--purple);
		font-family: var(--mono);
	}

	.linkbtn:disabled {
		color: var(--ink-faint);
		cursor: not-allowed;
	}

	.field {
		margin-top: 12px;
	}

	.field .label {
		display: block;
		margin-bottom: 5px;
	}

	.hint {
		margin-top: 8px;
	}

	.warn {
		margin-top: 8px;
		color: var(--amber);
	}

	.btnrow {
		display: flex;
		gap: 8px;
		margin-top: 14px;
		flex-wrap: wrap;
	}

	.roster {
		margin-top: 18px;
		padding-top: 16px;
		border-top: 1px solid var(--rule-soft);
		display: grid;
		gap: 14px;
	}

	.addform {
		display: grid;
		gap: 6px;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 6px 3px 9px;
		border: 1px solid var(--rule);
		border-radius: 999px;
		font-family: var(--mono);
		font-size: 0.62rem;
		color: var(--ink-mute);
	}

	.chipx {
		background: none;
		border: 0;
		color: var(--ink-faint);
		cursor: pointer;
		font-size: 0.9rem;
		line-height: 1;
		padding: 0 2px;
	}

	.chipx:hover {
		color: var(--red);
	}

	.raw {
		max-height: 240px;
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

	.synced {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 6px 14px;
		align-items: baseline;
		margin-top: 14px;
	}

	.code {
		font-family: var(--mono);
		font-size: 1.1rem;
		letter-spacing: 0.22em;
		color: var(--green);
	}

	.url {
		color: var(--ink-mute);
		word-break: break-all;
	}

	.qrrow {
		display: flex;
		gap: 16px;
		align-items: flex-start;
		flex-wrap: wrap;
	}

	.qrmeta {
		flex: 1 1 180px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.log {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.log li {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 2px 12px;
		padding: 8px 0 8px 10px;
		border-top: 1px solid var(--rule-soft);
		border-left: 2px solid var(--green);
	}

	.log li.bad {
		border-left-color: var(--red);
	}

	.logtitle {
		font-family: var(--mono);
		font-size: 0.72rem;
		color: var(--ink);
	}

	.logdetail {
		grid-column: 2;
		color: var(--ink-faint);
		text-transform: none;
		letter-spacing: 0.02em;
	}

	.time {
		color: var(--ink-faint);
	}

	.tablewrap {
		overflow-x: auto;
	}

	.table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.82rem;
	}

	.table th {
		text-align: left;
		font-family: var(--mono);
		font-size: 0.58rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--ink-faint);
		font-weight: 500;
		padding: 0 14px 8px 0;
		border-bottom: 1px solid var(--rule);
		white-space: nowrap;
	}

	.table td {
		padding: 11px 14px 11px 0;
		border-bottom: 1px solid var(--rule-soft);
		vertical-align: top;
		white-space: nowrap;
	}

	.table td .label {
		display: block;
	}

	.badge-name {
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.muted {
		color: var(--ink-faint);
	}

	.pairing {
		font-family: var(--mono);
		font-size: 0.74rem;
		letter-spacing: 0.1em;
		color: var(--green);
	}

	.questchip {
		display: inline-flex;
		padding: 3px 7px;
		border: 1px solid var(--rule-strong);
		border-radius: 999px;
		font-family: var(--mono);
		font-size: 0.62rem;
		color: var(--ink-faint);
	}

	.questchip.verifying {
		color: var(--amber);
		border-color: color-mix(in srgb, var(--amber) 45%, transparent);
	}

	.questchip.completed {
		color: var(--green);
		border-color: color-mix(in srgb, var(--green) 45%, transparent);
	}

	.questchip.failed {
		color: var(--red);
		border-color: color-mix(in srgb, var(--red) 45%, transparent);
	}

	.rowaction {
		text-align: right;
		padding-right: 0;
	}

	.devtoggle {
		margin-top: 10px;
	}

	@media (max-width: 500px) {
		.vendor {
			align-items: flex-start;
			flex-direction: column;
		}
	}

	@media (min-width: 900px) {
		.cols {
			grid-template-columns: 380px minmax(0, 1fr);
		}
	}
</style>
