// @vitest-environment node
import { Keypair, type AccountInfo, type PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  accountDiscriminator,
  activeRunPda,
  arenaDailyPda,
  arenaPlayerPda,
  playerStatePda,
  ZKUBE_PROGRAM_ID,
} from "../src/arcadeChain";
import { discoverReconciliationPlans } from "../src/arcadeReconciliation";
import { assertKeeperPlanPolicy } from "../src/keeperPolicy";

describe("v4 keeper reconciliation discovery", () => {
  it("discovers and policy-validates a terminal paid Arena run", async () => {
    const keeper = Keypair.generate().publicKey;
    const owner = Keypair.generate().publicKey;
    const dayId = 20_651;
    const daily = arenaDailyPda(dayId);
    const runId = 7n;
    const accounts = [
      fixture(activeRunPda(owner, runId), activeRunData(owner, daily, runId)),
      fixture(daily, dailyData(dayId)),
      fixture(arenaPlayerPda(daily, owner), arenaPlayerData(daily, owner, runId)),
      fixture(playerStatePda(owner), playerStateData(owner)),
    ];
    const connection = { getProgramAccounts: async () => accounts } as never;
    const plans = await discoverReconciliationPlans({ connection, keeper, nowUnix: dayId * 86_400 });
    expect(plans.map((plan) => plan.operation)).toEqual(["consume_terminal_run"]);
    expect(() => assertKeeperPlanPolicy({ plan: plans[0]!, keeper, connection, nowUnix: dayId * 86_400, rulesVersion: 1 })).not.toThrow();
  });

  it("rejects a correctly-discriminated account at a noncanonical PDA", async () => {
    const owner = Keypair.generate().publicKey;
    const daily = arenaDailyPda(20_651);
    const connection = {
      getProgramAccounts: async () => [fixture(Keypair.generate().publicKey, activeRunData(owner, daily, 1n))],
    } as never;
    await expect(discoverReconciliationPlans({ connection, keeper: Keypair.generate().publicKey, nowUnix: 0 })).rejects.toThrow("noncanonical ActiveRun PDA");
  });
});

function fixture(pubkey: PublicKey, data: Buffer): { pubkey: PublicKey; account: AccountInfo<Buffer> } {
  return { pubkey, account: { data, executable: false, lamports: 1_000_000, owner: ZKUBE_PROGRAM_ID, rentEpoch: 0 } };
}

function account(name: string, length: number): Buffer {
  const data = Buffer.alloc(length);
  accountDiscriminator(name).copy(data, 0);
  data[8] = 1;
  return data;
}

function activeRunData(owner: PublicKey, daily: PublicKey, runId: bigint): Buffer {
  const data = account("ActiveRun", 384);
  owner.toBuffer().copy(data, 9);
  daily.toBuffer().copy(data, 41);
  data.writeBigUInt64LE(runId, 73);
  data[81] = 1; // Daily
  data[82] = 5; // Finished
  return data;
}

function dailyData(dayId: number): Buffer {
  const data = account("ArenaDaily", 418);
  data.writeUInt32LE(dayId, 9);
  data.writeUInt32LE(Math.floor((dayId + 3) / 7), 13);
  data[53] = 0;
  data.writeBigInt64LE(BigInt(dayId * 86_400 + 84_600), 314);
  data.writeBigInt64LE(BigInt(dayId * 86_400 + 106_200), 322);
  data.writeUInt32LE(0, 413);
  return data;
}

function arenaPlayerData(daily: PublicKey, owner: PublicKey, runId: bigint): Buffer {
  const data = account("ArenaPlayer", 159);
  daily.toBuffer().copy(data, 9);
  owner.toBuffer().copy(data, 41);
  data.writeBigUInt64LE(runId, 89);
  return data;
}

function playerStateData(owner: PublicKey): Buffer {
  const data = account("PlayerState", 360);
  owner.toBuffer().copy(data, 9);
  return data;
}
