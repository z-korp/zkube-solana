import BN from "bn.js";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";

import {
  deriveDailyRulesCatalogPda,
  deriveEconomyConfigPda,
  deriveProtocolConfigPda,
  deriveCubeSalesLedgerPda,
} from "./pdas";
import { zkubeProgram, type TransactionPlan } from "./runPlan";
import type { WalletLike } from "./sessionWallet";
import type {
  DailyPressureProfileView,
  DailyScoringRuleView,
} from "./dailyRules";

export interface EconomyInitialization {
  dailyRulesVersion: number;
}

export interface DailyRulesCatalogPublication {
  contentVersion: number;
  rulesVersion: number;
  weeklyId: number;
  startsDay: number;
  weeklySeed: readonly number[];
  scoringRuleCount: number;
  scoringRules: readonly DailyScoringRuleView[];
  pressure: DailyPressureProfileView;
}

/**
 * Builds the canonical economy configuration without sending it.
 */
export async function buildInitializeEconomyPlan(args: {
  connection: Connection;
  authority: WalletLike;
  config: EconomyInitialization;
}): Promise<TransactionPlan> {
  assertVersion(args.config.dailyRulesVersion, "dailyRulesVersion");
  const instruction = await zkubeProgram(args.connection, args.authority)
    .methods.initializeEconomy({
      dailyRulesVersion: args.config.dailyRulesVersion,
    })
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      economyConfig: deriveEconomyConfigPda(),
      cubeSalesLedger: deriveCubeSalesLedgerPda(),
      authority: args.authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return plan(
    "Initialize economy",
    args.connection,
    args.authority.publicKey,
    instruction,
  );
}

/** Builds the one-time rules catalog used by every permissionless Daily open. */
export async function buildPublishDailyRulesPlan(args: {
  connection: Connection;
  authority: WalletLike;
  publication: DailyRulesCatalogPublication;
}): Promise<TransactionPlan> {
  const publication = args.publication;
  assertVersion(publication.contentVersion, "contentVersion");
  assertVersion(publication.rulesVersion, "rulesVersion");
  assertVersion(publication.weeklyId, "weeklyId");
  if (!Number.isInteger(publication.startsDay) || publication.startsDay < 0)
    throw new Error("startsDay must be a non-negative integer");
  if (publication.weeklySeed.length !== 32)
    throw new Error("weeklySeed must contain exactly 32 bytes");
  if (publication.scoringRules.length !== 16)
    throw new Error("scoringRules must contain exactly 16 slots");
  if (
    !Number.isInteger(publication.scoringRuleCount) ||
    publication.scoringRuleCount < 7 ||
    publication.scoringRuleCount > 16
  )
    throw new Error("scoringRuleCount must be between 7 and 16");
  const instruction = await zkubeProgram(args.connection, args.authority)
    .methods.publishDailyRules({
      contentVersion: publication.contentVersion,
      rulesVersion: publication.rulesVersion,
      weeklyId: publication.weeklyId,
      startsDay: publication.startsDay,
      weeklySeed: [...publication.weeklySeed],
      scoringRuleCount: publication.scoringRuleCount,
      scoringRules: publication.scoringRules.map((rule) => ({ ...rule })),
      pressure: {
        thresholds: [...publication.pressure.thresholds],
        scoreMultipliersX100: [...publication.pressure.scoreMultipliersX100],
        blockWeights: publication.pressure.blockWeights.map((weights) => [
          ...weights,
        ]),
        startingHeight: publication.pressure.startingHeight,
        maxMoves: publication.pressure.maxMoves,
      },
    })
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      economyConfig: deriveEconomyConfigPda(),
      dailyRulesCatalog: deriveDailyRulesCatalogPda(publication.rulesVersion),
      authority: args.authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return plan(
    `Publish Daily rules v${publication.rulesVersion}`,
    args.connection,
    args.authority.publicKey,
    instruction,
  );
}

export async function buildUpdateCubePacksPlan(args: {
  connection: Connection;
  pricingOperator: WalletLike;
  cubes: readonly [bigint, bigint, bigint, bigint];
  prices: readonly [bigint, bigint, bigint, bigint];
  enabled: readonly [boolean, boolean, boolean, boolean];
}): Promise<TransactionPlan> {
  assertCubePacks(args.cubes, args.prices, args.enabled);
  const instruction = await zkubeProgram(args.connection, args.pricingOperator)
    .methods.updateCubePacks({
      cubes: args.cubes.map(toBN),
      prices: args.prices.map(toBN),
      enabled: [...args.enabled],
    })
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      economyConfig: deriveEconomyConfigPda(),
      pricingOperator: args.pricingOperator.publicKey,
    })
    .instruction();
  return plan(
    "Update governed Cube packs",
    args.connection,
    args.pricingOperator.publicKey,
    instruction,
  );
}

function assertVersion(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 0xffff_ffff) {
    throw new Error(`${label} must be a positive u32`);
  }
}

function assertPrices(prices: readonly bigint[]): void {
  if (
    prices.length !== 4 ||
    prices.some((price) => price <= 0n || price > 0xffff_ffff_ffff_ffffn)
  ) {
    throw new Error("prices must contain four positive u64 values");
  }
}

function assertCubePacks(
  cubes: readonly bigint[],
  prices: readonly bigint[],
  enabled: readonly boolean[],
): void {
  assertPrices(cubes);
  assertPrices(prices);
  if (enabled.length !== 4 || !enabled.some(Boolean)) {
    throw new Error(
      "enabled must contain four flags with at least one active pack",
    );
  }
  for (let index = 1; index < 4; index += 1) {
    const previous = index - 1;
    if (
      cubes[previous]! >= cubes[index]! ||
      prices[previous]! >= prices[index]! ||
      prices[index]! * cubes[previous]! > prices[previous]! * cubes[index]!
    ) {
      throw new Error(
        "Cube packs must be increasing with non-increasing unit price",
      );
    }
  }
}

function toBN(value: bigint): BN {
  return new BN(value.toString());
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
