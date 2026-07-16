import { SystemProgram, Transaction, type Connection, type PublicKey } from "@solana/web3.js";

import { ZKUBE_PROGRAM_ID } from "./constants.js";
import { fetchEconomyRuntime } from "./economyClient.js";
import {
  deriveDailyChallengePda,
  deriveDailyLeaderboardPda,
  deriveDailyPlayerPda,
  deriveEconomyConfigPda,
  derivePlayerFundingPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
  deriveWeeklyChallengePda,
  deriveWeeklyLeaderboardPda,
  deriveWeeklyPlayerPda,
} from "./pdas.js";
import { zkubeProgram, type TransactionPlan } from "./runPlan.js";
import type { WalletLike } from "./sessionWallet.js";
import type { DailyView } from "./dailyClient.js";

export type WeeklyStatus = "open" | "claimable" | "closed" | "unknown";

export interface WeeklyLeaderboardEntryView {
  player: PublicKey;
  score: number;
}

export interface WeeklyView {
  address: PublicKey;
  weekId: number;
  status: WeeklyStatus;
  opensAt: number;
  closesAt: number;
  finalizesAt: number;
  finalizedAt: number;
  claimsCloseAt: number;
  committedSolPool: bigint;
  solClaimed: bigint;
  participants: number;
  closedPlayers: number;
  solWinnerCount: number;
  starWinnerCount: number;
  rentRecipient: PublicKey;
  player: {
    score: number;
    resultCount: number;
    solClaimed: boolean;
    starsClaimed: boolean;
  } | null;
  leaderboard: WeeklyLeaderboardEntryView[];
}

export function currentWeeklyId(nowUnix = Math.floor(Date.now() / 1_000)): number {
  return Math.max(0, Math.floor((nowUnix + 259_200) / 604_800));
}

export async function fetchWeeklyView(args: {
  connection: Connection;
  wallet: WalletLike;
  weekId?: number;
}): Promise<WeeklyView | null> {
  const weekId = args.weekId ?? currentWeeklyId();
  const program = zkubeProgram(args.connection, args.wallet);
  const owner = args.wallet.publicKey;
  const address = deriveWeeklyChallengePda(weekId);
  const challenge = await program.account.weeklyChallenge.fetchNullable(address);
  if (!challenge) return null;
  const [player, leaderboard] = await Promise.all([
    program.account.weeklyPlayer.fetchNullable(
      deriveWeeklyPlayerPda(address, owner),
    ),
    program.account.weeklyLeaderboard.fetchNullable(
      deriveWeeklyLeaderboardPda(address),
    ),
  ]);
  return {
    address,
    weekId: Number(challenge.weekId),
    status: parseWeeklyStatus(challenge.status),
    opensAt: Number(challenge.opensAt),
    closesAt: Number(challenge.closesAt),
    finalizesAt: Number(challenge.finalizesAt),
    finalizedAt: Number(challenge.finalizedAt),
    claimsCloseAt: Number(challenge.claimsCloseAt),
    committedSolPool: BigInt(challenge.committedSolPool.toString()),
    solClaimed: BigInt(challenge.solClaimed.toString()),
    participants: Number(challenge.participants),
    closedPlayers: Number(challenge.closedPlayers),
    solWinnerCount: Number(challenge.solWinnerCount),
    starWinnerCount: Number(challenge.starWinnerCount),
    rentRecipient: challenge.rentRecipient,
    player: player
      ? {
          score: Number(player.score),
          resultCount: Number(player.resultCount),
          solClaimed: Boolean(player.solClaimed),
          starsClaimed: Boolean(player.starsClaimed),
        }
      : null,
    leaderboard: (leaderboard?.entries ?? []).map((entry) => ({
      player: entry.player,
      score: Number(entry.score),
    })),
  };
}

export async function buildOpenWeeklyPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  weekId: number;
  payer?: PublicKey;
}): Promise<TransactionPlan> {
  const runtime = await fetchEconomyRuntime(args);
  if (!runtime) throw new Error("Economy is not active");
  const caller = args.wallet.publicKey;
  const challenge = deriveWeeklyChallengePda(args.weekId);
  const instruction = await zkubeProgram(args.connection, args.wallet).methods
    .openWeeklyChallenge(args.weekId)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      economyConfig: deriveEconomyConfigPda(),
      weeklyChallenge: challenge,
      leaderboard: deriveWeeklyLeaderboardPda(challenge),
      rewardVault: runtime.rewardVault,
      payer: args.payer ?? caller,
      caller,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return plan("Open Weekly challenge", args.connection, args.payer ?? caller, instruction);
}

export async function buildRollupDailyPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  daily: DailyView;
  weekly: WeeklyView;
  playerOwner?: PublicKey;
}): Promise<TransactionPlan> {
  if (args.daily.economyVersion !== 2 || args.daily.weekId !== args.weekly.weekId) {
    throw new Error("Daily and Weekly cadence do not match");
  }
  const owner = args.playerOwner ?? args.wallet.publicKey;
  const caller = args.wallet.publicKey;
  const instruction = await zkubeProgram(args.connection, args.wallet).methods
    .fundedRollupDailyToWeekly()
    .accountsPartial({
      dailyChallenge: args.daily.address,
      dailyLeaderboard: deriveDailyLeaderboardPda(args.daily.address),
      dailyPlayer: deriveDailyPlayerPda(args.daily.address, owner),
      weeklyChallenge: args.weekly.address,
      weeklyPlayer: deriveWeeklyPlayerPda(args.weekly.address, owner),
      weeklyLeaderboard: deriveWeeklyLeaderboardPda(args.weekly.address),
      owner,
      playerFunding: derivePlayerFundingPda(owner),
      caller,
      systemProgram: SystemProgram.programId,
      zkubeProgram: ZKUBE_PROGRAM_ID,
    })
    .instruction();
  return plan("Roll Daily result into Weekly", args.connection, caller, instruction);
}

export async function fetchPendingDailyRollupOwners(args: {
  connection: Connection;
  wallet: WalletLike;
  daily: DailyView;
}): Promise<PublicKey[]> {
  if (args.daily.economyVersion !== 2 || args.daily.status !== "claimable") return [];
  const program = zkubeProgram(args.connection, args.wallet);
  const matches = await program.account.dailyPlayer.all([
    { memcmp: { offset: 9, bytes: args.daily.address.toBase58() } },
  ]);
  const owners: PublicKey[] = [];
  for (const match of matches) {
    const player = match.account as unknown as {
      version: number;
      challenge: PublicKey;
      player: PublicKey;
      bestRunId: { toString(): string };
      weeklyRolledUp: boolean;
    };
    if (
      Number(player.version) !== 1 ||
      !player.challenge.equals(args.daily.address) ||
      !match.publicKey.equals(deriveDailyPlayerPda(args.daily.address, player.player))
    ) {
      throw new Error("Daily rollup player relationship is invalid");
    }
    if (!player.weeklyRolledUp && BigInt(player.bestRunId.toString()) > 0n) {
      owners.push(player.player);
    }
  }
  return owners.sort((left, right) =>
    left.toBuffer().compare(right.toBuffer()),
  );
}

export async function buildFinalizeWeeklyPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  weekly: WeeklyView;
}): Promise<TransactionPlan> {
  const caller = args.wallet.publicKey;
  const startDay = args.weekly.weekId * 7 - 3;
  if (!Number.isSafeInteger(startDay) || startDay < 0) {
    throw new Error("Weekly cadence cannot be finalized before the first full week");
  }
  const instruction = await zkubeProgram(args.connection, args.wallet).methods
    .finalizeWeeklyChallenge()
    .accountsPartial({
      weeklyChallenge: args.weekly.address,
      leaderboard: deriveWeeklyLeaderboardPda(args.weekly.address),
      caller,
    })
    .remainingAccounts(
      Array.from({ length: 7 }, (_, offset) => ({
        pubkey: deriveDailyChallengePda(startDay + offset),
        isSigner: false,
        isWritable: false,
      })),
    )
    .instruction();
  return plan("Finalize Weekly challenge", args.connection, caller, instruction);
}

export async function buildClaimWeeklyStarsPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  ownerAuthority: PublicKey;
  sessionToken: PublicKey | null;
  weekly: WeeklyView;
}): Promise<TransactionPlan> {
  const owner = args.ownerAuthority;
  const instruction = await zkubeProgram(args.connection, args.wallet).methods
    .claimWeeklyStars()
    .accountsPartial({
      weeklyChallenge: args.weekly.address,
      leaderboard: deriveWeeklyLeaderboardPda(args.weekly.address),
      weeklyPlayer: deriveWeeklyPlayerPda(args.weekly.address, owner),
      playerState: derivePlayerStatePda(owner),
      ownerAuthority: owner,
      sessionToken: args.sessionToken,
      actor: args.wallet.publicKey,
    })
    .instruction();
  return plan("Claim Weekly Stars", args.connection, args.wallet.publicKey, instruction);
}

export async function buildClaimWeeklySolPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  ownerAuthority: PublicKey;
  sessionToken: PublicKey | null;
  weekly: WeeklyView;
}): Promise<TransactionPlan> {
  const owner = args.ownerAuthority;
  const instruction = await zkubeProgram(args.connection, args.wallet).methods
    .claimWeeklySol()
    .accountsPartial({
      weeklyChallenge: args.weekly.address,
      leaderboard: deriveWeeklyLeaderboardPda(args.weekly.address),
      weeklyPlayer: deriveWeeklyPlayerPda(args.weekly.address, owner),
      ownerAuthority: owner,
      sessionToken: args.sessionToken,
      actor: args.wallet.publicKey,
    })
    .instruction();
  return plan("Claim Weekly SOL", args.connection, args.wallet.publicKey, instruction);
}

export async function buildForfeitWeeklySolPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  weekly: WeeklyView;
}): Promise<TransactionPlan> {
  const runtime = await fetchEconomyRuntime(args);
  if (!runtime) throw new Error("Economy is not active");
  const caller = args.wallet.publicKey;
  const instruction = await zkubeProgram(args.connection, args.wallet).methods
    .forfeitWeeklySol()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      weeklyChallenge: args.weekly.address,
      rewardVault: runtime.rewardVault,
      caller,
    })
    .instruction();
  return plan(
    "Return expired Weekly SOL to reward reserve",
    args.connection,
    caller,
    instruction,
  );
}

export interface WeeklyPlayerRecord {
  address: PublicKey;
  owner: PublicKey;
  solClaimed: boolean;
  starsClaimed: boolean;
}

export async function fetchWeeklyPlayerRecords(args: {
  connection: Connection;
  wallet: WalletLike;
  weekly: WeeklyView;
}): Promise<WeeklyPlayerRecord[]> {
  const program = zkubeProgram(args.connection, args.wallet);
  const matches = await program.account.weeklyPlayer.all([
    { memcmp: { offset: 9, bytes: args.weekly.address.toBase58() } },
  ]);
  return matches
    .map((match) => {
      const player = match.account as unknown as {
        version: number;
        challenge: PublicKey;
        player: PublicKey;
        solClaimed: boolean;
        starsClaimed: boolean;
      };
      if (
        Number(player.version) !== 1 ||
        !player.challenge.equals(args.weekly.address) ||
        !match.publicKey.equals(deriveWeeklyPlayerPda(args.weekly.address, player.player))
      ) {
        throw new Error("Weekly cleanup player relationship is invalid");
      }
      return {
        address: match.publicKey,
        owner: player.player,
        solClaimed: Boolean(player.solClaimed),
        starsClaimed: Boolean(player.starsClaimed),
      };
    })
    .sort((left, right) => left.owner.toBuffer().compare(right.owner.toBuffer()));
}

export async function fetchWeeklyChallengeIds(args: {
  connection: Connection;
  wallet: WalletLike;
}): Promise<number[]> {
  const program = zkubeProgram(args.connection, args.wallet);
  const matches = await program.account.weeklyChallenge.all();
  return matches
    .map((match) => {
      const challenge = match.account as unknown as { version: number; weekId: number };
      const weekId = Number(challenge.weekId);
      if (
        Number(challenge.version) !== 1 ||
        !Number.isSafeInteger(weekId) ||
        weekId < 0 ||
        !match.publicKey.equals(deriveWeeklyChallengePda(weekId))
      ) {
        throw new Error("Weekly challenge PDA relationship is invalid");
      }
      return weekId;
    })
    .sort((left, right) => left - right);
}

export async function fetchOwnerClaimableWeeklyIds(args: {
  connection: Connection;
  wallet: WalletLike;
  nowUnix?: number;
}): Promise<number[]> {
  const program = zkubeProgram(args.connection, args.wallet);
  const owner = args.wallet.publicKey;
  const now = args.nowUnix ?? Math.floor(Date.now() / 1_000);
  const matches = await program.account.weeklyPlayer.all([
    { memcmp: { offset: 41, bytes: owner.toBase58() } },
  ]);
  const weekIds: number[] = [];
  for (const match of matches) {
    const player = match.account as unknown as {
      version: number;
      challenge: PublicKey;
      player: PublicKey;
      solClaimed: boolean;
      starsClaimed: boolean;
    };
    if (
      Number(player.version) !== 1 ||
      !player.player.equals(owner) ||
      !match.publicKey.equals(deriveWeeklyPlayerPda(player.challenge, owner))
    ) {
      throw new Error("Owner Weekly claim scan returned an invalid player account");
    }
    if (player.solClaimed && player.starsClaimed) continue;
    const challenge = await program.account.weeklyChallenge.fetchNullable(player.challenge);
    if (!challenge || Number(challenge.version) !== 1) {
      throw new Error("Owner Weekly claim scan returned an invalid challenge account");
    }
    const weekId = Number(challenge.weekId);
    if (
      !Number.isSafeInteger(weekId) ||
      weekId < 0 ||
      !player.challenge.equals(deriveWeeklyChallengePda(weekId))
    ) {
      throw new Error("Owner Weekly claim challenge PDA is invalid");
    }
    if (
      parseWeeklyStatus(challenge.status) === "claimable" &&
      now <= Number(challenge.claimsCloseAt)
    ) {
      weekIds.push(weekId);
    }
  }
  return weekIds.sort((left, right) => left - right);
}

export async function buildCloseWeeklyPlayerPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  weekly: WeeklyView;
  owner: PublicKey;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.wallet).methods
    .closeWeeklyPlayer()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      weeklyChallenge: args.weekly.address,
      leaderboard: deriveWeeklyLeaderboardPda(args.weekly.address),
      owner: args.owner,
      weeklyPlayer: deriveWeeklyPlayerPda(args.weekly.address, args.owner),
      rentRecipient: derivePlayerFundingPda(args.owner),
      caller: args.wallet.publicKey,
    })
    .instruction();
  return plan("Close settled Weekly player record", args.connection, args.wallet.publicKey, instruction);
}

export async function buildCloseWeeklyChallengePlan(args: {
  connection: Connection;
  wallet: WalletLike;
  weekly: WeeklyView;
}): Promise<TransactionPlan> {
  const startDay = args.weekly.weekId * 7 - 3;
  if (!Number.isSafeInteger(startDay) || startDay < 0) {
    throw new Error("Weekly cadence cannot be closed before the first full week");
  }
  const instruction = await zkubeProgram(args.connection, args.wallet).methods
    .closeWeeklyChallenge()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      rentRecipient: args.weekly.rentRecipient,
      weeklyChallenge: args.weekly.address,
      leaderboard: deriveWeeklyLeaderboardPda(args.weekly.address),
      caller: args.wallet.publicKey,
    })
    .remainingAccounts(
      Array.from({ length: 7 }, (_, offset) => ({
        pubkey: deriveDailyChallengePda(startDay + offset),
        isSigner: false,
        isWritable: false,
      })),
    )
    .instruction();
  return plan("Close settled Weekly challenge", args.connection, args.wallet.publicKey, instruction);
}

function parseWeeklyStatus(value: unknown): WeeklyStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "unknown";
  const status = Object.keys(value)[0];
  return status === "open" || status === "claimable" || status === "closed"
    ? status
    : "unknown";
}

function plan(
  label: string,
  connection: Connection,
  feePayer: PublicKey,
  instruction: import("@solana/web3.js").TransactionInstruction,
): TransactionPlan {
  return {
    layer: "solana-base",
    label,
    connection,
    transaction: new Transaction().add(instruction),
    feePayer,
    signers: [],
  };
}
