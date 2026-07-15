import { Connection, PublicKey } from "@solana/web3.js";

import {
  SOLANA_DEVNET_GENESIS_HASH,
  ZKUBE_PROGRAM_ID,
} from "../../client/src/chain/constants.js";

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
    if (!program.executable || program.data.length < 36) {
      return { ok: false, error: "zkube program account is not executable" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "unable to verify RPC and program readiness" };
  }
}
