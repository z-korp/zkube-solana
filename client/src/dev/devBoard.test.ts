// @vitest-environment node
import { describe, expect, it } from "vitest";

import { toDisplayGrid } from "@/game/model";
import { canSubmitRunMove } from "@/chain/useRunController";
import { transformDataContractIntoBlock } from "@/utils/gridUtils";
import { buildDevActiveRun, playDevMove } from "./devBoard";
import { DEV_PLAYER_PUBLIC_KEY } from "./fixtures";

/**
 * The staged board is hand-authored, so it can encode a state the engine could
 * never produce — and a surface reviewed against an impossible board teaches
 * the wrong lesson. These pin the properties that make it a believable run.
 */
describe("dev play board", () => {
  const modes = ["arena", "campaign"] as const;

  it.each(modes)("encodes %s rows the chain's own way", (mode) => {
    const grid = toDisplayGrid(
      buildDevActiveRun(mode, DEV_PLAYER_PUBLIC_KEY).grid,
    );
    expect(grid).toHaveLength(10);
    for (const row of grid) {
      // A block of width w occupies exactly w cells all holding w, so the
      // renderer's block list must rebuild the row byte for byte.
      const rebuilt = Array<number>(8).fill(0);
      for (const block of transformDataContractIntoBlock([row])) {
        rebuilt.fill(block.width, block.x, block.x + block.width);
      }
      expect(rebuilt).toEqual(row);
      // A full line would have cleared, so the board can never hold one.
      expect(row.every((cell) => cell !== 0)).toBe(false);
    }
  });

  it.each(modes)("opens %s unlocked rather than on a dead board", (mode) => {
    const run = buildDevActiveRun(mode, DEV_PLAYER_PUBLIC_KEY);
    // Input is gated on this exact predicate; a fixture that fails it renders
    // a board nobody can touch, which is the one state not worth reviewing.
    expect(canSubmitRunMove(run)).toBe(true);
    expect(run.nextRow).toHaveLength(8);
  });

  it.each(modes)("accepts an engine move on the fixed %s board", (mode) => {
    const run = buildDevActiveRun(mode, DEV_PLAYER_PUBLIC_KEY);
    let advanced: ReturnType<typeof playDevMove> | null = null;

    for (let row = 0; row < 10 && advanced === null; row += 1) {
      for (let start = 0; start < 8 && advanced === null; start += 1) {
        for (let destination = 0; destination < 8; destination += 1) {
          try {
            advanced = playDevMove(run, row, start, destination);
            break;
          } catch {
            // The engine rejects placements that do not name a complete block
            // or do not fit. At least one placement on this fixed board must.
          }
        }
      }
    }

    expect(advanced).not.toBeNull();
    expect(advanced?.moves).toBe(run.moves + 1);
    expect(advanced?.actionCounter).toBe(run.actionCounter + 1);
    expect(advanced?.runToken).not.toEqual(run.runToken);
  });

  it("keeps a campaign run inside its own authored level", () => {
    const run = buildDevActiveRun("campaign", DEV_PLAYER_PUBLIC_KEY);
    expect(run.score).toBeLessThan(run.rules.pointsRequired);
    expect(run.moves).toBeLessThan(run.rules.maxMoves);
  });

  it("gives the Daily the rules the program builds for it", () => {
    const run = buildDevActiveRun("arena", DEV_PLAYER_PUBLIC_KEY);
    // `daily_level_rules` pins an unreachable target and the pressure profile's
    // move budget — the HUD reads both, so a friendlier invention would show a
    // Daily that cannot exist.
    expect(run.rules.pointsRequired).toBe(0xffff_ffff);
    expect(run.rules.maxMoves).toBe(run.dailyPressure.maxMoves);
    expect(run.deadlineAt).toBeGreaterThan(Math.floor(Date.now() / 1_000));
  });
});
