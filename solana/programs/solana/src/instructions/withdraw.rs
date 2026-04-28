// Retrait des fonds de la treasury vers un wallet destinataire
// Seule l'authority enregistrée dans la treasury peut appeler cette instruction

use anchor_lang::prelude::*;
use crate::state::Treasury;
use crate::error::ErrorCode;

#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// Doit être l'authority enregistrée dans la treasury — sinon rejet
    pub authority: Signer<'info>,

    /// Le compte Treasury PDA
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
        constraint = treasury.authority == authority.key() @ ErrorCode::Unauthorized
    )]
    pub treasury: Account<'info, Treasury>,

    /// Le destinataire du retrait — libre, pas hardcodé
    /// CHECK: validé par l'authority qui signe
    #[account(mut)]
    pub destination: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler_withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    let treasury = &mut ctx.accounts.treasury;

    // Vérifie que la treasury a assez de fonds (en gardant le rent minimum)
    let rent = Rent::get()?.minimum_balance(Treasury::SIZE);
    let available = treasury
        .to_account_info()
        .lamports()
        .saturating_sub(rent);

    require!(amount <= available, ErrorCode::InsufficientFunds);

    // Transfert direct depuis le PDA vers le destinataire
    **treasury.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.destination.try_borrow_mut_lamports()? += amount;

    msg!(
        "Retrait de {} lamports vers {}",
        amount,
        ctx.accounts.destination.key()
    );
    Ok(())
}
