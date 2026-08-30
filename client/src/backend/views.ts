import { Schema } from "effect";

export const PlayerAddress = Schema.String.pipe(Schema.brand("PlayerAddress"));
export type PlayerAddress = typeof PlayerAddress.Type;

export const WalletChoice = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  platform: Schema.Literal("browser", "android", "ios"),
});
export type WalletChoice = typeof WalletChoice.Type;

export const IdentityState = Schema.Struct({
  status: Schema.Literal("disconnected", "connecting", "connected"),
  address: Schema.optional(PlayerAddress),
  label: Schema.optional(Schema.String),
  wallet: Schema.optional(WalletChoice),
});
export type IdentityState = typeof IdentityState.Type;

export const SessionState = Schema.Struct({
  status: Schema.Literal("none", "live", "expiring", "expired"),
  expiresAt: Schema.Number,
  floatLamports: Schema.BigIntFromSelf,
});
export type SessionState = typeof SessionState.Type;

export const RunMode = Schema.Literal("campaign", "arcade");
export type RunMode = typeof RunMode.Type;

export const RunPhase = Schema.Literal(
  "playing",
  "awaitingVrf",
  "levelComplete",
  "finished",
);
export type RunPhase = typeof RunPhase.Type;

export const RunFinishReason = Schema.Literal(
  "abandon",
  "deadline",
  "levelComplete",
  "overflow",
  "moveBudget",
);
export type RunFinishReason = typeof RunFinishReason.Type;

export const RunView = Schema.Struct({
  mode: RunMode,
  runId: Schema.String,
  token: Schema.Uint8ArrayFromSelf,
  phase: RunPhase,
  deadlineAt: Schema.optional(Schema.Number),
  finishReason: Schema.optional(RunFinishReason),
});
export type RunView = typeof RunView.Type;

export const ConstraintView = Schema.Struct({
  kind: Schema.Number,
  value: Schema.Number,
  requiredCount: Schema.Number,
});
export type ConstraintView = typeof ConstraintView.Type;

export const GuardianView = Schema.Struct({
  bonus: Schema.Number,
  trigger: Schema.Number,
  threshold: Schema.Number,
});
export type GuardianView = typeof GuardianView.Type;

export const CampaignLevelContent = Schema.Struct({
  level: Schema.Number,
  tier: Schema.Number,
  target: Schema.Number,
  moveBudget: Schema.Number,
  primary: ConstraintView,
  secondary: ConstraintView,
});
export type CampaignLevelContent = typeof CampaignLevelContent.Type;

export const CampaignRealmContent = Schema.Struct({
  realm: Schema.Number,
  theme: Schema.Number,
  guardian: GuardianView,
  startingHeight: Schema.Number,
  levels: Schema.Array(CampaignLevelContent),
});
export type CampaignRealmContent = typeof CampaignRealmContent.Type;

export const CampaignCatalog = Schema.Struct({
  contentVersion: Schema.Number,
  realms: Schema.Array(CampaignRealmContent),
});
export type CampaignCatalog = typeof CampaignCatalog.Type;

export const ObjectiveView = Schema.Struct({
  kind: Schema.Number,
  value: Schema.Number,
});
export type ObjectiveView = typeof ObjectiveView.Type;

export const DailyContent = Schema.Struct({
  dayId: Schema.Number,
  realm: Schema.Number,
  objective: ObjectiveView,
  startingHeight: Schema.Number,
  opensAt: Schema.Number,
  freezesAt: Schema.Number,
  suspended: Schema.Boolean,
});
export type DailyContent = typeof DailyContent.Type;

export const TierTable = Schema.Struct({
  pressureStep: Schema.Number,
  blockWeights: Schema.Array(Schema.Array(Schema.Number)),
});
export type TierTable = typeof TierTable.Type;

export const BoardKind = Schema.Literal("score", "theme");
export type BoardKind = typeof BoardKind.Type;

export const BoardRow = Schema.Struct({
  address: PlayerAddress,
  label: Schema.optional(Schema.String),
  emblem: Schema.optional(Schema.Number),
  tier: Schema.optional(Schema.Number),
  metric: Schema.BigIntFromSelf,
  rank: Schema.Number,
  payoutLamports: Schema.BigIntFromSelf,
});
export type BoardRow = typeof BoardRow.Type;

export const BoardState = Schema.Struct({
  dayId: Schema.Number,
  kind: BoardKind,
  status: Schema.Literal("funding", "open", "frozen", "sealed", "expired"),
  potLamports: Schema.BigIntFromSelf,
  rows: Schema.Array(BoardRow),
  yourRow: Schema.optional(BoardRow),
});
export type BoardState = typeof BoardState.Type;

export const ClaimableReward = Schema.Struct({
  dayId: Schema.Number,
  board: BoardKind,
  lamports: Schema.BigIntFromSelf,
  expiresAt: Schema.Number,
});
export type ClaimableReward = typeof ClaimableReward.Type;

export const CompetitionRecord = Schema.Struct({
  bestPrizeRank: Schema.Number,
  podiums: Schema.Number,
  wins: Schema.Number,
  rewardsLamports: Schema.BigIntFromSelf,
});
export type CompetitionRecord = typeof CompetitionRecord.Type;

export const EconomyProfile = Schema.Struct({
  stars: Schema.Array(Schema.Number),
  ladderPoints: Schema.BigIntFromSelf,
  ladderTier: Schema.Number,
  highestTier: Schema.Number,
  wornEmblem: Schema.Number,
  wornBorder: Schema.Number,
  records: Schema.Struct({
    score: CompetitionRecord,
    theme: CompetitionRecord,
  }),
  streak: Schema.Number,
  bestScore: Schema.Number,
});
export type EconomyProfile = typeof EconomyProfile.Type;

export const EconomyState = Schema.Struct({
  kredits: Schema.BigIntFromSelf,
  claimable: Schema.Array(ClaimableReward),
  profile: EconomyProfile,
});
export type EconomyState = typeof EconomyState.Type;

const Prepared = Schema.Struct({ _tag: Schema.Literal("Prepared") });
const Delegated = Schema.Struct({ _tag: Schema.Literal("Delegated") });
const RowReady = Schema.Struct({ _tag: Schema.Literal("RowReady") });
const ActionAccepted = Schema.Struct({
  _tag: Schema.Literal("ActionAccepted"),
  kind: Schema.Literal("move", "bonus", "reroll", "finish"),
  index: Schema.Number,
  token: Schema.Uint8ArrayFromSelf,
});
const ActionRejected = Schema.Struct({
  _tag: Schema.Literal("ActionRejected"),
  reason: Schema.String,
});
const AwaitingRow = Schema.Struct({
  _tag: Schema.Literal("AwaitingRow"),
  since: Schema.Number,
});
const RerollPending = Schema.Struct({ _tag: Schema.Literal("RerollPending") });
const Finished = Schema.Struct({
  _tag: Schema.Literal("Finished"),
  reason: RunFinishReason,
});
const Committed = Schema.Struct({ _tag: Schema.Literal("Committed") });
const Consumed = Schema.Struct({ _tag: Schema.Literal("Consumed") });
const Expired = Schema.Struct({ _tag: Schema.Literal("Expired") });
const Orphaned = Schema.Struct({ _tag: Schema.Literal("Orphaned") });

export const RunEvent = Schema.Union(
  Prepared,
  Delegated,
  RowReady,
  ActionAccepted,
  ActionRejected,
  AwaitingRow,
  RerollPending,
  Finished,
  Committed,
  Consumed,
  Expired,
  Orphaned,
);
export type RunEvent = typeof RunEvent.Type;

export const RunAction = Schema.Union(
  Schema.Struct({
    _tag: Schema.Literal("Move"),
    row: Schema.Number,
    start: Schema.Number,
    destination: Schema.Number,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Bonus"),
    row: Schema.Number,
    column: Schema.Number,
  }),
  Schema.Struct({ _tag: Schema.Literal("Reroll") }),
  Schema.Struct({
    _tag: Schema.Literal("Finish"),
    reason: Schema.Literal("abandon"),
  }),
);
export type RunAction = typeof RunAction.Type;

export const PUBLIC_VIEW_SCHEMAS = {
  IdentityState,
  WalletChoice,
  SessionState,
  RunView,
  DailyContent,
  BoardState,
  EconomyState,
  CampaignCatalog,
  TierTable,
} as const;
