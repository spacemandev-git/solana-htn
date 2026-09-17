<script lang="ts">
	import { assets } from '$app/paths';

	let { size = 20 }: { size?: number } = $props();
</script>

<img
	src="{assets}/brand/solanaLogoMark.svg"
	alt="Solana"
	width={size}
	height={Math.round((size * 88) / 101)}
/>
