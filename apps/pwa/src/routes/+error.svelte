<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>{page.status} · HTN × Solana</title>
</svelte:head>

<main class="shell wrap">
	<p class="label">Error {page.status}</p>
	<h1 class="h1">{page.error?.message ?? 'Something went sideways.'}</h1>
	<p class="body">
		If you were following a pairing link, tap a box with your badge and open the QR it shows.
	</p>
	<a class="btn btn-ghost" href="/">Back to start</a>
</main>

<style>
	.wrap {
		min-height: 60dvh;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: var(--sp-3);
		padding-top: var(--sp-8);
	}
</style>
