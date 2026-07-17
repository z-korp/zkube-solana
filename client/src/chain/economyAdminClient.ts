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
  deriveStarSalesLedgerPda,
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
  seasonId: number;
  startsDay: number;
  seasonSeed: readonly number[];
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
      starSalesLedger: deriveStarSalesLedgerPda(),
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
  assertVersion(publication.seasonId, "seasonId");
  if (!Number.isInteger(publication.startsDay) || publication.startsDay < 0)
    throw new Error("startsDay must be a non-negative integer");
  if (publication.seasonSeed.length !== 32)
    throw new Error("seasonSeed must contain exactly 32 bytes");
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
      seasonId: publication.seasonId,
      startsDay: publication.startsDay,
      seasonSeed: [...publication.seasonSeed],
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

export async function buildUpdateRegularPricesPlan(args: {
  connection: Connection;
  pricingOperator: WalletLike;
  prices: readonly [bigint, bigint, bigint, bigint, bigint];
  enabled: readonly [boolean, boolean, boolean, boolean, boolean];
}): Promise<TransactionPlan> {
  assertPrices(args.prices);
  const instruction = await zkubeProgram(args.connection, args.pricingOperator)
    .methods.updateRegularPrices({
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
    "Update regular Star prices",
    args.connection,
    args.pricingOperator.publicKey,
    instruction,
  );
}

export async function buildUpdateStarPacksPlan(args: {
  connection: Connection;
  pricingOperator: WalletLike;
  stars: readonly [bigint, bigint, bigint, bigint, bigint];
  prices: readonly [bigint, bigint, bigint, bigint, bigint];
  enabled: readonly [boolean, boolean, boolean, boolean, boolean];
}): Promise<TransactionPlan> {
  assertStarPacks(args.stars, args.prices, args.enabled);
  const instruction = await zkubeProgram(args.connection, args.pricingOperator)
    .methods.updateStarPacks({
      stars: args.stars.map(toBN),
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
    "Update governed Star packs",
    args.connection,
    args.pricingOperator.publicKey,
    instruction,
  );
}

export async function buildScheduleSalePlan(args: {
  connection: Connection;
  pricingOperator: WalletLike;
  startsAt: number;
  endsAt: number;
  prices: readonly [bigint, bigint, bigint, bigint, bigint];
}): Promise<TransactionPlan> {
  assertTimestamp(args.startsAt, "startsAt");
  assertTimestamp(args.endsAt, "endsAt");
  if (args.startsAt >= args.endsAt) throw new Error("sale window is invalid");
  assertPrices(args.prices);
  const instruction = await zkubeProgram(args.connection, args.pricingOperator)
    .methods.scheduleSale({
      startsAt: new BN(args.startsAt),
      endsAt: new BN(args.endsAt),
      prices: args.prices.map(toBN),
    })
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      economyConfig: deriveEconomyConfigPda(),
      pricingOperator: args.pricingOperator.publicKey,
    })
    .instruction();
  return plan(
    "Schedule Star sale",
    args.connection,
    args.pricingOperator.publicKey,
    instruction,
  );
}

export async function buildCancelSalePlan(args: {
  connection: Connection;
  pricingOperator: WalletLike;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.pricingOperator)
    .methods.cancelSale()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      economyConfig: deriveEconomyConfigPda(),
      pricingOperator: args.pricingOperator.publicKey,
    })
    .instruction();
  return plan(
    "Cancel Star sale",
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
    prices.length !== 5 ||
    prices.some((price) => price <= 0n || price > 0xffff_ffff_ffff_ffffn)
  ) {
    throw new Error("prices must contain five positive u64 values");
  }
}

function assertStarPacks(
  stars: readonly bigint[],
  prices: readonly bigint[],
  enabled: readonly boolean[],
): void {
  assertPrices(stars);
  assertPrices(prices);
  if (enabled.length !== 5 || !enabled.some(Boolean)) {
    throw new Error(
      "enabled must contain five flags with at least one active pack",
    );
  }
  for (let index = 1; index < 5; index += 1) {
    const previous = index - 1;
    if (
      stars[previous]! >= stars[index]! ||
      prices[previous]! >= prices[index]! ||
      prices[index]! * stars[previous]! > prices[previous]! * stars[index]!
    ) {
      throw new Error(
        "Star packs must be increasing with non-increasing unit price",
      );
    }
  }
}

function assertTimestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value))
    throw new Error(`${label} must be a safe integer`);
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
