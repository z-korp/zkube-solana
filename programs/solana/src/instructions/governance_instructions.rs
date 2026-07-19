use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::instructions::content_instructions::validate_team_destination;
use crate::state::protocol::{ProtocolConfig, ACCOUNT_VERSION, PROTOCOL_CONFIG_SEED};

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
pub struct SetPricingOperator<'info> {
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

pub fn handler_set_pricing_operator(
    ctx: Context<SetPricingOperator>,
    pricing_operator: Pubkey,
) -> Result<()> {
    require_keys_neq!(pricing_operator, Pubkey::default(), ErrorCode::InvalidOwner);
    let previous_operator = ctx.accounts.protocol.pricing_operator;
    require_keys_neq!(pricing_operator, previous_operator, ErrorCode::InvalidOwner);
    ctx.accounts.protocol.pricing_operator = pricing_operator;
    emit!(PricingOperatorChanged {
        previous_operator,
        pricing_operator,
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
pub struct PricingOperatorChanged {
    pub previous_operator: Pubkey,
    pub pricing_operator: Pubkey,
}

#[event]
pub struct TeamDestinationChanged {
    pub previous_team_destination: Pubkey,
    pub team_destination: Pubkey,
}
