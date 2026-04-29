use anchor_lang::prelude::*;
use crate::state::{DailyEntry, ActiveDailyAttempt, GameState};
use crate::error::ErrorCode;

/// Soumet le score final de la partie daily.
/// Lit game_state.score (la partie doit être terminée : game_state.over == true),
/// l'écrit dans DailyEntry, ferme ActiveDailyAttempt (remboursement rent → joueur).
#[derive(Accounts)]
#[instruction(challenge_id: u32)]
pub struct SubmitDailyScore<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    /// GameState du joueur — doit être terminé (over == true)
    #[account(
        seeds = [b"game", player.key().as_ref()],
        bump,
        constraint = game_state.player == player.key() @ ErrorCode::NotGameOwner,
        constraint = game_state.over @ ErrorCode::GameNotFinished,
    )]
    pub game_state: Account<'info, GameState>,

    /// Entrée daily du joueur — ne doit pas être déjà complétée
    #[account(
        mut,
        seeds = [b"daily_entry", &challenge_id.to_le_bytes(), player.key().as_ref()],
        bump,
        constraint = !daily_entry.completed @ ErrorCode::AlreadySubmitted,
    )]
    pub daily_entry: Account<'info, DailyEntry>,

    /// Tentative active — fermée ici, rent remboursé au joueur
    #[account(
        mut,
        seeds = [b"active_daily", player.key().as_ref()],
        bump,
        close = player,
    )]
    pub active_daily: Account<'info, ActiveDailyAttempt>,

    pub system_program: Program<'info, System>,
}

pub fn handler_submit_daily_score(
    ctx: Context<SubmitDailyScore>,
    _challenge_id: u32,
) -> Result<()> {
    let score = ctx.accounts.game_state.score;

    let entry       = &mut ctx.accounts.daily_entry;
    entry.score     = score;
    entry.completed = true;

    msg!(
        "Score daily soumis — joueur={}, score={}",
        ctx.accounts.player.key(),
        score,
    );
    Ok(())
}
