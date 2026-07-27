/* global caches */

const CACHE_PREFIX = "zkube-pwa-";
const LEGACY_CACHE_PREFIX = "zkube-static-";
const BUILD_VERSION = "__ZKUBE_BUILD_VERSION__";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_VERSION}`;
const OFFLINE_SHELL_PATH = "/.zkube/offline-shell";
export const MAX_CACHE_ENTRIES = 192;

const STATIC_DESTINATIONS = new Set(["font", "image", "script", "style"]);
const NETWORK_ONLY_PATH_PREFIXES = [
  "/api/",
  "/rpc/",
  "/wallet/",
  "/.well-known/",
];

export type RequestRoute = "asset" | "navigation" | "network";

export interface CacheRouteRequest {
  method: string;
  url: string;
  mode: string;
  destination: string;
  hasAuthorization?: boolean;
  hasRange?: boolean;
}

interface ExtendableEventLike extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}

interface MessageEventLike extends ExtendableEventLike {
  readonly data: unknown;
}

interface NotificationEventLike extends ExtendableEventLike {
  readonly notification: Notification & {
    data?: { url?: unknown };
  };
}

interface WindowClientLike {
  readonly url: string;
  focus(): Promise<WindowClientLike>;
  navigate?(url: string): Promise<WindowClientLike | null>;
}

interface ServiceWorkerScopeLike extends EventTarget {
  readonly location: Location;
  readonly clients: {
    matchAll(options: {
      type: "window";
      includeUncontrolled: boolean;
    }): Promise<WindowClientLike[]>;
    openWindow?(url: string): Promise<WindowClientLike | null>;
  };
  skipWaiting(): Promise<void>;
}

/**
 * The cache is an app-shell convenience, never a data cache. Only navigation
 * and browser-classified static subresources from the production origin enter
 * it. RPC/API/wallet requests have an empty or non-static destination and all
 * cross-origin, loopback, private-network, credentialed, ranged, and non-GET
 * traffic stays entirely outside service-worker handling.
 */
export function classifyCacheRoute(
  request: CacheRouteRequest,
  scopeOrigin: string,
): RequestRoute {
  if (request.method !== "GET") return "network";

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return "network";
  }
  if (
    url.origin !== scopeOrigin ||
    url.protocol !== "https:" ||
    isLocalNetworkHostname(url.hostname) ||
    request.hasAuthorization ||
    request.hasRange ||
    isNetworkOnlyPath(url.pathname)
  ) {
    return "network";
  }
  if (request.mode === "navigate" || request.destination === "document") {
    return "navigation";
  }
  return STATIC_DESTINATIONS.has(request.destination) ? "asset" : "network";
}

export function obsoleteZkubeCaches(
  cacheNames: readonly string[],
  currentCacheName = CACHE_NAME,
): string[] {
  return cacheNames.filter(
    (name) =>
      name !== currentCacheName &&
      (name.startsWith(CACHE_PREFIX) || name.startsWith(LEGACY_CACHE_PREFIX)),
  );
}

export async function pruneCacheEntries(
  cache: Pick<Cache, "delete" | "keys">,
  maximum = MAX_CACHE_ENTRIES,
  protectedUrls: ReadonlySet<string> = new Set(),
): Promise<void> {
  const keys = await cache.keys();
  const overflow = Math.max(0, keys.length - maximum);
  const removable = keys.filter((key) => !protectedUrls.has(key.url));
  await Promise.all(
    removable.slice(0, overflow).map((key) => cache.delete(key)),
  );
}

export function isLocalNetworkHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized === "0.0.0.0"
  ) {
    return true;
  }
  const octets = normalized.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [first, second] = octets as [number, number, number, number];
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isNetworkOnlyPath(pathname: string): boolean {
  const normalized = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return NETWORK_ONLY_PATH_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );
}

function requestMetadata(request: Request): CacheRouteRequest {
  return {
    method: request.method,
    url: request.url,
    mode: request.mode,
    destination: request.destination,
    hasAuthorization: request.headers.has("authorization"),
    hasRange: request.headers.has("range"),
  };
}

function offlineShellKey(scopeOrigin: string): string {
  return new URL(OFFLINE_SHELL_PATH, scopeOrigin).href;
}

async function handleNavigation(
  request: Request,
  scopeOrigin: string,
): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    const contentType = response.headers.get("content-type") ?? "";
    if (
      response.ok &&
      response.type === "basic" &&
      !response.redirected &&
      contentType.toLowerCase().includes("text/html")
    ) {
      const shellKey = offlineShellKey(scopeOrigin);
      await cache.put(shellKey, response.clone());
      await pruneCacheEntries(cache, MAX_CACHE_ENTRIES, new Set([shellKey]));
    }
    return response;
  } catch {
    const cached = await cache.match(offlineShellKey(scopeOrigin));
    return cached ?? offlineDocument();
  }
}

async function handleAsset(
  request: Request,
  scopeOrigin: string,
): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic" && !response.redirected) {
      // Reinsert successful responses so frequently used current-build assets
      // stay at the retained end of the bounded CacheStorage key order.
      await cache.delete(request);
      await cache.put(request, response.clone());
      await pruneCacheEntries(
        cache,
        MAX_CACHE_ENTRIES,
        new Set([offlineShellKey(scopeOrigin)]),
      );
    }
    return response;
  } catch (cause) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw cause;
  }
}

function offlineDocument(): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="theme-color" content="#080414">
    <title>zKube is offline</title>
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080414;color:#fff;font:16px system-ui,sans-serif}
      main{max-width:28rem;padding:2rem;text-align:center}
      a{display:inline-block;margin-top:1rem;padding:.75rem 1rem;border:1px solid #67e8f9;border-radius:.75rem;color:#cffafe;text-decoration:none}
    </style>
  </head>
  <body>
    <main>
      <h1>zKube is offline</h1>
      <p>Reconnect to the internet, then try again. Chain, wallet, and score data are never loaded from an offline cache.</p>
      <a href="/">Try again</a>
    </main>
  </body>
</html>`,
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}

function installServiceWorkerHandlers(scope: ServiceWorkerScopeLike): void {
  scope.addEventListener("activate", (rawEvent) => {
    const event = rawEvent as ExtendableEventLike;
    event.waitUntil(
      caches
        .keys()
        .then((names) =>
          Promise.all(
            obsoleteZkubeCaches(names).map((name) => caches.delete(name)),
          ),
        ),
    );
  });

  scope.addEventListener("message", (rawEvent) => {
    const event = rawEvent as MessageEventLike;
    if (
      !event.data ||
      typeof event.data !== "object" ||
      (event.data as { type?: unknown }).type !== "SKIP_WAITING"
    ) {
      return;
    }
    // Activation is deliberate: the page sends this only after the player
    // presses Refresh and never while the play surface is active.
    event.waitUntil(scope.skipWaiting());
  });

  scope.addEventListener("fetch", (rawEvent) => {
    const event = rawEvent as FetchEventLike;
    const route = classifyCacheRoute(
      requestMetadata(event.request),
      scope.location.origin,
    );
    if (route === "navigation") {
      event.respondWith(handleNavigation(event.request, scope.location.origin));
    } else if (route === "asset") {
      event.respondWith(handleAsset(event.request, scope.location.origin));
    }
    // Network-only requests are not intercepted at all. In particular, there
    // is no CacheStorage fallback for chain, account, transaction, or wallet
    // association traffic.
  });

  // LOCAL notifications only. There is intentionally no push or background
  // sync handler. A click focuses an existing window or opens the local route.
  scope.addEventListener("notificationclick", (rawEvent) => {
    const event = rawEvent as NotificationEventLike;
    event.notification.close();
    const candidate = event.notification.data?.url;
    const targetPath = typeof candidate === "string" ? candidate : "/";
    const requestedUrl = new URL(targetPath, scope.location.origin);
    const targetUrl =
      requestedUrl.origin === scope.location.origin
        ? requestedUrl
        : new URL("/", scope.location.origin);

    event.waitUntil(
      scope.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then(async (clientList) => {
          const client = clientList[0];
          if (!client) {
            return scope.clients.openWindow?.(targetUrl.href);
          }
          const focused = await client.focus();
          if (client.url !== targetUrl.href && client.navigate) {
            return client.navigate(targetUrl.href);
          }
          return focused;
        }),
    );
  });
}

const possibleWorkerScope =
  globalThis as unknown as Partial<ServiceWorkerScopeLike>;
if (
  typeof possibleWorkerScope.skipWaiting === "function" &&
  possibleWorkerScope.clients &&
  possibleWorkerScope.location
) {
  installServiceWorkerHandlers(possibleWorkerScope as ServiceWorkerScopeLike);
}
