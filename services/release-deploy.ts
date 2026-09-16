import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { launchDayFromEnv } from "../shared/chain.js";
import { keeperReleaseRecord } from "./src/keeperRelease.js";
import { keeperPublicKeyFromEnv } from "./src/keeper.js";

const root = fileURLToPath(new URL("../", import.meta.url));
type Run = (args: string[]) => Promise<string>;

export async function deployKeeperRelease(
  env: Record<string, string | undefined>,
  run: Run,
  save: (record: ReturnType<typeof keeperReleaseRecord>) => Promise<void>,
) {
  const keeperPublicKey = keeperPublicKeyFromEnv(env).toBase58();
  const launchDayId = launchDayFromEnv(env);
  if (env.FLY_IMAGE_REF) keeperReleaseRecord({ keeperPublicKey, launchDayId, keeperImageReference: env.FLY_IMAGE_REF });
  const config = ["--config", "services/fly.keeper.toml"];
  const output = env.FLY_IMAGE_REF ?? await run(["deploy", ...config, "--build-only", "--push"]);
  const references = [...new Set(output.match(/registry\.fly\.io\/zkube-solana-devnet-keeper:deployment-[0-9A-HJKMNP-TV-Z]{26}/g))];
  if (references.length !== 1) throw new Error("build did not return one immutable keeper image reference");
  const release = keeperReleaseRecord({ keeperPublicKey, launchDayId, keeperImageReference: references[0]! });
  await save(release);
  await run(["secrets", "set", ...config, "--stage", "KEEPER_WRITE_ENABLED=false"]);
  await run(["deploy", ...config, "--image", release.record.keeperImageReference,
    "--env", `ZKUBE_KEEPER_PUBLIC_KEY=${keeperPublicKey}`,
    "--env", `ZKUBE_LAUNCH_DAY_ID=${launchDayId}`]);
  return release;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--help")) {
    console.log("release:deploy builds and deploys a read-only keeper. Set ZKUBE_KEEPER_PUBLIC_KEY and ZKUBE_LAUNCH_DAY_ID; FLY_IMAGE_REF optionally reuses an immutable image. Review build/keeper-release.json and the read-only pass before separately approving writes.");
  } else {
    const execute = promisify(execFile);
    deployKeeperRelease(process.env, async args => {
      const result = await execute("flyctl", args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
      return result.stdout + result.stderr;
    }, async release => {
      await mkdir(resolve(root, "build"), { recursive: true });
      await writeFile(resolve(root, "build/keeper-release.json"), JSON.stringify(release, null, 2) + "\n");
    }).then(release => console.log(`Keeper release: ${release.fingerprint}\nRecord: build/keeper-release.json`))
      .catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
  }
}
