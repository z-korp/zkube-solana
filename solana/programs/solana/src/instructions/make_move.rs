use anchor_lang::prelude::*;
use crate::state::{GameState, GamePhase};
use crate::error::ErrorCode;
use crate::instructions::receive_randomness::generate_row;

/// Comptes pour jouer un coup.
/// Le signer peut être le joueur réel (player) OU la session_key éphémère.
/// La PDA est toujours dérivée de game_state.player (stocké on-chain),
/// ce qui permet à la session_key de signer sans changer le PDA.
#[derive(Accounts)]
pub struct MakeMove<'info> {
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game", game_state.player.as_ref()],
        bump,
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
    // Vérifie le flag métier de délégation (mis à true par delegate_game).
    // Note: on ne vérifie PAS account.owner == delegation_program car sur l'ER,
    // les comptes sont présentés avec owner = programme original (pas delegation_program).
    require!(
        ctx.accounts.game_state.delegated,
        ErrorCode::NotDelegated
    );

    // Phase valide : Delegated (1er move) ou Playing (moves suivants).
    require!(
        ctx.accounts.game_state.phase == GamePhase::Delegated
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

    // Transition de phase : premier move → Playing
    if game.phase == GamePhase::Delegated {
        game.phase = GamePhase::Playing;
    }

    apply_swipe(&mut game.blocks, row_index, start_index, final_index)?;
    apply_gravity(&mut game.blocks);

    let mut combo     = game.combo_counter;
    let mut max_combo = game.max_combo;
    let lines_cleared = assess_lines(&mut game.blocks, &mut combo, &mut max_combo);
    game.combo_counter = combo;
    game.max_combo     = max_combo;

    if lines_cleared > 0 {
        let points = lines_cleared as u32 * 100 * (game.combo_counter as u32 + 1);
        game.score = game.score.saturating_add(points);
    }

    game.blocks   = insert_new_line(game.blocks, game.next_row);
    game.next_row = generate_row(game.seed, game.move_count + 1);

    if is_grid_full(game.blocks) {
        game.over = true;
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
        for i in 0..block_size as usize {
            blocks[row_start + end as usize + i] = block_size;
        }
    }
    Ok(())
}

fn apply_gravity(blocks: &mut [u8; 80]) {
    loop {
        let mut changed = false;
        for row in 1..10usize {
            for col in 0..8usize {
                let current = blocks[row * 8 + col];
                let below   = blocks[(row - 1) * 8 + col];
                if current > 0 && below == 0 {
                    blocks[(row - 1) * 8 + col] = current;
                    blocks[row * 8 + col]        = 0;
                    changed = true;
                }
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
