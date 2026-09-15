//! Protocol and durable player initialization.

use anchor_lang::prelude::*;
use anchor_lang::system_program as anchor_system_program;
use session_keys::SessionTokenV2;

use crate::error::ErrorCode;
use crate::instructions::player_authorization::{
    require_player_authorization, require_player_rent_payer,
};
use crate::state::protocol::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeProtocolArgs {
    pub team_destination: Pubkey,
    pub replay_domain: [u8; 32],
}

#[derive(Accounts)]
#[instruction(args: InitializeProtocolArgs)]
pub struct InitializeProtocol<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + ProtocolConfig::INIT_SPACE,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    /// CHECK: Native-SOL team recipient pinned in protocol state.
    #[account(
        address = args.team_destination,
        owner = anchor_system_program::ID @ ErrorCode::InvalidOwner,
        constraint = team_destination.data_is_empty() @ ErrorCode::InvalidOwner
    )]
    pub team_destination: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_initialize_protocol(
    ctx: Context<InitializeProtocol>,
    args: InitializeProtocolArgs,
) -> Result<()> {
    require!(args.replay_domain != [0; 32], ErrorCode::InvalidState);
    validate_team_destination(args.team_destination)?;
    let protocol = &mut ctx.accounts.protocol;
    protocol.version = ACCOUNT_VERSION;
    protocol.authority = ctx.accounts.authority.key();
    protocol.pending_authority = Pubkey::default();
    protocol.team_destination = args.team_destination;
    protocol.replay_domain = args.replay_domain;
    // A fresh deployment must remain inert until Arena rules, funding,
    // keeper policy, and clients have all been verified as one release.
    protocol.paused = true;
    protocol.bump = ctx.bumps.protocol;
    Ok(())
}

pub(crate) fn validate_team_destination(destination: Pubkey) -> Result<()> {
    require_keys_neq!(destination, Pubkey::default(), ErrorCode::InvalidOwner);
    Ok(())
}

#[derive(Accounts)]
pub struct InitializePlayer<'info> {
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + PlayerState::INIT_SPACE,
        seeds = [PLAYER_STATE_SEED, owner_authority.key().as_ref()],
        bump
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Immutable durable player identity used for the player PDAs.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_initialize_player(ctx: Context<InitializePlayer>) -> Result<()> {
    let owner = ctx.accounts.owner_authority.key();
    require_player_authorization(
        owner,
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    require_player_rent_payer(owner, ctx.accounts.actor.key(), ctx.accounts.payer.key())?;
    let player = &mut ctx.accounts.player_state;
    if player.version == 0 {
        player.set_inner(PlayerState::initialize(owner, ctx.bumps.player_state));
    } else {
        require!(
            player.owner == owner && player.schema_valid(),
            ErrorCode::InvalidVersion
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn team_destination_must_be_nonzero() {
        assert!(validate_team_destination(Pubkey::default()).is_err());
        assert!(validate_team_destination(Pubkey::new_unique()).is_ok());
    }
}
