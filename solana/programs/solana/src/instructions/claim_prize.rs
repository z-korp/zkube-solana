use anchor_lang::prelude::*;
use crate::state::Tournament;
use crate::error::ErrorCode;

/// Le joueur gagnant réclame son prize après le settle.
/// Il signe lui-même — impossible de voler le prize d'un autre.
///
/// Le contrat vérifie que player.key() == winner_1, _2, ou _3 stocké dans Tournament.
/// Il distribue le montant correspondant et met le prize à 0 (anti-double-claim).
#[derive(Accounts)]
#[instruction(tournament_id: u32)]
pub struct ClaimPrize<'info> {
    /// Le joueur qui réclame son prize — doit être un des 3 gagnants
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [b"tournament".as_ref(), tournament_id.to_le_bytes().as_ref()],
        bump,
        constraint = tournament.settled @ ErrorCode::TournamentNotEnded,
    )]
    pub tournament: Account<'info, Tournament>,

    pub system_program: Program<'info, System>,
}

pub fn handler_claim_prize(
    ctx: Context<ClaimPrize>,
    _tournament_id: u32,
) -> Result<()> {
    let player = ctx.accounts.player.key();
    let t = &mut ctx.accounts.tournament;

    // Trouver le prize du joueur et le mettre à 0 (idempotent, anti-double-claim)
    let amount = if t.winner_1 == player && t.prize_1 > 0 {
        let a = t.prize_1;
        t.prize_1 = 0;
        a
    } else if t.winner_2 == player && t.prize_2 > 0 {
        let a = t.prize_2;
        t.prize_2 = 0;
        a
    } else if t.winner_3 == player && t.prize_3 > 0 {
        let a = t.prize_3;
        t.prize_3 = 0;
        a
    } else {
        return err!(ErrorCode::InvalidWinnerOrder); // pas gagnant ou déjà réclamé
    };

    // distribuer directement 
    **ctx.accounts.tournament.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.player.to_account_info().try_borrow_mut_lamports()? += amount;

    msg!(
        "Prize réclamé — joueur: {}, montant: {} lamports",
        player,
        amount,
    );

    Ok(())
}
