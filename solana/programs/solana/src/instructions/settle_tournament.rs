use anchor_lang::prelude::*;
use crate::state::{Tournament, TournamentEntry};
use crate::error::ErrorCode;

/// Settle permissionless — calcule le top 3 et stocke les résultats dans Tournament.
/// La distribution se fait via claim_prize (le joueur signe lui-même).
///
/// remaining_accounts = toutes les TournamentEntry du tournoi
///   Désérialisées via Anchor (Account::try_from) — filtrées et triées on-chain.
///   Le caller ne contrôle rien : les winners sont déterminés par les entries.
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
    // remaining_accounts = [entry_0, entry_1, ..., entry_n]
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

    // ── Phase 1 : reconstruire le leaderboard depuis les entries ─────────────
    // try_deserialize vérifie le discriminant Anchor et désérialise Borsh.
    // On vérifie aussi l'owner pour s'assurer que c'est un compte de CE programme.
    // Aucun problème de lifetime — on opère sur les bytes uniquement.
    let mut entries: Vec<TournamentEntry> = Vec::new();

    for acc in ctx.remaining_accounts.iter() {
        if acc.owner != ctx.program_id { continue; }
        let data = acc.try_borrow_data()?;
        if data.len() < TournamentEntry::SIZE { continue; }
        if let Ok(entry) = TournamentEntry::try_deserialize(&mut data.as_ref()) {
            if entry.tournament_id == tournament_id && entry.has_submitted {
                entries.push(entry);
            }
        }
    }

    require!(!entries.is_empty(), ErrorCode::NoScoreSubmitted);

    // ── Phase 2 : trier — score DESC, timestamp ASC (premier arrivé gagne) ───
    entries.sort_by(|a, b| {
        b.best_score
            .cmp(&a.best_score)
            .then_with(|| a.submitted_at.cmp(&b.submitted_at))
    });

    let n = entries.len();

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

    // ── Phase 4 : stocker les résultats — distribution via claim_prize ────────
    let t = &mut ctx.accounts.tournament;
    t.settled  = true;

    t.winner_1 = entries[0].player;
    t.prize_1  = p1;

    t.winner_2 = if n >= 2 { entries[1].player } else { Pubkey::default() };
    t.prize_2  = p2;

    t.winner_3 = if n >= 3 { entries[2].player } else { Pubkey::default() };
    t.prize_3  = p3;

    msg!(
        "Tournoi #{} settled — {} joueurs — 1er: {} ({}L), 2ème: {} ({}L), 3ème: {} ({}L)",
        tournament_id, n,
        t.winner_1, p1,
        t.winner_2, p2,
        t.winner_3, p3,
    );

    Ok(())
}
