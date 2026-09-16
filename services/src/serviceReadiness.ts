import { Connection } from "@solana/web3.js";
import { SOLANA_DEVNET_GENESIS_HASH, SOLANA_ENDPOINT } from "../../shared/chain.js";
export { SOLANA_DEVNET_GENESIS_HASH };

export function createDevnetConnection(env: Record<string, string | undefined> = process.env): Connection {
  const endpoint = env.SOLANA_DEVNET_RPC_URL ?? SOLANA_ENDPOINT;
  const parsed = new URL(endpoint);
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new Error("Solana RPC must use HTTPS, except for localhost");
  }
  return new Connection(endpoint, "confirmed");
}

export async function checkChainReadiness(connection: Connection): Promise<{ ok: boolean; error?: string }> {
  try {
    return await connection.getGenesisHash() === SOLANA_DEVNET_GENESIS_HASH
      ? { ok: true } : { ok: false, error: "RPC genesis does not match Devnet" };
  } catch {
    return { ok: false, error: "unable to verify RPC genesis" };
  }
}
