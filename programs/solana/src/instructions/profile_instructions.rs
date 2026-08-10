//! Session-authorized emblem selection and permissionless competitive profile
//! synchronization. Claim idempotence is independent, so a missing or delayed
//! profile update can never gate, repeat, or redirect money.

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

pub fn handler_set_featured_emblem(ctx: Context<SetFeaturedEmblem>, emblem_id: u8) -> Result<()> {
    require_player_authorization(
        ctx.accounts.owner_authority.key(),
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    require!(
        ctx.accounts.player_state.emblem_unlocked(emblem_id),
        ErrorCode::InvalidEmblem
    );
    ctx.accounts.player_state.featured_emblem = emblem_id;
    emit!(FeaturedEmblemSet {
        owner: ctx.accounts.player_state.owner,
        emblem_id,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(board: DailyBoardKind)]
pub struct SyncDailyProfile<'info> {
    pub caller: Signer<'info>,
    #[account(
        mut,
        seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()],
        bump = arena_daily.bump,
        constraint = arena_daily.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.status == PeriodStatus::Finalized @ ErrorCode::InvalidState
    )]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(
        mut,
        seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), board.seed()],
        bump = arena_board.bump,
        constraint = arena_board.arena_daily == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = arena_board.kind == board @ ErrorCode::InvalidOwner
    )]
    pub arena_board: Box<Account<'info, ArenaBoard>>,
    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, player_state.owner.as_ref()],
        bump = player_state.bump,
        constraint = player_state.schema_valid() @ ErrorCode::InvalidVersion
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
}

pub fn handler_sync_daily_profile(
    ctx: Context<SyncDailyProfile>,
    board: DailyBoardKind,
) -> Result<()> {
    let board_info = ctx.accounts.arena_board.to_account_info();
    validate_finalized_board(
        &ctx.accounts.arena_daily,
        ctx.accounts.arena_daily.key(),
        &ctx.accounts.arena_board,
        board_info.data_len(),
        board,
    )?;
    let prize = ranked_prize(
        &ctx.accounts.arena_board,
        &board_info,
        ctx.accounts.player_state.owner,
    )?;
    require!(
        !board_bitmap_is_set(
            &board_info,
            &ctx.accounts.arena_board,
            BoardBitmap::ProfileSynced,
            prize.position,
        )?,
        ErrorCode::AlreadySubmitted
    );
    let base_points = zkube_core::ladder_points(
        ctx.accounts.arena_board.qualified_count,
        u32::from(prize.rank),
    )
    .map_err(|_| error!(ErrorCode::AccountingInvariant))?;
    ctx.accounts
        .player_state
        .daily_record_mut(board)
        .record_prize(prize.rank, prize.amount)?;
    let points = ctx
        .accounts
        .player_state
        .record_ladder_points(base_points)?;
    set_board_bitmap(
        &board_info,
        &ctx.accounts.arena_board,
        BoardBitmap::ProfileSynced,
        prize.position,
    )?;
    ctx.accounts.arena_board.profile_sync_count = ctx
        .accounts
        .arena_board
        .profile_sync_count
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    emit!(CompetitionProfileSynced {
        owner: ctx.accounts.player_state.owner,
        board,
        rank: prize.rank,
        reward_lamports: prize.amount,
        points_earned: points,
        ladder_points: ctx.accounts.player_state.ladder_points,
        highest_ladder_tier: ctx.accounts.player_state.highest_ladder_tier,
    });
    Ok(())
}

#[event]
pub struct FeaturedEmblemSet {
    pub owner: Pubkey,
    pub emblem_id: u8,
}

#[event]
pub struct CompetitionProfileSynced {
    pub owner: Pubkey,
    pub board: DailyBoardKind,
    pub rank: u16,
    pub reward_lamports: u64,
    pub points_earned: u32,
    pub ladder_points: u64,
    pub highest_ladder_tier: u8,
}
