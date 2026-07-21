// @vitest-environment node

import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  buildActivateCampaignMapPlan,
  buildActivateContentReleasePlan,
  buildInitializePlayerPlan,
  buildInitializeProtocolPlan,
  buildPublishCanonicalMapsPlan,
  buildSetProtocolPausePlan,
} from "./adminClient";
import { CAMPAIGN_CONTENT_VERSION } from "./campaignCatalog";
import {
  deriveMapCatalogPda,
  derivePlayerFundingPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
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
