use anchor_lang::prelude::*;

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
}

///HACK:  
/// Rust ne génère pas Default automatiquement pour les tableaux > 32 éléments sadlyyy.  :(
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
        + 1;   // state 
}