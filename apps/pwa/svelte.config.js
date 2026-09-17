import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// Absolute asset URLs so the built HTML points every hashed script and
		// static file at the apex, even when served from www. Mutually exclusive
		// with a service worker: adding back src/service-worker.ts fails the
		// build ("Cannot use service worker alongside config.kit.paths.assets").
		paths: { assets: 'https://solana-htn.com' },
		version: { pollInterval: 0 }
	},
	compilerOptions: { runes: true }
};

export default config;
