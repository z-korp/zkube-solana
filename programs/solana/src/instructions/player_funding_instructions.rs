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
use crate::instructions::player_label_instructions::PlayerLabelArgs;
use crate::state::*;

#[derive(Accounts)]
pub struct FundedCreatePlayerLabel<'info> {
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    pub player_state: Box<Account<'info, PlayerState>>,
    /// CHECK: Canonical PDA and vacancy are checked by the inner instruction.
    #[account(mut)]
    pub player_label: UncheckedAccount<'info>,
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

pub fn handler_funded_create_player_label(
    ctx: Context<FundedCreatePlayerLabel>,
    args: PlayerLabelArgs,
) -> Result<()> {
    let accounts = crate::accounts::CreatePlayerLabel {
        protocol: ctx.accounts.protocol.key(),
        player_state: ctx.accounts.player_state.key(),
        player_label: ctx.accounts.player_label.key(),
        payer: ctx.accounts.player_funding.key(),
        owner_authority: ctx.accounts.owner_authority.key(),
        session_token: Some(ctx.accounts.session_token.key()),
        actor: ctx.accounts.actor.key(),
        system_program: ctx.accounts.system_program.key(),
    };
    let instruction = Instruction {
        program_id: crate::ID,
        accounts: accounts.to_account_metas(None),
        data: crate::instruction::CreatePlayerLabel { args }.data(),
    };
    let infos = [
        ctx.accounts.protocol.to_account_info(),
        ctx.accounts.player_state.to_account_info(),
        ctx.accounts.player_label.to_account_info(),
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
#[instruction(run_id: u64, expected_entry_lamports: u64, auto_claim_positions: Vec<u32>)]
pub struct FundedEnterArena<'info> {
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    /// CHECK: Fully constrained by the inner instruction.
    #[account(mut)]
    pub player_state: UncheckedAccount<'info>,
    /// CHECK: Fully constrained by the inner instruction.
    #[account(mut)]
    pub current_daily: UncheckedAccount<'info>,
    /// CHECK: Initialized or mutated by the inner instruction.
    #[account(mut)]
    pub arena_player: UncheckedAccount<'info>,
    /// CHECK: Fully constrained by the inner instruction.
    #[account(mut)]
    pub following_daily: UncheckedAccount<'info>,
    /// CHECK: Fully constrained by the inner instruction.
    #[account(mut)]
    pub credit_vault: UncheckedAccount<'info>,
    /// CHECK: Initialized by the inner instruction.
    #[account(mut)]
    pub active_run: UncheckedAccount<'info>,
    /// CHECK: Canonical zero-data System PDA validated before self-CPI.
    #[account(mut, seeds = [PLAYER_FUNDING_SEED, owner_authority.key().as_ref()], bump)]
    pub player_funding: UncheckedAccount<'info>,
    /// CHECK: Durable reward destination checked by the inner instruction.
    #[account(mut)]
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Account<'info, SessionTokenV2>,
    pub actor: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub zkube_program: Program<'info, crate::program::Solana>,
}

pub fn handler_funded_enter_arena<'info>(
    ctx: Context<'info, FundedEnterArena<'info>>,
    run_id: u64,
    expected_entry_lamports: u64,
    auto_claim_positions: Vec<u32>,
) -> Result<()> {
    // Check the expected current-day PDA before the inner instruction tries
    // to deserialize it, so a suspended day returns the protocol's typed
    // refusal rather than an incidental missing-account error.
    let day_id = day_id_at(Clock::get()?.unix_timestamp)?;
    let (expected_daily, _) =
        Pubkey::find_program_address(&[ARENA_DAILY_SEED, &day_id.to_le_bytes()], &crate::ID);
    require_keys_eq!(
        ctx.accounts.current_daily.key(),
        expected_daily,
        ErrorCode::InvalidPeriod
    );
    let current_daily_info = ctx.accounts.current_daily.to_account_info();
    if *current_daily_info.owner == system_program::ID && current_daily_info.data_is_empty() {
        return err!(ErrorCode::DailyNotScheduled);
    }
    require_keys_eq!(
        *current_daily_info.owner,
        crate::ID,
        ErrorCode::InvalidOwner
    );
    require!(
        current_daily_info.data_len() == 8 + ArenaDaily::INIT_SPACE,
        ErrorCode::InvalidOwner
    );
    let accounts = crate::accounts::EnterArena {
        protocol: ctx.accounts.protocol.key(),
        arcade_config: ctx.accounts.arcade_config.key(),
        player_state: ctx.accounts.player_state.key(),
        current_daily: ctx.accounts.current_daily.key(),
        arena_player: ctx.accounts.arena_player.key(),
        following_daily: ctx.accounts.following_daily.key(),
        credit_vault: ctx.accounts.credit_vault.key(),
        active_run: ctx.accounts.active_run.key(),
        payer: ctx.accounts.player_funding.key(),
        owner_authority: ctx.accounts.owner_authority.key(),
        session_token: Some(ctx.accounts.session_token.key()),
        actor: ctx.accounts.actor.key(),
        system_program: ctx.accounts.system_program.key(),
        zkube_program: ctx.accounts.zkube_program.key(),
    };
    let mut instruction = Instruction {
        program_id: crate::ID,
        accounts: accounts.to_account_metas(None),
        data: crate::instruction::EnterArena {
            run_id,
            expected_entry_lamports,
            auto_claim_positions,
        }
        .data(),
    };
    instruction
        .accounts
        .extend(ctx.remaining_accounts.iter().map(|account| {
            if account.is_writable {
                AccountMeta::new(*account.key, account.is_signer)
            } else {
                AccountMeta::new_readonly(*account.key, account.is_signer)
            }
        }));
    let mut infos = vec![
        ctx.accounts.protocol.to_account_info(),
        ctx.accounts.arcade_config.to_account_info(),
        ctx.accounts.player_state.to_account_info(),
        ctx.accounts.current_daily.to_account_info(),
        ctx.accounts.arena_player.to_account_info(),
        ctx.accounts.following_daily.to_account_info(),
        ctx.accounts.credit_vault.to_account_info(),
        ctx.accounts.active_run.to_account_info(),
        ctx.accounts.player_funding.to_account_info(),
        ctx.accounts.owner_authority.to_account_info(),
        ctx.accounts.session_token.to_account_info(),
        ctx.accounts.actor.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.zkube_program.to_account_info(),
    ];
    infos.extend_from_slice(ctx.remaining_accounts);
    invoke_with_player_funding(
        ctx.accounts.owner_authority.key(),
        &ctx.accounts.player_funding.to_account_info(),
        ctx.bumps.player_funding,
        instruction,
        &infos,
    )
}
