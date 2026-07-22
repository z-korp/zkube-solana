import type { Connection } from "@solana/web3.js";
import type { WalletLike } from "./sessionWallet";
import { derivePlayerStatePda } from "./pdas";
import { PROTOCOL_ACCOUNT_VERSION } from "./protocolVersions.generated";
import { zkubeProgram } from "./runPlan";
import { currentWeeklyId } from "./weeklyClient";

export interface AchievementProgressView {
  index: number;
  metric: number;
  progress: bigint;
  threshold: bigint;
  xpReward: number;
  completed: boolean;
  active: boolean;
}

export interface QuestProgressView {
  index: number;
  metric: number;
  blockSize: number | null;
  cadence: "daily" | "weekly";
  progress: number;
  threshold: number;
  xpReward: number;
  active: boolean;
  completed: boolean;
}

interface LifetimeStatsView {
  runsStarted: bigint;
  linesCleared: bigint;
  maxCombo: number;
  bossesCleared: bigint;
  perfectLevels: bigint;
  dailyChallenges: bigint;
  bonusUses: bigint;
}

export interface ProgressView {
  lifetimeXp: bigint;
  lifetime: LifetimeStatsView;
  achievements: AchievementProgressView[];
  quests: QuestProgressView[];
}

export function progressCadenceIds(nowUnix: number): {
  day: number;
  week: number;
} {
  return {
    day: Math.max(0, Math.floor(nowUnix / 86_400)),
    week: currentWeeklyId(nowUnix),
  };
}

export async function fetchProgressView(args: {
  connection: Connection;
  wallet: WalletLike;
  nowUnix?: number;
}): Promise<ProgressView | null> {
  const program = zkubeProgram(args.connection, args.wallet);
  const owner = args.wallet.publicKey;
  const player = await program.account.playerState.fetchNullable(
    derivePlayerStatePda(owner),
  );
  if (!player) return null;
  const rawPlayer = player as unknown as {
    version: number;
    owner: { equals(other: typeof owner): boolean };
  };
  if (
    Number(rawPlayer.version) !== PROTOCOL_ACCOUNT_VERSION ||
    !rawPlayer.owner.equals(owner)
  ) {
    return null;
  }

  // Compatibility projection for the pre-redesign React tree. v4 deliberately
  // has no XP, quest, achievement, crest, rating, or general gameplay counters.
  // Keeping a zero/empty view here prevents the old UI from inventing local
  // progression while Claude replaces these consumers with the competitive
  // profile and Campaign-star views documented in README.md.
  return {
    lifetimeXp: 0n,
    lifetime: {
      runsStarted: 0n,
      linesCleared: 0n,
      maxCombo: 0,
      bossesCleared: 0n,
      perfectLevels: 0n,
      dailyChallenges: 0n,
      bonusUses: 0n,
    },
    achievements: [],
    quests: [],
  };
}
