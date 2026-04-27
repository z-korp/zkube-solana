interface ImportMetaEnv {
  // ── Starknet / Cartridge (modes: mainnet | sepolia | slot) ─────────────────
  readonly VITE_PUBLIC_DEPLOY_TYPE:
    | "mainnet"
    | "sepolia"
    | "sepoliadev1"
    | "sepoliadev2"
    | "slot"
    | "slotdev";
  readonly VITE_PUBLIC_NODE_URL: string;
  readonly VITE_PUBLIC_TORII: string;
  readonly VITE_PUBLIC_DENSHOKAN_ADDRESS: string;
  readonly VITE_PUBLIC_METAGAME_TORII_URL: string;
  readonly VITE_PUBLIC_METAGAME_NAMESPACE: string;
  readonly VITE_PUBLIC_LEADERBOARD_EXCLUDED_NAMES?: string;

  // ── Solana / MagicBlock (client-budokan/.env)
  // Programme principal zKube
  readonly VITE_PUBLIC_SOLANA_ZKUBE_PROGRAM_ID?: string;
  // VRF MagicBlock
  readonly VITE_PUBLIC_SOLANA_VRF_PROGRAM_ID?: string;
  readonly VITE_PUBLIC_SOLANA_ORACLE_QUEUE?: string;
  // Ephemeral Rollup
  readonly VITE_PUBLIC_SOLANA_DELEGATION_PROGRAM_ID?: string;
  readonly VITE_PUBLIC_SOLANA_MAGIC_PROGRAM_ID?: string;
  readonly VITE_PUBLIC_SOLANA_MAGIC_CONTEXT_ID?: string;
  readonly VITE_PUBLIC_SOLANA_ER_VALIDATOR?: string;
  // RPC endpoints
  readonly VITE_PUBLIC_SOLANA_RPC_ENDPOINT?: string;
  readonly VITE_PUBLIC_SOLANA_ER_RPC_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
