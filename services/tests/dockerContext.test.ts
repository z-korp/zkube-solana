// @vitest-environment node
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("keeper Docker context", () => {
  it("bundles the tracked frozen IDL instead of ignored Anchor target output", async () => {
    const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
    expect(dockerfile).toContain(
      "COPY --chown=node:node tools/chain/idl/solana.json ./tools/chain/idl/solana.json",
    );
    expect(dockerfile).not.toMatch(/COPY[^\n]*target\/idl\/solana\.json/);
    const excluded = (await readFile(new URL("../../.dockerignore", import.meta.url), "utf8"))
      .split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));
    for (const parent of ["tools", "tools/chain", "tools/chain/idl", "tools/chain/idl/solana.json", "services", "services/zkube-core"])
      expect(excluded, `${parent} is required by a Docker COPY`).not.toContain(parent);
    expect(dockerfile).toContain("COPY services/zkube-core ./zkube-core");
    expect(dockerfile).toContain("COPY --from=build --chown=node:node /app/services/zkube-core ./services/zkube-core");
  });
});
