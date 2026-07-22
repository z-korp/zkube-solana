import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
} from "@solana/web3.js";
import { SOLANA_DEVNET_GENESIS_HASH, ZKUBE_PROGRAM_ID } from "./constants";

interface DeploymentCommand {
  label: string;
  command: string;
  args: string[];
  cwd: string;
}

export interface DeploymentPreflight {
  programDataAddress: string;
  artifactBytes: number;
  allocationBytes: number;
  headroomBytes: number;
  programAccountRentLamports: number;
  programDataRentLamports: number;
  programBufferRentLamports: number;
  feePerSignatureLamports: number;
  maximumSignatures: number;
  maximumFeeLamports: number;
  maximumPayerSpendLamports: number;
  deployerReserveLamports: number;
  requiredDeployerBalanceLamports: number;
  currentDeployedSbfSha256: string | null;
  expectedPostDeploymentSbfSha256: string;
  currentProgramDataLamports: number;
}

export interface ZkubeDevnetDeploymentInput {
  cluster: "devnet";
  deploymentMode: "upgrade" | "initial";
  baseRpc: string;
  expectedGenesisHash: string;
  programId: string;
  workspaceDir: string;
  artifactPath: string;
  artifactSha256: string;
  artifactBytes: number;
  expectedCurrentSbfSha256?: string;
  programKeypairPath?: string;
  programKeypairPublicKey?: string;
  programBufferKeypairPath?: string;
  programBufferPublicKey?: string;
  deployerKeypairPath?: string;
  deployerPublicKey?: string;
  upgradeAuthorityKeypairPath?: string;
  upgradeAuthorityPublicKey?: string;
  deployerReserveLamports: number;
  commands: DeploymentCommand[];
  preflight?: DeploymentPreflight;
  approvalEvidenceSha256: string;
  approvalFingerprint: string;
  sendEnabled: boolean;
  suppliedApproval?: string;
}

interface DeploymentExecution {
  label: string;
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface ZkubeDevnetDeploymentResult {
  mode: "dry-run" | "deployed";
  input: ZkubeDevnetDeploymentInput;
  executions: DeploymentExecution[];
  deploymentSignature?: string;
}

const DEFAULT_BASE_RPC = "https://rpc.magicblock.app/devnet";
const PROGRAM_ACCOUNT_BYTES = 36;
const PROGRAM_DATA_HEADER_BYTES = 45;
const PROGRAM_BUFFER_HEADER_BYTES = 37;
const PROGRAM_ALLOCATION_HEADROOM_BYTES = 10_240;
const PROGRAM_WRITE_CHUNK_BOUND_BYTES = 512;
const DEFAULT_DEPLOYER_RESERVE_LAMPORTS = 100_000_000;
const MAXIMUM_DEPLOY_SIGN_ATTEMPTS = 1;
const UPGRADEABLE_LOADER_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
const EXECUTABLE_OWNERS = new Set([
  "BPFLoader1111111111111111111111111111111111",
  "BPFLoader2111111111111111111111111111111111",
  "BPFLoaderUpgradeab1e11111111111111111111111",
]);

/**
 * Parses only immutable local deployment inputs. The returned candidate is not
 * approvable until `prepareZkubeDevnetDeployment` binds current chain state,
 * rent, fees, ProgramData, reserve, and the frozen artifact into its fingerprint.
 */
export function devnetDeploymentInputFromEnv(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): ZkubeDevnetDeploymentInput {
  const cluster = env.ZKUBE_CLUSTER?.trim().toLowerCase() || "devnet";
  if (cluster !== "devnet") {
    throw new Error("zKube deployment currently accepts devnet only");
  }
  const deploymentMode = deploymentModeFromEnv(env.ZKUBE_DEPLOY_MODE);
  const baseRpc = devnetEndpoint(
    env.ZKUBE_BASE_RPC ??
      env.VITE_PUBLIC_SOLANA_RPC_ENDPOINT ??
      DEFAULT_BASE_RPC,
  );
  const expectedGenesisHash =
    env.ZKUBE_EXPECTED_GENESIS_HASH?.trim() ||
    env.VITE_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH?.trim() ||
    SOLANA_DEVNET_GENESIS_HASH;
  if (expectedGenesisHash !== SOLANA_DEVNET_GENESIS_HASH) {
    throw new Error(
      "ZKUBE_EXPECTED_GENESIS_HASH must be the Solana devnet genesis hash",
    );
  }
  const workspaceDir = resolvePath(cwd, env.ZKUBE_ANCHOR_WORKSPACE ?? "..");
  const artifactPath = resolvePath(
    cwd,
    env.ZKUBE_PROGRAM_ARTIFACT ?? "../target/deploy/solana.so",
  );
  const artifact = readFileSync(artifactPath);
  if (artifact.byteLength <= 0) {
    throw new Error("ZKUBE_PROGRAM_ARTIFACT must be a non-empty frozen SBF");
  }
  const artifactSha256 = createHash("sha256").update(artifact).digest("hex");
  const programKeypairPath = optionalPath(cwd, env.ZKUBE_PROGRAM_KEYPAIR);
  const programBufferKeypairPath = optionalPath(
    cwd,
    env.ZKUBE_PROGRAM_BUFFER_KEYPAIR,
  );
  const deployerKeypairPath = optionalPath(cwd, env.ZKUBE_DEPLOYER_KEYPAIR);
  const upgradeAuthorityKeypairPath = optionalPath(
    cwd,
    env.ZKUBE_UPGRADE_AUTHORITY_KEYPAIR,
  );
  const expectedCurrentSbfSha256 =
    deploymentMode === "upgrade"
      ? requiredSha256(
          env.ZKUBE_EXPECTED_CURRENT_SBF_SHA256,
          "ZKUBE_EXPECTED_CURRENT_SBF_SHA256",
        )
      : undefined;
  const programKeypairPublicKey = programKeypairPath
    ? keypairPublicKey(programKeypairPath, "ZKUBE_PROGRAM_KEYPAIR")
    : undefined;
  const programBufferPublicKey = programBufferKeypairPath
    ? keypairPublicKey(programBufferKeypairPath, "ZKUBE_PROGRAM_BUFFER_KEYPAIR")
    : optionalPublicKey(
        env.ZKUBE_PROGRAM_BUFFER_PUBLIC_KEY,
        "ZKUBE_PROGRAM_BUFFER_PUBLIC_KEY",
      );
  const deployerPublicKey = deployerKeypairPath
    ? keypairPublicKey(deployerKeypairPath, "ZKUBE_DEPLOYER_KEYPAIR")
    : optionalPublicKey(
        env.ZKUBE_DEPLOYER_PUBLIC_KEY,
        "ZKUBE_DEPLOYER_PUBLIC_KEY",
      );
  const upgradeAuthorityPublicKey = upgradeAuthorityKeypairPath
    ? keypairPublicKey(
        upgradeAuthorityKeypairPath,
        "ZKUBE_UPGRADE_AUTHORITY_KEYPAIR",
      )
    : optionalPublicKey(
        env.ZKUBE_UPGRADE_AUTHORITY_PUBLIC_KEY,
        "ZKUBE_UPGRADE_AUTHORITY_PUBLIC_KEY",
      );
  const deployerReserveLamports =
    optionalSafeInteger(
      env.ZKUBE_DEPLOYER_RESERVE_LAMPORTS,
      "ZKUBE_DEPLOYER_RESERVE_LAMPORTS",
    ) ?? DEFAULT_DEPLOYER_RESERVE_LAMPORTS;
  const commands = deploymentCommands({
    deploymentMode,
    workspaceDir,
    baseRpc,
    programId: ZKUBE_PROGRAM_ID.toBase58(),
    artifactPath,
    allocationBytes:
      deploymentMode === "initial"
        ? checkedAdd(artifact.byteLength, PROGRAM_ALLOCATION_HEADROOM_BYTES)
        : artifact.byteLength,
    programKeypairPath,
    programBufferKeypairPath,
    deployerKeypairPath,
    upgradeAuthorityKeypairPath,
  });

  return {
    cluster: "devnet",
    deploymentMode,
    baseRpc,
    expectedGenesisHash,
    programId: ZKUBE_PROGRAM_ID.toBase58(),
    workspaceDir,
    artifactPath,
    artifactSha256,
    artifactBytes: artifact.byteLength,
    expectedCurrentSbfSha256,
    programKeypairPath,
    programKeypairPublicKey,
    programBufferKeypairPath,
    programBufferPublicKey,
    deployerKeypairPath,
    deployerPublicKey,
    upgradeAuthorityKeypairPath,
    upgradeAuthorityPublicKey,
    deployerReserveLamports,
    commands,
    approvalEvidenceSha256: "unprepared",
    approvalFingerprint: "unprepared",
    sendEnabled: env.ZKUBE_DEPLOY === "1",
    suppliedApproval: env.ZKUBE_DEPLOY_APPROVAL?.trim() || undefined,
  };
}

/** Read-only chain preflight. No keypair is required and no transaction is built. */
export async function prepareZkubeDevnetDeployment(
  candidate: ZkubeDevnetDeploymentInput,
  connection: Connection = new Connection(candidate.baseRpc, "confirmed"),
): Promise<ZkubeDevnetDeploymentInput> {
  assertFrozenArtifact(candidate);
  const genesisHash = await connection.getGenesisHash();
  if (genesisHash !== candidate.expectedGenesisHash) {
    throw new Error(`Devnet genesis mismatch: received ${genesisHash}`);
  }
  if (!candidate.deployerPublicKey) {
    throw new Error(
      "ZKUBE_DEPLOYER_KEYPAIR or ZKUBE_DEPLOYER_PUBLIC_KEY is required for an approvable preflight",
    );
  }
  if (!candidate.programBufferPublicKey) {
    throw new Error(
      "ZKUBE_PROGRAM_BUFFER_KEYPAIR is required for an approvable bounded deployment",
    );
  }
  const programId = new PublicKey(candidate.programId);
  const programBuffer = new PublicKey(candidate.programBufferPublicKey);
  const bufferInfo = await connection.getAccountInfo(
    programBuffer,
    "confirmed",
  );
  if (bufferInfo) {
    throw new Error(
      "approved program buffer is occupied; create a new deployment bundle",
    );
  }

  const derivedProgramDataAddress = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    UPGRADEABLE_LOADER_ID,
  )[0];
  let allocationBytes: number;
  let currentProgramDataLamports = 0;
  let currentDeployedSbfSha256: string | null = null;
  let programDataAddress = derivedProgramDataAddress;
  if (candidate.deploymentMode === "initial") {
    if (!candidate.programKeypairPublicKey) {
      throw new Error(
        "ZKUBE_PROGRAM_KEYPAIR is required for an initial deployment preflight",
      );
    }
    if (candidate.programKeypairPublicKey !== candidate.programId) {
      throw new Error(
        `program key ${candidate.programKeypairPublicKey} does not match declared program ${candidate.programId}`,
      );
    }
    const [program, programData] = await Promise.all([
      connection.getAccountInfo(programId, "confirmed"),
      connection.getAccountInfo(derivedProgramDataAddress, "confirmed"),
    ]);
    if (program || programData) {
      throw new Error(
        "initial deployment blocked: fresh Program or ProgramData address is occupied",
      );
    }
    allocationBytes = checkedAdd(
      candidate.artifactBytes,
      PROGRAM_ALLOCATION_HEADROOM_BYTES,
    );
  } else {
    const state = await inspectUpgradeableProgram(connection, programId);
    programDataAddress = state.programDataAddress;
    allocationBytes = state.programCapacityBytes;
    currentProgramDataLamports = state.programDataLamports;
    currentDeployedSbfSha256 = state.deployedSbfSha256;
    if (state.deployedSbfSha256 !== candidate.expectedCurrentSbfSha256) {
      throw new Error(
        `deployed SBF hash ${state.deployedSbfSha256} does not match approved preimage ${candidate.expectedCurrentSbfSha256 ?? "missing"}`,
      );
    }
    if (!state.upgradeAuthority) {
      throw new Error("deployed program is immutable and cannot be upgraded");
    }
    if (state.upgradeAuthority !== candidate.upgradeAuthorityPublicKey) {
      throw new Error(
        `upgrade authority ${candidate.upgradeAuthorityPublicKey ?? "missing"} does not match deployed authority ${state.upgradeAuthority}`,
      );
    }
    if (candidate.artifactBytes > allocationBytes) {
      throw new Error(
        `program upgrade requires ${candidate.artifactBytes - allocationBytes} additional ProgramData bytes; approve and execute a separate extension first`,
      );
    }
  }

  const [
    programAccountRentLamports,
    programDataRentLamports,
    programBufferRentLamports,
  ] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(
      PROGRAM_ACCOUNT_BYTES,
      "confirmed",
    ),
    connection.getMinimumBalanceForRentExemption(
      checkedAdd(PROGRAM_DATA_HEADER_BYTES, allocationBytes),
      "confirmed",
    ),
    connection.getMinimumBalanceForRentExemption(
      checkedAdd(PROGRAM_BUFFER_HEADER_BYTES, candidate.artifactBytes),
      "confirmed",
    ),
  ]);
  if (
    candidate.deploymentMode === "upgrade" &&
    currentProgramDataLamports < programDataRentLamports
  ) {
    throw new Error("deployed ProgramData is below its current rent floor");
  }
  const feePerSignatureLamports = await liveFeePerSignature(
    connection,
    new PublicKey(candidate.deployerPublicKey),
  );
  const writeTransactions = Math.ceil(
    candidate.artifactBytes / PROGRAM_WRITE_CHUNK_BOUND_BYTES,
  );
  const maximumSignatures =
    2 +
    writeTransactions * 2 +
    (candidate.deploymentMode === "initial" ? 4 : 3);
  const maximumFeeLamports = checkedMultiply(
    feePerSignatureLamports,
    maximumSignatures,
  );
  const newAccountRentLamports =
    candidate.deploymentMode === "initial"
      ? checkedAdd(programAccountRentLamports, programDataRentLamports)
      : 0;
  const maximumPayerSpendLamports = checkedAdd(
    checkedAdd(newAccountRentLamports, programBufferRentLamports),
    maximumFeeLamports,
  );
  const requiredDeployerBalanceLamports = checkedAdd(
    maximumPayerSpendLamports,
    candidate.deployerReserveLamports,
  );
  const deployerBalance = await connection.getBalance(
    new PublicKey(candidate.deployerPublicKey),
    "confirmed",
  );
  if (deployerBalance < requiredDeployerBalanceLamports) {
    throw new Error(
      `deployer balance ${deployerBalance} is below dynamic deployment floor ${requiredDeployerBalanceLamports}`,
    );
  }
  const artifact = readFileSync(candidate.artifactPath);
  const expectedPostDeploymentSbfSha256 = hashPaddedArtifact(
    artifact,
    allocationBytes,
  );
  const preflight: DeploymentPreflight = {
    programDataAddress: programDataAddress.toBase58(),
    artifactBytes: candidate.artifactBytes,
    allocationBytes,
    headroomBytes: allocationBytes - candidate.artifactBytes,
    programAccountRentLamports,
    programDataRentLamports,
    programBufferRentLamports,
    feePerSignatureLamports,
    maximumSignatures,
    maximumFeeLamports,
    maximumPayerSpendLamports,
    deployerReserveLamports: candidate.deployerReserveLamports,
    requiredDeployerBalanceLamports,
    currentDeployedSbfSha256,
    expectedPostDeploymentSbfSha256,
    currentProgramDataLamports,
  };
  const commands = deploymentCommands({
    deploymentMode: candidate.deploymentMode,
    workspaceDir: candidate.workspaceDir,
    baseRpc: candidate.baseRpc,
    programId: candidate.programId,
    artifactPath: candidate.artifactPath,
    allocationBytes,
    programKeypairPath: candidate.programKeypairPath,
    programBufferKeypairPath: candidate.programBufferKeypairPath,
    deployerKeypairPath: candidate.deployerKeypairPath,
    upgradeAuthorityKeypairPath: candidate.upgradeAuthorityKeypairPath,
  });
  const approvalEvidenceSha256 = createHash("sha256")
    .update(
      JSON.stringify({
        operation: "deploy-frozen-zkube-program",
        cluster: candidate.cluster,
        deploymentMode: candidate.deploymentMode,
        baseRpc: candidate.baseRpc,
        expectedGenesisHash: candidate.expectedGenesisHash,
        programId: candidate.programId,
        artifactSha256: candidate.artifactSha256,
        preflight,
        programKeypairPublicKey: candidate.programKeypairPublicKey ?? null,
        programBufferPublicKey: candidate.programBufferPublicKey,
        deployerPublicKey: candidate.deployerPublicKey,
        upgradeAuthorityPublicKey: candidate.upgradeAuthorityPublicKey ?? null,
        commands: commands.map((command) => publicCommand(command, candidate)),
        policy: {
          artifactBuildAfterApproval: false,
          keypairCopy: false,
          mainnetDisabled: true,
          preflightSkipping: false,
          maximumDeploySignAttempts: MAXIMUM_DEPLOY_SIGN_ATTEMPTS,
        },
      }),
    )
    .digest("hex");
  return {
    ...candidate,
    commands,
    preflight,
    approvalEvidenceSha256,
    approvalFingerprint: approvalEvidenceSha256.slice(0, 16),
  };
}

export async function runZkubeDevnetDeployment(
  candidate: ZkubeDevnetDeploymentInput,
): Promise<ZkubeDevnetDeploymentResult> {
  const input = await prepareZkubeDevnetDeployment(candidate);
  if (!input.sendEnabled) return { mode: "dry-run", input, executions: [] };
  if (input.suppliedApproval !== input.approvalFingerprint) {
    throw new Error(
      `deployment blocked: set ZKUBE_DEPLOY_APPROVAL=${input.approvalFingerprint} after explicit approval`,
    );
  }
  if (
    !input.deployerKeypairPath ||
    !input.deployerPublicKey ||
    !input.programBufferKeypairPath ||
    !input.programBufferPublicKey ||
    !input.upgradeAuthorityKeypairPath ||
    !input.upgradeAuthorityPublicKey
  ) {
    throw new Error(
      "deployment requires deployer, buffer, and upgrade-authority keypairs after approval",
    );
  }
  if (
    keypairPublicKey(input.deployerKeypairPath, "ZKUBE_DEPLOYER_KEYPAIR") !==
      input.deployerPublicKey ||
    keypairPublicKey(
      input.programBufferKeypairPath,
      "ZKUBE_PROGRAM_BUFFER_KEYPAIR",
    ) !== input.programBufferPublicKey ||
    keypairPublicKey(
      input.upgradeAuthorityKeypairPath,
      "ZKUBE_UPGRADE_AUTHORITY_KEYPAIR",
    ) !== input.upgradeAuthorityPublicKey
  ) {
    throw new Error("a deployment signer changed after approval");
  }
  if (
    input.deploymentMode === "initial" &&
    (!input.programKeypairPath ||
      keypairPublicKey(input.programKeypairPath, "ZKUBE_PROGRAM_KEYPAIR") !==
        input.programId)
  ) {
    throw new Error("the initial program keypair changed after approval");
  }
  assertFrozenArtifact(input);

  const executions: DeploymentExecution[] = [];
  for (const planned of input.commands) {
    // The approved artifact is never rebuilt or copied into the workspace.
    assertFrozenArtifact(input);
    const result = spawnSync(planned.command, planned.args, {
      cwd: planned.cwd,
      encoding: "utf8",
      env: { ...process.env, NO_DNA: "1" },
    });
    const execution = {
      label: planned.label,
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
    executions.push(execution);
    if (execution.status !== 0) {
      throw new Error(
        `${planned.label} failed: ${execution.stderr.trim() || `exit ${String(execution.status)}`}`,
      );
    }
  }

  const connection = new Connection(input.baseRpc, "confirmed");
  const info = await connection.getAccountInfo(ZKUBE_PROGRAM_ID, "confirmed");
  if (!info?.executable || !EXECUTABLE_OWNERS.has(info.owner.toBase58())) {
    throw new Error(
      "deployed program account failed executable owner verification",
    );
  }
  const deployed = await inspectUpgradeableProgram(
    connection,
    ZKUBE_PROGRAM_ID,
  );
  if (
    deployed.programDataAddress.toBase58() !==
      input.preflight?.programDataAddress ||
    deployed.programCapacityBytes !== input.preflight.allocationBytes ||
    deployed.deployedSbfSha256 !==
      input.preflight.expectedPostDeploymentSbfSha256 ||
    deployed.upgradeAuthority !== input.upgradeAuthorityPublicKey
  ) {
    throw new Error("post-deployment ProgramData binding verification failed");
  }
  const remainingBuffer = await connection.getAccountInfo(
    new PublicKey(input.programBufferPublicKey),
    "confirmed",
  );
  if (remainingBuffer) {
    throw new Error("successful deployment left the approved buffer open");
  }
  const finalBalance = await connection.getBalance(
    new PublicKey(input.deployerPublicKey),
    "confirmed",
  );
  if (finalBalance < input.deployerReserveLamports) {
    throw new Error("deployment breached the approved deployer reserve");
  }
  const deploymentSignature = deploymentSignatureFromExecutions(executions);
  return {
    mode: "deployed",
    input,
    executions,
    ...(deploymentSignature ? { deploymentSignature } : {}),
  };
}

export function deploymentSignatureFromExecutions(
  executions: ReadonlyArray<{ stdout: string; stderr: string }>,
): string | undefined {
  const outputs = executions.flatMap(({ stdout, stderr }) => [stdout, stderr]);
  for (const output of outputs) {
    const trimmed = output.trim();
    if (!trimmed) continue;
    try {
      const value: unknown = JSON.parse(trimmed);
      if (
        typeof value === "object" &&
        value !== null &&
        "signature" in value &&
        validTransactionSignature(value.signature)
      ) {
        return value.signature;
      }
    } catch {
      // Non-JSON Solana CLI output is handled by the bounded text fallback.
    }
    const textSignature = trimmed.match(
      /Signature:\s*([1-9A-HJ-NP-Za-km-z]{64,128})/,
    )?.[1];
    if (textSignature) return textSignature;
  }
  return undefined;
}

function validTransactionSignature(value: unknown): value is string {
  return (
    typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,128}$/.test(value)
  );
}

export function formatDevnetDeployment(
  result: ZkubeDevnetDeploymentResult,
): string {
  const { input } = result;
  const preflight = input.preflight;
  const executable = executableDeploymentInput(input);
  return [
    "zKube Devnet deployment",
    `Mode: ${result.mode}`,
    `Deployment operation: ${input.deploymentMode}`,
    `Base RPC: ${input.baseRpc}`,
    `Program: ${input.programId}`,
    `ProgramData: ${preflight?.programDataAddress ?? "preflight required"}`,
    `Frozen SBF SHA-256: ${input.artifactSha256}`,
    `Artifact/allocation: ${input.artifactBytes}/${preflight?.allocationBytes ?? "preflight required"} bytes`,
    `Allocation headroom: ${preflight?.headroomBytes ?? "preflight required"} bytes`,
    `Current deployed SBF SHA-256: ${preflight?.currentDeployedSbfSha256 ?? "not applicable"}`,
    `Expected padded SBF SHA-256: ${preflight?.expectedPostDeploymentSbfSha256 ?? "preflight required"}`,
    `Program rent: ${preflight?.programAccountRentLamports ?? "preflight required"} lamports`,
    `ProgramData rent: ${preflight?.programDataRentLamports ?? "preflight required"} lamports`,
    `Temporary buffer rent: ${preflight?.programBufferRentLamports ?? "preflight required"} lamports`,
    `Maximum dynamic fees: ${preflight?.maximumFeeLamports ?? "preflight required"} lamports`,
    `Maximum payer spend: ${preflight?.maximumPayerSpendLamports ?? "preflight required"} lamports`,
    `Post-deployment reserve: ${input.deployerReserveLamports} lamports`,
    `Required deployer balance: ${preflight?.requiredDeployerBalanceLamports ?? "preflight required"} lamports`,
    `Maximum signing attempts: ${MAXIMUM_DEPLOY_SIGN_ATTEMPTS}`,
    `Program deployment key: ${input.programKeypairPublicKey ?? "not applicable"}`,
    `Program buffer: ${input.programBufferPublicKey ?? "missing"}`,
    `Deployer: ${input.deployerPublicKey ?? "missing"}`,
    `Upgrade authority: ${input.upgradeAuthorityPublicKey ?? "missing"}`,
    `Approval fingerprint: ${input.approvalFingerprint}`,
    `Approval evidence SHA-256: ${input.approvalEvidenceSha256}`,
    `Executable plan: ${executable ? "yes" : "no"}`,
    "Artifact rebuild after approval: disabled",
    "Keypair copying: disabled",
    "Preflight skipping: disabled",
    ...input.commands.map((command) => {
      const visible = publicCommand(command, input);
      return `[${result.mode === "dry-run" ? "planned" : "executed"}] ${visible.label}: ${visible.command} ${visible.args.join(" ")}`;
    }),
    ...(result.deploymentSignature
      ? [`Deployment signature: ${result.deploymentSignature}`]
      : []),
    ...(result.mode === "dry-run"
      ? executable
        ? [
            "No transaction was signed or sent.",
            "Set ZKUBE_DEPLOY=1 only after approval of this exact fingerprint.",
          ]
        : [
            "No transaction was signed or sent.",
            "Candidate only: required signer identity is missing. Do not approve this fingerprint.",
          ]
      : []),
  ].join("\n");
}

function executableDeploymentInput(input: ZkubeDevnetDeploymentInput): boolean {
  if (
    !input.preflight ||
    !input.deployerKeypairPath ||
    !input.deployerPublicKey ||
    !input.programBufferKeypairPath ||
    !input.programBufferPublicKey ||
    !input.upgradeAuthorityKeypairPath ||
    !input.upgradeAuthorityPublicKey
  ) {
    return false;
  }
  return (
    input.deploymentMode === "upgrade" ||
    Boolean(
      input.programKeypairPath &&
      input.programKeypairPublicKey === input.programId,
    )
  );
}

function deploymentCommands(args: {
  workspaceDir: string;
  deploymentMode: "upgrade" | "initial";
  baseRpc: string;
  programId: string;
  artifactPath: string;
  allocationBytes: number;
  programKeypairPath?: string;
  programBufferKeypairPath?: string;
  deployerKeypairPath?: string;
  upgradeAuthorityKeypairPath?: string;
}): DeploymentCommand[] {
  const deployArgs = [
    "program",
    "deploy",
    args.artifactPath,
    "--max-len",
    String(args.allocationBytes),
    "--no-auto-extend",
    "--url",
    args.baseRpc,
    "--output",
    "json",
    "--max-sign-attempts",
    String(MAXIMUM_DEPLOY_SIGN_ATTEMPTS),
  ];
  if (args.deploymentMode === "upgrade") {
    deployArgs.push("--program-id", args.programId);
  } else if (args.programKeypairPath) {
    deployArgs.push("--program-id", args.programKeypairPath);
  }
  if (args.programBufferKeypairPath) {
    deployArgs.push("--buffer", args.programBufferKeypairPath);
  }
  if (args.upgradeAuthorityKeypairPath) {
    deployArgs.push("--upgrade-authority", args.upgradeAuthorityKeypairPath);
  }
  if (args.deployerKeypairPath) {
    deployArgs.push(
      "--keypair",
      args.deployerKeypairPath,
      "--fee-payer",
      args.deployerKeypairPath,
    );
  }
  return [
    {
      label:
        args.deploymentMode === "initial"
          ? "Deploy frozen Solana program"
          : "Upgrade from frozen Solana program",
      command: "solana",
      args: deployArgs,
      cwd: args.workspaceDir,
    },
    verificationCommand(args),
  ];
}

function verificationCommand(args: {
  workspaceDir: string;
  baseRpc: string;
  programId: string;
}): DeploymentCommand {
  return {
    label: "Verify deployed program",
    command: "solana",
    args: [
      "account",
      args.programId,
      "--url",
      args.baseRpc,
      "--output",
      "json",
    ],
    cwd: args.workspaceDir,
  };
}

function publicCommand(
  command: DeploymentCommand,
  paths: {
    artifactPath?: string;
    programKeypairPath?: string;
    programBufferKeypairPath?: string;
    deployerKeypairPath?: string;
    upgradeAuthorityKeypairPath?: string;
  },
): Pick<DeploymentCommand, "label" | "command" | "args"> {
  const secrets = new Map<string, string>();
  for (const [path, label] of [
    [paths.artifactPath, "<program-artifact>"],
    [paths.programKeypairPath, "<program-keypair>"],
    [paths.programBufferKeypairPath, "<program-buffer-keypair>"],
    [paths.deployerKeypairPath, "<deployer-keypair>"],
    [paths.upgradeAuthorityKeypairPath, "<upgrade-authority-keypair>"],
  ] as const) {
    if (path) secrets.set(path, label);
  }
  return {
    label: command.label,
    command: command.command,
    args: command.args.map((argument) => secrets.get(argument) ?? argument),
  };
}

export interface UpgradeableProgramState {
  programDataAddress: PublicKey;
  programCapacityBytes: number;
  programDataLamports: number;
  upgradeAuthority: string | null;
  deployedSbfSha256: string;
}

export async function inspectUpgradeableProgram(
  connection: Connection,
  programId: PublicKey,
): Promise<UpgradeableProgramState> {
  const program = await connection.getAccountInfo(programId, "confirmed");
  if (
    !program ||
    !program.executable ||
    !program.owner.equals(UPGRADEABLE_LOADER_ID) ||
    program.data.length !== PROGRAM_ACCOUNT_BYTES ||
    program.data.readUInt32LE(0) !== 2
  ) {
    throw new Error(
      "declared program is not an upgradeable-loader Program account",
    );
  }
  const programDataAddress = new PublicKey(program.data.subarray(4, 36));
  const expectedProgramDataAddress = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    UPGRADEABLE_LOADER_ID,
  )[0];
  if (!programDataAddress.equals(expectedProgramDataAddress)) {
    throw new Error("Program points to a noncanonical ProgramData address");
  }
  const info = await connection.getAccountInfo(programDataAddress, "confirmed");
  if (
    !info ||
    !info.owner.equals(UPGRADEABLE_LOADER_ID) ||
    info.executable ||
    info.data.length < PROGRAM_DATA_HEADER_BYTES ||
    info.data.readUInt32LE(0) !== 3
  ) {
    throw new Error("deployed ProgramData account is missing or malformed");
  }
  if (info.data[12] !== 0 && info.data[12] !== 1) {
    throw new Error("deployed upgrade authority option is malformed");
  }
  const upgradeAuthority =
    info.data[12] === 1
      ? new PublicKey(info.data.subarray(13, 45)).toBase58()
      : null;
  return {
    programDataAddress,
    programCapacityBytes: info.data.length - PROGRAM_DATA_HEADER_BYTES,
    programDataLamports: info.lamports,
    upgradeAuthority,
    deployedSbfSha256: createHash("sha256")
      .update(info.data.subarray(PROGRAM_DATA_HEADER_BYTES))
      .digest("hex"),
  };
}

async function liveFeePerSignature(
  connection: Connection,
  payer: PublicKey,
): Promise<number> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: latest.blockhash,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: payer,
        lamports: 0,
      }),
    ],
  }).compileToLegacyMessage();
  const fee = await connection.getFeeForMessage(message, "confirmed");
  if (
    fee.value === null ||
    !Number.isSafeInteger(fee.value) ||
    fee.value <= 0
  ) {
    throw new Error("unable to obtain the current Devnet signature fee");
  }
  return fee.value;
}

function assertFrozenArtifact(input: ZkubeDevnetDeploymentInput): void {
  const artifact = readFileSync(input.artifactPath);
  if (
    artifact.byteLength !== input.artifactBytes ||
    createHash("sha256").update(artifact).digest("hex") !== input.artifactSha256
  ) {
    throw new Error("approved frozen program artifact changed");
  }
}

function hashPaddedArtifact(
  artifact: Uint8Array,
  allocationBytes: number,
): string {
  if (artifact.byteLength > allocationBytes) {
    throw new Error("artifact exceeds its approved ProgramData allocation");
  }
  return createHash("sha256")
    .update(artifact)
    .update(Buffer.alloc(allocationBytes - artifact.byteLength))
    .digest("hex");
}

function requiredSha256(value: string | undefined, label: string): string {
  const hash = value?.trim().toLowerCase() ?? "";
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error(`${label} must be a 64-hex SHA-256`);
  }
  return hash;
}

function optionalSafeInteger(
  value: string | undefined,
  label: string,
): number | undefined {
  const source = value?.trim();
  if (!source) return undefined;
  const parsed = Number(source);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return parsed;
}

function deploymentModeFromEnv(
  value: string | undefined,
): "upgrade" | "initial" {
  const mode = value?.trim().toLowerCase();
  if (mode !== "upgrade" && mode !== "initial") {
    throw new Error(
      "ZKUBE_DEPLOY_MODE is required and must be upgrade or initial",
    );
  }
  return mode;
}

function keypairPublicKey(path: string, label: string): string {
  let source: unknown;
  try {
    source = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${(error as Error).message}`);
  }
  if (
    !Array.isArray(source) ||
    source.length !== 64 ||
    !source.every(
      (value) => Number.isInteger(value) && value >= 0 && value <= 255,
    )
  ) {
    throw new Error(`${label} must be a Solana 64-byte keypair JSON array`);
  }
  return Keypair.fromSecretKey(
    Uint8Array.from(source as number[]),
  ).publicKey.toBase58();
}

function optionalPublicKey(
  value: string | undefined,
  label: string,
): string | undefined {
  const source = value?.trim();
  if (!source) return undefined;
  try {
    const publicKey = new PublicKey(source);
    if (publicKey.equals(PublicKey.default)) throw new Error("zero key");
    return publicKey.toBase58();
  } catch {
    throw new Error(`${label} must be a nonzero Solana public key`);
  }
}

function devnetEndpoint(value: string): string {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "https:") {
    throw new Error("Devnet deployment RPC must use HTTPS");
  }
  if (/mainnet|localhost|127\.0\.0\.1|localnet/i.test(value)) {
    throw new Error("Devnet deployment RPC cannot target mainnet or localhost");
  }
  return endpoint.toString().replace(/\/$/, "");
}

function resolvePath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function optionalPath(
  cwd: string,
  path: string | undefined,
): string | undefined {
  const value = path?.trim();
  return value ? resolvePath(cwd, value) : undefined;
}

function checkedAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("deployment lamport/size addition overflow");
  }
  return value;
}

function checkedMultiply(left: number, right: number): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("deployment lamport multiplication overflow");
  }
  return value;
}
