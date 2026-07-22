import { createHash } from "node:crypto";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
} from "@solana/web3.js";
import {
  buildActivateContentReleasePlan,
  buildAtomicArcadeLaunchPlan,
  buildInitializeArcadePlan,
  buildInitializeProtocolPlan,
  buildPrepareLaunchPeriodPlans,
  buildPublishCanonicalArenaRulesPlan,
  buildPublishCanonicalMapsPlan,
} from "./adminClient";
import { CAMPAIGN_CONTENT_VERSION } from "./campaignCatalog";
import {
  LAUNCH_DAILY_SEED_LAMPORTS,
  LAUNCH_SEASON_SEED_LAMPORTS,
  LAUNCH_WEEKLY_SEED_LAMPORTS,
} from "./deploymentManifest";
import { inspectUpgradeableProgram } from "./deploymentRunner";
import {
  deriveArcadeConfigPda,
  deriveArenaDailyPda,
  deriveDailyRulesCatalogPda,
  deriveMapCatalogPda,
  deriveOperatorRevenueVaultPda,
  deriveProtocolConfigPda,
  deriveSeasonPda,
  deriveWeeklyJackpotPda,
} from "./pdas";
import {
  MONDAY_EPOCH_DAY_ID,
  SEASON_DAYS,
  SECONDS_PER_DAY,
  WEEK_DAYS,
} from "./protocolVersions.generated";
import { createReadOnlyWallet } from "./readOnlyWallet";
import { zkubeProgram, type TransactionPlan } from "./runPlan";
import { SOLANA_DEVNET_GENESIS_HASH, ZKUBE_PROGRAM_ID } from "./constants";

const BASE_CONTENT_VERSION = 1;
const ARENA_RULES_VERSION = 1;
const ENTRY_CUTOFF_OFFSET_SECONDS = 23 * 60 * 60;
const DEFAULT_AUTHORITY_RESERVE_LAMPORTS = 100_000_000;

export interface LaunchPlannerInput {
  cluster: "devnet";
  baseRpc: string;
  expectedGenesisHash: string;
  authority: string;
  teamDestination: string;
  replayDomainHex: string;
  launchDayId: number;
  launchCutoffUnixTimestamp: number;
  deployedProgramDataSha256: string;
  programAllocationBytes: number;
  programUpgradeAuthority: string;
  deploymentManifestSha256: string;
  keeperReleaseFingerprint: string;
  authorityReserveLamports: number;
}

export interface LaunchCostPlan {
  accountRentLamports: number;
  seedLamports: number;
  transactionCount: number;
  feePerTransactionLamports: number;
  maximumFeeLamports: number;
  maximumAuthoritySpendLamports: number;
  authorityReserveLamports: number;
  requiredAuthorityBalanceLamports: number;
}

export interface ZkubeLaunchPlan {
  input: LaunchPlannerInput;
  observedUnixTimestamp: number;
  weekId: number;
  seasonId: number;
  programDataAddress: string;
  plans: TransactionPlan[];
  phases: Array<{ label: string; transactionIndexes: number[] }>;
  costs: LaunchCostPlan;
  approvalEvidenceSha256: string;
  approvalFingerprint: string;
}

export function launchPlannerInputFromEnv(
  env: Record<string, string | undefined> = process.env,
): LaunchPlannerInput {
  const cluster = env.ZKUBE_CLUSTER?.trim().toLowerCase();
  if (cluster !== "devnet") {
    throw new Error("ZKUBE_CLUSTER=devnet is required for launch planning");
  }
  const baseRpc = devnetEndpoint(
    required(env, "VITE_PUBLIC_SOLANA_RPC_ENDPOINT"),
  );
  const expectedGenesisHash = required(
    env,
    "VITE_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH",
  );
  if (expectedGenesisHash !== SOLANA_DEVNET_GENESIS_HASH) {
    throw new Error("launch planner requires the Solana Devnet genesis hash");
  }
  return {
    cluster: "devnet",
    baseRpc,
    expectedGenesisHash,
    authority: publicKey(
      required(env, "ZKUBE_PROTOCOL_AUTHORITY"),
      "authority",
    ),
    teamDestination: publicKey(
      required(env, "ZKUBE_TEAM_DESTINATION"),
      "team destination",
    ),
    replayDomainHex: hash(
      required(env, "ZKUBE_REPLAY_DOMAIN_HEX"),
      "replay domain",
    ),
    launchDayId: u32(required(env, "ZKUBE_LAUNCH_DAY_ID"), "launch day"),
    launchCutoffUnixTimestamp: positiveInteger(
      required(env, "ZKUBE_LAUNCH_CUTOFF_UNIX"),
      "launch cutoff",
    ),
    deployedProgramDataSha256: hash(
      required(env, "ZKUBE_DEPLOYED_PROGRAM_DATA_SHA256"),
      "deployed ProgramData hash",
    ),
    programAllocationBytes: positiveInteger(
      required(env, "ZKUBE_PROGRAM_ALLOCATION_BYTES"),
      "ProgramData allocation",
    ),
    programUpgradeAuthority: publicKey(
      required(env, "ZKUBE_PROGRAM_UPGRADE_AUTHORITY"),
      "program upgrade authority",
    ),
    deploymentManifestSha256: hash(
      required(env, "ZKUBE_DEPLOYMENT_MANIFEST_SHA256"),
      "deployment manifest hash",
    ),
    keeperReleaseFingerprint: hash(
      required(env, "ZKUBE_KEEPER_RELEASE_FINGERPRINT"),
      "keeper release fingerprint",
    ),
    authorityReserveLamports: env.ZKUBE_LAUNCH_AUTHORITY_RESERVE_LAMPORTS
      ? positiveInteger(
          env.ZKUBE_LAUNCH_AUTHORITY_RESERVE_LAMPORTS,
          "authority reserve",
        )
      : DEFAULT_AUTHORITY_RESERVE_LAMPORTS,
  };
}

/**
 * Builds and fingerprints every unsigned bootstrap transaction. It has no
 * signer input and deliberately exposes no transaction-send function.
 */
export async function buildZkubeLaunchPlan(
  input: LaunchPlannerInput,
  connection: Connection = new Connection(input.baseRpc, "confirmed"),
): Promise<ZkubeLaunchPlan> {
  const genesisHash = await connection.getGenesisHash();
  if (genesisHash !== input.expectedGenesisHash) {
    throw new Error(`Devnet genesis mismatch: received ${genesisHash}`);
  }
  const authority = new PublicKey(input.authority);
  const teamDestination = new PublicKey(input.teamDestination);
  const programState = await inspectUpgradeableProgram(
    connection,
    ZKUBE_PROGRAM_ID,
  );
  if (
    programState.deployedSbfSha256 !== input.deployedProgramDataSha256 ||
    programState.programCapacityBytes !== input.programAllocationBytes
  ) {
    throw new Error(
      "live ProgramData hash or allocation does not match release input",
    );
  }
  if (programState.upgradeAuthority !== input.programUpgradeAuthority) {
    throw new Error(
      "live program upgrade authority does not match release input",
    );
  }
  const slot = await connection.getSlot("confirmed");
  const observedUnixTimestamp = await connection.getBlockTime(slot);
  if (observedUnixTimestamp === null) {
    throw new Error("unable to read the current Devnet clock");
  }
  const { weekId, seasonId } = launchCadences(input.launchDayId);
  assertLaunchWindow(
    input.launchDayId,
    input.launchCutoffUnixTimestamp,
    observedUnixTimestamp,
  );
  const teamInfo = await connection.getAccountInfo(
    teamDestination,
    "confirmed",
  );
  if (
    !teamInfo ||
    teamInfo.executable ||
    !teamInfo.owner.equals(SystemProgram.programId) ||
    teamInfo.data.length !== 0
  ) {
    throw new Error(
      "team destination must be an existing System-owned zero-data account",
    );
  }

  const targetAccounts = bootstrapTargetAccounts(
    input.launchDayId,
    weekId,
    seasonId,
  );
  const targetInfos = await connection.getMultipleAccountsInfo(
    targetAccounts,
    "confirmed",
  );
  const occupied = targetInfos.flatMap((info, index) =>
    info ? [targetAccounts[index]?.toBase58() ?? "unknown"] : [],
  );
  if (occupied.length > 0) {
    throw new Error(
      `full bootstrap requires fresh paused state; occupied targets: ${occupied.join(",")}`,
    );
  }

  const wallet = createReadOnlyWallet(authority);
  const plans: TransactionPlan[] = [];
  plans.push(
    await buildInitializeProtocolPlan({
      connection,
      authority: wallet,
      config: {
        teamDestination,
        contentVersion: BASE_CONTENT_VERSION,
        replayDomain: Uint8Array.from(
          Buffer.from(input.replayDomainHex, "hex"),
        ),
      },
    }),
  );
  for (let mapId = 1; mapId <= 10; mapId += 1) {
    plans.push(
      await buildPublishCanonicalMapsPlan({
        connection,
        authority: wallet,
        contentVersion: CAMPAIGN_CONTENT_VERSION,
        mapIds: [mapId],
      }),
    );
  }
  plans.push(
    await buildPublishCanonicalArenaRulesPlan({
      connection,
      authority: wallet,
      contentVersion: CAMPAIGN_CONTENT_VERSION,
      rulesVersion: ARENA_RULES_VERSION,
      startsDay: input.launchDayId,
    }),
  );
  plans.push(
    await buildActivateContentReleasePlan({
      connection,
      authority: wallet,
      contentVersion: CAMPAIGN_CONTENT_VERSION,
      dailyRulesVersion: ARENA_RULES_VERSION,
      campaignMapCount: 10,
    }),
  );
  plans.push(
    await buildInitializeArcadePlan({
      connection,
      authority: wallet,
      rulesVersion: ARENA_RULES_VERSION,
    }),
  );
  plans.push(
    ...(await buildPrepareLaunchPeriodPlans({
      connection,
      authority: wallet,
      rulesVersion: ARENA_RULES_VERSION,
      dayId: input.launchDayId,
      weekId,
      seasonId,
    })),
  );
  plans.push(
    await buildAtomicArcadeLaunchPlan({
      connection,
      authority: wallet,
      dayId: input.launchDayId,
      weekId,
      seasonId,
    }),
  );

  const program = zkubeProgram(connection, wallet);
  const accountSpaces = [
    program.account.protocolConfig.size,
    ...Array.from({ length: 10 }, () => program.account.mapCatalog.size),
    program.account.dailyRulesCatalog.size,
    program.account.arcadeConfig.size,
    program.account.operatorRevenueVault.size,
    program.account.arenaDaily.size,
    program.account.arenaDaily.size,
    program.account.weeklyJackpot.size,
    program.account.weeklyJackpot.size,
    program.account.season.size,
    program.account.season.size,
  ];
  const rentFloors = await Promise.all(
    accountSpaces.map((space) =>
      connection.getMinimumBalanceForRentExemption(space, "confirmed"),
    ),
  );
  const accountRentLamports = sumSafe(rentFloors, "bootstrap account rent");
  const feePerTransactionLamports = await liveSingleSignerFee(
    connection,
    authority,
  );
  const maximumFeeLamports = multiplySafe(
    feePerTransactionLamports,
    plans.length,
    "bootstrap fees",
  );
  const seedLamports = sumSafe(
    [
      Number(LAUNCH_DAILY_SEED_LAMPORTS),
      Number(LAUNCH_WEEKLY_SEED_LAMPORTS),
      Number(LAUNCH_SEASON_SEED_LAMPORTS),
    ],
    "launch seeds",
  );
  const maximumAuthoritySpendLamports = sumSafe(
    [accountRentLamports, seedLamports, maximumFeeLamports],
    "maximum launch spend",
  );
  const requiredAuthorityBalanceLamports = sumSafe(
    [maximumAuthoritySpendLamports, input.authorityReserveLamports],
    "launch balance floor",
  );
  const authorityBalance = await connection.getBalance(authority, "confirmed");
  if (authorityBalance < requiredAuthorityBalanceLamports) {
    throw new Error(
      `authority balance ${authorityBalance} is below launch floor ${requiredAuthorityBalanceLamports}`,
    );
  }
  const costs: LaunchCostPlan = {
    accountRentLamports,
    seedLamports,
    transactionCount: plans.length,
    feePerTransactionLamports,
    maximumFeeLamports,
    maximumAuthoritySpendLamports,
    authorityReserveLamports: input.authorityReserveLamports,
    requiredAuthorityBalanceLamports,
  };
  const phases = [
    { label: "Initialize paused base content v1", transactionIndexes: [0] },
    {
      label: "Stage Campaign content v2",
      transactionIndexes: Array.from({ length: 10 }, (_, index) => index + 1),
    },
    { label: "Stage Arena rules v1", transactionIndexes: [11] },
    { label: "Activate staged content and rules", transactionIndexes: [12] },
    { label: "Initialize paused Arcade", transactionIndexes: [13] },
    {
      label: "Prepare current and following periods",
      transactionIndexes: [14, 15, 16, 17, 18, 19],
    },
    {
      label: "Atomic 1/2/3 SOL seed, unpause, and activation",
      transactionIndexes: [20],
    },
  ];
  const approvalPayload = {
    operation: "fresh-paused-bootstrap-and-launch",
    input,
    observed: {
      programId: ZKUBE_PROGRAM_ID.toBase58(),
      programDataAddress: programState.programDataAddress.toBase58(),
      observedUnixTimestamp,
      weekId,
      seasonId,
      freshTargetAccounts: targetAccounts.map((address) => address.toBase58()),
    },
    phases,
    costs,
    transactions: plans.map(publicPlan),
    policy: {
      signingSupported: false,
      sendingSupported: false,
      initialProtocolPaused: true,
      seedUnpauseActivateAtomic: true,
    },
  };
  const approvalEvidenceSha256 = createHash("sha256")
    .update(JSON.stringify(approvalPayload))
    .digest("hex");
  return {
    input,
    observedUnixTimestamp,
    weekId,
    seasonId,
    programDataAddress: programState.programDataAddress.toBase58(),
    plans,
    phases,
    costs,
    approvalEvidenceSha256,
    approvalFingerprint: approvalEvidenceSha256,
  };
}

export function formatZkubeLaunchPlan(plan: ZkubeLaunchPlan): string {
  return [
    "zKube paused bootstrap and launch plan",
    "Mode: read-only unsigned plan",
    `Program: ${ZKUBE_PROGRAM_ID.toBase58()}`,
    `ProgramData: ${plan.programDataAddress}`,
    `ProgramData SHA-256: ${plan.input.deployedProgramDataSha256}`,
    `ProgramData allocation: ${plan.input.programAllocationBytes} bytes`,
    `Authority: ${plan.input.authority}`,
    `Launch day/week/Season: ${plan.input.launchDayId}/${plan.weekId}/${plan.seasonId}`,
    `Launch cutoff: ${plan.input.launchCutoffUnixTimestamp}`,
    `Observed chain time: ${plan.observedUnixTimestamp}`,
    `Transactions: ${plan.costs.transactionCount}`,
    `Account rent: ${plan.costs.accountRentLamports} lamports`,
    `Seeds: ${plan.costs.seedLamports} lamports (1/2/3 SOL)`,
    `Maximum fees: ${plan.costs.maximumFeeLamports} lamports`,
    `Maximum authority spend: ${plan.costs.maximumAuthoritySpendLamports} lamports`,
    `Required post-plan reserve: ${plan.costs.authorityReserveLamports} lamports`,
    `Required authority balance: ${plan.costs.requiredAuthorityBalanceLamports} lamports`,
    `Deployment manifest SHA-256: ${plan.input.deploymentManifestSha256}`,
    `Keeper release fingerprint: ${plan.input.keeperReleaseFingerprint}`,
    `Approval fingerprint: ${plan.approvalFingerprint}`,
    ...plan.phases.map(
      (phase) =>
        `[planned] ${phase.label}: transactions ${phase.transactionIndexes.join(",")}`,
    ),
    "No transaction was signed or sent. This planner has no send path.",
  ].join("\n");
}

export function launchCadences(dayId: number): {
  weekId: number;
  seasonId: number;
} {
  if (
    !Number.isSafeInteger(dayId) ||
    dayId < MONDAY_EPOCH_DAY_ID ||
    dayId > 0xffff_ffff
  ) {
    throw new Error("launch day must fit the supported cadence range");
  }
  const relative = dayId - MONDAY_EPOCH_DAY_ID;
  return {
    weekId: Math.floor(relative / WEEK_DAYS),
    seasonId: Math.floor(relative / SEASON_DAYS),
  };
}

function assertLaunchWindow(
  dayId: number,
  cutoffUnixTimestamp: number,
  observedUnixTimestamp: number,
): void {
  const opensAt = multiplySafe(dayId, SECONDS_PER_DAY, "launch day clock");
  const entriesCloseAt = sumSafe(
    [opensAt, ENTRY_CUTOFF_OFFSET_SECONDS],
    "entry cutoff",
  );
  if (
    !Number.isSafeInteger(cutoffUnixTimestamp) ||
    cutoffUnixTimestamp <= opensAt ||
    cutoffUnixTimestamp > entriesCloseAt
  ) {
    throw new Error("launch cutoff must be inside that UTC day's entry window");
  }
  if (observedUnixTimestamp > cutoffUnixTimestamp) {
    throw new Error("launch approval window has already closed");
  }
}

function bootstrapTargetAccounts(
  dayId: number,
  weekId: number,
  seasonId: number,
): PublicKey[] {
  return [
    deriveProtocolConfigPda(),
    ...Array.from({ length: 10 }, (_, index) =>
      deriveMapCatalogPda(CAMPAIGN_CONTENT_VERSION, index + 1),
    ),
    deriveDailyRulesCatalogPda(ARENA_RULES_VERSION),
    deriveArcadeConfigPda(),
    deriveOperatorRevenueVaultPda(),
    deriveArenaDailyPda(dayId),
    deriveArenaDailyPda(dayId + 1),
    deriveWeeklyJackpotPda(weekId),
    deriveWeeklyJackpotPda(weekId + 1),
    deriveSeasonPda(seasonId),
    deriveSeasonPda(seasonId + 1),
  ];
}

function publicPlan(plan: TransactionPlan) {
  return {
    layer: plan.layer,
    label: plan.label,
    feePayer: plan.feePayer.toBase58(),
    instructions: plan.transaction.instructions.map((instruction) => ({
      programId: instruction.programId.toBase58(),
      accounts: instruction.keys.map((account) => ({
        publicKey: account.pubkey.toBase58(),
        signer: account.isSigner,
        writable: account.isWritable,
      })),
      dataBase64: Buffer.from(instruction.data).toString("base64"),
    })),
  };
}

async function liveSingleSignerFee(
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
    throw new Error("unable to estimate the current Devnet launch fee");
  }
  return fee.value;
}

function required(
  env: Record<string, string | undefined>,
  key: string,
): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function publicKey(value: string, label: string): string {
  try {
    const key = new PublicKey(value);
    if (key.equals(PublicKey.default)) throw new Error("zero key");
    return key.toBase58();
  } catch {
    throw new Error(`${label} must be a nonzero Solana public key`);
  }
}

function hash(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${label} must be 64 lowercase hex characters`);
  }
  return normalized;
}

function u32(value: string, label: string): number {
  const parsed = positiveInteger(value, label, true);
  if (parsed > 0xffff_ffff) throw new Error(`${label} must fit in u32`);
  return parsed;
}

function positiveInteger(
  value: string,
  label: string,
  allowZero = false,
): number {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
    throw new Error(
      `${label} must be a ${allowZero ? "non-negative" : "positive"} safe integer`,
    );
  }
  return parsed;
}

function devnetEndpoint(value: string): string {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== "https:" ||
    /mainnet|localhost|127\.0\.0\.1|localnet/i.test(value)
  ) {
    throw new Error(
      "launch RPC must be HTTPS Devnet, never mainnet or localhost",
    );
  }
  return endpoint.toString().replace(/\/$/, "");
}

function sumSafe(values: readonly number[], label: string): number {
  return values.reduce((total, value) => {
    const next = total + value;
    if (!Number.isSafeInteger(next) || next < 0) {
      throw new Error(`${label} overflow`);
    }
    return next;
  }, 0);
}

function multiplySafe(left: number, right: number, label: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} overflow`);
  }
  return value;
}
