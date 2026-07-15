// @vitest-environment node

import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  deriveCampaignProgressPda,
  deriveDailyLeaderboardPda,
  deriveDailyPlayerPda,
  derivePlayerProfilePda,
  deriveRunAddresses,
  deriveWeeklyStipendPda,
} from "./pdas";
import { consumeReceiptAccountKeys } from "./settlementRecovery";

describe("orphan receipt recovery account layouts", () => {
  it("builds the exact six-account Campaign consumer layout", () => {
    const owner = Keypair.generate().publicKey;
    const addresses = deriveRunAddresses(owner, 42n);

    expect(
      consumeReceiptAccountKeys({
        mode: "campaign",
        owner,
        runId: 42n,
        addresses,
      }),
    ).toEqual([
      addresses.activeRun,
      addresses.runShell,
      addresses.runReceipt,
      derivePlayerProfilePda(owner),
      deriveCampaignProgressPda(owner),
      owner,
    ]);
  });

  it("builds the exact nine-account Daily consumer layout", () => {
    const owner = Keypair.generate().publicKey;
    const dailyChallenge = Keypair.generate().publicKey;
    const addresses = deriveRunAddresses(owner, 43n);

    expect(
      consumeReceiptAccountKeys({
        mode: "daily",
        owner,
        runId: 43n,
        addresses,
        dailyChallenge,
      }),
    ).toEqual([
      addresses.activeRun,
      addresses.runShell,
      addresses.runReceipt,
      derivePlayerProfilePda(owner),
      dailyChallenge,
      deriveDailyPlayerPda(dailyChallenge, owner),
      deriveDailyLeaderboardPda(dailyChallenge),
      deriveWeeklyStipendPda(owner),
      owner,
    ]);
  });

  it("rejects a Daily candidate without its challenge", () => {
    const owner = Keypair.generate().publicKey;
    expect(() =>
      consumeReceiptAccountKeys({
        mode: "daily",
        owner,
        runId: 44n,
        addresses: deriveRunAddresses(owner, 44n),
      }),
    ).toThrow("requires its challenge address");
  });
});
