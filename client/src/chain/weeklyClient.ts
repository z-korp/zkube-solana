import { SystemProgram, Transaction, type Connection, type PublicKey } from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  deriveAssociatedTokenAddress,
} from "./campaignClient";
import { fetchEconomyRuntime } from "./economyClient";
import {
  deriveDailyChallengePda,
  deriveDailyLeaderboardPda,
  deriveDailyPlayerPda,
  deriveEconomyConfigPda,
  derivePlayerProfilePda,
  deriveProtocolConfigPda,
  deriveWeeklyChallengePda,
  deriveWeeklyLeaderboardPda,
  deriveWeeklyPlayerPda,
  deriveWeeklyVaultPda,
} from "./pdas";
import { zkubeProgram, type TransactionPlan } from "./runPlan";
import type { WalletLike } from "./sessionWallet";
import type { DailyView } from "./dailyClient";

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
  committedCashPool: bigint;
  cashClaimed: bigint;
  participants: number;
  cashWinnerCount: number;
  starWinnerCount: number;
  paymentMint: PublicKey;
  paymentTokenProgram: PublicKey;
  paymentVault: PublicKey;
  player: {
    score: number;
    resultCount: number;
    cashClaimed: boolean;
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
    committedCashPool: BigInt(challenge.committedCashPool.toString()),
    cashClaimed: BigInt(challenge.cashClaimed.toString()),
    participants: Number(challenge.participants),
    cashWinnerCount: Number(challenge.cashWinnerCount),
    starWinnerCount: Number(challenge.starWinnerCount),
    paymentMint: challenge.paymentMint,
    paymentTokenProgram: challenge.paymentTokenProgram,
    paymentVault: challenge.paymentVault,
    player: player
      ? {
          score: Number(player.score),
          resultCount: Number(player.resultCount),
          cashClaimed: Boolean(player.cashClaimed),
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
  paymaster: PublicKey;
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
      paymentMint: runtime.paymentMint,
      rewardVault: runtime.rewardVault,
      paymentVault: deriveWeeklyVaultPda(args.weekId),
      tokenProgram: runtime.paymentTokenProgram,
      payer: args.paymaster,
      caller,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return plan("Open Weekly challenge", args.connection, args.paymaster, instruction);
}

export async function buildRollupDailyPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  daily: DailyView;
  weekly: WeeklyView;
  paymaster: PublicKey;
  playerOwner?: PublicKey;
}): Promise<TransactionPlan> {
  if (args.daily.economyVersion !== 2 || args.daily.weekId !== args.weekly.weekId) {
    throw new Error("Daily and Weekly cadence do not match");
  }
  const owner = args.playerOwner ?? args.wallet.publicKey;
  const caller = args.wallet.publicKey;
  const instruction = await zkubeProgram(args.connection, args.wallet).methods
    .rollupDailyToWeekly()
    .accountsPartial({
      dailyChallenge: args.daily.address,
      dailyLeaderboard: deriveDailyLeaderboardPda(args.daily.address),
      dailyPlayer: deriveDailyPlayerPda(args.daily.address, owner),
      weeklyChallenge: args.weekly.address,
      weeklyPlayer: deriveWeeklyPlayerPda(args.weekly.address, owner),
      weeklyLeaderboard: deriveWeeklyLeaderboardPda(args.weekly.address),
      owner,
      payer: args.paymaster,
      caller,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return plan("Roll Daily result into Weekly", args.connection, args.paymaster, instruction);
}

export async function fetchPendingDailyRollupOwners(args: {
  connection: Connection;
  wallet: WalletLike;
  daily: DailyView;
}): Promise<PublicKey[]> {
  if (args.daily.economyVersion !== 2 || args.daily.status !== "claimable") return [];
  const program = zkubeProgram(args.connection, args.wallet);
  const size = program.account.dailyPlayer.size;
  const matches = await args.connection.getProgramAccounts(program.programId, {
    commitment: "confirmed",
    filters: [
      { dataSize: size },
      { memcmp: { offset: 9, bytes: args.daily.address.toBase58() } },
    ],
  });
  const owners: PublicKey[] = [];
  for (const match of matches) {
    if (!match.account.owner.equals(program.programId) || match.account.data.length !== size) {
      throw new Error("Daily rollup scan returned an invalid program account");
    }
    const player = program.coder.accounts.decode(
      "dailyPlayer",
      match.account.data,
    ) as unknown as {
      version: number;
      challenge: PublicKey;
      player: PublicKey;
      bestRunId: { toString(): string };
      weeklyRolledUp: boolean;
    };
    if (
      Number(player.version) !== 1 ||
      !player.challenge.equals(args.daily.address) ||
      !match.pubkey.equals(deriveDailyPlayerPda(args.daily.address, player.player))
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
  paymaster?: PublicKey;
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
  return plan("Finalize Weekly challenge", args.connection, args.paymaster ?? caller, instruction);
}

export async function buildClaimWeeklyStarsPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  weekly: WeeklyView;
  paymaster?: PublicKey;
}): Promise<TransactionPlan> {
  const owner = args.wallet.publicKey;
  const instruction = await zkubeProgram(args.connection, args.wallet).methods
    .claimWeeklyStars()
    .accountsPartial({
      weeklyChallenge: args.weekly.address,
      leaderboard: deriveWeeklyLeaderboardPda(args.weekly.address),
      weeklyPlayer: deriveWeeklyPlayerPda(args.weekly.address, owner),
      playerProfile: derivePlayerProfilePda(owner),
      owner,
    })
    .instruction();
  return plan("Claim Weekly Stars", args.connection, args.paymaster ?? owner, instruction);
}

export async function buildClaimWeeklyCashPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  weekly: WeeklyView;
  paymaster?: PublicKey;
}): Promise<TransactionPlan> {
  const owner = args.wallet.publicKey;
  const instruction = await zkubeProgram(args.connection, args.wallet).methods
    .claimWeeklyCash()
    .accountsPartial({
      weeklyChallenge: args.weekly.address,
      leaderboard: deriveWeeklyLeaderboardPda(args.weekly.address),
      weeklyPlayer: deriveWeeklyPlayerPda(args.weekly.address, owner),
      paymentMint: args.weekly.paymentMint,
      paymentVault: args.weekly.paymentVault,
      playerPaymentAccount: deriveAssociatedTokenAddress(
        owner,
        args.weekly.paymentMint,
        args.weekly.paymentTokenProgram,
      ),
      tokenProgram: args.weekly.paymentTokenProgram,
      payer: args.paymaster ?? owner,
      owner,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return plan("Claim Weekly cash", args.connection, args.paymaster ?? owner, instruction);
}

export async function buildForfeitWeeklyCashPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  weekly: WeeklyView;
  paymaster?: PublicKey;
}): Promise<TransactionPlan> {
  const runtime = await fetchEconomyRuntime(args);
  if (!runtime) throw new Error("Economy is not active");
  if (
    !runtime.paymentMint.equals(args.weekly.paymentMint) ||
    !runtime.paymentTokenProgram.equals(args.weekly.paymentTokenProgram)
  ) {
    throw new Error("Weekly payment identity does not match the economy");
  }
  const caller = args.wallet.publicKey;
  const instruction = await zkubeProgram(args.connection, args.wallet).methods
    .forfeitWeeklyCash()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      weeklyChallenge: args.weekly.address,
      paymentMint: args.weekly.paymentMint,
      paymentVault: args.weekly.paymentVault,
      rewardVault: runtime.rewardVault,
      tokenProgram: args.weekly.paymentTokenProgram,
      caller,
    })
    .instruction();
  return plan(
    "Return expired Weekly cash to reward reserve",
    args.connection,
    args.paymaster ?? caller,
    instruction,
  );
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
