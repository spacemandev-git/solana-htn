<script lang="ts">
	let { data }: { data: { html: string; title: string } } = $props();
</script>

<svelte:head>
	<title>HTN OS — badge API docs</title>
	<meta name="description" content="HTN OS badge API and protocol documentation." />
</svelte:head>

<main class="shell docs-page">
	<a class="btn-link back" href="/badge">← Back to HTN OS</a>
	<article class="doc">{@html data.html}</article>
</main>

<style>
	.docs-page {
		padding-top: var(--sp-5);
		padding-bottom: var(--sp-8);
	}

	.back {
		margin-bottom: var(--sp-4);
	}

	.doc {
		min-width: 0;
	}

	.doc :global(h1),
	.doc :global(h2),
	.doc :global(h3) {
		font-weight: 600;
		letter-spacing: -0.01em;
		line-height: 1.25;
		text-wrap: balance;
		color: var(--ink);
	}

	.doc :global(h1) {
		margin: var(--sp-6) 0 var(--sp-4);
		font-size: clamp(1.5rem, 5vw, 2rem);
		letter-spacing: -0.02em;
		line-height: 1.2;
	}

	.doc :global(h2) {
		margin: var(--sp-6) 0 var(--sp-3);
		padding-top: var(--sp-3);
		border-top: 1px solid var(--rule-soft);
		font-size: clamp(1.25rem, 4vw, 1.5rem);
	}

	.doc :global(h3) {
		margin: var(--sp-5) 0 var(--sp-2);
		font-size: 1.0625rem;
	}

	.doc :global(p),
	.doc :global(li) {
		color: var(--ink-mute);
		font-size: 0.9375rem;
		line-height: 1.65;
	}

	.doc :global(p) {
		margin: var(--sp-3) 0;
	}

	.doc :global(ul),
	.doc :global(ol) {
		padding-left: var(--sp-5);
	}

	.doc :global(a) {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.doc :global(table) {
		display: block;
		width: 100%;
		overflow-x: auto;
		border-collapse: collapse;
		margin: var(--sp-4) 0;
		font-size: 0.875rem;
	}

	.doc :global(th),
	.doc :global(td) {
		padding: var(--sp-2) var(--sp-3);
		border-bottom: 1px solid var(--rule-soft);
		text-align: left;
		vertical-align: top;
	}

	.doc :global(th) {
		font-family: var(--mono);
		font-size: 0.75rem;
		color: var(--ink);
	}

	.doc :global(td) {
		color: var(--ink-mute);
	}

	.doc :global(pre) {
		overflow-x: auto;
		margin: var(--sp-4) 0;
		padding: var(--sp-4);
		border: 1px solid var(--rule-soft);
		border-radius: var(--radius-sm);
		background: var(--bg-raise);
		font-family: var(--mono);
		font-size: 0.75rem;
		line-height: 1.55;
		color: var(--ink-mute);
	}

	.doc :global(code) {
		border-radius: var(--radius-sm);
		background: var(--bg-raise);
		font-family: var(--mono);
	}

	.doc :global(pre code) {
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		word-break: normal;
	}

	.doc :global(blockquote) {
		margin: var(--sp-4) 0;
		padding: var(--sp-1) 0 var(--sp-1) var(--sp-4);
		border-left: 2px solid var(--rule);
	}

	.doc :global(blockquote p) {
		margin: 0;
	}
</style>
