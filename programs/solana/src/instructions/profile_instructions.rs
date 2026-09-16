//! Owner- or device-authorized cosmetic profile records.

use anchor_lang::prelude::*;
use session_keys::SessionTokenV2;

use crate::error::ErrorCode;
use crate::instructions::player_authorization::require_player_authorization;
use crate::state::*;

#[derive(Accounts)]
pub struct SetFeaturedEmblem<'info> {
    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, owner_authority.key().as_ref()],
        bump = player_state.bump,
        constraint = player_state.schema_valid() @ ErrorCode::InvalidVersion,
        constraint = player_state.owner == owner_authority.key() @ ErrorCode::Unauthorized
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
    /// CHECK: Immutable wallet identity constrained by the PlayerState PDA.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
}

/// Merge self-attested cosmetic Campaign stars. The program cannot verify play.
/// Each level keeps its maximum without requiring progression order or a new
/// result. No other player field changes, including the worn emblem.
pub fn handler_record_campaign_stars(
    ctx: Context<SetFeaturedEmblem>,
    stars: [u8; CAMPAIGN_STAR_BYTES],
) -> Result<()> {
    require_player_authorization(
        ctx.accounts.owner_authority.key(),
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    ctx.accounts.player_state.merge_campaign_stars(stars);
    Ok(())
}

/// Set the worn identity: the emblem, and the ladder border framing it.
///
/// Both in one instruction because they are one decision — what the player
/// looks like on a board — and splitting them would double the signatures for
/// a change to a single avatar.
pub fn handler_set_featured_emblem(
    ctx: Context<SetFeaturedEmblem>,
    emblem_id: u8,
    frame_tier: u8,
) -> Result<()> {
    require_player_authorization(
        ctx.accounts.owner_authority.key(),
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    require!(
        ctx.accounts.player_state.emblem_unlocked(emblem_id),
        ErrorCode::InvalidEmblem
    );
    // Any rank ever reached stays wearable; nothing above it ever is.
    require!(
        frame_tier <= ctx.accounts.player_state.highest_ladder_tier,
        ErrorCode::InvalidEmblem
    );
    ctx.accounts.player_state.featured_emblem = emblem_id;
    ctx.accounts.player_state.featured_frame_tier = frame_tier;
    Ok(())
}
