use anchor_lang::prelude::*;
use crate::state::{Tournament, TournamentEntry};
use crate::error::ErrorCode;

// pour la securite 
/// Settle permissionless calcule le top 3 et stocke les résultats dans Tournament.
/// La distribution réelle se fait via claim_prize (le joueur signe lui-même).
///
/// Sécurité :
///   - remaining_accounts = uniquement les TournamentEntry PDAs (source de vérité)
///   - player pubkey dérivé depuis l'entry — jamais fourni par le caller
///   - aucun wallet externe, aucune logique de pairing
///   - le caller ne contrôle rien : il fournit les entries, le contrat décide tout
///
/// remaining_accounts = [entry_0, entry_1, ..., entry_n]  (writable non requis)
#[derive(Accounts)]
#[instruction(tournament_id: u32)]
pub struct SettleTournament<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"tournament".as_ref(), tournament_id.to_le_bytes().as_ref()],
        bump,
        constraint = !tournament.settled @ ErrorCode::TournamentAlreadySettled,
    )]
    pub tournament: Account<'info, Tournament>,
}

pub fn handler_settle_tournament(
    ctx: Context<SettleTournament>,
    tournament_id: u32,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    require!(
        now >= ctx.accounts.tournament.end_time,
        ErrorCode::TournamentNotEnded
    );

    let prize_pool = ctx.accounts.tournament.prize_pool;
    require!(prize_pool > 0, ErrorCode::EmptyPrizePool);

    // ── Phase 1 : reconstruire le leaderboard depuis les entries 
    struct Candidate { 
        player:       Pubkey,
        best_score:   u32,
        submitted_at: i64,
    }

    let mut candidates: Vec<Candidate> = Vec::new();

    for acc in ctx.remaining_accounts.iter() {
        if acc.owner != ctx.program_id { continue; }

        let data = acc.try_borrow_data()?;
        if data.len() < TournamentEntry::SIZE              { continue; }
        if &data[..8] != TournamentEntry::DISCRIMINATOR     { continue; }

        // Layout Borsh après 8 bytes discriminant :
        //   tournament_id : u32    @ 8..12
        //   player        : Pubkey @ 12..44
        //   best_score    : u32    @ 44..48
        //   submitted_at  : i64    @ 48..56
        //   attempts      : u8     @ 56
        //   has_submitted : bool   @ 57

        let entry_tid = u32::from_le_bytes(data[8..12].try_into().unwrap());
        if entry_tid != tournament_id { continue; }

        let has_submitted = data[57] != 0;
        if !has_submitted { continue; }

        candidates.push(Candidate {
            player:       Pubkey::from(<[u8; 32]>::try_from(&data[12..44]).unwrap()),
            best_score:   u32::from_le_bytes(data[44..48].try_into().unwrap()),
            submitted_at: i64::from_le_bytes(data[48..56].try_into().unwrap()),
        });
    }

    require!(!candidates.is_empty(), ErrorCode::NoScoreSubmitted);

    // ── Phase 2 : trier (score desc, timestamp asc) ──────────────────────────
    candidates.sort_by(|a, b| {
        b.best_score
            .cmp(&a.best_score)
            .then(a.submitted_at.cmp(&b.submitted_at))
    });

    let n = candidates.len();

    // ── Phase 3 : calculer les montants (u128 contre overflow) ───────────────
    let pool = prize_pool as u128;

    let (p1, p2, p3): (u64, u64, u64) = if n == 1 {
        (prize_pool, 0, 0)
    } else if n == 2 {
        let a1 = (pool * 65 / 100) as u64;
        (a1, prize_pool - a1, 0)
    } else {
        let a1 = (pool * Tournament::PRIZE_1ST as u128 / 100) as u64;
        let a2 = (pool * Tournament::PRIZE_2ND as u128 / 100) as u64;
        (a1, a2, prize_pool - a1 - a2)
    };

    // ── Phase 4 : stocker les résultats dans Tournament ──────────────────────
    // La distribution réelle se fait via claim_prize.
    let t = &mut ctx.accounts.tournament;
    t.settled = true;

    t.winner_1 = candidates[0].player;
    t.prize_1  = p1;

    t.winner_2 = if n >= 2 { candidates[1].player } else { Pubkey::default() };
    t.prize_2  = p2;

    t.winner_3 = if n >= 3 { candidates[2].player } else { Pubkey::default() };
    t.prize_3  = p3;

    msg!(
        "Tournoi #{} settled — {} joueurs — 1er: {} ({} L), 2ème: {} ({} L), 3ème: {} ({} L)",
        tournament_id, n,
        t.winner_1, p1,
        t.winner_2, p2,
        t.winner_3, p3,
    );

    Ok(())
}
