// ce que fais make_move:
/*
Joueur envoie : row_index, start_index, final_index
1. Vérifie que le move est valide (pas game over, bons indices)
2. Applique le swipe (déplace les blocs dans la ligne)
3. Applique la gravité (les blocs tombent)
4. Détecte les lignes complètes → calcule le score
5. Insère une nouvelle ligne en bas
6. Vérifie si la grille est pleine → game over
7. Incrémente move_count
*/

use anchor_lang::prelude::*;
use crate::state::GameState;
use crate::error::ErrorCode;
use crate::instructions::receive_randomness::generate_row;

/// Les comptes nécessaires pour jouer un coup
#[derive(Accounts)]
pub struct MakeMove<'info> {
    /// Le joueur — doit être le propriétaire de la partie
    pub player: Signer<'info>,

    /// Le compte GameState à modifier
    #[account(
        mut,
        seeds = [b"game", player.key().as_ref()],
        bump,
        constraint = game_state.player == player.key() @ ErrorCode::NotGameOwner,
        constraint = !game_state.over @ ErrorCode::GameOver,
    )]
    pub game_state: Account<'info, GameState>,
}

/// Handler — logique d'un coup
/// @param row_index   : ligne visée (0 = bas, 9 = haut)
/// @param start_index : colonne de départ du bloc (0-7)
/// @param final_index : colonne d'arrivée du bloc (0-7)
pub fn handler(ctx: Context<MakeMove>, row_index: u8, start_index: u8, final_index: u8) -> Result<()> {
    // Validation des indices — grille 10x8
    require!(row_index < 10, ErrorCode::InvalidMove);
    require!(start_index < 8, ErrorCode::InvalidMove);
    require!(final_index < 8, ErrorCode::InvalidMove);
    require!(start_index != final_index, ErrorCode::InvalidMove);

    let game = &mut ctx.accounts.game_state;

    // 1. Applique le swipe : déplace les blocs dans la ligne
    apply_swipe(&mut game.blocks, row_index, start_index, final_index);

    // 2. Applique la gravité : les blocs tombent vers le bas
    apply_gravity(&mut game.blocks);

    // 3. Détecte les lignes complètes, calcule le score
    
    let mut combo = game.combo_counter;
    let mut max_combo = game.max_combo;
    let lines_cleared = assess_lines(&mut game.blocks, &mut combo, &mut max_combo);
    game.combo_counter = combo;
    game.max_combo = max_combo;

    if lines_cleared > 0 {
        // Score : 100 points par ligne + bonus combo
        let points = lines_cleared as u32 * 100 * (game.combo_counter as u32 + 1);
        game.score = game.score.saturating_add(points);
    }

    // 4. Insère une nouvelle ligne en bas
    game.blocks = insert_new_line(game.blocks, game.next_row);

    // 5. Prépare la prochaine ligne
    game.next_row = generate_row(game.seed, game.move_count + 1);

    // 6. Vérifie si la grille est pleine → game over
    if is_grid_full(game.blocks) {
        game.over = true;
        msg!("Game over ! Score final: {}", game.score);
        return Ok(());
    }

    // 7. Incrémente le compteur de coups
    game.move_count += 1;

    msg!("Move joué ! Score: {}, Lignes effacées: {}", game.score, lines_cleared);
    Ok(())
}

/// Déplace les blocs d'une ligne horizontalement
/// Équivalent de Controller::swipe en Cairo
fn apply_swipe(blocks: &mut [u8; 80], row_index: u8, start: u8, end: u8) {
    let row_start = row_index as usize * 8;
    let block_size = blocks[row_start + start as usize];

    if block_size == 0 {
        return; // case vide, rien à faire
    }

    // Efface l'ancien emplacement
    for i in 0..block_size as usize {
        blocks[row_start + start as usize + i] = 0;
    }

    if end > start {
        // Déplacement vers la droite — ne dépasse pas la limite
        let max_end = (8 - block_size) as u8;
        let actual_end = end.min(max_end);
        for i in 0..block_size as usize {
            blocks[row_start + actual_end as usize + i] = block_size;
        }
    } else {
        // Déplacement vers la gauche
        for i in 0..block_size as usize {
            blocks[row_start + end as usize + i] = block_size;
        }
    }
}

/// Applique la gravité — les blocs tombent vers la ligne 0 (bas)
/// Équivalent de Controller::apply_gravity en Cairo
fn apply_gravity(blocks: &mut [u8; 80]) {
    loop {
        let mut changed = false;

        for row in 1..10usize {
            for col in 0..8usize {
                let current = blocks[row * 8 + col];
                let below = blocks[(row - 1) * 8 + col];

                // Si la case actuelle est occupée et celle du dessous est vide
                if current > 0 && below == 0 {
                    blocks[(row - 1) * 8 + col] = current;
                    blocks[row * 8 + col] = 0;
                    changed = true;
                }
            }
        }

        if !changed {
            break; // grille stabilisée
        }
    }
}

/// Détecte et efface les lignes complètes
/// Retourne le nombre de lignes effacées
/// Équivalent de Controller::assess_lines en Cairo
fn assess_lines(blocks: &mut [u8; 80], combo: &mut u8, max_combo: &mut u8) -> u8 {
    let mut lines_cleared = 0u8;

    for row in 0..10usize {
        let row_start = row * 8;
        // Ligne complète = toutes les 8 cases occupées
        let is_complete = (0..8).all(|col| blocks[row_start + col] > 0);

        if is_complete {
            for col in 0..8 {
                blocks[row_start + col] = 0;
            }
            lines_cleared += 1;
        }
    }

    // Met à jour le combo
    if lines_cleared > 0 {
        *combo = combo.saturating_add(lines_cleared);
        if *combo > *max_combo {
            *max_combo = *combo;
        }
    } else {
        *combo = 0; // reset combo si aucune ligne effacée
    }

    lines_cleared
}

/// Insère la next_row en bas de la grille avec la lignen 0
/// Équivalent de Controller::add_line en Cairo
fn insert_new_line(mut blocks: [u8; 80], next_row: [u8; 8]) -> [u8; 80] {
    // Décale toutes les lignes d'un cran vers le haut
    for row in (1..10usize).rev() {
        for col in 0..8usize {
            blocks[row * 8 + col] = blocks[(row - 1) * 8 + col];
        }
    }
    // Insère la nouvelle ligne en bas
    blocks[0..8].copy_from_slice(&next_row);
    blocks
}

/// Vérifie si la grille est pleine ligne du haut occupée = game over
/// Équivalent de is_grid_full en cairo
fn is_grid_full(blocks: [u8; 80]) -> bool {
    (0..8).any(|col| blocks[9 * 8 + col] > 0)
}
