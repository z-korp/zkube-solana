// @vitest-environment node
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("keeper Docker context", () => {
  it("bundles the tracked frozen IDL instead of ignored Anchor target output", async () => {
    const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
    expect(dockerfile).toContain(
      "COPY --chown=node:node client/src/chain/idl/solana.json ./client/src/chain/idl/solana.json",
    );
    expect(dockerfile).not.toMatch(/COPY[^\n]*target\/idl\/solana\.json/);
  });
});
