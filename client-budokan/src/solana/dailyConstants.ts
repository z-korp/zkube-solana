import { PublicKey } from "@solana/web3.js";
import { ZKUBE_PROGRAM_ID } from "./constants";

// ── PDA helpers — Daily Challenge ────────────────────────────────────────────

/** PDA du DailyChallenge pour un challenge_id donné.
 *  seeds = ["daily_challenge", challenge_id.to_le_bytes()] */
export function getDailyChallengePda(challengeId: number): PublicKey {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(challengeId, 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_challenge"), buf],
    ZKUBE_PROGRAM_ID
  );
  return pda;
}

/** PDA de la DailyEntry d'un joueur pour un challenge donné.
 *  seeds = ["daily_entry", challenge_id.to_le_bytes(), player] */
export function getDailyEntryPda(challengeId: number, player: PublicKey): PublicKey {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(challengeId, 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_entry"), buf, player.toBuffer()],
    ZKUBE_PROGRAM_ID
  );
  return pda;
}

/** PDA de l'ActiveDailyAttempt d'un joueur.
 *  seeds = ["active_daily", player] */
export function getActiveDailyPda(player: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("active_daily"), player.toBuffer()],
    ZKUBE_PROGRAM_ID
  );
  return pda;
}

// ── Dérivation déterministe (miroir Rust) ────────────────────────────────────

/** Calcule la zone_id du challenge quotidien.
 *  Miroir exact de compute_zone_id() dans create_daily_challenge.rs :
 *  SHA256(challenge_id_le || "zone") % 10 + 1  →  zone 1..=10
 */
export function computeDailyZoneId(challengeId: number): number {
  // SHA256 via SubtleCrypto serait async — on utilise une implémentation sync
  // en pur JS (même algorithme que le Rust hashv).
  // Note: cette fonction est appelée côté client uniquement en fallback
  // quand le DailyChallenge n'est pas encore indexé.
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(challengeId, 0);
  const input = Buffer.concat([buf, Buffer.from("zone")]);
  // Utilise le module crypto natif de Vite (polyfill dans browser-config)
  // Si indisponible, retourne une valeur basée sur challengeId % 10 + 1
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createHash } = require("crypto");
    const hash = createHash("sha256").update(input).digest();
    const n = hash.readBigUInt64LE(0);
    return Number(n % 10n) + 1;
  } catch {
    // Fallback simple si crypto n'est pas disponible
    return (challengeId % 10) + 1;
  }
}

/** Calcule un mutator_id déterministe.
 *  SHA256(challenge_id_le || kind) % 8  →  0..=7
 */
export function computeDailyMutatorId(challengeId: number, kind: "active" | "passive"): number {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(challengeId, 0);
  const input = Buffer.concat([buf, Buffer.from(kind)]);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createHash } = require("crypto");
    const hash = createHash("sha256").update(input).digest();
    const n = hash.readBigUInt64LE(0);
    return Number(n % 8n);
  } catch {
    return 0;
  }
}

/** challenge_id du jour courant = Math.floor(Date.now() / 86400_000) */
export function getTodayChallengeId(): number {
  return Math.floor(Date.now() / 86_400_000);
}
