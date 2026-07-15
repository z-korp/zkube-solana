/* global caches, self */

const STATIC_CACHE = "zkube-static-v1";
const CACHEABLE_DESTINATIONS = new Set(["font", "image", "script", "style"]);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key)),
        ),
      ),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Chain, Router, ER, RPC and Fly service responses are cross-origin. Any
  // local development API response also remains network-only.
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    !CACHEABLE_DESTINATIONS.has(request.destination)
  ) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        await cache.put(request, response.clone());
      }
      return response;
    }),
  );
});
