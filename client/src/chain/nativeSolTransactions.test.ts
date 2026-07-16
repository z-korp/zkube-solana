// @vitest-environment node

import BN from "bn.js";
import {
  Keypair,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import { ZKUBE_PROGRAM_ID } from "./constants";
import { IDL } from "./idl";
import {
  deriveCampaignProgressPda,
  deriveMapCatalogPda,
  derivePlayerFundingPda,
  derivePlayerProfilePda,
  deriveProtocolConfigPda,
  deriveRunAddresses,
} from "./pdas";
import {
  compileWalletTransactionPlan,
  zkubeProgram,
  type TransactionPlan,
} from "./runPlan";
import { SessionWallet } from "./sessionWallet";
import { buildStarPurchasePlan, type StarShopView } from "./shopClient";
import { splitStarPurchase } from "../utils/currency";

describe("native SOL transaction boundaries", () => {
  it("keeps Star spending owner-signed and encodes the exact quoted lamports", async () => {
    const owner = new SessionWallet(Keypair.generate());
    const shop = shopView();
    const plan = await buildStarPurchasePlan({
      connection: {} as Connection,
      wallet: owner,
      shop,
      packIndex: 0,
    });
    const instruction = plan.transaction.instructions.at(-1)!;
    const ownerMeta = instruction.keys.find((key) => key.pubkey.equals(owner.publicKey));

    expect(plan.feePayer.equals(owner.publicKey)).toBe(true);
    expect(ownerMeta?.isSigner).toBe(true);
    expect(instruction.keys.at(-1)?.pubkey.equals(SystemProgram.programId)).toBe(true);
    expect(instruction.data.readBigUInt64LE(9)).toBe(10n);
    expect(instruction.data.readBigUInt64LE(17)).toBe(10_000_000n);
    expect(splitStarPurchase(10_000_001n)).toEqual({
      team: 1_000_000n,
      rewards: 1_000_000n,
      treasury: 8_000_001n,
    });
  });

  it("exposes no generic vault signer: funded prepare is pinned to owner PDAs", async () => {
    const owner = Keypair.generate().publicKey;
    const actor = new SessionWallet(Keypair.generate());
    const sessionToken = Keypair.generate().publicKey;
    const runId = 7n;
    const run = deriveRunAddresses(owner, runId);
    const instruction = await zkubeProgram({} as Connection, actor).methods
      .fundedPrepareCampaignRun(new BN(runId.toString()), 1, 1)
      .accountsPartial({
        protocol: deriveProtocolConfigPda(),
        playerProfile: derivePlayerProfilePda(owner),
        campaignProgress: deriveCampaignProgressPda(owner),
        mapCatalog: deriveMapCatalogPda(1, 1),
        runShell: run.runShell,
        activeRun: run.activeRun,
        runReceipt: run.runReceipt,
        playerFunding: derivePlayerFundingPda(owner),
        ownerAuthority: owner,
        sessionToken,
        actor: actor.publicKey,
        systemProgram: SystemProgram.programId,
        zkubeProgram: ZKUBE_PROGRAM_ID,
      })
      .instruction();

    const funding = instruction.keys.find((key) =>
      key.pubkey.equals(derivePlayerFundingPda(owner)),
    );
    const signers = instruction.keys.filter((key) => key.isSigner);
    const zkubeProgramMeta = instruction.keys.at(-1);
    expect(funding).toMatchObject({ isSigner: false, isWritable: true });
    expect(signers).toHaveLength(1);
    expect(signers[0]?.pubkey.equals(actor.publicKey)).toBe(true);
    expect(zkubeProgramMeta?.pubkey.equals(ZKUBE_PROGRAM_ID)).toBe(true);
    expect(zkubeProgramMeta).toMatchObject({ isSigner: false, isWritable: false });
    expect(instruction.keys.map(({ pubkey }) => pubkey.toBase58())).toEqual([
      deriveProtocolConfigPda(),
      derivePlayerProfilePda(owner),
      deriveCampaignProgressPda(owner),
      deriveMapCatalogPda(1, 1),
      run.runShell,
      run.activeRun,
      run.runReceipt,
      derivePlayerFundingPda(owner),
      owner,
      sessionToken,
      actor.publicKey,
      SystemProgram.programId,
      ZKUBE_PROGRAM_ID,
    ].map((publicKey) => publicKey.toBase58()));
  });

  it("pins every funded self-CPI wrapper to the executable zKube program", () => {
    const fundedInstructions = [
      "funded_claim_level_milestone",
      "funded_claim_quest",
      "funded_enter_daily",
      "funded_prepare_campaign_run",
      "funded_rollup_daily_to_weekly",
    ];

    for (const name of fundedInstructions) {
      const instruction = IDL.instructions.find(
        (candidate) => (candidate.name as string) === name,
      );
      const zkubeProgramMeta = instruction?.accounts.at(-1);
      expect(zkubeProgramMeta, name).toMatchObject({
        name: "zkube_program",
        address: ZKUBE_PROGRAM_ID.toBase58(),
      });
      expect(zkubeProgramMeta, name).not.toHaveProperty("writable", true);
      expect(zkubeProgramMeta, name).not.toHaveProperty("signer", true);
    }
  });

  it("preserves a real device signature through v0 serialization", async () => {
    const signer = Keypair.generate();
    const wallet = new SessionWallet(signer);
    const connection = {
      getLatestBlockhash: vi.fn().mockResolvedValue({
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 1,
      }),
      simulateTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
    } as unknown as Connection;
    const transactionPlan: TransactionPlan = {
      layer: "solana-base",
      label: "signed fixture",
      connection,
      transaction: new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: signer.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1,
        }),
      ),
      feePayer: signer.publicKey,
      signers: [],
    };
    const signed = await compileWalletTransactionPlan({ transactionPlan, wallet });
    const restored = VersionedTransaction.deserialize(signed.serialize());

    expect(signed.message.header.numRequiredSignatures).toBe(1);
    expect([...signed.signatures[0]!].some((byte) => byte !== 0)).toBe(true);
    expect(Buffer.from(restored.message.serialize())).toEqual(
      Buffer.from(signed.message.serialize()),
    );
    expect(Buffer.from(restored.signatures[0]!)).toEqual(
      Buffer.from(signed.signatures[0]!),
    );
  });
});

function shopView(): StarShopView {
  const destination = () => Keypair.generate().publicKey;
  return {
    economyVersion: 2,
    revision: 1n,
    playerInitialized: true,
    starsBalance: 0n,
    dailyEntryStars: 10n,
    zoneUnlockStars: 40n,
    protocolPaused: false,
    teamDestination: destination(),
    rewardVault: destination(),
    treasuryDestination: destination(),
    saleEnabled: false,
    saleStartsAt: 0n,
    saleEndsAt: 0n,
    saleLive: false,
    packs: [10n, 50n, 100n, 500n, 1_000n].map((stars, index) => ({
      index,
      stars,
      regularPrice: [10_000_000n, 47_500_000n, 90_000_000n, 425_000_000n, 800_000_000n][index]!,
      currentPrice: [10_000_000n, 47_500_000n, 90_000_000n, 425_000_000n, 800_000_000n][index]!,
      salePrice: [10_000_000n, 47_500_000n, 90_000_000n, 425_000_000n, 800_000_000n][index]!,
      enabled: true,
      onSale: false,
    })),
  };
}
