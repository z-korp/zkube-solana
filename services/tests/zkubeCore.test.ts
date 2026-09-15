// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  boardWidth,
  dailyBoardPools,
  dailyPairIndex,
  payoutForRank,
  payoutPlan,
} from "../src/zkubeCore";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../fixtures/game-parity.json", import.meta.url),
    "utf8",
  ),
) as {
  phase1Core: {
    dailyPairDraw: { startsDay: number; pairIndicesByDay: number[] };
    dailyBoardSplit: {
      poolLamports: number;
      themeQualifiedWinners: number;
      scoreLamports: number;
      themeLamports: number;
    };
    rankPayout: {
      poolLamports: number;
      qualifiedWinners: number;
      entryPriceLamports: number;
      winnerCount: number;
      payoutsLamports: number[];
      paidLamports: number;
      rolloverLamports: number;
    };
  };
};

describe("generated Node zkube-core boundary", () => {
  it("wasm_protocol_matches_native_golden_vectors", () => {
    const { dailyPairDraw, dailyBoardSplit, rankPayout } = fixture.phase1Core;
    expect(dailyPairIndex(dailyPairDraw.startsDay)).toBe(
      dailyPairDraw.pairIndicesByDay[0],
    );

    const pools = dailyBoardPools(
      BigInt(dailyBoardSplit.poolLamports),
      dailyBoardSplit.themeQualifiedWinners,
    );
    expect(pools.score).toBe(BigInt(dailyBoardSplit.scoreLamports));
    expect(pools.theme).toBe(BigInt(dailyBoardSplit.themeLamports));

    const width = boardWidth(
      BigInt(rankPayout.poolLamports),
      rankPayout.qualifiedWinners,
      BigInt(rankPayout.entryPriceLamports),
      1_000_000n,
    );
    expect(width.winnerCount).toBe(rankPayout.winnerCount);
    expect(
      payoutForRank(
        BigInt(rankPayout.poolLamports),
        width.denominator,
        rankPayout.winnerCount,
        1_000_000n,
      ),
    ).toBe(BigInt(rankPayout.payoutsLamports[rankPayout.winnerCount - 1]!));

    const plan = payoutPlan(
      BigInt(rankPayout.poolLamports),
      rankPayout.qualifiedWinners,
      rankPayout.qualifiedWinners,
      BigInt(rankPayout.entryPriceLamports),
      1_000_000n,
    );
    expect(plan.winnerCount).toBe(rankPayout.winnerCount);
    expect(plan.paidLamports).toBe(BigInt(rankPayout.paidLamports));
    expect(plan.rolloverLamports).toBe(BigInt(rankPayout.rolloverLamports));
  });

  it("payout_curve_has_one_implementation", () => {
    expect(existsSync(new URL("../src/arcadeEconomy.ts", import.meta.url))).toBe(false);
    expect(readFileSync(
      new URL("../src/arcadeReconciliation.ts", import.meta.url),
      "utf8",
    )).toContain('from "./zkubeCore.js"');

  });
});
