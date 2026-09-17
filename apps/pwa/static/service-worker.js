// Tombstone for the offline shell worker that used to live at
// src/service-worker.ts. It was removed because kit.paths.assets and a service
// worker are mutually exclusive, but every badge that ever opened the console
// still has the old worker registered at this URL. Serving a self-destructing
// worker here makes the next update check drop the stale shell caches and
// unregister, instead of leaving clients pinned to a build whose asset paths
// no longer exist. Nothing registers this file; it only replaces what is
// already installed. Safe to delete once the event is over.
self.addEventListener('install', () => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) await caches.delete(key);
			await self.registration.unregister();
			for (const client of await self.clients.matchAll({ type: 'window' })) {
				client.navigate(client.url);
			}
		})()
	);
});
