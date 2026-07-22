import { PublicKey } from "@solana/web3.js";
import {
  DELEGATION_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  SOLANA_DEVNET_GENESIS_HASH,
  ZKUBE_PROGRAM_ID,
} from "./constants";
import { VRF_QUEUE } from "./runPlan";
import { deriveOperatorRevenueVaultPda } from "./pdas";
import {
  MONDAY_EPOCH_DAY_ID,
  SEASON_DAYS,
  SECONDS_PER_DAY,
  WEEK_DAYS,
} from "./protocolVersions.generated";

type DeploymentCluster = "localnet" | "devnet";
type DeploymentApprovalStatus = "candidate" | "approved";
type ManifestCheckStatus = "pass" | "fail";

export const LAUNCH_DAILY_SEED_LAMPORTS = "1000000000";
export const LAUNCH_WEEKLY_SEED_LAMPORTS = "2000000000";
export const LAUNCH_SEASON_SEED_LAMPORTS = "3000000000";
const ENTRY_CUTOFF_OFFSET_SECONDS = 23 * 60 * 60;
const UPGRADEABLE_LOADER_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

export interface ZkubeDeploymentManifest {
  schema: "zkube-solana-deployment";
  schemaVersion: 5;
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
    programDataAddress: string;
    deployedProgramDataSha256: string;
    allocationBytes: number;
    upgradeAuthority: string;
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
  payment: { asset: "native-sol"; decimals: 9 };
  protocol: {
    authority: string;
    teamDestination: string;
    operatorRevenueVault: string;
  };
  content: {
    baseVersion: 1;
    campaignVersion: 2;
    catalogSha256: string;
  };
  rules: {
    arenaVersion: 1;
    catalogSha256: string;
  };
  launch: {
    dayId: number;
    weekId: number;
    seasonId: number;
    cutoffUnixTimestamp: number;
    planFingerprint: string;
    seeds: {
      dailyLamports: typeof LAUNCH_DAILY_SEED_LAMPORTS;
      weeklyLamports: typeof LAUNCH_WEEKLY_SEED_LAMPORTS;
      seasonLamports: typeof LAUNCH_SEASON_SEED_LAMPORTS;
    };
  };
  keeper: {
    signer: string;
    releaseFingerprint: string;
    imageDigest: string;
  };
}

interface DeploymentManifestCheck {
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
const RELEASE_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const IMAGE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SECRET_KEY_PATTERN =
  /(secret|private|mnemonic|keypair|seedphrase|secretkey|privatekey)/i;

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
    schemaVersion: 5,
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
      artifactSha256: required(
        env,
        "ZKUBE_PROGRAM_ARTIFACT_SHA256",
      ).toLowerCase(),
      programDataAddress: required(env, "ZKUBE_PROGRAM_DATA_ADDRESS"),
      deployedProgramDataSha256: required(
        env,
        "ZKUBE_DEPLOYED_PROGRAM_DATA_SHA256",
      ).toLowerCase(),
      allocationBytes: requiredInteger(env, "ZKUBE_PROGRAM_ALLOCATION_BYTES"),
      upgradeAuthority: required(env, "ZKUBE_PROGRAM_UPGRADE_AUTHORITY"),
      ...optional(env.ZKUBE_DEPLOYMENT_SIGNATURE, "deploymentSignature"),
      ...optional(env.ZKUBE_DEPLOYED_AT, "deployedAt"),
    },
    rpc: {
      base: required(env, "VITE_PUBLIC_SOLANA_RPC_ENDPOINT"),
      expectedGenesisHash: required(
        env,
        "VITE_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH",
      ),
      magicRouter: required(env, "VITE_PUBLIC_MAGICBLOCK_ROUTER_RPC"),
    },
    magic: {
      routerPolicy: "closest",
      context: required(env, "VITE_PUBLIC_SOLANA_MAGIC_CONTEXT_ID"),
      program: required(env, "VITE_PUBLIC_SOLANA_MAGIC_PROGRAM_ID"),
      delegationProgram: required(
        env,
        "VITE_PUBLIC_SOLANA_DELEGATION_PROGRAM_ID",
      ),
      vrfQueue: required(env, "VITE_PUBLIC_SOLANA_VRF_QUEUE"),
    },
    payment: { asset: "native-sol", decimals: 9 },
    protocol: {
      authority: required(env, "ZKUBE_PROTOCOL_AUTHORITY"),
      teamDestination: required(env, "ZKUBE_TEAM_DESTINATION"),
      operatorRevenueVault: deriveOperatorRevenueVaultPda().toBase58(),
    },
    content: {
      baseVersion: requiredLiteralInteger(env, "ZKUBE_BASE_CONTENT_VERSION", 1),
      campaignVersion: requiredLiteralInteger(
        env,
        "ZKUBE_CAMPAIGN_CONTENT_VERSION",
        2,
      ),
      catalogSha256: required(
        env,
        "ZKUBE_CAMPAIGN_CATALOG_SHA256",
      ).toLowerCase(),
    },
    rules: {
      arenaVersion: requiredLiteralInteger(env, "ZKUBE_ARENA_RULES_VERSION", 1),
      catalogSha256: required(
        env,
        "ZKUBE_ARENA_RULES_CATALOG_SHA256",
      ).toLowerCase(),
    },
    launch: {
      dayId: requiredInteger(env, "ZKUBE_LAUNCH_DAY_ID"),
      weekId: requiredInteger(env, "ZKUBE_LAUNCH_WEEK_ID"),
      seasonId: requiredInteger(env, "ZKUBE_LAUNCH_SEASON_ID"),
      cutoffUnixTimestamp: requiredInteger(env, "ZKUBE_LAUNCH_CUTOFF_UNIX"),
      planFingerprint: required(
        env,
        "ZKUBE_LAUNCH_PLAN_FINGERPRINT",
      ).toLowerCase(),
      seeds: {
        dailyLamports: LAUNCH_DAILY_SEED_LAMPORTS,
        weeklyLamports: LAUNCH_WEEKLY_SEED_LAMPORTS,
        seasonLamports: LAUNCH_SEASON_SEED_LAMPORTS,
      },
    },
    keeper: {
      signer: required(env, "ZKUBE_KEEPER_PUBLIC_KEY"),
      releaseFingerprint: required(
        env,
        "ZKUBE_KEEPER_RELEASE_FINGERPRINT",
      ).toLowerCase(),
      imageDigest: required(env, "ZKUBE_KEEPER_IMAGE_DIGEST").toLowerCase(),
    },
  };
  const validation = validateDeploymentManifest(manifest);
  if (!validation.valid) {
    throw new Error(
      `Generated deployment manifest is invalid: ${validation.checks
        .filter((check) => check.status === "fail")
        .map((check) => `${check.id}: ${check.detail}`)
        .join("; ")}`,
    );
  }
  return manifest;
}

export function validateDeploymentManifest(
  source: unknown,
  expectedProgramId: PublicKey = ZKUBE_PROGRAM_ID,
): DeploymentManifestValidation {
  if (!isRecord(source)) {
    return {
      valid: false,
      checks: [
        fail("json-shape", "JSON shape", "Manifest root must be an object"),
      ],
    };
  }
  const manifest = source;
  const approval = record(manifest.approval);
  const program = record(manifest.program);
  const rpc = record(manifest.rpc);
  const magic = record(manifest.magic);
  const payment = record(manifest.payment);
  const protocol = record(manifest.protocol);
  const content = record(manifest.content);
  const rules = record(manifest.rules);
  const launch = record(manifest.launch);
  const seeds = record(launch?.seeds);
  const keeper = record(manifest.keeper);
  const cluster = string(manifest.cluster);
  const approvalStatus = string(approval?.status);
  const approved = approvalStatus === "approved";
  const dayId = number(launch?.dayId);
  const expectedWeek = dayId === null ? null : periodId(dayId, WEEK_DAYS);
  const expectedSeason = dayId === null ? null : periodId(dayId, SEASON_DAYS);
  const dayOpensAt = dayId === null ? null : dayId * SECONDS_PER_DAY;
  const expectedProgramDataAddress = PublicKey.findProgramAddressSync(
    [expectedProgramId.toBuffer()],
    UPGRADEABLE_LOADER_ID,
  )[0].toBase58();
  const checks: DeploymentManifestCheck[] = [
    check(
      "schema",
      "Schema",
      manifest.schema === "zkube-solana-deployment" &&
        manifest.schemaVersion === 5,
      "Expected zkube-solana-deployment@5",
    ),
    check(
      "cluster",
      "Cluster",
      cluster === "localnet" || cluster === "devnet",
      "Only localnet and devnet are allowed by schema v5",
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
      approvalStatus === "candidate" ||
        (approved &&
          FINGERPRINT_PATTERN.test(string(approval?.fingerprint) ?? "") &&
          validIsoDate(approval?.approvedAt) &&
          HASH_PATTERN.test(string(approval?.evidenceSha256) ?? "")),
      "Approved manifests require a 16-hex fingerprint, approval time, and evidence SHA-256",
    ),
    check(
      "program",
      "Program and ProgramData binding",
      string(program?.id) === expectedProgramId.toBase58() &&
        HASH_PATTERN.test(string(program?.artifactSha256) ?? "") &&
        program?.programDataAddress === expectedProgramDataAddress &&
        HASH_PATTERN.test(string(program?.deployedProgramDataSha256) ?? "") &&
        positiveInteger(program?.allocationBytes) &&
        validPublicKey(program?.upgradeAuthority) &&
        optionalString(program?.deploymentSignature) &&
        optionalIsoDate(program?.deployedAt),
      "Program id, artifact, canonical ProgramData binding, hash, or allocation is invalid",
    ),
    check(
      "deployed-approval",
      "Deployment evidence",
      !approved ||
        cluster === "localnet" ||
        (nonEmptyString(program?.deploymentSignature) &&
          validIsoDate(program?.deployedAt)),
      "An approved devnet manifest requires deployment signature and timestamp",
    ),
    check(
      "rpc",
      "RPC identity",
      validEndpoint(rpc?.base, cluster === "localnet") &&
        validEndpoint(rpc?.magicRouter, cluster === "localnet") &&
        validPublicKey(rpc?.expectedGenesisHash) &&
        (cluster !== "devnet" ||
          rpc?.expectedGenesisHash === SOLANA_DEVNET_GENESIS_HASH),
      "RPCs, expected genesis, or devnet cluster identity are invalid",
    ),
    check(
      "magic",
      "MagicBlock identity",
      magic?.routerPolicy === "closest" &&
        magic?.context === MAGIC_CONTEXT_ID.toBase58() &&
        magic?.program === MAGIC_PROGRAM_ID.toBase58() &&
        magic?.delegationProgram === DELEGATION_PROGRAM_ID.toBase58() &&
        magic?.vrfQueue === VRF_QUEUE.toBase58(),
      "Manifest must use the Router and exact SDK-pinned MagicBlock/VRF identities",
    ),
    check(
      "payment",
      "Payment domain",
      payment?.asset === "native-sol" && payment?.decimals === 9,
      "Protocol requires nine-decimal native SOL payments",
    ),
    check(
      "protocol",
      "Protocol authority and native-SOL custody",
      validPublicKey(protocol?.authority) &&
        validPublicKey(protocol?.teamDestination) &&
        protocol?.operatorRevenueVault ===
          deriveOperatorRevenueVaultPda().toBase58() &&
        protocol?.authority !== protocol?.teamDestination,
      "Authority, team destination, or canonical operator revenue vault is invalid",
    ),
    check(
      "content-rules",
      "Content and Arena rules",
      content?.baseVersion === 1 &&
        content?.campaignVersion === 2 &&
        HASH_PATTERN.test(string(content?.catalogSha256) ?? "") &&
        rules?.arenaVersion === 1 &&
        HASH_PATTERN.test(string(rules?.catalogSha256) ?? ""),
      "Manifest must bind base content v1, Campaign v2, Arena rules v1, and both catalog hashes",
    ),
    check(
      "launch",
      "Launch-day window",
      dayId !== null &&
        expectedWeek !== null &&
        expectedSeason !== null &&
        launch?.weekId === expectedWeek &&
        launch?.seasonId === expectedSeason &&
        dayOpensAt !== null &&
        positiveInteger(launch?.cutoffUnixTimestamp) &&
        Number(launch?.cutoffUnixTimestamp) > dayOpensAt &&
        Number(launch?.cutoffUnixTimestamp) <=
          dayOpensAt + ENTRY_CUTOFF_OFFSET_SECONDS &&
        RELEASE_FINGERPRINT_PATTERN.test(string(launch?.planFingerprint) ?? ""),
      "Launch week/Season IDs must derive from the exact current day with a pre-entry cutoff and 64-hex plan fingerprint",
    ),
    check(
      "launch-seeds",
      "Initial competition seeds",
      seeds?.dailyLamports === LAUNCH_DAILY_SEED_LAMPORTS &&
        seeds?.weeklyLamports === LAUNCH_WEEKLY_SEED_LAMPORTS &&
        seeds?.seasonLamports === LAUNCH_SEASON_SEED_LAMPORTS,
      "Launch seeds must be exactly 1/2/3 SOL",
    ),
    check(
      "keeper-release",
      "Keeper release binding",
      validPublicKey(keeper?.signer) &&
        RELEASE_FINGERPRINT_PATTERN.test(
          string(keeper?.releaseFingerprint) ?? "",
        ) &&
        IMAGE_DIGEST_PATTERN.test(string(keeper?.imageDigest) ?? ""),
      "Keeper signer, 64-hex release fingerprint, or image digest is invalid",
    ),
    check(
      "sanitized",
      "Sanitized payload",
      !containsSecretField(manifest),
      "Manifest contains a forbidden secret/private/keypair field",
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
    [
      "VITE_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH",
      manifest.rpc.expectedGenesisHash,
    ],
    ["SOLANA_EXPECTED_GENESIS_HASH", manifest.rpc.expectedGenesisHash],
    ["ZKUBE_EXPECTED_GENESIS_HASH", manifest.rpc.expectedGenesisHash],
    ["VITE_PUBLIC_SOLANA_ZKUBE_PROGRAM_ID", manifest.program.id],
    ["ZKUBE_PROGRAM_ARTIFACT_SHA256", manifest.program.artifactSha256],
    ["ZKUBE_PROGRAM_DATA_ADDRESS", manifest.program.programDataAddress],
    [
      "ZKUBE_DEPLOYED_PROGRAM_DATA_SHA256",
      manifest.program.deployedProgramDataSha256,
    ],
    [
      "ZKUBE_PROGRAM_ALLOCATION_BYTES",
      String(manifest.program.allocationBytes),
    ],
    ["ZKUBE_PROGRAM_UPGRADE_AUTHORITY", manifest.program.upgradeAuthority],
    [
      "VITE_PUBLIC_SOLANA_DELEGATION_PROGRAM_ID",
      manifest.magic.delegationProgram,
    ],
    ["VITE_PUBLIC_SOLANA_MAGIC_PROGRAM_ID", manifest.magic.program],
    ["VITE_PUBLIC_SOLANA_MAGIC_CONTEXT_ID", manifest.magic.context],
    ["VITE_PUBLIC_MAGICBLOCK_ROUTER_RPC", manifest.rpc.magicRouter],
    ["VITE_PUBLIC_SOLANA_VRF_QUEUE", manifest.magic.vrfQueue],
    ["ZKUBE_PROTOCOL_AUTHORITY", manifest.protocol.authority],
    ["ZKUBE_TEAM_DESTINATION", manifest.protocol.teamDestination],
    ["ZKUBE_OPERATOR_REVENUE_VAULT", manifest.protocol.operatorRevenueVault],
    ["ZKUBE_BASE_CONTENT_VERSION", String(manifest.content.baseVersion)],
    [
      "ZKUBE_CAMPAIGN_CONTENT_VERSION",
      String(manifest.content.campaignVersion),
    ],
    ["ZKUBE_CAMPAIGN_CATALOG_SHA256", manifest.content.catalogSha256],
    ["ZKUBE_ARENA_RULES_VERSION", String(manifest.rules.arenaVersion)],
    ["ZKUBE_ARENA_RULES_CATALOG_SHA256", manifest.rules.catalogSha256],
    ["ZKUBE_LAUNCH_DAY_ID", String(manifest.launch.dayId)],
    ["ZKUBE_LAUNCH_WEEK_ID", String(manifest.launch.weekId)],
    ["ZKUBE_LAUNCH_SEASON_ID", String(manifest.launch.seasonId)],
    ["ZKUBE_LAUNCH_CUTOFF_UNIX", String(manifest.launch.cutoffUnixTimestamp)],
    ["ZKUBE_LAUNCH_PLAN_FINGERPRINT", manifest.launch.planFingerprint],
    ["ZKUBE_KEEPER_PUBLIC_KEY", manifest.keeper.signer],
    ["ZKUBE_KEEPER_RELEASE_FINGERPRINT", manifest.keeper.releaseFingerprint],
    ["ZKUBE_KEEPER_IMAGE_DIGEST", manifest.keeper.imageDigest],
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
  expectedProgramId?: PublicKey;
}): DeploymentBindingValidation {
  const validation = validateDeploymentManifest(
    args.manifest,
    args.expectedProgramId,
  );
  const artifactMatches =
    HASH_PATTERN.test(args.artifactSha256) &&
    args.manifest.program.artifactSha256 === args.artifactSha256;
  const approvalSatisfied =
    !args.requireApproved || args.manifest.approval.status === "approved";
  const environmentMismatches = deploymentManifestMismatches(
    args.manifest,
    args.env ?? {},
  );
  return {
    valid:
      validation.valid &&
      artifactMatches &&
      approvalSatisfied &&
      environmentMismatches.length === 0,
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
    ...validation.checks.map(
      (entry) => `[${entry.status}] ${entry.label}: ${entry.detail}`,
    ),
  ].join("\n");
}

export function isZkubeDeploymentManifest(
  source: unknown,
  expectedProgramId?: PublicKey,
): source is ZkubeDeploymentManifest {
  return validateDeploymentManifest(source, expectedProgramId).valid;
}

function required(
  env: Record<string, string | undefined>,
  key: string,
): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function requiredInteger(
  env: Record<string, string | undefined>,
  key: string,
): number {
  const value = required(env, key);
  if (!/^\d+$/.test(value)) throw new Error(`${key} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${key} is not a safe integer`);
  }
  return parsed;
}

function requiredLiteralInteger<T extends number>(
  env: Record<string, string | undefined>,
  key: string,
  expected: T,
): T {
  const value = requiredInteger(env, key);
  if (value !== expected) throw new Error(`${key} must be ${expected}`);
  return expected;
}

function optional<K extends string>(
  value: string | undefined,
  key: K,
): Partial<Record<K, string>> {
  const normalized = value?.trim();
  return normalized
    ? ({ [key]: normalized } as Partial<Record<K, string>>)
    : {};
}

function check(
  id: string,
  label: string,
  condition: boolean,
  failure: string,
): DeploymentManifestCheck {
  return condition
    ? { id, label, status: "pass", detail: "OK" }
    : fail(id, label, failure);
}

function fail(
  id: string,
  label: string,
  detail: string,
): DeploymentManifestCheck {
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

function number(value: unknown): number | null {
  return Number.isSafeInteger(value) ? Number(value) : null;
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
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(
      endpoint.hostname,
    );
    return (
      endpoint.username === "" &&
      endpoint.password === "" &&
      endpoint.search === "" &&
      endpoint.hash === "" &&
      (endpoint.protocol === "https:" ||
        (localAllowed && local && endpoint.protocol === "http:"))
    );
  } catch {
    return false;
  }
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

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function periodId(dayId: number, periodDays: number): number | null {
  if (!Number.isSafeInteger(dayId) || dayId < MONDAY_EPOCH_DAY_ID) return null;
  return Math.floor((dayId - MONDAY_EPOCH_DAY_ID) / periodDays);
}

function containsSecretField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      SECRET_KEY_PATTERN.test(key) || containsSecretField(nested),
  );
}
