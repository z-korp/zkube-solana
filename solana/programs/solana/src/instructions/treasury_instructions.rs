use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::error::ErrorCode;
use crate::state::v2::*;

#[derive(Accounts)]
pub struct SweepProtocolRevenueV1<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        address = protocol.treasury_ledger,
        seeds = [TREASURY_LEDGER_SEED],
        bump = treasury_ledger.bump,
        constraint = treasury_ledger.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = treasury_ledger.payment_mint == protocol.payment_mint @ ErrorCode::InvalidOwner
    )]
    pub treasury_ledger: Box<Account<'info, TreasuryLedger>>,
    #[account(address = protocol.payment_mint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        address = protocol.payment_vault,
        token::mint = payment_mint,
        token::authority = protocol,
        token::token_program = payment_token_program
    )]
    pub payment_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        address = protocol.treasury_vault,
        token::mint = payment_mint,
        token::authority = protocol,
        token::token_program = payment_token_program
    )]
    pub treasury_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        address = protocol.reward_vault,
        token::mint = payment_mint,
        token::authority = protocol,
        token::token_program = payment_token_program
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = protocol.payment_token_program)]
    pub payment_token_program: Interface<'info, TokenInterface>,
    pub caller: Signer<'info>,
}

pub fn handler_sweep_protocol_revenue_v1(ctx: Context<SweepProtocolRevenueV1>) -> Result<()> {
    let amount = ctx.accounts.treasury_ledger.unswept_map_revenue()?;
    require!(amount > 0, ErrorCode::InvalidState);
    require!(
        ctx.accounts.payment_vault.amount >= amount,
        ErrorCode::InsufficientFunds
    );
    let rewards = u64::try_from(
        u128::from(amount)
            .checked_mul(u128::from(ctx.accounts.protocol.revenue_reward_bps))
            .ok_or(ErrorCode::ArithmeticOverflow)?
            / 10_000,
    )
    .map_err(|_| ErrorCode::ArithmeticOverflow)?;
    let treasury = amount
        .checked_sub(rewards)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let bump = [ctx.accounts.protocol.bump];
    let signer: &[&[u8]] = &[PROTOCOL_CONFIG_SEED, &bump];
    transfer_from_protocol_vault(
        &ctx.accounts.payment_token_program,
        &ctx.accounts.payment_vault,
        &ctx.accounts.payment_mint,
        &ctx.accounts.treasury_vault,
        &ctx.accounts.protocol,
        signer,
        treasury,
    )?;
    transfer_from_protocol_vault(
        &ctx.accounts.payment_token_program,
        &ctx.accounts.payment_vault,
        &ctx.accounts.payment_mint,
        &ctx.accounts.reward_vault,
        &ctx.accounts.protocol,
        signer,
        rewards,
    )?;
    ctx.accounts
        .treasury_ledger
        .record_revenue_sweep(amount, treasury, rewards)?;
    emit!(ProtocolRevenueSwept {
        amount,
        treasury,
        rewards,
        caller: ctx.accounts.caller.key(),
    });
    Ok(())
}

#[derive(Accounts)]
pub struct AllocateRealizedYieldV1<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [YIELD_POLICY_SEED],
        bump = yield_policy.bump,
        constraint = yield_policy.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion,
        constraint = protocol.yield_policy == yield_policy.key() @ ErrorCode::InvalidOwner,
        constraint = yield_policy.protocol == protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub yield_policy: Box<Account<'info, YieldStrategyPolicy>>,
    #[account(
        mut,
        address = protocol.treasury_ledger,
        seeds = [TREASURY_LEDGER_SEED],
        bump = treasury_ledger.bump,
        constraint = treasury_ledger.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion,
        constraint = treasury_ledger.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = treasury_ledger.payment_mint == protocol.payment_mint @ ErrorCode::InvalidOwner
    )]
    pub treasury_ledger: Box<Account<'info, TreasuryLedger>>,
    #[account(address = protocol.payment_mint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        address = protocol.treasury_vault,
        token::mint = payment_mint,
        token::authority = protocol,
        token::token_program = payment_token_program
    )]
    pub treasury_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        address = protocol.reward_vault,
        token::mint = payment_mint,
        token::authority = protocol,
        token::token_program = payment_token_program
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = protocol.payment_token_program)]
    pub payment_token_program: Interface<'info, TokenInterface>,
    pub caller: Signer<'info>,
}

pub fn handler_allocate_realized_yield_v1(ctx: Context<AllocateRealizedYieldV1>) -> Result<()> {
    let amount = ctx.accounts.treasury_ledger.unallocated_realized_yield()?;
    require!(amount > 0, ErrorCode::InvalidState);
    let (treasury, rewards) = split_allocation(amount, ctx.accounts.yield_policy.yield_reward_bps)?;
    require!(
        ctx.accounts.treasury_vault.amount >= rewards,
        ErrorCode::InsufficientFunds
    );
    let bump = [ctx.accounts.protocol.bump];
    let signer: &[&[u8]] = &[PROTOCOL_CONFIG_SEED, &bump];
    transfer_from_protocol_vault(
        &ctx.accounts.payment_token_program,
        &ctx.accounts.treasury_vault,
        &ctx.accounts.payment_mint,
        &ctx.accounts.reward_vault,
        &ctx.accounts.protocol,
        signer,
        rewards,
    )?;
    ctx.accounts
        .treasury_ledger
        .record_yield_allocation(amount, treasury, rewards)?;
    emit!(RealizedYieldAllocated {
        amount,
        treasury,
        rewards,
        caller: ctx.accounts.caller.key(),
    });
    Ok(())
}

fn split_allocation(amount: u64, reward_bps: u16) -> Result<(u64, u64)> {
    require!(reward_bps <= 10_000, ErrorCode::InvalidBasisPoints);
    let rewards = u64::try_from(
        u128::from(amount)
            .checked_mul(u128::from(reward_bps))
            .ok_or(ErrorCode::ArithmeticOverflow)?
            / 10_000,
    )
    .map_err(|_| ErrorCode::ArithmeticOverflow)?;
    let treasury = amount
        .checked_sub(rewards)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    Ok((treasury, rewards))
}

#[allow(clippy::too_many_arguments)]
fn transfer_from_protocol_vault<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: &Account<'info, ProtocolConfig>,
    signer: &[&[u8]],
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: authority.to_account_info(),
            },
            &[signer],
        ),
        amount,
        mint.decimals,
    )
}

#[event]
pub struct ProtocolRevenueSwept {
    pub amount: u64,
    pub treasury: u64,
    pub rewards: u64,
    pub caller: Pubkey,
}

#[event]
pub struct RealizedYieldAllocated {
    pub amount: u64,
    pub treasury: u64,
    pub rewards: u64,
    pub caller: Pubkey,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revenue_allocation_conserves_rounding_dust_in_treasury() {
        for (amount, reward_bps) in [(1u64, 5_000u16), (101, 3_333), (1_000_000, 0), (9, 10_000)] {
            let rewards =
                u64::try_from(u128::from(amount) * u128::from(reward_bps) / 10_000).unwrap();
            let treasury = amount.checked_sub(rewards).unwrap();
            assert_eq!(treasury.checked_add(rewards), Some(amount));
        }
    }

    #[test]
    fn realized_yield_allocation_conserves_rounding_dust_in_treasury() {
        for (amount, reward_bps, expected) in [
            (1u64, 5_000u16, (1, 0)),
            (101, 3_333, (68, 33)),
            (1_000_000, DEFAULT_YIELD_REWARD_BPS, (0, 1_000_000)),
            (9, 0, (9, 0)),
        ] {
            let allocation = split_allocation(amount, reward_bps).unwrap();
            assert_eq!(allocation, expected);
            assert_eq!(allocation.0.checked_add(allocation.1), Some(amount));
        }
        assert!(split_allocation(1, 10_001).is_err());
    }
}
