// @vitest-environment node

import { createHash } from "node:crypto";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  type Connection,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  buildZkubeLaunchPlan,
  canonicalDevnetReplayDomainHex,
  formatZkubeLaunchPlan,
  launchCadences,
  type LaunchPlannerInput,
} from "./launchPlanner";
import { SOLANA_DEVNET_GENESIS_HASH, ZKUBE_PROGRAM_ID } from "./constants";

const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

describe("read-only paused bootstrap and launch planner", () => {
  it("derives canonical mid-week and mid-Season cadence IDs", () => {
    expect(launchCadences(100)).toEqual({ weekId: 13, seasonId: 3 });
    expect(() => launchCadences(3)).toThrow("supported cadence");
  });

  it("plans the full fresh bootstrap and one atomic launch transaction", async () => {
    const authority = Keypair.generate().publicKey;
    const deployer = Keypair.generate().publicKey;
    const upgradeAuthority = Keypair.generate().publicKey;
    const team = Keypair.generate().publicKey;
    const allocationBytes = 1_024;
    const deployedProgramDataSha256 = createHash("sha256")
      .update(Buffer.alloc(allocationBytes))
      .digest("hex");
    const input: LaunchPlannerInput = {
      cluster: "devnet",
      baseRpc: "https://api.devnet.solana.com",
      expectedGenesisHash: SOLANA_DEVNET_GENESIS_HASH,
      deployer: deployer.toBase58(),
      authority: authority.toBase58(),
      teamDestination: team.toBase58(),
      replayDomainHex: canonicalDevnetReplayDomainHex(),
      launchDayId: 100,
      launchCutoffUnixTimestamp: 100 * 86_400 + 3_600,
      deployedProgramDataSha256,
      programAllocationBytes: allocationBytes,
      programUpgradeAuthority: upgradeAuthority.toBase58(),
      keeperReleaseFingerprint: "3".repeat(64),
      authorityReserveLamports: 100_000_000,
      deployerReserveLamports: 100_000_000,
    };
    const plan = await buildZkubeLaunchPlan(
      input,
      launchConnection({ upgradeAuthority, team, allocationBytes }),
    );

    expect(plan.weekId).toBe(13);
    expect(plan.seasonId).toBe(3);
    expect(plan.plans).toHaveLength(22);
    expect(plan.plans[21]?.transaction.instructions).toHaveLength(5);
    expect(plan.phases.at(-1)).toEqual({
      label: "Atomic 1/2/3 SOL seed, unpause, and activation",
      transactionIndexes: [21],
    });
    expect(plan.costs.seedLamports).toBe(6_500_000_000);
    expect(plan.costs.transactionCount).toBe(22);
    expect(plan.rulesCatalogSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.approvalFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(formatZkubeLaunchPlan(plan)).toContain(
      "No transaction was signed or sent. This planner has no send path.",
    );
  });

  it("refuses planning after the exact launch cutoff", async () => {
    const authority = Keypair.generate().publicKey;
    const deployer = Keypair.generate().publicKey;
    const upgradeAuthority = Keypair.generate().publicKey;
    const team = Keypair.generate().publicKey;
    const allocationBytes = 1_024;
    const input: LaunchPlannerInput = {
      cluster: "devnet",
      baseRpc: "https://api.devnet.solana.com",
      expectedGenesisHash: SOLANA_DEVNET_GENESIS_HASH,
      deployer: deployer.toBase58(),
      authority: authority.toBase58(),
      teamDestination: team.toBase58(),
      replayDomainHex: canonicalDevnetReplayDomainHex(),
      launchDayId: 100,
      launchCutoffUnixTimestamp: 100 * 86_400 + 3_600,
      deployedProgramDataSha256: createHash("sha256")
        .update(Buffer.alloc(allocationBytes))
        .digest("hex"),
      programAllocationBytes: allocationBytes,
      programUpgradeAuthority: upgradeAuthority.toBase58(),
      keeperReleaseFingerprint: "3".repeat(64),
      authorityReserveLamports: 100_000_000,
      deployerReserveLamports: 100_000_000,
    };
    await expect(
      buildZkubeLaunchPlan(
        input,
        launchConnection({
          upgradeAuthority,
          team,
          allocationBytes,
          observedUnixTimestamp: input.launchCutoffUnixTimestamp + 1,
        }),
      ),
    ).rejects.toThrow("approval window has already closed");
  });
});

function launchConnection(args: {
  upgradeAuthority: PublicKey;
  team: PublicKey;
  allocationBytes: number;
  observedUnixTimestamp?: number;
}): Connection {
  const programDataAddress = PublicKey.findProgramAddressSync(
    [ZKUBE_PROGRAM_ID.toBuffer()],
    LOADER,
  )[0];
  const program = Buffer.alloc(36);
  program.writeUInt32LE(2, 0);
  programDataAddress.toBuffer().copy(program, 4);
  const programData = Buffer.alloc(45 + args.allocationBytes);
  programData.writeUInt32LE(3, 0);
  programData[12] = 1;
  args.upgradeAuthority.toBuffer().copy(programData, 13);
  return {
    getGenesisHash: async () => SOLANA_DEVNET_GENESIS_HASH,
    getAccountInfo: async (address: PublicKey) => {
      if (address.equals(ZKUBE_PROGRAM_ID)) {
        return account(program, true, LOADER, 1);
      }
      if (address.equals(programDataAddress)) {
        return account(programData, false, LOADER, 1_000_000);
      }
      if (address.equals(args.team)) {
        return account(Buffer.alloc(0), false, SystemProgram.programId, 1);
      }
      return null;
    },
    getSlot: async () => 1,
    getBlockTime: async () => args.observedUnixTimestamp ?? 100 * 86_400 + 100,
    getMultipleAccountsInfo: async () => Array.from({ length: 22 }, () => null),
    getMinimumBalanceForRentExemption: async (space: number) => space * 10,
    getLatestBlockhash: async () => ({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 1,
    }),
    getFeeForMessage: async () => ({ context: { slot: 1 }, value: 5_000 }),
    getBalance: async () => 10_000_000_000,
  } as unknown as Connection;
}

function account(
  data: Buffer,
  executable: boolean,
  owner: PublicKey,
  lamports: number,
) {
  return { data, executable, lamports, owner, rentEpoch: 0 };
}
