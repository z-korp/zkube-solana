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
  deriveCreditVaultPda,
  deriveMapCatalogPda,
  deriveOperatorRevenueVaultPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
} from "./pdas";
import {
  CANONICAL_CAMPAIGN_MAP_COUNT,
  MAX_CAMPAIGN_MAPS,
  canonicalCampaignMap,
} from "./campaignCatalog";
import { zkubeProgram, type TransactionPlan } from "./runPlan";
import type { WalletLike } from "./sessionWallet";
import BN from "bn.js";
import { dailyContentSelection } from "./dailyRules";
import { LAUNCH_DAILY_SEED_LAMPORTS } from "./deploymentManifest";

export const CADENCE_FUNDING_SEED_LAMPORTS = 500_000_000;
const U64_MAX = (1n << 64n) - 1n;

export type PrizePoolKind = "daily";

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
  campaignMapCount?: number;
}): Promise<TransactionPlan> {
  assertPositiveInteger(args.contentVersion, "contentVersion");
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
      campaignMapCount,
    )
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
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

export async function buildSetArenaSuspensionPlan(args: {
  connection: Connection;
  authority: WalletLike;
  untilDay: number;
}): Promise<TransactionPlan> {
  assertU32(args.untilDay, "untilDay");
  const instruction = await zkubeProgram(args.connection, args.authority)
    .methods.setArenaSuspension(args.untilDay)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arcadeConfig: deriveArcadeConfigPda(),
      authority: args.authority.publicKey,
    })
    .instruction();
  return basePlan(
    `Set Arena suspension until day ${args.untilDay}`,
    args.connection,
    args.authority.publicKey,
    [instruction],
  );
}

export async function buildInitializeArcadePlan(args: {
  connection: Connection;
  authority: WalletLike;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.authority)
    .methods.initializeArcade()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arcadeConfig: deriveArcadeConfigPda(),
      operatorRevenueVault: deriveOperatorRevenueVaultPda(),
      creditVault: deriveCreditVaultPda(),
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
  dayId: number;
  contentVersion: number;
}): Promise<TransactionPlan[]> {
  assertU32(args.dayId, "dayId");
  const program = zkubeProgram(args.connection, args.authority);
  const plans: TransactionPlan[] = [];
  for (const dayId of [args.dayId, args.dayId + 1]) {
    assertU32(dayId, "dayId");
    const content = await dailyContentSelection(dayId);
    const instruction = await program.methods
      .prepareArenaDaily(dayId)
      .accountsPartial({
        protocol: deriveProtocolConfigPda(),
        arcadeConfig: deriveArcadeConfigPda(),
        arcadeArchive: deriveArcadeArchivePda(),
        realmMapCatalog: deriveMapCatalogPda(
          args.contentVersion,
          content.realmMapId,
        ),
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
  return plans;
}

/**
 * The first funding, unpause, and current Daily activation share one
 * transaction. Any failed instruction rolls the entire launch back.
 */
export async function buildAtomicArcadeLaunchPlan(args: {
  connection: Connection;
  authority: WalletLike;
  dayId: number;
}): Promise<TransactionPlan> {
  assertU32(args.dayId, "dayId");
  const program = zkubeProgram(args.connection, args.authority);
  const seed = await program.methods
    .depositArenaDaily(new BN(LAUNCH_DAILY_SEED_LAMPORTS))
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arcadeConfig: deriveArcadeConfigPda(),
      arenaDaily: deriveArenaDailyPda(args.dayId),
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
  return basePlan(
    "Atomically seed 1 SOL and launch Arcade",
    args.connection,
    args.authority.publicKey,
    [seed, unpause, activateDaily],
  );
}

/**
 * Builds one exact authority-funded prize-pool transfer. The public API is
 * constrained to the canonical Daily PDA.
 */
export async function buildDepositArenaDailyPlan(args: {
  connection: Connection;
  authority: WalletLike;
  pool: PrizePoolKind;
  cadenceId: number;
  lamports: bigint;
}): Promise<TransactionPlan> {
  assertU32(args.cadenceId, "cadenceId");
  if (args.lamports <= 0n || args.lamports > U64_MAX) {
    throw new Error("lamports must fit in a positive u64");
  }
  const program = zkubeProgram(args.connection, args.authority);
  const amount = new BN(args.lamports.toString());
  const instruction = await program.methods
    .depositArenaDaily(amount)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      arcadeConfig: deriveArcadeConfigPda(),
      arenaDaily: deriveArenaDailyPda(args.cadenceId),
      authority: args.authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return basePlan(
    `Top up ${args.pool} ${args.cadenceId} with ${args.lamports.toString()} lamports`,
    args.connection,
    args.authority.publicKey,
    [instruction],
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
