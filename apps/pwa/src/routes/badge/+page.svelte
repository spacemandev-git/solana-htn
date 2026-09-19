<script lang="ts">
	import BadgeAppStore from '$lib/components/BadgeAppStore.svelte';
	import BadgeConsole from '$lib/components/BadgeConsole.svelte';
	import BadgeFlasher from '$lib/components/BadgeFlasher.svelte';
</script>

<svelte:head>
	<title>HTN OS — web flasher and badge apps</title>
	<meta
		name="description"
		content="Flash HTN OS, control your Hack the North badge, and discover badge apps."
	/>
</svelte:head>

<main class="shell badge-page">
	<header class="hero">
		<p class="label label-bright">$ htn badge --flash</p>
		<h1 class="h1">HTN OS</h1>
		<p class="body">
			Flash once, join Wi-Fi on the badge, get an HTN-ID, and drive every peripheral over HTTP.
		</p>
		<div class="hero-actions">
			<a class="btn btn-ghost" href="/badge/docs">Read the docs</a>
			<a
				class="btn-link"
				href="https://badge.hackthenorth.com/custom-flash"
				target="_blank"
				rel="noopener"
				aria-label="Hardware guide (opens in a new tab)">Hardware guide ↗</a
			>
		</div>
	</header>

	<BadgeFlasher />
	<BadgeConsole />
	<BadgeAppStore />
</main>

<style>
	.badge-page {
		display: grid;
		gap: var(--sp-4);
		padding-top: var(--sp-6);
		padding-bottom: var(--sp-8);
	}

	.hero {
		padding: var(--sp-5) 0;
	}

	.hero .h1 {
		margin-top: var(--sp-2);
	}

	.hero .body {
		max-width: 62ch;
		margin-top: var(--sp-3);
	}

	.hero-actions {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		flex-wrap: wrap;
		margin-top: var(--sp-5);
	}
</style>
