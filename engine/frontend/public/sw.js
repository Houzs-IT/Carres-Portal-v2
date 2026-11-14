/**
 * Carres: this service worker only retires itself.
 *
 * Carres staff open these pages inside the Carres portal (the installed app), so the engine needs no offline
 * shell. Houzs's worker served a cached index.html whenever the network took over 4 s; after Carres's many
 * same-day deploys that stale shell carried an old Content-Security-Policy and asked for asset hashes the
 * deploy had removed, which the worker answered with 504s. Browsers re-check /sw.js on every navigation, so
 * an existing install picks this file up, wipes every cache, unregisters, and reloads its open pages once onto
 * the network. src/pwa.ts no longer registers a worker.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: "window" });
      for (const client of windows) client.navigate(client.url).catch(() => {});
    })(),
  );
});
// No fetch handler: every request goes straight to the network.
