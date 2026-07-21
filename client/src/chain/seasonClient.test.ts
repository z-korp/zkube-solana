// @vitest-environment node
import { Connection, Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  buildActivateSeasonPlan,
  buildFinalizeSeasonPlan,
  buildPrepareSeasonPlan,
  currentSeasonId,
  seasonStartDay,
  type SeasonView,
} from "./seasonClient";
import { SessionWallet } from "./sessionWallet";

describe("Season client", () => {
  it("uses the same Monday-aligned 28-day cadence as zkube-core", () => {
    expect(currentSeasonId(4 * 86_400)).toBe(0);
    expect(currentSeasonId(31 * 86_400 + 86_399)).toBe(0);
    expect(currentSeasonId(32 * 86_400)).toBe(1);
    expect(seasonStartDay(0)).toBe(4);
    expect(seasonStartDay(1)).toBe(32);
  });

  it("keeps prepare, activate and push settlement on Solana base", async () => {
    const wallet = new SessionWallet(Keypair.generate());
    const connection = new Connection(
      "https://api.devnet.solana.com",
      "confirmed",
    );
    const address = Keypair.generate().publicKey;
    const winner = Keypair.generate().publicKey;
    const season = {
      address,
      seasonId: 3,
      leaderboard: [
        { player: winner, playerName: null, points: 100, finalizedAt: 1 },
      ],
    } as SeasonView;
    const [prepare, activate, finalize] = await Promise.all([
      buildPrepareSeasonPlan({ connection, wallet, seasonId: 3 }),
      buildActivateSeasonPlan({ connection, wallet, season }),
      buildFinalizeSeasonPlan({ connection, wallet, season }),
    ]);

    expect([prepare.layer, activate.layer, finalize.layer]).toEqual([
      "solana-base",
      "solana-base",
      "solana-base",
    ]);
    expect(
      finalize.transaction.instructions[0].keys.some(
        ({ pubkey, isWritable }) => pubkey.equals(winner) && isWritable,
      ),
    ).toBe(true);
  });
});
