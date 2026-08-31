// @vitest-environment node
import { describe, expect, it } from "vitest";

import { PlayerAddress, type BoardRow, type BoardState } from "@/backend/views";
import { boardPreviewRows } from "./dailyBoardPreview";

function row(rank: number, address = `player:${rank}`): BoardRow {
  return {
    address: PlayerAddress.make(address),
    metric: BigInt(1_000 - rank),
    rank,
    payoutLamports: 0n,
  };
}

describe("DailyBoard preview", () => {
  it("keeps the top three and adds the player's own rank on each board", () => {
    const state: BoardState = {
      dayId: 1,
      kind: "score",
      status: "open",
      potLamports: 0n,
      rows: [row(1), row(2), row(3), row(4)],
      yourRow: row(17, "you"),
    };

    expect(
      boardPreviewRows(state, "you").map(({ row: entry, isYou }) => [
        entry.rank,
        isYou,
      ]),
    ).toEqual([
      [1, false],
      [2, false],
      [3, false],
      [17, true],
    ]);
  });
});
