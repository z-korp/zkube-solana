use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::{ProtocolConfig, ACCOUNT_VERSION, PROTOCOL_CONFIG_SEED};

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
    ctx.accounts.protocol.paused = paused;
    Ok(())
}

#[derive(Accounts)]
pub struct SetArenaSuspension<'info> {
    #[account(mut, seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,

    pub authority: Signer<'info>,
}

pub fn handler_set_arena_suspension(
    ctx: Context<SetArenaSuspension>,
    suspended_until_day: u32,
) -> Result<()> {
    ctx.accounts.protocol.suspended_until_day = suspended_until_day;
    Ok(())
}
