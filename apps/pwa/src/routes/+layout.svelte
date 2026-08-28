<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
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
				HACK<span class="thin">THE</span>NORTH <span class="x">×</span> SOLANA
			</a>
			<nav>
				<a class="navlink" class:on={path === '/sim'} href="/sim">Simulator</a>
			</nav>
		</div>
	</header>
{/if}

{@render children()}

{#if !bare}
	<footer class="footer">
		<div class="shell foot">
			<span class="label">Hack the North × Solana — quest activation</span>
			<span class="label">ESP32-C3 · ESP-NOW · x402 · Solana</span>
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
		border-bottom: 1px solid var(--rule);
		padding-top: var(--safe-t);
	}

	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		height: 52px;
	}

	.wordmark {
		font-family: var(--mono);
		font-size: 0.63rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--ink);
		white-space: nowrap;
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
		justify-content: space-between;
		padding-top: 20px;
	}
</style>
