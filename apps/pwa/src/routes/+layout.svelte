<script lang="ts">
	import '../app.css';
	import { dev } from '$app/environment';
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
				<span>HACK <span class="thin">THE</span> NORTH <span class="x">×</span> SOLANA</span>
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
			<img src="/brand/solanaLogo.svg" alt="Solana" height="18" />
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
		z-index: 40;
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		backdrop-filter: blur(12px);
		padding-top: var(--safe-t);
	}

	.topbar::after {
		content: '';
		position: absolute;
		inset: auto 0 0;
		height: 1px;
		background: var(--solana-gradient);
	}

	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		height: 52px;
	}

	.wordmark {
		display: inline-flex;
		align-items: center;
		gap: 16px;
		font-family: var(--mono);
		font-size: 0.63rem;
		letter-spacing: 0.18em;
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
		color: var(--purple);
	}

	nav {
		display: flex;
		gap: 4px;
		justify-content: flex-end;
	}

	.navlink {
		font-family: var(--mono);
		font-size: 0.62rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--ink-faint);
		padding: 6px 8px;
		border-radius: 2px;
	}

	.navlink:hover {
		color: var(--ink);
	}

	.navlink.on {
		color: var(--ink);
		box-shadow: inset 0 -1px 0 var(--purple);
	}

	.footer {
		border-top: 1px solid var(--rule);
		margin-top: 64px;
		padding-bottom: max(20px, var(--safe-b));
	}

	.foot {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 20px;
		align-items: center;
		justify-content: space-between;
		padding-top: 20px;
	}

	.foot > img {
		display: block;
		width: auto;
	}

	.footlinks {
		display: flex;
		gap: 20px;
		font-family: var(--mono);
		font-size: 0.62rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--ink-mute);
	}

	.footlinks a:hover {
		color: var(--green);
	}

	@media (max-width: 520px) {
		.bar {
			gap: 8px;
		}

		.wordmark {
			font-size: 0.5rem;
			letter-spacing: 0.08em;
		}

		.navlink {
			font-size: 0.52rem;
			letter-spacing: 0.08em;
			padding-inline: 4px;
		}
	}
</style>
