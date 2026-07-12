import { createHash } from "node:crypto";
import { copyFileSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { SOLANA_DEVNET_GENESIS_HASH, ZKUBE_PROGRAM_ID } from "./constants";

export interface DeploymentCommand {
  label: string;
  command: string;
  args: string[];
  cwd: string;
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
  programKeypairPath?: string;
  programKeypairPublicKey?: string;
  programBufferKeypairPath?: string;
  programBufferPublicKey?: string;
  deployerKeypairPath?: string;
  deployerPublicKey?: string;
  upgradeAuthorityKeypairPath?: string;
  upgradeAuthorityPublicKey?: string;
  commands: DeploymentCommand[];
  approvalFingerprint: string;
  sendEnabled: boolean;
  suppliedApproval?: string;
}

export interface DeploymentExecution {
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

const PROGRAM_KEYPAIR_TARGET = "target/deploy/solana-keypair.json";
const DEFAULT_BASE_RPC = "https://rpc.magicblock.app/devnet";
const PROGRAM_DATA_HEADER_BYTES = 45;
const MINIMUM_DEPLOY_FEE_HEADROOM_LAMPORTS = 50_000_000;
const EXECUTABLE_OWNERS = new Set([
  "BPFLoader1111111111111111111111111111111111",
  "BPFLoader2111111111111111111111111111111111",
  "BPFLoaderUpgradeab1e11111111111111111111111",
]);

export function devnetDeploymentInputFromEnv(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): ZkubeDevnetDeploymentInput {
  const cluster = env.ZKUBE_CLUSTER?.trim().toLowerCase() || "devnet";
  if (cluster !== "devnet")
    throw new Error("zKube deployment currently accepts devnet only");
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
  const workspaceDir = resolvePath(
    cwd,
    env.ZKUBE_ANCHOR_WORKSPACE ?? "../solana",
  );
  const artifactPath = resolvePath(
    cwd,
    env.ZKUBE_PROGRAM_ARTIFACT ?? "../solana/target/deploy/solana.so",
  );
  const artifactSha256 = fileSha256(artifactPath);
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
  const deploymentMode = deploymentModeFromEnv(env.ZKUBE_DEPLOY_MODE);
  const programKeypairPublicKey = programKeypairPath
    ? keypairPublicKey(programKeypairPath, "ZKUBE_PROGRAM_KEYPAIR")
    : undefined;
  const programBufferPublicKey = programBufferKeypairPath
    ? keypairPublicKey(programBufferKeypairPath, "ZKUBE_PROGRAM_BUFFER_KEYPAIR")
    : undefined;
  const deployerPublicKey = deployerKeypairPath
    ? keypairPublicKey(deployerKeypairPath, "ZKUBE_DEPLOYER_KEYPAIR")
    : undefined;
  const upgradeAuthorityPublicKey = upgradeAuthorityKeypairPath
    ? keypairPublicKey(
        upgradeAuthorityKeypairPath,
        "ZKUBE_UPGRADE_AUTHORITY_KEYPAIR",
      )
    : undefined;
  const commands = deploymentCommands({
    deploymentMode,
    workspaceDir,
    baseRpc,
    programId: ZKUBE_PROGRAM_ID.toBase58(),
    artifactPath,
    artifactBytes: readFileSync(artifactPath).byteLength,
    programKeypairPath,
    programBufferKeypairPath,
    deployerKeypairPath,
    upgradeAuthorityKeypairPath,
  });
  const approvalPayload = {
    cluster: "devnet",
    deploymentMode,
    baseRpc,
    expectedGenesisHash,
    programId: ZKUBE_PROGRAM_ID.toBase58(),
    artifactSha256,
    programKeypairPublicKey: programKeypairPublicKey ?? null,
    programBufferPublicKey: programBufferPublicKey ?? null,
    deployerPublicKey: deployerPublicKey ?? null,
    upgradeAuthorityPublicKey: upgradeAuthorityPublicKey ?? null,
    commands: commands.map((command) =>
      publicCommand(command, {
        artifactPath,
        programKeypairPath,
        programBufferKeypairPath,
        deployerKeypairPath,
        upgradeAuthorityKeypairPath,
      }),
    ),
    policy: {
      mainnetDisabled: true,
      skipPreflight: false,
      minimumDeployFeeHeadroomLamports: MINIMUM_DEPLOY_FEE_HEADROOM_LAMPORTS,
      programUpgradeAuthority: upgradeAuthorityPublicKey ?? null,
    },
  };
  const approvalFingerprint = createHash("sha256")
    .update(JSON.stringify(approvalPayload))
    .digest("hex")
    .slice(0, 16);

  return {
    cluster: "devnet",
    deploymentMode,
    baseRpc,
    expectedGenesisHash,
    programId: ZKUBE_PROGRAM_ID.toBase58(),
    workspaceDir,
    artifactPath,
    artifactSha256,
    programKeypairPath,
    programKeypairPublicKey,
    programBufferKeypairPath,
    programBufferPublicKey,
    deployerKeypairPath,
    deployerPublicKey,
    upgradeAuthorityKeypairPath,
    upgradeAuthorityPublicKey,
    commands,
    approvalFingerprint,
    sendEnabled: env.ZKUBE_DEPLOY === "1",
    suppliedApproval: env.ZKUBE_DEPLOY_APPROVAL?.trim() || undefined,
  };
}

export async function runZkubeDevnetDeployment(
  input: ZkubeDevnetDeploymentInput,
): Promise<ZkubeDevnetDeploymentResult> {
  if (!input.sendEnabled) return { mode: "dry-run", input, executions: [] };
  if (input.suppliedApproval !== input.approvalFingerprint) {
    throw new Error(
      `deployment blocked: set ZKUBE_DEPLOY_APPROVAL=${input.approvalFingerprint} after explicit approval`,
    );
  }
  if (!input.deployerKeypairPath || !input.deployerPublicKey) {
    throw new Error("ZKUBE_DEPLOYER_KEYPAIR is required for deployment");
  }
  if (input.deploymentMode === "initial") {
    if (!input.programKeypairPath || !input.programKeypairPublicKey) {
      throw new Error(
        "ZKUBE_PROGRAM_KEYPAIR is required for an initial deployment",
      );
    }
    if (!input.programBufferKeypairPath || !input.programBufferPublicKey) {
      throw new Error(
        "ZKUBE_PROGRAM_BUFFER_KEYPAIR is required for resumable initial deployment",
      );
    }
    if (input.programKeypairPublicKey !== input.programId) {
      throw new Error(
        `program key ${input.programKeypairPublicKey} does not match declared program ${input.programId}`,
      );
    }
    if (
      !input.upgradeAuthorityKeypairPath ||
      !input.upgradeAuthorityPublicKey
    ) {
      throw new Error(
        "ZKUBE_UPGRADE_AUTHORITY_KEYPAIR is required to establish initial upgrade custody",
      );
    }
  } else if (
    !input.upgradeAuthorityKeypairPath ||
    !input.upgradeAuthorityPublicKey
  ) {
    throw new Error(
      "ZKUBE_UPGRADE_AUTHORITY_KEYPAIR is required for an existing-program upgrade",
    );
  }
  const connection = new Connection(input.baseRpc, "confirmed");
  const genesisHash = await connection.getGenesisHash();
  if (genesisHash !== input.expectedGenesisHash) {
    throw new Error(`Devnet genesis mismatch: received ${genesisHash}`);
  }
  const deployerBalance = await connection.getBalance(
    new PublicKey(input.deployerPublicKey),
    "confirmed",
  );
  const artifactBytes = readFileSync(input.artifactPath).byteLength;
  const programDataRent = await connection.getMinimumBalanceForRentExemption(
    artifactBytes + PROGRAM_DATA_HEADER_BYTES,
    "confirmed",
  );
  const requiredBalance =
    programDataRent + MINIMUM_DEPLOY_FEE_HEADROOM_LAMPORTS;
  const existing = await connection.getAccountInfo(
    ZKUBE_PROGRAM_ID,
    "confirmed",
  );
  if (input.deploymentMode === "upgrade") {
    const authority = await deployedUpgradeAuthority(
      connection,
      existing?.data,
    );
    if (authority !== input.upgradeAuthorityPublicKey) {
      throw new Error(
        `upgrade authority ${input.upgradeAuthorityPublicKey} does not match deployed authority ${authority ?? "none"}`,
      );
    }
    if (deployerBalance < requiredBalance) {
      throw new Error(
        `deployer balance ${deployerBalance} is below required Devnet deployment floor ${requiredBalance}`,
      );
    }
  } else {
    if (deployerBalance < requiredBalance) {
      throw new Error(
        `deployer balance ${deployerBalance} is below required Devnet deployment floor ${requiredBalance}`,
      );
    }
    if (existing)
      throw new Error("initial deployment blocked: program already exists");
    const targetKeypair = resolve(input.workspaceDir, PROGRAM_KEYPAIR_TARGET);
    if (resolve(input.programKeypairPath!) !== targetKeypair) {
      copyFileSync(input.programKeypairPath!, targetKeypair);
    }
  }
  const executions: DeploymentExecution[] = [];
  for (const planned of input.commands) {
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
    if (
      planned.label === "Build Anchor program" &&
      fileSha256(input.artifactPath) !== input.artifactSha256
    ) {
      throw new Error(
        "Anchor build changed the approved SBF hash; deployment stopped before send",
      );
    }
  }
  const info = await connection.getAccountInfo(ZKUBE_PROGRAM_ID, "confirmed");
  if (!info?.executable || !EXECUTABLE_OWNERS.has(info.owner.toBase58())) {
    throw new Error(
      "deployed program account failed executable owner verification",
    );
  }
  const deploymentSignature = executions
    .flatMap(({ stdout, stderr }) => [stdout, stderr])
    .join("\n")
    .match(/Signature:\s*([1-9A-HJ-NP-Za-km-z]+)/)?.[1];
  return {
    mode: "deployed",
    input,
    executions,
    ...(deploymentSignature ? { deploymentSignature } : {}),
  };
}

export function formatDevnetDeployment(
  result: ZkubeDevnetDeploymentResult,
): string {
  const { input } = result;
  const executable = executableDeploymentInput(input);
  return [
    "zKube Devnet deployment",
    `Mode: ${result.mode}`,
    `Deployment operation: ${input.deploymentMode}`,
    `Base RPC: ${input.baseRpc}`,
    `Program: ${input.programId}`,
    `SBF SHA-256: ${input.artifactSha256}`,
    `Program deployment key: ${input.programKeypairPublicKey ?? "missing"}`,
    `Program buffer: ${input.programBufferPublicKey ?? "missing"}`,
    `Deployer: ${input.deployerPublicKey ?? "missing"}`,
    `Upgrade authority: ${input.upgradeAuthorityPublicKey ?? "missing"}`,
    `Approval fingerprint: ${input.approvalFingerprint}`,
    `Executable plan: ${executable ? "yes" : "no"}`,
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
  if (!input.deployerKeypairPath || !input.deployerPublicKey) return false;
  if (input.deploymentMode === "initial") {
    return Boolean(
      input.programKeypairPath &&
      input.programKeypairPublicKey === input.programId &&
      input.programBufferKeypairPath &&
      input.programBufferPublicKey &&
      input.upgradeAuthorityKeypairPath &&
      input.upgradeAuthorityPublicKey,
    );
  }
  return Boolean(
    input.upgradeAuthorityKeypairPath && input.upgradeAuthorityPublicKey,
  );
}

function deploymentCommands(args: {
  workspaceDir: string;
  deploymentMode: "upgrade" | "initial";
  baseRpc: string;
  programId: string;
  artifactPath: string;
  artifactBytes: number;
  programKeypairPath?: string;
  programBufferKeypairPath?: string;
  deployerKeypairPath?: string;
  upgradeAuthorityKeypairPath?: string;
}): DeploymentCommand[] {
  if (args.deploymentMode === "upgrade") {
    const upgradeArgs = [
      "program",
      "deploy",
      args.artifactPath,
      "--program-id",
      args.programId,
      "--max-len",
      String(args.artifactBytes),
      "--url",
      args.baseRpc,
      "--output",
      "json",
    ];
    if (args.upgradeAuthorityKeypairPath) {
      upgradeArgs.push("--upgrade-authority", args.upgradeAuthorityKeypairPath);
    }
    if (args.deployerKeypairPath) {
      upgradeArgs.push(
        "--keypair",
        args.deployerKeypairPath,
        "--fee-payer",
        args.deployerKeypairPath,
      );
    }
    if (args.programBufferKeypairPath) {
      upgradeArgs.push("--buffer", args.programBufferKeypairPath);
    }
    return [
      {
        label: "Build Anchor program",
        command: "anchor",
        args: ["build", "--ignore-keys"],
        cwd: args.workspaceDir,
      },
      {
        label: "Upgrade existing program",
        command: "solana",
        args: upgradeArgs,
        cwd: args.workspaceDir,
      },
      verificationCommand(args),
    ];
  }
  const deployArgs = [
    "program",
    "deploy",
    args.artifactPath,
    "--max-len",
    String(args.artifactBytes),
    "--url",
    args.baseRpc,
    "--output",
    "json",
  ];
  if (args.programKeypairPath) {
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
      label: "Build Anchor program",
      command: "anchor",
      args: ["build"],
      cwd: args.workspaceDir,
    },
    {
      label: "Deploy Solana program",
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
  return {
    label: command.label,
    command: command.command,
    args: command.args.map((argument) => {
      if (paths.artifactPath && argument === paths.artifactPath) {
        return "<program-artifact>";
      }
      if (paths.programKeypairPath && argument === paths.programKeypairPath) {
        return "<program-keypair>";
      }
      if (
        paths.programBufferKeypairPath &&
        argument === paths.programBufferKeypairPath
      ) {
        return "<program-buffer-keypair>";
      }
      if (paths.deployerKeypairPath && argument === paths.deployerKeypairPath) {
        return "<deployer-keypair>";
      }
      if (
        paths.upgradeAuthorityKeypairPath &&
        argument === paths.upgradeAuthorityKeypairPath
      ) {
        return "<upgrade-authority-keypair>";
      }
      return argument;
    }),
  };
}

async function deployedUpgradeAuthority(
  connection: Connection,
  programData: Buffer | undefined,
): Promise<string | null> {
  if (
    !programData ||
    programData.length < 36 ||
    programData.readUInt32LE(0) !== 2
  ) {
    throw new Error(
      "declared program is not an upgradeable-loader Program account",
    );
  }
  const programDataAddress = new PublicKey(programData.subarray(4, 36));
  const info = await connection.getAccountInfo(programDataAddress, "confirmed");
  if (!info || info.data.length < 13 || info.data.readUInt32LE(0) !== 3) {
    throw new Error("deployed ProgramData account is missing or malformed");
  }
  if (info.data[12] === 1 && info.data.length < 45) {
    throw new Error("deployed upgrade authority is truncated");
  }
  if (info.data[12] !== 1) return null;
  if (info.data.length < 45)
    throw new Error("deployed upgrade authority is truncated");
  return new PublicKey(info.data.subarray(13, 45)).toBase58();
}

function deploymentModeFromEnv(
  value: string | undefined,
): "upgrade" | "initial" {
  const mode = value?.trim().toLowerCase() || "upgrade";
  if (mode !== "upgrade" && mode !== "initial") {
    throw new Error("ZKUBE_DEPLOY_MODE must be upgrade or initial");
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
  )
    throw new Error(`${label} must be a Solana 64-byte keypair JSON array`);
  return Keypair.fromSecretKey(
    Uint8Array.from(source as number[]),
  ).publicKey.toBase58();
}

function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function devnetEndpoint(value: string): string {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "https:")
    throw new Error("Devnet deployment RPC must use HTTPS");
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
