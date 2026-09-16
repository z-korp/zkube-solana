import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PublicKey, type Connection } from "@solana/web3.js";
import { BorshInstructionCoder } from "@anchor-lang/core";
import { describe, expect, it } from "vitest";
import { planSuspension, runSuspension } from "./suspensionRunner.js";
import { SOLANA_DEVNET_GENESIS_HASH, ZKUBE_PROGRAM_ID } from "./constants.js";
import { deriveProtocolConfigPda } from "./pdas.js";
import { zkubeProgram } from "./program.js";
import { createReadOnlyWallet } from "./readOnlyWallet.js";
import { PROTOCOL_ACCOUNT_VERSION } from "../../services/src/protocolVersions.generated.js";

const authority = new PublicKey(new Uint8Array(32).fill(7));
const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const sbf = Buffer.alloc(64, 9);
const input = { rpc: "https://api.devnet.solana.com", authority: authority.toBase58(), untilDay: 21005,
  deployedProgramDataSha256: createHash("sha256").update(sbf).digest("hex") };

async function connection() {
  const programData = PublicKey.findProgramAddressSync([ZKUBE_PROGRAM_ID.toBuffer()], loader)[0];
  const program = Buffer.alloc(36); program.writeUInt32LE(2); programData.toBuffer().copy(program, 4);
  const data = Buffer.alloc(45 + sbf.length); data.writeUInt32LE(3); data[12] = 1;
  authority.toBuffer().copy(data, 13); sbf.copy(data, 45);
  const rpc = {
    getGenesisHash: async () => SOLANA_DEVNET_GENESIS_HASH,
    getLatestBlockhash: async () => ({ blockhash: authority.toBase58(), lastValidBlockHeight: 100 }),
    getFeeForMessage: async () => ({ value: 5000 }),
    getBalance: async () => 200_000_000,
    getAccountInfo: async (address: PublicKey) => address.equals(ZKUBE_PROGRAM_ID)
      ? { owner: loader, executable: true, data: program }
      : address.equals(programData) ? { owner: loader, executable: false, data, lamports: 100_000 }
      : address.equals(deriveProtocolConfigPda()) ? { owner: ZKUBE_PROGRAM_ID, data: protocol } : null,
  };
  const protocol = await zkubeProgram(rpc as unknown as Connection, createReadOnlyWallet(authority))
    .coder.accounts.encode("protocolConfig", { version: PROTOCOL_ACCOUNT_VERSION, authority,
      teamDestination: new PublicKey(new Uint8Array(32).fill(8)), replayDomain: Array(32).fill(1), paused: false, bump: 1 });
  return rpc;
}

describe("suspension command", () => {
  it("suspension_plan_pins_the_authority_day_and_exact_instruction_without_a_signer", async () => {
    const rpc = await connection();
    const planned = await planSuspension(rpc as unknown as Connection, input);
    expect(planned.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(planned.plan.transaction.signatures.every(value => value.signature === null)).toBe(true);
    const decoded = new BorshInstructionCoder(zkubeProgram(rpc as unknown as Connection, createReadOnlyWallet(authority)).idl)
      .decode(planned.plan.transaction.instructions[0]!.data);
    expect(decoded).toEqual({ name: "setArenaSuspension", data: { suspendedUntilDay: input.untilDay } });
    expect(planned.payload.transaction.feePayer).toBe(input.authority);
    expect((await planSuspension(rpc as unknown as Connection, { ...input, untilDay: input.untilDay + 1 })).fingerprint)
      .not.toBe(planned.fingerprint);
    await expect(planSuspension(rpc as unknown as Connection, { ...input, deployedProgramDataSha256: "0".repeat(64) }))
      .rejects.toThrow("Deployed program differs");
    rpc.getFeeForMessage = async () => ({ value: 10001 });
    await expect(planSuspension(rpc as unknown as Connection, input)).rejects.toThrow("approved bounds");
    rpc.getFeeForMessage = async () => ({ value: 5000 });
    rpc.getBalance = async () => 99_000_000;
    await expect(planSuspension(rpc as unknown as Connection, input)).rejects.toThrow("approved bounds");
    rpc.getGenesisHash = async () => "wrong cluster";
    await expect(planSuspension(rpc as unknown as Connection, input)).rejects.toThrow("Devnet");
  });

  it("suspension_without_the_exact_fingerprint_loads_no_keypair", async () => {
    const planned = await planSuspension(await connection() as unknown as Connection, input);
    const scratch = fileURLToPath(new URL("../../build/suspension-tests/", import.meta.url));
    mkdirSync(scratch, { recursive: true });
    const directory = mkdtempSync(scratch + "case-");
    const path = directory + "/bundle.json";
    try {
      writeFileSync(path, JSON.stringify({ payload: planned.payload, fingerprint: planned.fingerprint }));
      for (const approval of [undefined, "0".repeat(64)]) {
        await expect(runSuspension("execute", { ZKUBE_SUSPENSION_BUNDLE: path, ZKUBE_APPROVAL: approval,
          ZKUBE_PROTOCOL_AUTHORITY_KEYPAIR: directory + "/no-keypair-exists" })).rejects.toThrow("before loading a signer");
      }
    } finally { rmSync(directory, { recursive: true }); }
  });
});
