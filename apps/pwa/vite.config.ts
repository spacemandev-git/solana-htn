import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

/** The API server built alongside this app. Override with API_PROXY_TARGET. */
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 5173,
		strictPort: true,
		proxy: {
			'/api': {
				target: apiTarget,
				changeOrigin: true,
				// Server-sent events must not be buffered by the dev proxy.
				headers: { 'Accept-Encoding': 'identity' }
			}
		}
	},
	preview: { port: 4173 }
});
