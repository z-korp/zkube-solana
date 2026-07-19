import { createHash } from "node:crypto";
import { Connection, PublicKey } from "@solana/web3.js";

import { ZKUBE_PROGRAM_ID } from "./arcadeChain.js";

const SOLANA_DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

const UPGRADEABLE_LOADER_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

export interface ChainReadinessResult {
  ok: boolean;
  error?: string;
}

export function expectedGenesisHashFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.SOLANA_EXPECTED_GENESIS_HASH ?? SOLANA_DEVNET_GENESIS_HASH;
}

/** Creates the keeper's base-layer connection; Router and ER RPCs stay separate. */
export function createDevnetConnection(
  env: Record<string, string | undefined> = process.env,
): Connection {
  const endpoint = env.SOLANA_DEVNET_RPC_URL ?? "https://rpc.magicblock.app/devnet";
  const parsed = new URL(endpoint);
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new Error("Solana RPC must use HTTPS, except for localhost");
  }
  return new Connection(endpoint, "confirmed");
}

export async function checkChainReadiness(args: {
  connection: Connection;
  expectedGenesisHash: string;
  expectedDeployedSbfSha256: string;
}): Promise<ChainReadinessResult> {
  try {
    const genesisHash = await args.connection.getGenesisHash();
    if (genesisHash !== args.expectedGenesisHash) {
      return { ok: false, error: "RPC genesis hash does not match configured Devnet" };
    }
    const program = await args.connection.getAccountInfo(ZKUBE_PROGRAM_ID, "confirmed");
    if (!program) return { ok: false, error: "zkube program account is missing" };
    if (!program.owner.equals(UPGRADEABLE_LOADER_ID)) {
      return { ok: false, error: "zkube program has an unexpected owner" };
    }
    if (
      !program.executable
      || program.data.length !== 36
      || program.data.readUInt32LE(0) !== 2
    ) {
      return { ok: false, error: "zkube program account is not executable" };
    }
    if (!/^[0-9a-f]{64}$/.test(args.expectedDeployedSbfSha256)) {
      return { ok: false, error: "configured program fingerprint is malformed" };
    }
    const programDataAddress = new PublicKey(program.data.subarray(4, 36));
    const programData = await args.connection.getAccountInfo(
      programDataAddress,
      "confirmed",
    );
    if (
      !programData
      || !programData.owner.equals(UPGRADEABLE_LOADER_ID)
      || programData.executable
      || programData.data.length < 45
      || programData.data.readUInt32LE(0) !== 3
    ) {
      return { ok: false, error: "zkube ProgramData account is invalid" };
    }
    const deployedSbfSha256 = createHash("sha256")
      .update(programData.data.subarray(45))
      .digest("hex");
    if (deployedSbfSha256 !== args.expectedDeployedSbfSha256) {
      return { ok: false, error: "deployed zkube program fingerprint does not match keeper" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "unable to verify RPC and program readiness" };
  }
}
