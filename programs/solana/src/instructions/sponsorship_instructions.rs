use anchor_lang::{prelude::*, Discriminator};
use solana_instructions_sysvar::load_instruction_at_checked;

use crate::error::ErrorCode;
use crate::state::v2::*;

#[derive(Accounts)]
pub struct ConsumeSponsorshipV1<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused,
        has_one = paymaster @ ErrorCode::Unauthorized
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        init_if_needed,
        payer = paymaster,
        space = 8 + SponsorAllowance::INIT_SPACE,
        seeds = [SPONSOR_ALLOWANCE_SEED, owner.key().as_ref()],
        bump
    )]
    pub sponsor_allowance: Box<Account<'info, SponsorAllowance>>,
    #[account(mut)]
    pub paymaster: Signer<'info>,
    pub owner: Signer<'info>,
    /// CHECK: Address-pinned Solana instructions sysvar, parsed read-only.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_consume_sponsorship_v1(ctx: Context<ConsumeSponsorshipV1>) -> Result<()> {
    let (consume_count, payload_count, paid_attempts) =
        inspect_sponsored_transaction(&ctx.accounts.instructions.to_account_info())?;
    require!(
        consume_count == 1 && payload_count > 0 && paid_attempts <= 1,
        ErrorCode::InvalidSponsoredTransaction
    );
    let day = cadence_day(Clock::get()?.unix_timestamp);
    let allowance = &mut ctx.accounts.sponsor_allowance;
    if allowance.version == 0 {
        allowance.set_inner(SponsorAllowance::initialize(
            ctx.accounts.owner.key(),
            day,
            ctx.bumps.sponsor_allowance,
        ));
    } else {
        require_keys_eq!(
            allowance.owner,
            ctx.accounts.owner.key(),
            ErrorCode::Unauthorized
        );
        require!(
            allowance.version == ACCOUNT_VERSION_V1,
            ErrorCode::InvalidVersion
        );
    }
    allowance.consume(
        day,
        u16::from(paid_attempts),
        ctx.accounts.protocol.sponsorship_daily_tx_limit,
        ctx.accounts.protocol.sponsorship_daily_paid_attempt_limit,
    )?;
    emit!(SponsorshipConsumed {
        owner: allowance.owner,
        cadence_day: day,
        sponsored_transactions: allowance.sponsored_transactions,
        paid_daily_attempts: allowance.paid_daily_attempts,
    });
    Ok(())
}

fn inspect_sponsored_transaction(instructions: &AccountInfo<'_>) -> Result<(u8, u8, u8)> {
    let mut consume_count = 0u8;
    let mut payload_count = 0u8;
    let mut paid_attempts = 0u8;
    for index in 0..16 {
        let Ok(instruction) = load_instruction_at_checked(index, instructions) else {
            break;
        };
        if instruction.program_id != crate::ID || instruction.data.len() < 8 {
            continue;
        }
        let discriminator = &instruction.data[..8];
        if discriminator == crate::instruction::ConsumeSponsorshipV1::DISCRIMINATOR {
            consume_count = consume_count
                .checked_add(1)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        } else {
            payload_count = payload_count
                .checked_add(1)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            if discriminator == crate::instruction::EnterDailyPaidV1::DISCRIMINATOR {
                paid_attempts = paid_attempts
                    .checked_add(1)
                    .ok_or(ErrorCode::ArithmeticOverflow)?;
            }
        }
    }
    Ok((consume_count, payload_count, paid_attempts))
}

#[event]
pub struct SponsorshipConsumed {
    pub owner: Pubkey,
    pub cadence_day: u32,
    pub sponsored_transactions: u16,
    pub paid_daily_attempts: u16,
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::solana_program::sysvar::instructions::{
        construct_instructions_data, BorrowedInstruction,
    };

    #[test]
    fn instruction_introspection_counts_payload_and_paid_entry_without_caller_input() {
        let consume = crate::instruction::ConsumeSponsorshipV1::DISCRIMINATOR;
        let initialize = crate::instruction::InitializePlayerV1::DISCRIMINATOR;
        let paid = crate::instruction::EnterDailyPaidV1::DISCRIMINATOR;
        let instructions = [
            BorrowedInstruction {
                program_id: &crate::ID,
                accounts: vec![],
                data: consume,
            },
            BorrowedInstruction {
                program_id: &crate::ID,
                accounts: vec![],
                data: initialize,
            },
            BorrowedInstruction {
                program_id: &crate::ID,
                accounts: vec![],
                data: paid,
            },
        ];
        let mut data = construct_instructions_data(&instructions);
        let key = solana_instructions_sysvar::ID;
        let owner = Pubkey::default();
        let mut lamports = 0;
        let account = AccountInfo::new(&key, false, false, &mut lamports, &mut data, &owner, false);
        assert_eq!(inspect_sponsored_transaction(&account).unwrap(), (1, 2, 1));
    }
}
