import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
  DELEGATION_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  SOLANA_DEVNET_GENESIS_HASH,
  ZKUBE_PROGRAM_ID,
} from "../constants";
import { REBOOT_VRF_QUEUE } from "./runPlan";

export type DeploymentCluster = "localnet" | "devnet";
export type DeploymentApprovalStatus = "candidate" | "approved";
export type ManifestCheckStatus = "pass" | "fail";

export interface ZkubeDeploymentManifest {
  schema: "zkube-solana-deployment";
  schemaVersion: 1;
  cluster: DeploymentCluster;
  createdAt: string;
  approval: {
    status: DeploymentApprovalStatus;
    fingerprint?: string;
    approvedAt?: string;
    evidenceSha256?: string;
  };
  program: {
    id: string;
    artifactSha256: string;
    deploymentSignature?: string;
    deployedAt?: string;
  };
  rpc: {
    base: string;
    expectedGenesisHash: string;
    magicRouter: string;
  };
  magic: {
    routerPolicy: "closest";
    context: string;
    program: string;
    delegationProgram: string;
    vrfQueue: string;
  };
  payment: {
    mint: string;
    tokenProgram: string;
    decimals: 6;
  };
  vaults: {
    team: string;
    paymaster: string;
    treasury: string;
    reward: string;
    payment: string;
  };
  paymaster: {
    publicKey: string;
    endpoint: string;
  };
  governance: {
    authority: string;
    delaySeconds: number;
    executionWindowSeconds: number;
  };
  versions: {
    content: number;
    progress: number;
    strategy: number;
  };
}

export interface DeploymentManifestCheck {
  id: string;
  label: string;
  status: ManifestCheckStatus;
  detail: string;
}

export interface DeploymentManifestValidation {
  valid: boolean;
  checks: DeploymentManifestCheck[];
}

export interface DeploymentBindingValidation {
  valid: boolean;
  manifest: DeploymentManifestValidation;
  artifactMatches: boolean;
  approvalSatisfied: boolean;
  environmentMismatches: string[];
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{16}$/;
const MIN_GOVERNANCE_SECONDS = 3_600;
const MAX_GOVERNANCE_SECONDS = 30 * 86_400;
const SECRET_KEY_PATTERN = /(secret|private|seed|mnemonic|keypair)/i;

export function deploymentManifestFromEnv(
  env: Record<string, string | undefined> = process.env,
  createdAt = new Date(),
): ZkubeDeploymentManifest {
  const cluster = required(env, "ZKUBE_CLUSTER").toLowerCase();
  if (cluster !== "localnet" && cluster !== "devnet") {
    throw new Error("ZKUBE_CLUSTER must be localnet or devnet");
  }
  const approvalStatus = required(env, "ZKUBE_APPROVAL_STATUS").toLowerCase();
  if (approvalStatus !== "candidate" && approvalStatus !== "approved") {
    throw new Error("ZKUBE_APPROVAL_STATUS must be candidate or approved");
  }
  const manifest: ZkubeDeploymentManifest = {
    schema: "zkube-solana-deployment",
    schemaVersion: 1,
    cluster,
    createdAt: createdAt.toISOString(),
    approval: {
      status: approvalStatus,
      ...optional(env.ZKUBE_APPROVAL_FINGERPRINT, "fingerprint"),
      ...optional(env.ZKUBE_APPROVED_AT, "approvedAt"),
      ...optional(env.ZKUBE_APPROVAL_EVIDENCE_SHA256, "evidenceSha256"),
    },
    program: {
      id: required(env, "VITE_PUBLIC_SOLANA_ZKUBE_PROGRAM_ID"),
      artifactSha256: required(env, "ZKUBE_PROGRAM_ARTIFACT_SHA256").toLowerCase(),
      ...optional(env.ZKUBE_DEPLOYMENT_SIGNATURE, "deploymentSignature"),
      ...optional(env.ZKUBE_DEPLOYED_AT, "deployedAt"),
    },
    rpc: {
      base: required(env, "VITE_PUBLIC_SOLANA_RPC_ENDPOINT"),
      expectedGenesisHash: required(env, "VITE_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH"),
      magicRouter: required(env, "VITE_PUBLIC_MAGICBLOCK_ROUTER_RPC"),
    },
    magic: {
      routerPolicy: "closest",
      context: required(env, "VITE_PUBLIC_SOLANA_MAGIC_CONTEXT_ID"),
      program: required(env, "VITE_PUBLIC_SOLANA_MAGIC_PROGRAM_ID"),
      delegationProgram: required(env, "VITE_PUBLIC_SOLANA_DELEGATION_PROGRAM_ID"),
      vrfQueue: required(env, "VITE_PUBLIC_SOLANA_VRF_QUEUE"),
    },
    payment: {
      mint: required(env, "ZKUBE_PAYMENT_MINT"),
      tokenProgram: required(env, "ZKUBE_PAYMENT_TOKEN_PROGRAM"),
      decimals: 6,
    },
    vaults: {
      team: required(env, "ZKUBE_TEAM_VAULT"),
      paymaster: required(env, "ZKUBE_PAYMASTER_VAULT"),
      treasury: required(env, "ZKUBE_TREASURY_VAULT"),
      reward: required(env, "ZKUBE_REWARD_VAULT"),
      payment: required(env, "ZKUBE_PAYMENT_VAULT"),
    },
    paymaster: {
      publicKey: required(env, "ZKUBE_PAYMASTER_PUBLIC_KEY"),
      endpoint: required(env, "VITE_PUBLIC_ZKUBE_PAYMASTER_ENDPOINT"),
    },
    governance: {
      authority: required(env, "ZKUBE_GOVERNANCE_AUTHORITY"),
      delaySeconds: requiredInteger(env, "ZKUBE_GOVERNANCE_DELAY_SECONDS"),
      executionWindowSeconds: requiredInteger(
        env,
        "ZKUBE_GOVERNANCE_EXECUTION_WINDOW_SECONDS",
      ),
    },
    versions: {
      content: requiredInteger(env, "ZKUBE_CONTENT_VERSION"),
      progress: requiredInteger(env, "ZKUBE_PROGRESS_VERSION"),
      strategy: requiredInteger(env, "ZKUBE_STRATEGY_VERSION"),
    },
  };
  const validation = validateDeploymentManifest(manifest);
  if (!validation.valid) {
    throw new Error(`Generated deployment manifest is invalid: ${validation.checks
      .filter((check) => check.status === "fail")
      .map((check) => `${check.id}: ${check.detail}`)
      .join("; ")}`);
  }
  return manifest;
}

export function validateDeploymentManifest(source: unknown): DeploymentManifestValidation {
  if (!isRecord(source)) {
    return {
      valid: false,
      checks: [fail("json-shape", "JSON shape", "Manifest root must be an object")],
    };
  }
  const manifest = source;
  const approval = record(manifest.approval);
  const program = record(manifest.program);
  const rpc = record(manifest.rpc);
  const magic = record(manifest.magic);
  const payment = record(manifest.payment);
  const vaults = record(manifest.vaults);
  const paymaster = record(manifest.paymaster);
  const governance = record(manifest.governance);
  const versions = record(manifest.versions);
  const cluster = string(manifest.cluster);
  const approvalStatus = string(approval?.status);
  const approved = approvalStatus === "approved";
  const vaultValues = vaults
    ? [vaults.team, vaults.paymaster, vaults.treasury, vaults.reward, vaults.payment]
    : [];
  const checks: DeploymentManifestCheck[] = [
    check(
      "schema",
      "Schema",
      manifest.schema === "zkube-solana-deployment" && manifest.schemaVersion === 1,
      "Expected zkube-solana-deployment@1",
    ),
    check(
      "cluster",
      "Cluster",
      cluster === "localnet" || cluster === "devnet",
      "Only localnet and devnet are allowed by schema v1",
    ),
    check(
      "created-at",
      "Created timestamp",
      validIsoDate(manifest.createdAt),
      "createdAt must be an ISO timestamp",
    ),
    check(
      "approval",
      "Approval evidence",
      approvalStatus === "candidate" || approved
        && FINGERPRINT_PATTERN.test(string(approval?.fingerprint) ?? "")
        && validIsoDate(approval?.approvedAt)
        && HASH_PATTERN.test(string(approval?.evidenceSha256) ?? ""),
      "Approved manifests require a 16-hex fingerprint, approval time, and evidence SHA-256",
    ),
    check(
      "program",
      "Program identity",
      string(program?.id) === ZKUBE_PROGRAM_ID.toBase58()
        && HASH_PATTERN.test(string(program?.artifactSha256) ?? "")
        && optionalString(program?.deploymentSignature)
        && optionalIsoDate(program?.deployedAt),
      "Program id, 64-hex artifact hash, and optional deployment metadata are invalid",
    ),
    check(
      "deployed-approval",
      "Deployment evidence",
      !approved || cluster === "localnet"
        || nonEmptyString(program?.deploymentSignature) && validIsoDate(program?.deployedAt),
      "An approved devnet manifest requires deployment signature and timestamp",
    ),
    check(
      "rpc",
      "RPC identity",
      validEndpoint(rpc?.base, cluster === "localnet")
        && validEndpoint(rpc?.magicRouter, cluster === "localnet")
        && validPublicKey(rpc?.expectedGenesisHash)
        && (cluster !== "devnet" || rpc?.expectedGenesisHash === SOLANA_DEVNET_GENESIS_HASH),
      "RPCs, expected genesis, or devnet cluster identity are invalid",
    ),
    check(
      "magic",
      "MagicBlock identity",
      magic?.routerPolicy === "closest"
        && magic?.context === MAGIC_CONTEXT_ID.toBase58()
        && magic?.program === MAGIC_PROGRAM_ID.toBase58()
        && magic?.delegationProgram === DELEGATION_PROGRAM_ID.toBase58()
        && magic?.vrfQueue === REBOOT_VRF_QUEUE.toBase58(),
      "Manifest must use the Router and exact SDK-pinned MagicBlock/VRF identities",
    ),
    check(
      "payment",
      "Payment domain",
      validPublicKey(payment?.mint)
        && payment?.tokenProgram === TOKEN_PROGRAM_ID.toBase58()
        && payment?.decimals === 6,
      "Protocol v1 requires a six-decimal canonical SPL Token payment mint",
    ),
    check(
      "vaults",
      "Segregated custody",
      vaultValues.length === 5
        && vaultValues.every(validPublicKey)
        && new Set(vaultValues).size === 5,
      "All five vaults must be valid and pairwise distinct",
    ),
    check(
      "paymaster",
      "Paymaster",
      validPublicKey(paymaster?.publicKey)
        && validPaymasterEndpoint(paymaster?.endpoint, cluster === "localnet"),
      "Paymaster public key or endpoint is invalid",
    ),
    check(
      "governance",
      "Governance",
      validPublicKey(governance?.authority)
        && boundedInteger(governance?.delaySeconds, MIN_GOVERNANCE_SECONDS, MAX_GOVERNANCE_SECONDS)
        && boundedInteger(
          governance?.executionWindowSeconds,
          MIN_GOVERNANCE_SECONDS,
          MAX_GOVERNANCE_SECONDS,
        ),
      "Governance authority/timing is missing or outside on-chain bounds",
    ),
    check(
      "versions",
      "Versions",
      positiveInteger(versions?.content)
        && positiveInteger(versions?.progress)
        && nonNegativeInteger(versions?.strategy),
      "Content/progress versions must be positive and strategy version non-negative",
    ),
    check(
      "sanitized",
      "Sanitized payload",
      !containsSecretField(manifest),
      "Manifest contains a forbidden secret/private/seed/keypair field",
    ),
  ];
  return { valid: checks.every((entry) => entry.status === "pass"), checks };
}

export function deploymentManifestMismatches(
  manifest: ZkubeDeploymentManifest,
  env: Record<string, string | undefined>,
): string[] {
  const pairs: Array<[string, string]> = [
    ["ZKUBE_CLUSTER", manifest.cluster],
    ["VITE_PUBLIC_SOLANA_RPC_ENDPOINT", manifest.rpc.base],
    ["SOLANA_DEVNET_RPC_URL", manifest.rpc.base],
    ["ZKUBE_READ_RPC_URL", manifest.rpc.base],
    ["VITE_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH", manifest.rpc.expectedGenesisHash],
    ["PAYMASTER_GENESIS_HASH", manifest.rpc.expectedGenesisHash],
    ["ZKUBE_EXPECTED_GENESIS_HASH", manifest.rpc.expectedGenesisHash],
    ["VITE_PUBLIC_SOLANA_ZKUBE_PROGRAM_ID", manifest.program.id],
    ["VITE_PUBLIC_SOLANA_DELEGATION_PROGRAM_ID", manifest.magic.delegationProgram],
    ["VITE_PUBLIC_SOLANA_MAGIC_PROGRAM_ID", manifest.magic.program],
    ["VITE_PUBLIC_SOLANA_MAGIC_CONTEXT_ID", manifest.magic.context],
    ["VITE_PUBLIC_MAGICBLOCK_ROUTER_RPC", manifest.rpc.magicRouter],
    ["VITE_PUBLIC_SOLANA_VRF_QUEUE", manifest.magic.vrfQueue],
    ["VITE_PUBLIC_ZKUBE_PAYMASTER_ENDPOINT", manifest.paymaster.endpoint],
    ["ZKUBE_PROGRAM_ARTIFACT_SHA256", manifest.program.artifactSha256],
    ["ZKUBE_PAYMENT_MINT", manifest.payment.mint],
    ["ZKUBE_PAYMENT_TOKEN_PROGRAM", manifest.payment.tokenProgram],
    ["ZKUBE_TEAM_VAULT", manifest.vaults.team],
    ["ZKUBE_PAYMASTER_VAULT", manifest.vaults.paymaster],
    ["ZKUBE_TREASURY_VAULT", manifest.vaults.treasury],
    ["ZKUBE_REWARD_VAULT", manifest.vaults.reward],
    ["ZKUBE_PAYMENT_VAULT", manifest.vaults.payment],
    ["ZKUBE_PAYMASTER_PUBLIC_KEY", manifest.paymaster.publicKey],
    ["ZKUBE_GOVERNANCE_AUTHORITY", manifest.governance.authority],
    ["ZKUBE_GOVERNANCE_DELAY_SECONDS", String(manifest.governance.delaySeconds)],
    ["ZKUBE_GOVERNANCE_EXECUTION_WINDOW_SECONDS", String(manifest.governance.executionWindowSeconds)],
    ["ZKUBE_CONTENT_VERSION", String(manifest.versions.content)],
    ["ZKUBE_PROGRESS_VERSION", String(manifest.versions.progress)],
    ["ZKUBE_STRATEGY_VERSION", String(manifest.versions.strategy)],
  ];
  return pairs.flatMap(([key, expected]) => {
    const actual = env[key];
    return actual !== undefined && actual !== expected
      ? [`${key}=${actual} expected ${expected}`]
      : [];
  });
}

export function validateDeploymentBinding(args: {
  manifest: ZkubeDeploymentManifest;
  artifactSha256: string;
  env?: Record<string, string | undefined>;
  requireApproved?: boolean;
}): DeploymentBindingValidation {
  const validation = validateDeploymentManifest(args.manifest);
  const artifactMatches = HASH_PATTERN.test(args.artifactSha256)
    && args.manifest.program.artifactSha256 === args.artifactSha256;
  const approvalSatisfied = !args.requireApproved
    || args.manifest.approval.status === "approved";
  const environmentMismatches = deploymentManifestMismatches(
    args.manifest,
    args.env ?? {},
  );
  return {
    valid: validation.valid
      && artifactMatches
      && approvalSatisfied
      && environmentMismatches.length === 0,
    manifest: validation,
    artifactMatches,
    approvalSatisfied,
    environmentMismatches,
  };
}

export function formatDeploymentManifestValidation(
  validation: DeploymentManifestValidation,
): string {
  return [
    "zKube deployment manifest validation",
    `Valid: ${validation.valid ? "yes" : "no"}`,
    ...validation.checks.map((entry) => `[${entry.status}] ${entry.label}: ${entry.detail}`),
  ].join("\n");
}

export function isZkubeDeploymentManifest(source: unknown): source is ZkubeDeploymentManifest {
  return validateDeploymentManifest(source).valid;
}

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function requiredInteger(env: Record<string, string | undefined>, key: string): number {
  const value = required(env, key);
  if (!/^\d+$/.test(value)) throw new Error(`${key} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${key} is not a safe integer`);
  return parsed;
}

function optional<K extends string>(value: string | undefined, key: K): Partial<Record<K, string>> {
  const normalized = value?.trim();
  return normalized ? { [key]: normalized } as Partial<Record<K, string>> : {};
}

function check(
  id: string,
  label: string,
  condition: boolean,
  failure: string,
): DeploymentManifestCheck {
  return condition ? { id, label, status: "pass", detail: "OK" } : fail(id, label, failure);
}

function fail(id: string, label: string, detail: string): DeploymentManifestCheck {
  return { id, label, status: "fail", detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validPublicKey(value: unknown): value is string {
  if (!nonEmptyString(value)) return false;
  try {
    return !new PublicKey(value).equals(PublicKey.default);
  } catch {
    return false;
  }
}

function validEndpoint(value: unknown, localAllowed: boolean): boolean {
  if (!nonEmptyString(value)) return false;
  try {
    const endpoint = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
    return endpoint.username === ""
      && endpoint.password === ""
      && endpoint.search === ""
      && endpoint.hash === ""
      && (endpoint.protocol === "https:" || localAllowed && local && endpoint.protocol === "http:");
  } catch {
    return false;
  }
}

function validPaymasterEndpoint(value: unknown, localAllowed: boolean): boolean {
  return nonEmptyString(value)
    && (value.startsWith("/") && !value.startsWith("//") || validEndpoint(value, localAllowed));
}

function validIsoDate(value: unknown): value is string {
  return nonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function optionalIsoDate(value: unknown): boolean {
  return value === undefined || validIsoDate(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || nonEmptyString(value);
}

function boundedInteger(value: unknown, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function containsSecretField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, nested]) => (
    SECRET_KEY_PATTERN.test(key) || containsSecretField(nested)
  ));
}
