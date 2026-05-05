use anchor_lang::prelude::*;

/// State machine explicite du cycle de vie d'une partie.
/// Chaque instruction valide une transition valide avant d'agir.
///
///  Created → (delegate_game) → Delegated → (make_move×N) → Playing → (close_game) → Finished
///
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum GamePhase {
    /// Partie créée sur mainnet, VRF en attente ou reçu — pas encore déléguée
    Created,
    /// GameState délégué à l'ER — aucun move joué
    Delegated,
    /// Au moins un move joué sur l'ER
    Playing,
    /// Partie terminée, commit + undelegate effectués
    Finished,
}

/// etat global de la partie
/// c'est ici qu'on stocke toute la progression comme le struct `Game` sur cairo
#[account]
pub struct GameState {
    /// celui qui a lancé la partie et qui peut la signer 
    pub player: Pubkey,

    /// le plateau (10x8)  On stocke les types de blocs 0,1,2,3,4  
    pub blocks: [u8; 80],

    pub next_row: [u8; 8],

    pub score: u32,

    pub combo_counter: u8,
 
    pub max_combo: u8,

    pub move_count: u32,

    /// base de l'aleatoire  Pour le POC on remplace le VRF Cairo par un simple u64 
    pub seed: u64,

    /// flag de fin de partie  si c'est true, on bloque les futurs moves
    pub over: bool,

    /// champ ER 
    /// true si le GameState est actuellement délégué à l'Ephemeral Rollup.
    /// Redondant avec phase mais utile pour des checks rapides.
    pub delegated: bool,

    /// Authority qui a déclenché la délégation (= player au moment de delegate_game).
    /// Lie la délégation à UN joueur — empêche le spoofing CPI.
    pub delegated_authority: Pubkey,

    /// État explicite du cycle de vie — valide les transitions.
    /// Source of truth pour les gardes d'instructions.
    pub phase: GamePhase,


    /// Clé éphémère générée côté client au moment de create_game.
    /// Autorisée à signer make_move sans popup wallet — zéro friction pendant le jeu.
    /// Reste en mémoire côté client ; peut être mise à jour via set_session_key.
    pub session_key: Pubkey,
}

///HACK:  
/// Rust ne génère pas Default automatiquement pour les tableaux > 32 éléments 
/// donc on le fait manuellement tous les champs à zéro au départ
impl Default for GameState {
    fn default() -> Self {
        Self {
            player: Pubkey::default(),
            blocks: [0u8; 80],
            next_row: [0u8; 8],
            score: 0,
            combo_counter: 0,
            max_combo: 0,
            move_count: 0,
            seed: 0,
            over: false,
            delegated: false,
            delegated_authority: Pubkey::default(),
            phase: GamePhase::Created,
            session_key: Pubkey::default(),
        }
    }
}

impl GameState {
    /// espace nécessaire sur la blockchain (en octets) 
    pub const SIZE: usize = 8      // rrefixe Anchor obligatoire
        + 32   // player
        + 80   // grille blocks
        + 8    // ligne suivante
        + 4    // score
        + 1    // combo actuel
        + 1    // record combo
        + 4    // moves
        + 8    // seed
        + 1    // over
        + 1    // delegated
        + 32   // delegated_authority
        + 1    // phase (enum u8)
        + 32;  // session_key
}