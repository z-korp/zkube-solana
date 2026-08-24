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
  type LaunchPlannerInput,
} from "./launchPlanner";
import { SOLANA_DEVNET_GENESIS_HASH, ZKUBE_PROGRAM_ID } from "./constants";
import { ARENA_CATALOG_HASH_DOMAIN } from "./protocolVersions.generated";

const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const TEST_WILDCARD_MUTATOR = {
  activeMutatorId: 31,
  bonusType: 1,
  bonusThreshold: 100,
  startingCharges: 1,
  startingRows: 4,
};

describe("read-only paused bootstrap and launch planner", () => {
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
      wildcardMutator: TEST_WILDCARD_MUTATOR,
    };
    const plan = await buildZkubeLaunchPlan(
      input,
      launchConnection({ upgradeAuthority, team, allocationBytes }),
    );

    expect(plan.plans).toHaveLength(18);
    expect(plan.plans[17]?.transaction.instructions).toHaveLength(3);
    expect(plan.phases.at(-1)).toEqual({
      label: "Atomic 1 SOL seed, unpause, and activation",
      transactionIndexes: [17],
    });
    expect(plan.costs.seedLamports).toBe(1_500_000_000);
    expect(plan.costs.transactionCount).toBe(18);
    const rulesInstruction = plan.plans[11]?.transaction.instructions[0];
    expect(rulesInstruction).toBeDefined();
    expect(plan.rulesCatalogSha256).toBe(
      createHash("sha256")
        .update(Buffer.from(ARENA_CATALOG_HASH_DOMAIN, "utf8"))
        .update(rulesInstruction!.data.subarray(8))
        .digest("hex"),
    );
    expect(plan.rulesCatalogSha256).toBe(
      "f4c7ef556cddaa0a56f517f1344cf33d0490bef38d5d3fd7c70734188523d46f",
    );
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
      wildcardMutator: TEST_WILDCARD_MUTATOR,
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
