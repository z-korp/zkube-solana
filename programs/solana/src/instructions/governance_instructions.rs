use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::instructions::content_instructions::validate_team_destination;
use crate::state::{
    ArcadeConfig, ProtocolConfig, ACCOUNT_VERSION, ARCADE_CONFIG_SEED, PROTOCOL_CONFIG_SEED,
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
    Ok(())
}

#[derive(Accounts)]
pub struct SetArenaSuspension<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
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

pub fn handler_set_arena_suspension(
    ctx: Context<SetArenaSuspension>,
    suspended_until_day: u32,
) -> Result<()> {
    require!(
        ctx.accounts.arcade_config.suspended_until_day != suspended_until_day,
        ErrorCode::InvalidState
    );
    ctx.accounts.arcade_config.suspended_until_day = suspended_until_day;
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
    ctx.accounts.protocol.authority = ctx.accounts.pending_authority.key();
    ctx.accounts.protocol.pending_authority = Pubkey::default();
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
    ctx.accounts.protocol.team_destination = team_destination;
    Ok(())
}
