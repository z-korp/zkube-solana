// @vitest-environment node
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { KEEPER_RELEASE_POLICY } from "../src/keeperRelease";

// The deployed config may restate a fingerprinted value only if it restates
// it exactly. Runtime clamping keeps behaviour correct either way, but a toml
// that contradicts the release policy teaches the operator the wrong ceiling.
describe("deployed keeper config", () => {
  it("restates release-policy values exactly", async () => {
    const toml = await readFile(new URL("../fly.keeper.toml", import.meta.url), "utf8");
    const env = (key: string) =>
      toml.match(new RegExp(`^\\s*${key} = "([^"]+)"`, "m"))?.[1];
    expect(env("KEEPER_MAX_WRITES")).toBe(
      String(KEEPER_RELEASE_POLICY.maximumWritesPerPass),
    );
    expect(env("KEEPER_MAX_SPEND_LAMPORTS_PER_PASS")).toBe(
      String(KEEPER_RELEASE_POLICY.maximumSpendLamportsPerPass),
    );
    expect(env("MIN_KEEPER_LAMPORTS")).toBe(
      String(KEEPER_RELEASE_POLICY.reserveFloorLamports),
    );
    expect(env("ZKUBE_ARCHIVE_DIRECTORY")).toBe(
      KEEPER_RELEASE_POLICY.archiveDirectory,
    );
  });
});
