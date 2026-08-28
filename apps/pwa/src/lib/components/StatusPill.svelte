<script lang="ts">
	import type { LiveStatus } from '$lib/live.svelte.ts';

	interface Props {
		status: LiveStatus;
	}

	let { status }: Props = $props();

	let online = $derived(status === 'live');
</script>

<span class="pill status" class:tone-live={online} class:tone-off={!online} aria-live="polite">
	<span class="dot" class:pulse={online}></span>
	{online ? 'Live' : 'Offline'}
</span>

<style>
	.status {
		border-color: currentColor;
		font-weight: 600;
	}

	.tone-live {
		color: var(--green);
		background: var(--green-wash);
	}

	.tone-off {
		color: var(--ink-faint);
	}

	.pulse {
		animation: beat 1.6s ease-in-out infinite;
	}

	@keyframes beat {
		0%,
		100% {
			opacity: 1;
			box-shadow: 0 0 0 0 var(--green-wash);
		}
		50% {
			opacity: 0.55;
			box-shadow: 0 0 0 5px transparent;
		}
	}
</style>
