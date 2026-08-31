import { Context, Effect, Stream } from "effect";

import type {
  BoardKind,
  BoardRow,
  BoardState,
  CampaignCatalog,
  DailyContent,
  EconomyState,
  IdentityState,
  PlayerAddress,
  RunAction,
  RunEvent,
  RunMode,
  RunView,
  SessionState,
  StoreEconomyState,
  TierTable,
  WalletChoice,
} from "./views";
import type {
  BoardsError,
  ContentError,
  EconomyError,
  IdentityError,
  RunsError,
  SessionError,
} from "./errors";

export interface IdentityService {
  readonly wallets: () => Effect.Effect<ReadonlyArray<WalletChoice>, IdentityError>;
  readonly connect: (walletId: string) => Effect.Effect<void, IdentityError>;
  readonly reconnect: () => Effect.Effect<void, IdentityError>;
  readonly disconnect: () => Effect.Effect<void, IdentityError>;
  readonly setLabel: (label: string) => Effect.Effect<void, IdentityError>;
  readonly state: Stream.Stream<IdentityState, IdentityError>;
}

export class Identity extends Context.Tag("zkube/backend/Identity")<
  Identity,
  IdentityService
>() {}

export interface SessionService {
  readonly ensure: () => Effect.Effect<SessionState, SessionError>;
  readonly fund: (lamports: bigint) => Effect.Effect<SessionState, SessionError>;
  readonly revoke: () => Effect.Effect<void, SessionError>;
  readonly state: Stream.Stream<SessionState, SessionError>;
}

export class Session extends Context.Tag("zkube/backend/Session")<
  Session,
  SessionService
>() {}

export interface RunsService {
  readonly startCampaign: (
    realm: number,
    level: number,
  ) => Effect.Effect<RunView, RunsError>;
  readonly enterDaily: () => Effect.Effect<RunView, RunsError>;
  readonly act: (
    runId: string,
    action: RunAction,
  ) => Effect.Effect<RunView, RunsError>;
  readonly resume: (mode: RunMode) => Effect.Effect<RunView | null, RunsError>;
  readonly spectate: (
    address: PlayerAddress,
    mode: RunMode,
  ) => Effect.Effect<RunView | null, RunsError>;
  readonly active: (mode: RunMode) => Effect.Effect<RunView | null, RunsError>;
  readonly events: (runId: string) => Stream.Stream<RunEvent, RunsError>;
}

export class Runs extends Context.Tag("zkube/backend/Runs")<Runs, RunsService>() {}

export interface ContentService {
  readonly today: () => Effect.Effect<DailyContent, ContentError>;
  readonly catalog: () => Effect.Effect<CampaignCatalog, ContentError>;
  readonly tierTable: () => Effect.Effect<TierTable, ContentError>;
  readonly todayChanges: Stream.Stream<DailyContent, ContentError>;
}

export class Content extends Context.Tag("zkube/backend/Content")<
  Content,
  ContentService
>() {}

export interface BoardsService {
  readonly boards: (dayId: number) => Effect.Effect<ReadonlyArray<BoardState>, BoardsError>;
  readonly yourRows: (dayId: number) => Effect.Effect<ReadonlyArray<BoardRow>, BoardsError>;
  readonly watch: (dayId: number) => Stream.Stream<BoardState, BoardsError>;
}

export class Boards extends Context.Tag("zkube/backend/Boards")<
  Boards,
  BoardsService
>() {}

export interface EconomyService {
  readonly buy: (pack: 1 | 10 | 25) => Effect.Effect<EconomyState, EconomyError>;
  readonly claim: (
    dayId: number,
    board: BoardKind,
  ) => Effect.Effect<EconomyState, EconomyError>;
  readonly setWorn: (
    emblem: number,
    border: number,
  ) => Effect.Effect<EconomyState, EconomyError>;
  readonly state: Stream.Stream<EconomyState, EconomyError>;
}

export class Economy extends Context.Tag("zkube/backend/Economy")<
  Economy,
  EconomyService
>() {}

export interface StoreEconomyService {
  readonly unlockCampaign: () => Effect.Effect<StoreEconomyState, EconomyError>;
  readonly restorePurchases: () => Effect.Effect<
    StoreEconomyState,
    EconomyError
  >;
  readonly state: Stream.Stream<StoreEconomyState, EconomyError>;
}

/** Store entitlement stays separate from Solana's Kredit and claim service. */
export class StoreEconomy extends Context.Tag("zkube/backend/StoreEconomy")<
  StoreEconomy,
  StoreEconomyService
>() {}

export type BackendServices =
  | Identity
  | Session
  | Runs
  | Content
  | Boards
  | Economy
  | StoreEconomy;
