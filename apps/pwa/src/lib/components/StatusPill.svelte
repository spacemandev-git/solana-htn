<script lang="ts">
	import type { LiveStatus } from '$lib/live.svelte.ts';

	interface Props {
		status: LiveStatus;
	}

	let { status }: Props = $props();

	const COPY: Record<LiveStatus, { text: string; tone: string }> = {
		loading: { text: 'Connecting', tone: 'tone-idle' },
		live: { text: 'Live', tone: 'tone-live' },
		reconnecting: { text: 'Reconnecting', tone: 'tone-warn' },
		wilderness: { text: 'Disconnected', tone: 'tone-off' },
		unreachable: { text: 'Offline', tone: 'tone-warn' },
		missing: { text: 'No session', tone: 'tone-off' }
	};

	let copy = $derived(COPY[status]);
</script>

<span class="pill status {copy.tone}" aria-live="polite">
	<span class="dot" class:pulse={status === 'live'}></span>
	{copy.text}
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

	.tone-warn {
		color: var(--amber);
		background: rgba(255, 182, 72, 0.08);
	}

	.tone-off {
		color: var(--ink-faint);
	}

	.tone-idle {
		color: var(--ink-mute);
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
