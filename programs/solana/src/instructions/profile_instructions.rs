//! Session-authorized emblem selection and permissionless post-settlement
//! competitive profile synchronization.
//!
//! Settlement always pushes SOL first. These instructions only derive the
//! already-paid winner position and amount from finalized period state, then
//! update the canonical player profile. A failed or delayed profile sync can
//! therefore never gate money.

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
        constraint = player_state.version_supported() @ ErrorCode::InvalidVersion,
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
        seeds = [PLAYER_STATE_SEED, player_state.owner.as_ref()],
        bump = player_state.bump,
        constraint = player_state.version_supported() @ ErrorCode::InvalidVersion
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
}

pub fn handler_sync_daily_profile(ctx: Context<SyncDailyProfile>) -> Result<()> {
    let players = ctx
        .accounts
        .arena_daily
        .entries
        .iter()
        .map(|entry| entry.player)
        .collect::<Vec<_>>();
    let prize = ranked_prize(
        &players,
        ctx.accounts.player_state.owner,
        ctx.accounts.arena_daily.ledger,
    )?;
    let bit = 1u8
        .checked_shl(u32::from(prize.position))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        ctx.accounts.arena_daily.profile_sync_mask & bit == 0,
        ErrorCode::AlreadySubmitted
    );
    ctx.accounts
        .player_state
        .daily_record
        .record_prize(prize.rank, prize.amount)?;
    ctx.accounts.arena_daily.profile_sync_mask |= bit;
    emit!(CompetitionProfileSynced {
        owner: ctx.accounts.player_state.owner,
        period_kind: 0,
        rank: prize.rank,
        reward_lamports: prize.amount,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SyncWeeklyProfile<'info> {
    pub caller: Signer<'info>,
    #[account(
        mut,
        seeds = [WEEKLY_JACKPOT_SEED, weekly_jackpot.week_id.to_le_bytes().as_ref()],
        bump = weekly_jackpot.bump,
        constraint = weekly_jackpot.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = weekly_jackpot.status == PeriodStatus::Finalized @ ErrorCode::InvalidState
    )]
    pub weekly_jackpot: Box<Account<'info, WeeklyJackpot>>,
    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, player_state.owner.as_ref()],
        bump = player_state.bump,
        constraint = player_state.version_supported() @ ErrorCode::InvalidVersion
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
}

pub fn handler_sync_weekly_profile(ctx: Context<SyncWeeklyProfile>) -> Result<()> {
    let prizes = weekly_prizes_for(
        &ctx.accounts.weekly_jackpot,
        ctx.accounts.player_state.owner,
    )?;
    let mut synced_any = false;
    for prize in prizes.into_iter().flatten() {
        let bit = 1u16
            .checked_shl(u32::from(prize.position))
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        if ctx.accounts.weekly_jackpot.profile_sync_mask & bit != 0 {
            continue;
        }
        ctx.accounts
            .player_state
            .weekly_record
            .record_prize(prize.rank, prize.amount)?;
        ctx.accounts.weekly_jackpot.profile_sync_mask |= bit;
        synced_any = true;
        emit!(CompetitionProfileSynced {
            owner: ctx.accounts.player_state.owner,
            period_kind: 1,
            rank: prize.rank,
            reward_lamports: prize.amount,
        });
    }
    require!(synced_any, ErrorCode::AlreadySubmitted);
    Ok(())
}

#[derive(Accounts)]
pub struct SyncSeasonProfile<'info> {
    pub caller: Signer<'info>,
    #[account(
        mut,
        seeds = [SEASON_SEED, season.season_id.to_le_bytes().as_ref()],
        bump = season.bump,
        constraint = season.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = season.status == PeriodStatus::Finalized @ ErrorCode::InvalidState
    )]
    pub season: Box<Account<'info, Season>>,
    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, player_state.owner.as_ref()],
        bump = player_state.bump,
        constraint = player_state.version_supported() @ ErrorCode::InvalidVersion
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
}

pub fn handler_sync_season_profile(ctx: Context<SyncSeasonProfile>) -> Result<()> {
    let players = ctx
        .accounts
        .season
        .entries
        .iter()
        .map(|entry| entry.player)
        .collect::<Vec<_>>();
    let prize = ranked_prize(
        &players,
        ctx.accounts.player_state.owner,
        ctx.accounts.season.ledger,
    )?;
    let bit = 1u8
        .checked_shl(u32::from(prize.position))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        ctx.accounts.season.profile_sync_mask & bit == 0,
        ErrorCode::AlreadySubmitted
    );
    ctx.accounts
        .player_state
        .season_record
        .record_prize(prize.rank, prize.amount)?;
    ctx.accounts.season.profile_sync_mask |= bit;
    emit!(CompetitionProfileSynced {
        owner: ctx.accounts.player_state.owner,
        period_kind: 2,
        rank: prize.rank,
        reward_lamports: prize.amount,
    });
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SyncedPrize {
    /// Global mask position (Daily/Season 0..4, Weekly 0..8).
    position: u8,
    /// One-based rank within the relevant board.
    rank: u16,
    amount: u64,
}

fn settled_pool(ledger: PoolLedger) -> Result<u64> {
    ledger
        .payout_lamports
        .checked_add(ledger.rollover_out_lamports)
        .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
}

fn ranked_prize(players: &[Pubkey], owner: Pubkey, ledger: PoolLedger) -> Result<SyncedPrize> {
    let pool = settled_pool(ledger)?;
    let winners = players.len().min(DAILY_PRIZE_WEIGHTS.len());
    let plan = rounded_payouts(pool, &DAILY_PRIZE_WEIGHTS, winners)?;
    require!(
        plan.paid_lamports == ledger.payout_lamports
            && plan.rollover_lamports == ledger.rollover_out_lamports,
        ErrorCode::AccountingInvariant
    );
    let position = players[..winners]
        .iter()
        .position(|player| *player == owner)
        .ok_or(ErrorCode::NoPrize)?;
    let amount = plan.amounts[position];
    require!(amount > 0, ErrorCode::NoPrize);
    Ok(SyncedPrize {
        position: u8::try_from(position).map_err(|_| ErrorCode::ArithmeticOverflow)?,
        rank: u16::try_from(position + 1).map_err(|_| ErrorCode::ArithmeticOverflow)?,
        amount,
    })
}

fn weekly_prizes_for(weekly: &WeeklyJackpot, owner: Pubkey) -> Result<[Option<SyncedPrize>; 3]> {
    let pool = settled_pool(weekly.ledger)?;
    let budget = weekly_bounty_budget(pool);
    let boards: [&[MetricBoardEntry]; 3] = [
        &weekly.combo_entries,
        &weekly.action_entries,
        &weekly.run_entries,
    ];
    let counts = boards.map(|board| {
        board
            .iter()
            .take(WEEKLY_PRIZE_WEIGHTS.len())
            .take_while(|entry| entry.value > 0)
            .count()
    });
    let plans = [
        rounded_payouts(budget, &WEEKLY_PRIZE_WEIGHTS, counts[0])?,
        rounded_payouts(budget, &WEEKLY_PRIZE_WEIGHTS, counts[1])?,
        rounded_payouts(budget, &WEEKLY_PRIZE_WEIGHTS, counts[2])?,
    ];
    let paid = plans.iter().try_fold(0u64, |sum, plan| {
        sum.checked_add(plan.paid_lamports)
            .ok_or(ErrorCode::ArithmeticOverflow)
    })?;
    require!(
        paid == weekly.ledger.payout_lamports
            && pool.checked_sub(paid) == Some(weekly.ledger.rollover_out_lamports),
        ErrorCode::AccountingInvariant
    );

    let mut prizes = [None; 3];
    for board_index in 0..3 {
        let Some(rank) = boards[board_index][..counts[board_index]]
            .iter()
            .position(|entry| entry.player == owner)
        else {
            continue;
        };
        let amount = plans[board_index].amounts[rank];
        if amount == 0 {
            continue;
        }
        prizes[board_index] = Some(SyncedPrize {
            position: u8::try_from(board_index * WEEKLY_PRIZE_WEIGHTS.len() + rank)
                .map_err(|_| ErrorCode::ArithmeticOverflow)?,
            rank: u16::try_from(rank + 1).map_err(|_| ErrorCode::ArithmeticOverflow)?,
            amount,
        });
    }
    require!(prizes.iter().any(Option::is_some), ErrorCode::NoPrize);
    Ok(prizes)
}

#[event]
pub struct FeaturedEmblemSet {
    pub owner: Pubkey,
    pub emblem_id: u8,
}

#[event]
pub struct CompetitionProfileSynced {
    pub owner: Pubkey,
    /// 0 Daily, 1 Weekly, 2 Season.
    pub period_kind: u8,
    pub rank: u16,
    pub reward_lamports: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranked_profile_prize_recomputes_the_exact_pushed_amount() {
        let players = (0..5).map(|_| Pubkey::new_unique()).collect::<Vec<_>>();
        let plan = rounded_payouts(101_990_000, &DAILY_PRIZE_WEIGHTS, 5).unwrap();
        let ledger = PoolLedger {
            payout_lamports: plan.paid_lamports,
            rollover_out_lamports: plan.rollover_lamports,
            ..PoolLedger::default()
        };
        let prize = ranked_prize(&players, players[2], ledger).unwrap();
        assert_eq!(prize.position, 2);
        assert_eq!(prize.rank, 3);
        assert_eq!(prize.amount, 15_000_000);
        assert!(ranked_prize(&players, Pubkey::new_unique(), ledger).is_err());
    }

    #[test]
    fn weekly_mask_positions_are_board_scoped_and_rewards_are_independent() {
        let owner = Pubkey::new_unique();
        let other = Pubkey::new_unique();
        let entry = |player, value| MetricBoardEntry {
            player,
            value,
            ..MetricBoardEntry::default()
        };
        let pool = 90_000_000;
        let budget = weekly_bounty_budget(pool);
        let plan = rounded_payouts(budget, &WEEKLY_PRIZE_WEIGHTS, 2).unwrap();
        let paid = plan.paid_lamports * 3;
        let weekly = WeeklyJackpot {
            version: ARCADE_ACCOUNT_VERSION,
            week_id: 1,
            qualification_start_day: week_start_day(1).unwrap(),
            arcade_config: Pubkey::new_unique(),
            status: PeriodStatus::Finalized,
            predecessor_rollover_applied: true,
            metrics: [WeeklyMetric::default(); 3],
            rules_hash: [0; 32],
            opens_at: 0,
            closes_at: 1,
            finalized_at: 2,
            ledger: PoolLedger {
                payout_lamports: paid,
                rollover_out_lamports: pool - paid,
                ..PoolLedger::default()
            },
            combo_entries: vec![entry(owner, 9), entry(other, 8)],
            action_entries: vec![entry(other, 9), entry(owner, 8)],
            run_entries: vec![entry(owner, 9), entry(other, 8)],
            profile_sync_mask: 0,
            bump: 1,
        };
        let prizes = weekly_prizes_for(&weekly, owner).unwrap();
        assert_eq!(prizes[0].unwrap().position, 0);
        assert_eq!(prizes[0].unwrap().rank, 1);
        assert_eq!(prizes[1].unwrap().position, 4);
        assert_eq!(prizes[1].unwrap().rank, 2);
        assert_eq!(prizes[2].unwrap().position, 6);
        assert_eq!(prizes[2].unwrap().rank, 1);
    }
}
