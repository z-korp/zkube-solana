// @vitest-environment node

import { createHash } from "node:crypto";
import { BorshInstructionCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import { IDL } from "./idl/index.js";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  type Connection,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { CADENCE_FUNDING_TWO_DAY_LAMPORTS } from "../../services/src/protocolVersions.generated.js";
import {
  canonicalDevnetReplayDomainHex,
  type LaunchPlannerInput,
} from "./launchPlanner.js";
import { quoteLaunch } from "./operatorPlan.js";
import { SOLANA_DEVNET_GENESIS_HASH, ZKUBE_PROGRAM_ID } from "../../shared/chain.js";
import { dailyWindow } from "../../services/src/zkubeCore.js";
// The instant a day opens; the core owns the boundary (07:00 UTC).
const opens = (day: number) => dailyWindow(day).opensAt;

const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
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
      launchCutoffUnixTimestamp: opens(100) + 3_600,
      deployedProgramDataSha256,
      programAllocationBytes: allocationBytes,
      programUpgradeAuthority: upgradeAuthority.toBase58(),
      keeperReleaseFingerprint: "3".repeat(64),
      authorityReserveLamports: 100_000_000,
      deployerReserveLamports: 100_000_000,
    };
    const plan = await quoteLaunch(
      input,
      launchConnection({ upgradeAuthority, team, allocationBytes }),

    );

    // Initialization, cadence funding, then one transaction that prepares
    // the launch Daily, seeds it and unpauses. Nothing is staged ahead for the
    // Daily, and nothing activates it.
    expect(plan.payload.transactions).toHaveLength(3);
    expect(plan.payload.transactions[2]?.instructions).toHaveLength(3);
    const coder = new BorshInstructionCoder(convertIdlToCamelCase(IDL));
    expect(plan.payload.transactions.map(transaction => transaction.instructions.map(instruction =>
      instruction.program === SystemProgram.programId.toBase58() ? "transfer" : coder.decode(Buffer.from(instruction.data, "base64"))?.name)))
      .toEqual([["initializeProtocol"], ["transfer"],
        ["prepareArenaDaily", "depositArenaDaily", "setProtocolPause"]]);
    // Only the program's upgrade authority can bootstrap its protocol.
    expect(plan.payload.transactions[0]!.instructions[0]!.accounts.filter(account => account.signer)
      .map(account => account.address).sort()).toEqual([authority.toBase58(), upgradeAuthority.toBase58()].sort());
    const operation = plan.payload.operation;
    if (operation.kind !== "launch") throw new Error("Expected launch plan");
    // The launch pot, and cadence funding for two overlapping Dailies with full boards.
    expect(operation.costs.seedLamports).toBe(1_000_000_000 + CADENCE_FUNDING_TWO_DAY_LAMPORTS);
    expect(operation.costs.transactionCount).toBe(3);
    expect(plan.fingerprint).toMatch(/^[0-9a-f]{64}$/);

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
      launchCutoffUnixTimestamp: opens(100) + 3_600,
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
      quoteLaunch(
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
    getBlockTime: async () => args.observedUnixTimestamp ?? opens(100) + 100,
    getMultipleAccountsInfo: async (addresses: PublicKey[]) => addresses.map(address =>
      address.equals(ZKUBE_PROGRAM_ID) ? account(program, true, LOADER, 1) :
      address.equals(programDataAddress) ? account(programData, false, LOADER, 1_000_000) : null),
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
