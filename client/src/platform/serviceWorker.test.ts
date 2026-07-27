import { describe, expect, it, vi } from "vitest";

import {
  classifyCacheRoute,
  isLocalNetworkHostname,
  obsoleteZkubeCaches,
  pruneCacheEntries,
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
