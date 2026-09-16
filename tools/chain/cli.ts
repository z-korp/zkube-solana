import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { SOLANA_ENDPOINT, ZKUBE_PROGRAM_ID } from "../../shared/chain.js";
import { assertDevnetRelease, devnetConnection, requireHash, requireInteger, sha256 } from "./chainRelease.js";
import { deploymentRelease, deploymentRentSpaces, type DeploymentInput } from "./deploymentPlan.js";
import { launchPlannerInputFromEnv } from "./launchPlanner.js";
import { quoteBundle, quoteLaunch, readBundle } from "./operatorPlan.js";
import { executeBundle } from "./operatorRuntime.js";
import { observeDeposits, readGovernance } from "./operatorState.js";
import { loadPinnedKeypair, saveBundle } from "./operatorTransaction.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const HELP = `zKube Devnet operator
  plan deploy --bundle build/chain/deploy.json
  plan launch --bundle build/chain/launch.json
  plan top-up --launch-bundle build/chain/launch.json --top-up daily:current:1SOL --bundle build/chain/top-up.json
  plan set-suspension --launch-bundle build/chain/launch.json --until-day <day> --bundle build/chain/suspension.json
  execute --bundle <path> [--until <inclusive transaction index>]

Planning reads public state and writes one fingerprinted bundle. It loads no keypair.
All plans accept SOLANA_DEVNET_RPC_URL (default: the shared Devnet endpoint).
Deploy inputs: ZKUBE_SBF_PATH, ZKUBE_SBF_SHA256, ZKUBE_DEPLOYER_PUBLIC_KEY,
  ZKUBE_PROGRAM_BUFFER_PUBLIC_KEY, ZKUBE_PROGRAM_UPGRADE_AUTHORITY.
Launch inputs: ZKUBE_CLUSTER=devnet, ZKUBE_DEPLOYER_PUBLIC_KEY,
  ZKUBE_PROTOCOL_AUTHORITY, ZKUBE_TEAM_DESTINATION, ZKUBE_LAUNCH_DAY_ID,
  ZKUBE_LAUNCH_CUTOFF_UNIX, ZKUBE_DEPLOYED_PROGRAM_DATA_SHA256,
  ZKUBE_PROGRAM_ALLOCATION_BYTES, ZKUBE_PROGRAM_UPGRADE_AUTHORITY,
  ZKUBE_KEEPER_RELEASE_FINGERPRINT.
Execution requires ZKUBE_APPROVAL=<printed fingerprint>. Signer file mappings:
  ZKUBE_SIGNER_PATHS='{"<approved public key>":"<existing keypair path>"}'.
Activation also requires ZKUBE_KEEPER_STAGED_RELEASE_FINGERPRINT.
--until stops after an inclusive index; resume the same bundle to continue.
No program upgrade command is implemented before a deployment exists.`;

type Env = Record<string, string | undefined>;
function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function parseOperatorArgs(args: string[]) {
  if (args.includes("--help") || !args.length) return { help: true as const };
  const mode = args.shift();
  if (mode !== "plan" && mode !== "execute") throw new Error("Use plan or execute");
  const operation = mode === "plan" ? args.shift() : undefined;
  if (mode === "plan" && !["deploy", "launch", "top-up", "set-suspension"].includes(operation ?? "")) {
    throw new Error("Choose deploy, launch, top-up or set-suspension");
  }
  const options: Record<string, string[]> = {};
  while (args.length) {
    const option = args.shift()!;
    const value = args.shift();
    if (!["--bundle", "--until", "--launch-bundle", "--top-up", "--until-day"].includes(option) ||
        !value || value.startsWith("--")) throw new Error(`Invalid option ${option}`);
    if (option !== "--top-up" && options[option]) throw new Error(`Duplicate option ${option}`);
    (options[option] ??= []).push(value);
  }
  const allowed = mode === "execute" ? ["--bundle", "--until"] : operation === "top-up"
    ? ["--bundle", "--launch-bundle", "--top-up"] : operation === "set-suspension"
      ? ["--bundle", "--launch-bundle", "--until-day"] : ["--bundle"];
  if (Object.keys(options).some(key => !allowed.includes(key))) throw new Error("Option is not valid for this command");
  const bundle = options["--bundle"]?.[0];
  if (!bundle) throw new Error("--bundle is required");
  return { help: false as const, mode, operation, options, bundle: resolve(ROOT, bundle) };
}

export function parseDeposit(value: string): { selector: string; lamports: string } {
  const match = /^daily:(current|following|\d+):(.+)$/.exec(value);
  if (!match) throw new Error("Top-up format is daily:<current|following|day>:<amount>SOL or lamports");
  const sol = /^(0|[1-9]\d*)(?:\.(\d{1,9}))?SOL$/i.exec(match[2]!);
  const raw = /^([1-9]\d*)lamports$/i.exec(match[2]!);
  if (!sol && !raw) throw new Error("Amount requires an explicit SOL or lamports suffix");
  const amount = sol ? BigInt(sol[1]!) * 1_000_000_000n + BigInt((sol[2] ?? "").padEnd(9, "0")) : BigInt(raw![1]!);
  if (amount <= 0n || amount > 0xffff_ffff_ffff_ffffn) throw new Error("Amount must fit in a positive u64");
  return { selector: match[1]!, lamports: amount.toString() };
}

export async function runOperator(args: string[], env: Env = process.env) {
  const command = parseOperatorArgs([...args]);
  if (command.help) return HELP;
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
    const artifactPath = resolve(ROOT, required(env, "ZKUBE_SBF_PATH"));
    const artifact = readFileSync(artifactPath);
    const artifactSha256 = requireHash(required(env, "ZKUBE_SBF_SHA256"), "Frozen SBF hash");
    if (sha256(artifact) !== artifactSha256) throw new Error("Frozen artifact hash differs from release input");
    const rents = await Promise.all(deploymentRentSpaces(artifact.length).map(size => connection.getMinimumBalanceForRentExemption(size, "confirmed")));
    const input: DeploymentInput = { artifactPath, artifactSha256, artifactBytes: artifact.length,
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
  } else if (command.operation === "launch") {
    bundle = await quoteLaunch(launchPlannerInputFromEnv({ ...env, SOLANA_DEVNET_RPC_URL: rpc }), connection);
  } else {
    const launchPath = options["--launch-bundle"]?.[0];
    if (!launchPath) throw new Error("--launch-bundle is required");
    const launch = readBundle(readFileSync(resolve(ROOT, launchPath), "utf8"));
    if (launch.payload.operation.kind !== "launch") throw new Error("Release input must be a launch bundle");
    const release = { ...launch.payload.release, rpc };
    const { authority, launchDayId } = launch.payload.operation.input;
    await assertDevnetRelease(connection, release);
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
