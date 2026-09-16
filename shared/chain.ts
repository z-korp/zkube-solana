import { PublicKey } from "@solana/web3.js";
import idl from "../tools/chain/idl/solana.json" with { type: "json" };

export const ZKUBE_PROGRAM_ID = new PublicKey(idl.address);
export const SOLANA_DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const SOLANA_ENDPOINT = "https://rpc.magicblock.app/devnet";
export const MIN_SUPPORTED_DAY_ID = 4;

export function launchDayFromEnv(env: Record<string, string | undefined> = process.env): number {
  const value = env.ZKUBE_LAUNCH_DAY_ID?.trim();
  if (!value || !/^\d+$/.test(value)) throw new Error("launch day must be a u32");
  const day = Number(value);
  if (!Number.isSafeInteger(day) || day < MIN_SUPPORTED_DAY_ID || day > 0xffff_ffff)
    throw new Error("launch day must be a supported u32");
  return day;
}
