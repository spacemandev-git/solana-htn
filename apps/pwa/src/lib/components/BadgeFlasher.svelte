<script lang="ts">
	import { assets } from '$app/paths';
	import {
		fetchManifest,
		flashFirmware,
		webSerialSupported,
		type FirmwareManifest,
		type FlashProgress
	} from '$lib/flasher.ts';
	import { onMount } from 'svelte';

	const firmwareBase = `${assets}/firmware/htn-os`;
	let manifest = $state<FirmwareManifest | null>(null);
	let manifestLoading = $state(true);
	let manifestMissing = $state(false);
	let serialSupported = $state(false);
	let eraseAll = $state(true);
	let progress = $state<FlashProgress>({ stage: 'idle', percent: 0, log: [] });
	let logElement = $state<HTMLPreElement | null>(null);

	const active = $derived(
		progress.stage === 'loading' ||
			progress.stage === 'connecting' ||
			progress.stage === 'erasing' ||
			progress.stage === 'writing'
	);

	onMount(() => {
		serialSupported = webSerialSupported();
		void loadManifest();
	});

	$effect(() => {
		progress.log;
		if (logElement) {
			requestAnimationFrame(() => {
				if (logElement) logElement.scrollTop = logElement.scrollHeight;
			});
		}
	});

	async function loadManifest(): Promise<void> {
		manifestLoading = true;
		try {
			manifest = await fetchManifest(firmwareBase);
			manifestMissing = false;
		} catch {
			manifest = null;
			manifestMissing = true;
		} finally {
			manifestLoading = false;
		}
	}

	async function flash(): Promise<void> {
		if (!manifest || !serialSupported || active) return;
		progress = { stage: 'loading', percent: 0, log: [] };
		try {
			await flashFirmware(firmwareBase, manifest, {
				eraseAll,
				onProgress: (next) => {
					progress = next;
				}
			});
		} catch {
			// flashFirmware emits the actionable error in its final progress snapshot.
		}
	}

	function builtAt(value: string): string {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
	}
</script>

<section class="card workspace" aria-labelledby="flasher-title">
	<div class="section-head">
		<div>
			<p class="label">01 / firmware</p>
			<h2 class="h2" id="flasher-title">Flash HTN OS</h2>
		</div>
		{#if manifest}
			<span class="pill">v{manifest.version}</span>
		{/if}
	</div>

	{#if manifestLoading}
		<div class="manifest-skeleton" aria-label="Loading firmware details">
			<div class="skeleton skeleton-text"></div>
			<div class="skeleton skeleton-text short"></div>
		</div>
	{:else if manifestMissing}
		<p class="note">Firmware not published yet — run <code>bun run firmware:build</code>.</p>
	{:else if manifest}
		<p class="caption manifest-meta">
			{manifest.name} · {manifest.chip} · built {builtAt(manifest.builtAt)}
		</p>
	{/if}

	{#if !serialSupported}
		<p class="note">Web Serial is needed: use Chrome or Edge on desktop.</p>
	{/if}

	<ol class="steps mono">
		<li><span aria-hidden="true">$</span> Plug in USB-C.</li>
		<li><span aria-hidden="true">$</span> If the badge is not found, hold Start while plugging in (download mode).</li>
		<li><span aria-hidden="true">$</span> Click Flash.</li>
		<li><span aria-hidden="true">$</span> Wait for “done”.</li>
		<li><span aria-hidden="true">$</span> The badge reboots into HTN OS.</li>
	</ol>

	<label class="erase-option">
		<input type="checkbox" bind:checked={eraseAll} disabled={active} />
		<span>Erase everything first (recommended for the first flash)</span>
	</label>

	<div class="flash-actions">
		<button
			class="btn"
			type="button"
			onclick={() => void flash()}
			disabled={!serialSupported || !manifest || active}
		>
			{active ? 'Flashing…' : 'Flash HTN OS'}
		</button>
		<span class="mono stage tnum">{progress.stage} · {Math.round(progress.percent)}%</span>
	</div>

	<div class="progress-track">
		<div
			class="progress-fill"
			style:width={`${Math.max(0, Math.min(100, progress.percent))}%`}
			role="progressbar"
			aria-label="Firmware flash progress"
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={Math.round(progress.percent)}
		></div>
	</div>

	{#if progress.error}
		<p class="note note-error" role="alert">{progress.error}</p>
	{/if}

	<pre class="pre flash-log" bind:this={logElement} aria-live="polite">{progress.log.length > 0
			? progress.log.slice(-200).join('\n')
			: 'Waiting for a badge…'}</pre>
</section>

<style>
	.workspace {
		padding: clamp(var(--sp-4), 4vw, var(--sp-6));
	}

	.section-head,
	.flash-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-3);
		flex-wrap: wrap;
	}

	.section-head .h2 {
		margin-top: var(--sp-1);
	}

	.manifest-skeleton,
	.manifest-meta,
	.note,
	.steps,
	.erase-option,
	.flash-actions,
	.progress-track,
	.flash-log {
		margin-top: var(--sp-4);
	}

	.manifest-skeleton {
		display: grid;
		gap: var(--sp-2);
	}

	.manifest-skeleton .short {
		width: 38%;
	}

	.steps {
		list-style: none;
		padding: var(--sp-4) 0;
		border-top: 1px solid var(--rule-soft);
		border-bottom: 1px solid var(--rule-soft);
		display: grid;
		gap: var(--sp-2);
		color: var(--ink-mute);
	}

	.steps li {
		display: grid;
		grid-template-columns: var(--sp-4) 1fr;
		gap: var(--sp-2);
	}

	.steps li span {
		color: var(--accent);
	}

	.erase-option {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		min-height: var(--tap);
		font-size: 0.875rem;
		color: var(--ink-mute);
	}

	.erase-option input {
		width: 20px;
		height: 20px;
		accent-color: var(--accent);
	}

	.stage {
		color: var(--ink-faint);
	}

	.progress-track {
		height: var(--sp-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: var(--accent);
		transition: width var(--dur) ease-out;
	}

	.flash-log {
		min-height: 96px;
		max-height: 220px;
		overflow: auto;
		padding: var(--sp-3);
		border: 1px solid var(--rule-soft);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
	}
</style>
