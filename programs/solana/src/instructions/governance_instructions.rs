use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::v2::{ProtocolConfig, RewardVault, PROTOCOL_CONFIG_SEED, REWARD_VAULT_SEED};

#[derive(Accounts)]
pub struct SetProtocolPause<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized
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
        has_one = authority @ ErrorCode::Unauthorized
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
        constraint = protocol.pending_authority == pending_authority.key() @ ErrorCode::Unauthorized
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
        has_one = authority @ ErrorCode::Unauthorized
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
pub struct UpdateRevenueDestinations<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    /// CHECK: Native-SOL destination; address is written into protocol state.
    pub team_destination: UncheckedAccount<'info>,
    /// CHECK: Native-SOL destination; address is written into protocol state.
    pub treasury_destination: UncheckedAccount<'info>,
    #[account(
        address = protocol.reward_vault,
        seeds = [REWARD_VAULT_SEED],
        bump = reward_vault.bump,
        constraint = reward_vault.protocol == protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub reward_vault: Box<Account<'info, RewardVault>>,
    pub authority: Signer<'info>,
}

pub fn handler_update_revenue_destinations(ctx: Context<UpdateRevenueDestinations>) -> Result<()> {
    let team_destination = ctx.accounts.team_destination.key();
    let treasury_destination = ctx.accounts.treasury_destination.key();
    require_keys_neq!(
        team_destination,
        treasury_destination,
        ErrorCode::InvalidOwner
    );
    require_keys_neq!(
        team_destination,
        ctx.accounts.protocol.reward_vault,
        ErrorCode::InvalidOwner
    );
    require_keys_neq!(
        treasury_destination,
        ctx.accounts.protocol.reward_vault,
        ErrorCode::InvalidOwner
    );
    let previous_team_destination = ctx.accounts.protocol.team_destination;
    let previous_treasury_destination = ctx.accounts.protocol.treasury_destination;
    ctx.accounts.protocol.team_destination = team_destination;
    ctx.accounts.protocol.treasury_destination = treasury_destination;
    emit!(RevenueDestinationsChanged {
        previous_team_destination,
        previous_treasury_destination,
        team_destination,
        treasury_destination,
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
pub struct RevenueDestinationsChanged {
    pub previous_team_destination: Pubkey,
    pub previous_treasury_destination: Pubkey,
    pub team_destination: Pubkey,
    pub treasury_destination: Pubkey,
}
