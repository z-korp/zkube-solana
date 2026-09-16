use anchor_lang::prelude::*;

use crate::error::ErrorCode;
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
