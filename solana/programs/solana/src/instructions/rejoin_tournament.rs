use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::{Tournament, TournamentEntry, Treasury};
use crate::error::ErrorCode;

/// Replay le joueur paie à nouveau l'entry fee pour une nouvelle tentative parce qu'on sympa 
/// il va rejouer pour essayer d'avoir un meilleur score et remporter une meilleure place dans le classement
/// Le TournamentEntry existe déjà (créé par join_tournament)
/// Le score n'est mis à jour que si le nouveau score est meilleur (dans submit)
#[derive(Accounts)]
#[instruction(tournament_id: u32)]
pub struct RejoinTournament<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [b"tournament".as_ref(), tournament_id.to_le_bytes().as_ref()],
        bump,
        constraint = !tournament.settled @ ErrorCode::TournamentAlreadySettled,
    )]
    pub tournament: Account<'info, Tournament>,

    /// TournamentEntry existant donc mise a jour 
    #[account(
        mut,
        seeds = [b"tournament_entry".as_ref(), tournament_id.to_le_bytes().as_ref(), player.key().as_ref()],
        bump,
    )]
    pub tournament_entry: Account<'info, TournamentEntry>,

    /// Treasury zKorp recoit 10% de l'entry fee
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
    )]
    pub treasury: Account<'info, Treasury>,

    pub system_program: Program<'info, System>,
}

pub fn handler_rejoin_tournament(
    ctx: Context<RejoinTournament>,
    tournament_id: u32,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let t   = &ctx.accounts.tournament;

    // le torunoi existe 
    require!(now >= t.start_time, ErrorCode::TournamentNotStarted);
    require!(now <  t.end_time,   ErrorCode::TournamentEnded);

    // joeuur a assez de sol
    let player_lamports = ctx.accounts.player.lamports();
    require!(
        player_lamports >= Tournament::ENTRY_FEE,
        ErrorCode::InsufficientEntryFee
    );

    // répartition identique à join_tournament
    let treasury_cut = Tournament::ENTRY_FEE * Tournament::TREASURY_BPS / 100; // 10%
    let prize_cut    = Tournament::ENTRY_FEE - treasury_cut;                  // 90%

    // zkorp argent 
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.player.to_account_info(),
                to:   ctx.accounts.treasury.to_account_info(),
            },
        ),
        treasury_cut,
    )?;
    ctx.accounts.treasury.total_collected =
        ctx.accounts.treasury.total_collected.saturating_add(treasury_cut);

    // tournoi prize pool
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.player.to_account_info(),
                to:   ctx.accounts.tournament.to_account_info(),
            },
        ),
        prize_cut,
    )?;

    // mise à jour Tournament
    let t = &mut ctx.accounts.tournament;
    t.prize_pool     = t.prize_pool.saturating_add(prize_cut);
    t.total_attempts = t.total_attempts.saturating_add(1);
    // total_players ne change pas joueur déjà compté

    // incrémenter le compteur de tentatives du joueur
    let entry      = &mut ctx.accounts.tournament_entry;
    entry.attempts = entry.attempts.saturating_add(1);

    msg!(
        "Replay #{} — joueur={}, tournoi={}, prize pool={}",
        entry.attempts,
        ctx.accounts.player.key(),
        tournament_id,
        ctx.accounts.tournament.prize_pool,
    );
    Ok(())
}
