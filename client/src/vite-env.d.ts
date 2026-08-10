/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_SOLANA_RPC_ENDPOINT?: string;
  readonly VITE_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH?: string;
  readonly VITE_PUBLIC_SOLANA_ZKUBE_PROGRAM_ID?: string;
  readonly VITE_PUBLIC_SOLANA_DELEGATION_PROGRAM_ID?: string;
  readonly VITE_PUBLIC_SOLANA_MAGIC_PROGRAM_ID?: string;
  readonly VITE_PUBLIC_SOLANA_MAGIC_CONTEXT_ID?: string;
  readonly VITE_PUBLIC_MAGICBLOCK_ROUTER_RPC?: string;
  readonly VITE_PUBLIC_SOLANA_VRF_QUEUE?: string;
  readonly VITE_PUBLIC_ZKUBE_TELEMETRY?: string;
  /** Keeper origin serving prize-notification registration; push is off without it. */
  readonly VITE_PUSH_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
