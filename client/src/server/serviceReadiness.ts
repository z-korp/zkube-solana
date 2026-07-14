import { PublicKey, type Connection } from "@solana/web3.js";

import {
  SOLANA_DEVNET_GENESIS_HASH,
  ZKUBE_PROGRAM_ID,
} from "../chain/constants.js";

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
  return env.PAYMASTER_GENESIS_HASH ?? SOLANA_DEVNET_GENESIS_HASH;
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
