//! Narrow self-CPI preparation funded by the recyclable cadence-rent PDA.
//!
//! `cadence_funding` is deliberately a System-owned zero-data PDA. Anyone may
//! deposit into it with a plain System transfer, but the program exposes no
//! withdrawal or generic forwarding instruction. This wrapper is the only
//! path on which the PDA signs, restricted to the exact current or following
//! Daily.

use anchor_lang::{
    prelude::*,
    solana_program::{instruction::Instruction, program::invoke_signed, system_program},
    InstructionData, ToAccountMetas,
};

use crate::error::ErrorCode;
use crate::instructions::arcade_instructions::prepare_period_is_allowed;
use crate::state::*;

#[derive(Accounts)]
#[instruction(day_id: u32)]
pub struct FundedPrepareArenaDaily<'info> {
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    pub arcade_archive: Box<Account<'info, ArcadeArchive>>,
    pub daily_rules_catalog: Box<Account<'info, DailyRulesCatalog>>,
    pub realm_map_catalog: Box<Account<'info, MapCatalog>>,
    pub passive_map_catalog: Box<Account<'info, MapCatalog>>,
    /// CHECK: Initialized and fully constrained by the inner instruction.
    #[account(mut)]
    pub arena_daily: UncheckedAccount<'info>,
    /// CHECK: Canonical zero-data System PDA validated before self-CPI.
    #[account(mut, seeds = [CADENCE_FUNDING_SEED], bump)]
    pub cadence_funding: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub zkube_program: Program<'info, crate::program::Solana>,
}

pub fn handler_funded_prepare_arena_daily(
    ctx: Context<FundedPrepareArenaDaily>,
    day_id: u32,
) -> Result<()> {
    let current = day_id_at(Clock::get()?.unix_timestamp)?;
    require!(
        prepare_period_is_allowed(
            day_id,
            current,
            ctx.accounts.arcade_config.launch_seeded,
            ctx.accounts.arcade_config.launch_day_id,
            ctx.accounts.daily_rules_catalog.starts_day,
            ctx.accounts.daily_rules_catalog.pool_entry_count,
        ),
        ErrorCode::InvalidPeriod
    );
    let accounts = crate::accounts::PrepareArenaDaily {
        protocol: ctx.accounts.protocol.key(),
        arcade_config: ctx.accounts.arcade_config.key(),
        arcade_archive: ctx.accounts.arcade_archive.key(),
        daily_rules_catalog: ctx.accounts.daily_rules_catalog.key(),
        realm_map_catalog: ctx.accounts.realm_map_catalog.key(),
        passive_map_catalog: ctx.accounts.passive_map_catalog.key(),
        arena_daily: ctx.accounts.arena_daily.key(),
        payer: ctx.accounts.cadence_funding.key(),
        caller: ctx.accounts.caller.key(),
        system_program: ctx.accounts.system_program.key(),
    };
    let instruction = Instruction {
        program_id: crate::ID,
        accounts: accounts.to_account_metas(None),
        data: crate::instruction::PrepareArenaDaily { day_id }.data(),
    };
    let infos = [
        ctx.accounts.protocol.to_account_info(),
        ctx.accounts.arcade_config.to_account_info(),
        ctx.accounts.arcade_archive.to_account_info(),
        ctx.accounts.daily_rules_catalog.to_account_info(),
        ctx.accounts.realm_map_catalog.to_account_info(),
        ctx.accounts.passive_map_catalog.to_account_info(),
        ctx.accounts.arena_daily.to_account_info(),
        ctx.accounts.cadence_funding.to_account_info(),
        ctx.accounts.caller.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.zkube_program.to_account_info(),
    ];
    invoke_with_cadence_funding(
        &ctx.accounts.cadence_funding.to_account_info(),
        ctx.bumps.cadence_funding,
        instruction,
        &infos,
    )
}

#[derive(Accounts)]
pub struct FundedFinalizeArenaDaily<'info> {
    /// CHECK: Fully constrained by the inner finalization instruction.
    #[account(mut)]
    pub arena_daily: UncheckedAccount<'info>,
    /// CHECK: Fully constrained by the inner finalization instruction.
    #[account(mut)]
    pub following_daily: UncheckedAccount<'info>,
    /// CHECK: Created and fully constrained by the inner instruction.
    #[account(mut)]
    pub score_board: UncheckedAccount<'info>,
    /// CHECK: Created and fully constrained by the inner instruction.
    #[account(mut)]
    pub theme_board: UncheckedAccount<'info>,
    /// CHECK: Canonical zero-data System PDA validated before self-CPI.
    #[account(mut, seeds = [CADENCE_FUNDING_SEED], bump)]
    pub cadence_funding: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub zkube_program: Program<'info, crate::program::Solana>,
}

pub fn handler_funded_finalize_arena_daily(
    ctx: Context<FundedFinalizeArenaDaily>,
    score_payout_count: u32,
    theme_payout_count: u32,
) -> Result<()> {
    require!(
        score_payout_count
            <= u32::try_from(ARENA_BOARD_CAPACITY).map_err(|_| ErrorCode::ArithmeticOverflow)?
            && theme_payout_count
                <= u32::try_from(ARENA_BOARD_CAPACITY)
                    .map_err(|_| ErrorCode::ArithmeticOverflow)?,
        ErrorCode::BoardCapacityExceeded
    );
    let accounts = crate::accounts::FinalizeArenaDaily {
        arena_daily: ctx.accounts.arena_daily.key(),
        following_daily: ctx.accounts.following_daily.key(),
        score_board: ctx.accounts.score_board.key(),
        theme_board: ctx.accounts.theme_board.key(),
        cadence_funding: ctx.accounts.cadence_funding.key(),
        caller: ctx.accounts.caller.key(),
        system_program: ctx.accounts.system_program.key(),
    };
    let instruction = Instruction {
        program_id: crate::ID,
        accounts: accounts.to_account_metas(None),
        data: crate::instruction::FinalizeArenaDaily {
            score_payout_count,
            theme_payout_count,
        }
        .data(),
    };
    let infos = [
        ctx.accounts.arena_daily.to_account_info(),
        ctx.accounts.following_daily.to_account_info(),
        ctx.accounts.score_board.to_account_info(),
        ctx.accounts.theme_board.to_account_info(),
        ctx.accounts.cadence_funding.to_account_info(),
        ctx.accounts.caller.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.zkube_program.to_account_info(),
    ];
    invoke_with_cadence_funding(
        &ctx.accounts.cadence_funding.to_account_info(),
        ctx.bumps.cadence_funding,
        instruction,
        &infos,
    )
}

fn invoke_with_cadence_funding<'info>(
    funding: &AccountInfo<'info>,
    bump: u8,
    instruction: Instruction,
    account_infos: &[AccountInfo<'info>],
) -> Result<()> {
    require!(!funding.executable, ErrorCode::InvalidOwner);
    require_keys_eq!(*funding.owner, system_program::ID, ErrorCode::InvalidOwner);
    require!(funding.data_is_empty(), ErrorCode::InvalidOwner);
    let bump = [bump];
    let signer: &[&[u8]] = &[CADENCE_FUNDING_SEED, &bump];
    invoke_signed(&instruction, account_infos, &[signer]).map_err(Into::into)
}
