//! Narrow self-CPI preparation funded by the recyclable cadence-rent PDA.
//!
//! `cadence_funding` is deliberately a System-owned zero-data PDA. Anyone may
//! deposit into it with a plain System transfer, but the program exposes no
//! withdrawal or generic forwarding instruction. These three wrappers are the
//! only paths on which the PDA signs, and each is restricted to the exact
//! current or following canonical cadence.

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
        ),
        ErrorCode::InvalidPeriod
    );
    let accounts = crate::accounts::PrepareArenaDaily {
        protocol: ctx.accounts.protocol.key(),
        arcade_config: ctx.accounts.arcade_config.key(),
        arcade_archive: ctx.accounts.arcade_archive.key(),
        daily_rules_catalog: ctx.accounts.daily_rules_catalog.key(),
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
#[instruction(week_id: u32)]
pub struct FundedPrepareWeeklyJackpot<'info> {
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    pub arcade_archive: Box<Account<'info, ArcadeArchive>>,
    pub daily_rules_catalog: Box<Account<'info, DailyRulesCatalog>>,
    /// CHECK: Initialized and fully constrained by the inner instruction.
    #[account(mut)]
    pub weekly_jackpot: UncheckedAccount<'info>,
    /// CHECK: Canonical zero-data System PDA validated before self-CPI.
    #[account(mut, seeds = [CADENCE_FUNDING_SEED], bump)]
    pub cadence_funding: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub zkube_program: Program<'info, crate::program::Solana>,
}

pub fn handler_funded_prepare_weekly_jackpot(
    ctx: Context<FundedPrepareWeeklyJackpot>,
    week_id: u32,
) -> Result<()> {
    let current = week_id_for_day(day_id_at(Clock::get()?.unix_timestamp)?)?;
    let launch = if ctx.accounts.arcade_config.launch_seeded {
        week_id_for_day(ctx.accounts.arcade_config.launch_day_id)?
    } else {
        current
    };
    require!(
        prepare_period_is_allowed(
            week_id,
            current,
            ctx.accounts.arcade_config.launch_seeded,
            launch,
        ),
        ErrorCode::InvalidPeriod
    );
    let accounts = crate::accounts::PrepareWeeklyJackpot {
        protocol: ctx.accounts.protocol.key(),
        arcade_config: ctx.accounts.arcade_config.key(),
        arcade_archive: ctx.accounts.arcade_archive.key(),
        daily_rules_catalog: ctx.accounts.daily_rules_catalog.key(),
        weekly_jackpot: ctx.accounts.weekly_jackpot.key(),
        payer: ctx.accounts.cadence_funding.key(),
        caller: ctx.accounts.caller.key(),
        system_program: ctx.accounts.system_program.key(),
    };
    let instruction = Instruction {
        program_id: crate::ID,
        accounts: accounts.to_account_metas(None),
        data: crate::instruction::PrepareWeeklyJackpot { week_id }.data(),
    };
    let infos = [
        ctx.accounts.protocol.to_account_info(),
        ctx.accounts.arcade_config.to_account_info(),
        ctx.accounts.arcade_archive.to_account_info(),
        ctx.accounts.daily_rules_catalog.to_account_info(),
        ctx.accounts.weekly_jackpot.to_account_info(),
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
#[instruction(season_id: u32)]
pub struct FundedPrepareSeason<'info> {
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    pub arcade_archive: Box<Account<'info, ArcadeArchive>>,
    /// CHECK: Initialized and fully constrained by the inner instruction.
    #[account(mut)]
    pub season: UncheckedAccount<'info>,
    /// CHECK: Canonical zero-data System PDA validated before self-CPI.
    #[account(mut, seeds = [CADENCE_FUNDING_SEED], bump)]
    pub cadence_funding: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub zkube_program: Program<'info, crate::program::Solana>,
}

pub fn handler_funded_prepare_season(
    ctx: Context<FundedPrepareSeason>,
    season_id: u32,
) -> Result<()> {
    let current = season_id_for_day(day_id_at(Clock::get()?.unix_timestamp)?)?;
    let launch = if ctx.accounts.arcade_config.launch_seeded {
        season_id_for_day(ctx.accounts.arcade_config.launch_day_id)?
    } else {
        current
    };
    require!(
        prepare_period_is_allowed(
            season_id,
            current,
            ctx.accounts.arcade_config.launch_seeded,
            launch,
        ),
        ErrorCode::InvalidPeriod
    );
    let accounts = crate::accounts::PrepareSeason {
        protocol: ctx.accounts.protocol.key(),
        arcade_config: ctx.accounts.arcade_config.key(),
        arcade_archive: ctx.accounts.arcade_archive.key(),
        season: ctx.accounts.season.key(),
        payer: ctx.accounts.cadence_funding.key(),
        caller: ctx.accounts.caller.key(),
        system_program: ctx.accounts.system_program.key(),
    };
    let instruction = Instruction {
        program_id: crate::ID,
        accounts: accounts.to_account_metas(None),
        data: crate::instruction::PrepareSeason { season_id }.data(),
    };
    let infos = [
        ctx.accounts.protocol.to_account_info(),
        ctx.accounts.arcade_config.to_account_info(),
        ctx.accounts.arcade_archive.to_account_info(),
        ctx.accounts.season.to_account_info(),
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
