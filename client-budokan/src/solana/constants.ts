import { PublicKey, clusterApiUrl, SYSVAR_SLOT_HASHES_PUBKEY } from "@solana/web3.js";

// ── Adresses MagicBlock Ephemeral Rollup ─────────────────────────────────────
// Toutes ces valeurs viennent du fichier .env (client-budokan/.env).
// Pour modifier une adresse : changer uniquement le .env, pas ce fichier.

export const DELEGATION_PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_PUBLIC_SOLANA_DELEGATION_PROGRAM_ID
  ?? "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
);
export const MAGIC_PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_PUBLIC_SOLANA_MAGIC_PROGRAM_ID
  ?? "Magic11111111111111111111111111111111111111"
);
export const MAGIC_CONTEXT_ID = new PublicKey(
  import.meta.env.VITE_PUBLIC_SOLANA_MAGIC_CONTEXT_ID
  ?? "MagicContext1111111111111111111111111111111"
);

// Programme déployé sur Solana devnet
export const ZKUBE_PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_PUBLIC_SOLANA_ZKUBE_PROGRAM_ID
  ?? "7zdLjmcar3hQZoosNpgZ4JBmvbHzm8bxTBiBZCWrY2nN"
);

// VRF MagicBlock officiel (devnet) — fonctionne avec l'oracle queue Cuj97...
export const VRF_PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_PUBLIC_SOLANA_VRF_PROGRAM_ID
  ?? "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
);
export const ORACLE_QUEUE = new PublicKey(
  import.meta.env.VITE_PUBLIC_SOLANA_ORACLE_QUEUE
  ?? "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh"
);

// Réseau Solana (base chain)
export const SOLANA_ENDPOINT =
  import.meta.env.VITE_PUBLIC_SOLANA_RPC_ENDPOINT
  ?? clusterApiUrl("devnet");

// Ephemeral Rollup (ER) MagicBlock
// Validator EU devnet — make_move et close_game sont envoyés ici
// create_game reste sur devnet (délègue le compte à l'ER)
export const ER_RPC_ENDPOINT =
  import.meta.env.VITE_PUBLIC_SOLANA_ER_RPC_ENDPOINT
  ?? "https://devnet-eu.magicblock.app";

export const ER_VALIDATOR_IDENTITY = new PublicKey(
  import.meta.env.VITE_PUBLIC_SOLANA_ER_VALIDATOR
  ?? "MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e"
);

// reexport
export { SYSVAR_SLOT_HASHES_PUBKEY };

// ── PDA helpers ───────────────────────────────────────────────────────────────

// Calcule le PDA game_state d'un joueur
export function getGameStatePda(playerPubkey: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("game"), playerPubkey.toBuffer()],
    ZKUBE_PROGRAM_ID
  );
  return pda;
}

// Calcule le PDA identity (requis par le VRF)
export function getIdentityPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("identity")],
    ZKUBE_PROGRAM_ID
  );
  return pda;
}

// Calcule le PDA treasury z-korp
export function getTreasuryPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    ZKUBE_PROGRAM_ID
  );
  return pda;
}

// delegation_buffer : créé pendant delegate_game
// seeds = ["buffer", pda], program = ZKUBE_PROGRAM_ID
export function getDelegationBuffer(pdaPubkey: PublicKey): PublicKey {
  const [buf] = PublicKey.findProgramAddressSync(
    [Buffer.from("buffer"), pdaPubkey.toBuffer()],
    ZKUBE_PROGRAM_ID
  );
  return buf;
}

// undelegate_buffer : créé par le delegation_program pendant l'undelegation
// seeds = ["undelegate-buffer", pda], program = DELEGATION_PROGRAM_ID  ← tiret, pas underscore
// Vérifié sur le SDK v0.12 source : undelegateBufferPdaFromDelegatedAccount
// C'est ce buffer qui est passé à process_undelegation (pas le delegation_buffer)
export function getUndelegateBuffer(pdaPubkey: PublicKey): PublicKey {
  const [buf] = PublicKey.findProgramAddressSync(
    [Buffer.from("undelegate-buffer"), pdaPubkey.toBuffer()],
    DELEGATION_PROGRAM_ID
  );
  return buf;
}

// delegation_record_pda : seed = "delegation"
export function getDelegationRecord(pdaPubkey: PublicKey): PublicKey {
  const [rec] = PublicKey.findProgramAddressSync(
    [Buffer.from("delegation"), pdaPubkey.toBuffer()],
    DELEGATION_PROGRAM_ID
  );
  return rec;
}

// delegation_metadata_pda : seed = "delegation-metadata"
export function getDelegationMetadata(pdaPubkey: PublicKey): PublicKey {
  const [meta] = PublicKey.findProgramAddressSync(
    [Buffer.from("delegation-metadata"), pdaPubkey.toBuffer()],
    DELEGATION_PROGRAM_ID
  );
  return meta;
}
