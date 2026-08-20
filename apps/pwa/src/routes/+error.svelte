<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>{page.status} · HTN × Solana</title>
</svelte:head>

<main class="shell wrap">
	<p class="label">Error {page.status}</p>
	<h1 class="h2">{page.error?.message ?? 'Something went sideways.'}</h1>
	<p class="body">
		If you were following a pairing link, walk back to a Sync Station and scan again for a fresh
		code.
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
		gap: 12px;
		padding-top: 60px;
	}
</style>
