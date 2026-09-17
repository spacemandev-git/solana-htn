<script lang="ts">
	import { assets } from '$app/paths';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import {
		ALL_ITEMS,
		BOXES,
		QUEST_STEP_LABELS,
		boxName,
		explorerAddressUrl,
		explorerTxUrl,
		formatAtomic,
		isQuestReward,
		isSolanaItem,
		itemImagePath,
		itemLabel,
		type QuestSubmitRequest
	} from '@htn/shared';
	import { describeError, submitQuest } from '$lib/api.ts';
	import StatusPill from '$lib/components/StatusPill.svelte';
	import { LiveBadge } from '$lib/live.svelte.ts';

	const PROGRAM_ID = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

	let code = $derived(page.params.pairingCode ?? '');
	let live = $state<LiveBadge | null>(null);
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
		const badge = new LiveBadge(pairingCode);
		live = badge;
		void badge.start();
		return () => {
			badge.stop();
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

	function awardFor(item: string) {
		return view?.awards.find((award) => award.item === item) ?? null;
	}

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
	<title>{view ? `${view.badge.name || view.badge.badgeId} — Badge Console` : 'Badge console'} · HTN × Solana</title>
</svelte:head>

<div class="console">
	<header class="bar">
		<a class="mark" href="/">HTN <span class="x">×</span> SOLANA</a>
		{#if view}
			<div class="identity">
				<span class="truncate">{view.badge.name || view.badge.badgeId}</span>
				<span class="label truncate">{view.badge.pairingCode}</span>
			</div>
		{/if}
		<StatusPill {status} />
	</header>

	{#if !view}
		{#if status === 'unreachable'}
			<section class="center">
				<p class="label">Offline</p>
				<h1 class="h1">Can't reach the server</h1>
				<p class="body">{live?.error}</p>
				<button class="btn btn-ghost" onclick={() => live?.retry()}>Retry</button>
			</section>
		{:else if status === 'missing'}
			<section class="center">
				<p class="label">Pairing {code}</p>
				<h1 class="h1">No badge for this code</h1>
				<p class="body">Tap a box with your badge first, then open the QR it shows.</p>
				<a class="btn btn-ghost" href="/">Back</a>
			</section>
		{:else}
			<section class="center" aria-busy="true" aria-label="Loading badge">
				<div class="skeleton skeleton-label" aria-hidden="true"></div>
				<div class="skeleton skeleton-heading" aria-hidden="true"></div>
				<div class="skeleton-grid" aria-hidden="true">
					{#each Array(9) as _}
						<div class="skeleton skeleton-item"></div>
					{/each}
				</div>
				<p class="label">Pairing {code}</p>
			</section>
		{/if}
	{:else}
		<main class="quest">
			<section class="block inventory">
				<div class="sectionhead">
					<div>
						<p class="label label-bright">$ ls inventory/</p>
						<h1 class="h1">Inventory</h1>
					</div>
					<span class="pill pill-ok tnum">{view.awards.length}/9 collected</span>
				</div>
				<div class="itemgrid">
					{#each ALL_ITEMS as item (item)}
						{@const award = awardFor(item)}
						{@const awardingBox = BOXES.find((box) => box.item === item)}
						{@const solanaItem = isSolanaItem(item)}
						{@const reward = isQuestReward(item)}
						<article class="item" class:owned={award !== null} class:reward>
							<div class="itemtop">
								<strong class="tnum">{item}</strong>
								{#if reward}<span class="rewardtag">quest reward</span>{/if}
							</div>
							<img
								class="art"
								src="{assets}{itemImagePath(item)}"
								alt={award ? itemLabel(item) : `Locked: ${itemLabel(item)}`}
								width="512"
								height="512"
								loading="lazy"
								decoding="async"
							/>
							<span class="name">{award ? itemLabel(item) : '???'}</span>
							<span class="label state">{award ? 'owned' : 'locked'}</span>
							{#if award}
								<span class="box">{boxName(award.box)}</span>
							{:else if reward}
								<span class="hint">
									{quest?.status === 'completed' ? 'tap' : 'finish the quest, then tap'}
									{boxName(view.env.solanaFinalBoxId)}
								</span>
							{:else if solanaItem}
								<span class="hint">tap {boxName(view.env.solanaBoxId)}</span>
							{:else if awardingBox}
								<span class="hint">tap {awardingBox.name}</span>
							{/if}
						</article>
					{/each}
				</div>
			</section>

			<section class="block brief">
				<div class="sectionhead">
					<div>
						<p class="label label-bright">$ cat quest.txt</p>
						<h1 class="h1">THE QUEST</h1>
					</div>
					{#if completed}
						<button class="btn-link" onclick={() => (briefOpen = !briefOpen)}>
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
								{formatAtomic(view.env.maxRewardAtomic, view.env.paymentSymbol)} paid to YOUR address
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
						<div><span>pay token</span><strong>{view.env.paymentSymbol}</strong></div>
						<div>
							<span>mint</span>
							<a href={explorerAddressUrl(view.env.paymentMint, view.env.cluster)}>
								{view.env.paymentMint}
							</a>
						</div>
						<div>
							<span>reward cap</span><strong>{formatAtomic(view.env.maxRewardAtomic, view.env.paymentSymbol)}</strong>
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
						<div>
							<span>ecosystem</span>
							<a href="https://solana.com/ai" target="_blank" rel="noopener">AI on Solana ↗</a>
						</div>
					</div>
					{#if !view.env.chainEnabled}
						<span class="pill pill-warn simulated"><span class="dot"></span>payments simulated</span>
					{/if}
				{/if}
			</section>

			{#if quest?.status !== 'completed'}
				<section class="block">
					<p class="label label-bright">$ submit --verify</p>
					<h2 class="h2 sectiontitle">Submit your build</h2>
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
						<button class="btn btn-block" type="submit" disabled={submissionLocked}>
							{posting ? 'Submitting…' : verifying ? 'Verifying…' : 'Run verification'}
						</button>
					</form>
				</section>
			{/if}

			{#if quest}
				<section class="block">
					<p class="label label-bright">$ tail -f verification.log</p>
					<h2 class="h2 sectiontitle">Verification log</h2>
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
					<p class="unlock">
						Quest complete. Tap {boxName(view.env.solanaFinalBoxId)} to collect item 9.
					</p>
					<p class="amount tnum">
						{quest.amountPaidAtomic === null ? '—' : formatAtomic(quest.amountPaidAtomic, view.env.paymentSymbol)}
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
					<h2 class="h3">{quest.error ?? 'The proof did not pass verification.'}</h2>
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
		padding-bottom: calc(var(--sp-6) + var(--safe-b));
	}

	.bar {
		position: sticky;
		top: 0;
		z-index: var(--z-bar);
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--sp-3);
		min-height: var(--bar-h);
		padding: calc(var(--sp-2) + var(--safe-t)) max(var(--sp-4), var(--safe-r)) var(--sp-2)
			max(var(--sp-4), var(--safe-l));
		background: var(--bg);
		border-bottom: 1px solid var(--rule);
	}

	.mark {
		display: inline-flex;
		align-items: center;
		gap: 0.35em;
		min-height: var(--tap);
		font-family: var(--mono);
		font-size: 0.75rem;
		color: var(--ink-mute);
		white-space: nowrap;
	}

	.x {
		color: var(--accent);
	}

	/* The status pill always sits in the third column, even before the identity renders. */
	.bar > :global(.pill) {
		grid-column: 3;
		justify-self: end;
	}

	.identity {
		min-width: 0;
		display: flex;
		flex-direction: column;
		font-size: 0.8125rem;
		line-height: 1.25;
	}

	.identity .label {
		font-size: 0.75rem;
	}

	.center {
		min-height: calc(100dvh - 58px);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: var(--sp-3);
		padding: var(--sp-5);
	}

	.center > * {
		max-width: 36ch;
	}

	.skeleton-label {
		width: 120px;
		height: 14px;
	}

	.skeleton-heading {
		width: 200px;
		height: 28px;
	}

	.skeleton-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--sp-2);
		width: 100%;
		max-width: 480px;
	}

	.skeleton-item {
		aspect-ratio: 1;
		border-radius: var(--radius-sm);
	}

	.quest {
		width: 100%;
		max-width: 760px;
		margin: 0 auto;
	}

	.block {
		padding: var(--sp-6) max(var(--sp-4), var(--safe-l)) var(--sp-6)
			max(var(--sp-4), var(--safe-r));
		border-bottom: 1px solid var(--rule);
	}

	.sectionhead {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--sp-4);
	}

	.sectionhead .h1 {
		margin-top: var(--sp-2);
	}

	.itemgrid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--sp-2);
		margin-top: var(--sp-5);
	}

	.item {
		position: relative;
		min-height: 128px;
		padding: var(--sp-3);
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
		opacity: 1;
	}

	.item.owned {
		border-color: var(--green);
		background: var(--bg-raise);
	}

	.item.reward:not(.owned) {
		border-color: color-mix(in srgb, var(--accent) 50%, var(--rule));
	}

	.art {
		display: block;
		width: 100%;
		height: auto;
		max-height: 132px;
		object-fit: contain;
		margin: var(--sp-1) auto 0;
		/* Locked items stay a mystery: a dark silhouette until the box is tapped. */
		filter: brightness(0) saturate(0);
		opacity: 0.5;
		transition:
			filter var(--dur) var(--ease-out),
			opacity var(--dur) var(--ease-out);
	}

	.item.owned .art {
		filter: none;
		opacity: 1;
	}

	.name {
		font-weight: 650;
		font-size: 0.875rem;
		line-height: 1.2;
		color: var(--ink-mute);
	}

	.item.owned .name {
		color: var(--ink);
	}

	.itemtop {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--sp-1);
	}

	.itemtop strong {
		font-family: var(--mono);
		font-size: clamp(1.5rem, 6vw, 2.25rem);
		line-height: 1;
	}

	.rewardtag {
		font-family: var(--mono);
		font-size: 0.75rem;
		line-height: 1.2;
		text-transform: uppercase;
		color: var(--accent);
		text-align: right;
	}

	.item .state {
		color: var(--ink-mute);
	}

	.item.owned .state {
		color: var(--green);
	}

	.box,
	.hint {
		margin-top: auto;
		font-family: var(--mono);
		font-size: 0.75rem;
		line-height: 1.35;
		color: var(--ink-faint);
		word-break: break-word;
	}

	.box {
		color: var(--ink-mute);
	}

	.steps {
		list-style: none;
		padding: 0;
		margin: var(--sp-5) 0;
		display: grid;
		gap: var(--sp-4);
	}

	.steps li {
		display: grid;
		grid-template-columns: 36px minmax(0, 1fr);
		gap: var(--sp-2);
		font-family: var(--mono);
		font-size: 0.8125rem;
		line-height: 1.55;
	}

	.steps p {
		margin: 0;
		color: var(--ink-mute);
		min-width: 0;
	}

	.steps a {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 3px;
		word-break: break-word;
	}

	.steps code {
		word-break: break-word;
	}

	.number {
		color: var(--accent);
	}

	.facts {
		border: 1px solid var(--rule);
		background: var(--bg-sunken);
		padding: var(--sp-3);
		border-radius: var(--radius-sm);
		display: grid;
		gap: var(--sp-2);
		font-family: var(--mono);
		font-size: 0.75rem;
	}

	.facts div {
		display: grid;
		grid-template-columns: 104px minmax(0, 1fr);
		gap: var(--sp-3);
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

	.facts a {
		color: var(--accent);
	}

	.simulated {
		margin-top: var(--sp-3);
	}

	.sectiontitle {
		margin: var(--sp-2) 0 var(--sp-4);
	}

	.form {
		display: grid;
		gap: var(--sp-4);
	}

	.prompt {
		display: grid;
		gap: var(--sp-2);
		font-family: var(--mono);
		font-size: 0.8125rem;
		color: var(--ink-mute);
	}

	.log {
		min-height: 120px;
		max-height: 300px;
		overflow-y: auto;
		border: 1px solid var(--rule);
		background: var(--bg-deep);
		padding: var(--sp-3);
		border-radius: var(--radius-sm);
		font-family: var(--mono);
		font-size: 0.8125rem;
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
		color: var(--accent);
		animation: blink 850ms steps(1, end) infinite;
	}

	@keyframes blink {
		50% {
			opacity: 0;
		}
	}

	.outcome {
		background: var(--green-wash);
		border-left: 2px solid var(--green);
	}

	.outcome .paid {
		color: var(--green);
	}

	.unlock {
		margin: var(--sp-3) 0 0;
		font-family: var(--mono);
		font-size: 0.875rem;
		color: var(--ink);
	}

	.amount {
		font-family: var(--mono);
		font-size: clamp(2rem, 9vw, 3rem);
		font-weight: 700;
		line-height: 1;
		margin: var(--sp-4) 0 var(--sp-2);
		color: var(--green);
	}

	.signature {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		font-family: var(--mono);
		font-size: 0.8125rem;
		color: var(--accent);
	}

	blockquote {
		margin: var(--sp-6) 0 var(--sp-2);
		font-size: clamp(1.5rem, 5vw, 2rem);
		font-weight: 600;
		line-height: 1.05;
		word-break: break-word;
		text-wrap: balance;
	}

	.failure {
		background: var(--red-wash);
		border-left: 2px solid var(--red);
	}

	.failure .label,
	.failure .mono {
		color: var(--red);
	}

	.failure h2 {
		margin: var(--sp-2) 0 var(--sp-3);
	}

	@media (hover: hover) {
		.facts a:hover,
		.signature:hover {
			text-decoration: underline;
			text-underline-offset: 3px;
		}
	}

	@media (min-width: 600px) {
		.console {
			border-left: 1px solid var(--rule);
			border-right: 1px solid var(--rule);
			max-width: 800px;
			margin: 0 auto;
		}
	}

	@media (max-width: 430px) {
		.item {
			min-height: 142px;
			padding: var(--sp-2);
		}
	}
</style>
