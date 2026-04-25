import { PublicKey, clusterApiUrl, SYSVAR_SLOT_HASHES_PUBKEY } from "@solana/web3.js";

// ── Adresses MagicBlock Ephemeral Rollup ─────────────────────────────────────
export const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
);
export const MAGIC_PROGRAM_ID = new PublicKey(
  "Magic11111111111111111111111111111111111111"
);
export const MAGIC_CONTEXT_ID = new PublicKey(
  "MagicContext1111111111111111111111111111111"
);

// Programme déployé sur Solana devnet
export const ZKUBE_PROGRAM_ID = new PublicKey(
  "7zdLjmcar3hQZoosNpgZ4JBmvbHzm8bxTBiBZCWrY2nN"
);

// VRF MagicBlock officiel (devnet) — fonctionne avec l'oracle queue Cuj97...
// Ces adresses correspondent au programme déployé 7zdLjmcar3hQZoosNpgZ4JBmvbHzm8bxTBiBZCWrY2nN
export const VRF_PROGRAM_ID = new PublicKey(
  "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
);
export const ORACLE_QUEUE = new PublicKey(
  "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh"
);

//FIX: Réseau Solana mainnet (devnet)
export const SOLANA_ENDPOINT = clusterApiUrl("devnet");

// ── Ephemeral Rollup (ER) MagicBlock 
// Validator EU devnet — make_move et close_game sont envoyés ici
// create_game reste sur devnet (délègue le compte à l'ER)
//FIX: pour mainnet on change ceci 
export const ER_RPC_ENDPOINT = "https://devnet-eu.magicblock.app";
export const ER_VALIDATOR_IDENTITY = new PublicKey(
  "MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e"
);

// reexport 
export { SYSVAR_SLOT_HASHES_PUBKEY };

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

// buffer_pda : program = ZKUBE_PROGRAM_ID (pas DELEGATION_PROGRAM_ID)
export function getDelegationBuffer(pdaPubkey: PublicKey): PublicKey {
  const [buf] = PublicKey.findProgramAddressSync(
    [Buffer.from("buffer"), pdaPubkey.toBuffer()],
    ZKUBE_PROGRAM_ID
  );
  return buf;
}

// delegation_record_pda : seed = "delegation" (pas "delegation-record")
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
