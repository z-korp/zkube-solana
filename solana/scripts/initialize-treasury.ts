/**
 * script d'initialisation de la treasury zkorp
 * Usage: npx ts-node scripts/initialize-treasury.ts [fee_en_lamports]
 * Exemple: npx ts-node scripts/initialize-treasury.ts 1000000  (environ 0.001 SOL)
 */

// TODO: ce script est pour devnet , on ajoutera une version pour mainnnet plus tard
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection, clusterApiUrl } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import idl from "../target/idl/solana.json";

const PROGRAM_ID = new PublicKey("7zdLjmcar3hQZoosNpgZ4JBmvbHzm8bxTBiBZCWrY2nN");

async function main() {
  // Fee en lamports ( 0.001 SOL)
  const feePerGame = BigInt(process.argv[2] ?? "1000000"); //TODO: a changer avec la valeur fee du. boss 
  console.log(`Fee par partie : ${feePerGame} lamports (${Number(feePerGame) / 1e9} SOL)`);

  // charge le wallet depuis le keypair Solana par défaut 
  // la mienne acti-uel 
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

  // programme Anchor
  const program = new anchor.Program(idl as any, provider);

  // Dérive le PDA treasury
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    PROGRAM_ID
  );
  console.log(`Treasury PDA: ${treasuryPda.toBase58()}`);

//--------------------------------------------
  // Vérifie si la treasury existe déjà
  const existing = await connection.getAccountInfo(treasuryPda);
  if (existing) {
    console.log("hop hopppp Treasury déjà initialisée !");
    const data = await (program.account as any).treasury.fetch(treasuryPda);
    console.log(`   Authority: ${data.authority.toBase58()}`); // c'est a qui 
    console.log(`   Fee par partie: ${data.feePerGame.toString()} lamports`);// c'est combien
    console.log(`   Total collecté: ${data.totalCollected.toString()} lamports`);// combien j'ai collecté depuis le début
    return;
  }

  //---------------------------------------------------------

  // Appel initialize_treasury
  console.log("\nInitialisation de la treasury");
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
