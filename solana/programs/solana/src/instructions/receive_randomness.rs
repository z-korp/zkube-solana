// Callback appelé automatiquement par l'oracle VRF MagicBlock
// après avoir répondu à notre demande d'aléatoire dans create_game
// Équivalent du initialize_grid dans grid_system Cairo

use anchor_lang::prelude::*;
use crate::state::GameState;

/// Les comptes nécessaires pour recevoir l'aléatoire du VRF
#[derive(Accounts)]
pub struct ReceiveRandomness<'info> {
    /// Le compte GameState du joueur — on va le remplir avec la grille initiale
    #[account(
        mut,
        seeds = [b"game", game_state.player.as_ref()],
        bump
    )]
    pub game_state: Account<'info, GameState>,
}

/// Handler: appelé par l'oracle VRF avec le vrai nombre aléatoire
/// @param randomness: 32 octets de vrai aléatoire vérifiable
pub fn handler_receive_randomness(ctx: Context<ReceiveRandomness>, randomness: [u8; 32]) -> Result<()> {
    let game = &mut ctx.accounts.game_state;

    // Convertit les 32 octets aléatoires en u64 pour notre seed
    // On prend les 8 premiers octets et on les assemble
    let seed = u64::from_le_bytes(randomness[..8].try_into().unwrap());
    game.seed = seed;

    // Génère la première ligne visible en bas de la grille
    game.next_row = generate_row(seed, 0);

    // Remplit les 4 premières lignes de la grille (comme Cairo initialize_grid)
    // La grille se remplit par le bas: ligne 0 = bas, ligne 9 = haut
    for row_index in 0..4u32 {
        let row = generate_row(seed, row_index + 1);
        // Insère la ligne dans blocks au bon endroit
        let start = (row_index as usize) * 8;
        game.blocks[start..start + 8].copy_from_slice(&row);
    }

    msg!("Grille initialisée avec VRF pour: {}", game.player);
    Ok(())
}

/// Génère une ligne de blocs de façon déterministe à partir du seed
/// Réplique la logique de Controller::create_line du Cairo
/// Chaque bloc a une taille de 1 à 4, les blocs remplissent les 8 colonnes
/// c'est un lgg simple (Linear Congruential Generator) generer des nom bres alatoires de manieres deterministe 
pub fn generate_row(seed: u64, row_index: u32) -> [u8; 8] {
    let mut row = [0u8; 8];
    // LCG (Linear Congruential Generator) — simple et déterministe
    let mut rng = seed.wrapping_add(row_index as u64);
    let mut col = 0usize;

    while col < 8 {
        // Avance le générateur
        rng = rng
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);

        // Taille du bloc: 1, 2, 3 ou 4
        let size = ((rng >> 33) % 4 + 1) as u8;
        // Ne dépasse pas la fin de la ligne
        let actual_size = size.min((8 - col) as u8);

        // Remplit les cases du bloc avec sa taille
        for i in 0..actual_size as usize {
            row[col + i] = actual_size;
        }
        col += actual_size as usize;
    }

    row
}
