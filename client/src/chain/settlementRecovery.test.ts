// @vitest-environment node

import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  deriveDailyLeaderboardPda,
  deriveDailyPlayerPda,
  derivePlayerStatePda,
  derivePlayerFundingPda,
  deriveRunAddresses,
} from "./pdas";
import { consumeRunAccountKeys } from "./settlementRecovery";

describe("orphan run recovery account layouts", () => {
  it("builds the exact four-account Campaign consumer layout", () => {
    const owner = Keypair.generate().publicKey;
    const addresses = deriveRunAddresses(owner, 42n);

    expect(
      consumeRunAccountKeys({
        mode: "campaign",
        owner,
        runId: 42n,
        addresses,
      }),
    ).toEqual([
      addresses.activeRun,
      derivePlayerStatePda(owner),
      owner,
      derivePlayerFundingPda(owner),
    ]);
  });

  it("builds the exact seven-account Daily consumer layout", () => {
    const owner = Keypair.generate().publicKey;
    const dailyChallenge = Keypair.generate().publicKey;
    const addresses = deriveRunAddresses(owner, 43n);

    expect(
      consumeRunAccountKeys({
        mode: "daily",
        owner,
        runId: 43n,
        addresses,
        dailyChallenge,
      }),
    ).toEqual([
      addresses.activeRun,
      derivePlayerStatePda(owner),
      dailyChallenge,
      deriveDailyPlayerPda(dailyChallenge, owner),
      deriveDailyLeaderboardPda(dailyChallenge),
      owner,
      derivePlayerFundingPda(owner),
    ]);
  });

  it("rejects a Daily candidate without its challenge", () => {
    const owner = Keypair.generate().publicKey;
    expect(() =>
      consumeRunAccountKeys({
        mode: "daily",
        owner,
        runId: 44n,
        addresses: deriveRunAddresses(owner, 44n),
      }),
    ).toThrow("requires its challenge address");
  });
});
