// @vitest-environment node
import { Connection, Keypair, SystemProgram } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { discoverOpeningPlans, weekIdForDay } from "../src/arcadeChain";
import { assertKeeperPlanPolicy } from "../src/keeperPolicy";

describe("v4 keeper signing policy", () => {
  it("uses seven-day Monday cadence math", () => {
    expect(weekIdForDay(3)).toBe(0);
    expect(weekIdForDay(4)).toBe(1);
    expect(weekIdForDay(10)).toBe(1);
    expect(weekIdForDay(11)).toBe(2);
  });

  it("accepts only canonical current opening accounts", async () => {
    const keeper = Keypair.generate().publicKey;
    const connection = new Connection("https://api.devnet.solana.com");
    connection.getMultipleAccountsInfo = async () => [null, null] as never;
    const nowUnix = 20_651 * 86_400 + 10;
    const plans = await discoverOpeningPlans({ connection, keeper, nowUnix, rulesVersion: 1 });
    expect(plans.map((plan) => plan.operation)).toEqual(["open_weekly_jackpot", "open_arena_daily"]);
    for (const plan of plans) expect(() => assertKeeperPlanPolicy({ plan, keeper, connection, nowUnix, rulesVersion: 1 })).not.toThrow();
    plans[0]!.instruction.keys[0]!.pubkey = SystemProgram.programId;
    expect(() => assertKeeperPlanPolicy({ plan: plans[0]!, keeper, connection, nowUnix, rulesVersion: 1 })).toThrow("account layout");
  });
});
