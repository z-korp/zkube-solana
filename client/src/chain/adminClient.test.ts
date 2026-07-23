// @vitest-environment node

import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  buildActivateCampaignMapPlan,
  buildActivateContentReleasePlan,
  buildAtomicArcadeLaunchPlan,
  buildInitializeArcadeArchivePlan,
  buildInitializeArcadePlan,
  buildInitializePlayerPlan,
  buildInitializeProtocolPlan,
  buildPrepareLaunchPeriodPlans,
  buildPublishCanonicalMapsPlan,
  buildPublishCanonicalArenaRulesPlan,
  buildSetProtocolPausePlan,
} from "./adminClient";
import { CAMPAIGN_CONTENT_VERSION } from "./campaignCatalog";
import {
  deriveArcadeArchivePda,
  deriveCadenceFundingPda,
  deriveMapCatalogPda,
  deriveArenaDailyPda,
  derivePlayerFundingPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
  deriveSeasonPda,
  deriveWeeklyJackpotPda,
} from "./pdas";
import { SessionWallet } from "./sessionWallet";

describe("authority publication client", () => {
  it("initializes the lean protocol with its team destination", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const keys = Array.from({ length: 8 }, () => Keypair.generate().publicKey);
    const plan = await buildInitializeProtocolPlan({
      connection: {} as Connection,
      authority,
      config: {
        teamDestination: keys[2],
        contentVersion: 1,
        replayDomain: new Uint8Array(32).fill(9),
      },
    });
    const accounts = plan.transaction.instructions[0].keys;

    expect(accounts[0].pubkey.equals(deriveProtocolConfigPda())).toBe(true);
    expect(accounts[1].pubkey.equals(keys[2])).toBe(true);
    expect(accounts[2].pubkey.equals(authority.publicKey)).toBe(true);
  });

  it("rejects a zero team destination before protocol initialization", async () => {
    const authority = new SessionWallet(Keypair.generate());
    await expect(
      buildInitializeProtocolPlan({
        connection: {} as Connection,
        authority,
        config: {
          teamDestination: PublicKey.default,
          contentVersion: 1,
          replayDomain: new Uint8Array(32).fill(9),
        },
      }),
    ).rejects.toThrow("nonzero");
  });

  it("publishes all ten maps from the authored canonical catalog", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const connection = {} as Connection;
    const plan = await buildPublishCanonicalMapsPlan({
      connection,
      authority,
      contentVersion: CAMPAIGN_CONTENT_VERSION,
    });

    expect(plan.transaction.instructions).toHaveLength(10);
    expect(
      plan.transaction.instructions.map((instruction) =>
        instruction.keys[1].pubkey.toBase58(),
      ),
    ).toEqual(
      Array.from({ length: 10 }, (_, index) =>
        deriveMapCatalogPda(CAMPAIGN_CONTENT_VERSION, index + 1).toBase58(),
      ),
    );
  });

  it("activates a published campaign map through its content-version PDA", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const plan = await buildActivateCampaignMapPlan({
      connection: {} as Connection,
      authority,
      contentVersion: 7,
      mapId: 10,
    });

    const accounts = plan.transaction.instructions[0].keys;
    expect(accounts[0].pubkey.equals(deriveProtocolConfigPda())).toBe(true);
    expect(accounts[1].pubkey.equals(deriveMapCatalogPda(7, 10))).toBe(true);
    expect(accounts[2].pubkey.equals(authority.publicKey)).toBe(true);
  });

  it("activates one fully staged release with exact ordered map accounts", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const plan = await buildActivateContentReleasePlan({
      connection: {} as Connection,
      authority,
      contentVersion: 8,
      dailyRulesVersion: 4,
      campaignMapCount: 3,
    });

    const accounts = plan.transaction.instructions[0].keys;
    expect(accounts.slice(-3).map(({ pubkey }) => pubkey.toBase58())).toEqual(
      [1, 2, 3].map((mapId) => deriveMapCatalogPda(8, mapId).toBase58()),
    );
    expect(
      accounts
        .slice(-3)
        .every((account) => !account.isWritable && !account.isSigner),
    ).toBe(true);
  });

  it("builds explicit pause and unpause governance instructions", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const pause = await buildSetProtocolPausePlan({
      connection: {} as Connection,
      authority,
      paused: true,
    });
    const unpause = await buildSetProtocolPausePlan({
      connection: {} as Connection,
      authority,
      paused: false,
    });

    expect(pause.label).toBe("Pause protocol");
    expect(unpause.label).toBe("Unpause protocol");
    expect(
      pause.transaction.instructions[0].keys[0].pubkey.equals(
        deriveProtocolConfigPda(),
      ),
    ).toBe(true);
  });

  it("stages canonical Arena rules and initializes Arcade while paused", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const rules = await buildPublishCanonicalArenaRulesPlan({
      connection: {} as Connection,
      authority,
      contentVersion: 2,
      rulesVersion: 1,
      startsDay: 10_000,
    });
    const arcade = await buildInitializeArcadePlan({
      connection: {} as Connection,
      authority,
      rulesVersion: 1,
    });
    expect(rules.transaction.instructions).toHaveLength(1);
    expect(arcade.transaction.instructions).toHaveLength(1);
    expect(rules.label).toBe("Publish Arena rules v1");
    expect(arcade.label).toBe("Initialize paused Arcade");

    const archive = await buildInitializeArcadeArchivePlan({
      connection: {} as Connection,
      authority,
      firstDayId: 10_000,
    });
    expect(archive.transaction.instructions).toHaveLength(2);
    expect(
      archive.transaction.instructions[0]?.keys.some(({ pubkey }) =>
        pubkey.equals(deriveArcadeArchivePda()),
      ),
    ).toBe(true);
    expect(
      archive.transaction.instructions[1]?.keys.some(({ pubkey }) =>
        pubkey.equals(deriveCadenceFundingPda()),
      ),
    ).toBe(true);
  });

  it("prepares current and following Daily, Weekly, and Season separately", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const plans = await buildPrepareLaunchPeriodPlans({
      connection: {} as Connection,
      authority,
      rulesVersion: 1,
      dayId: 100,
      weekId: 13,
      seasonId: 3,
    });

    expect(plans.map(({ label }) => label)).toEqual([
      "Prepare Daily 100",
      "Prepare Daily 101",
      "Prepare Weekly 13",
      "Prepare Weekly 14",
      "Prepare Season 3",
      "Prepare Season 4",
    ]);
    expect(
      plans[0]?.transaction.instructions[0]?.keys.some(({ pubkey }) =>
        pubkey.equals(deriveArenaDailyPda(100)),
      ),
    ).toBe(true);
    expect(
      plans[2]?.transaction.instructions[0]?.keys.some(({ pubkey }) =>
        pubkey.equals(deriveWeeklyJackpotPda(13)),
      ),
    ).toBe(true);
    expect(
      plans[4]?.transaction.instructions[0]?.keys.some(({ pubkey }) =>
        pubkey.equals(deriveSeasonPda(3)),
      ),
    ).toBe(true);
  });

  it("keeps seed, unpause, and all three activations in one ordered transaction", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const plan = await buildAtomicArcadeLaunchPlan({
      connection: {} as Connection,
      authority,
      dayId: 100,
      weekId: 13,
      seasonId: 3,
    });

    expect(plan.transaction.instructions).toHaveLength(5);
    expect(plan.label).toBe("Atomically seed 1/2/3 SOL and launch Arcade");
    expect(
      plan.transaction.instructions[0]?.keys.some(({ pubkey }) =>
        pubkey.equals(deriveArenaDailyPda(100)),
      ),
    ).toBe(true);
    expect(
      plan.transaction.instructions[4]?.keys.some(({ pubkey }) =>
        pubkey.equals(deriveSeasonPda(3)),
      ),
    ).toBe(true);
  });

  it("initializes only the owner-derived player accounts", async () => {
    const owner = new SessionWallet(Keypair.generate());
    const payer = Keypair.generate().publicKey;
    const plan = await buildInitializePlayerPlan({
      connection: {} as Connection,
      owner,
      payer,
    });
    const keys = plan.transaction.instructions[0].keys;

    expect(keys[0].pubkey.equals(derivePlayerStatePda(owner.publicKey))).toBe(
      true,
    );
    expect(keys[1].pubkey.equals(derivePlayerFundingPda(owner.publicKey))).toBe(
      true,
    );
    expect(plan.feePayer.equals(payer)).toBe(true);
  });
});
