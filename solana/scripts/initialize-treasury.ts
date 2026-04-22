/**
 * Script d'initialisation de la treasury z-korp
 * Usage: npx ts-node scripts/initialize-treasury.ts [fee_en_lamports]
 * Exemple: npx ts-node scripts/initialize-treasury.ts 1000000  (= 0.001 SOL)
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection, clusterApiUrl } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import idl from "../target/idl/solana.json";

const PROGRAM_ID = new PublicKey("8vB8kAAsuxLGejEweuJRdnAAe5wuUFTdt2fRQjeqvC6v");

async function main() {
  // Fee en lamports (argument CLI ou 1_000_000 par défaut = 0.001 SOL)
  const feePerGame = BigInt(process.argv[2] ?? "1000000");
  console.log(`Fee par partie : ${feePerGame} lamports (${Number(feePerGame) / 1e9} SOL)`);

  // Charge le wallet depuis le keypair Solana par défaut (~/.config/solana/id.json)
  const keypairPath = process.env.KEYPAIR_PATH ??
    path.join(process.env.HOME!, ".config", "solana", "id.json");
  const raw = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const authority = Keypair.fromSecretKey(Uint8Array.from(raw));
  console.log(`Authority (wallet z-korp devnet): ${authority.publicKey.toBase58()}`);

  // Connexion devnet
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  // Programme Anchor
  const program = new anchor.Program(idl as any, provider);

  // Dérive le PDA treasury
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    PROGRAM_ID
  );
  console.log(`Treasury PDA: ${treasuryPda.toBase58()}`);

  // Vérifie si la treasury existe déjà
  const existing = await connection.getAccountInfo(treasuryPda);
  if (existing) {
    console.log("hop hopppp Treasury déjà initialisée !");
    const data = await (program.account as any).treasury.fetch(treasuryPda);
    console.log(`   Authority: ${data.authority.toBase58()}`);
    console.log(`   Fee par partie: ${data.feePerGame.toString()} lamports`);
    console.log(`   Total collecté: ${data.totalCollected.toString()} lamports`);
    return;
  }

  // Appel initialize_treasury
  console.log("\nInitialisation de la treasury...");
  const tx = await (program.methods as any)
    .initializeTreasury(new anchor.BN(feePerGame.toString()))
    .accounts({
      authority: authority.publicKey,
      treasury: treasuryPda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log(`\n Treasury initialisée !`);
  console.log(`   TX: https://solscan.io/tx/${tx}?cluster=devnet`);
  console.log(`   Treasury PDA: ${treasuryPda.toBase58()}`);
  console.log(`   Fee par partie: ${feePerGame} lamports (${Number(feePerGame) / 1e9} SOL)`);
}

main().catch((err) => {
  console.error("Erreur:", err);
  process.exit(1);
});
