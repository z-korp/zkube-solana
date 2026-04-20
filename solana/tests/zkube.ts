/**
 * Tests d'intégration zkube-solana
 * Programme déployé sur devnet: 8vB8kAAsuxLGejEweuJRdnAAe5wuUFTdt2fRQjeqvC6v
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, SYSVAR_SLOT_HASHES_PUBKEY } from "@solana/web3.js";
import { assert } from "chai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IDL = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../target/idl/solana.json"), "utf8")
);

// Adresses VRF MagicBlock devnet (ephemeral-vrf-sdk 0.2.3)
const VRF_PROGRAM_ID = new PublicKey("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
const ORACLE_QUEUE   = new PublicKey("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh");

describe("zkube-solana — flow complet", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program(IDL, provider);
  const player  = provider.wallet.publicKey;

  const [gameStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("game"), player.toBuffer()],
    program.programId
  );
  const [identityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("identity")],
    program.programId
  );

  console.log("Program ID    :", program.programId.toBase58());
  console.log("Player        :", player.toBase58());
  console.log("GameState PDA :", gameStatePda.toBase58());

  // Repart toujours de zéro
  before(async () => {
    const existing = await program.account.gameState.fetchNullable(gameStatePda);
    if (existing) {
      await program.methods.closeGame()
        .accounts({ player, gameState: gameStatePda })
        .rpc();
      console.log("   Ancienne partie fermée ✅");
    }
  });

  // ----------------------------------------------------------------
  // 1. create_game — crée le compte + envoie la requête VRF
  // ----------------------------------------------------------------
  it("1. create_game", async () => {
    const tx = await program.methods.createGame()
      .accounts({
        player,
        gameState: gameStatePda,
        oracleQueue: ORACLE_QUEUE,
        identity: identityPda,
        vrfProgram: VRF_PROGRAM_ID,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("   tx:", tx);

    const gs = await program.account.gameState.fetch(gameStatePda);
    assert.equal(gs.player.toBase58(), player.toBase58());
    assert.equal(gs.over, false);
    assert.equal(gs.score, 0);
    assert.equal(gs.moveCount, 0);
    console.log("   ✅ GameState créé, grille vide (en attente VRF)");
  });

  // ----------------------------------------------------------------
  // 2. receive_randomness — initialise la grille avec de l'aléatoire
  //    (simule le callback VRF, normalement fait par l'oracle MagicBlock)
  // ----------------------------------------------------------------
  it("2. receive_randomness — grille initialisée", async () => {
    const randomness = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 256)
    );

    const tx = await program.methods.receiveRandomness(randomness)
      .accounts({ gameState: gameStatePda })
      .rpc();

    console.log("   tx:", tx);

    const gs = await program.account.gameState.fetch(gameStatePda);
    const blocks = gs.blocks as number[];

    console.log("   Seed:", gs.seed.toString());
    console.log("   Ligne 0:", blocks.slice(0, 8).join(", "));
    console.log("   Ligne 1:", blocks.slice(8, 16).join(", "));
    console.log("   Ligne 2:", blocks.slice(16, 24).join(", "));
    console.log("   Ligne 3:", blocks.slice(24, 32).join(", "));

    assert.notEqual(gs.seed.toString(), "0");
    assert.isAbove(
      blocks.slice(0, 32).filter((b: number) => b > 0).length,
      0,
      "Les 4 premières lignes doivent avoir des blocs"
    );
    blocks.forEach((b: number, i: number) =>
      assert.isTrue(b >= 0 && b <= 4, `blocks[${i}]=${b} invalide`)
    );
    console.log("   ✅ Grille initialisée avec de vrais blocs");
  });

  // ----------------------------------------------------------------
  // 3. make_move — joue un coup sur la grille initialisée
  // ----------------------------------------------------------------
  it("3. make_move — coup sur grille initialisée", async () => {
    const avant = await program.account.gameState.fetch(gameStatePda);
    console.log("   Avant — ligne 0:", (avant.blocks as number[]).slice(0, 8).join(", "));
    console.log("   Avant — score:", avant.score, "| moves:", avant.moveCount);

    const tx = await program.methods.makeMove(0, 0, 4)
      .accounts({ player, gameState: gameStatePda })
      .rpc();

    console.log("   tx:", tx);

    const apres = await program.account.gameState.fetch(gameStatePda);
    console.log("   Après — ligne 0:", (apres.blocks as number[]).slice(0, 8).join(", "));
    console.log("   Après — score:", apres.score, "| moves:", apres.moveCount);

    assert.equal((apres.moveCount as number), (avant.moveCount as number) + 1);
    assert.isFalse(apres.over);
    console.log("   ✅ Coup joué, grille mise à jour");
  });

  // ----------------------------------------------------------------
  // 4. make_move x5 — joue plusieurs coups, vérifie la progression
  // ----------------------------------------------------------------
  it("4. make_move x5 — progression du jeu", async () => {
    for (let i = 0; i < 5; i++) {
      await program.methods.makeMove(0, 0, 4)
        .accounts({ player, gameState: gameStatePda })
        .rpc();
    }

    const gs = await program.account.gameState.fetch(gameStatePda);
    console.log("   Moves total:", gs.moveCount);
    console.log("   Score:", gs.score);
    console.log("   Game over:", gs.over);
    console.log("   Ligne 0:", (gs.blocks as number[]).slice(0, 8).join(", "));
    console.log("   Ligne 1:", (gs.blocks as number[]).slice(8, 16).join(", "));

    assert.isAtLeast((gs.moveCount as number), 6);
    console.log("   ✅ Jeu progresse correctement");
  });
});

// ----------------------------------------------------------------
// TEST SÉPARÉ: attente du vrai oracle VRF (non bloquant)
// ----------------------------------------------------------------
describe("zkube-solana — VRF oracle (optionnel)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program(IDL, provider);
  const player  = provider.wallet.publicKey;

  const [gameStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("game"), player.toBuffer()],
    program.programId
  );
  const [identityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("identity")],
    program.programId
  );

  it("VRF oracle callback (max 30s — passe même sans réponse)", async () => {
    // Recrée une partie pour tester le vrai oracle
    const existing = await program.account.gameState.fetchNullable(gameStatePda);
    if (existing) {
      await program.methods.closeGame()
        .accounts({ player, gameState: gameStatePda })
        .rpc();
    }

    await program.methods.createGame()
      .accounts({
        player,
        gameState: gameStatePda,
        oracleQueue: ORACLE_QUEUE,
        identity: identityPda,
        vrfProgram: VRF_PROGRAM_ID,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("   Attente oracle MagicBlock (max 30s)...");
    let gs: any = null;

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      gs = await program.account.gameState.fetch(gameStatePda);
      if (gs.seed.toString() !== "0") break;
      process.stdout.write(`   ${i + 1}/30s...\r`);
    }

    console.log("\n   Seed:", gs.seed.toString());
    if (gs.seed.toString() !== "0") {
      console.log("   ✅ Oracle VRF a répondu !");
    } else {
      console.log("   ⚠️  Oracle pas encore répondu ");
    }
    // Passe toujours — l'oracle est un point externe
  });
});
