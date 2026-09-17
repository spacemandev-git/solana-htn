<script lang="ts">
	let { size = 20 }: { size?: number } = $props();
</script>

<img src="/brand/solanaLogoMark.svg" alt="Solana" width={size} height={Math.round(size * 88 / 101)} />
