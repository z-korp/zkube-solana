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

// LOCAL notifications only. These notifications are raised by the running page
// via `registration.showNotification` (see client `useNotifications`); this
// service worker holds NO push subscription and has NO `push` handler, so there
// is no remote/background delivery. This handler only decides where a click on
// an already-shown local notification lands: focus an existing zKube window (or
// open one) and route it to the notification's `data.url`.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetPath =
    (event.notification.data && event.notification.data.url) || "/";
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            const focused = client.focus();
            if (client.url !== targetUrl && "navigate" in client) {
              return Promise.resolve(focused).then(() =>
                client.navigate(targetUrl),
              );
            }
            return focused;
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      }),
  );
});
