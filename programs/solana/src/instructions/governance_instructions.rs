use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::error::ErrorCode;
use crate::state::v2::{ProtocolConfig, PROTOCOL_CONFIG_SEED};

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
    #[account(address = protocol.payment_mint)]
    pub payment_mint: Box<Account<'info, Mint>>,
    #[account(
        token::mint = payment_mint,
        constraint = team_destination.owner != protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub team_destination: Box<Account<'info, TokenAccount>>,
    #[account(
        token::mint = payment_mint,
        constraint = treasury_destination.owner != protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub treasury_destination: Box<Account<'info, TokenAccount>>,
    #[account(
        address = protocol.reward_vault,
        token::mint = payment_mint,
        token::authority = protocol,
    )]
    pub reward_vault: Box<Account<'info, TokenAccount>>,
    #[account(address = protocol.payment_token_program)]
    pub token_program: Program<'info, Token>,
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
