import { PublicKey } from "@solana/web3.js";
import { delegationRecordPdaFromDelegatedAccount } from "@magicblock-labs/ephemeral-rollups-sdk";

export const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
export const MAGIC_PROGRAM_ID = new PublicKey(
  "Magic11111111111111111111111111111111111111",
);
export const MAGIC_CONTEXT_ID = new PublicKey(
  "MagicContext1111111111111111111111111111111",
);

export { ZKUBE_PROGRAM_ID, SOLANA_ENDPOINT, SOLANA_DEVNET_GENESIS_HASH } from "../../shared/chain.js";

// MagicBlock delegation record for an active run PDA.
export function getDelegationRecord(pdaPubkey: PublicKey): PublicKey {
  return delegationRecordPdaFromDelegatedAccount(pdaPubkey);
}
