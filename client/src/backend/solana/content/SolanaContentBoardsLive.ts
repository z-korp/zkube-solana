import { Effect, Layer, Schedule, Stream } from "effect";
import { PublicKey, type Connection } from "@solana/web3.js";

import { ZKUBE_PROGRAM_ID } from "../constants";
import { deriveArenaBoardPda, deriveArenaDailyPda } from "../pdas";
import {
  CAMPAIGN_CONTENT_VERSION,
  CANONICAL_CAMPAIGN_MAP_COUNT,
} from "@/core/campaignCatalog";
import { dailyContentFromPairIndex } from "@/core/dailyRules";
import {
  PRESSURE_STEP,
  TIER_BLOCK_WEIGHTS,
  DAILY_REWARD_CLAIM_WINDOW_SECONDS,
} from "@/core/protocolVersions.generated";
import {
  coreDailyBoardPools,
  coreDailyPairIndex,
  corePayoutForRank,
  initializeZkubeCore,
} from "@/core/zkubeCore";
import { BoardsUnavailable, ContentUnavailable } from "../../errors";
import {
  Boards,
  Content,
  type BoardsService,
  type ContentService,
} from "../../services";
import {
  PlayerAddress,
  type BoardKind,
  type BoardRow,
  type BoardState,
  type CampaignCatalog,
  type DailyContent,
  type TierTable,
} from "../../views";
import {
  SolanaIdentitySessionState,
} from "../SolanaIdentitySessionLive";
import { createReadOnlyWallet } from "../identity/readOnlyWallet";
import { watchAccount } from "../watch";
import {
  fetchCampaignView,
  fetchPlayerBoardDecorations,
  type CampaignView,
} from "./campaignClient";
import {
  currentDailyDayId,
  fetchArcadeSuspendedUntilDay,
  fetchDailyBoardAccount,
  fetchDailyView,
  type DailyBoardAccountView,
  type DailyLeaderboardView,
  type DailyView,
} from "./dailyClient";

export interface SolanaContentBoardsOptions {
  readonly connection: Connection;
  readonly nowUnix?: () => number;
}

/** Unwired Content and Boards slice; composed only after Economy exists. */
export function makeSolanaContentBoardsLive(
  options: SolanaContentBoardsOptions,
): Layer.Layer<Content | Boards, never, SolanaIdentitySessionState> {
  return Layer.scopedContext(
    Effect.gen(function* () {
      const identity = yield* SolanaIdentitySessionState;
      const nowUnix = options.nowUnix ?? (() => Math.floor(Date.now() / 1_000));
      const readOnly = () =>
        createReadOnlyWallet(
          identity.binding()?.wallet.publicKey ?? ZKUBE_PROGRAM_ID,
        );
      const loadToday = () =>
        projectToday({
          connection: options.connection,
          wallet: readOnly(),
          nowUnix: nowUnix(),
        });
      const todayChanges = yield* Stream.repeatEffectWithSchedule(
        Effect.tryPromise({
          try: loadToday,
          catch: asContentError,
        }),
        Schedule.spaced("30 seconds"),
      ).pipe(
        Stream.changes,
        Stream.share({ capacity: 1, replay: 1 }),
      );

      const content: ContentService = {
        today: () =>
          Effect.tryPromise({ try: loadToday, catch: asContentError }),
        catalog: () =>
          Effect.tryPromise({
            try: async () => {
              const campaign = await fetchCampaignView({
                connection: options.connection,
                wallet: readOnly(),
              });
              if (!campaign) throw new Error("Campaign catalog is unavailable");
              return projectSolanaCatalog(campaign);
            },
            catch: asContentError,
          }),
        tierTable: () => Effect.succeed(projectSolanaTierTable()),
        todayChanges,
      };

      const loadBoards = (dayId: number) =>
        Effect.tryPromise({
          try: async () => {
            const daily = await fetchDailyView({
              connection: options.connection,
              wallet: readOnly(),
              dayId,
            });
            if (!daily) throw new Error(`Daily ${dayId} is unavailable`);
            const accounts = await Promise.all(
              (["score", "theme"] as const).map((kind) =>
                fetchDailyBoardAccount(
                  options.connection,
                  daily.address,
                  dayId,
                  kind,
                ),
              ),
            );
            const decorations = await fetchPlayerBoardDecorations({
              connection: options.connection,
              wallet: readOnly(),
              owners: accounts.flatMap((account) =>
                (account?.rows ?? []).map((row) => row.player),
              ),
            });
            await initializeZkubeCore();
            return projectSolanaBoards({
              daily,
              accounts,
              decorations,
              owner: identity.binding()?.wallet.publicKey ?? null,
              nowUnix: nowUnix(),
            });
          },
          catch: asBoardsError,
        });

      const watchedToday = currentDailyDayId(nowUnix());
      const todayBoards = yield* boardWatchSource({
        connection: options.connection,
        dayId: watchedToday,
        load: () => loadBoards(watchedToday),
      }).pipe(Stream.share({ capacity: 4, replay: 2 }));
      const boards: BoardsService = {
        boards: loadBoards,
        yourRows: (dayId) =>
          loadBoards(dayId).pipe(
            Effect.map((states) =>
              states.flatMap((state) =>
                state.yourRow ? [state.yourRow] : [],
              ),
            ),
          ),
        watch: (dayId) =>
          dayId === watchedToday
            ? todayBoards
            : Stream.fromEffect(loadBoards(dayId)).pipe(
                Stream.flatMap(Stream.fromIterable),
              ),
      };

      return Layer.merge(
        Layer.succeed(Content, content),
        Layer.succeed(Boards, boards),
      ).pipe(Layer.build);
    }),
  );
}

function boardWatchSource(args: {
  connection: Connection;
  dayId: number;
  load: () => Effect.Effect<ReadonlyArray<BoardState>, BoardsUnavailable>;
}) {
  const daily = deriveArenaDailyPda(args.dayId);
  const accountChanges = Stream.merge(
    watchAccount({
      connection: args.connection,
      address: daily,
      decode: () => undefined,
      fallbackPollMs: 5_000,
    }),
    Stream.merge(
      watchAccount({
        connection: args.connection,
        address: deriveArenaBoardPda(daily, "score"),
        decode: () => undefined,
        fallbackPollMs: 5_000,
      }),
      watchAccount({
        connection: args.connection,
        address: deriveArenaBoardPda(daily, "theme"),
        decode: () => undefined,
        fallbackPollMs: 5_000,
      }),
    ),
  );
  return accountChanges.pipe(
    Stream.mapEffect(() => args.load()),
    Stream.flatMap(Stream.fromIterable),
  );
}

async function projectToday(args: {
  connection: Connection;
  wallet: ReturnType<typeof createReadOnlyWallet>;
  nowUnix: number;
}): Promise<DailyContent> {
  const dayId = currentDailyDayId(args.nowUnix);
  const [daily, suspendedUntilDay] = await Promise.all([
    fetchDailyView({ connection: args.connection, wallet: args.wallet, dayId }),
    fetchArcadeSuspendedUntilDay({
      connection: args.connection,
      wallet: args.wallet,
    }),
  ]);
  if (daily) {
    return projectSolanaDailyContent(daily, dayId < suspendedUntilDay);
  }
  if (dayId >= suspendedUntilDay) {
    throw new Error(`Daily ${dayId} has not been prepared`);
  }
  const pair = dailyContentFromPairIndex(dayId, await coreDailyPairIndex(dayId));
  const campaign = await fetchCampaignView({
    connection: args.connection,
    wallet: args.wallet,
  });
  const realm = campaign?.maps.find((map) => map.mapId === pair.realmMapId);
  if (!realm) throw new Error("Suspended Daily realm is unavailable");
  return {
    dayId,
    realm: pair.realmMapId,
    objective: pair.objective,
    startingHeight: realm.levels[0]?.startingRows ?? 0,
    opensAt: dayId * 86_400,
    freezesAt: dayId * 86_400 + 86_399,
    suspended: true,
  };
}

export function projectSolanaDailyContent(
  daily: DailyView,
  suspended: boolean,
): DailyContent {
  return {
    dayId: daily.dayId,
    realm: daily.mapId,
    objective: {
      kind: daily.dailyTheme.kind,
      value: daily.dailyTheme.value,
    },
    startingHeight: daily.rules.startingRows,
    opensAt: daily.opensAt,
    freezesAt: daily.runsCloseAt,
    suspended,
  };
}

export function projectSolanaCatalog(view: CampaignView): CampaignCatalog {
  if (
    view.contentVersion !== CAMPAIGN_CONTENT_VERSION ||
    view.maps.length !== CANONICAL_CAMPAIGN_MAP_COUNT
  ) {
    throw new Error("Campaign catalog identity is invalid");
  }
  return {
    contentVersion: view.contentVersion,
    realms: view.maps.map((map) => ({
      realm: map.mapId,
      theme: map.themeId,
      guardian: { ...map.levels[0]!.guardian },
      startingHeight: map.levels[0]!.startingRows,
      levels: map.levels.map((level, index) => ({
        level: index + 1,
        tier: level.difficulty,
        target: level.pointsRequired,
        moveBudget: level.maxMoves,
        primary: { ...level.primary },
        secondary: { ...level.secondary },
      })),
    })),
  };
}

export function projectSolanaTierTable(): TierTable {
  return {
    pressureStep: PRESSURE_STEP,
    blockWeights: TIER_BLOCK_WEIGHTS.map((row) => [...row]),
  };
}

export function projectSolanaBoards(args: {
  daily: DailyView;
  accounts: readonly [
    DailyBoardAccountView | null,
    DailyBoardAccountView | null,
  ];
  owner: PublicKey | null;
  nowUnix: number;
  decorations?: ReadonlyMap<string, { emblem: number; tier: number }>;
}): ReadonlyArray<BoardState> {
  const pools = coreDailyBoardPools(
    args.daily.dailyPotLamports,
    args.daily.themeQualifiedPlayers,
  );
  return (["score", "theme"] as const).map((kind, index) => {
    const account = args.accounts[index];
    const labels = new Map(
      (kind === "score"
        ? args.daily.leaderboard
        : args.daily.themeLeaderboard
      ).map((row) => [row.player.toBase58(), row.playerName]),
    );
    const rows = (account?.rows ?? []).map((row, position) =>
      projectBoardRow({
        row,
        kind,
        position,
        denominator: account?.denominator ?? 0n,
        poolLamports: account?.poolLamports ?? 0n,
        label: labels.get(row.player.toBase58()) ?? null,
        decoration: args.decorations?.get(row.player.toBase58()),
      }),
    );
    const yourRow = args.owner
      ? rows.find((row) => row.address === args.owner!.toBase58())
      : undefined;
    return {
      dayId: args.daily.dayId,
      kind,
      status: boardStatus(args.daily, account, args.nowUnix),
      potLamports: account?.poolLamports ?? pools[kind],
      rows,
      ...(yourRow ? { yourRow } : {}),
    };
  });
}

function projectBoardRow(args: {
  row: DailyLeaderboardView;
  kind: BoardKind;
  position: number;
  denominator: bigint;
  poolLamports: bigint;
  label: string | null;
  decoration?: { emblem: number; tier: number };
}): BoardRow {
  const rank = args.position + 1;
  return {
    address: PlayerAddress.make(args.row.player.toBase58()),
    ...(args.label ? { label: args.label } : {}),
    ...(args.decoration
      ? { emblem: args.decoration.emblem, tier: args.decoration.tier }
      : {}),
    metric:
      args.kind === "score"
        ? BigInt(args.row.dailyScore)
        : args.row.objectiveTotal,
    rank,
    payoutLamports:
      args.denominator === 0n
        ? 0n
        : corePayoutForRank(args.poolLamports, args.denominator, rank),
  };
}

function boardStatus(
  daily: DailyView,
  account: DailyBoardAccountView | null,
  nowUnix: number,
): BoardState["status"] {
  if (account?.sealed) {
    return nowUnix >
      account.sealedAt + DAILY_REWARD_CLAIM_WINDOW_SECONDS
      ? "expired"
      : "sealed";
  }
  if (daily.status === "funding") return "funding";
  if (daily.status === "open" && nowUnix < daily.runsCloseAt) return "open";
  return "frozen";
}

function asContentError(cause: unknown): ContentUnavailable {
  return new ContentUnavailable({ message: message(cause) });
}

function asBoardsError(cause: unknown): BoardsUnavailable {
  return new BoardsUnavailable({ message: message(cause) });
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
