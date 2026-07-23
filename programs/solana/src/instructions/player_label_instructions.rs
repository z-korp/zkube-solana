//! Session-authorized cosmetic labels for wallet-address player identities.

use anchor_lang::prelude::*;
use session_keys::SessionTokenV2;

use crate::error::ErrorCode;
use crate::instructions::player_authorization::{
    require_player_authorization, require_player_rent_payer,
};
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PlayerLabelArgs {
    pub display: String,
}

#[derive(Clone, Copy)]
struct ValidatedPlayerLabel {
    display: [u8; PLAYER_LABEL_MAX_LEN],
    len: u8,
}

#[derive(Accounts)]
pub struct CreatePlayerLabel<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [PLAYER_STATE_SEED, owner_authority.key().as_ref()],
        bump = player_state.bump,
        constraint = player_state.version_supported() @ ErrorCode::InvalidVersion,
        constraint = player_state.owner == owner_authority.key() @ ErrorCode::Unauthorized
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(
        init,
        payer = payer,
        space = 8 + PlayerLabel::INIT_SPACE,
        seeds = [PLAYER_LABEL_SEED, owner_authority.key().as_ref()],
        bump
    )]
    pub player_label: Box<Account<'info, PlayerLabel>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Immutable durable player identity constrained by the player PDAs.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_create_player_label(
    ctx: Context<CreatePlayerLabel>,
    args: PlayerLabelArgs,
) -> Result<()> {
    let owner = ctx.accounts.owner_authority.key();
    require_player_authorization(
        owner,
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    require_player_rent_payer(owner, ctx.accounts.actor.key(), ctx.accounts.payer.key())?;
    let value = validate_player_label(&args.display)?;
    ctx.accounts.player_label.set_inner(PlayerLabel {
        version: PLAYER_LABEL_ACCOUNT_VERSION,
        owner,
        display_name: value.display,
        name_len: value.len,
        bump: ctx.bumps.player_label,
    });
    emit!(PlayerLabelSet {
        owner,
        player_label: ctx.accounts.player_label.key(),
        display: args.display,
        created: true,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetPlayerLabel<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [PLAYER_STATE_SEED, owner_authority.key().as_ref()],
        bump = player_state.bump,
        constraint = player_state.version_supported() @ ErrorCode::InvalidVersion,
        constraint = player_state.owner == owner_authority.key() @ ErrorCode::Unauthorized
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(
        mut,
        seeds = [PLAYER_LABEL_SEED, owner_authority.key().as_ref()],
        bump = player_label.bump,
        constraint = player_label.version == PLAYER_LABEL_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = player_label.owner == owner_authority.key() @ ErrorCode::Unauthorized
    )]
    pub player_label: Box<Account<'info, PlayerLabel>>,
    /// CHECK: Immutable durable player identity constrained by the player PDAs.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
}

pub fn handler_set_player_label(ctx: Context<SetPlayerLabel>, args: PlayerLabelArgs) -> Result<()> {
    let owner = ctx.accounts.owner_authority.key();
    require_player_authorization(
        owner,
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    let value = validate_player_label(&args.display)?;
    ctx.accounts.player_label.display_name = value.display;
    ctx.accounts.player_label.name_len = value.len;
    emit!(PlayerLabelSet {
        owner,
        player_label: ctx.accounts.player_label.key(),
        display: args.display,
        created: false,
    });
    Ok(())
}

fn validate_player_label(display: &str) -> Result<ValidatedPlayerLabel> {
    let bytes = display.as_bytes();
    require!(
        (PLAYER_LABEL_MIN_LEN..=PLAYER_LABEL_MAX_LEN).contains(&bytes.len()),
        ErrorCode::InvalidPlayerLabel
    );
    require!(
        bytes[0].is_ascii_alphabetic(),
        ErrorCode::InvalidPlayerLabel
    );
    let mut fixed = [0u8; PLAYER_LABEL_MAX_LEN];
    for (index, byte) in bytes.iter().copied().enumerate() {
        require!(
            byte.is_ascii_alphanumeric() || byte == b'_',
            ErrorCode::InvalidPlayerLabel
        );
        fixed[index] = byte;
    }
    Ok(ValidatedPlayerLabel {
        display: fixed,
        len: u8::try_from(bytes.len()).map_err(|_| ErrorCode::InvalidPlayerLabel)?,
    })
}

#[event]
pub struct PlayerLabelSet {
    pub owner: Pubkey,
    pub player_label: Pubkey,
    pub display: String,
    pub created: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_validation_is_case_preserving_and_bounded() {
        let value = validate_player_label("Wave_Rider7").unwrap();
        assert_eq!(&value.display[..11], b"Wave_Rider7");
        assert!(validate_player_label("ab").is_err());
        assert!(validate_player_label("7waves").is_err());
        assert!(validate_player_label("wave-rider").is_err());
        assert!(validate_player_label("tiki🐢").is_err());
    }
}
