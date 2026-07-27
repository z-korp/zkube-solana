import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyCacheRoute,
  installServiceWorkerHandlers,
  isLocalNetworkHostname,
  obsoleteZkubeCaches,
  pruneCacheEntries,
  responseMatchesDestination,
  type CacheRouteRequest,
} from "./serviceWorker";

const ORIGIN = "https://app.zkube.example";

function request(change: Partial<CacheRouteRequest> = {}): CacheRouteRequest {
  return {
    method: "GET",
    url: `${ORIGIN}/assets/index-AbCd1234.js`,
    mode: "cors",
    destination: "script",
    ...change,
  };
}

describe("service-worker cache routing", () => {
  it("allows only same-origin navigations and static browser destinations", () => {
    expect(classifyCacheRoute(request(), ORIGIN)).toBe("asset");
    expect(
      classifyCacheRoute(
        request({
          url: `${ORIGIN}/?recover=42`,
          mode: "navigate",
          destination: "document",
        }),
        ORIGIN,
      ),
    ).toBe("navigation");
    expect(
      classifyCacheRoute(request({ destination: "manifest" }), ORIGIN),
    ).toBe("network");
    expect(classifyCacheRoute(request({ destination: "" }), ORIGIN)).toBe(
      "network",
    );
  });

  it.each([
    ["cross-origin RPC", { url: "https://rpc.example", destination: "" }],
    ["same-origin API", { url: `${ORIGIN}/api/account`, destination: "" }],
    ["same-origin RPC", { url: `${ORIGIN}/rpc`, destination: "" }],
    [
      "wallet association",
      { url: `${ORIGIN}/.well-known/assetlinks.json`, destination: "" },
    ],
    ["POST", { method: "POST", destination: "" }],
    ["authorized asset", { hasAuthorization: true }],
    ["ranged asset", { hasRange: true }],
    [
      "loopback origin",
      { url: "https://127.0.0.1:8899/asset.js", destination: "script" },
    ],
  ] satisfies [string, Partial<CacheRouteRequest>][])(
    "keeps %s network-only",
    (_label, change) => {
      expect(classifyCacheRoute(request(change), ORIGIN)).toBe("network");
    },
  );

  it.each([
    "localhost",
    "wallet.localhost",
    "127.0.0.1",
    "10.0.0.4",
    "172.16.2.3",
    "172.31.255.255",
    "192.168.1.8",
    "169.254.4.2",
    "::1",
  ])("recognizes local-network host %s", (hostname) => {
    expect(isLocalNetworkHostname(hostname)).toBe(true);
  });

  it("matches browser destinations to response content types", () => {
    expect(
      responseMatchesDestination(response("text/javascript"), "script"),
    ).toBe(true);
    expect(responseMatchesDestination(response("text/css"), "style")).toBe(
      true,
    );
    expect(responseMatchesDestination(response("font/woff2"), "font")).toBe(
      true,
    );
    expect(responseMatchesDestination(response("image/webp"), "image")).toBe(
      true,
    );
    expect(responseMatchesDestination(response("text/html"), "script")).toBe(
      false,
    );
  });
});

describe("service-worker cache lifecycle", () => {
  it("prunes only obsolete zKube cache generations", () => {
    expect(
      obsoleteZkubeCaches(
        [
          "zkube-pwa-current",
          "zkube-pwa-old",
          "zkube-static-v1",
          "another-app-cache",
        ],
        "zkube-pwa-current",
      ),
    ).toEqual(["zkube-pwa-old", "zkube-static-v1"]);
  });

  it("bounds entries by deleting the oldest cache keys", async () => {
    const keys = ["/old-a", "/old-b", "/current-a", "/current-b"].map(
      (url) => new Request(`${ORIGIN}${url}`),
    );
    const remove = vi.fn(async () => true);

    await pruneCacheEntries({ keys: async () => keys, delete: remove }, 2);

    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenNthCalledWith(1, keys[0]);
    expect(remove).toHaveBeenNthCalledWith(2, keys[1]);
  });

  it("retains the offline shell while pruning asset overflow", async () => {
    const shell = new Request(`${ORIGIN}/.zkube/offline-shell`);
    const keys = [
      shell,
      new Request(`${ORIGIN}/old-a`),
      new Request(`${ORIGIN}/old-b`),
      new Request(`${ORIGIN}/current`),
    ];
    const remove = vi.fn(async () => true);

    await pruneCacheEntries(
      { keys: async () => keys, delete: remove },
      2,
      new Set([shell.url]),
    );

    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenNthCalledWith(1, keys[1]);
    expect(remove).toHaveBeenNthCalledWith(2, keys[2]);
  });
});

describe("service-worker event behavior", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects an HTML SPA rewrite for a script and never caches it", async () => {
    const harness = workerHarness();
    const cache = memoryCache();
    vi.stubGlobal("caches", cacheStorage(cache));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => basicResponse("text/html", "<html>rewrite</html>")),
    );
    installServiceWorkerHandlers(harness.scope as never);
    const event = harness.fetchEvent(workerRequest("script"));

    harness.listeners.fetch!(event as never);

    await expect(event.response).rejects.toThrow(
      /rejected text\/html for script/i,
    );
    await Promise.all(event.extended);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("returns a valid asset before its deferred cache write completes", async () => {
    const harness = workerHarness();
    const pendingPut = deferred<void>();
    const cache = memoryCache();
    cache.put.mockImplementationOnce(() => pendingPut.promise);
    vi.stubGlobal("caches", cacheStorage(cache));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        basicResponse("text/javascript", "export const ready = true"),
      ),
    );
    installServiceWorkerHandlers(harness.scope as never);
    const event = harness.fetchEvent(workerRequest("script"));

    harness.listeners.fetch!(event as never);
    const networkResponse = await event.response;

    expect(await networkResponse.text()).toContain("ready");
    expect(event.extended).toHaveLength(1);
    await vi.waitFor(() => expect(cache.put).toHaveBeenCalledOnce());
    expect(cache.put).toHaveBeenCalledOnce();
    pendingPut.resolve();
    await Promise.all(event.extended);
  });

  it("falls back to the offline HTML shell for a failed navigation", async () => {
    const harness = workerHarness();
    const cache = memoryCache();
    cache.entries.set(
      `${ORIGIN}/.zkube/offline-shell`,
      basicResponse("text/html", "<html>cached shell</html>"),
    );
    vi.stubGlobal("caches", cacheStorage(cache));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("offline"))),
    );
    installServiceWorkerHandlers(harness.scope as never);
    const event = harness.fetchEvent(
      workerRequest("document", `${ORIGIN}/arcade`, "navigate"),
    );

    harness.listeners.fetch!(event as never);

    const fallback = await event.response;
    expect(await fallback.text()).toContain("cached shell");
    await Promise.all(event.extended);
  });

  it("amortizes cache enumeration across a bounded write batch", async () => {
    const harness = workerHarness();
    const cache = memoryCache();
    vi.stubGlobal("caches", cacheStorage(cache));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => basicResponse("text/javascript", "export {}")),
    );
    installServiceWorkerHandlers(harness.scope as never);
    const activate = harness.extendableEvent();
    harness.listeners.activate!(activate as never);
    await Promise.all(activate.extended);

    for (let index = 0; index < 16; index += 1) {
      const event = harness.fetchEvent(
        workerRequest("script", `${ORIGIN}/assets/app-${index}.js`),
      );
      harness.listeners.fetch!(event as never);
      await event.response;
      await Promise.all(event.extended);
    }

    expect(cache.put).toHaveBeenCalledTimes(16);
    // Once on activation to establish the lower watermark, then once for the
    // completed batch — never before every response.
    expect(cache.keys).toHaveBeenCalledTimes(2);
  });

  it("handles activate, exact messages, and notification targets safely", async () => {
    const harness = workerHarness();
    const cache = memoryCache();
    const storage = cacheStorage(cache, ["zkube-pwa-old", "another-app-cache"]);
    vi.stubGlobal("caches", storage);
    installServiceWorkerHandlers(harness.scope as never);

    storage.keys.mockRejectedValueOnce(new Error("cache unavailable"));
    const degradedActivate = harness.extendableEvent();
    harness.listeners.activate!(degradedActivate as never);
    await expect(Promise.all(degradedActivate.extended)).resolves.toBeDefined();

    const activate = harness.extendableEvent();
    harness.listeners.activate!(activate as never);
    await Promise.all(activate.extended);
    expect(storage.delete).toHaveBeenCalledWith("zkube-pwa-old");
    expect(storage.delete).not.toHaveBeenCalledWith("another-app-cache");

    const ignored = harness.extendableEvent({ type: "NOT_SKIP_WAITING" });
    harness.listeners.message!(ignored as never);
    expect(harness.scope.skipWaiting).not.toHaveBeenCalled();

    const message = harness.extendableEvent({ type: "SKIP_WAITING" });
    harness.listeners.message!(message as never);
    await Promise.all(message.extended);
    expect(harness.scope.skipWaiting).toHaveBeenCalledOnce();

    const notification = harness.notificationEvent("https://evil.example");
    harness.listeners.notificationclick!(notification as never);
    await Promise.all(notification.extended);
    expect(notification.close).toHaveBeenCalledOnce();
    expect(harness.scope.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });
});

function response(contentType: string): Pick<Response, "headers"> {
  return { headers: new Headers({ "Content-Type": contentType }) };
}

function basicResponse(contentType: string, body = ""): Response {
  const result = new Response(body, {
    status: 200,
    headers: { "Content-Type": contentType },
  });
  Object.defineProperty(result, "type", { value: "basic" });
  return result;
}

function workerRequest(
  destination: RequestDestination,
  url = `${ORIGIN}/assets/app.js`,
  mode: RequestMode = "cors",
): Request {
  const result = new Request(url);
  Object.defineProperty(result, "destination", { value: destination });
  Object.defineProperty(result, "mode", { value: mode });
  return result;
}

function memoryCache() {
  const entries = new Map<string, Response>();
  return {
    entries,
    delete: vi.fn(async (request: RequestInfo) =>
      entries.delete(requestUrl(request)),
    ),
    keys: vi.fn(async () => [...entries.keys()].map((url) => new Request(url))),
    match: vi.fn(async (request: RequestInfo) =>
      entries.get(requestUrl(request))?.clone(),
    ),
    put: vi.fn(async (request: RequestInfo, value: Response) => {
      entries.set(requestUrl(request), value.clone());
    }),
  };
}

function cacheStorage(
  cache: ReturnType<typeof memoryCache>,
  names: string[] = [],
) {
  return {
    delete: vi.fn(async (name: string) => {
      const index = names.indexOf(name);
      if (index < 0) return false;
      names.splice(index, 1);
      return true;
    }),
    keys: vi.fn(async () => [...names]),
    open: vi.fn(async () => cache),
  };
}

function workerHarness() {
  const listeners: Partial<Record<string, (event: Event) => void>> = {};
  const clients = {
    matchAll: vi.fn(async () => []),
    openWindow: vi.fn(async () => null),
  };
  const scope = {
    location: new URL(`${ORIGIN}/sw.js`),
    clients,
    skipWaiting: vi.fn(async () => undefined),
    addEventListener: vi.fn(
      (type: string, listener: (event: Event) => void) => {
        listeners[type] = listener;
      },
    ),
  };
  const extendableEvent = (data?: unknown) => {
    const extended: Promise<unknown>[] = [];
    return {
      data,
      extended,
      waitUntil(promise: Promise<unknown>) {
        extended.push(promise);
      },
    };
  };
  return {
    listeners,
    scope,
    extendableEvent,
    fetchEvent(request: Request) {
      const event = extendableEvent() as ReturnType<typeof extendableEvent> & {
        request: Request;
        response: Promise<Response>;
        respondWith(response: Promise<Response>): void;
      };
      event.request = request;
      event.response = Promise.reject(new Error("respondWith not called"));
      void event.response.catch(() => undefined);
      event.respondWith = (nextResponse) => {
        event.response = nextResponse;
      };
      return event;
    },
    notificationEvent(url: unknown) {
      const event = extendableEvent() as ReturnType<typeof extendableEvent> & {
        notification: { data: { url: unknown }; close(): void };
        close: ReturnType<typeof vi.fn>;
      };
      const close = vi.fn();
      event.notification = { data: { url }, close };
      event.close = close;
      return event;
    },
  };
}

function requestUrl(request: RequestInfo): string {
  return typeof request === "string" ? request : request.url;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
