import BN from "bn.js";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import { MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID } from "./constants";
import { deriveAssociatedTokenAddress } from "./campaignClient";
import { buildTopUpMagicActionEscrowInstruction } from "./magicAction";
import {
  deriveDailyChallengePda,
  deriveDailyLeaderboardPda,
  deriveDailyPlayerPda,
  derivePlayerProfilePda,
  deriveProtocolConfigPda,
  deriveRunAddresses,
  deriveTreasuryLedgerPda,
} from "./pdas";
import {
  mapEndlessRulesSnapshot,
  mapLevelRuleSnapshot,
  zkubeProgram,
  type ActiveRunRulesView,
  type EndlessRulesView,
  type PreparedRunPlan,
  type RawEndlessRulesSnapshot,
  type RawLevelRuleSnapshot,
  type TransactionPlan,
} from "./runPlan";
import {
  buildCreateSessionV2Instruction,
  deriveSessionTokenV2Pda,
} from "./sessionV2";
import type { WalletLike } from "./sessionWallet";

export interface DailyLeaderboardView {
  player: PublicKey;
  receipt: PublicKey;
  runId: bigint;
  score: number;
  submittedAt: number;
}

export interface DailyPlayerView {
  freeAttemptUsed: boolean;
  paidAttempts: number;
  finalizedAttempts: number;
  bestRunId: bigint;
  bestScore: number;
  rank: number;
  prizeAmount: bigint;
  claimed: boolean;
  refundedAmount: bigint;
  starRefunded: boolean;
}

export interface DailyGameRulesView extends EndlessRulesView {
  rules: ActiveRunRulesView;
}

export type DailyStatus =
  | "draft"
  | "open"
  | "entriesClosed"
  | "finalizing"
  | "claimable"
  | "cancelled"
  | "closed"
  | "unknown";

const DAILY_STATUSES: ReadonlySet<DailyStatus> = new Set([
  "draft",
  "open",
  "entriesClosed",
  "finalizing",
  "claimable",
  "cancelled",
  "closed",
]);

export function parseDailyStatus(value: unknown): DailyStatus {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "unknown";
  }
  const status = Object.keys(value)[0];
  return status && DAILY_STATUSES.has(status as DailyStatus)
    ? (status as DailyStatus)
    : "unknown";
}

export interface RawDailyGameRulesSnapshot extends RawEndlessRulesSnapshot {
  rules: RawLevelRuleSnapshot;
}

export function mapDailyGameRulesSnapshot(
  challenge: RawDailyGameRulesSnapshot,
): DailyGameRulesView {
  return {
    rules: mapLevelRuleSnapshot(challenge.rules),
    ...mapEndlessRulesSnapshot(challenge),
  };
}

export interface DailyView extends DailyGameRulesView {
  address: PublicKey;
  dayId: number;
  status: DailyStatus;
  mapId: number;
  opensAt: number;
  entriesCloseAt: number;
  runsCloseAt: number;
  settlementGraceCloseAt: number;
  finalizedAt: number;
  claimsCloseAt: number;
  entryPrice: bigint;
  starEntryCost: bigint;
  payoutBps: readonly number[];
  sponsorFunding: bigint;
  prizeLiability: bigint;
  settledPrizePool: bigint;
  prizeForfeited: bigint;
  totalPaidAttempts: bigint;
  totalFreeAttempts: bigint;
  runsStarted: bigint;
  runsFinalized: bigint;
  paymentMint: PublicKey;
  paymentTokenProgram: PublicKey;
  paymentVault: PublicKey;
  rewardVault: PublicKey;
  playerEligible: boolean;
  playerStars: bigint;
  nextRunId: bigint;
  player: DailyPlayerView | null;
  leaderboard: DailyLeaderboardView[];
}

export function currentDailyDayId(
  nowUnix = Math.floor(Date.now() / 1_000),
): number {
  return Math.max(0, Math.floor(nowUnix / 86_400));
}

export async function fetchDailyView(args: {
  connection: Connection;
  wallet: WalletLike;
  dayId?: number;
}): Promise<DailyView | null> {
  const dayId = args.dayId ?? currentDailyDayId();
  const program = zkubeProgram(args.connection, args.wallet);
  const owner = args.wallet.publicKey;
  const address = deriveDailyChallengePda(dayId);
  const [challenge, profile, protocol] = await Promise.all([
    program.account.dailyChallenge.fetchNullable(address),
    program.account.playerProfile.fetchNullable(derivePlayerProfilePda(owner)),
    program.account.protocolConfig.fetchNullable(deriveProtocolConfigPda()),
  ]);
  if (!challenge || !protocol) return null;
  const [player, leaderboard] = await Promise.all([
    program.account.dailyPlayer.fetchNullable(
      deriveDailyPlayerPda(address, owner),
    ),
    program.account.dailyLeaderboard.fetchNullable(
      deriveDailyLeaderboardPda(address),
    ),
  ]);
  return {
    address,
    dayId: Number(challenge.dayId),
    status: parseDailyStatus(challenge.status),
    mapId: Number(challenge.mapId),
    ...mapDailyGameRulesSnapshot(challenge),
    opensAt: Number(challenge.opensAt),
    entriesCloseAt: Number(challenge.entriesCloseAt),
    runsCloseAt: Number(challenge.runsCloseAt),
    settlementGraceCloseAt: Number(challenge.settlementGraceCloseAt),
    finalizedAt: Number(challenge.finalizedAt),
    claimsCloseAt: Number(challenge.claimsCloseAt),
    entryPrice: asBigInt(challenge.entryPrice),
    starEntryCost: asBigInt(challenge.starEntryCost),
    payoutBps: challenge.payoutBps.map(Number),
    sponsorFunding: asBigInt(challenge.sponsorFunding),
    prizeLiability: asBigInt(challenge.prizeLiability),
    settledPrizePool: asBigInt(challenge.settledPrizePool),
    prizeForfeited: asBigInt(challenge.prizeForfeited),
    totalPaidAttempts: asBigInt(challenge.totalPaidAttempts),
    totalFreeAttempts: asBigInt(challenge.totalFreeAttempts),
    runsStarted: asBigInt(challenge.runsStarted),
    runsFinalized: asBigInt(challenge.runsFinalized),
    paymentMint: challenge.paymentMint,
    paymentTokenProgram: challenge.paymentTokenProgram,
    paymentVault: challenge.paymentVault,
    rewardVault: protocol.rewardVault,
    playerEligible: Boolean(profile?.dailyEligible),
    playerStars: profile ? asBigInt(profile.starsBalance) : 0n,
    nextRunId: profile ? asBigInt(profile.nextRunId) : 0n,
    player: player
      ? {
          freeAttemptUsed: Boolean(player.freeAttemptUsed),
          paidAttempts: Number(player.paidAttempts),
          finalizedAttempts: Number(player.finalizedAttempts),
          bestRunId: asBigInt(player.bestRunId),
          bestScore: Number(player.bestScore),
          rank: Number(player.rank),
          prizeAmount: asBigInt(player.prizeAmount),
          claimed: Boolean(player.claimed),
          refundedAmount: asBigInt(player.refundedAmount),
          starRefunded: Boolean(player.starRefunded),
        }
      : null,
    leaderboard: (leaderboard?.entries ?? []).map((entry) => ({
      player: entry.player,
      receipt: entry.receipt,
      runId: asBigInt(entry.runId),
      score: Number(entry.score),
      submittedAt: Number(entry.submittedAt),
    })),
  };
}

export async function buildPrepareDailyRunPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  session: Keypair;
  daily: DailyView;
  payment: "stars" | "usdc";
  playerPaymentAccount?: PublicKey;
  paymaster?: PublicKey;
  nowUnix?: number;
}): Promise<PreparedRunPlan> {
  if (args.daily.nextRunId <= 0n)
    throw new Error("Daily eligibility requires a player profile");
  const owner = args.wallet.publicKey;
  const payer = args.paymaster ?? owner;
  const addresses = deriveRunAddresses(owner, args.daily.nextRunId);
  const { sessionToken } = deriveSessionTokenV2Pda({
    authority: owner,
    sessionSigner: args.session.publicKey,
  });
  const sessionValidUntil =
    (args.nowUnix ?? Math.floor(Date.now() / 1_000)) + 6 * 24 * 60 * 60;
  const instructions: TransactionInstruction[] = [];
  if (!(await args.connection.getAccountInfo(sessionToken, "confirmed"))) {
    instructions.push(
      buildCreateSessionV2Instruction({
        authority: owner,
        sessionSigner: args.session.publicKey,
        feePayer: payer,
        topUp: false,
        validUntil: sessionValidUntil,
      }),
    );
  }
  instructions.push(
    buildTopUpMagicActionEscrowInstruction({ authority: owner, payer }),
  );
  const program = zkubeProgram(args.connection, args.wallet);
  const common = {
    protocol: deriveProtocolConfigPda(),
    playerProfile: derivePlayerProfilePda(owner),
    dailyChallenge: args.daily.address,
    dailyPlayer: deriveDailyPlayerPda(args.daily.address, owner),
    runShell: addresses.runShell,
    activeRun: addresses.activeRun,
    runReceipt: addresses.runReceipt,
    payer,
    owner,
    systemProgram: SystemProgram.programId,
  };
  const enter =
    args.payment === "stars"
      ? await program.methods
          .enterDailyWithStarsV1(
            new BN(args.daily.nextRunId.toString()),
            args.session.publicKey,
          )
          .accountsPartial(common)
          .instruction()
      : await program.methods
          .enterDailyPaidV1(
            new BN(args.daily.nextRunId.toString()),
            args.session.publicKey,
          )
          .accountsPartial({
            protocol: common.protocol,
            playerProfile: common.playerProfile,
            dailyChallenge: common.dailyChallenge,
            dailyPlayer: common.dailyPlayer,
            paymentMint: args.daily.paymentMint,
            playerPaymentAccount:
              args.playerPaymentAccount ??
              deriveAssociatedTokenAddress(
                owner,
                args.daily.paymentMint,
                args.daily.paymentTokenProgram,
              ),
            paymentVault: args.daily.paymentVault,
            paymentTokenProgram: args.daily.paymentTokenProgram,
            runShell: common.runShell,
            activeRun: common.activeRun,
            runReceipt: common.runReceipt,
            payer,
            owner,
            systemProgram: SystemProgram.programId,
          })
          .instruction();
  instructions.push(enter);
  return {
    runId: args.daily.nextRunId,
    addresses,
    sessionToken,
    sessionValidUntil,
    transactionPlan: basePlan(
      args.payment === "stars"
        ? "Enter Daily with Stars"
        : "Enter Daily with USDC",
      args.connection,
      payer,
      instructions,
      [args.session],
    ),
  };
}

export async function buildCommitDailyRunPlan(args: {
  owner: PublicKey;
  payerWallet: WalletLike;
  addresses: ReturnType<typeof deriveRunAddresses>;
  dailyChallenge: PublicKey;
  erConnection: Connection;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.erConnection, args.payerWallet)
    .methods.commitDailyRunV1()
    .accountsPartial({
      payer: args.payerWallet.publicKey,
      activeRun: args.addresses.activeRun,
      runShell: args.addresses.runShell,
      runReceipt: args.addresses.runReceipt,
      playerProfile: derivePlayerProfilePda(args.owner),
      dailyChallenge: args.dailyChallenge,
      dailyPlayer: deriveDailyPlayerPda(args.dailyChallenge, args.owner),
      leaderboard: deriveDailyLeaderboardPda(args.dailyChallenge),
      owner: args.owner,
      magicContext: MAGIC_CONTEXT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction();
  return basePlan(
    "Commit Daily result",
    args.erConnection,
    args.payerWallet.publicKey,
    [instruction],
  );
}

export async function buildClaimDailyPrizePlan(args: {
  connection: Connection;
  wallet: WalletLike;
  daily: DailyView;
  playerPaymentAccount?: PublicKey;
  paymaster?: PublicKey;
}): Promise<TransactionPlan> {
  return buildDailyPayoutPlan("claimDailyPrizeV1", args);
}

export async function buildRefundDailyEntryPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  daily: DailyView;
  playerPaymentAccount?: PublicKey;
  paymaster?: PublicKey;
}): Promise<TransactionPlan> {
  return buildDailyPayoutPlan("refundDailyEntryV1", args);
}

export async function buildForfeitUnclaimedDailyPrizesPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  daily: DailyView;
}): Promise<TransactionPlan> {
  const caller = args.wallet.publicKey;
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.forfeitUnclaimedDailyPrizesV1()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      treasuryLedger: deriveTreasuryLedgerPda(),
      dailyChallenge: args.daily.address,
      paymentMint: args.daily.paymentMint,
      paymentVault: args.daily.paymentVault,
      rewardVault: args.daily.rewardVault,
      paymentTokenProgram: args.daily.paymentTokenProgram,
      caller,
    })
    .instruction();
  return basePlan("Forfeit expired Daily prizes", args.connection, caller, [
    instruction,
  ]);
}

async function buildDailyPayoutPlan(
  kind: "claimDailyPrizeV1" | "refundDailyEntryV1",
  args: {
    connection: Connection;
    wallet: WalletLike;
    daily: DailyView;
    playerPaymentAccount?: PublicKey;
    paymaster?: PublicKey;
  },
): Promise<TransactionPlan> {
  const owner = args.wallet.publicKey;
  const accounts = {
    dailyChallenge: args.daily.address,
    leaderboard: deriveDailyLeaderboardPda(args.daily.address),
    dailyPlayer: deriveDailyPlayerPda(args.daily.address, owner),
    playerProfile: derivePlayerProfilePda(owner),
    paymentMint: args.daily.paymentMint,
    paymentVault: args.daily.paymentVault,
    playerPaymentAccount:
      args.playerPaymentAccount ??
      deriveAssociatedTokenAddress(
        owner,
        args.daily.paymentMint,
        args.daily.paymentTokenProgram,
      ),
    paymentTokenProgram: args.daily.paymentTokenProgram,
    owner,
  };
  const methods = zkubeProgram(args.connection, args.wallet).methods;
  const instruction =
    kind === "claimDailyPrizeV1"
      ? await methods
          .claimDailyPrizeV1()
          .accountsPartial(accounts)
          .instruction()
      : await methods
          .refundDailyEntryV1()
          .accountsPartial(accounts)
          .instruction();
  return basePlan(
    kind === "claimDailyPrizeV1" ? "Claim Daily prize" : "Refund Daily entry",
    args.connection,
    args.paymaster ?? owner,
    [instruction],
  );
}

function basePlan(
  label: string,
  connection: Connection,
  feePayer: PublicKey,
  instructions: TransactionInstruction[],
  signers: Keypair[] = [],
): TransactionPlan {
  return {
    layer: "solana-base",
    label,
    connection,
    transaction: new Transaction().add(...instructions),
    feePayer,
    signers,
  };
}

function asBigInt(value: { toString(): string }): bigint {
  return BigInt(value.toString());
}
