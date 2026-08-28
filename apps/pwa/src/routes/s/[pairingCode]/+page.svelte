<script lang="ts">
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import {
		QUEST_STEP_LABELS,
		atomicToUsd,
		explorerAddressUrl,
		explorerTxUrl,
		type QuestSubmitRequest
	} from '@htn/shared';
	import { describeError, submitQuest } from '$lib/api.ts';
	import StatusPill from '$lib/components/StatusPill.svelte';
	import { LiveSession } from '$lib/live.svelte.ts';

	const PROGRAM_ID = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

	let code = $derived(page.params.pairingCode ?? '');
	let live = $state<LiveSession | null>(null);
	let endpointUrl = $state('');
	let programId = $state('');
	let formError = $state<string | null>(null);
	let posting = $state(false);
	let seededAt = $state<string | null>(null);
	let briefOpen = $state(true);
	let logPanel = $state<HTMLDivElement | null>(null);

	$effect(() => {
		const pairingCode = code;
		if (pairingCode.length === 0) return;
		const session = new LiveSession(pairingCode);
		live = session;
		void session.start();
		return () => {
			session.stop();
			live = null;
		};
	});

	let view = $derived(live?.view ?? null);
	let status = $derived(live?.status ?? 'loading');
	let quest = $derived(view?.quest ?? null);
	let progressLog = $derived(live?.progressLog ?? []);
	let completed = $derived(quest?.status === 'completed');
	let verifying = $derived(quest?.status === 'verifying');
	let submissionLocked = $derived(posting || verifying || quest?.paid === true);

	$effect(() => {
		const submission = quest;
		if (!submission || submission.submittedAt === seededAt) return;
		endpointUrl = submission.endpointUrl;
		programId = submission.programId;
		seededAt = submission.submittedAt;
	});

	$effect(() => {
		progressLog.length;
		verifying;
		void tick().then(() => {
			if (logPanel) logPanel.scrollTop = logPanel.scrollHeight;
		});
	});

	function validationError(endpoint: string, program: string): string | null {
		let parsed: URL;
		try {
			parsed = new URL(endpoint);
		} catch {
			return 'Endpoint must be a valid http(s) URL.';
		}
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return 'Endpoint must be a valid http(s) URL.';
		}
		if (!PROGRAM_ID.test(program)) {
			return 'Program ID must be a 32–44 character base58 address.';
		}
		return null;
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!live || submissionLocked) return;
		const endpoint = endpointUrl.trim();
		const program = programId.trim();
		const invalid = validationError(endpoint, program);
		if (invalid) {
			formError = invalid;
			return;
		}

		const body: QuestSubmitRequest = {
			pairingCode: code,
			endpointUrl: endpoint,
			programId: program
		};
		formError = null;
		posting = true;
		live.clearLog();
		try {
			const { submission } = await submitQuest(body);
			if (live.view) live.view = { ...live.view, quest: submission };
		} catch (err) {
			formError = describeError(err);
		} finally {
			posting = false;
		}
	}

	function logLine(
		entry: (typeof progressLog)[number]
	): { icon: string; text: string; tone: string } {
		const label = QUEST_STEP_LABELS[entry.step];
		if (entry.status === 'running') return { icon: '▸', text: `${label} …`, tone: 'run' };
		const detail = entry.detail ? ` — ${entry.detail}` : '';
		return entry.status === 'ok'
			? { icon: '✔', text: `${label}${detail}`, tone: 'pass' }
			: { icon: '✘', text: `${label}${detail}`, tone: 'fail' };
	}
</script>

<svelte:head>
	<title>{view ? `${view.badge.name} — The Quest` : 'Badge session'} · HTN × Solana</title>
</svelte:head>

<div class="console">
	<header class="bar">
		<a class="mark" href="/">HTN <span class="x">×</span> SOLANA</a>
		{#if view}
			<div class="identity">
				<span>{view.badge.name}</span>
				<span class="label">{view.station.name}</span>
			</div>
		{/if}
		<StatusPill {status} />
	</header>

	{#if !view}
		<section class="center">
			{#if status === 'unreachable'}
				<p class="label">Offline</p>
				<h1 class="h2">Can't reach the server</h1>
				<p class="body">{live?.error}</p>
				<button class="btn btn-ghost" onclick={() => live?.retry()}>Retry</button>
			{:else if status === 'missing'}
				<p class="label">Pairing {code}</p>
				<h1 class="h2">No session for this code</h1>
				<p class="body">Return to a station and sync the badge to get a fresh pairing code.</p>
				<a class="btn btn-ghost" href="/">Back</a>
			{:else}
				<div class="spinner" aria-hidden="true"></div>
				<p class="label">Pairing {code}</p>
			{/if}
		</section>
	{:else}
		<main class="quest">
			{#if status !== 'live'}
				<section class="note signal" role="status">
					<strong>Station signal lost.</strong> Verification continues server-side. Keep this page
					open and it will reconnect automatically.
				</section>
			{/if}

			<section class="block brief">
				<div class="sectionhead">
					<div>
						<p class="label label-bright">$ cat quest.txt</p>
						<h1 class="h2">THE QUEST</h1>
					</div>
					{#if completed}
						<button class="collapse label" onclick={() => (briefOpen = !briefOpen)}>
							{briefOpen ? 'collapse' : 'expand'}
						</button>
					{/if}
				</div>

				{#if briefOpen || !completed}
					<ol class="steps">
						<li>
							<span class="number">[1]</span>
							<p>
								Grab the starter kit:
								<a href="https://github.com/spacemandev-git/solana-htn">git clone https://github.com/spacemandev-git/solana-htn</a>
								(dir <code>starter/</code>), full walkthrough in <code>docs/QUEST.md</code>
							</p>
						</li>
						<li>
							<span class="number">[2]</span>
							<p>
								Deploy the <code>htn_quest</code> program to {view.env.cluster} and store your
								message in its <code>["quest"]</code> PDA
							</p>
						</li>
						<li>
							<span class="number">[3]</span>
							<p>
								Run the starter x402 server: it sells <code>GET /quest</code> for ≤
								{atomicToUsd(view.env.maxRewardAtomic)} USDC paid to YOUR address
							</p>
						</li>
						<li>
							<span class="number">[4]</span>
							<p>
								Expose it (LAN IP or tunnel) and submit below — our agent calls it once, pays,
								and checks the chain
							</p>
						</li>
					</ol>

					<div class="facts">
						<div><span>cluster</span><strong>{view.env.cluster}</strong></div>
						<div><span>network</span><strong>{view.env.network}</strong></div>
						<div><span>USDC mint</span><strong>{view.env.usdcMint}</strong></div>
						<div>
							<span>reward cap</span><strong>{atomicToUsd(view.env.maxRewardAtomic)} USDC</strong>
						</div>
						<div>
							<span>agent address</span>
							{#if view.env.payerAddress}
								<a href={explorerAddressUrl(view.env.payerAddress, view.env.cluster)}>
									{view.env.payerAddress}
								</a>
							{:else}
								<strong>—</strong>
							{/if}
						</div>
					</div>
					{#if !view.env.chainEnabled}
						<span class="pill simulated"><span class="dot"></span>payments simulated</span>
					{/if}
				{/if}
			</section>

			{#if quest?.status !== 'completed'}
				<section class="block">
					<p class="label label-bright">$ submit --verify</p>
					<h2 class="sectiontitle">Submit your build</h2>
					{#if quest?.paid}
						<p class="note note-error">
							The agent already paid this badge and cannot pay twice. The submitted proof can no
							longer be retried.
						</p>
					{/if}
					<form class="form" onsubmit={submit}>
						<label class="prompt">
							<span>$ endpoint_url</span>
							<input
								class="input"
								type="url"
								bind:value={endpointUrl}
								placeholder="https://your-tunnel.example/quest"
								autocomplete="url"
								spellcheck="false"
								disabled={submissionLocked}
							/>
						</label>
						<label class="prompt">
							<span>$ program_id</span>
							<input
								class="input"
								bind:value={programId}
								placeholder="Base58 program address"
								autocapitalize="off"
								autocomplete="off"
								spellcheck="false"
								disabled={submissionLocked}
							/>
						</label>
						{#if formError}
							<p class="note note-error" role="alert">{formError}</p>
						{/if}
						<button class="btn btn-green btn-block" type="submit" disabled={submissionLocked}>
							{posting ? 'Submitting…' : verifying ? 'Verifying…' : 'Run verification'}
						</button>
					</form>
				</section>
			{/if}

			{#if quest}
				<section class="block">
					<p class="label label-bright">$ tail -f verification.log</p>
					<h2 class="sectiontitle">Verification log</h2>
					<div class="log" bind:this={logPanel} aria-live="polite">
						{#if progressLog.length === 0 && !verifying}
							<p class="muted">No live output retained. The latest result is shown below.</p>
						{/if}
						{#each progressLog as entry, index (`${entry.at}-${index}`)}
							{@const line = logLine(entry)}
							<p class={line.tone}><span>{line.icon}</span> {line.text}</p>
						{/each}
						{#if verifying}
							<p class="cursor"><span>▊</span></p>
						{/if}
					</div>
				</section>
			{/if}

			{#if quest?.status === 'completed'}
				<section class="block outcome success">
					<p class="label paid">Quest complete · payout sent</p>
					<p class="amount">
						{quest.amountPaidAtomic === null ? '—' : atomicToUsd(quest.amountPaidAtomic)}
						<span>USDC</span>
					</p>
					{#if quest.paymentSignature}
						<a class="signature" href={explorerTxUrl(quest.paymentSignature, view.env.cluster)}>
							view transaction ↗
						</a>
					{:else}
						<span class="signature">simulated payment</span>
					{/if}
					<blockquote>“{quest.message ?? 'Proof verified.'}”</blockquote>
				</section>
			{:else if quest?.status === 'failed'}
				<section class="block outcome failure">
					<p class="label">Verification failed</p>
					<h2>{quest.error ?? 'The proof did not pass verification.'}</h2>
					{#if quest.step}
						<p class="mono">failed at: {QUEST_STEP_LABELS[quest.step]}</p>
					{/if}
					{#if !quest.paid}
						<p class="body">Fix the issue, then resubmit the form above.</p>
					{/if}
				</section>
			{/if}
		</main>
	{/if}
</div>

<style>
	.console {
		min-height: 100dvh;
		background: var(--bg);
		padding-bottom: calc(34px + var(--safe-b));
	}

	.bar {
		position: sticky;
		top: 0;
		z-index: 20;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 12px;
		padding: calc(9px + var(--safe-t)) max(14px, var(--safe-r)) 9px
			max(14px, var(--safe-l));
		background: color-mix(in srgb, var(--bg) 90%, transparent);
		backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--rule);
	}

	.mark {
		font-family: var(--mono);
		font-size: 0.58rem;
		letter-spacing: 0.16em;
		color: var(--ink-mute);
		white-space: nowrap;
	}

	.x {
		color: var(--purple);
	}

	.identity {
		min-width: 0;
		display: flex;
		flex-direction: column;
		font-size: 0.75rem;
		line-height: 1.25;
		white-space: nowrap;
		overflow: hidden;
	}

	.identity > span {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.identity .label {
		font-size: 0.54rem;
	}

	.center {
		min-height: calc(100dvh - 58px);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: 10px;
		padding: 24px;
	}

	.center .body {
		max-width: 32ch;
	}

	.spinner {
		width: 26px;
		height: 26px;
		border: 1px solid var(--rule-strong);
		border-top-color: var(--purple);
		border-radius: 50%;
		animation: spin 900ms linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.quest {
		width: 100%;
		max-width: 760px;
		margin: 0 auto;
	}

	.signal {
		margin: 16px;
		font-family: var(--mono);
		font-size: 0.75rem;
	}

	.block {
		padding: 26px max(16px, var(--safe-l)) 26px max(16px, var(--safe-r));
		border-bottom: 1px solid var(--rule);
	}

	.sectionhead {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 14px;
	}

	.sectionhead .h2 {
		margin-top: 7px;
	}

	.collapse {
		appearance: none;
		border: 0;
		background: transparent;
		color: var(--purple);
		cursor: pointer;
		padding: 4px 0;
	}

	.steps {
		list-style: none;
		padding: 0;
		margin: 24px 0;
		display: grid;
		gap: 18px;
	}

	.steps li {
		display: grid;
		grid-template-columns: 34px minmax(0, 1fr);
		gap: 8px;
		font-family: var(--mono);
		font-size: 0.76rem;
		line-height: 1.55;
	}

	.steps p {
		margin: 0;
		color: var(--ink-mute);
		min-width: 0;
	}

	.steps a,
	.steps code {
		color: var(--green);
		word-break: break-word;
	}

	.number {
		color: var(--purple);
	}

	.facts {
		border: 1px solid var(--rule);
		background: var(--bg-sunken);
		padding: 12px;
		display: grid;
		gap: 8px;
		font-family: var(--mono);
		font-size: 0.67rem;
	}

	.facts div {
		display: grid;
		grid-template-columns: 90px minmax(0, 1fr);
		gap: 10px;
	}

	.facts span {
		color: var(--ink-faint);
	}

	.facts strong,
	.facts a {
		font-weight: 500;
		color: var(--ink-mute);
		word-break: break-all;
	}

	.facts a:hover {
		color: var(--green);
	}

	.simulated {
		margin-top: 10px;
		color: var(--amber);
		border-color: color-mix(in srgb, var(--amber) 45%, transparent);
	}

	.sectiontitle {
		margin: 7px 0 18px;
		font-size: 1.2rem;
		letter-spacing: -0.03em;
	}

	.form {
		display: grid;
		gap: 14px;
	}

	.prompt {
		display: grid;
		gap: 6px;
		font-family: var(--mono);
		font-size: 0.68rem;
		color: var(--green);
	}

	.prompt .input {
		font-size: 0.75rem;
	}

	.log {
		min-height: 116px;
		max-height: 300px;
		overflow-y: auto;
		border: 1px solid var(--rule);
		background: var(--bg-deep);
		padding: 13px;
		font-family: var(--mono);
		font-size: 0.7rem;
		line-height: 1.55;
		scroll-behavior: smooth;
	}

	.log p {
		margin: 0 0 5px;
	}

	.log p span {
		display: inline-block;
		width: 17px;
	}

	.log .run {
		color: var(--ink-mute);
	}

	.log .pass {
		color: var(--green);
	}

	.log .fail {
		color: var(--red);
	}

	.log .muted {
		color: var(--ink-faint);
	}

	.cursor {
		color: var(--purple);
		animation: blink 850ms steps(1, end) infinite;
	}

	@keyframes blink {
		50% {
			opacity: 0;
		}
	}

	.outcome {
		background: linear-gradient(180deg, var(--green-wash), transparent);
	}

	.outcome .paid {
		color: var(--green);
	}

	.amount {
		font-family: var(--mono);
		font-size: clamp(2.4rem, 14vw, 4.8rem);
		font-weight: 700;
		letter-spacing: -0.07em;
		line-height: 1;
		margin: 14px 0 8px;
		color: var(--green);
	}

	.amount span {
		font-size: 0.72rem;
		letter-spacing: 0.1em;
	}

	.signature {
		font-family: var(--mono);
		font-size: 0.68rem;
		color: var(--purple);
	}

	blockquote {
		margin: 32px 0 8px;
		font-size: clamp(1.8rem, 9vw, 3.8rem);
		font-weight: 700;
		letter-spacing: -0.045em;
		line-height: 1.05;
		word-break: break-word;
	}

	.failure {
		background: linear-gradient(180deg, rgba(255, 92, 92, 0.08), transparent);
		border-left: 2px solid var(--red);
	}

	.failure .label,
	.failure .mono {
		color: var(--red);
	}

	.failure h2 {
		font-size: 1.15rem;
		margin: 8px 0 12px;
	}

	@media (min-width: 600px) {
		.console {
			border-left: 1px solid var(--rule);
			border-right: 1px solid var(--rule);
			max-width: 800px;
			margin: 0 auto;
		}
	}
</style>
