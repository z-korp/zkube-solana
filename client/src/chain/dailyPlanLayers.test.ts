// @vitest-environment node

import { Connection, Keypair } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import {
  buildFinalizeDailyChallengePlan,
  buildPrepareDailyRunPlan,
  buildPreparePracticeRunPlan,
  isPracticeEntryWindowOpen,
  practiceRunsCloseAt,
  type DailyView,
} from "./dailyClient";
import { derivePlayerFundingPda } from "./pdas";
import { SessionWallet } from "./sessionWallet";

describe("Daily transaction layer boundaries", () => {
  it("keeps Daily preparation and challenge finalization on Solana base", async () => {
    const signer = Keypair.generate();
    const wallet = new SessionWallet(signer);
    const connection = new Connection(
      "https://api.devnet.solana.com",
      "confirmed",
    );
    vi.spyOn(connection, "getMultipleAccountsInfo").mockResolvedValue([null]);
    const daily = {
      address: Keypair.generate().publicKey,
      nextRunId: 7n,
      activeRunId: 0n,
      entryLamports: 20_000_000n,
      dayId: 20,
      weeklyId: 1,
      seasonId: 1,
      leaderboard: [],
    } as DailyView;

    const prepared = await buildPrepareDailyRunPlan({
      connection,
      wallet,
      ownerAuthority: signer.publicKey,
      sessionToken: Keypair.generate().publicKey,
      daily,
      sessionValidUntil: 1_800_000_000,
    });
    expect(prepared.transactionPlan.layer).toBe("solana-base");
    expect(prepared.transactionPlan.connection).toBe(connection);
    expect(prepared.transactionPlan.label).toContain("exact 0.02 SOL");
    const enterAccounts = prepared.transactionPlan.transaction.instructions[0].keys;
    const playerFunding = enterAccounts.find(({ pubkey }) =>
      pubkey.equals(derivePlayerFundingPda(signer.publicKey)),
    );
    const owner = enterAccounts.find(({ pubkey }) => pubkey.equals(signer.publicKey));
    expect(playerFunding).toMatchObject({ isWritable: true, isSigner: false });
    expect(owner).toMatchObject({ isWritable: true, isSigner: true });

    const finalized = await buildFinalizeDailyChallengePlan({
      connection,
      wallet,
      daily,
    });
    expect(finalized.layer).toBe("solana-base");
    expect(finalized.connection).toBe(connection);
  });

  it("uses the narrow player-funding PDA for free Practice rent", async () => {
    const owner = Keypair.generate();
    const session = Keypair.generate();
    const wallet = new SessionWallet(session);
    const connection = new Connection(
      "https://api.devnet.solana.com",
      "confirmed",
    );
    vi.spyOn(connection, "getMultipleAccountsInfo").mockResolvedValue([null]);
    const daily = {
      address: Keypair.generate().publicKey,
      dayId: 20,
      status: "finalized",
      nextRunId: 8n,
    } as DailyView;

    const prepared = await buildPreparePracticeRunPlan({
      connection,
      wallet,
      ownerAuthority: owner.publicKey,
      sessionToken: Keypair.generate().publicKey,
      daily,
      sessionValidUntil: 1_800_000_000,
      nowUnix: 20 * 86_400 + 1,
    });

    expect(prepared.transactionPlan.label).toBe("Prepare free Practice run");
    expect(prepared.transactionPlan.feePayer.equals(session.publicKey)).toBe(true);
    const accounts = prepared.transactionPlan.transaction.instructions[0].keys;
    expect(
      accounts.find(({ pubkey }) =>
        pubkey.equals(derivePlayerFundingPda(owner.publicKey)),
      ),
    ).toMatchObject({ isWritable: true, isSigner: false });
    expect(
      accounts.find(({ pubkey }) => pubkey.equals(owner.publicKey)),
    ).toMatchObject({ isSigner: false });
    expect(
      accounts.find(({ pubkey }) => pubkey.equals(session.publicKey)),
    ).toMatchObject({ isSigner: true });
  });

  it("closes new Practice preparation exactly at 23:30 UTC", async () => {
    const dayStart = 20 * 86_400;
    expect(practiceRunsCloseAt(dayStart)).toBe(dayStart + 84_600);
    expect(isPracticeEntryWindowOpen(dayStart + 84_599)).toBe(true);
    expect(isPracticeEntryWindowOpen(dayStart + 84_600)).toBe(false);
    const owner = Keypair.generate();
    await expect(
      buildPreparePracticeRunPlan({
        connection: {} as Connection,
        wallet: new SessionWallet(Keypair.generate()),
        ownerAuthority: owner.publicKey,
        sessionToken: Keypair.generate().publicKey,
        daily: {
          status: "finalized",
          nextRunId: 9n,
        } as DailyView,
        sessionValidUntil: 1_800_000_000,
        nowUnix: dayStart + 84_600,
      }),
    ).rejects.toThrow("closes at 23:30 UTC");
  });
});
