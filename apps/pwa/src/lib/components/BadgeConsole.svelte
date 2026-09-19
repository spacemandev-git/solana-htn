<script lang="ts">
	import {
		BadgeApiFailure,
		badgeClear,
		badgeEventsUrl,
		badgeHome,
		badgeImage,
		badgeLeds,
		badgeText,
		describeBadgeError,
		getBadgeStatus
	} from '$lib/badge-api.ts';
	import { HTNOS_ID_LENGTH, type HtnosBadgeStatus, type HtnosEvent } from '@htn/shared';
	import { onMount } from 'svelte';

	const COLORS = [
		{ name: 'Purple', value: '#9945ff' },
		{ name: 'Green', value: '#14f195' },
		{ name: 'Blue', value: '#298cff' },
		{ name: 'Amber', value: '#ffb648' },
		{ name: 'Red', value: '#ff5c5c' },
		{ name: 'White', value: '#ffffff' }
	] as const;

	let badgeId = $state('');
	let appKey = $state('');
	let status = $state<HtnosBadgeStatus | null>(null);
	let statusNotFound = $state(false);
	let statusError = $state<string | null>(null);
	let commandError = $state<string | null>(null);
	let commandStatus = $state<string | null>(null);
	let busy = $state<string | null>(null);
	let text = $state('HELLO BADGE');
	let selectedColor = $state<string>(COLORS[0].value);
	let fit = $state<'contain' | 'none'>('contain');
	let imageInput = $state<HTMLInputElement | null>(null);
	let mounted = $state(false);
	let live = $state(false);
	let events = $state<HtnosEvent[]>([]);
	let eventError = $state<string | null>(null);
	let eventSource: EventSource | null = null;
	let statusRequest = 0;

	onMount(() => {
		badgeId = (localStorage.getItem('htnos.badgeId') ?? '').toLowerCase().slice(0, HTNOS_ID_LENGTH);
		appKey = localStorage.getItem('htnos.key') ?? '';
		mounted = true;
		const timer = setInterval(() => void refreshStatus(badgeId.trim()), 5000);
		return () => {
			clearInterval(timer);
			closeEvents();
		};
	});

	$effect(() => {
		const id = badgeId.trim();
		const key = appKey;
		const eventsLive = live;
		if (!mounted) return;
		localStorage.setItem('htnos.badgeId', id);
		localStorage.setItem('htnos.key', key);
		void refreshStatus(id);
		closeEvents();
		if (eventsLive && id.length > 0 && key.trim().length > 0) openEvents(id, key.trim());
	});

	async function refreshStatus(id: string): Promise<void> {
		const requestId = ++statusRequest;
		if (id.length === 0) {
			status = null;
			statusNotFound = false;
			statusError = null;
			return;
		}
		try {
			const next = await getBadgeStatus(id);
			if (requestId !== statusRequest) return;
			status = next;
			statusNotFound = false;
			statusError = null;
		} catch (err) {
			if (requestId !== statusRequest) return;
			status = null;
			if (err instanceof BadgeApiFailure && err.code === 'badge_not_found') {
				statusNotFound = true;
				statusError = null;
			} else {
				statusNotFound = false;
				statusError = describeBadgeError(err);
			}
		}
	}

	function credentials(): { id: string; key: string } | null {
		const id = badgeId.trim();
		const key = appKey.trim();
		if (id.length === 0 || key.length === 0) {
			commandError = 'Enter both an HTN-ID and an app key.';
			commandStatus = null;
			return null;
		}
		return { id, key };
	}

	async function runCommand(
		name: string,
		success: string,
		command: (id: string, key: string) => Promise<unknown>
	): Promise<void> {
		const auth = credentials();
		if (!auth || busy) return;
		busy = name;
		commandError = null;
		commandStatus = null;
		try {
			await command(auth.id, auth.key);
			commandStatus = success;
			void refreshStatus(auth.id);
		} catch (err) {
			commandError = describeBadgeError(err);
		} finally {
			busy = null;
		}
	}

	function sendText(): void {
		const value = text.trim();
		if (value.length === 0) {
			commandError = 'Enter some text to send.';
			commandStatus = null;
			return;
		}
		void runCommand('text', 'Text sent.', (id, key) => badgeText(id, key, { text: value }));
	}

	function showImage(): void {
		const file = imageInput?.files?.[0];
		if (!file) {
			commandError = 'Choose a PNG or JPEG first.';
			commandStatus = null;
			return;
		}
		void runCommand('image', 'Image shown.', (id, key) => badgeImage(id, key, file, fit));
	}

	function updateBadgeId(event: Event): void {
		badgeId = (event.currentTarget as HTMLInputElement).value
			.toLowerCase()
			.slice(0, HTNOS_ID_LENGTH);
	}

	function closeEvents(): void {
		eventSource?.close();
		eventSource = null;
	}

	function openEvents(id: string, key: string): void {
		eventError = null;
		const source = new EventSource(badgeEventsUrl(id, key));
		eventSource = source;
		const receive = (event: MessageEvent<string>): void => {
			try {
				const parsed = JSON.parse(event.data) as HtnosEvent;
				events = [...events, parsed].slice(-50);
				eventError = null;
			} catch {
				eventError = 'The badge service sent an unreadable event.';
			}
		};
		for (const eventName of ['button', 'accel', 'mode', 'online', 'offline', 'ping']) {
			source.addEventListener(eventName, receive as EventListener);
		}
		source.onerror = () => {
			eventError = 'Live events disconnected; the browser will keep trying.';
		};
	}

	function toggleEvents(): void {
		if (live) {
			live = false;
			closeEvents();
			eventError = null;
			return;
		}
		const auth = credentials();
		if (!auth) return;
		events = [];
		live = true;
	}

	function eventLine(event: HtnosEvent): string {
		if (event.event === 'button') {
			return `${event.at}  button  ${event.button}  ${event.pressed ? 'pressed' : 'released'}`;
		}
		if (event.event === 'accel') {
			return `${event.at}  accel   x=${event.x} y=${event.y} z=${event.z}`;
		}
		if (event.event === 'mode') return `${event.at}  mode    ${event.mode}`;
		return `${event.at}  ${event.event}`;
	}

	function seenAt(value: string): string {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
	}
</script>

<section class="card workspace" aria-labelledby="console-title">
	<div class="section-head">
		<div>
			<p class="label">02 / your badge</p>
			<h2 class="h2" id="console-title">Badge console</h2>
		</div>
		{#if statusNotFound}
			<span class="pill pill-bad" role="status" aria-live="polite">Not found</span>
		{:else if status?.online}
			<span class="pill pill-ok" role="status" aria-live="polite">Online</span>
		{:else if status}
			<span class="pill pill-warn" role="status" aria-live="polite">Registered · offline</span>
		{:else}
			<span class="pill" role="status" aria-live="polite">Waiting for HTN-ID</span>
		{/if}
	</div>

	<div class="auth-grid">
		<label class="field">
			<span class="label">HTN-ID</span>
			<input
				class="input badge-id"
				value={badgeId}
				oninput={updateBadgeId}
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
	</div>

	{#if status}
		<dl class="status-grid">
			<div><dt>Firmware</dt><dd>{status.fw ?? '—'}</dd></div>
			<div><dt>Mode</dt><dd>{status.mode ?? 'offline'}</dd></div>
			<div><dt>App key</dt><dd>{status.hasKey ? 'set' : 'not set'}</dd></div>
			<div><dt>Last seen</dt><dd>{seenAt(status.lastSeenAt)}</dd></div>
		</dl>
	{/if}
	{#if statusError}
		<p class="note note-error feedback" role="alert">{statusError}</p>
	{/if}

	<div class="command-grid">
		<section class="command-block">
			<div class="command-head">
				<h3 class="h3">Screen</h3>
				<button
					class="btn btn-ghost"
					type="button"
					disabled={busy !== null}
					onclick={() =>
						void runCommand('hello', 'Greeting sent.', (id, key) =>
							badgeText(id, key, {
								text: 'HI FROM\nTHE WEB',
								size: 4,
								clear: true,
								color: '#9945ff'
							})
						)}>Say hi</button
				>
			</div>
			<label class="field">
				<span class="label">Text</span>
				<input class="input" bind:value={text} maxlength="256" />
			</label>
			<div class="action-row">
				<button class="btn btn-ghost" type="button" disabled={busy !== null} onclick={sendText}
					>Send text</button
				>
				<button
					class="btn btn-ghost"
					type="button"
					disabled={busy !== null}
					onclick={() =>
						void runCommand('clear', 'Screen cleared.', (id, key) => badgeClear(id, key))}
					>Clear screen</button
				>
				<button
					class="btn btn-ghost"
					type="button"
					disabled={busy !== null}
					onclick={() =>
						void runCommand('home', 'Badge returned to its menu.', (id, key) => badgeHome(id, key))}
					>Back to menu</button
				>
			</div>
		</section>

		<section class="command-block">
			<h3 class="h3">LEDs</h3>
			<div class="swatches" aria-label="LED colour">
				{#each COLORS as color (color.value)}
					<button
						class="swatch"
						class:selected={selectedColor === color.value}
						type="button"
						style:background-color={color.value}
						aria-label={`Select ${color.name}`}
						aria-pressed={selectedColor === color.value}
						onclick={() => (selectedColor = color.value)}
					></button>
				{/each}
			</div>
			<div class="action-row">
				<button
					class="btn btn-ghost"
					type="button"
					disabled={busy !== null}
					onclick={() =>
						void runCommand('leds', 'LED colour set.', (id, key) =>
							badgeLeds(id, key, { all: selectedColor })
						)}>Set LEDs</button
				>
				<button
					class="btn-link"
					type="button"
					disabled={busy !== null}
					onclick={() =>
						void runCommand('leds-off', 'LEDs turned off.', (id, key) =>
							badgeLeds(id, key, { all: '#000000' })
						)}>LEDs off</button
				>
			</div>
		</section>

		<section class="command-block">
			<h3 class="h3">Image</h3>
			<div class="image-grid">
				<label class="field">
					<span class="label">PNG or JPEG</span>
					<input
						class="input file-input"
						type="file"
						accept="image/png,image/jpeg"
						bind:this={imageInput}
					/>
				</label>
				<label class="field">
					<span class="label">Fit</span>
					<select class="select" bind:value={fit}>
						<option value="contain">Contain</option>
						<option value="none">1:1, crop edges</option>
					</select>
				</label>
			</div>
			<button
				class="btn btn-ghost image-action"
				type="button"
				disabled={busy !== null}
				onclick={showImage}>Show image</button
			>
		</section>
	</div>

	{#if commandError}
		<p class="note note-error feedback" role="alert">{commandError}</p>
	{:else if commandStatus}
		<p class="note note-ok feedback" role="status">{commandStatus}</p>
	{/if}

	<section class="events" aria-labelledby="events-title">
		<div class="command-head">
			<div>
				<h3 class="h3" id="events-title">Live events</h3>
				<p class="caption">Buttons, motion, mode, and connection changes.</p>
			</div>
			<button
				class="btn btn-ghost"
				type="button"
				aria-pressed={live}
				onclick={toggleEvents}>{live ? 'Stop events' : 'Start events'}</button
			>
		</div>
		{#if eventError}
			<p class="note note-error feedback" role="alert">{eventError}</p>
		{/if}
		<pre class="pre event-log" aria-live="polite">{events.length > 0
				? events.map(eventLine).join('\n')
				: live
					? 'Listening…'
					: 'Events are off.'}</pre>
	</section>
</section>

<style>
	.workspace {
		padding: clamp(var(--sp-4), 4vw, var(--sp-6));
	}

	.section-head,
	.command-head,
	.action-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-3);
		flex-wrap: wrap;
	}

	.section-head .h2 {
		margin-top: var(--sp-1);
	}

	.auth-grid,
	.command-grid,
	.image-grid {
		display: grid;
		gap: var(--sp-4);
	}

	.auth-grid {
		grid-template-columns: minmax(0, 0.6fr) minmax(0, 1.4fr);
		margin-top: var(--sp-5);
	}

	.field .label {
		display: block;
		margin-bottom: var(--sp-2);
	}

	.badge-id {
		font-family: var(--mono);
		text-transform: lowercase;
	}

	.status-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--sp-2);
		margin: var(--sp-4) 0 0;
	}

	.status-grid div {
		padding: var(--sp-3);
		border: 1px solid var(--rule-soft);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		min-width: 0;
	}

	.status-grid dt,
	.status-grid dd {
		margin: 0;
		font-family: var(--mono);
		font-size: 0.75rem;
	}

	.status-grid dt {
		color: var(--ink-faint);
	}

	.status-grid dd {
		margin-top: var(--sp-1);
		color: var(--ink);
		overflow-wrap: anywhere;
	}

	.command-grid {
		margin-top: var(--sp-5);
	}

	.command-block,
	.events {
		padding-top: var(--sp-4);
		border-top: 1px solid var(--rule-soft);
	}

	.command-block > .field,
	.command-block > .action-row,
	.swatches,
	.image-grid,
	.image-action {
		margin-top: var(--sp-3);
	}

	.action-row {
		justify-content: flex-start;
	}

	.swatches {
		display: flex;
		gap: var(--sp-2);
		flex-wrap: wrap;
	}

	.swatch {
		appearance: none;
		width: var(--tap);
		height: var(--tap);
		border: 2px solid var(--rule-strong);
		border-radius: var(--radius-full);
		cursor: pointer;
	}

	.swatch.selected {
		border-color: var(--ink);
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.image-grid {
		grid-template-columns: minmax(0, 1fr) minmax(150px, 0.35fr);
	}

	.file-input {
		padding: var(--sp-2);
	}

	.file-input::file-selector-button {
		min-height: 32px;
		margin-right: var(--sp-3);
		border: 1px solid var(--rule-strong);
		border-radius: var(--radius-sm);
		background: var(--bg-raise);
		color: var(--ink);
		font-family: var(--mono);
		cursor: pointer;
	}

	.feedback,
	.events {
		margin-top: var(--sp-4);
	}

	.event-log {
		min-height: 112px;
		max-height: 260px;
		overflow: auto;
		margin-top: var(--sp-3);
		padding: var(--sp-3);
		border: 1px solid var(--rule-soft);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
	}

	@media (max-width: 680px) {
		.auth-grid,
		.image-grid {
			grid-template-columns: 1fr;
		}

		.status-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
