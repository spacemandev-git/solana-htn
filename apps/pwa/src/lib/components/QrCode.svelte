<script lang="ts">
	import encodeQR from '@paulmillr/qr';

	interface Props {
		value: string;
		size?: number;
		label?: string;
	}

	let { value, size = 168, label }: Props = $props();

	let svg = $derived.by(() => {
		try {
			return encodeQR(value, 'svg', { border: 2, ecc: 'medium' });
		} catch {
			return null;
		}
	});
</script>

<figure class="qr" style:width="{size}px">
	{#if svg}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- locally generated QR markup -->
		<div class="plate">{@html svg}</div>
	{:else}
		<div class="plate fail">QR unavailable</div>
	{/if}
	{#if label}<figcaption class="label">{label}</figcaption>{/if}
</figure>

<style>
	.qr {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		align-items: center;
	}

	.plate {
		width: 100%;
		aspect-ratio: 1;
		background: #f2efe6;
		border-radius: var(--radius-sm);
		padding: 0;
		display: grid;
		place-items: center;
		overflow: hidden;
	}

	.plate :global(svg) {
		width: 100%;
		height: 100%;
		display: block;
		shape-rendering: crispEdges;
	}

	.fail {
		background: var(--bg-sunken);
		border: 1px solid var(--rule);
		color: var(--ink-faint);
		font-family: var(--mono);
		font-size: 0.75rem;
	}

	figcaption {
		text-align: center;
		word-break: break-all;
	}
</style>
