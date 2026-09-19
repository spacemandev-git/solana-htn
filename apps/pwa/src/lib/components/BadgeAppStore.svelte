<script lang="ts">
	import { describeBadgeError, listApps, submitApp } from '$lib/badge-api.ts';
	import { AppSubmitRequest, type HtnosApp } from '@htn/shared';
	import { onMount } from 'svelte';

	type AppKind = HtnosApp['kind'];
	type Draft = {
		name: string;
		description: string;
		url: string;
		author: string;
		sourceUrl: string;
		kind: AppKind;
	};

	function emptyDraft(): Draft {
		return {
			name: '',
			description: '',
			url: '',
			author: '',
			sourceUrl: '',
			kind: 'server'
		};
	}

	let apps = $state<HtnosApp[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let submitError = $state<string | null>(null);
	let submitting = $state(false);
	let dialog = $state<HTMLDialogElement | null>(null);
	let draft = $state<Draft>(emptyDraft());

	onMount(() => {
		void loadApps();
	});

	async function loadApps(): Promise<void> {
		loading = true;
		try {
			apps = (await listApps()).apps;
			loadError = null;
		} catch (err) {
			loadError = describeBadgeError(err);
		} finally {
			loading = false;
		}
	}

	function openDialog(): void {
		submitError = null;
		dialog?.showModal();
	}

	function closeDialog(): void {
		dialog?.close();
		submitError = null;
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (submitting) return;
		const candidate = {
			name: draft.name,
			description: draft.description,
			url: draft.url,
			author: draft.author,
			kind: draft.kind,
			...(draft.sourceUrl.trim().length > 0 ? { sourceUrl: draft.sourceUrl } : {})
		};
		const parsed = AppSubmitRequest.safeParse(candidate);
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			const field = issue?.path[0];
			submitError = `${typeof field === 'string' ? `${field}: ` : ''}${issue?.message ?? 'Check the form fields.'}`;
			return;
		}

		submitting = true;
		submitError = null;
		try {
			const { app } = await submitApp(parsed.data);
			apps = [app, ...apps];
			draft = emptyDraft();
			dialog?.close();
		} catch (err) {
			submitError = describeBadgeError(err);
		} finally {
			submitting = false;
		}
	}
</script>

<section class="card workspace" aria-labelledby="store-title">
	<div class="section-head">
		<div>
			<p class="label">03 / app store</p>
			<h2 class="h2" id="store-title">Built for the badge</h2>
		</div>
		<button class="btn btn-ghost" type="button" onclick={openDialog}>Submit an app</button>
	</div>
	<p class="body intro">Open community apps, or list something you built against the HTN OS API.</p>

	{#if loadError}
		<p class="note note-error" role="alert">{loadError}</p>
	{/if}

	<div class="app-grid" aria-label={loading ? 'Loading badge apps' : 'Badge apps'}>
		<article class="app-card app-card-builtin">
			<div class="app-title">
				<h3 class="h3">Rock, paper, scissors</h3>
				<span class="pill">sample</span>
			</div>
			<p class="caption">by HTN OS</p>
			<p class="body description">
				Play against the computer or another badge, right from this site. Left / Up / Right pick
				rock / paper / scissors.
			</p>
			<div class="app-links">
				<a class="btn btn-ghost" href="/badge/rps">Play →</a>
				<a class="btn-link" href="/badge/docs#3-examples">Source</a>
			</div>
		</article>
		{#if loading}
			{#each [1, 2, 3] as item (item)}
				<div class="app-card skeleton-card">
					<div class="skeleton skeleton-text title-line"></div>
					<div class="skeleton skeleton-text"></div>
					<div class="skeleton skeleton-text short"></div>
				</div>
			{/each}
		{:else}
			{#each apps as app (app.appId)}
				<article class="app-card">
					<div class="app-title">
						<h3 class="h3">{app.name}</h3>
						<span class="pill">{app.kind}</span>
					</div>
					<p class="caption">by {app.author}</p>
					<p class="body description">{app.description}</p>
					<div class="app-links">
						<a
							class="btn btn-ghost"
							href={app.url}
							target="_blank"
							rel="noopener"
							aria-label={`Open ${app.name} (opens in a new tab)`}>Open ↗</a
						>
						{#if app.sourceUrl}
							<a
								class="btn-link"
								href={app.sourceUrl}
								target="_blank"
								rel="noopener"
								aria-label={`${app.name} source code (opens in a new tab)`}>Source</a
							>
						{/if}
					</div>
				</article>
			{/each}
		{/if}
	</div>
	{#if !loading && apps.length === 0}
		<p class="body empty">No community apps yet — submit the first one.</p>
	{/if}

	<dialog class="dialog submit-dialog" bind:this={dialog} aria-labelledby="submit-app-title">
		<form onsubmit={submit}>
			<p class="label">Community listing</p>
			<h2 class="h3" id="submit-app-title">Submit a badge app</h2>
			<div class="form-fields">
				<label class="field">
					<span class="label">Name</span>
					<input class="input" bind:value={draft.name} maxlength="60" required />
				</label>
				<label class="field">
					<span class="label">Description</span>
					<textarea
						class="textarea"
						bind:value={draft.description}
						rows="4"
						maxlength="500"
						required
					></textarea>
				</label>
				<label class="field">
					<span class="label">App URL</span>
					<input class="input" type="url" bind:value={draft.url} required />
				</label>
				<label class="field">
					<span class="label">Author</span>
					<input class="input" bind:value={draft.author} maxlength="80" required />
				</label>
				<label class="field">
					<span class="label">Source URL (optional)</span>
					<input class="input" type="url" bind:value={draft.sourceUrl} />
				</label>
				<label class="field">
					<span class="label">Kind</span>
					<select class="select" bind:value={draft.kind}>
						<option value="server">Server</option>
						<option value="badge-to-badge">Badge to badge</option>
						<option value="tool">Tool</option>
					</select>
				</label>
			</div>
			{#if submitError}
				<p class="note note-error form-error" role="alert">{submitError}</p>
			{/if}
			<div class="dialog-actions">
				<button class="btn btn-ghost" type="button" disabled={submitting} onclick={closeDialog}
					>Cancel</button
				>
				<button class="btn btn-ghost" type="submit" disabled={submitting}>
					{submitting ? 'Submitting…' : 'Submit app'}
				</button>
			</div>
		</form>
	</dialog>
</section>

<style>
	.workspace {
		padding: clamp(var(--sp-4), 4vw, var(--sp-6));
	}

	.section-head,
	.app-title,
	.app-links {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-3);
		flex-wrap: wrap;
	}

	.section-head .h2 {
		margin-top: var(--sp-1);
	}

	.intro,
	.note,
	.app-grid,
	.empty {
		margin-top: var(--sp-4);
	}

	.app-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--sp-3);
	}

	.app-card {
		padding: var(--sp-4);
		border: 1px solid var(--rule-soft);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
	}

	.app-title {
		align-items: flex-start;
	}

	.app-card .caption {
		margin-top: var(--sp-1);
	}

	.description {
		margin-top: var(--sp-3);
	}

	.app-links {
		justify-content: flex-start;
		margin-top: var(--sp-4);
	}

	.skeleton-card {
		display: grid;
		gap: var(--sp-3);
	}

	.skeleton-card .title-line {
		width: 74%;
	}

	.skeleton-card .short {
		width: 42%;
	}

	.submit-dialog {
		width: min(540px, calc(100vw - 2 * var(--sp-4)));
		max-height: calc(100dvh - 2 * var(--sp-4));
		overflow: auto;
	}

	.submit-dialog .h3 {
		margin-top: var(--sp-1);
	}

	.form-fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--sp-3);
		margin-top: var(--sp-4);
	}

	.form-fields .field:nth-child(2),
	.form-fields .field:nth-child(3),
	.form-fields .field:nth-child(5) {
		grid-column: 1 / -1;
	}

	.field .label {
		display: block;
		margin-bottom: var(--sp-2);
	}

	.textarea {
		resize: vertical;
	}

	.form-error {
		margin-top: var(--sp-4);
	}

	@media (max-width: 620px) {
		.app-grid,
		.form-fields {
			grid-template-columns: 1fr;
		}

		.form-fields .field {
			grid-column: 1;
		}
	}
</style>
