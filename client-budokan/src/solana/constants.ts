import { PublicKey, clusterApiUrl, SYSVAR_SLOT_HASHES_PUBKEY } from "@solana/web3.js";

// Programme déployé sur Solana devnet
export const ZKUBE_PROGRAM_ID = new PublicKey(
  "8vB8kAAsuxLGejEweuJRdnAAe5wuUFTdt2fRQjeqvC6v"
);

// Adresses VRF MagicBlock (ephemeral-vrf-sdk 0.2.3)
export const VRF_PROGRAM_ID = new PublicKey(
  "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
);
export const ORACLE_QUEUE = new PublicKey(
  "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh"
);

// Réseau Solana
export const SOLANA_ENDPOINT = clusterApiUrl("devnet");

// Re-export utile
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
