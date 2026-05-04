import { useState, useCallback, useEffect, useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_SLOT_HASHES_PUBKEY, Transaction, TransactionInstruction } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { IDL } from "./idl";
import {
  VRF_PROGRAM_ID,
  ORACLE_QUEUE,
  ER_RPC_ENDPOINT,
  MAGIC_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  ZKUBE_PROGRAM_ID,
  DELEGATION_PROGRAM_ID,
  getGameStatePda,
  getIdentityPda,
  getTreasuryPda,
  getDelegationBuffer,
  getUndelegateBuffer,
  getDelegationRecord,
  getDelegationMetadata,
} from "./constants";

// ── Session key storage ──────────────────────────────────────────────────────
// La session_key est stockée dans sessionStorage (persistante sur refresh,
// effacée à la fermeture de l'onglet). Clé de stockage par wallet.
const SESSION_KEY_PREFIX = "zkube_session_";
const ACTIVE_GAME_PDA_PREFIX = "zkube_game_pda_";

function saveSessionKeypair(playerPubkey: string, keypair: Keypair): void {
  try {
    sessionStorage.setItem(
      SESSION_KEY_PREFIX + playerPubkey,
      JSON.stringify(Array.from(keypair.secretKey))
    );
  } catch (_) {}
}

function loadSessionKeypair(playerPubkey: string): Keypair | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY_PREFIX + playerPubkey);
    if (!raw) return null;
    const secretKey = new Uint8Array(JSON.parse(raw));
    return Keypair.fromSecretKey(secretKey);
  } catch (_) {
    return null;
  }
}

function clearSessionKeypair(playerPubkey: string): void {
  try {
    sessionStorage.removeItem(SESSION_KEY_PREFIX + playerPubkey);
  } catch (_) {}
}

function saveActiveGamePda(playerPubkey: string, pda: PublicKey): void {
  try {
    localStorage.setItem(ACTIVE_GAME_PDA_PREFIX + playerPubkey, pda.toBase58());
  } catch (_) {}
}

function loadActiveGamePda(playerPubkey: string): PublicKey | null {
  try {
    const raw = localStorage.getItem(ACTIVE_GAME_PDA_PREFIX + playerPubkey);
    return raw ? new PublicKey(raw) : null;
  } catch (_) {
    return null;
  }
}

function clearActiveGamePda(playerPubkey: string): void {
  try {
    localStorage.removeItem(ACTIVE_GAME_PDA_PREFIX + playerPubkey);
  } catch (_) {}
}

// ── Types ────────────────────────────────────────────────────────────────────

// Phase du cycle de vie de la partie (miroir de GamePhase Rust)
export type GamePhase = "Created" | "Delegated" | "Playing" | "Finished";

// État de la partie côté frontend
export interface SolanaGameState {
  player: string;
  blocks: number[];          // 80 valeurs (grille 10x8)
  nextRow: number[];         // 8 valeurs
  score: number;
  comboCounter: number;
  maxCombo: number;
  moveCount: number;
  seed: string;              // u64 en string (BigInt)
  over: boolean;
  delegated: boolean;        // true si le PDA est sur l'ER
  delegatedAuthority: string;
  phase: GamePhase;
  sessionKey: string;        // pubkey de la session_key autorisée
}

// ── Wallet adapté à un Keypair local (pour signer sans popup) ────────────────
class SessionWallet {
  constructor(private keypair: Keypair) {}
  get publicKey() { return this.keypair.publicKey; }
  async signTransaction<T extends import("@solana/web3.js").Transaction | import("@solana/web3.js").VersionedTransaction>(tx: T): Promise<T> {
    // VersionedTransaction a une propriété "version" — legacy Transaction n'en a pas.
    // - VersionedTransaction.sign(signers: Signer[]) → prend un tableau
    // - Transaction.partialSign(...signers: Signer[])  → prend des args spread
    if ("version" in tx) {
      // VersionedTransaction
      (tx as import("@solana/web3.js").VersionedTransaction).sign([this.keypair]);
    } else {
      // Legacy Transaction
      (tx as import("@solana/web3.js").Transaction).partialSign(this.keypair);
    }
    return tx;
  }
  async signAllTransactions<T extends import("@solana/web3.js").Transaction | import("@solana/web3.js").VersionedTransaction>(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map((tx) => this.signTransaction(tx)));
  }
}

// ── Bypass temporaire : skip delegation ──────────────────────────────────────
// Garder à false en production : les moves passent par l'ER avec session_key.
// Avec SKIP_DELEGATION=true :
//   • createGame → pas de delegate_game → 1 seul popup Phantom (au lieu de 2)
//   • make_move → Solana devnet directement, signé par Phantom (1 popup / coup)
//   • closeGame → non nécessaire (le PDA n'est pas délégué)
//   • Compte stuck existant → toujours bloqué, contacter MagicBlock Discord
const SKIP_DELEGATION = false;
// ── Hook principal ───────────────────────────────────────────────────────────
export function useSolanaGame() {
  const { connection } = useConnection();  // mainnet (devnet) connection
  const wallet = useWallet();
  const { publicKey, connected } = wallet;

  const [gameState, setGameState] = useState<SolanaGameState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [undelegatingPda, setUndelegatingPda] = useState<string | null>(null);

  // Session keypair en mémoire — reloadé depuis sessionStorage si disponible
  const [sessionKeypair, setSessionKeypair] = useState<Keypair | null>(() => {
    // Tentative de restauration immédiate (ex : refresh de page)
    // publicKey n'est pas encore disponible ici → sera rechargé dans useEffect
    return null;
  });

  // ── Connexion Ephemeral Rollup ───────────────────────────────────────────
  const erConnection = useMemo(
    () => new Connection(ER_RPC_ENDPOINT, "confirmed"),
    []
  );

  // ── Providers / Programs ─────────────────────────────────────────────────

  // Programme Anchor → mainnet (create_game, delegate_game, fetch)
  const getProgram = useCallback(() => {
    if (!publicKey || !wallet.signTransaction) return null;
    const provider = new AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
    });
    return new Program(IDL as any, provider);
  }, [connection, wallet, publicKey]);

  // Programme Anchor → ER avec le wallet Phantom (close_game, set_session_key)
  const getErProgram = useCallback(() => {
    if (!publicKey || !wallet.signTransaction) return null;
    const provider = new AnchorProvider(erConnection, wallet as any, {
      commitment: "confirmed",
    });
    return new Program(IDL as any, provider);
  }, [erConnection, wallet, publicKey]);

  // Programme Anchor → ER avec la session_key locale (make_move — SANS popup)
  const getSessionProgram = useCallback((kp: Keypair) => {
    const sessionWallet = new SessionWallet(kp);
    const provider = new AnchorProvider(erConnection, sessionWallet, {
      commitment: "confirmed",
    });
    return new Program(IDL as any, provider);
  }, [erConnection]);

  // ── Restauration de la session keypair depuis sessionStorage ─────────────
  useEffect(() => {
    if (!publicKey) return;
    const loaded = loadSessionKeypair(publicKey.toBase58());
    if (loaded) {
      setSessionKeypair(loaded);
      console.log("[Session] keypair restauré depuis sessionStorage:", loaded.publicKey.toBase58());
    }
  }, [publicKey?.toBase58()]);

  // ── Génère un nouveau session keypair et le persiste ─────────────────────
  const generateSessionKeypair = useCallback((): Keypair => {
    const kp = Keypair.generate();
    if (publicKey) {
      saveSessionKeypair(publicKey.toBase58(), kp);
    }
    setSessionKeypair(kp);
    console.log("[Session] nouveau keypair généré:", kp.publicKey.toBase58());
    return kp;
  }, [publicKey]);

  const getActiveGameStatePda = useCallback((): PublicKey | null => {
    if (!publicKey) return null;
    const stored = loadActiveGamePda(publicKey.toBase58());
    if (stored) return stored;
    const kp = sessionKeypair ?? loadSessionKeypair(publicKey.toBase58());
    return getGameStatePda(publicKey, kp?.publicKey);
  }, [publicKey, sessionKeypair]);

  const waitForMainnetOwnership = useCallback(async (pda: PublicKey): Promise<"returned" | "missing" | "timeout"> => {
    const startedAt = Date.now();
    const timeoutMs = 120_000;

    while (Date.now() - startedAt < timeoutMs) {
      const info = await connection.getAccountInfo(pda).catch(() => null);
      if (!info) return "missing";
      if (info.owner.equals(ZKUBE_PROGRAM_ID)) return "returned";

      console.log("[close_game] attente undelegation mainnet:", {
        pda: pda.toBase58(),
        owner: info.owner.toBase58(),
        elapsedSec: Math.round((Date.now() - startedAt) / 1000),
      });
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    return "timeout";
  }, [connection]);

  // ── Fetch state ──────────────────────────────────────────────────────────
  // Essaie l'ER en premier (compte délégué pendant la partie),
  // puis fallback mainnet (avant délégation ou après undelegate).
  // Anchor sérialise les variants enum en minuscules : { created: {} }
  // → Object.keys()[0] = "created". On capitalise pour correspondre au type GamePhase.
  const toPhase = useCallback((p: any, fallback: GamePhase = "Created"): GamePhase => {
    if (!p) return fallback;
    const raw: string = Object.keys(p)[0] ?? "";
    return (raw.charAt(0).toUpperCase() + raw.slice(1)) as GamePhase;
  }, []);

  const fetchGameState = useCallback(async () => {
    if (!publicKey) return;
    const activeKp = sessionKeypair ?? loadSessionKeypair(publicKey.toBase58());
    const storedPda = loadActiveGamePda(publicKey.toBase58());
    if (!storedPda && !activeKp) {
      setGameState(null);
      return;
    }
    const activePda = storedPda ?? getGameStatePda(publicKey, activeKp?.publicKey);
    const pdas = [activePda];

    const mapGs = (gs: any): SolanaGameState => ({
      player: gs.player.toBase58(),
      blocks: Array.from(gs.blocks as number[]),
      nextRow: Array.from(gs.nextRow as number[]),
      score: gs.score,
      comboCounter: gs.comboCounter,
      maxCombo: gs.maxCombo,
      moveCount: gs.moveCount,
      seed: gs.seed.toString(),
      over: gs.over,
      delegated: gs.delegated ?? false,
      delegatedAuthority: gs.delegatedAuthority?.toBase58() ?? "",
      phase: toPhase(gs.phase, "Created"),
      sessionKey: gs.sessionKey?.toBase58() ?? "",
    });

    const erProgram = getErProgram();
    if (erProgram) {
      for (const pda of pdas) {
        // 1. Essai ER (compte délégué — état temps réel)
        try {
        const gs = await (erProgram.account as any).gameState.fetchNullable(pda);
        if (gs) {
          setGameState(mapGs(gs));
          return;
        }
        } catch (_) {
          // ER indisponible ou compte pas encore délégué → fallback mainnet
        }
      }
    }

    // 2. Fallback mainnet (avant create_game ou après close_game)
    try {
      const program = getProgram();
      if (!program) return;
      for (const pda of pdas) {
        const gs = await (program.account as any).gameState.fetchNullable(pda);
        if (gs) {
          // En mode bypass, le PDA ne devrait jamais être owned par delegation_program.
          // Si c'est le cas → compte coincé d'une ancienne partie ER → on refuse de l'afficher
          // (sinon l'UI boucle sur game over avec un compte qu'on ne peut pas reset).
          if (SKIP_DELEGATION) {
            const info = await connection.getAccountInfo(pda);
            if (info && !info.owner.equals(ZKUBE_PROGRAM_ID)) {
              console.warn("[fetchGameState] PDA owned by delegation_program compte coincé, masqué en bypass mode");
              setError(
                `Compte bloqué delegation program \n` +
                `PDA: ${pda.toBase58()}\n`
              );
              setGameState(null);
              return;
            }
          }
          setGameState(mapGs(gs));
          return;
        }
      }
      // Ne pas effacer un état valide récent — protège contre les lectures RPC
      // obsolètes juste après create_game.
      setGameState((prev) => {
        if (prev && prev.seed !== "0" && !prev.over) {
          console.warn("[fetchGameState] devnet null mais gameState valide en mémoire — conservé");
          return prev;
        }
        return null;
      });
    } catch (e) {
      console.error("[useSolanaGame] fetchGameState error:", e);
    }
  }, [publicKey, sessionKeypair, getProgram, getErProgram, connection, toPhase]);

  // Rafraîchit l'état quand le wallet est connecté.
  // On dépend de publicKey?.toBase58() (string stable) et non de l'objet PublicKey
  // pour éviter que le changement de référence du wallet après une signature Phantom
  // ne relance le fetch inutilement (wallet → getProgram → fetchGameState cascade).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (connected && publicKey) {
      fetchGameState();
    } else {
      setGameState(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, publicKey?.toBase58()]);

  // Polling tant que le VRF n'a pas répondu (seed == 0 = grille vide)
  useEffect(() => {
    if (!gameState || gameState.seed !== "0") return;
    const interval = setInterval(() => {
      fetchGameState();
    }, 2000);
    return () => clearInterval(interval);
  }, [gameState?.seed, fetchGameState]);

  // ── delegate_game (mainnet) ──────────────────────────────────────────────
  // Passe les 9 comptes explicitement — Anchor auto-résolution n'est pas
  // fiable pour les chaînes de dépendances complexes (buffer_pda → pda → player).
  const delegateGame = useCallback(async (program: any, playerKey: PublicKey, gameStatePda: PublicKey) => {
    const bufferPda           = getDelegationBuffer(gameStatePda);
    const delegationRecordPda = getDelegationRecord(gameStatePda);
    const delegationMetaPda   = getDelegationMetadata(gameStatePda);

    console.log("[Delegate] PDAs:", {
      gameStatePda: gameStatePda.toBase58(),
      bufferPda: bufferPda.toBase58(),
      delegationRecordPda: delegationRecordPda.toBase58(),
      delegationMetaPda: delegationMetaPda.toBase58(),
    });

    const tx = await program.methods
      .delegateGame()
      .accounts({
        player:               playerKey,
        validator:            null,
        bufferPda,
        delegationRecordPda,
        delegationMetadataPda: delegationMetaPda,
        pda:                  gameStatePda,
        ownerProgram:         ZKUBE_PROGRAM_ID,
        delegationProgram:    DELEGATION_PROGRAM_ID,
        systemProgram:        SystemProgram.programId,
      })
      .rpc({ skipPreflight: true });
    console.log("[Solana] delegate_game tx (mainnet → ER):", tx);
  }, []);

  // ── create_game (mainnet) ────────────────────────────────────────────────
  // Mode bypass (SKIP_DELEGATION=true) : 1 seul popup Phantom, moves sur devnet.
  // Mode normal (SKIP_DELEGATION=false) : 2 popups (create + delegate), moves sur ER.
  const createGame = useCallback(async () => {
    if (!publicKey) return;
    const program = getProgram();
    if (!program) return;

    setIsLoading(true);
    setError(null);
    try {
      // En mode normal, chaque nouvelle session key donne un nouveau PDA.
      // Cela permet au même wallet de rejouer même si un ancien PDA reste coincé
      // dans le delegation_program côté MagicBlock.
      const kp = SKIP_DELEGATION ? Keypair.generate() : generateSessionKeypair();
      const sessionKeyPubkey = kp.publicKey;
      const gameStatePda  = getGameStatePda(publicKey, sessionKeyPubkey);
      saveActiveGamePda(publicKey.toBase58(), gameStatePda);
      const identityPda   = getIdentityPda();
      const treasuryPda   = getTreasuryPda();

      // ── Pré-vérification rapide : compte coincé ? ────────────────────────
      // Si le PDA est owned par delegation_program (bug ER relayer), on arrête
      // immédiatement avec un message clair au lieu d'attendre 87s pour rien.
      try {
        const info = await connection.getAccountInfo(gameStatePda);
        if (info && !info.owner.equals(ZKUBE_PROGRAM_ID)) {
          const owner = info.owner.toBase58();
          console.warn("[createGame] PDA bloqué:", { pda: gameStatePda.toBase58(), owner });
          throw new Error(
            `Ton compte de jeu est bloqué par le delegation_program MagicBlock.\n` +
            `PDA: ${gameStatePda.toBase58()}\n` +
            `Solution: attends la réponse MagicBlock Discord ou utilise un autre wallet.`
          );
        }
      } catch (checkErr: any) {
        if (checkErr?.message?.includes("delegation_program")) throw checkErr;
        // Erreur RPC → on tente quand même (ne pas bloquer si RPC flaky)
      }

      if (!SKIP_DELEGATION) {
        console.log("[Session] session_key transmise à create_game:", sessionKeyPubkey.toBase58());
      }

      // create_game → mainnet (1 popup Phantom)
      const tx = await (program.methods as any)
        .createGame(sessionKeyPubkey)
        .accounts({
          player:        publicKey,
          gameState:     gameStatePda,
          oracleQueue:   ORACLE_QUEUE,
          identity:      identityPda,
          vrfProgram:    VRF_PROGRAM_ID,
          slotHashes:    SYSVAR_SLOT_HASHES_PUBKEY,
          treasury:      treasuryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setLastTx(tx);
      console.log("[Solana] create_game tx:", tx);
      setError("Grille en cours de génération (oracle VRF)...");

      // Poll VRF jusqu'à ce que la grille soit remplie (seed != 0)
      let vrfReceived = false;
      let attempts = 0;
      while (attempts < 30) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const state = await (program.account as any).gameState.fetchNullable(gameStatePda);
          if (state && state.seed && state.seed.toString() !== "0") {
            vrfReceived = true;
            console.log("[VRF] seed reçu:", state.seed.toString());
            break;
          }
        } catch (_) {}
        attempts++;
        if (attempts % 5 === 0) {
          console.log(`[VRF] attente oracle... tentative ${attempts}/30`);
        }
      }

      if (!vrfReceived) {
        console.warn("[VRF] timeout — oracle n'a pas répondu en 60s");
        setError("L'oracle VRF n'a pas répondu. Réessaie dans quelques secondes.");
        await fetchGameState().catch(() => {});
        return;
      }

      // ── Délégation à l'ER (mode normal seulement) ────────────────────────
      if (!SKIP_DELEGATION) {
        try {
          await delegateGame(program, publicKey, gameStatePda);
          console.log("[Solana] delegate_game OK — moves via ER (session_key)");
        } catch (e: any) {
          console.error("[useSolanaGame] delegate_game FAILED:", e?.message ?? e);
          await fetchGameState();
          throw e;
        }
      } else {
        console.log("[Bypass] delegation ignorée — moves sur devnet (Phantom)");
      }

      setError(null);
      await fetchGameState();
    } catch (e: any) {
      const msg: string = e?.message ?? "";
      if (e?.name === "WalletSignTransactionError" || msg.includes("User rejected")) {
        return;
      }
      if (msg.includes("already been processed") || msg.includes("already in use")) {
        try {
          const pda = getGameStatePda(publicKey!, sessionKeyPubkey);
          const gs = await (getProgram()?.account as any)?.gameState.fetchNullable(pda);
          if (gs) { await fetchGameState(); return; }
        } catch (_) {}
      }
      await fetchGameState().catch(() => {});
      setError(msg || "Erreur lors de la création de partie");
      console.error("[useSolanaGame] createGame error:", e);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, getProgram, connection, fetchGameState, delegateGame, generateSessionKeypair]);

  // ── set_session_key (ER — reconnexion mid-game) ──────────────────────────
  // Appelé si le joueur revient en cours de partie sans session_key en mémoire.
  // Le joueur signe une seule fois (1 popup), puis le jeu reprend sans popup.
  const renewSessionKey = useCallback(async () => {
    if (!publicKey) return;
    const erProgram = getErProgram();
    if (!erProgram) return;

    setIsLoading(true);
    setError(null);
    try {
      const kp = generateSessionKeypair();
      const gameStatePda = getActiveGameStatePda();
      if (!gameStatePda) return;

      const tx = await (erProgram.methods as any)
        .setSessionKey(kp.publicKey)
        .accounts({
          player:    publicKey,
          gameState: gameStatePda,
        })
        .rpc({ skipPreflight: true });

      setLastTx(tx);
      console.log("[ER] set_session_key tx (reconnexion):", tx);
    } catch (e: any) {
      const msg: string = e?.message ?? "";
      if (e?.name === "WalletSignTransactionError" || msg.includes("User rejected")) {
        return;
      }
      setError(msg || "Erreur lors du renouvellement de session");
      console.error("[useSolanaGame] renewSessionKey error:", e);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, getErProgram, generateSessionKeypair, getActiveGameStatePda]);

  // ── make_move ────────────────────────────────────────────────────────────
  // Chemin idéal : session_key locale → ER (0 popup, 0 fee).
  // Fallback session_key manquante + jeu délégué → ER + Phantom (1 popup).
  // Fallback jeu non délégué → devnet + Phantom (1 popup, fees devnet).
  const makeMove = useCallback(
    async (rowIndex: number, startIndex: number, finalIndex: number) => {
      if (!publicKey) return;

      let kp = sessionKeypair;
      if (!kp) {
        kp = loadSessionKeypair(publicKey.toBase58());
        if (kp) setSessionKeypair(kp);
      }

      const useSessionKey = !!kp;
      const isDelegated = gameState?.delegated ?? false;

      // Choix du programme selon le mode :
      // • Bypass (SKIP_DELEGATION=true) → devnet + Phantom, toujours
      // • Normal → session_key → ER sans popup ; sinon Phantom → ER ou devnet
      const signerProgram = SKIP_DELEGATION
        ? getProgram()
        : kp
          ? getSessionProgram(kp)        // ER, session_key — sans popup
          : isDelegated
            ? getErProgram()             // ER, Phantom — 1 popup
            : getProgram();              // devnet, Phantom — 1 popup

      if (!signerProgram) return;

      if (SKIP_DELEGATION) {
        console.log("[Bypass] make_move sur devnet (Phantom)");
      } else if (!useSessionKey) {
        if (!isDelegated) {
          console.warn("[useSolanaGame] Jeu non délégué — make_move sur devnet (payant)");
        } else {
          console.warn("[useSolanaGame] Pas de session_key — make_move sur ER via Phantom (1 popup)");
        }
      }

      setIsLoading(true);
      setError(null);
      try {
        const gameStatePda = getActiveGameStatePda();
        if (!gameStatePda) return;
        const signerPubkey = SKIP_DELEGATION ? publicKey : (kp ? kp.publicKey : publicKey);

        const expectedMove = gameState?.moveCount ?? 0;
        const tx = await (signerProgram.methods as any)
          .makeMove(rowIndex, startIndex, finalIndex, expectedMove)
          .accounts({
            player:    signerPubkey,
            gameState: gameStatePda,
          })
          .rpc({ skipPreflight: true });

        setLastTx(tx);
        console.log(`[ER] make_move tx (${useSessionKey ? "session_key — sans popup" : "Phantom"})`, tx);

        // Fetch l'état depuis l'ER
        const gs = await (signerProgram.account as any).gameState.fetchNullable(gameStatePda);
        if (gs) {
          const newState: SolanaGameState = {
            player:             gs.player.toBase58(),
            blocks:             Array.from(gs.blocks as number[]),
            nextRow:            Array.from(gs.nextRow as number[]),
            score:              gs.score,
            comboCounter:       gs.comboCounter,
            maxCombo:           gs.maxCombo,
            moveCount:          gs.moveCount,
            seed:               gs.seed.toString(),
            over:               gs.over,
            delegated:          gs.delegated ?? false,
            delegatedAuthority: gs.delegatedAuthority?.toBase58() ?? "",
            phase:              toPhase(gs.phase, "Playing"),
            sessionKey:         gs.sessionKey?.toBase58() ?? "",
          };
          setGameState(newState);
          return {
            rawBlocks: newState.blocks,
            nextRow:   newState.nextRow,
            over:      newState.over,
          };
        }
      } catch (e: any) {
        const msg: string = e?.message ?? e?.toString?.() ?? "";
        // User cancelled the Phantom popup — silent no-op, unlock grid
        if (e?.name === "WalletSignTransactionError" || msg.includes("User rejected")) {
          return;
        }
        // Logs de transaction (les plus utiles pour diagnostiquer)
        const txLogs: string[] = e?.logs ?? e?.transactionLogs ?? [];
        const anchorErr = e?.error?.errorCode?.code ?? e?.error?.errorMessage ?? "";
        // Extraction de l'InstructionError Solana brut
        const instrErr = e?.InstructionError ?? (e as any)?.["InstructionError"];
        // Mapping codes Anchor → noms lisibles (6000 + index)
        const ANCHOR_ERRORS: Record<number, string> = {
          6000: "CustomError", 6001: "InvalidOracleQueue", 6002: "NotGameOwner",
          6003: "GameOver",    6004: "InvalidMove",        6005: "RandomnessAlreadySet",
          6006: "Unauthorized",6007: "InsufficientFunds",  6008: "NotDelegated",
          6009: "InvalidAuthority", 6010: "InvalidState", 6011: "InvalidOwner",
          6012: "DelegationFailed", 6013: "InvalidMoveOrder",
        };
        const customCode = instrErr?.[1]?.Custom;
        const errorName  = customCode !== undefined ? (ANCHOR_ERRORS[customCode] ?? `Custom(${customCode})`) : undefined;
        console.error("[useSolanaGame] makeMove error details:", {
          message:      msg,
          anchorErr,
          instrError:   instrErr,
          instrErrJson: instrErr ? JSON.stringify(instrErr) : undefined,
          errorName,            // ← le nom lisible de l'erreur Anchor
          logs:         txLogs.length ? txLogs : "(aucun log)",
          fullJson:     JSON.stringify(e),
        });
        console.error("[useSolanaGame] makeMove error raw:", e);

        if (msg.includes("already been processed")) {
          try {
            const gameStatePda = getActiveGameStatePda();
            if (!gameStatePda) return;
            const gs = await (signerProgram.account as any).gameState.fetchNullable(gameStatePda);
            if (gs) {
              const newState: SolanaGameState = {
                player:             gs.player.toBase58(),
                blocks:             Array.from(gs.blocks as number[]),
                nextRow:            Array.from(gs.nextRow as number[]),
                score:              gs.score,
                comboCounter:       gs.comboCounter,
                maxCombo:           gs.maxCombo,
                moveCount:          gs.moveCount,
                seed:               gs.seed.toString(),
                over:               gs.over,
                delegated:          gs.delegated ?? false,
                delegatedAuthority: gs.delegatedAuthority?.toBase58() ?? "",
                phase:              toPhase(gs.phase, "Playing"),
                sessionKey:         gs.sessionKey?.toBase58() ?? "",
              };
              setGameState(newState);
              return { rawBlocks: newState.blocks, nextRow: newState.nextRow, over: newState.over };
            }
          } catch (_) {}
          return;
        }
        // Affiche l'erreur Anchor si disponible, sinon le message brut
        const displayMsg = anchorErr || msg || "Erreur lors du coup";
        setError(displayMsg);
      } finally {
        setIsLoading(false);
      }
    },
    [publicKey, sessionKeypair, gameState?.moveCount, gameState?.delegated, getSessionProgram, getErProgram, getProgram, getActiveGameStatePda, toPhase]
  );

  // ── reset_game (devnet — vide un compte coincé pour recommencer) ─────────
  // Utile si delegate_game a échoué ou si le compte est dans un état incohérent.
  // Le joueur récupère ses lamports et peut relancer create_game.
  const resetGame = useCallback(async () => {
    if (!publicKey) return;
    const program = getProgram();
    if (!program) return;

    setIsLoading(true);
    setError(null);
    try {
      const gameStatePda = getActiveGameStatePda();
      if (!gameStatePda) return;

      const tx = await (program.methods as any)
        .resetGame()
        .accounts({
          player:    publicKey,
          gameState: gameStatePda,
        })
        .rpc();

      console.log("[Solana] reset_game tx:", tx);
      clearSessionKeypair(publicKey.toBase58());
      clearActiveGamePda(publicKey.toBase58());
      setSessionKeypair(null);
      setGameState(null);
    } catch (e: any) {
      const msg: string = e?.message ?? "";
      // User cancelled the Phantom popup — silent no-op
      if (e?.name === "WalletSignTransactionError" || msg.includes("User rejected")) {
        return;
      }
      // "already been processed" = tx envoyée 2× ou confirmation tardive
      // → le reset a fonctionné, on nettoie juste le state local
      if (msg.includes("already been processed") || msg.includes("already in use")) {
        console.log("[Solana] reset_game déjà traité — nettoyage local");
        clearSessionKeypair(publicKey.toBase58());
        clearActiveGamePda(publicKey.toBase58());
        setSessionKeypair(null);
        setGameState(null);
        await fetchGameState().catch(() => {});
        return;
      }
      setError(msg || "Erreur lors du reset");
      console.error("[useSolanaGame] resetGame error:", e);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, getProgram, getActiveGameStatePda]);

  const forgetLocalGame = useCallback(() => {
    if (!publicKey) return;
    clearSessionKeypair(publicKey.toBase58());
    clearActiveGamePda(publicKey.toBase58());
    setSessionKeypair(null);
    setGameState(null);
    setUndelegatingPda(null);
    setError(null);
  }, [publicKey]);

  const markLocalGameOver = useCallback(() => {
    setGameState((prev) => prev
      ? { ...prev, over: true, phase: "Finished" }
      : prev
    );
    setError(null);
  }, []);

  // ── close_game (ER — player signe, 1 popup) ──────────────────────────────
  // Envoyé au RPC ER → commit état final + undelegate → compte revient sur mainnet.
  // Pattern docs MagicBlock : .transaction() + sign manuel + sendRawTransaction
  // NE PAS passer magic_context / magic_program → auto-résolus depuis IDL (addresses fixes)
  // → évite le bug Anchor où le flag writable=true de l'IDL est perdu si on les passe manuellement.
  const closeGame = useCallback(async () => {
    if (!publicKey) return;
    if (!wallet.signTransaction) return;
    const erProgram = getErProgram();
    if (!erProgram) return;

    setIsLoading(true);
    setError(null);
    try {
      const gameStatePda = getActiveGameStatePda();
      if (!gameStatePda) return;
      const pdaInfo = await connection.getAccountInfo(gameStatePda);
      const isOwnedByDelegationProgram = pdaInfo?.owner.equals(DELEGATION_PROGRAM_ID) ?? false;
      setUndelegatingPda(gameStatePda.toBase58());

      // ── Bypass : jeu sur devnet, pas d'ER → reset_game directement ──────
      if (SKIP_DELEGATION || (!(gameState?.delegated) && !isOwnedByDelegationProgram)) {
        console.log("[Bypass] closeGame → reset_game sur devnet");

        if (pdaInfo && !pdaInfo.owner.equals(ZKUBE_PROGRAM_ID)) {
         console.warn("[Bypass] closeGame: PDA owned by delegation_program");
         setError(
            `Compte bloqué par MagicBlock delegation_program.\n` +
            `PDA: ${gameStatePda.toBase58()}\n` +
            `Utilise un autre wallet ou attends la réponse MagicBlock Discord.`
          );
          // Force clear state local pour sortir de l'écran game over
              clearSessionKeypair(publicKey.toBase58());
              clearActiveGamePda(publicKey.toBase58());
              setSessionKeypair(null);
              setGameState(null);
              return;
        }

        const program = getProgram();
        if (!program) return;
        const tx = await (program.methods as any)
          .resetGame()
          .accounts({
            player:    publicKey,
            gameState: gameStatePda,
          })
          .rpc();
        console.log("[Solana] reset_game (bypass closeGame) tx:", tx);
        setLastTx(tx);
        clearSessionKeypair(publicKey.toBase58());
        clearActiveGamePda(publicKey.toBase58());
        setSessionKeypair(null);
        setGameState(null);
        setUndelegatingPda(null);
        return;
      }

      // ── Mode normal : close_game sur l'ER (commit + undelegate) ─────────
      // Build sans auto-compute-budget (pas de .rpc())
      // magic_context et magic_program auto-résolus depuis les addresses fixes de l'IDL
      let closeTx = await (erProgram.methods as any)
        .closeGame()
        .accounts({
          player: publicKey,
          pda:    gameStatePda,
        })
        .transaction();

      // Blockhash depuis le RPC ER (pas mainnet)
      const { blockhash } = await erConnection.getLatestBlockhash();
      closeTx.feePayer      = publicKey;
      closeTx.recentBlockhash = blockhash;

      // Signer via Phantom (1 popup)
      const signedTx = await wallet.signTransaction(closeTx);

      // Envoyer au RPC ER directement
      const txSig = await erConnection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: true,
      });

      setLastTx(txSig);
      console.log("[ER] close_game tx (commit + undelegate):", txSig);

      // Attendre que l'ER confirme la tx AVANT de poller mainnet.
      // Sans ça, le ScheduleCommitAndUndelegate n'est pas encore exécuté
      // et le polling mainnet démarre trop tôt.
      try {
        await erConnection.confirmTransaction(txSig, "confirmed");
        console.log("[ER] close_game tx confirmée par l'ER");
      } catch (_) {
        // L'ER peut ne pas supporter confirmTransaction standard → on attend 5s
        console.log("[ER] confirmTransaction non supportée → attente 5s");
        await new Promise((r) => setTimeout(r, 5000));
      }

      console.log("[close_game] tx confirmée sur l'ER — attente du retour mainnet");

      const ownership = await waitForMainnetOwnership(gameStatePda);
      if (ownership !== "returned") {
        setError(
          `Undelegation pas encore finalisée côté mainnet.\n` +
          `PDA: ${gameStatePda.toBase58()}\n` +
          `Dernière tx ER: ${txSig}\n` +
          `État: ${ownership === "timeout" ? "toujours owned par delegation_program après 120s" : "compte introuvable"}`
        );
        return;
      }

      clearSessionKeypair(publicKey.toBase58());
      clearActiveGamePda(publicKey.toBase58());
      setSessionKeypair(null);
      setGameState(null);
      setUndelegatingPda(null);
    } catch (e: any) {
      const msg: string = e?.message ?? e?.toString?.() ?? "";
      // User cancelled the Phantom popup — silent no-op
      if (e?.name === "WalletSignTransactionError" || msg.includes("User rejected")) {
        return;
      }
      const instrErr   = e?.InstructionError ?? (e as any)?.["InstructionError"];
      const ANCHOR_ERRORS: Record<number, string> = {
        6000: "CustomError",      6001: "InvalidOracleQueue", 6002: "NotGameOwner",
        6003: "GameOver",         6004: "InvalidMove",        6005: "RandomnessAlreadySet",
        6006: "Unauthorized",     6007: "InsufficientFunds",  6008: "NotDelegated",
        6009: "InvalidAuthority", 6010: "InvalidState",       6011: "InvalidOwner",
        6012: "DelegationFailed", 6013: "InvalidMoveOrder",
      };
      const customCode = instrErr?.[1]?.Custom;
      const errorName  = customCode !== undefined ? (ANCHOR_ERRORS[customCode] ?? `Custom(${customCode})`) : undefined;
      console.error("[useSolanaGame] closeGame error details:", {
        instrErrJson: instrErr ? JSON.stringify(instrErr) : undefined,
        errorName,
        fullJson: JSON.stringify(e),
      });

      if (msg.includes("already been processed")) {
        try {
          const pda = getActiveGameStatePda();
          if (!pda) return;
          const program = getProgram();
          if (program) {
            const gs = await (program.account as any).gameState.fetchNullable(pda);
            if (!gs || gs.over) {
              clearSessionKeypair(publicKey.toBase58());
              clearActiveGamePda(publicKey.toBase58());
              setSessionKeypair(null);
              setGameState(null);
              return;
            }
          }
        } catch (_) {}
      }
      const displayMsg = errorName || msg || "Erreur lors de la fermeture";
      setError(displayMsg);
      console.error("[useSolanaGame] closeGame error:", e);
    } finally {
      setUndelegatingPda(null);
      setIsLoading(false);
    }
  }, [publicKey, wallet, erConnection, connection, getErProgram, getProgram, getActiveGameStatePda, fetchGameState, gameState?.delegated, waitForMainnetOwnership]);

  // ── ÉTAPE 3 — diagnoseUndelegation ──────────────────────────────────────
  // Vérifie l'état réel de tous les buffers sur Solana devnet et liste les
  // transactions récentes sur le PDA pour savoir si l'ER a soumis quelque chose.
  const diagnoseUndelegation = useCallback(async () => {
    if (!publicKey) return;
    const gameStatePda     = getActiveGameStatePda();
    if (!gameStatePda) return;
    const delegationBuffer = getDelegationBuffer(gameStatePda);   // ["buffer", pda] ZKUBE
    const undelegateBuffer = getUndelegateBuffer(gameStatePda);   // ["undelegate_buffer", pda] DELEGATION

    console.group("[DIAG] === Diagnostic undelegation ===");
    console.log("Player:           ", publicKey.toBase58());
    console.log("gameStatePda:     ", gameStatePda.toBase58());
    console.log("delegationBuffer: ", delegationBuffer.toBase58(), "  (seeds: buffer+pda / ZKUBE)");
    console.log("undelegateBuffer: ", undelegateBuffer.toBase58(), "  (seeds: undelegate_buffer+pda / DELEGATION)");

    // ── 1. Owner du PDA ──────────────────────────────────────────────────
    const pdaInfo = await connection.getAccountInfo(gameStatePda).catch(() => null);
    console.log("PDA owner:        ", pdaInfo?.owner.toBase58() ?? "ABSENT");
    if (pdaInfo?.owner.equals(DELEGATION_PROGRAM_ID)) {
      console.warn("  ⚠️  PDA encore owned par delegation_program → undelegation non finalisée");
    } else if (pdaInfo?.owner.equals(ZKUBE_PROGRAM_ID)) {
      console.log("  ✅ PDA owned par ZKUBE_PROGRAM_ID → undelegation OK");
    }

    // ── 2. delegation_buffer (["buffer", pda] sous ZKUBE) ───────────────
    const delBufInfo = await connection.getAccountInfo(delegationBuffer).catch(() => null);
    console.log("delegation_buffer:", delBufInfo ? `EXISTS (owner: ${delBufInfo.owner.toBase58()}, ${delBufInfo.data.length} bytes)` : "ABSENT");

    // ── 3. undelegate_buffer (["undelegate_buffer", pda] sous DELEGATION)
    //       ÉTAPE 3 DU DEBUG : ce buffer existe-t-il ?
    //       ABSENT → undelegation jamais lancée par l'ER
    //       EXISTS → undelegation lancée mais pas finalisée
    const undBufInfo = await connection.getAccountInfo(undelegateBuffer).catch(() => null);
    console.log("undelegate_buffer:", undBufInfo
      ? `✅ EXISTS (owner: ${undBufInfo.owner.toBase58()}, ${undBufInfo.data.length} bytes)`
      : "❌ ABSENT");
    if (!undBufInfo) {
      console.warn("  → L'ER n'a jamais soumis la transaction Undelegate sur Solana devnet (problème infra)");
    } else {
      console.log("  → L'undelegation a été lancée mais process_undelegation n'a pas finalisé");
    }

    // ── 4. Transactions récentes sur le PDA (mainnet activity) ──────────
    try {
      const sigs = await connection.getSignaturesForAddress(gameStatePda, { limit: 10 });
      console.log(`Txs récentes sur PDA (${sigs.length}) :`);
      sigs.forEach(s => console.log("  ", s.signature, "|", s.err ? "ERREUR" : "ok", "|", new Date((s.blockTime ?? 0) * 1000).toISOString()));
    } catch (e) {
      console.warn("  Impossible de récupérer les sigs:", e);
    }

    // ── 5. Transactions récentes du delegation_program vers notre PDA ────
    try {
      const delSigs = await connection.getSignaturesForAddress(DELEGATION_PROGRAM_ID, { limit: 5 });
      console.log(`Txs récentes delegation_program (5 dernières) :`);
      delSigs.forEach(s => console.log("  ", s.signature, "|", s.err ? "ERREUR" : "ok", "|", new Date((s.blockTime ?? 0) * 1000).toISOString()));
    } catch (e) {
      console.warn("  Impossible de récupérer les sigs du delegation_program:", e);
    }

    console.groupEnd();
    return { pdaInfo, delBufInfo, undBufInfo };
  }, [publicKey, connection, getActiveGameStatePda]);

  // ── ÉTAPE 4 — forceProcessUndelegation ──────────────────────────────────
  // Test décisif : appelle process_undelegation MANUELLEMENT depuis le client.
  // Bypass complet de l'ER — si ça marche, le problème est infra (l'ER ne soumet pas).
  // Si ça échoue, le problème est dans les comptes/seeds.
  //
  // ATTENTION : utilise les VRAIS noms de comptes de l'IDL :
  //   base_account (= game_state PDA)
  //   buffer       (= undelegate_buffer, seeds ["undelegate_buffer", pda] DELEGATION)
  // Et le VRAI nom de l'argument : account_seeds (pas pda_seeds)
  const forceProcessUndelegation = useCallback(async () => {
    if (!publicKey) return;
    const program      = getProgram();
    if (!program) return;

    const gameStatePda     = getActiveGameStatePda();
    if (!gameStatePda) return;
    const undelegateBuffer = getUndelegateBuffer(gameStatePda);

    // Vérifier que le undelegate_buffer existe avant d'essayer
    const undBufInfo = await connection.getAccountInfo(undelegateBuffer).catch(() => null);
    console.log("[forceUndelegate] undelegate_buffer:", undBufInfo ? "EXISTS ✅" : "ABSENT ❌");

    if (!undBufInfo) {
      console.warn("[forceUndelegate] Le undelegate_buffer est absent — l'ER n'a jamais lancé l'undelegation.");
      console.warn("[forceUndelegate] Ce test ne peut pas aboutir sans ce buffer.");
      setError("undelegate_buffer absent — l'ER n'a pas soumis la tx Undelegate (problème infra)");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      // Seeds du PDA game_state : ["game", player.key()]
      // Type Anchor : Vec<Vec<u8>> = number[][]
      const accountSeeds: number[][] = [
        Array.from(Buffer.from("game")),
        Array.from(publicKey.toBytes()),
      ];

      console.log("[forceUndelegate] Appel process_undelegation avec :");
      console.log("  base_account (gameStatePda):", gameStatePda.toBase58());
      console.log("  buffer (undelegateBuffer):   ", undelegateBuffer.toBase58());
      console.log("  payer:                       ", publicKey.toBase58());
      console.log("  account_seeds:               ", JSON.stringify(accountSeeds));

      const tx = await (program.methods as any)
        .processUndelegation(accountSeeds)
        .accounts({
          baseAccount:   gameStatePda,    // IDL: "base_account"
          buffer:        undelegateBuffer, // IDL: "buffer" = undelegate_buffer
          payer:         publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });

      console.log("[forceUndelegate] ✅ SUCCÈS tx:", tx);
      console.log("[forceUndelegate] → L'ER ne soumettait pas la tx (problème infra confirmé)");
      setLastTx(tx);
      await fetchGameState();
    } catch (e: any) {
      const msg = e?.message ?? e?.toString?.() ?? "";
      console.error("[forceUndelegate] ❌ ÉCHEC:", msg);
      console.error("[forceUndelegate] → Problème de comptes/seeds ou le buffer est invalide");
      console.error("[forceUndelegate] Détails:", e);
      setError("forceUndelegate échoué: " + msg);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, connection, getProgram, fetchGameState]);

  // ── Exposition publique ───────────────────────────────────────────────────
  return {
    connected,
    publicKey:      publicKey?.toBase58() ?? null,
    gameState,
    isLoading,
    error,
    lastTx,
    undelegatingPda,
    isSkipDelegation: SKIP_DELEGATION,
    hasSessionKey:  !!sessionKeypair,
    sessionKey:     sessionKeypair?.publicKey.toBase58() ?? null,
    // Actions
    createGame,
    makeMove,
    closeGame,
    resetGame,                 // pour débloquer un compte coincé (non délégué)
    forgetLocalGame,           // oublie un ancien PDA local et permet de créer une nouvelle partie
    markLocalGameOver,         // affiche Game Over dès que la grille locale détecte la perte
    renewSessionKey,           // reconnexion mid-game (nouvelle session_key)
    refresh: fetchGameState,
    // ── Debug MagicBlock undelegation ───────────────────────────────────
    diagnoseUndelegation,      // ÉTAPE 3 : log complet de l'état des buffers
    forceProcessUndelegation,  // ÉTAPE 4 : appel manuel de process_undelegation
  };
}
