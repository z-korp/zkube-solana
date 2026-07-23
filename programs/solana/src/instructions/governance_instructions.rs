use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::instructions::content_instructions::validate_team_destination;
use crate::state::arcade::{
    ArcadeConfig, ARCADE_CONFIG_SEED, ARENA_ENTRY_LAMPORTS, ENTRY_DAILY_LAMPORTS,
    ENTRY_OPERATOR_LAMPORTS, ENTRY_SEASON_LAMPORTS, ENTRY_WEEKLY_LAMPORTS,
};
use crate::state::protocol::{
    ProtocolConfig, ACCOUNT_VERSION, LEGACY_PLAYER_FUNDING_TARGET_LAMPORTS,
    PLAYER_FUNDING_TARGET_LAMPORTS, PROTOCOL_CONFIG_SEED,
};

#[derive(Accounts)]
pub struct SetProtocolPause<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    pub authority: Signer<'info>,
}

pub fn handler_set_protocol_pause(ctx: Context<SetProtocolPause>, paused: bool) -> Result<()> {
    require!(
        ctx.accounts.protocol.paused != paused,
        ErrorCode::InvalidState
    );
    ctx.accounts.protocol.paused = paused;
    emit!(ProtocolPauseChanged {
        authority: ctx.accounts.authority.key(),
        paused,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ProposeProtocolAuthority<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    pub authority: Signer<'info>,
}

pub fn handler_propose_protocol_authority(
    ctx: Context<ProposeProtocolAuthority>,
    pending_authority: Pubkey,
) -> Result<()> {
    require_keys_neq!(
        pending_authority,
        Pubkey::default(),
        ErrorCode::InvalidOwner
    );
    require_keys_neq!(
        pending_authority,
        ctx.accounts.protocol.authority,
        ErrorCode::InvalidOwner
    );
    ctx.accounts.protocol.pending_authority = pending_authority;
    emit!(ProtocolAuthorityProposed {
        authority: ctx.accounts.authority.key(),
        pending_authority,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptProtocolAuthority<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.pending_authority == pending_authority.key() @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    pub pending_authority: Signer<'info>,
}

pub fn handler_accept_protocol_authority(ctx: Context<AcceptProtocolAuthority>) -> Result<()> {
    let previous_authority = ctx.accounts.protocol.authority;
    ctx.accounts.protocol.authority = ctx.accounts.pending_authority.key();
    ctx.accounts.protocol.pending_authority = Pubkey::default();
    emit!(ProtocolAuthorityAccepted {
        previous_authority,
        authority: ctx.accounts.pending_authority.key(),
    });
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateTeamDestination<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    /// CHECK: Native-SOL destination validated before writing protocol state.
    #[account(
        owner = system_program::ID @ ErrorCode::InvalidOwner,
        constraint = team_destination.data_is_empty() @ ErrorCode::InvalidOwner
    )]
    pub team_destination: UncheckedAccount<'info>,
    pub authority: Signer<'info>,
}

pub fn handler_update_team_destination(ctx: Context<UpdateTeamDestination>) -> Result<()> {
    let team_destination = ctx.accounts.team_destination.key();
    validate_team_destination(team_destination)?;
    let previous_team_destination = ctx.accounts.protocol.team_destination;
    ctx.accounts.protocol.team_destination = team_destination;
    emit!(TeamDestinationChanged {
        previous_team_destination,
        team_destination,
    });
    Ok(())
}

/// One-way Devnet v3 activation. The instruction accepts no economic
/// parameters: it verifies the exact legacy terms and writes only the audited
/// canonical run-slot funding target and 0.01 SOL split.
#[derive(Accounts)]
pub struct ActivateRunSlotsV3<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [ARCADE_CONFIG_SEED],
        bump = arcade_config.bump,
        constraint = arcade_config.protocol == protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    pub authority: Signer<'info>,
}

pub fn handler_activate_run_slots_v3(ctx: Context<ActivateRunSlotsV3>) -> Result<()> {
    require!(
        ctx.accounts.protocol.player_funding_target_lamports
            == LEGACY_PLAYER_FUNDING_TARGET_LAMPORTS
            && ctx.accounts.arcade_config.has_legacy_terms(),
        ErrorCode::InvalidState
    );
    ctx.accounts.protocol.player_funding_target_lamports = PLAYER_FUNDING_TARGET_LAMPORTS;
    ctx.accounts.arcade_config.activate_current_terms();
    emit!(RunSlotsV3Activated {
        authority: ctx.accounts.authority.key(),
        player_funding_target_lamports: PLAYER_FUNDING_TARGET_LAMPORTS,
        entry_lamports: ARENA_ENTRY_LAMPORTS,
        daily_lamports: ENTRY_DAILY_LAMPORTS,
        weekly_lamports: ENTRY_WEEKLY_LAMPORTS,
        season_lamports: ENTRY_SEASON_LAMPORTS,
        operator_lamports: ENTRY_OPERATOR_LAMPORTS,
    });
    Ok(())
}

#[event]
pub struct ProtocolPauseChanged {
    pub authority: Pubkey,
    pub paused: bool,
}

#[event]
pub struct ProtocolAuthorityProposed {
    pub authority: Pubkey,
    pub pending_authority: Pubkey,
}

#[event]
pub struct ProtocolAuthorityAccepted {
    pub previous_authority: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct TeamDestinationChanged {
    pub previous_team_destination: Pubkey,
    pub team_destination: Pubkey,
}

#[event]
pub struct RunSlotsV3Activated {
    pub authority: Pubkey,
    pub player_funding_target_lamports: u64,
    pub entry_lamports: u64,
    pub daily_lamports: u64,
    pub weekly_lamports: u64,
    pub season_lamports: u64,
    pub operator_lamports: u64,
}
