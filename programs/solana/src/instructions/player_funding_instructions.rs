//! Owner-funded account creation for silent device-session actions.
//!
//! Anchor requires an `init` payer to be a System-owned signer. The owner's
//! zero-data funding PDA cannot sign the outer transaction, so these narrow
//! wrappers CPI back into zKube and sign only the canonical inner instruction
//! with that PDA's seeds. The inner constraints and session checks remain the
//! single source of truth; no generic SOL transfer surface is exposed.

use anchor_lang::{
    prelude::*,
    solana_program::{instruction::Instruction, program::invoke_signed},
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

#[derive(Accounts)]
#[instruction(run_id: u64, map_id: u8, level: u8)]
pub struct FundedPrepareCampaignRun<'info> {
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    /// CHECK: Mutated and fully constrained by the inner instruction. Keeping
    /// this unchecked prevents Anchor from serializing a stale outer copy over
    /// the changes made by the self-CPI.
    #[account(mut)]
    pub player_profile: UncheckedAccount<'info>,
    pub campaign_progress: Box<Account<'info, CampaignProgress>>,
    pub map_catalog: Box<Account<'info, MapCatalog>>,
    /// CHECK: Canonical PDA and vacancy are checked by the inner instruction.
    #[account(mut)]
    pub run_shell: UncheckedAccount<'info>,
    /// CHECK: Canonical PDA and vacancy are checked by the inner instruction.
    #[account(mut)]
    pub active_run: UncheckedAccount<'info>,
    /// CHECK: Canonical PDA and vacancy are checked by the inner instruction.
    #[account(mut)]
    pub run_receipt: UncheckedAccount<'info>,
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
        player_profile: ctx.accounts.player_profile.key(),
        campaign_progress: ctx.accounts.campaign_progress.key(),
        map_catalog: ctx.accounts.map_catalog.key(),
        run_shell: ctx.accounts.run_shell.key(),
        active_run: ctx.accounts.active_run.key(),
        run_receipt: ctx.accounts.run_receipt.key(),
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
        ctx.accounts.player_profile.to_account_info(),
        ctx.accounts.campaign_progress.to_account_info(),
        ctx.accounts.map_catalog.to_account_info(),
        ctx.accounts.run_shell.to_account_info(),
        ctx.accounts.active_run.to_account_info(),
        ctx.accounts.run_receipt.to_account_info(),
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
    pub player_profile: UncheckedAccount<'info>,
    /// CHECK: Mutated and fully constrained by the inner instruction.
    #[account(mut)]
    pub daily_challenge: UncheckedAccount<'info>,
    /// CHECK: Canonical PDA and initialization are checked by the inner instruction.
    #[account(mut)]
    pub daily_player: UncheckedAccount<'info>,
    /// CHECK: Canonical PDA and initialization are checked by the inner instruction.
    #[account(mut)]
    pub weekly_stipend: UncheckedAccount<'info>,
    /// CHECK: Canonical PDA and vacancy are checked by the inner instruction.
    #[account(mut)]
    pub run_shell: UncheckedAccount<'info>,
    /// CHECK: Canonical PDA and vacancy are checked by the inner instruction.
    #[account(mut)]
    pub active_run: UncheckedAccount<'info>,
    /// CHECK: Canonical PDA and vacancy are checked by the inner instruction.
    #[account(mut)]
    pub run_receipt: UncheckedAccount<'info>,
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
        player_profile: ctx.accounts.player_profile.key(),
        daily_challenge: ctx.accounts.daily_challenge.key(),
        daily_player: ctx.accounts.daily_player.key(),
        weekly_stipend: ctx.accounts.weekly_stipend.key(),
        run_shell: ctx.accounts.run_shell.key(),
        active_run: ctx.accounts.active_run.key(),
        run_receipt: ctx.accounts.run_receipt.key(),
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
        ctx.accounts.player_profile.to_account_info(),
        ctx.accounts.daily_challenge.to_account_info(),
        ctx.accounts.daily_player.to_account_info(),
        ctx.accounts.weekly_stipend.to_account_info(),
        ctx.accounts.run_shell.to_account_info(),
        ctx.accounts.active_run.to_account_info(),
        ctx.accounts.run_receipt.to_account_info(),
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
pub struct FundedClaimQuest<'info> {
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    /// CHECK: Mutated and fully constrained by the inner instruction.
    #[account(mut)]
    pub player_profile: UncheckedAccount<'info>,
    /// CHECK: Canonical PDA and initialization are checked by the inner instruction.
    #[account(mut)]
    pub quest_claims: UncheckedAccount<'info>,
    /// CHECK: Canonical PDA and initialization are checked by the inner instruction.
    #[account(mut)]
    pub weekly_stipend: UncheckedAccount<'info>,
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

pub fn handler_funded_claim_quest(ctx: Context<FundedClaimQuest>, quest_index: u8) -> Result<()> {
    let accounts = crate::accounts::ClaimQuest {
        protocol: ctx.accounts.protocol.key(),
        player_profile: ctx.accounts.player_profile.key(),
        quest_claims: ctx.accounts.quest_claims.key(),
        weekly_stipend: ctx.accounts.weekly_stipend.key(),
        payer: ctx.accounts.player_funding.key(),
        owner_authority: ctx.accounts.owner_authority.key(),
        session_token: Some(ctx.accounts.session_token.key()),
        actor: ctx.accounts.actor.key(),
        system_program: ctx.accounts.system_program.key(),
    };
    let instruction = Instruction {
        program_id: crate::ID,
        accounts: accounts.to_account_metas(None),
        data: crate::instruction::ClaimQuest { quest_index }.data(),
    };
    let infos = [
        ctx.accounts.protocol.to_account_info(),
        ctx.accounts.player_profile.to_account_info(),
        ctx.accounts.quest_claims.to_account_info(),
        ctx.accounts.weekly_stipend.to_account_info(),
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
pub struct FundedClaimLevelMilestone<'info> {
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    pub economy_config: Box<Account<'info, EconomyConfig>>,
    /// CHECK: Mutated and fully constrained by the inner instruction.
    #[account(mut)]
    pub player_profile: UncheckedAccount<'info>,
    /// CHECK: Canonical PDA and initialization are checked by the inner instruction.
    #[account(mut)]
    pub level_milestones: UncheckedAccount<'info>,
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

pub fn handler_funded_claim_level_milestone(
    ctx: Context<FundedClaimLevelMilestone>,
    milestone_index: u8,
) -> Result<()> {
    let accounts = crate::accounts::ClaimLevelMilestone {
        protocol: ctx.accounts.protocol.key(),
        economy_config: ctx.accounts.economy_config.key(),
        player_profile: ctx.accounts.player_profile.key(),
        level_milestones: ctx.accounts.level_milestones.key(),
        payer: ctx.accounts.player_funding.key(),
        owner_authority: ctx.accounts.owner_authority.key(),
        session_token: Some(ctx.accounts.session_token.key()),
        actor: ctx.accounts.actor.key(),
        system_program: ctx.accounts.system_program.key(),
    };
    let instruction = Instruction {
        program_id: crate::ID,
        accounts: accounts.to_account_metas(None),
        data: crate::instruction::ClaimLevelMilestone { milestone_index }.data(),
    };
    let infos = [
        ctx.accounts.protocol.to_account_info(),
        ctx.accounts.economy_config.to_account_info(),
        ctx.accounts.player_profile.to_account_info(),
        ctx.accounts.level_milestones.to_account_info(),
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
