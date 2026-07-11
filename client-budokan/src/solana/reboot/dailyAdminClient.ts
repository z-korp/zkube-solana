import BN from "bn.js";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import { deriveAssociatedTokenAddress } from "./campaignClient";
import type { DailyView } from "./dailyClient";
import {
  deriveDailyChallengePda,
  deriveDailyLeaderboardPda,
  deriveDailyVaultPda,
  deriveProtocolConfigPda,
  deriveTreasuryLedgerPda,
} from "./pdas";
import { zkubeProgram, type TransactionPlan } from "./runPlan";
import type { WalletLike } from "./sessionWallet";

export interface ConstraintPublication {
  kind: number;
  value: number;
  requiredCount: number;
}

export interface DailyRulesPublication {
  level: number;
  pointsRequired: number;
  maxMoves: number;
  difficulty: number;
  primary: ConstraintPublication;
  secondary: ConstraintPublication;
  activeMutatorId: number;
  passiveMutatorId: number;
  bossId: number;
  blockWeights: readonly [number, number, number, number, number];
  scoreMultiplierX100: number;
  comboMultiplierX100: number;
  lineClearBonus: number;
  perfectClearBonus: number;
  starThresholdModifier: number;
  bonusType: number;
  bonusTriggerType: number;
  bonusThreshold: number;
  startingCharges: number;
  startingRows: number;
}

export interface DailyChallengePublication {
  dayId: number;
  mapId: number;
  rules: DailyRulesPublication;
  endlessThresholds: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  endlessScoreMultipliersX100: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  endlessRampMultiplierX100: number;
  opensAt: number;
  entriesCloseAt: number;
  runsCloseAt: number;
  settlementGraceCloseAt: number;
  starEntryCost: bigint;
  payoutBps: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  paymentMint: PublicKey;
  paymentTokenProgram: PublicKey;
}

export async function buildCreateDailyChallengePlan(args: {
  connection: Connection;
  authority: WalletLike;
  publication: DailyChallengePublication;
}): Promise<TransactionPlan> {
  const publication = args.publication;
  const challenge = deriveDailyChallengePda(publication.dayId);
  const instruction = await zkubeProgram(args.connection, args.authority)
    .methods.createDailyChallengeV1({
      dayId: publication.dayId,
      mapId: publication.mapId,
      rules: {
        ...publication.rules,
        blockWeights: [...publication.rules.blockWeights],
      },
      endlessThresholds: [...publication.endlessThresholds],
      endlessScoreMultipliersX100: [...publication.endlessScoreMultipliersX100],
      endlessRampMultiplierX100: publication.endlessRampMultiplierX100,
      opensAt: new BN(publication.opensAt),
      entriesCloseAt: new BN(publication.entriesCloseAt),
      runsCloseAt: new BN(publication.runsCloseAt),
      settlementGraceCloseAt: new BN(publication.settlementGraceCloseAt),
      starEntryCost: new BN(publication.starEntryCost.toString()),
      payoutBps: [...publication.payoutBps],
    })
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      dailyChallenge: challenge,
      leaderboard: deriveDailyLeaderboardPda(challenge),
      paymentMint: publication.paymentMint,
      paymentVault: deriveDailyVaultPda(publication.dayId),
      paymentTokenProgram: publication.paymentTokenProgram,
      authority: args.authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return plan(
    `Publish Daily challenge ${publication.dayId}`,
    args.connection,
    args.authority.publicKey,
    instruction,
  );
}

export async function buildFundDailyChallengePlan(args: {
  connection: Connection;
  authority: WalletLike;
  daily: DailyView;
  amount: bigint;
  authorityPaymentAccount?: PublicKey;
}): Promise<TransactionPlan> {
  if (args.amount <= 0n)
    throw new Error("Daily sponsor funding must be positive");
  const instruction = await zkubeProgram(args.connection, args.authority)
    .methods.fundDailyChallengeV1(new BN(args.amount.toString()))
    .accountsPartial({
      dailyChallenge: args.daily.address,
      paymentMint: args.daily.paymentMint,
      sponsorPaymentAccount:
        args.authorityPaymentAccount ??
        deriveAssociatedTokenAddress(
          args.authority.publicKey,
          args.daily.paymentMint,
          args.daily.paymentTokenProgram,
        ),
      paymentVault: args.daily.paymentVault,
      paymentTokenProgram: args.daily.paymentTokenProgram,
      sponsor: args.authority.publicKey,
    })
    .instruction();
  return plan(
    "Fund Daily prize pool",
    args.connection,
    args.authority.publicKey,
    instruction,
  );
}

export async function buildFinalizeDailyChallengePlan(args: {
  connection: Connection;
  caller: WalletLike;
  daily: DailyView;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.caller)
    .methods.finalizeDailyChallengeV1()
    .accountsPartial({
      dailyChallenge: args.daily.address,
      leaderboard: deriveDailyLeaderboardPda(args.daily.address),
      caller: args.caller.publicKey,
    })
    .instruction();
  return plan(
    "Finalize Daily challenge",
    args.connection,
    args.caller.publicKey,
    instruction,
  );
}

export async function buildCancelDailyChallengePlan(args: {
  connection: Connection;
  authority: WalletLike;
  daily: DailyView;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.authority)
    .methods.cancelDailyChallengeV1()
    .accountsPartial({
      dailyChallenge: args.daily.address,
      authority: args.authority.publicKey,
    })
    .instruction();
  return plan(
    "Cancel Daily challenge",
    args.connection,
    args.authority.publicKey,
    instruction,
  );
}

export async function buildDistributeDailyRakePlan(args: {
  connection: Connection;
  caller: WalletLike;
  daily: DailyView;
  teamVault: PublicKey;
  paymasterVault: PublicKey;
  treasuryVault: PublicKey;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.caller)
    .methods.distributeDailyRakeV1()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      treasuryLedger: deriveTreasuryLedgerPda(),
      dailyChallenge: args.daily.address,
      paymentMint: args.daily.paymentMint,
      paymentVault: args.daily.paymentVault,
      teamVault: args.teamVault,
      paymasterVault: args.paymasterVault,
      treasuryVault: args.treasuryVault,
      paymentTokenProgram: args.daily.paymentTokenProgram,
      caller: args.caller.publicKey,
    })
    .instruction();
  return plan(
    "Distribute Daily rake",
    args.connection,
    args.caller.publicKey,
    instruction,
  );
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
