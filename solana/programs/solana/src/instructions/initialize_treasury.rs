// Instruction one-time : initialise la treasury z-korp
// À appeler une seule fois au déploiement avec le wallet z-korp comme authority

use anchor_lang::prelude::*;
use crate::state::Treasury;

#[derive(Accounts)]
pub struct InitializeTreasury<'info> {
    /// Le fondateur z-korp qui signe et devient l'authority
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Le compte Treasury PDA — créé ici une seule fois
    #[account(
        init,
        payer = authority,
        space = Treasury::SIZE,
        seeds = [b"treasury"],
        bump
    )]
    pub treasury: Account<'info, Treasury>,

    pub system_program: Program<'info, System>,
}

pub fn handler_initialize_treasury(
    ctx: Context<InitializeTreasury>,
    fee_per_game: u64,
) -> Result<()> {
    let treasury = &mut ctx.accounts.treasury;
    treasury.authority = ctx.accounts.authority.key();
    treasury.total_collected = 0;
    treasury.fee_per_game = fee_per_game;

    msg!(
        "Treasury initialisée — authority: {}, fee: {} lamports",
        treasury.authority,
        treasury.fee_per_game
    );
    Ok(())
}
