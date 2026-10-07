import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey, type Connection } from "@solana/web3.js";
import { SOLANA_ENDPOINT, ZKUBE_PROGRAM_ID } from "../../shared/chain.js";
import { assertDevnetRelease, chainTime, devnetConnection, programDataAddress, readAccount, requireHash, requireInteger, sha256,
  PROGRAM_DATA_HEADER_BYTES } from "./chainRelease.js";
import { buildRelease, releaseArtifact } from "./releaseBuild.js";
import { deploymentRelease, deploymentRentSpaces, upgradeRelease, type DeploymentInput, type UpgradeInput } from "./deploymentPlan.js";
import { launchPlannerInputFromEnv } from "./launchPlanner.js";
import { quoteBundle, quoteLaunch, readBundle } from "./operatorPlan.js";
import { executeBundle } from "./operatorRuntime.js";
import { assertUpgradeRelease, observeDeposits, preparedRulesHash, readGovernance, type DailyRulesHash } from "./operatorState.js";
import { deriveArenaDailyPda, deriveProtocolConfigPda } from "./pdas.js";
import { dayIdAt } from "../../services/src/zkubeCore.js";
import { loadPinnedKeypair, saveBundle } from "./operatorTransaction.js";
import { readLatestRun, requireRunCosts } from "./runCosts.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const HELP = `zKube Devnet operator
  build-release
  check-run-costs
  check-release
  plan deploy --bundle build/chain/deploy.json
  plan upgrade --bundle build/chain/upgrade.json
  plan launch --bundle build/chain/launch.json
  plan top-up --launch-bundle build/chain/launch.json --top-up daily:current:1SOL --bundle build/chain/top-up.json
  plan set-suspension --launch-bundle build/chain/launch.json --until-day <day> --bundle build/chain/suspension.json
  execute --bundle <path> [--until <inclusive transaction index>]

Planning reads public state and writes one fingerprinted bundle. It loads no keypair.
All plans accept SOLANA_DEVNET_RPC_URL (default: the shared Devnet endpoint).
build-release builds the program offline from a clean target with the pinned tools and
  records the result under build/chain/release. It is the only ELF a deploy plan quotes.
check-run-costs reads the cluster's rent, the delegation program's deploy slot and the latest
  settled run, and fails naming every stated run cost figure the cluster no longer charges.
Deploy inputs: ZKUBE_SBF_SHA256 (the reviewed hash of that build), ZKUBE_DEPLOYER_PUBLIC_KEY,
  ZKUBE_PROGRAM_BUFFER_PUBLIC_KEY, ZKUBE_PROGRAM_UPGRADE_AUTHORITY.
Upgrade takes the same inputs and replaces the deployed program in place: a buffer, then the loader's
  Upgrade, which is sent only while every day it could land on is suspended. After an upgrade, top-up and
  set-suspension plans also take --upgrade-bundle <path>: the program they then bind is the upgraded one.
check-release (ZKUBE_SBF_SHA256) shows whether the deployed program is the reviewed release build and
  whether today's Daily was prepared by it.
Launch inputs: ZKUBE_CLUSTER=devnet, ZKUBE_DEPLOYER_PUBLIC_KEY,
  ZKUBE_PROTOCOL_AUTHORITY, ZKUBE_TEAM_DESTINATION, ZKUBE_LAUNCH_DAY_ID,
  ZKUBE_LAUNCH_CUTOFF_UNIX, ZKUBE_DEPLOYED_PROGRAM_DATA_SHA256,
  ZKUBE_PROGRAM_ALLOCATION_BYTES, ZKUBE_PROGRAM_UPGRADE_AUTHORITY,
  ZKUBE_KEEPER_RELEASE_FINGERPRINT.
  A day opens at 07:00 UTC; the launch cutoff must fall inside the launch day's entry window.
Execution requires ZKUBE_APPROVAL=<printed fingerprint>. Signer file mappings:
  ZKUBE_SIGNER_PATHS='{"<approved public key>":"<existing keypair path>"}'.
Activation also requires ZKUBE_KEEPER_STAGED_RELEASE_FINGERPRINT.
--until stops after an inclusive index; resume the same bundle to continue.
An upgrade keeps the program address, its ProgramData allocation and its upgrade authority.`;

type Env = Record<string, string | undefined>;
function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function parseOperatorArgs(args: string[]) {
  if (args.includes("--help") || !args.length) return { help: true as const };
  if (args.length === 1 && args[0] === "build-release") return { help: false as const, mode: "build-release" as const };
  if (args.length === 1 && args[0] === "check-run-costs") return { help: false as const, mode: "check-run-costs" as const };
  if (args.length === 1 && args[0] === "check-release") return { help: false as const, mode: "check-release" as const };
  const mode = args.shift();
  if (mode !== "plan" && mode !== "execute") throw new Error("Use plan or execute");
  const operation = mode === "plan" ? args.shift() : undefined;
  if (mode === "plan" && !["deploy", "upgrade", "launch", "top-up", "set-suspension"].includes(operation ?? "")) {
    throw new Error("Choose deploy, upgrade, launch, top-up or set-suspension");
  }
  const options: Record<string, string[]> = {};
  while (args.length) {
    const option = args.shift()!;
    const value = args.shift();
    if (!["--bundle", "--until", "--launch-bundle", "--upgrade-bundle", "--top-up", "--until-day"].includes(option) ||
        !value || value.startsWith("--")) throw new Error(`Invalid option ${option}`);
    if (option !== "--top-up" && options[option]) throw new Error(`Duplicate option ${option}`);
    (options[option] ??= []).push(value);
  }
  const allowed = mode === "execute" ? ["--bundle", "--until"] : operation === "top-up"
    ? ["--bundle", "--launch-bundle", "--upgrade-bundle", "--top-up"] : operation === "set-suspension"
      ? ["--bundle", "--launch-bundle", "--upgrade-bundle", "--until-day"] : ["--bundle"];
  if (Object.keys(options).some(key => !allowed.includes(key))) throw new Error("Option is not valid for this command");
  const bundle = options["--bundle"]?.[0];
  if (!bundle) throw new Error("--bundle is required");
  return { help: false as const, mode: mode as "plan" | "execute", operation, options, bundle: resolve(ROOT, bundle) };
}

export function parseDeposit(value: string): { selector: string; lamports: string } {
  const match = /^daily:(current|\d+):(.+)$/.exec(value);
  if (!match) throw new Error("Top-up format is daily:<current|day>:<amount>SOL or lamports");
  const sol = /^(0|[1-9]\d*)(?:\.(\d{1,9}))?SOL$/i.exec(match[2]!);
  const raw = /^([1-9]\d*)lamports$/i.exec(match[2]!);
  if (!sol && !raw) throw new Error("Amount requires an explicit SOL or lamports suffix");
  const amount = sol ? BigInt(sol[1]!) * 1_000_000_000n + BigInt((sol[2] ?? "").padEnd(9, "0")) : BigInt(raw![1]!);
  if (amount <= 0n || amount > 0xffff_ffff_ffff_ffffn) throw new Error("Amount must fit in a positive u64");
  return { selector: match[1]!, lamports: amount.toString() };
}

/**
 * What a reader needs after an upgrade, from public reads: is the deployed
 * program the reviewed release build, and was today's Daily prepared by it.
 */
export async function checkRelease(connection: Connection, artifact: { artifactPath: string; artifactSha256: string },
  rulesHash: DailyRulesHash = preparedRulesHash) {
  const data = await connection.getAccountInfo(programDataAddress(), "confirmed");
  if (!data) throw new Error("The program is not deployed");
  const elf = readFileSync(artifact.artifactPath), held = data.data.subarray(PROGRAM_DATA_HEADER_BYTES);
  const deployed = held.subarray(0, elf.length).equals(elf) && !held.subarray(elf.length).some(Boolean);
  const today = dayIdAt(BigInt(await chainTime(connection)));
  const { value: protocol } = await readAccount(connection, "protocolConfig", deriveProtocolConfigPda());
  const daily = await connection.getAccountInfo(deriveArenaDailyPda(today), "confirmed")
    ? (await readAccount(connection, "arenaDaily", deriveArenaDailyPda(today))).value : undefined;
  const stored = daily && Buffer.from(daily.rulesHash).toString("hex"), expected = rulesHash(today);
  const result = {
    program: ZKUBE_PROGRAM_ID.toBase58(),
    reviewedBuildSha256: artifact.artifactSha256,
    deployedIsTheReviewedBuild: deployed,
    deployedProgramDataSha256: sha256(held),
    deployedAtSlot: Number(data.data.readBigUInt64LE(4)),
    today,
    todaySuspended: today < protocol.suspendedUntilDay,
    suspendedUntilDay: protocol.suspendedUntilDay,
    todaysDaily: !daily ? "not prepared yet: the day's first entry prepares it"
      : stored === expected ? "prepared by this build's catalogue"
        : "prepared under another catalogue: the day must stay suspended",
    todaysDailyRulesHash: stored ?? null,
    thisBuildsRulesHashForToday: expected,
    entriesPaidToday: daily ? Number(daily.entriesPaid) : 0,
  };
  if (!deployed) throw new Error(`The deployed program is not the reviewed release build\n${JSON.stringify(result, null, 1)}`);
  return result;
}

export async function runOperator(args: string[], env: Env = process.env) {
  const command = parseOperatorArgs([...args]);
  if (command.help) return HELP;
  if (command.mode === "build-release") return JSON.stringify(buildRelease(ROOT));
  if (command.mode === "check-release") {
    const artifact = releaseArtifact(ROOT, requireHash(required(env, "ZKUBE_SBF_SHA256"), "Frozen SBF hash"));
    return JSON.stringify(await checkRelease(devnetConnection(env.SOLANA_DEVNET_RPC_URL?.trim() || SOLANA_ENDPOINT), artifact), null, 1);
  }
  if (command.mode === "check-run-costs") {
    const connection = devnetConnection(env.SOLANA_DEVNET_RPC_URL?.trim() || SOLANA_ENDPOINT);
    const run = await readLatestRun(connection);
    return JSON.stringify({ run: run.entry.transaction.signatures[0], slot: run.entry.slot,
      delegationDeploySlot: run.delegationDeploySlot, figures: requireRunCosts(run) }, null, 1);
  }
  const { bundle: path, options } = command;
  if (command.mode === "execute") {
    const result = await executeBundle(readFileSync(path, "utf8"), {
      approval: env.ZKUBE_APPROVAL,
      until: options["--until"] ? Number(options["--until"][0]) : undefined,
      keeperFingerprint: env.ZKUBE_KEEPER_STAGED_RELEASE_FINGERPRINT,
      connect: devnetConnection,
      loadSigner: publicKey => {
        let paths: Record<string, string>;
        try { paths = JSON.parse(required(env, "ZKUBE_SIGNER_PATHS")); }
        catch { throw new Error("ZKUBE_SIGNER_PATHS must map public keys to existing signer files"); }
        if (!paths || Array.isArray(paths)) throw new Error("Invalid signer path map");
        if (typeof paths[publicKey] !== "string") throw new Error(`No signer path for approved public key ${publicKey}`);
        return loadPinnedKeypair(paths[publicKey], publicKey);
      },
      persist: value => saveBundle(path, value),
    });
    return JSON.stringify({ bundle: path, fingerprint: result.fingerprint,
      confirmed: Object.entries(result.receipts).filter(([, receipt]) => receipt.state === "confirmed").map(([index]) => Number(index)) });
  }
  if (!path.startsWith(resolve(ROOT, "build") + "/")) throw new Error("New operator bundles belong under build/");
  if (existsSync(path)) throw new Error("Bundle already exists; use a fresh path or execute the existing bundle");
  const rpc = env.SOLANA_DEVNET_RPC_URL?.trim() || SOLANA_ENDPOINT;
  const connection = devnetConnection(rpc);
  let bundle;
  if (command.operation === "deploy") {
    // Only the canonical release build is quoted, and only at the hash the owner reviewed.
    const artifact = releaseArtifact(ROOT, requireHash(required(env, "ZKUBE_SBF_SHA256"), "Frozen SBF hash"));
    const rents = await Promise.all(deploymentRentSpaces(artifact.artifactBytes).map(size => connection.getMinimumBalanceForRentExemption(size, "confirmed")));
    const input: DeploymentInput = { ...artifact,
      payer: new PublicKey(required(env, "ZKUBE_DEPLOYER_PUBLIC_KEY")).toBase58(),
      buffer: new PublicKey(required(env, "ZKUBE_PROGRAM_BUFFER_PUBLIC_KEY")).toBase58(),
      authority: new PublicKey(required(env, "ZKUBE_PROGRAM_UPGRADE_AUTHORITY")).toBase58(),
      bufferRentLamports: rents[0]!, programRentLamports: rents[1]!, programDataRentLamports: rents[2]! };
    const release = deploymentRelease(input, rpc);
    await assertDevnetRelease(connection, release, true);
    if ((await connection.getMultipleAccountsInfo([ZKUBE_PROGRAM_ID, new PublicKey(input.buffer)], "confirmed")).some(Boolean)) {
      throw new Error("Fresh deployment program or buffer address is occupied");
    }
    bundle = await quoteBundle({ kind: "deploy", input }, release, connection);
  } else if (command.operation === "upgrade") {
    // The same release build and gate as a deployment; what it replaces is read here and bound into the plan.
    const artifact = releaseArtifact(ROOT, requireHash(required(env, "ZKUBE_SBF_SHA256"), "Frozen SBF hash"));
    const data = await connection.getAccountInfo(programDataAddress(), "confirmed");
    if (!data) throw new Error("The program is not deployed; plan deploy instead");
    const held = data.data.subarray(PROGRAM_DATA_HEADER_BYTES);
    const input: UpgradeInput = { ...artifact,
      payer: new PublicKey(required(env, "ZKUBE_DEPLOYER_PUBLIC_KEY")).toBase58(),
      buffer: new PublicKey(required(env, "ZKUBE_PROGRAM_BUFFER_PUBLIC_KEY")).toBase58(),
      authority: new PublicKey(required(env, "ZKUBE_PROGRAM_UPGRADE_AUTHORITY")).toBase58(),
      bufferRentLamports: await connection.getMinimumBalanceForRentExemption(37 + artifact.artifactBytes, "confirmed"),
      deployed: { programDataSha256: sha256(held), allocationBytes: held.length } };
    const release = upgradeRelease(input, rpc);
    if (release.programDataSha256 === input.deployed.programDataSha256) throw new Error("The deployed program already is this release");
    await assertDevnetRelease(connection, { ...release, ...input.deployed });
    if (await connection.getAccountInfo(new PublicKey(input.buffer), "confirmed")) throw new Error("Upgrade buffer address is occupied");
    bundle = await quoteBundle({ kind: "upgrade", input }, release, connection);
  } else if (command.operation === "launch") {
    bundle = await quoteLaunch(launchPlannerInputFromEnv({ ...env, SOLANA_DEVNET_RPC_URL: rpc }), connection);
  } else {
    const launchPath = options["--launch-bundle"]?.[0];
    if (!launchPath) throw new Error("--launch-bundle is required");
    const launch = readBundle(readFileSync(resolve(ROOT, launchPath), "utf8"));
    if (launch.payload.operation.kind !== "launch") throw new Error("Release input must be a launch bundle");
    const { authority, launchDayId } = launch.payload.operation.input;
    // After an upgrade the program these plans bind is the upgraded one. Such a plan can be made
    // before the upgrade lands, and then cannot be executed until it has.
    const upgradePath = options["--upgrade-bundle"]?.[0];
    const upgrade = upgradePath ? readBundle(readFileSync(resolve(ROOT, upgradePath), "utf8")).payload : undefined;
    if (upgrade && upgrade.operation.kind !== "upgrade") throw new Error("--upgrade-bundle must be an upgrade bundle");
    const release = { ...(upgrade ?? launch.payload).release, rpc };
    if (upgrade?.operation.kind === "upgrade") await assertUpgradeRelease(connection, release, upgrade.operation.input.deployed);
    else await assertDevnetRelease(connection, release);
    if (command.operation === "top-up") {
      const requested = (options["--top-up"] ?? []).map(parseDeposit);
      const deposits = await observeDeposits(connection, authority, launchDayId, requested);
      bundle = await quoteBundle({ kind: "top-up", authority, launchDayId, deposits }, release, connection);
    } else {
      const until = options["--until-day"]?.[0];
      if (until === undefined) throw new Error("--until-day is required");
      const untilDay = requireInteger(Number(until), "Suspension day", 0xffff_ffff);
      await readGovernance(connection, authority, launchDayId);
      bundle = await quoteBundle({ kind: "set-suspension", authority, launchDayId, untilDay }, release, connection);
    }
  }
  saveBundle(path, bundle);
  return JSON.stringify({ bundle: path, fingerprint: bundle.fingerprint,
    transactions: bundle.payload.transactions.map((transaction, index) => ({ index, label: transaction.label })) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOperator(process.argv.slice(2)).then(output => process.stdout.write(output + "\n"), error => {
    process.stderr.write(`${error instanceof Error ? error.message : "Operator command failed"}\n`);
    process.exitCode = 1;
  });
}
