// @vitest-environment node

import { createHash } from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import { ZKUBE_PROGRAM_ID } from "../../client/src/chain/constants";
import {
  checkChainReadiness,
  expectedGenesisHashFromEnv,
} from "../src/serviceReadiness";

const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

describe("keeper chain readiness", () => {
  it("cannot redirect this release away from Devnet genesis", () => {
    expect(expectedGenesisHashFromEnv({})).toBe(
      "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    );
    expect(() => expectedGenesisHashFromEnv({
      SOLANA_EXPECTED_GENESIS_HASH: Keypair.generate().publicKey.toBase58(),
    })).toThrow("Devnet genesis");
  });

  it("binds writes to the exact padded ProgramData fingerprint", async () => {
    const genesis = Keypair.generate().publicKey.toBase58();
    const programDataAddress = Keypair.generate().publicKey;
    const program = Buffer.alloc(36);
    program.writeUInt32LE(2, 0);
    programDataAddress.toBuffer().copy(program, 4);
    const programData = Buffer.alloc(49);
    programData.writeUInt32LE(3, 0);
    Buffer.from([1, 2, 3, 0]).copy(programData, 45);
    const expected = createHash("sha256").update(programData.subarray(45)).digest("hex");
    const connection = {
      getGenesisHash: vi.fn().mockResolvedValue(genesis),
      getAccountInfo: vi.fn(async (address: PublicKey) => {
        if (address.equals(ZKUBE_PROGRAM_ID)) {
          return { owner: LOADER, executable: true, data: program };
        }
        if (address.equals(programDataAddress)) {
          return { owner: LOADER, executable: false, data: programData };
        }
        return null;
      }),
    } as never;

    await expect(
      checkChainReadiness({
        connection,
        expectedGenesisHash: genesis,
        expectedDeployedSbfSha256: expected,
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      checkChainReadiness({
        connection,
        expectedGenesisHash: genesis,
        expectedDeployedSbfSha256: "00".repeat(32),
      }),
    ).resolves.toEqual({
      ok: false,
      error: "deployed zkube program fingerprint does not match keeper",
    });
  });
});
