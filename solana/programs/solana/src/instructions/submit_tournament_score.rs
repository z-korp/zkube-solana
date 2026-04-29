use anchor_lang::prelude::*;
use crate::state::{Tournament, TournamentEntry, GameState};
use crate::error::ErrorCode;

/// Soumet le score de la partie terminée au tournoi.
/// Lit game_state.score — la partie doit être terminée (over == true).
/// Met à jour best_score uniquement si le nouveau score est supérieur.
/// En cas d'égalité, le submitted_at déjà stocké est conservé (tiebreaker : premier arrivé).
#[derive(Accounts)]
#[instruction(tournament_id: u32)]
pub struct SubmitTournamentScore<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    /// GameState du joueur — doit être terminé
    #[account(
        seeds = [b"game", player.key().as_ref()],
        bump,
        constraint = game_state.player == player.key() @ ErrorCode::NotGameOwner,
        constraint = game_state.over @ ErrorCode::GameNotFinished,
    )]
    pub game_state: Account<'info, GameState>,

    /// Le tournoi doit exister et ne pas être settle
    #[account(
        seeds = [b"tournament".as_ref(), tournament_id.to_le_bytes().as_ref()],
        bump,
        constraint = !tournament.settled @ ErrorCode::TournamentAlreadySettled,
    )]
    pub tournament: Account<'info, Tournament>,

    /// TournamentEntry existant du joueur
    #[account(
        mut,
        seeds = [b"tournament_entry".as_ref(), tournament_id.to_le_bytes().as_ref(), player.key().as_ref()],
        bump,
    )]
    pub tournament_entry: Account<'info, TournamentEntry>,
}

pub fn handler_submit_tournament_score(
    ctx: Context<SubmitTournamentScore>,
    _tournament_id: u32,
) -> Result<()> {
    let now       = Clock::get()?.unix_timestamp;
    let new_score = ctx.accounts.game_state.score;
    let entry     = &mut ctx.accounts.tournament_entry;

    // Mettre à jour uniquement si meilleur score
    // En cas d'égalité : on garde submitted_at existant (tiebreaker premier arrivé)
    if !entry.has_submitted || new_score > entry.best_score {
        entry.best_score    = new_score;
        entry.submitted_at  = now;
        entry.has_submitted = true;

        msg!(
            "Nouveau meilleur score ! joueur={}, score={}, tournoi={}",
            ctx.accounts.player.key(),
            new_score,
            _tournament_id,
        );
    } else {
        msg!(
            "Score {} inférieur au meilleur ({}) — ignoré",
            new_score,
            entry.best_score,
        );
    }

    Ok(())
}
