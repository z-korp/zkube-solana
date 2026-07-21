// @vitest-environment node

import { Keypair, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  buildInitializeEconomyPlan,
  buildPublishDailyRulesPlan,
  buildUpdateCubePacksPlan,
} from "./economyAdminClient";
import {
  deriveDailyRulesCatalogPda,
  deriveEconomyConfigPda,
  deriveCubeSalesLedgerPda,
} from "./pdas";
import { SessionWallet } from "./sessionWallet";
import {
  CANONICAL_DAILY_PRESSURE,
  CANONICAL_DAILY_SCORING_RULES,
  CANONICAL_DAILY_SEASON_SEED,
  DAILY_SCORING_RULE_COUNT,
} from "./dailyRules";

describe("economy authority builders", () => {
  it("initializes canonical economy accounts without sending", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const plan = await buildInitializeEconomyPlan({
      connection: {} as Connection,
      authority,
      config: {
        dailyRulesVersion: 1,
      },
    });
    const keys = plan.transaction.instructions[0].keys;

    expect(plan.label).toBe("Initialize economy");
    expect(keys[1].pubkey.equals(deriveEconomyConfigPda())).toBe(true);
    expect(keys[2].pubkey.equals(deriveCubeSalesLedgerPda())).toBe(true);
  });

  it("publishes one immutable rules catalog for permissionless Daily opens", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const plan = await buildPublishDailyRulesPlan({
      connection: {} as Connection,
      authority,
      publication: {
        contentVersion: 1,
        rulesVersion: 1,
        weeklyId: 1,
        startsDay: 0,
        weeklySeed: CANONICAL_DAILY_SEASON_SEED,
        scoringRuleCount: DAILY_SCORING_RULE_COUNT,
        scoringRules: CANONICAL_DAILY_SCORING_RULES,
        pressure: CANONICAL_DAILY_PRESSURE,
      },
    });

    expect(
      plan.transaction.instructions[0].keys[2].pubkey.equals(
        deriveDailyRulesCatalogPda(1),
      ),
    ).toBe(true);
  });

  it("builds only ordered Cube pack ladders with improving bulk value", async () => {
    const pricingOperator = new SessionWallet(Keypair.generate());
    const plan = await buildUpdateCubePacksPlan({
      connection: {} as Connection,
      pricingOperator,
      cubes: [10n, 50n, 200n, 500n],
      prices: [
        20_000_000n,
        90_000_000n,
        300_000_000n,
        700_000_000n,
      ],
      enabled: [true, true, true, true],
    });

    expect(plan.label).toBe("Update governed Cube packs");
    expect(plan.transaction.instructions).toHaveLength(1);

    await expect(
      buildUpdateCubePacksPlan({
        connection: {} as Connection,
        pricingOperator,
        cubes: [10n, 50n, 200n, 500n],
        prices: [
          20_000_000n,
          90_000_000n,
          300_000_000n,
          800_000_000n,
        ],
        enabled: [true, true, true, true],
      }),
    ).rejects.toThrow("non-increasing unit price");
  });
});
