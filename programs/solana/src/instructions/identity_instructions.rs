//! Owner-controlled public usernames and constrained authority moderation.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UsernameArgs {
    pub display: String,
    pub normalized: String,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RenameUsernameArgs {
    pub old_normalized: String,
    pub display: String,
    pub normalized: String,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ModerateUsernameArgs {
    pub normalized: String,
    pub reason_code: u8,
}

#[derive(Clone, Copy)]
struct ValidatedUsername {
    display: [u8; USERNAME_MAX_LEN],
    normalized: [u8; USERNAME_MAX_LEN],
    len: u8,
}

#[derive(Accounts)]
#[instruction(args: UsernameArgs)]
pub struct RegisterUsername<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [PLAYER_STATE_SEED, owner.key().as_ref()],
        bump = player_state.bump,
        constraint = player_state.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = player_state.owner == owner.key() @ ErrorCode::Unauthorized
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(
        init,
        payer = owner,
        space = 8 + PlayerIdentity::INIT_SPACE,
        seeds = [PLAYER_IDENTITY_SEED, owner.key().as_ref()],
        bump
    )]
    pub player_identity: Box<Account<'info, PlayerIdentity>>,
    #[account(
        init,
        payer = owner,
        space = 8 + UsernameClaim::INIT_SPACE,
        seeds = [USERNAME_CLAIM_SEED, args.normalized.as_bytes()],
        bump
    )]
    pub username_claim: Box<Account<'info, UsernameClaim>>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_register_username(ctx: Context<RegisterUsername>, args: UsernameArgs) -> Result<()> {
    let value = validate_username(&args.display, &args.normalized)?;
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.player_identity.set_inner(PlayerIdentity {
        version: IDENTITY_ACCOUNT_VERSION,
        owner: ctx.accounts.owner.key(),
        display_name: value.display,
        normalized_name: value.normalized,
        name_len: value.len,
        rename_count: 0,
        registered_at: now,
        last_renamed_at: now,
        moderated: false,
        moderation_reason: 0,
        bump: ctx.bumps.player_identity,
    });
    ctx.accounts.username_claim.set_inner(UsernameClaim {
        version: IDENTITY_ACCOUNT_VERSION,
        owner: ctx.accounts.owner.key(),
        player_identity: ctx.accounts.player_identity.key(),
        normalized_name: value.normalized,
        name_len: value.len,
        status: USERNAME_STATUS_ACTIVE,
        bump: ctx.bumps.username_claim,
    });
    emit!(UsernameRegistered {
        owner: ctx.accounts.owner.key(),
        player_identity: ctx.accounts.player_identity.key(),
        normalized: args.normalized,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(args: RenameUsernameArgs)]
pub struct RenameUsername<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, owner.key().as_ref()],
        bump = player_state.bump,
        constraint = player_state.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = player_state.owner == owner.key() @ ErrorCode::Unauthorized
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(
        mut,
        seeds = [PLAYER_IDENTITY_SEED, owner.key().as_ref()],
        bump = player_identity.bump,
        constraint = player_identity.version == IDENTITY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = player_identity.owner == owner.key() @ ErrorCode::Unauthorized
    )]
    pub player_identity: Box<Account<'info, PlayerIdentity>>,
    #[account(
        mut,
        close = owner,
        seeds = [USERNAME_CLAIM_SEED, args.old_normalized.as_bytes()],
        bump = old_username_claim.bump,
        constraint = old_username_claim.version == IDENTITY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = old_username_claim.owner == owner.key() @ ErrorCode::Unauthorized,
        constraint = old_username_claim.player_identity == player_identity.key() @ ErrorCode::InvalidOwner,
        constraint = old_username_claim.status == USERNAME_STATUS_ACTIVE @ ErrorCode::UsernameBlocked
    )]
    pub old_username_claim: Box<Account<'info, UsernameClaim>>,
    #[account(
        init,
        payer = owner,
        space = 8 + UsernameClaim::INIT_SPACE,
        seeds = [USERNAME_CLAIM_SEED, args.normalized.as_bytes()],
        bump
    )]
    pub new_username_claim: Box<Account<'info, UsernameClaim>>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_rename_username(
    ctx: Context<RenameUsername>,
    args: RenameUsernameArgs,
) -> Result<()> {
    let value = validate_username(&args.display, &args.normalized)?;
    require_identity_name(&ctx.accounts.player_identity, &args.old_normalized)?;
    require!(
        ctx.accounts.old_username_claim.normalized() == Some(args.old_normalized.as_bytes()),
        ErrorCode::InvalidUsername
    );
    require!(
        ctx.accounts.player_identity.normalized()
            != Some(&value.normalized[..usize::from(value.len)]),
        ErrorCode::InvalidUsername
    );
    let now = Clock::get()?.unix_timestamp;
    let stars_charged = if username_rename_charge(ctx.accounts.player_identity.rename_count) == 0 {
        0
    } else {
        let eligible_at = ctx
            .accounts
            .player_identity
            .last_renamed_at
            .checked_add(USERNAME_RENAME_COOLDOWN_SECONDS)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        require!(now >= eligible_at, ErrorCode::UsernameRenameCooldown);
        ctx.accounts
            .player_state
            .spend_stars(USERNAME_RENAME_STARS)?;
        USERNAME_RENAME_STARS
    };
    ctx.accounts.player_identity.rename_count = ctx
        .accounts
        .player_identity
        .rename_count
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    ctx.accounts.player_identity.last_renamed_at = now;
    set_identity_name(&mut ctx.accounts.player_identity, value);
    ctx.accounts.new_username_claim.set_inner(UsernameClaim {
        version: IDENTITY_ACCOUNT_VERSION,
        owner: ctx.accounts.owner.key(),
        player_identity: ctx.accounts.player_identity.key(),
        normalized_name: value.normalized,
        name_len: value.len,
        status: USERNAME_STATUS_ACTIVE,
        bump: ctx.bumps.new_username_claim,
    });
    emit!(UsernameRenamed {
        owner: ctx.accounts.owner.key(),
        player_identity: ctx.accounts.player_identity.key(),
        normalized: args.normalized,
        stars_charged,
        moderated_replacement: false,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(args: RenameUsernameArgs)]
pub struct ReplaceModeratedUsername<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [PLAYER_STATE_SEED, owner.key().as_ref()],
        bump = player_state.bump,
        constraint = player_state.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = player_state.owner == owner.key() @ ErrorCode::Unauthorized
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(
        mut,
        seeds = [PLAYER_IDENTITY_SEED, owner.key().as_ref()],
        bump = player_identity.bump,
        constraint = player_identity.version == IDENTITY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = player_identity.owner == owner.key() @ ErrorCode::Unauthorized,
        constraint = player_identity.moderated @ ErrorCode::InvalidState
    )]
    pub player_identity: Box<Account<'info, PlayerIdentity>>,
    #[account(
        seeds = [USERNAME_CLAIM_SEED, args.old_normalized.as_bytes()],
        bump = blocked_username_claim.bump,
        constraint = blocked_username_claim.version == IDENTITY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = blocked_username_claim.owner == owner.key() @ ErrorCode::Unauthorized,
        constraint = blocked_username_claim.player_identity == player_identity.key() @ ErrorCode::InvalidOwner,
        constraint = blocked_username_claim.status == USERNAME_STATUS_BLOCKED @ ErrorCode::InvalidState
    )]
    pub blocked_username_claim: Box<Account<'info, UsernameClaim>>,
    #[account(
        init,
        payer = owner,
        space = 8 + UsernameClaim::INIT_SPACE,
        seeds = [USERNAME_CLAIM_SEED, args.normalized.as_bytes()],
        bump
    )]
    pub new_username_claim: Box<Account<'info, UsernameClaim>>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_replace_moderated_username(
    ctx: Context<ReplaceModeratedUsername>,
    args: RenameUsernameArgs,
) -> Result<()> {
    let value = validate_username(&args.display, &args.normalized)?;
    require_identity_name(&ctx.accounts.player_identity, &args.old_normalized)?;
    let now = Clock::get()?.unix_timestamp;
    set_identity_name(&mut ctx.accounts.player_identity, value);
    ctx.accounts.player_identity.last_renamed_at = now;
    ctx.accounts.new_username_claim.set_inner(UsernameClaim {
        version: IDENTITY_ACCOUNT_VERSION,
        owner: ctx.accounts.owner.key(),
        player_identity: ctx.accounts.player_identity.key(),
        normalized_name: value.normalized,
        name_len: value.len,
        status: USERNAME_STATUS_ACTIVE,
        bump: ctx.bumps.new_username_claim,
    });
    emit!(UsernameRenamed {
        owner: ctx.accounts.owner.key(),
        player_identity: ctx.accounts.player_identity.key(),
        normalized: args.normalized,
        stars_charged: 0,
        moderated_replacement: true,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(args: ModerateUsernameArgs)]
pub struct ModerateUsername<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [PLAYER_IDENTITY_SEED, player_identity.owner.as_ref()],
        bump = player_identity.bump,
        constraint = player_identity.version == IDENTITY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub player_identity: Box<Account<'info, PlayerIdentity>>,
    #[account(
        mut,
        seeds = [USERNAME_CLAIM_SEED, args.normalized.as_bytes()],
        bump = username_claim.bump,
        constraint = username_claim.version == IDENTITY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = username_claim.owner == player_identity.owner @ ErrorCode::InvalidOwner,
        constraint = username_claim.player_identity == player_identity.key() @ ErrorCode::InvalidOwner,
        constraint = username_claim.status == USERNAME_STATUS_ACTIVE @ ErrorCode::InvalidState
    )]
    pub username_claim: Box<Account<'info, UsernameClaim>>,
    pub authority: Signer<'info>,
}

pub fn handler_moderate_username(
    ctx: Context<ModerateUsername>,
    args: ModerateUsernameArgs,
) -> Result<()> {
    require_identity_name(&ctx.accounts.player_identity, &args.normalized)?;
    ctx.accounts.username_claim.status = USERNAME_STATUS_BLOCKED;
    ctx.accounts.player_identity.moderated = true;
    ctx.accounts.player_identity.moderation_reason = args.reason_code;
    emit!(UsernameModerated {
        owner: ctx.accounts.player_identity.owner,
        player_identity: ctx.accounts.player_identity.key(),
        normalized: args.normalized,
        reason_code: args.reason_code,
        blocked: true,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(normalized: String)]
pub struct RestoreUsername<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [PLAYER_IDENTITY_SEED, player_identity.owner.as_ref()],
        bump = player_identity.bump,
        constraint = player_identity.version == IDENTITY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = player_identity.moderated @ ErrorCode::InvalidState
    )]
    pub player_identity: Box<Account<'info, PlayerIdentity>>,
    #[account(
        mut,
        seeds = [USERNAME_CLAIM_SEED, normalized.as_bytes()],
        bump = username_claim.bump,
        constraint = username_claim.version == IDENTITY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = username_claim.owner == player_identity.owner @ ErrorCode::InvalidOwner,
        constraint = username_claim.player_identity == player_identity.key() @ ErrorCode::InvalidOwner,
        constraint = username_claim.status == USERNAME_STATUS_BLOCKED @ ErrorCode::InvalidState
    )]
    pub username_claim: Box<Account<'info, UsernameClaim>>,
    pub authority: Signer<'info>,
}

pub fn handler_restore_username(ctx: Context<RestoreUsername>, normalized: String) -> Result<()> {
    require_identity_name(&ctx.accounts.player_identity, &normalized)?;
    ctx.accounts.username_claim.status = USERNAME_STATUS_ACTIVE;
    ctx.accounts.player_identity.moderated = false;
    ctx.accounts.player_identity.moderation_reason = 0;
    emit!(UsernameModerated {
        owner: ctx.accounts.player_identity.owner,
        player_identity: ctx.accounts.player_identity.key(),
        normalized,
        reason_code: 0,
        blocked: false,
    });
    Ok(())
}

fn validate_username(display: &str, normalized: &str) -> Result<ValidatedUsername> {
    let display_bytes = display.as_bytes();
    let normalized_bytes = normalized.as_bytes();
    require!(
        (USERNAME_MIN_LEN..=USERNAME_MAX_LEN).contains(&display_bytes.len()),
        ErrorCode::InvalidUsername
    );
    require!(
        display_bytes.len() == normalized_bytes.len(),
        ErrorCode::InvalidUsername
    );
    require!(
        display_bytes[0].is_ascii_alphabetic(),
        ErrorCode::InvalidUsername
    );
    let mut display_fixed = [0u8; USERNAME_MAX_LEN];
    let mut normalized_fixed = [0u8; USERNAME_MAX_LEN];
    for (index, byte) in display_bytes.iter().copied().enumerate() {
        require!(
            byte.is_ascii_alphanumeric() || byte == b'_',
            ErrorCode::InvalidUsername
        );
        let expected = byte.to_ascii_lowercase();
        require!(
            normalized_bytes[index] == expected,
            ErrorCode::InvalidUsername
        );
        display_fixed[index] = byte;
        normalized_fixed[index] = expected;
    }
    Ok(ValidatedUsername {
        display: display_fixed,
        normalized: normalized_fixed,
        len: u8::try_from(display_bytes.len()).map_err(|_| ErrorCode::InvalidUsername)?,
    })
}

fn require_identity_name(identity: &PlayerIdentity, normalized: &str) -> Result<()> {
    require!(
        identity.normalized() == Some(normalized.as_bytes()),
        ErrorCode::InvalidUsername
    );
    Ok(())
}

fn set_identity_name(identity: &mut PlayerIdentity, value: ValidatedUsername) {
    identity.display_name = value.display;
    identity.normalized_name = value.normalized;
    identity.name_len = value.len;
    identity.moderated = false;
    identity.moderation_reason = 0;
}

fn username_rename_charge(rename_count: u16) -> u64 {
    if rename_count == 0 {
        0
    } else {
        USERNAME_RENAME_STARS
    }
}

#[event]
pub struct UsernameRegistered {
    pub owner: Pubkey,
    pub player_identity: Pubkey,
    pub normalized: String,
}

#[event]
pub struct UsernameRenamed {
    pub owner: Pubkey,
    pub player_identity: Pubkey,
    pub normalized: String,
    pub stars_charged: u64,
    pub moderated_replacement: bool,
}

#[event]
pub struct UsernameModerated {
    pub owner: Pubkey,
    pub player_identity: Pubkey,
    pub normalized: String,
    pub reason_code: u8,
    pub blocked: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn username_validation_is_ascii_casefolded_and_bounded() {
        let value = validate_username("Wave_Rider7", "wave_rider7").unwrap();
        assert_eq!(&value.display[..11], b"Wave_Rider7");
        assert_eq!(&value.normalized[..11], b"wave_rider7");
        assert!(validate_username("ab", "ab").is_err());
        assert!(validate_username("7waves", "7waves").is_err());
        assert!(validate_username("wave-rider", "wave-rider").is_err());
        assert!(validate_username("Wave", "Wave").is_err());
        assert!(validate_username("tiki🐢", "tiki🐢").is_err());
    }

    #[test]
    fn first_rename_is_free_and_later_renames_cost_stars() {
        assert_eq!(username_rename_charge(0), 0);
        assert_eq!(username_rename_charge(1), USERNAME_RENAME_STARS);
        assert_eq!(username_rename_charge(u16::MAX), USERNAME_RENAME_STARS);
    }
}
