use anchor_lang::prelude::*;
use crate::state::{GameState, GamePhase};
use crate::error::ErrorCode;
use crate::instructions::receive_randomness::generate_row;

/// Comptes pour jouer un coup.
/// Le signer peut être le joueur réel (player) OU la session_key éphémère.
/// Le game_state est passé explicitement pour supporter les nouvelles parties
/// dérivées avec une session_key: ["game", player, session_key].
#[derive(Accounts)]
pub struct MakeMove<'info> {
    pub player: Signer<'info>,

    #[account(
        mut,
        constraint = !game_state.over @ ErrorCode::GameOver,
    )]
    pub game_state: Account<'info, GameState>,
}

pub fn handler(
    ctx: Context<MakeMove>,
    row_index: u8,
    start_index: u8,
    final_index: u8,
    expected_move: u32,
) -> Result<()> {
    // Phase valide : Created (bypass devnet), Delegated (1er move ER), Playing (suite).
    // Note: le check `delegated` a été retiré pour permettre les moves directs sur devnet
    // pendant la période où le relayer ER MagicBlock est hors-service.
    // Remettre require!(game_state.delegated, NotDelegated) quand le relayer sera réparé.
    require!(
        ctx.accounts.game_state.phase == GamePhase::Created
            || ctx.accounts.game_state.phase == GamePhase::Delegated
            || ctx.accounts.game_state.phase == GamePhase::Playing,
        ErrorCode::InvalidState
    );

    // Authority : signer = joueur réel OU session_key autorisée.
    {
        let signer = ctx.accounts.player.key();
        require!(
            signer == ctx.accounts.game_state.player
                || signer == ctx.accounts.game_state.session_key,
            ErrorCode::InvalidAuthority
        );
    }

    // Verrou d'ordre anti-replay : le client doit passer move_count courant.
    require!(
        ctx.accounts.game_state.move_count == expected_move,
        ErrorCode::InvalidMoveOrder
    );

    // Validation des indices (grille 10x8)
    require!(row_index < 10,   ErrorCode::InvalidMove);
    require!(start_index < 8,  ErrorCode::InvalidMove);
    require!(final_index < 8,  ErrorCode::InvalidMove);
    require!(start_index != final_index, ErrorCode::InvalidMove);

    let game = &mut ctx.accounts.game_state;

    // Transition de phase : Created ou Delegated → Playing au 1er move
    if game.phase == GamePhase::Created || game.phase == GamePhase::Delegated {
        game.phase = GamePhase::Playing;
    }

    apply_swipe(&mut game.blocks, row_index, start_index, final_index)?;
    apply_gravity(&mut game.blocks);

    let mut combo     = game.combo_counter;
    let mut max_combo = game.max_combo;
    let lines_cleared = assess_lines(&mut game.blocks, &mut combo, &mut max_combo);
    game.combo_counter = combo;
    game.max_combo     = max_combo;

    // BUG FIX: après avoir effacé des lignes, les blocs au-dessus sont flottants.
    // Sans cette 2e passe de gravité, les blocs restent en haut de la grille
    // et déclenchent un game over prématuré alors qu'ils auraient pu tomber.
    if lines_cleared > 0 {
        apply_gravity(&mut game.blocks);
    }

    if lines_cleared > 0 {
        let points = lines_cleared as u32 * 100 * (game.combo_counter as u32 + 1);
        game.score = game.score.saturating_add(points);
    }

    if is_grid_full(game.blocks) {
        game.over = true;
        game.phase = GamePhase::Finished;
        game.move_count = game.move_count.saturating_add(1);
        msg!("Game over! Score final: {}", game.score);
        return Ok(());
    }

    game.blocks   = insert_new_line(game.blocks, game.next_row);
    game.next_row = generate_row(game.seed, game.move_count + 1);

    if is_grid_full(game.blocks) {
        game.over = true;
        game.phase = GamePhase::Finished;
        game.move_count = game.move_count.saturating_add(1);
        msg!("Game over! Score final: {}", game.score);
        return Ok(());
    }

    game.move_count += 1;
    msg!("Move joué — score: {}, lignes: {}", game.score, lines_cleared);
    Ok(())
}

fn apply_swipe(blocks: &mut [u8; 80], row_index: u8, start: u8, end: u8) -> Result<()> {
    let row_start  = row_index as usize * 8;
    let block_size = blocks[row_start + start as usize];
    if block_size == 0 { return Ok(()); }
    require!(block_size <= 8, ErrorCode::InvalidState);

    for i in 0..block_size as usize {
        blocks[row_start + start as usize + i] = 0;
    }
    if end > start {
        let max_end    = (8 - block_size) as u8;
        let actual_end = end.min(max_end);
        for i in 0..block_size as usize {
            blocks[row_start + actual_end as usize + i] = block_size;
        }
    } else {
        // Déplacement vers la gauche : vérifier qu'il n'y a pas de bloc en chevauchement.
        // On écrase les cellules cibles seulement si elles sont toutes vides.
        // (Le client valide côté UI, mais on double-check on-chain.)
        let target = end as usize;
        let all_clear = (0..block_size as usize).all(|i| blocks[row_start + target + i] == 0);
        if all_clear {
            for i in 0..block_size as usize {
                blocks[row_start + target + i] = block_size;
            }
        } else {
            // Position cible occupée : on replace le bloc à son origine
            for i in 0..block_size as usize {
                blocks[row_start + start as usize + i] = block_size;
            }
        }
    }
    Ok(())
}

fn apply_gravity(blocks: &mut [u8; 80]) {
    // BUG FIX: traiter chaque bloc comme une unité atomique.
    // L'ancienne version colonne-par-colonne fragmentait les blocs de taille > 1 :
    // si une seule colonne du dessous était bloquée, les autres colonnes tombaient quand même,
    // créant des cellules orphelines qui remplissaient la grille prématurément → game over aléatoire.
    //
    // Nouvelle version : on itère par ligne, on saute d'un bloc entier à la fois (col += size),
    // et on ne fait tomber le bloc QUE si TOUTES ses cellules en dessous sont libres.
    loop {
        let mut changed = false;
        for row in 1..10usize {
            let mut col = 0usize;
            while col < 8 {
                let size = blocks[row * 8 + col] as usize;
                if size == 0 {
                    col += 1;
                    continue;
                }
                // Sécurité : ne pas déborder à droite
                let block_end = col + size;
                if block_end > 8 {
                    col += 1;
                    continue;
                }
                // Le bloc tombe seulement si TOUTES les cellules en dessous sont vides
                let can_fall = (0..size).all(|i| blocks[(row - 1) * 8 + col + i] == 0);
                if can_fall {
                    for i in 0..size {
                        blocks[(row - 1) * 8 + col + i] = size as u8;
                        blocks[row * 8 + col + i]       = 0;
                    }
                    changed = true;
                }
                col += size;
            }
        }
        if !changed { break; }
    }
}

fn assess_lines(blocks: &mut [u8; 80], combo: &mut u8, max_combo: &mut u8) -> u8 {
    let mut lines_cleared = 0u8;
    for row in 0..10usize {
        let row_start  = row * 8;
        let is_complete = (0..8).all(|col| blocks[row_start + col] > 0);
        if is_complete {
            for col in 0..8 { blocks[row_start + col] = 0; }
            lines_cleared += 1;
        }
    }
    if lines_cleared > 0 {
        *combo = combo.saturating_add(lines_cleared);
        if *combo > *max_combo { *max_combo = *combo; }
    } else {
        *combo = 0;
    }
    lines_cleared
}

fn insert_new_line(mut blocks: [u8; 80], next_row: [u8; 8]) -> [u8; 80] {
    for row in (1..10usize).rev() {
        for col in 0..8usize {
            blocks[row * 8 + col] = blocks[(row - 1) * 8 + col];
        }
    }
    blocks[0..8].copy_from_slice(&next_row);
    blocks
}

fn is_grid_full(blocks: [u8; 80]) -> bool {
    (0..8).any(|col| blocks[9 * 8 + col] > 0)
}
