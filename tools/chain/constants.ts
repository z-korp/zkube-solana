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

// zKube program.
export const ZKUBE_PROGRAM_ID = new PublicKey(
  "Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd",
);

/** The first per-player run identifier on every fresh deployment. */
export const INITIAL_RUN_ID = 1n;

// Solana base layer.
export const SOLANA_ENDPOINT =
  "https://rpc.magicblock.app/devnet";

export const SOLANA_DEVNET_GENESIS_HASH =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

// MagicBlock delegation record for an active run PDA.
export function getDelegationRecord(pdaPubkey: PublicKey): PublicKey {
  return delegationRecordPdaFromDelegatedAccount(pdaPubkey);
}
