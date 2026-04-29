use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::{Tournament, TournamentEntry, Treasury};
use crate::error::ErrorCode;

/// Première inscription d'un joueur au tournoi
/// Transfère l'entry fee (0.1 SOL) :
/// 10% pour la zkorp treasury, 90% pour le prize pool du tournoi.
/// Crée le TournamentEntry du joueur (init une seule fois)
/// Pour rejouer, utiliser rejoin_tournament
#[derive(Accounts)]
#[instruction(tournament_id: u32)]
pub struct JoinTournament<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [b"tournament".as_ref(), tournament_id.to_le_bytes().as_ref()],
        bump,
        constraint = !tournament.settled @ ErrorCode::TournamentAlreadySettled,
    )]
    pub tournament: Account<'info, Tournament>,

    /// le init est ici 
    #[account(
        init,
        payer = player,
        space = TournamentEntry::SIZE,
        seeds = [b"tournament_entry".as_ref(), tournament_id.to_le_bytes().as_ref(), player.key().as_ref()],
        bump,
    )]
    pub tournament_entry: Account<'info, TournamentEntry>,

    /// Treasury zKorp — reçoit 10% de l'entry fee
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
    )]
    pub treasury: Account<'info, Treasury>,

    pub system_program: Program<'info, System>,
}

pub fn handler_join_tournament(
    ctx: Context<JoinTournament>,
    tournament_id: u32,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let t   = &ctx.accounts.tournament;

    // Vérifier que le tournoi est actif
    require!(now >= t.start_time, ErrorCode::TournamentNotStarted);
    require!(now <  t.end_time,   ErrorCode::TournamentEnded);

    // Vérifier que le joueur a assez de sol 
    let player_lamports = ctx.accounts.player.lamports();
    require!(
        player_lamports >= Tournament::ENTRY_FEE,
        ErrorCode::InsufficientEntryFee // sinon erreur
    );

    // calculer la répartition de l'entry fee
    let treasury_cut = Tournament::ENTRY_FEE * Tournament::TREASURY_BPS / 100; // 10%
    let prize_cut    = Tournament::ENTRY_FEE - treasury_cut;                   // 90%

    // transférer 10% a la wallet zkorp (treasury)
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.player.to_account_info(),
                to:   ctx.accounts.treasury.to_account_info(),// zkorp
            },
        ),
        treasury_cut,
    )?;
    ctx.accounts.treasury.total_collected = ctx.accounts.treasury.total_collected.saturating_add(treasury_cut);

    // Transférer 90% pour tournament (prize pool)
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.player.to_account_info(),
                to:   ctx.accounts.tournament.to_account_info(),// le prize pool du tournoi
            },
        ),
        prize_cut,
    )?;

    // mettre à jour le tournoi
    let t = &mut ctx.accounts.tournament;
    t.prize_pool     = t.prize_pool.saturating_add(prize_cut);
    t.total_players  = t.total_players.saturating_add(1);
    t.total_attempts = t.total_attempts.saturating_add(1);

    // initialiser le TournamentEntry
    let entry            = &mut ctx.accounts.tournament_entry;
    entry.tournament_id  = tournament_id;
    entry.player         = ctx.accounts.player.key();
    entry.best_score     = 0;
    entry.submitted_at   = 0;
    entry.attempts       = 1;
    entry.has_submitted  = false; // pas encore soumis de partie terminée

    msg!(
        "Joueur {} inscrit au tournoi #{} — prize pool: {} lamports",
        ctx.accounts.player.key(),
        tournament_id,
        ctx.accounts.tournament.prize_pool,
    );
    Ok(())
}
