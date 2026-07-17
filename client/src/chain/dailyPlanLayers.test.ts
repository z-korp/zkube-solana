// @vitest-environment node

import { Connection, Keypair } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import {
  buildFinalizeDailyChallengePlan,
  buildPrepareDailyRunPlan,
  type DailyView,
} from "./dailyClient";
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
      starEntryCost: 10n,
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

    const finalized = await buildFinalizeDailyChallengePlan({
      connection,
      wallet,
      daily,
    });
    expect(finalized.layer).toBe("solana-base");
    expect(finalized.connection).toBe(connection);
  });
});
