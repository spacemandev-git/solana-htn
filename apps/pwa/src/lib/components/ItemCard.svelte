<script lang="ts">
	import type { Item } from '@htn/shared';
	import type { Snippet } from 'svelte';
	import { rarityColor } from '$lib/format.ts';

	interface Props {
		item: Item;
		fresh?: boolean;
		/** Currently equipped in its slot — one item per slot is worn. */
		worn?: boolean;
		action?: Snippet<[Item]>;
	}

	let { item, fresh = false, worn = false, action }: Props = $props();
	let tint = $derived(rarityColor(item.rarity));
</script>

<article class="item" class:fresh style:--tint={tint}>
	<header>
		<span class="slot label">{item.slot}</span>
		{#if fresh}
			<span class="new">New</span>
		{:else if worn}
			<span class="worn label">Worn</span>
		{/if}
	</header>
	<h3 class="name">{item.name}</h3>
	<footer>
		<span class="rarity">{item.rarity}</span>
		{#if item.withdrawn}
			<span class="state out">In wallet</span>
		{:else if item.assetAddress}
			<span class="state chain">On chain</span>
		{:else}
			<span class="state">Escrow</span>
		{/if}
	</footer>
	{#if action}
		<div class="action">{@render action(item)}</div>
	{/if}
</article>

<style>
	.item {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		border: 1px solid var(--rule);
		border-radius: 3px;
		background: linear-gradient(160deg, color-mix(in srgb, var(--tint) 7%, transparent), transparent 62%);
		overflow: hidden;
	}

	.item::before {
		content: '';
		position: absolute;
		inset: 0 auto 0 0;
		width: 2px;
		background: var(--tint);
		opacity: 0.75;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.slot {
		color: var(--ink-faint);
	}

	.name {
		font-size: 1rem;
		font-weight: 620;
		letter-spacing: -0.025em;
		line-height: 1.15;
		margin: 0;
		color: var(--ink);
	}

	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-family: var(--mono);
		font-size: 0.6rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.rarity {
		color: var(--tint);
		font-weight: 600;
	}

	.state {
		color: var(--ink-faint);
	}

	.state.out {
		color: var(--green);
	}

	.state.chain {
		color: var(--purple);
	}

	.worn {
		color: var(--purple);
		font-size: 0.55rem;
	}

	.new {
		font-family: var(--mono);
		font-size: 0.55rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: #000;
		background: var(--green);
		padding: 2px 6px;
		border-radius: 999px;
		font-weight: 700;
	}

	.action {
		margin-top: 2px;
	}

	.fresh {
		animation: unlock 700ms cubic-bezier(0.2, 0.9, 0.25, 1) both;
		border-color: color-mix(in srgb, var(--tint) 55%, var(--rule));
	}

	@keyframes unlock {
		0% {
			opacity: 0;
			transform: translateY(10px) scale(0.94);
			box-shadow: 0 0 0 0 var(--tint);
		}
		55% {
			opacity: 1;
			transform: translateY(0) scale(1.02);
			box-shadow: 0 0 24px -6px var(--tint);
		}
		100% {
			opacity: 1;
			transform: none;
			box-shadow: 0 0 0 0 transparent;
		}
	}
</style>
