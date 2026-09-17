<script lang="ts">
	import type { LiveStatus } from '$lib/live.svelte.ts';

	interface Props {
		status: LiveStatus;
	}

	let { status }: Props = $props();

	let online = $derived(status === 'live');
	let label = $derived(
		status === 'loading'
			? 'Loading'
			: status === 'reconnecting'
				? 'Reconnecting'
				: status === 'unreachable'
					? 'Unreachable'
					: status === 'missing'
						? 'Missing'
						: 'Live'
	);
</script>

<span class="pill" class:pill-ok={online} role="status" aria-live="polite">
	<span class="dot" class:pulse={online}></span>
	{label}
</span>

<style>
	.pulse {
		animation: beat 1.6s ease-in-out infinite;
	}

	@keyframes beat {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.55;
		}
	}
</style>
