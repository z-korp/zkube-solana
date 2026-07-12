import { PublicKey } from "@solana/web3.js";
import { delegationRecordPdaFromDelegatedAccount } from "@magicblock-labs/ephemeral-rollups-sdk";

// API routes import the program id too; unlike Vite, their Node runtime has no
// `import.meta.env`. Keep client overrides optional without crashing the server.
const clientEnv =
  (
    import.meta as ImportMeta & {
      env?: Record<string, string | undefined>;
    }
  ).env ?? {};

// MagicBlock Ephemeral Rollup addresses. Browser overrides belong in `.env`.
export const DELEGATION_PROGRAM_ID = new PublicKey(
  clientEnv.VITE_PUBLIC_SOLANA_DELEGATION_PROGRAM_ID ??
    "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
export const MAGIC_PROGRAM_ID = new PublicKey(
  clientEnv.VITE_PUBLIC_SOLANA_MAGIC_PROGRAM_ID ??
    "Magic11111111111111111111111111111111111111",
);
export const MAGIC_CONTEXT_ID = new PublicKey(
  clientEnv.VITE_PUBLIC_SOLANA_MAGIC_CONTEXT_ID ??
    "MagicContext1111111111111111111111111111111",
);

// zKube program.
export const ZKUBE_PROGRAM_ID = new PublicKey(
  clientEnv.VITE_PUBLIC_SOLANA_ZKUBE_PROGRAM_ID ??
    "5NfTo5ML4UTa6ep4x9d616fyWQYM3CTcpcE5V9P7YUbA",
);

export const CANONICAL_DEVNET_USDC_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

// Solana base layer.
export const SOLANA_ENDPOINT =
  clientEnv.VITE_PUBLIC_SOLANA_RPC_ENDPOINT ??
  "https://rpc.magicblock.app/devnet";

export const SOLANA_DEVNET_GENESIS_HASH =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const SOLANA_EXPECTED_GENESIS_HASH =
  clientEnv.VITE_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH ??
  (isLocalEndpoint(SOLANA_ENDPOINT) ? null : SOLANA_DEVNET_GENESIS_HASH);

export const PAYMASTER_ENDPOINT =
  clientEnv.VITE_PUBLIC_ZKUBE_PAYMASTER_ENDPOINT ?? "/api/paymaster";

function isLocalEndpoint(endpoint: string): boolean {
  try {
    const hostname = new URL(endpoint).hostname;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

// MagicBlock delegation record for an active run PDA.
export function getDelegationRecord(pdaPubkey: PublicKey): PublicKey {
  return delegationRecordPdaFromDelegatedAccount(pdaPubkey);
}
