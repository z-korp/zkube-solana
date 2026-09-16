// @vitest-environment node
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";


describe("deployed keeper config", () => {
  it("release_inputs_do_not_reuse_the_abandoned_deployment", async () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const frozen = join(root, "tools/chain/deployment/devnet-v4.json");
    const prior = JSON.parse(await readFile(frozen, "utf8"));
    const retired = [prior.program.deployedProgramDataSha256, prior.keeper.signer, String(prior.launch.dayId)];
    const violations: string[] = [];
    async function scan(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (["node_modules", "dist", "generated"].includes(entry.name)) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await scan(path);
        else if (path !== frozen && /\.(?:ts|mjs|json|toml)$/.test(path)) {
          const source = await readFile(path, "utf8");
          if (retired.some(value => source.includes(value))) violations.push(path);
        }
      }
    }
    await scan(join(root, "services"));
    await scan(join(root, "tools/chain"));
    expect(violations).toEqual([]);
  });
  it("keeps release inputs and runtime limits out of deployment configuration", async () => {
    const toml = await readFile(new URL("../fly.keeper.toml", import.meta.url), "utf8");
    const env = (key: string) =>
      toml.match(new RegExp(`^\\s*${key} = "([^"]+)"`, "m"))?.[1];
    for (const key of ["KEEPER_MAX_WRITES", "KEEPER_MAX_SPEND_LAMPORTS_PER_PASS", "MIN_KEEPER_LAMPORTS"]) {
      expect(env(key)).toBeUndefined();
    }
    expect(toml).not.toContain("[[mounts]]");
    expect(env("ZKUBE_ARCHIVE_DIRECTORY")).toBeUndefined();
    expect(env("ZKUBE_KEEPER_IMAGE_DIGEST")).toBeUndefined();
    expect(env("ZKUBE_REPLAY_DOMAIN_HEX")).toBeUndefined();
    expect(env("ZKUBE_KEEPER_PUBLIC_KEY")).toBeUndefined();
    expect(env("ZKUBE_LAUNCH_DAY_ID")).toBeUndefined();
    expect(env("ZKUBE_DEPLOYED_SBF_SHA256")).toBeUndefined();
  });
});
