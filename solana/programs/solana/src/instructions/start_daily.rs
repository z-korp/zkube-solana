use anchor_lang::prelude::*;
use crate::state::{DailyChallenge, DailyEntry, ActiveDailyAttempt};
use crate::error::ErrorCode;

/// Enregistre le joueur pour le challenge du jour et crée son suivi de tentative.
/// Doit être appelé avant create_game pour lier la partie au challenge.
/// Échoue si le joueur a déjà une entrée pour ce challenge (une seule tentative).
#[derive(Accounts)]
#[instruction(challenge_id: u32)]
pub struct StartDaily<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    /// Le DailyChallenge doit exister et être actif
    #[account(
        mut,
        seeds = [b"daily_challenge", &challenge_id.to_le_bytes()],
        bump,
    )]
    pub daily_challenge: Account<'info, DailyChallenge>,

    /// Une seule DailyEntry par joueur par challenge
    #[account(
        init,
        payer = player,
        space = DailyEntry::SIZE,
        seeds = [b"daily_entry", &challenge_id.to_le_bytes(), player.key().as_ref()],
        bump,
    )]
    pub daily_entry: Account<'info, DailyEntry>,

    /// Une seule tentative active à la fois par joueur
    #[account(
        init,
        payer = player,
        space = ActiveDailyAttempt::SIZE,
        seeds = [b"active_daily", player.key().as_ref()],
        bump,
    )]
    pub active_daily: Account<'info, ActiveDailyAttempt>,

    pub system_program: Program<'info, System>,
}

pub fn handler_start_daily(
    ctx: Context<StartDaily>,
    challenge_id: u32,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let dc  = &mut ctx.accounts.daily_challenge;

    // Vérifier que le challenge est actif
    require!(now >= dc.start_time, ErrorCode::ChallengeNotStarted);
    require!(now <  dc.end_time,   ErrorCode::ChallengeEnded);

    // Initialiser l'entrée du joueur
    let entry       = &mut ctx.accounts.daily_entry;
    entry.challenge_id = challenge_id;
    entry.player       = ctx.accounts.player.key();
    entry.score        = 0;
    entry.completed    = false;

    // Initialiser le suivi de tentative active
    let active          = &mut ctx.accounts.active_daily;
    active.player       = ctx.accounts.player.key();
    active.challenge_id = challenge_id;
    active.started_at   = now;

    // Incrémenter le nombre de participants
    dc.total_entries = dc.total_entries.saturating_add(1);

    msg!(
        "Daily démarré — joueur={}, challenge={}",
        ctx.accounts.player.key(),
        challenge_id,
    );
    Ok(())
}
