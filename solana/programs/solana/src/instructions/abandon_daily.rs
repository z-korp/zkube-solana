use anchor_lang::prelude::*;
use crate::state::ActiveDailyAttempt;

/// Ferme une tentative daily obsolète (d'un jour précédent).
/// Utile quand le joueur a un ActiveDailyAttempt d'hier et veut jouer aujourd'hui.
/// La DailyEntry du jour précédent reste intacte (score=0, completed=false).
/// Le rent est remboursé au joueur.
#[derive(Accounts)]
pub struct AbandonDaily<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [b"active_daily", player.key().as_ref()],
        bump,
        close = player,
    )]
    pub active_daily: Account<'info, ActiveDailyAttempt>,

    pub system_program: Program<'info, System>,
}

pub fn handler_abandon_daily(ctx: Context<AbandonDaily>) -> Result<()> {
    msg!(
        "Daily abandonné — joueur={}, ancien challenge={}",
        ctx.accounts.player.key(),
        ctx.accounts.active_daily.challenge_id,
    );
    Ok(())
}
