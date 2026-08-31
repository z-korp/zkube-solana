import { describe, expect, it } from "vitest";

import type { StorageLike } from "@/platform/storage";
import {
  decodeLocalProductState,
  emptyLocalProductState,
  localProductStorage,
} from "./localPersistence";

describe("local product persistence", () => {
  it("local_state_codec_is_versioned_forward_only", () => {
    expect(decodeLocalProductState('{"version":2,"name":"Future"}')).toEqual(
      emptyLocalProductState(),
    );
    const decoded = decodeLocalProductState(
      JSON.stringify({
        ...emptyLocalProductState(),
        name: "  Kube  ",
        stars: [9, 2],
        wornEmblem: 99,
        campaignOwned: true,
        campaignPrice: "  €0.99  ",
      }),
    );
    expect(decoded.name).toBe("Kube");
    expect(decoded.stars.slice(0, 3)).toEqual([3, 2, 0]);
    expect(decoded.wornEmblem).toBe(10);
    expect(decoded.campaignOwned).toBe(true);
    expect(decoded.campaignPrice).toBe("€0.99");
  });

  it("writes every local product change through the same key", () => {
    const values = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    };
    const state = localProductStorage(storage);
    state.write((current) => ({ ...current, name: "Mira" }));
    expect([...values.keys()]).toEqual(["zkube:local-product:v1"]);
    expect(localProductStorage(storage).read().name).toBe("Mira");
  });
});
