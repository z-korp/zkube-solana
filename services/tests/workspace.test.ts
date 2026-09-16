import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchDayFromEnv, MIN_SUPPORTED_DAY_ID, SOLANA_ENDPOINT } from "../../shared/chain.js";
import { createDevnetConnection } from "../src/serviceReadiness.js";
import { devnetConnection } from "../../tools/chain/chainRelease.js";

const root = new URL("../../", import.meta.url);

it("workspace_has_one_dependency_and_configuration_owner", () => {
  for (const directory of ["services/", "tools/chain/"]) {
    for (const file of ["pnpm-lock.yaml", "pnpm-workspace.yaml", "eslint.config.js", "tsconfig.json", "vitest.config.ts"])
      expect(existsSync(new URL(directory + file, root)), directory + file).toBe(false);
    const child = JSON.parse(readFileSync(new URL(directory + "package.json", root), "utf8"));
    expect(child.dependencies).toBeUndefined();
    expect(child.devDependencies).toBeUndefined();
  }
  for (const file of ["pnpm-lock.yaml", "pnpm-workspace.yaml", "eslint.config.js", "tsconfig.json", "vitest.config.ts"])
    expect(existsSync(new URL(file, root)), file).toBe(true);
});

it("keeper_and_operator_share_chain_identity_and_launch_day_bounds", () => {
  expect(devnetConnection(SOLANA_ENDPOINT).rpcEndpoint).toBe(SOLANA_ENDPOINT);
  expect(createDevnetConnection({}).rpcEndpoint).toBe(SOLANA_ENDPOINT);
  for (const day of [MIN_SUPPORTED_DAY_ID, 0xffff_ffff])
    expect(launchDayFromEnv({ ZKUBE_LAUNCH_DAY_ID: String(day) })).toBe(day);
  for (const day of [undefined, "", "-1", "3", "4.1", "4294967296", "NaN"])
    expect(() => launchDayFromEnv({ ZKUBE_LAUNCH_DAY_ID: day })).toThrow();
});

it("workspace_build_loads_keeper_idl_and_native_rules_offline", () => {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import './dist/services/src/keeperWorker.js';
    import './dist/services/src/zkubeCore.js';
    import { readFileSync } from 'node:fs';
    const idl = JSON.parse(readFileSync('./dist/tools/chain/idl/solana.json', 'utf8'));
    if (!idl.address || !idl.instructions.length) throw new Error('missing program interface');
    process.stdout.write('loaded');
  `], { cwd: fileURLToPath(root), encoding: "utf8", timeout: 15000,
    env: { PATH: process.env.PATH, NO_DNA: "1" } });
  expect(output).toBe("loaded");
});
