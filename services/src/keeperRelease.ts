import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { ZKUBE_PROGRAM_ID, MIN_SUPPORTED_DAY_ID } from "../../shared/chain.js";
import { IDL } from "../../tools/chain/idl/index.js";

const idlHash = createHash("sha256").update(JSON.stringify(IDL)).digest("hex");

/**
 * The keeper release a running Worker is: the version Cloudflare deployed,
 * the keeper key and the launch day. Any new deployment is a new version, so
 * an approval never carries over to code that was not reviewed.
 */
export function keeperReleaseRecord(input: {
  keeperPublicKey: string;
  workerVersionId: string;
  launchDayId: number;
}) {
  const keeper = new PublicKey(input.keeperPublicKey).toBase58();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.workerVersionId)) {
    throw new Error("keeper release must name the deployed Worker version");
  }
  if (!Number.isSafeInteger(input.launchDayId) || input.launchDayId < MIN_SUPPORTED_DAY_ID || input.launchDayId > 0xffff_ffff) {
    throw new Error("launch day must be a supported u32 day");
  }
  return {
    record: { keeper, workerVersionId: input.workerVersionId, launchDayId: input.launchDayId,
      programId: ZKUBE_PROGRAM_ID.toBase58(), idlHash },
    fingerprint: createHash("sha256")
      .update(JSON.stringify([input.workerVersionId, keeper, input.launchDayId])).digest("hex"),
  };
}
