// Callback appelé automatiquement par l'oracle VRF MagicBlock
// après avoir répondu à notre demande d'aléatoire dans create_game
// Équivalent du initialize_grid dans grid_system Cairo

use anchor_lang::prelude::*;
use crate::state::GameState;
use crate::error::ErrorCode;

/// Les comptes nécessaires pour recevoir l'aléatoire du VRF
#[derive(Accounts)]
pub struct ReceiveRandomness<'info> {
    /// Le compte GameState du joueur on va le remplir avec la grille initiale
    /// Contrainte : seed == 0 vérifiée dans le handler (idempotence)
    #[account(
        mut,
        seeds = [b"game", game_state.player.as_ref()],
        bump
    )]
    pub game_state: Account<'info, GameState>,
}

/// Handler: appelé par l'oracle VRF avec le vrai nombre aléatoire
/// @param randomness: 32 octets de vrai aléatoire vérifiable (VRF proof côté oracle)
///
/// TODO SÉCURITÉ :
/// - On vérifie que seed == 0 : l'oracle ne peut initialiser la grille qu'une seule fois
///   Si quelqu'un appelle cette instruction manuellement APRÈS l'oracle elle rejette
/// TODO mainnet : vérifier la VRF proof cryptographiquement via le SDK MagicBlock
///   pour s'assurer que seul l'oracle peut appeler cette instruction.
pub fn handler_receive_randomness(ctx: Context<ReceiveRandomness>, randomness: [u8; 32]) -> Result<()> {
    let game = &mut ctx.accounts.game_state;

    // Idempotence : refuse si la randomness a déjà été injectée
    // Empêche qu'un attaquant réinitialise la grille d'une partie en cours
    require!(game.seed == 0, ErrorCode::RandomnessAlreadySet);

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
/// LCG (Linear Congruential Generator) — simple et déterministe
pub fn generate_row(seed: u64, row_index: u32) -> [u8; 8] {
    let mut row = [0u8; 8];
    let mut rng = seed.wrapping_add(row_index as u64);

    // Décide du nombre de colonnes à remplir : 5, 6 ou 7 (jamais 8)
    rng = rng
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    let target_fill = 5 + ((rng >> 61) % 3) as usize; // 5, 6 ou 7

    // Décide du décalage de départ pour varier la position des vides
    rng = rng
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    let max_offset = (9 - target_fill) as u64; // toujours >= 2
    let start_col = ((rng >> 60) % max_offset) as usize;

    let end_col = start_col + target_fill;
    let mut col = start_col;

    while col < end_col {
        // Avance le générateur
        rng = rng
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);

        // Taille du bloc : 1 à 4, sans dépasser la zone à remplir
        let remaining = end_col - col;
        let max_block = remaining.min(4) as u64;
        let size = ((rng >> 33) % max_block + 1) as u8;

        // Encodage dense : toutes les cellules du bloc = taille du bloc
        for i in 0..size as usize {
            row[col + i] = size;
        }
        col += size as usize;
    }

    row
}
