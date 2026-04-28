use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::cpi::undelegate_account;

#[derive(Accounts)]
pub struct ProcessUndelegation<'info> {
    /// CHECK: MUST match delegation_program CPI name (base_account)
    #[account(mut)]
    pub base_account: AccountInfo<'info>,

    /// CHECK: undelegate buffer (CPI-owned account)
    #[account(mut)]
    pub buffer: AccountInfo<'info>,

    /// Payer receives rent
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler_process_undelegation(
    ctx: Context<ProcessUndelegation>,
    pda_seeds: Vec<Vec<u8>>,
) -> Result<()> {

    msg!(
        "process_undelegation: undelegating {}",
        ctx.accounts.base_account.key()
    );

    undelegate_account(
        &ctx.accounts.base_account,
        &crate::ID, // ZKUBE_PROGRAM_ID
        &ctx.accounts.buffer,
        &ctx.accounts.payer,
        &ctx.accounts.system_program,
        pda_seeds,
    )?;

    Ok(())
}