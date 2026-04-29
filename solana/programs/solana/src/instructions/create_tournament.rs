use anchor_lang::prelude::*;
use solana_program::hash::hashv;
use crate::state::{Tournament, Treasury};
use crate::error::ErrorCode;

/// Crée un nouveau tournoi.
/// Réservé à l'authority zKorp (celle qui a initialisé la treasury).
/// Le prize pool commence à 0 — il est alimenté par join_tournament.
#[derive(Accounts)]
#[instruction(tournament_id: u32)]
pub struct CreateTournament<'info> {
    /// zKorp authority — seul signataire autorisé
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Treasury existante — on vérifie que le signataire est bien l'authority
    #[account(
        seeds = [b"treasury"],
        bump,
        constraint = treasury.authority == authority.key() @ ErrorCode::Unauthorized,
    )]
    pub treasury: Account<'info, Treasury>,

    /// Compte Tournament — créé ici, financé par l'authority
    #[account(
        init,
        payer = authority,
        space = Tournament::SIZE,
        seeds = [b"tournament".as_ref(), tournament_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub tournament: Account<'info, Tournament>,

    pub system_program: Program<'info, System>,
}

pub fn handler_create_tournament(
    ctx: Context<CreateTournament>,
    tournament_id: u32,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;// je recupere l'heure du debut 
    let t   = &mut ctx.accounts.tournament;

    t.tournament_id  = tournament_id;
    t.start_time     = now;
    t.end_time       = now + Tournament::DURATION;
    t.zone_id        = compute_zone_id(tournament_id);
    t.entry_fee      = Tournament::ENTRY_FEE;
    t.prize_pool     = 0;
    t.total_players  = 0;
    t.total_attempts = 0;
    t.settled        = false;

    msg!(
        "tournoi #{} créé — zone={}, start={}, end={}",
        tournament_id,
        t.zone_id,
        t.start_time,
        t.end_time,
    );
    Ok(())
}

/// SHA256(tournament_id_le || "zone") % 10 + 1 → zone 1..=10
/// la fonction est deterministe si quelqu'un connait le tournement_id => il connait la zone a l'avance 
/// mais dans notre cas c'est pas dangereux 
fn compute_zone_id(tournament_id: u32) -> u8 {
    let id_bytes = tournament_id.to_le_bytes();
    let hash = hashv(&[&id_bytes, b"zone"]);
    let  bytes = hash.to_bytes();
    let n = u64::from_le_bytes(bytes[0..8].try_into().unwrap());
    ((n % 10) + 1) as u8
}
