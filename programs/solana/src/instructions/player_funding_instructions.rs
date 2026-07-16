//! Owner-funded account creation for silent device-session actions.
//!
//! Anchor requires an `init` payer to be a System-owned signer. The owner's
//! zero-data funding PDA cannot sign the outer transaction, so these narrow
//! wrappers CPI back into zKube and sign only the canonical inner instruction
//! with that PDA's seeds. The inner constraints and session checks remain the
//! single source of truth; no generic SOL transfer surface is exposed.

use anchor_lang::{
    prelude::*,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        program::invoke_signed,
    },
    InstructionData, ToAccountMetas,
};
use session_keys::SessionTokenV2;

use crate::error::ErrorCode;
use crate::state::*;

fn invoke_with_player_funding<'info>(
    owner: Pubkey,
    funding: &AccountInfo<'info>,
    bump: u8,
    instruction: Instruction,
    account_infos: &[AccountInfo<'info>],
) -> Result<()> {
    require!(!funding.executable, ErrorCode::InvalidOwner);
    require_keys_eq!(*funding.owner, system_program::ID, ErrorCode::InvalidOwner);
    require!(funding.data_is_empty(), ErrorCode::InvalidOwner);
    let bump = [bump];
    let signer: &[&[u8]] = &[PLAYER_FUNDING_SEED, owner.as_ref(), &bump];
    invoke_signed(&instruction, account_infos, &[signer]).map_err(Into::into)
}

/// Pays MagicBlock's delegation-account rent from the owner's reusable funding
/// PDA while leaving the scoped device actor responsible only for the outer
/// transaction fee. The self-CPI deliberately targets the existing
/// `delegate_active_run` instruction so its authorization, lifecycle, PDA, and
/// MagicBlock account constraints remain the single source of truth.
#[derive(Accounts)]
pub struct FundedDelegateActiveRun<'info> {
    /// CHECK: MagicBlock buffer PDA constrained by the inner instruction.
    #[account(mut)]
    pub buffer_pda: UncheckedAccount<'info>,
    /// CHECK: MagicBlock delegation record constrained by the inner instruction.
    #[account(mut)]
    pub delegation_record_pda: UncheckedAccount<'info>,
    /// CHECK: MagicBlock delegation metadata constrained by the inner instruction.
    #[account(mut)]
    pub delegation_metadata_pda: UncheckedAccount<'info>,
    /// CHECK: The canonical ActiveRun PDA is constrained and decoded by the inner instruction.
    #[account(mut)]
    pub pda: UncheckedAccount<'info>,
    /// CHECK: Canonical zero-data System PDA validated before self-CPI.
    #[account(
        mut,
        seeds = [PLAYER_FUNDING_SEED, owner_authority.key().as_ref()],
        bump
    )]
    pub player_funding: UncheckedAccount<'info>,
    /// CHECK: Immutable wallet identity checked by the inner instruction.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Account<'info, SessionTokenV2>,
    pub actor: Signer<'info>,
    pub owner_program: Program<'info, crate::program::Solana>,
    /// CHECK: Address-constrained by the inner generated delegation accounts.
    pub delegation_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_funded_delegate_active_run<'info>(
    ctx: Context<'info, FundedDelegateActiveRun<'info>>,
) -> Result<()> {
    require!(
        ctx.remaining_accounts.len() == 1,
        ErrorCode::InvalidMagicProgram
    );
    let validator = &ctx.remaining_accounts[0];
    let accounts = crate::accounts::DelegateActiveRun {
        payer: ctx.accounts.player_funding.key(),
        owner_authority: ctx.accounts.owner_authority.key(),
        session_token: Some(ctx.accounts.session_token.key()),
        actor: ctx.accounts.actor.key(),
        buffer_pda: ctx.accounts.buffer_pda.key(),
        delegation_record_pda: ctx.accounts.delegation_record_pda.key(),
        delegation_metadata_pda: ctx.accounts.delegation_metadata_pda.key(),
        pda: ctx.accounts.pda.key(),
        owner_program: ctx.accounts.owner_program.key(),
        delegation_program: ctx.accounts.delegation_program.key(),
        system_program: ctx.accounts.system_program.key(),
    };
    let mut metas = accounts.to_account_metas(None);
    metas.push(AccountMeta::new_readonly(validator.key(), false));
    let instruction = Instruction {
        program_id: crate::ID,
        accounts: metas,
        data: crate::instruction::DelegateActiveRun {}.data(),
    };
    let infos = vec![
        ctx.accounts.player_funding.to_account_info(),
        ctx.accounts.owner_authority.to_account_info(),
        ctx.accounts.session_token.to_account_info(),
        ctx.accounts.actor.to_account_info(),
        ctx.accounts.buffer_pda.to_account_info(),
        ctx.accounts.delegation_record_pda.to_account_info(),
        ctx.accounts.delegation_metadata_pda.to_account_info(),
        ctx.accounts.pda.to_account_info(),
        ctx.accounts.owner_program.to_account_info(),
        ctx.accounts.delegation_program.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        validator.to_account_info(),
    ];
    invoke_with_player_funding(
        ctx.accounts.owner_authority.key(),
        &ctx.accounts.player_funding.to_account_info(),
        ctx.bumps.player_funding,
        instruction,
        &infos,
    )
}

#[derive(Accounts)]
#[instruction(run_id: u64, map_id: u8, level: u8)]
pub struct FundedPrepareCampaignRun<'info> {
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    /// CHECK: Mutated and fully constrained by the inner instruction. Keeping
    /// this unchecked prevents Anchor from serializing a stale outer copy over
    /// the changes made by the self-CPI.
    #[account(mut)]
    pub player_state: UncheckedAccount<'info>,
    pub map_catalog: Box<Account<'info, MapCatalog>>,
    /// CHECK: Canonical PDA and vacancy are checked by the inner instruction.
    #[account(mut)]
    pub active_run: UncheckedAccount<'info>,
    /// CHECK: Canonical zero-data System PDA validated before self-CPI.
    #[account(
        mut,
        seeds = [PLAYER_FUNDING_SEED, owner_authority.key().as_ref()],
        bump
    )]
    pub player_funding: UncheckedAccount<'info>,
    /// CHECK: Immutable wallet identity checked by the inner instruction.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Account<'info, SessionTokenV2>,
    pub actor: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub zkube_program: Program<'info, crate::program::Solana>,
}

pub fn handler_funded_prepare_campaign_run(
    ctx: Context<FundedPrepareCampaignRun>,
    run_id: u64,
    map_id: u8,
    level: u8,
) -> Result<()> {
    let accounts = crate::accounts::PrepareCampaignRun {
        protocol: ctx.accounts.protocol.key(),
        player_state: ctx.accounts.player_state.key(),
        map_catalog: ctx.accounts.map_catalog.key(),
        active_run: ctx.accounts.active_run.key(),
        payer: ctx.accounts.player_funding.key(),
        owner_authority: ctx.accounts.owner_authority.key(),
        session_token: Some(ctx.accounts.session_token.key()),
        actor: ctx.accounts.actor.key(),
        system_program: ctx.accounts.system_program.key(),
    };
    let instruction = Instruction {
        program_id: crate::ID,
        accounts: accounts.to_account_metas(None),
        data: crate::instruction::PrepareCampaignRun {
            run_id,
            map_id,
            level,
        }
        .data(),
    };
    let infos = [
        ctx.accounts.protocol.to_account_info(),
        ctx.accounts.player_state.to_account_info(),
        ctx.accounts.map_catalog.to_account_info(),
        ctx.accounts.active_run.to_account_info(),
        ctx.accounts.player_funding.to_account_info(),
        ctx.accounts.owner_authority.to_account_info(),
        ctx.accounts.session_token.to_account_info(),
        ctx.accounts.actor.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.zkube_program.to_account_info(),
    ];
    invoke_with_player_funding(
        ctx.accounts.owner_authority.key(),
        &ctx.accounts.player_funding.to_account_info(),
        ctx.bumps.player_funding,
        instruction,
        &infos,
    )
}

#[derive(Accounts)]
#[instruction(run_id: u64)]
pub struct FundedEnterDaily<'info> {
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    pub economy_config: Box<Account<'info, EconomyConfig>>,
    /// CHECK: Mutated and fully constrained by the inner instruction.
    #[account(mut)]
    pub player_state: UncheckedAccount<'info>,
    /// CHECK: Mutated and fully constrained by the inner instruction.
    #[account(mut)]
    pub daily_challenge: UncheckedAccount<'info>,
    /// CHECK: Canonical PDA and initialization are checked by the inner instruction.
    #[account(mut)]
    pub daily_player: UncheckedAccount<'info>,
    /// CHECK: Canonical PDA and vacancy are checked by the inner instruction.
    #[account(mut)]
    pub active_run: UncheckedAccount<'info>,
    /// CHECK: Canonical zero-data System PDA validated before self-CPI.
    #[account(
        mut,
        seeds = [PLAYER_FUNDING_SEED, owner_authority.key().as_ref()],
        bump
    )]
    pub player_funding: UncheckedAccount<'info>,
    /// CHECK: Immutable wallet identity checked by the inner instruction.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Account<'info, SessionTokenV2>,
    pub actor: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub zkube_program: Program<'info, crate::program::Solana>,
}

pub fn handler_funded_enter_daily(ctx: Context<FundedEnterDaily>, run_id: u64) -> Result<()> {
    let accounts = crate::accounts::EnterDaily {
        protocol: ctx.accounts.protocol.key(),
        economy_config: ctx.accounts.economy_config.key(),
        player_state: ctx.accounts.player_state.key(),
        daily_challenge: ctx.accounts.daily_challenge.key(),
        daily_player: ctx.accounts.daily_player.key(),
        active_run: ctx.accounts.active_run.key(),
        payer: ctx.accounts.player_funding.key(),
        owner_authority: ctx.accounts.owner_authority.key(),
        session_token: Some(ctx.accounts.session_token.key()),
        actor: ctx.accounts.actor.key(),
        system_program: ctx.accounts.system_program.key(),
    };
    let instruction = Instruction {
        program_id: crate::ID,
        accounts: accounts.to_account_metas(None),
        data: crate::instruction::EnterDaily { run_id }.data(),
    };
    let infos = [
        ctx.accounts.protocol.to_account_info(),
        ctx.accounts.economy_config.to_account_info(),
        ctx.accounts.player_state.to_account_info(),
        ctx.accounts.daily_challenge.to_account_info(),
        ctx.accounts.daily_player.to_account_info(),
        ctx.accounts.active_run.to_account_info(),
        ctx.accounts.player_funding.to_account_info(),
        ctx.accounts.owner_authority.to_account_info(),
        ctx.accounts.session_token.to_account_info(),
        ctx.accounts.actor.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.zkube_program.to_account_info(),
    ];
    invoke_with_player_funding(
        ctx.accounts.owner_authority.key(),
        &ctx.accounts.player_funding.to_account_info(),
        ctx.bumps.player_funding,
        instruction,
        &infos,
    )
}

#[derive(Accounts)]
pub struct FundedRollupDailyToWeekly<'info> {
    /// CHECK: Mutated and fully constrained by the inner instruction.
    #[account(mut)]
    pub daily_challenge: UncheckedAccount<'info>,
    pub daily_leaderboard: Box<Account<'info, DailyLeaderboard>>,
    /// CHECK: Mutated and fully constrained by the inner instruction.
    #[account(mut)]
    pub daily_player: UncheckedAccount<'info>,
    /// CHECK: Mutated and fully constrained by the inner instruction.
    #[account(mut)]
    pub weekly_challenge: UncheckedAccount<'info>,
    /// CHECK: Canonical PDA and initialization are checked by the inner instruction.
    #[account(mut)]
    pub weekly_player: UncheckedAccount<'info>,
    /// CHECK: Mutated and fully constrained by the inner instruction.
    #[account(mut)]
    pub weekly_leaderboard: UncheckedAccount<'info>,
    /// CHECK: Immutable owner pinned by the inner instruction.
    pub owner: UncheckedAccount<'info>,
    /// CHECK: Canonical zero-data System PDA validated before self-CPI.
    #[account(
        mut,
        seeds = [PLAYER_FUNDING_SEED, owner.key().as_ref()],
        bump
    )]
    pub player_funding: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub zkube_program: Program<'info, crate::program::Solana>,
}

pub fn handler_funded_rollup_daily_to_weekly(
    ctx: Context<FundedRollupDailyToWeekly>,
) -> Result<()> {
    let accounts = crate::accounts::RollupDailyToWeekly {
        daily_challenge: ctx.accounts.daily_challenge.key(),
        daily_leaderboard: ctx.accounts.daily_leaderboard.key(),
        daily_player: ctx.accounts.daily_player.key(),
        weekly_challenge: ctx.accounts.weekly_challenge.key(),
        weekly_player: ctx.accounts.weekly_player.key(),
        weekly_leaderboard: ctx.accounts.weekly_leaderboard.key(),
        owner: ctx.accounts.owner.key(),
        payer: ctx.accounts.player_funding.key(),
        caller: ctx.accounts.caller.key(),
        system_program: ctx.accounts.system_program.key(),
    };
    let instruction = Instruction {
        program_id: crate::ID,
        accounts: accounts.to_account_metas(None),
        data: crate::instruction::RollupDailyToWeekly {}.data(),
    };
    let infos = [
        ctx.accounts.daily_challenge.to_account_info(),
        ctx.accounts.daily_leaderboard.to_account_info(),
        ctx.accounts.daily_player.to_account_info(),
        ctx.accounts.weekly_challenge.to_account_info(),
        ctx.accounts.weekly_player.to_account_info(),
        ctx.accounts.weekly_leaderboard.to_account_info(),
        ctx.accounts.owner.to_account_info(),
        ctx.accounts.player_funding.to_account_info(),
        ctx.accounts.caller.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.zkube_program.to_account_info(),
    ];
    invoke_with_player_funding(
        ctx.accounts.owner.key(),
        &ctx.accounts.player_funding.to_account_info(),
        ctx.bumps.player_funding,
        instruction,
        &infos,
    )
}
