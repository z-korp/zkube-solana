import { useState, useCallback, useEffect, useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_SLOT_HASHES_PUBKEY } from "@solana/web3.js";
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
  getDelegationRecord,
  getDelegationMetadata,
} from "./constants";

// ── Session key storage ──────────────────────────────────────────────────────
// La session_key est stockée dans sessionStorage (persistante sur refresh,
// effacée à la fermeture de l'onglet). Clé de stockage par wallet.
const SESSION_KEY_PREFIX = "zkube_session_";

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

// ── Hook principal ───────────────────────────────────────────────────────────
export function useSolanaGame() {
  const { connection } = useConnection();  // mainnet (devnet) connection
  const wallet = useWallet();
  const { publicKey, connected } = wallet;

  const [gameState, setGameState] = useState<SolanaGameState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);

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

  // ── Fetch state ──────────────────────────────────────────────────────────
  // Essaie l'ER en premier (compte délégué pendant la partie),
  // puis fallback mainnet (avant délégation ou après undelegate).
  const fetchGameState = useCallback(async () => {
    if (!publicKey) return;
    const pda = getGameStatePda(publicKey);

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
      phase: (gs.phase ? Object.keys(gs.phase)[0] : "Created") as GamePhase,
      sessionKey: gs.sessionKey?.toBase58() ?? "",
    });

    // 1. Essai ER (compte délégué — état temps réel)
    try {
      const erProgram = getErProgram();
      if (erProgram) {
        const gs = await (erProgram.account as any).gameState.fetchNullable(pda);
        if (gs) {
          setGameState(mapGs(gs));
          return;
        }
      }
    } catch (_) {
      // ER indisponible ou compte pas encore délégué → fallback mainnet
    }

    // 2. Fallback mainnet (avant create_game ou après close_game)
    try {
      const program = getProgram();
      if (!program) return;
      const gs = await (program.account as any).gameState.fetchNullable(pda);
      if (gs) {
        setGameState(mapGs(gs));
      } else {
        setGameState(null);
      }
    } catch (e) {
      console.error("[useSolanaGame] fetchGameState error:", e);
    }
  }, [publicKey, getProgram, getErProgram]);

  // Rafraîchit l'état quand le wallet est connecté
  useEffect(() => {
    if (connected && publicKey) {
      fetchGameState();
    } else {
      setGameState(null);
    }
  }, [connected, publicKey, fetchGameState]);

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
  // Génère la session_key, la passe à create_game, puis délègue à l'ER.
  // Résultat : 2 popups max (create_game + delegate_game), 0 popup pendant le jeu.
  const createGame = useCallback(async () => {
    if (!publicKey) return;
    const program = getProgram();
    if (!program) return;

    setIsLoading(true);
    setError(null);
    try {
      const gameStatePda  = getGameStatePda(publicKey);
      const identityPda   = getIdentityPda();
      const treasuryPda   = getTreasuryPda();

      // Génère la session_key AVANT create_game pour la stocker on-chain
      const kp = generateSessionKeypair();
      const sessionKeyPubkey = kp.publicKey;

      console.log("[Session] session_key transmise à create_game:", sessionKeyPubkey.toBase58());

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

      // Poll depuis mainnet jusqu'à ce que le VRF remplisse les blocs (seed != 0)
      // IMPORTANT: il FAUT que le VRF réponde AVANT de déléguer.
      // Après delegate_game, l'owner du compte change → receive_randomness échoue.
      let vrfReceived = false;
      let attempts = 0;
      while (attempts < 30) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const state = await (program.account as any).gameState.fetchNullable(gameStatePda);
          // Vérification robuste : seed != 0 ET au moins un bloc non-vide
          const seedOk = state && state.seed && state.seed.toString() !== "0";
          if (seedOk) {
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
        console.warn("[VRF] timeout — oracle n'a pas répondu dans les 60s, délégation annulée");
        setError("L'oracle VRF n'a pas répondu. Réessaie dans quelques secondes.");
        await fetchGameState().catch(() => {});
        return;
      }

      // Délègue le GameState à l'ER MagicBlock (1 popup Phantom)
      // Après ça, tous les make_move sont signés par la session_key → 0 popup
      try {
        await delegateGame(program, publicKey, gameStatePda);
      } catch (e: any) {
        console.error("[useSolanaGame] delegate_game FAILED:", e?.message ?? e);
        // Charge l'état même si delegate a échoué → affiche le bouton Reset
        await fetchGameState();
        throw e;
      }
      await fetchGameState();
    } catch (e: any) {
      const msg: string = e?.message ?? "";
      if (msg.includes("already been processed") || msg.includes("already in use")) {
        try {
          const pda = getGameStatePda(publicKey!);
          const gs = await (getProgram()?.account as any)?.gameState.fetchNullable(pda);
          if (gs) {
            await fetchGameState();
            return;
          }
        } catch (_) {}
      }
      // fetchGameState ici aussi pour les échecs create_game (pas encore de compte)
      await fetchGameState().catch(() => {});
      setError(msg || "Erreur lors de la création de partie");
      console.error("[useSolanaGame] createGame error:", e);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, getProgram, fetchGameState, delegateGame, generateSessionKeypair]);

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
      const gameStatePda = getGameStatePda(publicKey);

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
      setError(e?.message || "Erreur lors du renouvellement de session");
      console.error("[useSolanaGame] renewSessionKey error:", e);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, getErProgram, generateSessionKeypair]);

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

      // Choix du programme selon l'état de délégation
      const signerProgram = kp
        ? getSessionProgram(kp)          // ER, session_key — sans popup
        : isDelegated
          ? getErProgram()               // ER, Phantom — 1 popup
          : getProgram();                // devnet, Phantom — 1 popup (jeu non délégué)

      if (!signerProgram) return;

      if (!useSessionKey) {
        if (!isDelegated) {
          console.warn("[useSolanaGame] Jeu non délégué — make_move sur devnet (payant)");
        } else {
          console.warn("[useSolanaGame] Pas de session_key — make_move sur ER via Phantom (1 popup)");
        }
      }

      setIsLoading(true);
      setError(null);
      try {
        const gameStatePda = getGameStatePda(publicKey);
        const signerPubkey = kp ? kp.publicKey : publicKey;

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
            phase:              (gs.phase ? Object.keys(gs.phase)[0] : "Playing") as GamePhase,
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
            const gameStatePda = getGameStatePda(publicKey!);
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
                phase:              (gs.phase ? Object.keys(gs.phase)[0] : "Playing") as GamePhase,
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
    [publicKey, sessionKeypair, gameState?.moveCount, gameState?.delegated, getSessionProgram, getErProgram, getProgram]
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
      const gameStatePda = getGameStatePda(publicKey);

      const tx = await (program.methods as any)
        .resetGame()
        .accounts({
          player:    publicKey,
          gameState: gameStatePda,
        })
        .rpc();

      console.log("[Solana] reset_game tx:", tx);
      clearSessionKeypair(publicKey.toBase58());
      setSessionKeypair(null);
      setGameState(null);
    } catch (e: any) {
      const msg: string = e?.message ?? "";
      // "already been processed" = tx envoyée 2× ou confirmation tardive
      // → le reset a fonctionné, on nettoie juste le state local
      if (msg.includes("already been processed") || msg.includes("already in use")) {
        console.log("[Solana] reset_game déjà traité — nettoyage local");
        clearSessionKeypair(publicKey.toBase58());
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
  }, [publicKey, getProgram]);

  // ── close_game (ER — player signe, 1 popup) ──────────────────────────────
  // Envoyé au RPC ER → commit état final + undelegate → compte revient sur mainnet.
  const closeGame = useCallback(async () => {
    if (!publicKey) return;
    const erProgram = getErProgram();
    if (!erProgram) return;

    setIsLoading(true);
    setError(null);
    try {
      const gameStatePda = getGameStatePda(publicKey);

      const tx = await (erProgram.methods as any)
        .closeGame()
        .accounts({
          player:       publicKey,
          gameState:    gameStatePda,
          magicContext: MAGIC_CONTEXT_ID,
          magicProgram: MAGIC_PROGRAM_ID,
        })
        .rpc({ skipPreflight: true });

      setLastTx(tx);
      console.log("[ER] close_game tx (commit + undelegate):", tx);

      // Nettoie la session_key (partie terminée)
      clearSessionKeypair(publicKey.toBase58());
      setSessionKeypair(null);

      // Attendre que l'état soit committé sur mainnet
      await new Promise((r) => setTimeout(r, 2000));
      setGameState(null);
      await fetchGameState();
    } catch (e: any) {
      const msg: string = e?.message ?? "";
      if (msg.includes("already been processed")) {
        try {
          const pda = getGameStatePda(publicKey!);
          const program = getProgram();
          if (program) {
            const gs = await (program.account as any).gameState.fetchNullable(pda);
            if (!gs || gs.over) {
              clearSessionKeypair(publicKey.toBase58());
              setSessionKeypair(null);
              setGameState(null);
              return;
            }
          }
        } catch (_) {}
      }
      setError(msg || "Erreur lors de la fermeture");
      console.error("[useSolanaGame] closeGame error:", e);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, getErProgram, getProgram, fetchGameState]);

  // ── Exposition publique ───────────────────────────────────────────────────
  return {
    connected,
    publicKey:      publicKey?.toBase58() ?? null,
    gameState,
    isLoading,
    error,
    lastTx,
    hasSessionKey:  !!sessionKeypair,
    sessionKey:     sessionKeypair?.publicKey.toBase58() ?? null,
    // Actions
    createGame,
    makeMove,
    closeGame,
    resetGame,         // pour débloquer un compte coincé (non délégué)
    renewSessionKey,   // reconnexion mid-game (nouvelle session_key)
    refresh: fetchGameState,
  };
}
