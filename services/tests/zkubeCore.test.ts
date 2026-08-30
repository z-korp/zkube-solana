// @vitest-environment node
import { readFileSync } from "node:fs";

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

function u32(bytes: Uint8Array, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset, true);
}

function u64(bytes: Uint8Array, offset: number): bigint {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getBigUint64(offset, true);
}

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
    expect(u64(pools, 0)).toBe(BigInt(dailyBoardSplit.scoreLamports));
    expect(u64(pools, 8)).toBe(BigInt(dailyBoardSplit.themeLamports));

    const width = boardWidth(
      BigInt(rankPayout.poolLamports),
      rankPayout.qualifiedWinners,
      BigInt(rankPayout.entryPriceLamports),
      1_000_000n,
    );
    expect(u32(width, 0)).toBe(rankPayout.winnerCount);
    const denominator = width.slice(4, 20);
    expect(
      payoutForRank(
        BigInt(rankPayout.poolLamports),
        denominator,
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
    expect(u32(plan, 0)).toBe(rankPayout.winnerCount);
    expect(u64(plan, 25)).toBe(BigInt(rankPayout.paidLamports));
    expect(u64(plan, 33)).toBe(BigInt(rankPayout.rolloverLamports));
  });
});
