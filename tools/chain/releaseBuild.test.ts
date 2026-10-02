import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { parseOperatorArgs } from "./cli.js";
import { RELEASE_BUILD, buildRelease, releaseArtifact, type RunCargo } from "./releaseBuild.js";

const scratch = fileURLToPath(new URL("../../build/release-build-tests", import.meta.url));
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

const VERSIONS = `solana-cargo-build-sbf ${RELEASE_BUILD.cargoBuildSbf}\nplatform-tools ${RELEASE_BUILD.platformTools}\nrustc ${RELEASE_BUILD.rustc}\n`;
const elf = (fill: number) => Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64, fill)]);
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** cargo, as far as the build asks: its version, then one build that writes the ELF. */
function tools(versions: string, output: Buffer) {
  const calls: { args: readonly string[]; env: Record<string, string> }[] = [];
  const run: RunCargo = (args, env) => {
    calls.push({ args, env });
    if (args.includes("--version")) return versions;
    writeFileSync(`${scratch}/${RELEASE_BUILD.artifact}`, output);
    return "";
  };
  return { run, calls };
}

it("release_build_uses_only_the_pinned_tools_from_a_clean_target_and_records_what_built_it", () => {
  for (const [name, pinned] of [["solana-cargo-build-sbf", RELEASE_BUILD.cargoBuildSbf],
    ["platform-tools", RELEASE_BUILD.platformTools], ["rustc", RELEASE_BUILD.rustc]]) {
    const other = tools(VERSIONS.replace(`${name} ${pinned}`, `${name} 0.0.1`), elf(1));
    expect(() => buildRelease(scratch, other.run)).toThrow(`Release build needs ${name} ${pinned}; found 0.0.1`);
    // Nothing is built with other tools.
    expect(other.calls).toHaveLength(1);
  }
  // Leftovers of an earlier build never reach the release.
  mkdirSync(`${scratch}/${RELEASE_BUILD.targetDirectory}`, { recursive: true });
  mkdirSync(`${scratch}/build/chain/release`, { recursive: true });
  writeFileSync(`${scratch}/${RELEASE_BUILD.targetDirectory}/stale`, "x");
  writeFileSync(`${scratch}/build/chain/release/stale.so`, "x");
  const { run, calls } = tools(VERSIONS, elf(1));
  const record = buildRelease(scratch, run);
  expect(() => readFileSync(`${scratch}/${RELEASE_BUILD.targetDirectory}/stale`)).toThrow();
  expect(() => readFileSync(`${scratch}/build/chain/release/stale.so`)).toThrow();
  expect(calls[1]).toEqual({ args: RELEASE_BUILD.arguments, env: { NO_DNA: "1", CARGO_NET_OFFLINE: "true",
    CARGO_TARGET_DIR: `${scratch}/${RELEASE_BUILD.targetDirectory}` } });
  expect(record).toEqual({ recipe: RELEASE_BUILD, sha256: hash(elf(1)), bytes: 68 });
  expect(parseOperatorArgs(["build-release"])).toEqual({ help: false, mode: "build-release" });
});

it("a_deploy_plan_quotes_only_the_recorded_release_build_at_the_reviewed_hash", () => {
  expect(() => releaseArtifact(scratch, hash(elf(1)))).toThrow("No release build found");
  const record = buildRelease(scratch, tools(VERSIONS, elf(1)).run);
  expect(releaseArtifact(scratch, record.sha256)).toEqual({ artifactPath: `${scratch}/${RELEASE_BUILD.artifact}`,
    artifactSha256: record.sha256, artifactBytes: 68 });
  // Another hash than the one built, however obtained, is not this release.
  expect(() => releaseArtifact(scratch, hash(elf(2)))).toThrow("differs from release input");
  // An ELF swapped in after the build, even at the same size, is refused.
  writeFileSync(`${scratch}/${RELEASE_BUILD.artifact}`, elf(2));
  expect(() => releaseArtifact(scratch, record.sha256)).toThrow("changed after it was built");
  expect(() => releaseArtifact(scratch, hash(elf(2)))).toThrow("changed after it was built");
  // A build made any other way carries another recipe, or none.
  const path = `${scratch}/build/chain/release/solana.release.json`;
  for (const recipe of [{ ...RELEASE_BUILD, arguments: [...RELEASE_BUILD.arguments, "--disable-remap-cwd"] },
    { ...RELEASE_BUILD, platformTools: "v1.51" }, undefined]) {
    writeFileSync(path, JSON.stringify({ recipe, sha256: hash(elf(2)), bytes: 68 }));
    expect(() => releaseArtifact(scratch, hash(elf(2)))).toThrow("pinned build configuration");
  }
  writeFileSync(path, "{");
  expect(() => releaseArtifact(scratch, hash(elf(2)))).toThrow("pinned build configuration");
});
