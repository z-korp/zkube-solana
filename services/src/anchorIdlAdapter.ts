import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  BorshAccountsCoder,
  BorshInstructionCoder,
  convertIdlToCamelCase,
  type Idl,
} from "@anchor-lang/core";
import BN from "bn.js";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountInfo,
  type GetProgramAccountsFilter,
} from "@solana/web3.js";

import {
  ARCADE_ACCOUNT_VERSION,
  ARENA_ENTRY_LAMPORTS,
  DAILY_ENTRY_CLOSE_OFFSET,
  DAYS_PER_SEASON,
  DAYS_PER_WEEK,
  ENTRY_SPLIT_LAMPORTS,
  PROTOCOL_ACCOUNT_VERSION,
  RUN_RECOVERY_SECONDS,
  SECONDS_PER_DAY,
  ZKUBE_PROGRAM_ID,
  activeRunPda,
  arcadeConfigPda,
  arenaDailyPda,
  arenaPlayerPda,
  assertCadenceId,
  currentDayId,
  playerFundingPda,
  playerStatePda,
  protocolPda,
  rulesCatalogPda,
  seasonIdForDay,
  seasonPda,
  seasonPlayerPda,
  seasonStartDay,
  weekIdForDay,
  weekStartDay,
  weeklyJackpotPda,
  type KeeperOperation,
  type KeeperPlanContext,
} from "./arcadeChain.js";
import { equalBudgetPlan, payoutPlan } from "./arcadeEconomy.js";
import {
  type DailySeasonPlayerSnapshot,
  type DailySnapshot,
  type PeriodStatus,
  type ProtocolSnapshot,
  type RunLifecycle,
  type RunSnapshot,
  type SeasonSnapshot,
  type SettlementSnapshot,
  type WeeklySnapshot,
  type WinnerSnapshot,
} from "./arcadeReconciliation.js";
import { type ProtocolInstructionMaterializer } from "./planMaterializer.js";
import { getDelegationStatus } from "./router.js";

const MAX_PROGRAM_ACCOUNT_BYTES = 10_240;
const MAX_CADENCE_PERIODS = 10_000;
const MAX_DISCOVERED_PLAYER_STATES = 10_000;
const MAX_ARENA_PLAYERS_PER_DAILY = 5_000;
const MAX_RPC_ACCOUNT_BATCH = 100;
export const KEEPER_EXPECTED_IDL_SHA256 =
  "58dacaaa420a1c58a9b412954692296bb70b79cb5348e421ec23a7b9adbdb76b";
const REQUIRED_ACCOUNTS = [
  "activeRun",
  "arcadeConfig",
  "arenaDaily",
  "arenaPlayer",
  "dailyRulesCatalog",
  "playerState",
  "protocolConfig",
  "season",
  "seasonPlayer",
  "weeklyJackpot",
] as const;
const REQUIRED_INSTRUCTIONS = [
  "prepareArenaDaily",
  "prepareWeeklyJackpot",
  "prepareSeason",
  "activateArenaDaily",
  "activateWeeklyJackpot",
  "activateSeason",
  "forceFinishDeadline",
  "commitRun",
  "consumeCampaignRun",
  "consumeArenaRun",
  "consumePracticeRun",
  "expireUnresolvedArenaRun",
  "cleanupOrphanActiveRun",
  "initializeSeasonPlayer",
  "rollupArenaToSeason",
  "sealArenaSeasonRollups",
  "finalizeArenaDaily",
  "finalizeWeeklyJackpot",
  "finalizeSeason",
] as const;

interface LoadedAccount {
  address: PublicKey;
  account: AccountInfo<Buffer>;
  value: Record<string, unknown>;
}

interface PlayerStateRecord {
  address: PublicKey;
  owner: PublicKey;
  nextRunId: bigint;
  activeRunId: bigint;
  activeRunDaily: PublicKey;
  activeRunMode: "campaign" | "ranked" | "practice";
  activeRunDeadlineAt: number;
  orphanRunId: bigint;
}

export interface AnchorKeeperAdapterInput {
  connection: Connection;
  nowUnix: number;
  routerEndpoint?: string;
  fetcher?: typeof fetch;
  connectionFactory?: (endpoint: string) => Connection;
  idlPath?: URL;
}

/** Exact checked-in Anchor IDL decoder and instruction materializer. */
export class AnchorKeeperAdapter implements ProtocolInstructionMaterializer {
  readonly idlHash: string;
  private readonly accountsCoder: BorshAccountsCoder;
  private readonly instructionCoder: BorshInstructionCoder;
  private readonly rentBySize = new Map<number, number>();

  private constructor(
    private readonly input: AnchorKeeperAdapterInput,
    private readonly idl: Idl,
    idlBytes: Buffer,
  ) {
    this.accountsCoder = new BorshAccountsCoder(idl);
    this.instructionCoder = new BorshInstructionCoder(idl);
    this.idlHash = createHash("sha256").update(idlBytes).digest("hex");
    if (this.idlHash !== KEEPER_EXPECTED_IDL_SHA256) {
      throw new Error("checked-in Anchor IDL hash does not match the keeper release");
    }
    assertIdlInterface(idl);
  }

  static async create(input: AnchorKeeperAdapterInput): Promise<AnchorKeeperAdapter> {
    const path = input.idlPath ??
      new URL("../../client/src/chain/idl/solana.json", import.meta.url);
    const bytes = await readFile(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error("checked-in Anchor IDL is malformed JSON");
    }
    if (!isRecord(parsed) || parsed.address !== ZKUBE_PROGRAM_ID.toBase58()) {
      throw new Error("checked-in Anchor IDL program address is not the pinned zKube program");
    }
    return new AnchorKeeperAdapter(
      input,
      convertIdlToCamelCase(parsed as Idl),
      bytes,
    );
  }

  async loadProtocolSnapshot(): Promise<ProtocolSnapshot> {
    const protocol = await this.loadRequired(
      "protocolConfig",
      protocolPda(),
      PROTOCOL_ACCOUNT_VERSION,
    );
    const config = await this.loadRequired(
      "arcadeConfig",
      arcadeConfigPda(),
      ARCADE_ACCOUNT_VERSION,
    );
    requirePublicKey(config.value, "protocol", protocol.address, "ArcadeConfig protocol");
    requireBigInt(config.value, "entryLamports", ARENA_ENTRY_LAMPORTS, "entry price");
    requireBigInt(
      config.value,
      "dailyLamports",
      ENTRY_SPLIT_LAMPORTS.followingDaily,
      "Daily split",
    );
    requireBigInt(
      config.value,
      "weeklyLamports",
      ENTRY_SPLIT_LAMPORTS.followingWeekly,
      "Weekly split",
    );
    requireBigInt(
      config.value,
      "seasonLamports",
      ENTRY_SPLIT_LAMPORTS.followingSeason,
      "Season split",
    );
    requireBigInt(
      config.value,
      "operatorLamports",
      ENTRY_SPLIT_LAMPORTS.operator,
      "operator split",
    );
    if (!boolean(config.value.launchSeeded, "ArcadeConfig launch flag")) {
      throw new Error("keeper rejects an unseeded Arcade launch");
    }
    const launchDayId = u32(config.value.launchDayId, "launch day id");
    if (launchDayId < 4 ||
        launchDayId !== weekStartDay(weekIdForDay(launchDayId)) ||
        launchDayId !== seasonStartDay(seasonIdForDay(launchDayId))) {
      throw new Error("keeper rejects invalid launch cadence");
    }
    const rulesVersion = u32(protocol.value.dailyRulesVersion, "active rules version");
    if (rulesVersion === 0) throw new Error("keeper rejects an inactive rules catalog");
    const rulesCatalog = rulesCatalogPda(rulesVersion);
    requirePublicKey(config.value, "rulesCatalog", rulesCatalog, "ArcadeConfig rules catalog");
    const catalog = await this.loadRequired(
      "dailyRulesCatalog",
      rulesCatalog,
      PROTOCOL_ACCOUNT_VERSION,
    );
    requirePublicKey(catalog.value, "protocol", protocol.address, "rules catalog protocol");
    if (u32(catalog.value.rulesVersion, "rules catalog version") !== rulesVersion) {
      throw new Error("rules catalog version relationship is invalid");
    }
    const paused = boolean(protocol.value.paused, "protocol pause state");

    const today = currentDayId(this.input.nowUnix);
    const currentSeason = seasonIdForDay(today);
    const firstSeason = seasonIdForDay(launchDayId);
    const firstDay = launchDayId;
    const dailyIds = range(firstDay, checkedNext(today, "day id"));
    const weeklyIds = range(
      weekIdForDay(firstDay),
      checkedNext(weekIdForDay(today), "week id"),
    );
    const seasonIds = range(firstSeason, checkedNext(currentSeason, "Season id"));
    const dailies = await this.loadDailies(dailyIds, launchDayId);
    const weeklies = await this.loadWeeklies(
      weeklyIds,
      weekIdForDay(launchDayId),
      dailies,
    );
    const seasons = await this.loadSeasons(
      seasonIds,
      seasonIdForDay(launchDayId),
      dailies,
    );
    if (!dailies.some(({ snapshot }) => snapshot.dayId === launchDayId) ||
        !weeklies.some(({ weekId }) => weekId === weekIdForDay(launchDayId)) ||
        !seasons.some(({ seasonId }) => seasonId === seasonIdForDay(launchDayId))) {
      throw new Error("seeded Arcade launch cadence is incomplete");
    }
    const dailySeasonPlayers = await this.loadDailySeasonPlayers(dailies, seasons);
    const playerStates = await this.loadPlayerStates();
    const runs = await this.loadRuns(playerStates, dailies);
    return {
      paused,
      launchDayId,
      rulesCatalog,
      dailies: dailies.map(({ snapshot }) => snapshot),
      weeklies,
      seasons,
      runs,
      dailySeasonPlayers,
    };
  }

  async materialize(input: {
    operation: Exclude<KeeperOperation, "revoke_expired_session">;
    context: KeeperPlanContext;
    programId: PublicKey;
    keeper: PublicKey;
  }): Promise<readonly TransactionInstruction[]> {
    if (!input.programId.equals(ZKUBE_PROGRAM_ID)) {
      throw new Error("IDL materializer rejects an unpinned program");
    }
    const { name, args, accounts, remaining } = this.instructionInput(input);
    return [this.buildInstruction(name, args, accounts, remaining)];
  }

  private instructionInput(input: {
    operation: Exclude<KeeperOperation, "revoke_expired_session">;
    context: KeeperPlanContext;
    keeper: PublicKey;
  }): {
    name: string;
    args: Record<string, unknown>;
    accounts: Record<string, PublicKey>;
    remaining?: readonly PublicKey[];
  } {
    const context = input.context;
    const keeper = input.keeper;
    const owner = context.owner;
    const runId = context.runId;
    const dayId = context.dayId ?? context.challengeDayId;
    const weekId = context.weekId;
    const seasonId = context.seasonId;
    const base = { caller: keeper, payer: keeper, systemProgram: SystemProgram.programId };
    switch (input.operation) {
      case "prepare_arena_daily": {
        const following = requiredNumber(context.followingDayId, "following day id");
        return {
          name: "prepareArenaDaily",
          args: { dayId: following },
          accounts: {
            ...base,
            protocol: protocolPda(),
            arcadeConfig: arcadeConfigPda(),
            dailyRulesCatalog: requiredRulesCatalog(context.rulesCatalog),
            arenaDaily: arenaDailyPda(following),
          },
        };
      }
      case "prepare_weekly_jackpot": {
        const following = requiredNumber(context.followingWeekId, "following week id");
        return {
          name: "prepareWeeklyJackpot",
          args: { weekId: following },
          accounts: {
            ...base,
            protocol: protocolPda(),
            arcadeConfig: arcadeConfigPda(),
            dailyRulesCatalog: requiredRulesCatalog(context.rulesCatalog),
            weeklyJackpot: weeklyJackpotPda(following),
          },
        };
      }
      case "prepare_season": {
        const following = requiredNumber(context.followingSeasonId, "following Season id");
        return {
          name: "prepareSeason",
          args: { seasonId: following },
          accounts: {
            ...base,
            protocol: protocolPda(),
            arcadeConfig: arcadeConfigPda(),
            season: seasonPda(following),
          },
        };
      }
      case "activate_arena_daily":
        return {
          name: "activateArenaDaily",
          args: {},
          accounts: {
            ...base,
            protocol: protocolPda(),
            arenaDaily: arenaDailyPda(requiredNumber(dayId, "day id")),
          },
        };
      case "activate_weekly_jackpot":
        return {
          name: "activateWeeklyJackpot",
          args: {},
          accounts: {
            ...base,
            protocol: protocolPda(),
            weeklyJackpot: weeklyJackpotPda(requiredNumber(weekId, "week id")),
          },
        };
      case "activate_season":
        return {
          name: "activateSeason",
          args: {},
          accounts: {
            ...base,
            protocol: protocolPda(),
            season: seasonPda(requiredNumber(seasonId, "Season id")),
          },
        };
      case "force_finish_deadline":
        return {
          name: "forceFinishDeadline",
          args: {},
          accounts: {
            ...base,
            activeRun: activeRunPda(requiredOwner(owner), requiredRunId(runId)),
          },
        };
      case "commit_run":
        return {
          name: "commitRun",
          args: {},
          accounts: {
            ...base,
            activeRun: activeRunPda(requiredOwner(owner), requiredRunId(runId)),
          },
        };
      case "consume_campaign_run": {
        const player = requiredOwner(owner);
        return {
          name: "consumeCampaignRun",
          args: {},
          accounts: {
            activeRun: activeRunPda(player, requiredRunId(runId)),
            playerState: playerStatePda(player),
            owner: player,
            rentRecipient: playerFundingPda(player),
          },
        };
      }
      case "consume_arena_run": {
        const player = requiredOwner(owner);
        const challenge = requiredNumber(dayId, "challenge day id");
        const daily = arenaDailyPda(challenge);
        return {
          name: "consumeArenaRun",
          args: {},
          accounts: {
            playerState: playerStatePda(player),
            arenaDaily: daily,
            arenaPlayer: arenaPlayerPda(daily, player),
            weeklyJackpot: weeklyJackpotPda(weekIdForDay(challenge)),
            activeRun: activeRunPda(player, requiredRunId(runId)),
            rentRecipient: playerFundingPda(player),
          },
        };
      }
      case "consume_practice_run": {
        const player = requiredOwner(owner);
        const daily = arenaDailyPda(requiredNumber(dayId, "challenge day id"));
        return {
          name: "consumePracticeRun",
          args: {},
          accounts: {
            playerState: playerStatePda(player),
            arenaDaily: daily,
            arenaPlayer: context.includeArenaPlayer
              ? arenaPlayerPda(daily, player)
              : ZKUBE_PROGRAM_ID,
            activeRun: activeRunPda(player, requiredRunId(runId)),
            rentRecipient: playerFundingPda(player),
          },
        };
      }
      case "expire_unresolved_arena_run": {
        const player = requiredOwner(owner);
        const daily = arenaDailyPda(requiredNumber(dayId, "challenge day id"));
        return {
          name: "expireUnresolvedArenaRun",
          args: { runId: new BN(requiredRunId(runId).toString()) },
          accounts: {
            ...base,
            playerState: playerStatePda(player),
            arenaDaily: daily,
            arenaPlayer: context.includeArenaPlayer
              ? arenaPlayerPda(daily, player)
              : ZKUBE_PROGRAM_ID,
            owner: player,
          },
        };
      }
      case "cleanup_orphan_active_run": {
        const player = requiredOwner(owner);
        return {
          name: "cleanupOrphanActiveRun",
          args: {},
          accounts: {
            ...base,
            activeRun: activeRunPda(player, requiredRunId(runId)),
            playerState: playerStatePda(player),
            rentRecipient: playerFundingPda(player),
          },
        };
      }
      case "initialize_season_player": {
        const player = requiredOwner(owner);
        const id = requiredNumber(seasonId, "Season id");
        const season = seasonPda(id);
        return {
          name: "initializeSeasonPlayer",
          args: {},
          accounts: {
            ...base,
            season,
            seasonPlayer: seasonPlayerPda(season, player),
            player,
          },
        };
      }
      case "rollup_arena_to_season": {
        const player = requiredOwner(owner);
        const daily = arenaDailyPda(requiredNumber(dayId, "day id"));
        const season = seasonPda(requiredNumber(seasonId, "Season id"));
        return {
          name: "rollupArenaToSeason",
          args: {},
          accounts: {
            ...base,
            arenaDaily: daily,
            season,
            seasonPlayer: seasonPlayerPda(season, player),
            arenaPlayer: arenaPlayerPda(daily, player),
          },
        };
      }
      case "seal_arena_season_rollups":
        return {
          name: "sealArenaSeasonRollups",
          args: {},
          accounts: {
            ...base,
            arenaDaily: arenaDailyPda(requiredNumber(dayId, "day id")),
            season: seasonPda(requiredNumber(seasonId, "Season id")),
          },
        };
      case "finalize_arena_daily":
        return {
          name: "finalizeArenaDaily",
          args: {},
          accounts: {
            ...base,
            arenaDaily: arenaDailyPda(requiredNumber(dayId, "day id")),
            followingDaily: arenaDailyPda(
              requiredNumber(context.followingDayId, "following day id"),
            ),
          },
          remaining: context.owners,
        };
      case "finalize_weekly_jackpot":
        return {
          name: "finalizeWeeklyJackpot",
          args: {},
          accounts: {
            ...base,
            weeklyJackpot: weeklyJackpotPda(requiredNumber(weekId, "week id")),
            finalDaily: arenaDailyPda(
              requiredNumber(context.finalDayId, "Weekly final day id"),
            ),
            followingWeekly: weeklyJackpotPda(
              requiredNumber(context.followingWeekId, "following week id"),
            ),
          },
          remaining: context.owners,
        };
      case "finalize_season":
        return {
          name: "finalizeSeason",
          args: {},
          accounts: {
            ...base,
            season: seasonPda(requiredNumber(seasonId, "Season id")),
            followingSeason: seasonPda(
              requiredNumber(context.followingSeasonId, "following Season id"),
            ),
          },
          remaining: context.owners,
        };
    }
  }

  private buildInstruction(
    name: string,
    args: Record<string, unknown>,
    accounts: Record<string, PublicKey>,
    remaining: readonly PublicKey[] = [],
  ): TransactionInstruction {
    const instruction = instructionRecord(this.idl, name);
    const accountSpecs = instruction.accounts;
    const keys = accountSpecs.map((raw) => {
      if (!isRecord(raw) || typeof raw.name !== "string") {
        throw new Error(`Anchor IDL ${name} contains a nested or malformed account`);
      }
      const staticAddress = typeof raw.address === "string"
        ? new PublicKey(raw.address)
        : undefined;
      const supplied = accounts[raw.name];
      if (staticAddress && supplied && !staticAddress.equals(supplied)) {
        throw new Error(`Anchor IDL ${name}.${raw.name} static address drifted`);
      }
      const pubkey = staticAddress ?? supplied;
      if (!pubkey) throw new Error(`Anchor IDL materializer is missing ${name}.${raw.name}`);
      return {
        pubkey,
        isWritable: raw.writable === true,
        isSigner: raw.signer === true,
      };
    });
    keys.push(...remaining.map((pubkey) => ({
      pubkey,
      isWritable: true,
      isSigner: false,
    })));
    return new TransactionInstruction({
      programId: ZKUBE_PROGRAM_ID,
      keys,
      data: this.instructionCoder.encode(name, args),
    });
  }

  private async loadDailies(
    ids: readonly number[],
    launchDayId: number,
  ): Promise<Array<{ loaded: LoadedAccount; snapshot: DailySnapshot }>> {
    const loaded = await this.loadKnown(
      "arenaDaily",
      ids.map((id) => ({ id, address: arenaDailyPda(id) })),
      ARCADE_ACCOUNT_VERSION,
    );
    const output: Array<{ loaded: LoadedAccount; snapshot: DailySnapshot }> = [];
    for (const item of loaded) {
      const dayId = u32(item.value.dayId, "ArenaDaily day id");
      const dayStart = dayId * SECONDS_PER_DAY;
      if (!item.address.equals(arenaDailyPda(dayId)) ||
          u32(item.value.weekId, "ArenaDaily week id") !== weekIdForDay(dayId) ||
          u32(item.value.seasonId, "ArenaDaily Season id") !== seasonIdForDay(dayId) ||
          timestamp(item.value.opensAt, "ArenaDaily open") !== dayStart ||
          timestamp(item.value.entriesCloseAt, "ArenaDaily entry close") !==
            dayStart + DAILY_ENTRY_CLOSE_OFFSET) {
        throw new Error("ArenaDaily PDA or cadence relationship is invalid");
      }
      requirePublicKey(
        item.value,
        "arcadeConfig",
        arcadeConfigPda(),
        "ArenaDaily ArcadeConfig",
      );
      const potLamports = availableLedgerLamports(item.value.ledger, "ArenaDaily");
      await this.assertSpendable(item.account, potLamports, "ArenaDaily");
      const status = periodStatus(item.value.status, "ArenaDaily status");
      const snapshot: DailySnapshot = {
        dayId,
        status,
        runsCloseAt: timestamp(item.value.runsCloseAt, "ArenaDaily run close"),
        recoveryDeadlineAt: timestamp(
          item.value.recoveryDeadlineAt,
          "ArenaDaily recovery deadline",
        ),
        entriesPaid: bigint(item.value.entriesPaid, "ArenaDaily paid entries"),
        entriesScored: bigint(item.value.entriesScored, "ArenaDaily scored entries"),
        entriesExpired: bigint(item.value.entriesExpired, "ArenaDaily expired entries"),
        potLamports,
        predecessorRolloverRequired: dayId !== launchDayId,
        predecessorRolloverApplied: boolean(
          item.value.predecessorRolloverApplied,
          "ArenaDaily predecessor flag",
        ),
        seasonEligiblePlayers: u32(
          item.value.seasonEligiblePlayers,
          "ArenaDaily Season eligible players",
        ),
        seasonRollups: u32(item.value.seasonRollups, "ArenaDaily Season rollups"),
        seasonRollupSealed: boolean(
          item.value.seasonRollupSealed,
          "ArenaDaily Season seal",
        ),
        ...(status === "open" ? {
          settlement: await this.rankedSettlement(
            array(item.value.entries, "ArenaDaily entries"),
            potLamports,
            "daily",
          ),
        } : {}),
      };
      output.push({ loaded: item, snapshot });
    }
    return output;
  }

  private async loadWeeklies(
    ids: readonly number[],
    launchWeekId: number,
    dailies: readonly { loaded: LoadedAccount; snapshot: DailySnapshot }[],
  ): Promise<WeeklySnapshot[]> {
    const loaded = await this.loadKnown(
      "weeklyJackpot",
      ids.map((id) => ({ id, address: weeklyJackpotPda(id) })),
      ARCADE_ACCOUNT_VERSION,
    );
    const dailyById = new Map(dailies.map(({ snapshot }) => [snapshot.dayId, snapshot]));
    const output: WeeklySnapshot[] = [];
    for (const item of loaded) {
      const weekId = u32(item.value.weekId, "WeeklyJackpot week id");
      const opensAt = weekStartDay(weekId) * SECONDS_PER_DAY;
      const closesAt = (weekStartDay(weekId) + DAYS_PER_WEEK) * SECONDS_PER_DAY;
      if (!item.address.equals(weeklyJackpotPda(weekId)) ||
          timestamp(item.value.opensAt, "WeeklyJackpot open") !== opensAt ||
          timestamp(item.value.closesAt, "WeeklyJackpot close") !== closesAt) {
        throw new Error("WeeklyJackpot PDA is invalid");
      }
      requirePublicKey(
        item.value,
        "arcadeConfig",
        arcadeConfigPda(),
        "WeeklyJackpot ArcadeConfig",
      );
      const potLamports = availableLedgerLamports(item.value.ledger, "WeeklyJackpot");
      await this.assertSpendable(item.account, potLamports, "WeeklyJackpot");
      const status = periodStatus(item.value.status, "WeeklyJackpot status");
      const qualificationDailiesComplete = range(
        weekStartDay(weekId),
        weekStartDay(weekId) + DAYS_PER_WEEK - 1,
      ).every((dayId) => dailyById.get(dayId)?.status === "finalized");
      output.push({
        weekId,
        status,
        closesAt,
        potLamports,
        predecessorRolloverRequired: weekId !== launchWeekId,
        predecessorRolloverApplied: boolean(
          item.value.predecessorRolloverApplied,
          "WeeklyJackpot predecessor flag",
        ),
        qualificationDailiesComplete,
        ...(status === "open" ? {
          settlement: await this.weeklySettlement(item.value, potLamports),
        } : {}),
      });
    }
    return output;
  }

  private async loadSeasons(
    ids: readonly number[],
    launchSeasonId: number,
    dailies: readonly { loaded: LoadedAccount; snapshot: DailySnapshot }[],
  ): Promise<SeasonSnapshot[]> {
    const loaded = await this.loadKnown(
      "season",
      ids.map((id) => ({ id, address: seasonPda(id) })),
      ARCADE_ACCOUNT_VERSION,
    );
    void dailies;
    const output: SeasonSnapshot[] = [];
    for (const item of loaded) {
      const seasonId = u32(item.value.seasonId, "Season id");
      const opensAt = (seasonId * DAYS_PER_SEASON + 4) * SECONDS_PER_DAY;
      const closesAt =
        (seasonId * DAYS_PER_SEASON + 4 + DAYS_PER_SEASON) * SECONDS_PER_DAY;
      if (!item.address.equals(seasonPda(seasonId)) ||
          timestamp(item.value.opensAt, "Season open") !== opensAt ||
          timestamp(item.value.closesAt, "Season close") !== closesAt) {
        throw new Error("Season PDA is invalid");
      }
      requirePublicKey(
        item.value,
        "arcadeConfig",
        arcadeConfigPda(),
        "Season ArcadeConfig",
      );
      const potLamports = availableLedgerLamports(item.value.ledger, "Season");
      await this.assertSpendable(item.account, potLamports, "Season");
      const status = periodStatus(item.value.status, "Season status");
      output.push({
        seasonId,
        status,
        closesAt,
        potLamports,
        predecessorRolloverRequired: seasonId !== launchSeasonId,
        predecessorRolloverApplied: boolean(
          item.value.predecessorRolloverApplied,
          "Season predecessor flag",
        ),
        sealedDailies: u8(item.value.sealedDailies, "Season sealed Dailies"),
        ...(status === "open" ? {
          settlement: await this.rankedSettlement(
            array(item.value.entries, "Season entries"),
            potLamports,
            "season",
          ),
        } : {}),
      });
    }
    return output;
  }

  private async loadDailySeasonPlayers(
    dailies: readonly { loaded: LoadedAccount; snapshot: DailySnapshot }[],
    seasons: readonly SeasonSnapshot[],
  ): Promise<DailySeasonPlayerSnapshot[]> {
    const eligible: Array<{
      dayId: number;
      daily: PublicKey;
      loaded: LoadedAccount;
      owner: PublicKey;
    }> = [];
    for (const daily of dailies) {
      if (daily.snapshot.status !== "finalized" || daily.snapshot.seasonRollupSealed) continue;
      const accounts = await this.scanAccounts(
        "arenaPlayer",
        ARCADE_ACCOUNT_VERSION,
        MAX_ARENA_PLAYERS_PER_DAILY,
        [{ memcmp: { offset: 9, bytes: daily.loaded.address.toBase58() } }],
      );
      for (const player of accounts) {
        const challenge = publicKey(player.value.challenge, "ArenaPlayer challenge");
        const owner = publicKey(player.value.player, "ArenaPlayer owner");
        if (!challenge.equals(daily.loaded.address) ||
            !player.address.equals(arenaPlayerPda(challenge, owner))) {
          throw new Error("ArenaPlayer PDA or Daily relationship is invalid");
        }
        if (u32(player.value.resolvedEntries, "ArenaPlayer resolved entries") >
            u32(player.value.paidEntries, "ArenaPlayer paid entries")) {
          throw new Error("ArenaPlayer resolved entries exceed paid entries");
        }
        eligible.push({ dayId: daily.snapshot.dayId, daily: challenge, loaded: player, owner });
      }
    }
    const seasonAddresses = new Map<number, PublicKey>(
      seasons.map(({ seasonId }) => [seasonId, seasonPda(seasonId)]),
    );
    const seasonPlayerAddresses = eligible.map(({ dayId, owner }) => {
      const season = seasonAddresses.get(seasonIdForDay(dayId));
      if (!season) throw new Error("ArenaPlayer references an undiscovered Season");
      return seasonPlayerPda(season, owner);
    });
    const infos = await this.getMultiple(seasonPlayerAddresses);
    return eligible.map(({ dayId, loaded, owner }, index) => {
      const info = infos[index];
      if (info) {
        const season = seasonAddresses.get(seasonIdForDay(dayId))!;
        const decoded = this.decodeAccount(
          "seasonPlayer",
          seasonPlayerAddresses[index]!,
          info,
          ARCADE_ACCOUNT_VERSION,
          seasonPlayerAddresses[index]!,
        );
        requirePublicKey(decoded.value, "season", season, "SeasonPlayer Season");
        requirePublicKey(decoded.value, "player", owner, "SeasonPlayer owner");
        if (u8(decoded.value.resultCount, "SeasonPlayer result count") > 20) {
          throw new Error("SeasonPlayer result count is invalid");
        }
      }
      const paid = u32(loaded.value.paidEntries, "ArenaPlayer paid entries");
      const resolved = u32(loaded.value.resolvedEntries, "ArenaPlayer resolved entries");
      return {
        dayId,
        owner,
        dailyResolved: paid === resolved,
        hasBestScore: boolean(loaded.value.hasBest, "ArenaPlayer best flag"),
        seasonRolled: boolean(
          loaded.value.seasonRolledUp,
          "ArenaPlayer Season rollup flag",
        ),
        seasonPlayerExists: !!info,
      };
    });
  }

  private async loadPlayerStates(): Promise<PlayerStateRecord[]> {
    const accounts = await this.scanAccounts(
      "playerState",
      PROTOCOL_ACCOUNT_VERSION,
      MAX_DISCOVERED_PLAYER_STATES,
    );
    return accounts.map((loaded) => {
      const owner = publicKey(loaded.value.owner, "PlayerState owner");
      if (!loaded.address.equals(playerStatePda(owner))) {
        throw new Error("PlayerState PDA is invalid");
      }
      const nextRunId = bigint(loaded.value.nextRunId, "PlayerState next run id");
      const activeRunId = bigint(loaded.value.activeRunId, "PlayerState active run id");
      const orphanRunId = bigint(loaded.value.orphanRunId, "PlayerState orphan run id");
      const activeRunDaily = publicKey(
        loaded.value.activeRunDaily,
        "PlayerState active run Daily",
      );
      const activeRunMode = runMode(loaded.value.activeRunMode, "PlayerState active run mode");
      const activeRunDeadlineAt = signedTimestamp(
        loaded.value.activeRunDeadlineAt,
        "PlayerState active run deadline",
      );
      if (nextRunId === 0n || activeRunId >= nextRunId || orphanRunId >= nextRunId ||
          (activeRunId !== 0n && orphanRunId !== 0n)) {
        throw new Error("PlayerState run reservations are invalid");
      }
      const idle = activeRunId === 0n;
      const noArenaCadence = activeRunDaily.equals(SystemProgram.programId) &&
        activeRunDeadlineAt === 0;
      if ((idle && (!noArenaCadence || activeRunMode !== "campaign")) ||
          (!idle && activeRunMode === "campaign" && !noArenaCadence) ||
          (!idle && activeRunMode !== "campaign" &&
            (activeRunDaily.equals(SystemProgram.programId) || activeRunDeadlineAt <= 0))) {
        throw new Error("PlayerState active reservation fields are inconsistent");
      }
      return {
        address: loaded.address,
        owner,
        nextRunId,
        activeRunId,
        activeRunDaily,
        activeRunMode,
        activeRunDeadlineAt,
        orphanRunId,
      };
    });
  }

  private async loadRuns(
    players: readonly PlayerStateRecord[],
    dailies: readonly { loaded: LoadedAccount; snapshot: DailySnapshot }[],
  ): Promise<RunSnapshot[]> {
    const dailyByAddress = new Map(
      dailies.map(({ loaded, snapshot }) => [loaded.address.toBase58(), snapshot]),
    );
    const output: RunSnapshot[] = [];
    for (const player of players) {
      if (player.activeRunId !== 0n) {
        try {
          output.push(await this.loadRun(player, player.activeRunId, true, dailyByAddress));
        } catch (error) {
          if (player.activeRunMode === "campaign" ||
              this.input.nowUnix < player.activeRunDeadlineAt + RUN_RECOVERY_SECONDS) {
            throw error;
          }
          const daily = dailyByAddress.get(player.activeRunDaily.toBase58());
          if (!daily) throw new Error("unavailable run references an undiscovered Daily");
          const ranked = player.activeRunMode === "ranked";
          const arenaPlayerExists = ranked
            ? await this.loadArenaPlayerExists(player.activeRunDaily, player.owner)
            : false;
          output.push({
            owner: player.owner,
            runId: player.activeRunId,
            mode: player.activeRunMode,
            challengeDayId: daily.dayId,
            deadlineDayId: ranked ? daily.dayId : daily.dayId + 1,
            arenaPlayerExists,
            lifecycle: "unavailable",
            location: "unavailable",
            acceptedActions: 0,
            runsCloseAt: player.activeRunDeadlineAt,
            recoveryDeadlineAt: player.activeRunDeadlineAt + RUN_RECOVERY_SECONDS,
            reservationActive: true,
          });
        }
      }
      if (player.orphanRunId !== 0n) {
        try {
          output.push(await this.loadRun(player, player.orphanRunId, false, dailyByAddress));
        } catch {
          // The durable orphan remains non-scoreable; retry Router discovery.
        }
      }
    }
    return output;
  }

  private async loadRun(
    player: PlayerStateRecord,
    runId: bigint,
    reservationActive: boolean,
    dailyByAddress: ReadonlyMap<string, DailySnapshot>,
  ): Promise<RunSnapshot> {
    const address = activeRunPda(player.owner, runId);
    const status = await getDelegationStatus(
      address,
      this.input.routerEndpoint,
      this.input.fetcher,
    );
    let connection = this.input.connection;
    let location: "base" | "ephemeral_rollup" = "base";
    if (status.isDelegated) {
      if (!status.fqdn || status.delegationRecord?.owner !== ZKUBE_PROGRAM_ID.toBase58()) {
        throw new Error("ActiveRun delegation record is incomplete or foreign");
      }
      connection = this.input.connectionFactory?.(status.fqdn) ??
        new Connection(status.fqdn, "confirmed");
      location = "ephemeral_rollup";
    }
    const info = await connection.getAccountInfo(address, "confirmed");
    if (!info) throw new Error("ActiveRun is missing at its resolved location");
    const loaded = this.decodeAccount(
      "activeRun",
      address,
      info,
      PROTOCOL_ACCOUNT_VERSION,
      address,
    );
    const owner = publicKey(loaded.value.owner, "ActiveRun owner");
    const decodedRunId = bigint(loaded.value.runId, "ActiveRun run id");
    if (!owner.equals(player.owner) || decodedRunId !== runId) {
      throw new Error("ActiveRun identity is invalid");
    }
    const mode = runMode(loaded.value.mode, "ActiveRun mode");
    const deadlineAt = signedTimestamp(loaded.value.deadlineAt, "ActiveRun deadline");
    const dailyAddress = publicKey(loaded.value.dailyChallenge, "ActiveRun Daily");
    if (reservationActive &&
        (mode !== player.activeRunMode || !dailyAddress.equals(player.activeRunDaily) ||
          deadlineAt !== player.activeRunDeadlineAt)) {
      throw new Error("ActiveRun does not match its durable reservation");
    }
    if (mode === "campaign") {
      if (!dailyAddress.equals(SystemProgram.programId) || deadlineAt !== 0) {
        throw new Error("Campaign ActiveRun carries Arena cadence state");
      }
      return {
        owner,
        runId,
        mode,
        arenaPlayerExists: false,
        lifecycle: runLifecycle(loaded.value.lifecycle, "ActiveRun lifecycle"),
        location,
        acceptedActions: u32(loaded.value.actionCounter, "ActiveRun action counter"),
        reservationActive,
      };
    }
    const daily = dailyByAddress.get(dailyAddress.toBase58());
    if (!daily) throw new Error("ActiveRun references an undiscovered Daily");
    const arenaPlayerExists = await this.loadArenaPlayerExists(dailyAddress, owner);
    if (mode === "ranked" && !arenaPlayerExists) {
      throw new Error("ranked ActiveRun is missing its ArenaPlayer");
    }
    const deadlineDayId = mode === "ranked" ? daily.dayId : daily.dayId + 1;
    return {
      owner,
      runId,
      mode,
      challengeDayId: daily.dayId,
      deadlineDayId,
      arenaPlayerExists,
      lifecycle: runLifecycle(loaded.value.lifecycle, "ActiveRun lifecycle"),
      location,
      acceptedActions: u32(loaded.value.actionCounter, "ActiveRun action counter"),
      runsCloseAt: deadlineAt,
      recoveryDeadlineAt: deadlineAt + RUN_RECOVERY_SECONDS,
      reservationActive,
    };
  }

  private async loadArenaPlayerExists(daily: PublicKey, owner: PublicKey): Promise<boolean> {
    const address = arenaPlayerPda(daily, owner);
    const info = await this.input.connection.getAccountInfo(address, "confirmed");
    if (!info) return false;
    const loaded = this.decodeAccount(
      "arenaPlayer",
      address,
      info,
      ARCADE_ACCOUNT_VERSION,
      address,
    );
    requirePublicKey(loaded.value, "challenge", daily, "ArenaPlayer challenge");
    requirePublicKey(loaded.value, "player", owner, "ArenaPlayer owner");
    return true;
  }

  private async rankedSettlement(
    entries: readonly unknown[],
    potLamports: bigint,
    competition: "daily" | "season",
  ): Promise<SettlementSnapshot> {
    const winners = entries.slice(0, 5).map((entry, index) => ({
      owner: publicKey(record(entry, `${competition} entry`).player, `${competition} winner`),
      rank: index + 1,
    }));
    const plan = winners.length > 0
      ? payoutPlan(potLamports, [45, 25, 15, 10, 5], winners.length)
      : { payouts: [], paidLamports: 0n, rolloverLamports: potLamports };
    const valid = await this.walletValidity(winners.map(({ owner }) => owner));
    return {
      winners: winners.map(({ owner, rank }, index) => ({
        owner,
        rank,
        payoutLamports: plan.payouts[index] ?? 0n,
        destinationValid: valid[index] ?? false,
      })),
      rolloverLamports: plan.rolloverLamports,
    };
  }

  private async weeklySettlement(
    value: Record<string, unknown>,
    potLamports: bigint,
  ): Promise<SettlementSnapshot> {
    const budgetPlan = equalBudgetPlan(potLamports, 3);
    const positions: Array<Omit<WinnerSnapshot, "destinationValid">> = [];
    const boardFields = ["comboEntries", "actionEntries", "runEntries"] as const;
    for (const [bountyIndex, field] of boardFields.entries()) {
      const board = array(value[field], `WeeklyJackpot ${field}`)
        .map((entry) => record(entry, `WeeklyJackpot ${field} entry`))
        .slice(0, 3);
      const winnerCount = board.findIndex(
        (entry) => bigint(entry.value, "Weekly metric value") === 0n,
      );
      const winners = winnerCount === -1 ? board : board.slice(0, winnerCount);
      const plan = winners.length > 0
        ? payoutPlan(budgetPlan.budgets[bountyIndex]!, [60, 25, 15], winners.length)
        : { payouts: [], paidLamports: 0n, rolloverLamports: budgetPlan.budgets[bountyIndex]! };
      winners.forEach((entry, rank) => positions.push({
        owner: publicKey(entry.player, "Weekly winner"),
        payoutLamports: plan.payouts[rank] ?? 0n,
        rank: rank + 1,
        bountyIndex: bountyIndex as 0 | 1 | 2,
      }));
    }
    const valid = await this.walletValidity(positions.map(({ owner }) => owner));
    const payouts = positions.reduce((sum, winner) => sum + winner.payoutLamports, 0n);
    return {
      winners: positions.map((winner, index) => ({
        ...winner,
        destinationValid: valid[index] ?? false,
      })),
      rolloverLamports: potLamports - payouts,
    };
  }

  private async walletValidity(owners: readonly PublicKey[]): Promise<boolean[]> {
    const infos = await this.getMultiple(owners);
    return infos.map((info) => !!info && !info.executable &&
      info.owner.equals(SystemProgram.programId) && info.data.length === 0);
  }

  private async assertSpendable(
    account: AccountInfo<Buffer>,
    accountedLamports: bigint,
    label: string,
  ): Promise<void> {
    let rent = this.rentBySize.get(account.data.length);
    if (rent === undefined) {
      rent = await this.input.connection.getMinimumBalanceForRentExemption(
        account.data.length,
        "confirmed",
      );
      this.rentBySize.set(account.data.length, rent);
    }
    const spendable = BigInt(account.lamports - rent);
    if (account.lamports < rent || spendable < accountedLamports) {
      throw new Error(`${label} lamports do not cover rent and its accounted pool`);
    }
  }

  private async loadRequired(
    name: string,
    address: PublicKey,
    version: number,
  ): Promise<LoadedAccount> {
    const info = await this.input.connection.getAccountInfo(address, "confirmed");
    if (!info) throw new Error(`${name} account is missing`);
    return this.decodeAccount(name, address, info, version, address);
  }

  private async loadKnown(
    name: string,
    items: readonly { id: number; address: PublicKey }[],
    version: number,
  ): Promise<LoadedAccount[]> {
    const infos = await this.getMultiple(items.map(({ address }) => address));
    return items.flatMap((item, index) => {
      const info = infos[index];
      return info
        ? [this.decodeAccount(name, item.address, info, version, item.address)]
        : [];
    });
  }

  private async scanAccounts(
    name: string,
    version: number,
    maximum: number,
    extraFilters: readonly GetProgramAccountsFilter[] = [],
  ): Promise<LoadedAccount[]> {
    const discriminator = this.accountsCoder.accountDiscriminator(name);
    const accounts = await this.input.connection.getProgramAccounts(ZKUBE_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [
        { memcmp: { offset: 0, bytes: base58(discriminator) } },
        ...extraFilters,
      ],
    });
    if (accounts.length > maximum) {
      throw new Error(`${name} discovery exceeded its fail-closed account bound`);
    }
    return accounts.map(({ pubkey, account }) => this.decodeAccount(
      name,
      pubkey,
      { ...account, data: Buffer.from(account.data) },
      version,
    ));
  }

  private decodeAccount(
    name: string,
    address: PublicKey,
    info: AccountInfo<Buffer>,
    version: number,
    expectedAddress?: PublicKey,
  ): LoadedAccount {
    if ((expectedAddress && !address.equals(expectedAddress)) ||
        !info.owner.equals(ZKUBE_PROGRAM_ID) || info.executable ||
        info.data.length < 9 || info.data.length >= MAX_PROGRAM_ACCOUNT_BYTES ||
        !info.data.subarray(0, 8).equals(this.accountsCoder.accountDiscriminator(name)) ||
        info.data[8] !== version) {
      throw new Error(`${name} owner, size, discriminator, version, or PDA is invalid`);
    }
    let decoded: unknown;
    try {
      decoded = this.accountsCoder.decode(name, info.data);
    } catch {
      throw new Error(`${name} data is malformed`);
    }
    return { address, account: info, value: record(decoded, name) };
  }

  private async getMultiple(
    addresses: readonly PublicKey[],
  ): Promise<Array<AccountInfo<Buffer> | null>> {
    const output: Array<AccountInfo<Buffer> | null> = [];
    for (let start = 0; start < addresses.length; start += MAX_RPC_ACCOUNT_BATCH) {
      const batch = addresses.slice(start, start + MAX_RPC_ACCOUNT_BATCH);
      const infos = await this.input.connection.getMultipleAccountsInfo(batch, "confirmed");
      if (infos.length !== batch.length) {
        throw new Error("RPC returned an incomplete account batch");
      }
      output.push(...infos);
    }
    return output;
  }
}

function assertIdlInterface(idl: Idl): void {
  const idlRecord = idl as unknown as Record<string, unknown>;
  const accounts = array(idlRecord.accounts, "Anchor IDL accounts")
    .map((value) => record(value, "Anchor IDL account"));
  const instructions = array(idlRecord.instructions, "Anchor IDL instructions")
    .map((value) => record(value, "Anchor IDL instruction"));
  const accountNames = new Set(accounts.map(({ name }) => name));
  const instructionNames = new Set(instructions.map(({ name }) => name));
  for (const name of REQUIRED_ACCOUNTS) {
    if (!accountNames.has(name)) throw new Error(`checked-in Anchor IDL is missing ${name}`);
  }
  for (const name of REQUIRED_INSTRUCTIONS) {
    if (!instructionNames.has(name)) {
      throw new Error(`checked-in Anchor IDL is missing ${name}`);
    }
  }
}

function instructionRecord(idl: Idl, name: string): {
  accounts: readonly unknown[];
} {
  const idlRecord = idl as unknown as Record<string, unknown>;
  const instruction = array(idlRecord.instructions, "Anchor IDL instructions")
    .map((value) => record(value, "Anchor IDL instruction"))
    .find((value) => value.name === name);
  if (!instruction) throw new Error(`Anchor IDL instruction ${name} is missing`);
  return { accounts: array(instruction.accounts, `${name} accounts`) };
}

function availableLedgerLamports(value: unknown, label: string): bigint {
  const ledger = record(value, `${label} ledger`);
  const funded = checkedU64Add(
    checkedU64Add(
      bigint(ledger.seededLamports, `${label} seeded lamports`),
      bigint(ledger.entryLamports, `${label} entry lamports`),
      label,
    ),
    bigint(ledger.rolloverInLamports, `${label} rollover in`),
    label,
  );
  const accountedOut = checkedU64Add(
    bigint(ledger.payoutLamports, `${label} payout lamports`),
    bigint(ledger.rolloverOutLamports, `${label} rollover out`),
    label,
  );
  if (accountedOut > funded) throw new Error(`${label} ledger is overdrawn`);
  return funded - accountedOut;
}

function checkedU64Add(left: bigint, right: bigint, label: string): bigint {
  const value = left + right;
  if (value > 0xffff_ffff_ffff_ffffn) throw new Error(`${label} ledger overflows u64`);
  return value;
}

function periodStatus(value: unknown, label: string): PeriodStatus {
  const variant = enumVariant(value, label);
  if (variant !== "funding" && variant !== "open" && variant !== "finalized") {
    throw new Error(`${label} is invalid`);
  }
  return variant;
}

function runMode(value: unknown, label: string): "campaign" | "ranked" | "practice" {
  const variant = enumVariant(value, label);
  if (variant === "campaign") return "campaign";
  if (variant === "daily") return "ranked";
  if (variant === "practice") return "practice";
  throw new Error(`${label} is invalid`);
}

function runLifecycle(value: unknown, label: string): RunLifecycle {
  const variant = enumVariant(value, label);
  if (variant === "prepared" || variant === "delegated" || variant === "playing") {
    return variant;
  }
  if (variant === "awaitingVrf") return "awaiting_vrf";
  if (variant === "levelComplete" || variant === "finished") return "terminal";
  throw new Error(`${label} is invalid`);
}

function enumVariant(value: unknown, label: string): string {
  const object = record(value, label);
  const keys = Object.keys(object);
  if (keys.length !== 1) throw new Error(`${label} is malformed`);
  return keys[0]!;
}

function requirePublicKey(
  value: Record<string, unknown>,
  field: string,
  expected: PublicKey,
  label: string,
): void {
  if (!publicKey(value[field], label).equals(expected)) {
    throw new Error(`${label} relationship is invalid`);
  }
}

function requireBigInt(
  value: Record<string, unknown>,
  field: string,
  expected: bigint,
  label: string,
): void {
  if (bigint(value[field], label) !== expected) {
    throw new Error(`${label} is invalid`);
  }
}

function publicKey(value: unknown, label: string): PublicKey {
  if (value instanceof PublicKey) return value;
  if (typeof value === "string") {
    try {
      return new PublicKey(value);
    } catch {
      throw new Error(`${label} is not a Solana public key`);
    }
  }
  throw new Error(`${label} is not a Solana public key`);
}

function bigint(value: unknown, label: string): bigint {
  try {
    const parsed = typeof value === "bigint"
      ? value
      : typeof value === "number" && Number.isSafeInteger(value)
        ? BigInt(value)
        : isRecord(value) && typeof value.toString === "function"
          ? BigInt(String(value))
          : typeof value === "string"
            ? BigInt(value)
            : -1n;
    if (parsed < 0n || parsed > 0xffff_ffff_ffff_ffffn) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} is outside u64`);
  }
}

function signedTimestamp(value: unknown, label: string): number {
  let parsed: bigint;
  try {
    parsed = typeof value === "bigint" ? value : BigInt(String(value));
  } catch {
    throw new Error(`${label} is invalid`);
  }
  const number = Number(parsed);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label} is invalid`);
  return number;
}

function timestamp(value: unknown, label: string): number {
  const parsed = signedTimestamp(value, label);
  if (parsed === 0) throw new Error(`${label} must be positive`);
  return parsed;
}

function u8(value: unknown, label: string): number {
  const parsed = safeInteger(value, label);
  if (parsed > 0xff) throw new Error(`${label} is outside u8`);
  return parsed;
}

function u32(value: unknown, label: string): number {
  const parsed = safeInteger(value, label);
  assertCadenceId(parsed, label);
  return parsed;
}

function safeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} is invalid`);
  }
  return Number(value);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} is invalid`);
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} is not an object`);
  return value;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is not an array`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function range(first: number, lastInclusive: number): number[] {
  assertCadenceId(first, "cadence range start");
  assertCadenceId(lastInclusive, "cadence range end");
  if (lastInclusive < first || lastInclusive - first >= MAX_CADENCE_PERIODS) {
    throw new Error("cadence discovery range is invalid or unbounded");
  }
  return Array.from({ length: lastInclusive - first + 1 }, (_, index) => first + index);
}

function checkedNext(value: number, label: string): number {
  assertCadenceId(value, label);
  if (value === 0xffff_ffff) throw new Error(`${label} successor overflows u32`);
  return value + 1;
}

function requiredRulesCatalog(value: PublicKey | undefined): PublicKey {
  if (!value) throw new Error("IDL materializer has no validated rules catalog");
  return value;
}

function requiredOwner(value: PublicKey | undefined): PublicKey {
  if (!value) throw new Error("IDL materializer is missing run/player owner");
  return value;
}

function requiredRunId(value: bigint | undefined): bigint {
  if (value === undefined || value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error("IDL materializer is missing a valid run id");
  }
  return value;
}

function requiredNumber(value: number | undefined, label: string): number {
  if (value === undefined) throw new Error(`IDL materializer is missing ${label}`);
  assertCadenceId(value, label);
  return value;
}

function base58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)]! + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded || "1";
}
