//! Wallet-native Arena entry accounting and push-settled prize pots.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::economy::{daily_points_for_rank, DailyPressureProfile, DailyScoringRule};
use crate::state::protocol::{DailyStatus, LevelRuleSnapshot};

pub const ARCADE_ACCOUNT_VERSION: u8 = 3;
pub const ARCADE_CONFIG_SEED: &[u8] = b"arcade";
pub const OPERATOR_REVENUE_VAULT_SEED: &[u8] = b"operator_revenue";
pub const ARENA_DAILY_SEED: &[u8] = b"arena_daily";
pub const ARENA_PLAYER_SEED: &[u8] = b"arena_player";
pub const ARENA_BOARD_SEED: &[u8] = b"arena_board";
pub const WEEKLY_JACKPOT_SEED: &[u8] = b"weekly_jackpot";
pub const WEEKLY_PLAYER_SEED: &[u8] = b"weekly_player";
pub const WEEKLY_BOARD_SEED: &[u8] = b"weekly_board";
pub const BOUNTY_RESERVATION_SEED: &[u8] = b"bounty";

pub const ARENA_ENTRY_LAMPORTS: u64 = 20_000_000;
pub const DAILY_POT_BPS: u16 = 7_500;
pub const OPERATOR_BPS: u16 = 1_500;
pub const WEEKLY_JACKPOT_BPS: u16 = 1_000;
pub const OPERATOR_WITHDRAW_RESERVE_LAMPORTS: u64 = 1_000_000_000;
pub const DAILY_PRIZE_WEIGHTS: [u16; 5] = [45, 25, 15, 10, 5];
pub const WEEKLY_PRIZE_WEIGHTS: [u16; 3] = [60, 25, 15];
pub const ARENA_BOARD_CAPACITY: usize = 50;
pub const WEEKLY_BOARD_CAPACITY: usize = 50;
pub const WEEKLY_RESULT_CAPACITY: usize = 7;
pub const ARENA_ENTRIES_CLOSE_OFFSET: i64 = 23 * 60 * 60;
pub const ARENA_RUNS_CLOSE_OFFSET: i64 = 23 * 60 * 60 + 30 * 60;
pub const STUCK_RUN_RECOVERY_SECONDS: i64 = 6 * 60 * 60;
pub const ARCADE_SECONDS_PER_DAY: i64 = 86_400;

#[account]
#[derive(InitSpace)]
pub struct ArcadeConfig {
    pub version: u8,
    pub protocol: Pubkey,
    pub rules_catalog: Pubkey,
    pub entry_lamports: u64,
    pub daily_pot_bps: u16,
    pub operator_bps: u16,
    pub weekly_jackpot_bps: u16,
    pub pending_entry_lamports: u64,
    pub entry_activates_day: u32,
    pub pending_daily_pot_bps: u16,
    pub pending_operator_bps: u16,
    pub pending_weekly_jackpot_bps: u16,
    pub split_activates_week: u32,
    pub operator_withdraw_reserve_lamports: u64,
    /// Reserved for the deferred credit instruction version and bounty schema.
    pub reserved: [u8; 32],
    pub bump: u8,
}

impl ArcadeConfig {
    pub fn canonical(protocol: Pubkey, rules_catalog: Pubkey, bump: u8) -> Self {
        Self {
            version: ARCADE_ACCOUNT_VERSION,
            protocol,
            rules_catalog,
            entry_lamports: ARENA_ENTRY_LAMPORTS,
            daily_pot_bps: DAILY_POT_BPS,
            operator_bps: OPERATOR_BPS,
            weekly_jackpot_bps: WEEKLY_JACKPOT_BPS,
            pending_entry_lamports: 0,
            entry_activates_day: u32::MAX,
            pending_daily_pot_bps: 0,
            pending_operator_bps: 0,
            pending_weekly_jackpot_bps: 0,
            split_activates_week: u32::MAX,
            operator_withdraw_reserve_lamports: OPERATOR_WITHDRAW_RESERVE_LAMPORTS,
            reserved: [0; 32],
            bump,
        }
    }

    pub fn terms_for(&self, day_id: u32, week_id: u32) -> Result<ArenaTerms> {
        require!(
            self.version == ARCADE_ACCOUNT_VERSION,
            ErrorCode::InvalidVersion
        );
        let entry_lamports =
            if self.entry_activates_day != u32::MAX && day_id >= self.entry_activates_day {
                self.pending_entry_lamports
            } else {
                self.entry_lamports
            };
        let (daily_pot_bps, operator_bps, weekly_jackpot_bps) =
            if self.split_activates_week != u32::MAX && week_id >= self.split_activates_week {
                (
                    self.pending_daily_pot_bps,
                    self.pending_operator_bps,
                    self.pending_weekly_jackpot_bps,
                )
            } else {
                (
                    self.daily_pot_bps,
                    self.operator_bps,
                    self.weekly_jackpot_bps,
                )
            };
        validate_split(daily_pot_bps, operator_bps, weekly_jackpot_bps)?;
        require!(entry_lamports > 0, ErrorCode::InvalidState);
        Ok(ArenaTerms {
            entry_lamports,
            daily_pot_bps,
            operator_bps,
            weekly_jackpot_bps,
        })
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace, PartialEq, Eq)]
pub struct ArenaTerms {
    pub entry_lamports: u64,
    pub daily_pot_bps: u16,
    pub operator_bps: u16,
    pub weekly_jackpot_bps: u16,
}

impl ArenaTerms {
    /// Floors operator and weekly shares. Any division dust stays in the Daily pot.
    pub fn split(self) -> Result<(u64, u64, u64)> {
        let operator = bps_floor(self.entry_lamports, self.operator_bps)?;
        let weekly = bps_floor(self.entry_lamports, self.weekly_jackpot_bps)?;
        let daily = self
            .entry_lamports
            .checked_sub(operator)
            .and_then(|value| value.checked_sub(weekly))
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok((daily, operator, weekly))
    }
}

#[account]
#[derive(InitSpace)]
pub struct OperatorRevenueVault {
    pub version: u8,
    pub protocol: Pubkey,
    pub gross_operator_share: u64,
    pub stuck_run_refunds: u64,
    pub withdrawn: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ArenaDaily {
    pub version: u8,
    pub day_id: u32,
    pub week_id: u32,
    pub arcade_config: Pubkey,
    pub rent_recipient: Pubkey,
    pub rules_version: u32,
    pub status: DailyStatus,
    pub content_version: u32,
    pub catalog_hash: [u8; 32],
    pub rules_hash: [u8; 32],
    pub map_id: u8,
    pub scoring_rule: DailyScoringRule,
    pub rules: LevelRuleSnapshot,
    pub pressure: DailyPressureProfile,
    pub opens_at: i64,
    pub entries_close_at: i64,
    pub runs_close_at: i64,
    pub recovery_deadline_at: i64,
    pub finalized_at: i64,
    pub terms: ArenaTerms,
    pub pot_lamports: u64,
    pub entries_paid: u64,
    pub runs_finalized: u64,
    pub entries_refunded: u64,
    pub unique_players: u32,
    pub weekly_eligible_players: u32,
    pub weekly_rollups: u32,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ArenaPlayer {
    pub version: u8,
    pub challenge: Pubkey,
    pub player: Pubkey,
    pub paid_entries: u32,
    pub finalized_entries: u32,
    pub refunded_entries: u32,
    pub active_paid_run_id: u64,
    pub best_run_id: u64,
    pub best_score: u32,
    pub best_bonus_triggers: u16,
    pub best_engine_score: u32,
    pub best_moves: u16,
    pub best_submitted_at: i64,
    pub best_replay_hash: [u8; 32],
    pub weekly_rolled_up: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ArenaBoard {
    pub version: u8,
    pub challenge: Pubkey,
    #[max_len(ARENA_BOARD_CAPACITY)]
    pub entries: Vec<ArenaBoardEntry>,
    pub bump: u8,
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct ArenaBoardEntry {
    pub player: Pubkey,
    pub run_id: u64,
    pub score: u32,
    pub bonus_triggers: u16,
    pub engine_score: u32,
    pub moves: u16,
    pub attempts: u32,
    pub submitted_at: i64,
    pub replay_hash: [u8; 32],
}

impl ArenaBoard {
    pub fn record_best(&mut self, entry: ArenaBoardEntry) {
        self.entries
            .retain(|current| current.player != entry.player);
        self.entries.push(entry);
        // Stable driftsort avoids the large stack scratch buffer that
        // `sort_unstable_by` would instantiate for replay-hash-sized rows in SBF.
        self.entries.sort_by(compare_arena_entries);
        self.entries.truncate(ARENA_BOARD_CAPACITY);
    }

    /// One-based rank under the exact canonical Daily comparator, without
    /// mutating yesterday's settled board.
    pub fn hypothetical_rank(&self, entry: &ArenaBoardEntry) -> usize {
        1 + self
            .entries
            .iter()
            .filter(|current| compare_arena_entries(current, entry).is_lt())
            .count()
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub enum WeeklyStatus {
    #[default]
    Open,
    Finalized,
}

#[account]
#[derive(InitSpace)]
pub struct WeeklyJackpot {
    pub version: u8,
    pub week_id: u32,
    pub arcade_config: Pubkey,
    pub rent_recipient: Pubkey,
    pub status: WeeklyStatus,
    pub opens_at: i64,
    pub closes_at: i64,
    pub finalized_at: i64,
    pub pot_lamports: u64,
    pub participants: u32,
    pub bump: u8,
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct WeeklyResult {
    pub day_id: u32,
    pub points: u16,
}

#[account]
#[derive(InitSpace)]
pub struct WeeklyPlayer {
    pub version: u8,
    pub jackpot: Pubkey,
    pub player: Pubkey,
    pub results: [WeeklyResult; WEEKLY_RESULT_CAPACITY],
    pub result_count: u8,
    pub score: u16,
    pub total_bonus_triggers: u32,
    pub earliest_final_submission: i64,
    pub bump: u8,
}

impl WeeklyPlayer {
    pub fn record_daily(
        &mut self,
        day_id: u32,
        rank: Option<usize>,
        participants: u32,
        bonus_triggers: u16,
        submitted_at: i64,
    ) -> Result<()> {
        require!(
            usize::from(self.result_count) < WEEKLY_RESULT_CAPACITY,
            ErrorCode::InvalidState
        );
        require!(
            !self.results[..usize::from(self.result_count)]
                .iter()
                .any(|r| r.day_id == day_id),
            ErrorCode::AlreadySubmitted
        );
        let points = daily_points_for_rank(rank, participants);
        self.results[usize::from(self.result_count)] = WeeklyResult { day_id, points };
        self.result_count = self
            .result_count
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        self.score = self
            .score
            .checked_add(points)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        self.total_bonus_triggers = self
            .total_bonus_triggers
            .checked_add(u32::from(bonus_triggers))
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        if self.earliest_final_submission == 0 {
            self.earliest_final_submission = submitted_at;
        }
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct WeeklyBoard {
    pub version: u8,
    pub jackpot: Pubkey,
    #[max_len(WEEKLY_BOARD_CAPACITY)]
    pub entries: Vec<WeeklyBoardEntry>,
    pub bump: u8,
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct WeeklyBoardEntry {
    pub player: Pubkey,
    pub score: u16,
    pub total_bonus_triggers: u32,
    pub earliest_final_submission: i64,
}

impl WeeklyBoard {
    pub fn record(&mut self, entry: WeeklyBoardEntry) {
        self.entries
            .retain(|current| current.player != entry.player);
        self.entries.push(entry);
        self.entries.sort_by(compare_weekly_entries);
        self.entries.truncate(WEEKLY_BOARD_CAPACITY);
    }
}

pub fn week_id_for_day(day_id: u32) -> u32 {
    day_id.saturating_add(3) / 7
}

pub fn week_window(week_id: u32) -> Result<(i64, i64)> {
    let start_day = i64::from(week_id)
        .checked_mul(7)
        .and_then(|v| v.checked_sub(3))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let opens_at = start_day
        .checked_mul(ARCADE_SECONDS_PER_DAY)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let closes_at = opens_at
        .checked_add(7 * ARCADE_SECONDS_PER_DAY)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    Ok((opens_at, closes_at))
}

pub fn payout_amounts(pool: u64, weights: &[u16], winners: usize) -> Result<Vec<u64>> {
    require!(
        winners > 0 && winners <= weights.len(),
        ErrorCode::InvalidState
    );
    let denominator: u64 = weights[..winners].iter().map(|w| u64::from(*w)).sum();
    let mut paid = 0u64;
    let mut payouts = Vec::with_capacity(winners);
    for weight in &weights[..winners] {
        let amount = u64::try_from(
            u128::from(pool)
                .checked_mul(u128::from(*weight))
                .ok_or(ErrorCode::ArithmeticOverflow)?
                / u128::from(denominator),
        )
        .map_err(|_| ErrorCode::ArithmeticOverflow)?;
        paid = paid
            .checked_add(amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        payouts.push(amount);
    }
    let dust = pool
        .checked_sub(paid)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    *payouts.last_mut().ok_or(ErrorCode::InvalidState)? = payouts
        .last()
        .copied()
        .unwrap()
        .checked_add(dust)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    Ok(payouts)
}

pub fn validate_split(daily: u16, operator: u16, weekly: u16) -> Result<()> {
    require!(
        daily > 0 && operator > 0 && weekly > 0,
        ErrorCode::InvalidState
    );
    require!(
        u32::from(daily) + u32::from(operator) + u32::from(weekly) == 10_000,
        ErrorCode::AccountingInvariant
    );
    Ok(())
}

fn bps_floor(amount: u64, bps: u16) -> Result<u64> {
    u64::try_from(
        u128::from(amount)
            .checked_mul(u128::from(bps))
            .ok_or(ErrorCode::ArithmeticOverflow)?
            / 10_000,
    )
    .map_err(|_| error!(ErrorCode::ArithmeticOverflow))
}

fn compare_arena_entries(left: &ArenaBoardEntry, right: &ArenaBoardEntry) -> core::cmp::Ordering {
    right
        .score
        .cmp(&left.score)
        .then_with(|| right.bonus_triggers.cmp(&left.bonus_triggers))
        .then_with(|| right.engine_score.cmp(&left.engine_score))
        .then_with(|| left.moves.cmp(&right.moves))
        .then_with(|| left.submitted_at.cmp(&right.submitted_at))
        .then_with(|| left.player.to_bytes().cmp(&right.player.to_bytes()))
}

fn compare_weekly_entries(
    left: &WeeklyBoardEntry,
    right: &WeeklyBoardEntry,
) -> core::cmp::Ordering {
    right
        .score
        .cmp(&left.score)
        .then_with(|| right.total_bonus_triggers.cmp(&left.total_bonus_triggers))
        .then_with(|| {
            left.earliest_final_submission
                .cmp(&right.earliest_final_submission)
        })
        .then_with(|| left.player.to_bytes().cmp(&right.player.to_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_entry_is_exact_and_conserved() {
        let terms = ArenaTerms {
            entry_lamports: ARENA_ENTRY_LAMPORTS,
            daily_pot_bps: DAILY_POT_BPS,
            operator_bps: OPERATOR_BPS,
            weekly_jackpot_bps: WEEKLY_JACKPOT_BPS,
        };
        let (daily, operator, weekly) = terms.split().unwrap();
        assert_eq!(
            (daily, operator, weekly),
            (15_000_000, 3_000_000, 2_000_000)
        );
        assert_eq!(daily + operator + weekly, ARENA_ENTRY_LAMPORTS);
    }

    #[test]
    fn payouts_renormalize_and_assign_dust_to_last_winner() {
        assert_eq!(
            payout_amounts(75, &DAILY_PRIZE_WEIGHTS, 1).unwrap(),
            vec![75]
        );
        assert_eq!(
            payout_amounts(101, &WEEKLY_PRIZE_WEIGHTS, 2)
                .unwrap()
                .iter()
                .sum::<u64>(),
            101
        );
    }

    #[test]
    fn hypothetical_rank_uses_the_canonical_tie_breakers() {
        let mut board = ArenaBoard {
            version: ARCADE_ACCOUNT_VERSION,
            challenge: Pubkey::new_unique(),
            entries: Vec::new(),
            bump: 1,
        };
        let player = Pubkey::new_unique();
        board.record_best(ArenaBoardEntry {
            player,
            score: 100,
            bonus_triggers: 2,
            engine_score: 90,
            moves: 20,
            submitted_at: 10,
            ..ArenaBoardEntry::default()
        });
        let better = ArenaBoardEntry {
            player: Pubkey::new_unique(),
            score: 100,
            bonus_triggers: 3,
            engine_score: 80,
            moves: 30,
            submitted_at: 20,
            ..ArenaBoardEntry::default()
        };
        let worse = ArenaBoardEntry {
            player: Pubkey::new_unique(),
            score: 100,
            bonus_triggers: 1,
            engine_score: 100,
            moves: 10,
            submitted_at: 1,
            ..ArenaBoardEntry::default()
        };
        assert_eq!(board.hypothetical_rank(&better), 1);
        assert_eq!(board.hypothetical_rank(&worse), 2);
    }

    #[test]
    fn monday_week_is_seven_days() {
        let (open, close) = week_window(2_950).unwrap();
        assert_eq!(close - open, 7 * ARCADE_SECONDS_PER_DAY);
    }
}
