/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { build, files, prerendered, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const SHELL = `htn-shell-${version}`;
const RUNTIME = `htn-runtime-${version}`;

/** App shell: hashed build output, static assets, prerendered pages. */
const PRECACHE = [...build, ...files, ...prerendered];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(SHELL);
			await cache.addAll(PRECACHE);
			await sw.skipWaiting();
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== SHELL && key !== RUNTIME) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

/** Cache-first: hashed build output never changes under a given version. */
async function cacheFirst(request: Request): Promise<Response> {
	const cached = await caches.match(request);
	if (cached) return cached;
	const response = await fetch(request);
	if (response.ok) {
		const cache = await caches.open(SHELL);
		cache.put(request, response.clone());
	}
	return response;
}

/** Network-first: live data wins, the last good copy is the fallback. */
async function networkFirst(request: Request): Promise<Response> {
	const cache = await caches.open(RUNTIME);
	try {
		const response = await fetch(request);
		if (response.ok && request.method === 'GET') cache.put(request, response.clone());
		return response;
	} catch (err) {
		const cached = await cache.match(request);
		if (cached) return cached;
		throw err;
	}
}

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;
	// Server-sent events must never be intercepted or buffered.
	if (request.headers.get('accept') === 'text/event-stream') return;

	if (url.pathname.startsWith('/api/')) {
		event.respondWith(networkFirst(request));
		return;
	}

	if (PRECACHE.includes(url.pathname)) {
		event.respondWith(cacheFirst(request));
		return;
	}

	if (request.mode === 'navigate') {
		event.respondWith(networkFirst(request));
	}
});
