<script lang="ts">
	import '../app.css';
	import { dev } from '$app/environment';
	import { assets } from '$app/paths';
	import { page } from '$app/state';
	import SolanaMark from '$lib/components/SolanaMark.svelte';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	/** The phone view owns its whole viewport — no global chrome there. */
	let bare = $derived(page.url.pathname.startsWith('/s/'));
	let path = $derived(page.url.pathname);
</script>

{#if !bare}
	<header class="topbar">
		<div class="shell bar">
			<a class="wordmark" href="/">
				<SolanaMark size={18} />
				<span
					><span class="long">HACK <span class="thin">THE</span> NORTH <span class="x">×</span> </span
					>SOLANA</span
				>
			</a>
			<nav>
				<a class="navlink" href="https://solana.com/ai" target="_blank" rel="noopener">
					AI on Solana ↗
				</a>
				{#if dev}
					<a class="navlink" class:on={path === '/sim'} href="/sim">Simulator</a>
				{/if}
			</nav>
		</div>
	</header>
{/if}

{@render children()}

{#if !bare}
	<footer class="footer">
		<div class="shell foot">
			<img src="{assets}/brand/solanaLogo.svg" alt="Solana" height="18" />
			<div class="footlinks">
				<a href="https://solana.com/ai" target="_blank" rel="noopener">AI on Solana</a>
				<a href="https://solana.com/brand" target="_blank" rel="noopener">Brand</a>
			</div>
		</div>
	</footer>
{/if}

<style>
	.topbar {
		position: sticky;
		top: 0;
		z-index: var(--z-bar);
		background: var(--bg);
		border-bottom: 1px solid var(--rule);
		padding-top: var(--safe-t);
	}

	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-4);
		height: var(--bar-h);
	}

	.wordmark {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
		min-height: var(--tap);
		font-family: var(--mono);
		font-size: 0.8125rem;
		text-transform: uppercase;
		color: var(--ink);
		white-space: nowrap;
	}

	.wordmark :global(img) {
		display: block;
		flex: none;
	}

	.thin {
		color: var(--ink-faint);
	}

	.x {
		color: var(--accent);
	}

	.long {
		margin-right: 0.45em;
	}

	nav {
		display: flex;
		gap: var(--sp-1);
		justify-content: flex-end;
	}

	.navlink {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		font-family: var(--mono);
		font-size: 0.8125rem;
		text-transform: uppercase;
		color: var(--ink-faint);
		padding: 0 var(--sp-2);
		border-radius: var(--radius-sm);
	}

	.navlink.on {
		color: var(--ink);
		background: var(--bg-raise);
	}

	.footer {
		border-top: 1px solid var(--rule);
		margin-top: var(--sp-8);
		padding-bottom: max(var(--sp-5), var(--safe-b));
	}

	.foot {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2) var(--sp-5);
		align-items: center;
		justify-content: space-between;
		padding-top: var(--sp-5);
	}

	.foot > img {
		display: block;
		width: auto;
	}

	.footlinks {
		display: flex;
		gap: var(--sp-5);
		font-family: var(--mono);
		font-size: 0.8125rem;
		color: var(--ink-mute);
	}

	.footlinks a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
	}

	@media (hover: hover) {
		.navlink:hover,
		.footlinks a:hover {
			color: var(--ink);
		}
	}

	@media (max-width: 520px) {
		.bar {
			gap: var(--sp-2);
		}

		.wordmark {
			font-size: 0.75rem;
		}

		.long {
			display: none;
		}

		.navlink {
			font-size: 0.75rem;
			padding-inline: var(--sp-1);
		}
	}
</style>
