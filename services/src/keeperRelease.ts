import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { ZKUBE_PROGRAM_ID, MIN_SUPPORTED_DAY_ID } from "../../shared/chain.js";

export const KEEPER_SCHEMA_VERSION = 1 as const;
const idlHash = createHash("sha256")
  .update(readFileSync(new URL("../../tools/chain/idl/solana.json", import.meta.url))).digest("hex");

export function keeperReleaseRecord(input: {
  keeperPublicKey: string;
  keeperImageReference: string;
  launchDayId: number;
}) {
  const keeper = new PublicKey(input.keeperPublicKey).toBase58();
  if (!/^registry\.fly\.io\/zkube-solana-devnet-keeper:deployment-[0-9A-HJKMNP-TV-Z]{26}$/.test(input.keeperImageReference)) {
    throw new Error("keeper image reference must be the Fly deployment tag");
  }
  if (!Number.isSafeInteger(input.launchDayId) || input.launchDayId < MIN_SUPPORTED_DAY_ID || input.launchDayId > 0xffff_ffff) {
    throw new Error("launch day must be a supported u32 day");
  }
  return {
    record: { keeper, keeperImageReference: input.keeperImageReference, launchDayId: input.launchDayId,
      programId: ZKUBE_PROGRAM_ID.toBase58(), idlHash },
    fingerprint: createHash("sha256")
      .update(JSON.stringify([input.keeperImageReference, keeper, input.launchDayId])).digest("hex"),
  };
}
