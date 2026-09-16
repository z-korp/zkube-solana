// @vitest-environment node

import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  buildAtomicArcadeLaunchPlan,
  buildSeedCadenceFundingPlan,
  buildInitializeProtocolPlan,
  buildPrepareLaunchPeriodPlans,
  buildSetArenaSuspensionPlan,
  buildDepositArenaDailyPlan,
} from "./adminClient.js";
import {
  deriveCadenceFundingPda,
  deriveCreditVaultPda,
  deriveArenaDailyPda,
  deriveProtocolConfigPda,
} from "./pdas.js";
import { createReadOnlyWallet } from "./readOnlyWallet.js";

describe("authority initialization client", () => {
  it("initializes the lean protocol with its team destination", async () => {
    const authority = createReadOnlyWallet(Keypair.generate().publicKey);
    const keys = Array.from({ length: 8 }, () => Keypair.generate().publicKey);
    const plan = await buildInitializeProtocolPlan({
      connection: {} as Connection,
      authority,
      config: {
        teamDestination: keys[2],

        replayDomain: new Uint8Array(32).fill(9),
      },
    });
    const accounts = plan.transaction.instructions[0].keys;

    expect(accounts[0].pubkey.equals(deriveProtocolConfigPda())).toBe(true);
    expect(accounts[1].pubkey.equals(deriveCreditVaultPda())).toBe(true);
    expect(accounts[2].pubkey.equals(keys[2])).toBe(true);
    expect(accounts[3].pubkey.equals(authority.publicKey)).toBe(true);
  });

  it("rejects a zero team destination before protocol initialization", async () => {
    const authority = createReadOnlyWallet(Keypair.generate().publicKey);
    await expect(
      buildInitializeProtocolPlan({
        connection: {} as Connection,
        authority,
        config: {
          teamDestination: PublicKey.default,

          replayDomain: new Uint8Array(32).fill(9),
        },
      }),
    ).rejects.toThrow("nonzero");
  });



  it("sets the explicit suspension boundary and seeds cadence funding", async () => {
    const authority = createReadOnlyWallet(Keypair.generate().publicKey);
    const suspension = await buildSetArenaSuspensionPlan({
      connection: {} as Connection,
      authority,
      untilDay: 10_000,
    });
    expect(suspension.transaction.instructions).toHaveLength(1);
    expect(suspension.label).toBe("Set Arena suspension until day 10000");

    const funding = await buildSeedCadenceFundingPlan({
      connection: {} as Connection,
      authority,
    });
    expect(funding.transaction.instructions).toHaveLength(1);
    expect(funding.transaction.instructions[0]?.keys.some(({ pubkey }) =>
      pubkey.equals(deriveCadenceFundingPda()))).toBe(true);
  });

  it("prepares current and following Daily separately", async () => {
    const authority = createReadOnlyWallet(Keypair.generate().publicKey);
    const plans = await buildPrepareLaunchPeriodPlans({
      connection: {} as Connection,
      authority,
      dayId: 100,

    });

    expect(plans.map(({ label }) => label)).toEqual([
      "Prepare Daily 100",
      "Prepare Daily 101",
    ]);
    expect(
      plans[0]?.transaction.instructions[0]?.keys.some(({ pubkey }) =>
        pubkey.equals(deriveArenaDailyPda(100)),
      ),
    ).toBe(true);
  });

  it("keeps seed, unpause, and Daily activation in one ordered transaction", async () => {
    const authority = createReadOnlyWallet(Keypair.generate().publicKey);
    const plan = await buildAtomicArcadeLaunchPlan({
      connection: {} as Connection,
      authority,
      dayId: 100,
    });

    expect(plan.transaction.instructions).toHaveLength(3);
    expect(plan.label).toBe("Atomically seed 1 SOL and launch Arcade");
    expect(
      plan.transaction.instructions[0]?.keys.some(({ pubkey }) =>
        pubkey.equals(deriveArenaDailyPda(100)),
      ),
    ).toBe(true);
  });

  it("routes a chosen amount to the exact selected prize-pool PDA", async () => {
    const authority = createReadOnlyWallet(Keypair.generate().publicKey);
    const connection = {} as Connection;
    const cases = [
      {
        pool: "daily" as const,
        cadenceId: 20_657,
        expected: deriveArenaDailyPda(20_657),
      },
    ];

    for (const testCase of cases) {
      const plan = await buildDepositArenaDailyPlan({
        connection,
        authority,
        ...testCase,
        lamports: 1_234_567_890n,
      });
      const accounts = plan.transaction.instructions[0]?.keys ?? [];
      expect(accounts[0]?.pubkey.equals(deriveProtocolConfigPda())).toBe(true);
      expect(accounts[1]?.pubkey.equals(testCase.expected)).toBe(true);
      expect(accounts[2]?.pubkey.equals(authority.publicKey)).toBe(true);
      expect(plan.transaction.instructions[0]?.data.readBigUInt64LE(8)).toBe(
        1_234_567_890n,
      );
      expect(plan.label).toContain("1234567890 lamports");
    }
  });

  it("rejects zero, overflow, and invalid cadence top-ups before signing", async () => {
    const authority = createReadOnlyWallet(Keypair.generate().publicKey);
    const connection = {} as Connection;
    const build = (lamports: bigint, cadenceId = 1) =>
      buildDepositArenaDailyPlan({
        connection,
        authority,
        pool: "daily",
        cadenceId,
        lamports,
      });

    await expect(build(0n)).rejects.toThrow("positive u64");
    await expect(build(1n << 64n)).rejects.toThrow("positive u64");
    await expect(build(1n, 0x1_0000_0000)).rejects.toThrow("u32");
  });


});
