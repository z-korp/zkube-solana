import {
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  deriveArcadeArchivePda,
  deriveArcadeConfigPda,
  deriveArenaDailyPda,
  deriveCadenceFundingPda,
  deriveDailyRulesCatalogPda,
  deriveMapCatalogPda,
  deriveOperatorRevenueVaultPda,
  derivePlayerFundingPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
  deriveSeasonPda,
  deriveWeeklyJackpotPda,
} from "./pdas";
import {
  CANONICAL_CAMPAIGN_MAP_COUNT,
  MAX_CAMPAIGN_MAPS,
  canonicalCampaignMap,
} from "./campaignCatalog";
import { zkubeProgram, type TransactionPlan } from "./runPlan";
import type { WalletLike } from "./sessionWallet";
import BN from "bn.js";
import {
  CANONICAL_DAILY_PRESSURE,
  CANONICAL_DAILY_SCORING_RULES,
  CANONICAL_DAILY_SEASON_SEED,
  DAILY_SCORING_RULE_COUNT,
} from "./dailyRules";
import {
  LAUNCH_DAILY_SEED_LAMPORTS,
  LAUNCH_SEASON_SEED_LAMPORTS,
  LAUNCH_WEEKLY_SEED_LAMPORTS,
} from "./deploymentManifest";

export const CADENCE_FUNDING_SEED_LAMPORTS = 500_000_000;

export interface ProtocolInitialization {
  teamDestination: PublicKey;
  contentVersion: number;
  replayDomain: Uint8Array;
}

export async function buildInitializeProtocolPlan(args: {
  connection: Connection;
  authority: WalletLike;
  config: ProtocolInitialization;
}): Promise<TransactionPlan> {
  assertPositiveInteger(args.config.contentVersion, "contentVersion");
  if (
    args.config.replayDomain.length !== 32 ||
    args.config.replayDomain.every((byte) => byte === 0)
  ) {
    throw new Error("replayDomain must contain 32 nonzero-domain bytes");
  }
  const destinations = [args.config.teamDestination];
  if (
    destinations.some((destination) => destination.equals(PublicKey.default)) ||
    new Set(destinations.map((destination) => destination.toBase58())).size !==
      destinations.length
  )
    throw new Error(
      "protocol destinations must be nonzero and pairwise distinct",
    );
  const instruction = await zkubeProgram(args.connection, args.authority)
    .methods.initializeProtocol({
      teamDestination: args.config.teamDestination,
      contentVersion: args.config.contentVersion,
      replayDomain: [...args.config.replayDomain],
    })
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      teamDestination: args.config.teamDestination,
      authority: args.authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return basePlan(
    "Initialize protocol",
    args.connection,
    args.authority.publicKey,
    [instruction],
  );
}

export async function buildPublishCanonicalMapsPlan(args: {
  connection: Connection;
  authority: WalletLike;
  contentVersion: number;
  mapIds?: readonly number[];
}): Promise<TransactionPlan> {
  assertPositiveInteger(args.contentVersion, "contentVersion");
  const mapIds =
    args.mapIds ??
    Array.from(
      { length: CANONICAL_CAMPAIGN_MAP_COUNT },
      (_, index) => index + 1,
    );
  if (mapIds.length === 0 || new Set(mapIds).size !== mapIds.length) {
    throw new Error("mapIds must be a non-empty unique list");
  }
  const program = zkubeProgram(args.connection, args.authority);
  const instructions = await Promise.all(
    mapIds.map(async (mapId) => {
      if (
        !Number.isInteger(mapId) ||
        mapId < 1 ||
        mapId > CANONICAL_CAMPAIGN_MAP_COUNT
      ) {
        throw new Error(
          `mapId must be between 1 and ${CANONICAL_CAMPAIGN_MAP_COUNT}`,
        );
      }
      const map = canonicalCampaignMap(args.contentVersion, mapId);
      return program.methods
        .writeMapCatalog({
          contentVersion: args.contentVersion,
          mapId,
          themeId: map.themeId,
          enabled: map.enabled,
          mapRules: map.mapRules,
          levels: map.levels,
        })
        .accountsPartial({
          protocol: deriveProtocolConfigPda(),
          mapCatalog: deriveMapCatalogPda(args.contentVersion, mapId),
          authority: args.authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
    }),
  );
  return basePlan(
    `Publish canonical maps ${mapIds.join(",")}`,
    args.connection,
    args.authority.publicKey,
    instructions,
  );
}

export async function buildActivateCampaignMapPlan(args: {
  connection: Connection;
  authority: WalletLike;
  contentVersion: number;
  mapId: number;
}): Promise<TransactionPlan> {
  assertPositiveInteger(args.contentVersion, "contentVersion");
  if (
    !Number.isInteger(args.mapId) ||
    args.mapId < 1 ||
    args.mapId > MAX_CAMPAIGN_MAPS
  ) {
    throw new Error(`mapId must be between 1 and ${MAX_CAMPAIGN_MAPS}`);
  }
  const instruction = await zkubeProgram(args.connection, args.authority)
    .methods.activateCampaignMap()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      mapCatalog: deriveMapCatalogPda(args.contentVersion, args.mapId),
      authority: args.authority.publicKey,
    })
    .instruction();
  return basePlan(
    `Activate campaign map ${args.mapId}`,
    args.connection,
    args.authority.publicKey,
    [instruction],
  );
}

/**
 * Builds the paused, atomic switch to a completely staged content release.
 * Every enabled Campaign map is passed in map-id order so the program can
 * validate the exact immutable release before changing either live version.
 */
export async function buildActivateContentReleasePlan(args: {
  connection: Connection;
  authority: WalletLike;
  contentVersion: number;
  dailyRulesVersion: number;
  campaignMapCount?: number;
}): Promise<TransactionPlan> {
  assertPositiveInteger(args.contentVersion, "contentVersion");
  assertPositiveInteger(args.dailyRulesVersion, "dailyRulesVersion");
  const campaignMapCount =
    args.campaignMapCount ?? CANONICAL_CAMPAIGN_MAP_COUNT;
  if (
    !Number.isInteger(campaignMapCount) ||
    campaignMapCount < 1 ||
    campaignMapCount > MAX_CAMPAIGN_MAPS
  ) {
    throw new Error(
      `campaignMapCount must be between 1 and ${MAX_CAMPAIGN_MAPS}`,
    );
  }
  const instruction = await zkubeProgram(args.connection, args.authority)
    .methods.activateContentRelease(
      args.contentVersion,
      args.dailyRulesVersion,
      campaignMapCount,
    )
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      dailyRulesCatalog: deriveDailyRulesCatalogPda(args.dailyRulesVersion),
      authority: args.authority.publicKey,
    })
    .remainingAccounts(
      Array.from({ length: campaignMapCount }, (_, index) => ({
        pubkey: deriveMapCatalogPda(args.contentVersion, index + 1),
        isSigner: false,
        isWritable: false,
      })),
    )
    .instruction();
  return basePlan(
    `Activate content release v${args.contentVersion}`,
    args.connection,
    args.authority.publicKey,
    [instruction],
  );
}

export async function buildSetProtocolPausePlan(args: {
  connection: Connection;
  authority: WalletLike;
  paused: boolean;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.authority)
    .methods.setProtocolPause(args.paused)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      authority: args.authority.publicKey,
    })
    .instruction();
  return basePlan(
    args.paused ? "Pause protocol" : "Unpause protocol",
    args.connection,
    args.authority.publicKey,
    [instruction],
  );
}

export async function buildPublishCanonicalArenaRulesPlan(args: {
  connection: Connection;
  authority: WalletLike;
  contentVersion: number;
  rulesVersion: number;
  startsDay: number;
}): Promise<TransactionPlan> {
  assertPositiveInteger(args.contentVersion, "contentVersion");
  assertPositiveInteger(args.rulesVersion, "rulesVersion");
  assertU32(args.startsDay, "startsDay");
  const instruction = await zkubeProgram(args.connection, args.authority)
    .methods.publishArenaRules({
      contentVersion: args.contentVersion,
      rulesVersion: args.rulesVersion,
      rotationId: 1,
      startsDay: args.startsDay,
      rotationSeed: [...CANONICAL_DAILY_SEASON_SEED],
      scoringRuleCount: DAILY_SCORING_RULE_COUNT,
      scoringRules: CANONICAL_DAILY_SCORING_RULES.map((rule) => ({ ...rule })),
      pressure: {
        ...CANONICAL_DAILY_PRESSURE,
        thresholds: [...CANONICAL_DAILY_PRESSURE.thresholds],
        scoreMultipliersX100: [
          ...CANONICAL_DAILY_PRESSURE.scoreMultipliersX100,
        ],
        blockWeights: CANONICAL_DAILY_PRESSURE.blockWeights.map((weights) => [
          ...weights,
        ]),
      },
    })
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      dailyRulesCatalog: deriveDailyRulesCatalogPda(args.rulesVersion),
      authority: args.authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return basePlan(
    `Publish Arena rules v${args.rulesVersion}`,
    args.connection,
    args.authority.publicKey,
    [instruction],
  );
}

export async function buildInitializeArcadePlan(args: {
  connection: Connection;
  authority: WalletLike;
  rulesVersion: number;
}): Promise<TransactionPlan> {
  assertPositiveInteger(args.rulesVersion, "rulesVersion");
  const instruction = await zkubeProgram(args.connection, args.authority)
    .methods.initializeArcade()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      dailyRulesCatalog: deriveDailyRulesCatalogPda(args.rulesVersion),
      arcadeConfig: deriveArcadeConfigPda(),
      operatorRevenueVault: deriveOperatorRevenueVaultPda(),
      authority: args.authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return basePlan(
    "Initialize paused Arcade",
    args.connection,
    args.authority.publicKey,
    [instruction],
  );
}

export async function buildInitializeArcadeArchivePlan(args: {
  connection: Connection;
  authority: WalletLike;
  firstDayId: number;
}): Promise<TransactionPlan> {
  assertU32(args.firstDayId, "firstDayId");
  const archiveInstruction = await zkubeProgram(
    args.connection,
    args.authority,
  )
    .methods.initializeArcadeArchive(args.firstDayId)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arcadeConfig: deriveArcadeConfigPda(),
      arcadeArchive: deriveArcadeArchivePda(),
      authority: args.authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const cadenceSeed = SystemProgram.transfer({
    fromPubkey: args.authority.publicKey,
    toPubkey: deriveCadenceFundingPda(),
    lamports: CADENCE_FUNDING_SEED_LAMPORTS,
  });
  return basePlan(
    "Initialize Arcade archive and seed recyclable cadence rent",
    args.connection,
    args.authority.publicKey,
    [archiveInstruction, cadenceSeed],
  );
}

/** One account-creation transaction per cadence keeps every plan packet-safe. */
export async function buildPrepareLaunchPeriodPlans(args: {
  connection: Connection;
  authority: WalletLike;
  rulesVersion: number;
  dayId: number;
  weekId: number;
  seasonId: number;
}): Promise<TransactionPlan[]> {
  assertPositiveInteger(args.rulesVersion, "rulesVersion");
  assertU32(args.dayId, "dayId");
  assertU32(args.weekId, "weekId");
  assertU32(args.seasonId, "seasonId");
  const program = zkubeProgram(args.connection, args.authority);
  const plans: TransactionPlan[] = [];
  for (const dayId of [args.dayId, args.dayId + 1]) {
    assertU32(dayId, "dayId");
    const instruction = await program.methods
      .prepareArenaDaily(dayId)
      .accountsPartial({
        protocol: deriveProtocolConfigPda(),
        arcadeConfig: deriveArcadeConfigPda(),
        arcadeArchive: deriveArcadeArchivePda(),
        dailyRulesCatalog: deriveDailyRulesCatalogPda(args.rulesVersion),
        arenaDaily: deriveArenaDailyPda(dayId),
        payer: args.authority.publicKey,
        caller: args.authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    plans.push(
      basePlan(
        `Prepare Daily ${dayId}`,
        args.connection,
        args.authority.publicKey,
        [instruction],
      ),
    );
  }
  for (const weeklyId of [args.weekId, args.weekId + 1]) {
    assertU32(weeklyId, "weekId");
    const instruction = await program.methods
      .prepareWeeklyJackpot(weeklyId)
      .accountsPartial({
        protocol: deriveProtocolConfigPda(),
        arcadeConfig: deriveArcadeConfigPda(),
        arcadeArchive: deriveArcadeArchivePda(),
        dailyRulesCatalog: deriveDailyRulesCatalogPda(args.rulesVersion),
        weeklyJackpot: deriveWeeklyJackpotPda(weeklyId),
        payer: args.authority.publicKey,
        caller: args.authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    plans.push(
      basePlan(
        `Prepare Weekly ${weeklyId}`,
        args.connection,
        args.authority.publicKey,
        [instruction],
      ),
    );
  }
  for (const seasonId of [args.seasonId, args.seasonId + 1]) {
    assertU32(seasonId, "seasonId");
    const instruction = await program.methods
      .prepareSeason(seasonId)
      .accountsPartial({
        protocol: deriveProtocolConfigPda(),
        arcadeConfig: deriveArcadeConfigPda(),
        arcadeArchive: deriveArcadeArchivePda(),
        season: deriveSeasonPda(seasonId),
        payer: args.authority.publicKey,
        caller: args.authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    plans.push(
      basePlan(
        `Prepare Season ${seasonId}`,
        args.connection,
        args.authority.publicKey,
        [instruction],
      ),
    );
  }
  return plans;
}

/**
 * The first funding, unpause, and three current-period activations share one
 * transaction. Any failed instruction rolls the entire launch back.
 */
export async function buildAtomicArcadeLaunchPlan(args: {
  connection: Connection;
  authority: WalletLike;
  dayId: number;
  weekId: number;
  seasonId: number;
}): Promise<TransactionPlan> {
  assertU32(args.dayId, "dayId");
  assertU32(args.weekId, "weekId");
  assertU32(args.seasonId, "seasonId");
  const program = zkubeProgram(args.connection, args.authority);
  const seed = await program.methods
    .seedLaunchPools(
      new BN(LAUNCH_DAILY_SEED_LAMPORTS),
      new BN(LAUNCH_WEEKLY_SEED_LAMPORTS),
      new BN(LAUNCH_SEASON_SEED_LAMPORTS),
    )
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arcadeConfig: deriveArcadeConfigPda(),
      arenaDaily: deriveArenaDailyPda(args.dayId),
      weeklyJackpot: deriveWeeklyJackpotPda(args.weekId),
      season: deriveSeasonPda(args.seasonId),
      authority: args.authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const unpause = await program.methods
    .setProtocolPause(false)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      authority: args.authority.publicKey,
    })
    .instruction();
  const activateDaily = await program.methods
    .activateArenaDaily()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arenaDaily: deriveArenaDailyPda(args.dayId),
      caller: args.authority.publicKey,
    })
    .instruction();
  const activateWeekly = await program.methods
    .activateWeeklyJackpot()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      weeklyJackpot: deriveWeeklyJackpotPda(args.weekId),
      caller: args.authority.publicKey,
    })
    .instruction();
  const activateSeason = await program.methods
    .activateSeason()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      season: deriveSeasonPda(args.seasonId),
      caller: args.authority.publicKey,
    })
    .instruction();
  return basePlan(
    "Atomically seed 1/2/3 SOL and launch Arcade",
    args.connection,
    args.authority.publicKey,
    [seed, unpause, activateDaily, activateWeekly, activateSeason],
  );
}

export async function buildInitializePlayerPlan(args: {
  connection: Connection;
  owner: WalletLike;
  payer?: PublicKey;
}): Promise<TransactionPlan> {
  const payer = args.payer ?? args.owner.publicKey;
  const instruction = await zkubeProgram(args.connection, args.owner)
    .methods.initializePlayer()
    .accountsPartial({
      playerState: derivePlayerStatePda(args.owner.publicKey),
      playerFunding: derivePlayerFundingPda(args.owner.publicKey),
      payer,
      ownerAuthority: args.owner.publicKey,
      sessionToken: null,
      actor: args.owner.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return basePlan("Initialize player", args.connection, payer, [instruction]);
}

function basePlan(
  label: string,
  connection: Connection,
  feePayer: PublicKey,
  instructions: TransactionInstruction[],
): TransactionPlan {
  return {
    layer: "solana-base",
    label,
    connection,
    transaction: new Transaction().add(...instructions),
    feePayer,
    signers: [],
  };
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${label} must be positive`);
}

function assertU32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${label} must fit in u32`);
  }
}
