//! Native-SOL Daily, Weekly bounty, Season, and ranked-run accounting.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::arena_rules::{DailyPressureProfile, DailyScoringRule};
use crate::state::protocol::LevelRuleSnapshot;

pub const ARCADE_ACCOUNT_VERSION: u8 = 2;
pub const ARCADE_CONFIG_SEED: &[u8] = b"arcade";
pub const OPERATOR_REVENUE_VAULT_SEED: &[u8] = b"operator_revenue";
pub const ARENA_DAILY_SEED: &[u8] = b"arena_daily";
pub const ARENA_PLAYER_SEED: &[u8] = b"arena_player";
pub const WEEKLY_JACKPOT_SEED: &[u8] = b"weekly_jackpot";
pub const SEASON_SEED: &[u8] = b"season";
pub const SEASON_PLAYER_SEED: &[u8] = b"season_player";

pub const ARENA_ENTRY_LAMPORTS: u64 = 20_000_000;
pub const ENTRY_DAILY_LAMPORTS: u64 = 12_000_000;
pub const ENTRY_WEEKLY_LAMPORTS: u64 = 4_000_000;
pub const ENTRY_SEASON_LAMPORTS: u64 = 2_000_000;
pub const ENTRY_OPERATOR_LAMPORTS: u64 = 2_000_000;
pub const PAYOUT_UNIT_LAMPORTS: u64 = 1_000_000;
pub const DAILY_PRIZE_WEIGHTS: [u16; 5] = [45, 25, 15, 10, 5];
pub const WEEKLY_PRIZE_WEIGHTS: [u16; 3] = [60, 25, 15];
pub const ARENA_BOARD_CAPACITY: usize = 50;
pub const WEEKLY_BOARD_CAPACITY: usize = 16;
pub const SEASON_BOARD_CAPACITY: usize = 50;
pub const SEASON_RESULT_CAPACITY: usize = 20;
pub const WEEKLY_MAX_PAYOUT_POSITIONS: usize = 3 * WEEKLY_PRIZE_WEIGHTS.len();
pub const ARENA_ENTRIES_CLOSE_OFFSET: i64 = 23 * 60 * 60;
pub const ARENA_RUNS_CLOSE_OFFSET: i64 = 23 * 60 * 60 + 30 * 60;
pub const STUCK_RUN_RECOVERY_SECONDS: i64 = 6 * 60 * 60;
pub const ARCADE_SECONDS_PER_DAY: i64 = 86_400;
pub const DAYS_PER_WEEK: u32 = 7;
pub const DAYS_PER_SEASON: u32 = 28;
pub const PERIOD_SETTLEMENT_DELAY_SECONDS: i64 =
    ARENA_RUNS_CLOSE_OFFSET + STUCK_RUN_RECOVERY_SECONDS - ARCADE_SECONDS_PER_DAY;

/// Routes canonical core hash schedules through Solana's SHA-256 syscall on
/// SBF while retaining byte-identical host behavior.
pub struct SolanaSha256;

impl zkube_core::Sha256Provider for SolanaSha256 {
    fn hashv(parts: &[&[u8]]) -> [u8; 32] {
        solana_sha256_hasher::hashv(parts).to_bytes()
    }
}

#[account]
#[derive(InitSpace)]
pub struct ArcadeConfig {
    pub version: u8,
    pub protocol: Pubkey,
    pub rules_catalog: Pubkey,
    pub entry_lamports: u64,
    pub daily_lamports: u64,
    pub weekly_lamports: u64,
    pub season_lamports: u64,
    pub operator_lamports: u64,
    pub launch_seeded: bool,
    pub launch_day_id: u32,
    pub bump: u8,
}

impl ArcadeConfig {
    pub fn canonical(protocol: Pubkey, rules_catalog: Pubkey, bump: u8) -> Self {
        Self {
            version: ARCADE_ACCOUNT_VERSION,
            protocol,
            rules_catalog,
            entry_lamports: ARENA_ENTRY_LAMPORTS,
            daily_lamports: ENTRY_DAILY_LAMPORTS,
            weekly_lamports: ENTRY_WEEKLY_LAMPORTS,
            season_lamports: ENTRY_SEASON_LAMPORTS,
            operator_lamports: ENTRY_OPERATOR_LAMPORTS,
            launch_seeded: false,
            launch_day_id: 0,
            bump,
        }
    }

    pub fn validate_terms(&self) -> Result<()> {
        require!(
            self.version == ARCADE_ACCOUNT_VERSION,
            ErrorCode::InvalidVersion
        );
        let total = self
            .daily_lamports
            .checked_add(self.weekly_lamports)
            .and_then(|value| value.checked_add(self.season_lamports))
            .and_then(|value| value.checked_add(self.operator_lamports))
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        require!(
            self.entry_lamports == ARENA_ENTRY_LAMPORTS
                && self.daily_lamports == ENTRY_DAILY_LAMPORTS
                && self.weekly_lamports == ENTRY_WEEKLY_LAMPORTS
                && self.season_lamports == ENTRY_SEASON_LAMPORTS
                && self.operator_lamports == ENTRY_OPERATOR_LAMPORTS
                && total == self.entry_lamports,
            ErrorCode::AccountingInvariant
        );
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct OperatorRevenueVault {
    pub version: u8,
    pub protocol: Pubkey,
    pub gross_operator_share: u64,
    pub withdrawn: u64,
    pub bump: u8,
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub enum PeriodStatus {
    #[default]
    Funding,
    Open,
    Finalized,
}

pub type ArenaDailyStatus = PeriodStatus;
pub type WeeklyStatus = PeriodStatus;

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct PoolLedger {
    pub seeded_lamports: u64,
    pub entry_lamports: u64,
    pub rollover_in_lamports: u64,
    pub payout_lamports: u64,
    pub rollover_out_lamports: u64,
}

impl PoolLedger {
    pub fn funded_lamports(self) -> Result<u64> {
        self.seeded_lamports
            .checked_add(self.entry_lamports)
            .and_then(|value| value.checked_add(self.rollover_in_lamports))
            .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
    }

    pub fn available_lamports(self) -> Result<u64> {
        self.funded_lamports()?
            .checked_sub(self.payout_lamports)
            .and_then(|value| value.checked_sub(self.rollover_out_lamports))
            .ok_or_else(|| error!(ErrorCode::AccountingInvariant))
    }

    pub fn add_entry(&mut self, lamports: u64) -> Result<()> {
        self.entry_lamports = self
            .entry_lamports
            .checked_add(lamports)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn add_rollover(&mut self, lamports: u64) -> Result<()> {
        self.rollover_in_lamports = self
            .rollover_in_lamports
            .checked_add(lamports)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn settle(&mut self, payouts: u64, rollover: u64) -> Result<()> {
        require!(
            payouts.checked_add(rollover) == Some(self.available_lamports()?),
            ErrorCode::AccountingInvariant
        );
        self.payout_lamports = payouts;
        self.rollover_out_lamports = rollover;
        Ok(())
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct RunMetrics {
    pub max_combo: u32,
    pub combo_scoring_actions: u32,
    pub combo_derived_score: u64,
    pub highest_action_score: u64,
    pub most_lines_single_action: u32,
    pub most_blocks_single_action: u32,
    pub total_lines: u64,
    pub total_blocks: u64,
    pub perfect_clears: u32,
}

impl RunMetrics {
    pub fn value(self, metric: WeeklyMetric) -> u64 {
        match metric {
            WeeklyMetric::HighestCombo => u64::from(self.max_combo),
            WeeklyMetric::ComboScoringActions => u64::from(self.combo_scoring_actions),
            WeeklyMetric::ComboDerivedScore => self.combo_derived_score,
            WeeklyMetric::HighestActionScore => self.highest_action_score,
            WeeklyMetric::MostLinesSingleAction => u64::from(self.most_lines_single_action),
            WeeklyMetric::MostBlocksSingleAction => u64::from(self.most_blocks_single_action),
            WeeklyMetric::TotalLines => self.total_lines,
            WeeklyMetric::TotalBlocks => self.total_blocks,
            WeeklyMetric::PerfectClears => u64::from(self.perfect_clears),
        }
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct ArenaBoardEntry {
    pub player: Pubkey,
    pub run_id: u64,
    pub score: u32,
    pub attempts: u32,
    pub finalized_at: i64,
    pub replay_hash: [u8; 32],
    pub metrics: RunMetrics,
}

#[account]
#[derive(InitSpace)]
pub struct ArenaDaily {
    pub version: u8,
    pub day_id: u32,
    pub week_id: u32,
    pub season_id: u32,
    pub arcade_config: Pubkey,
    pub rules_version: u32,
    pub status: PeriodStatus,
    pub predecessor_rollover_applied: bool,
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
    pub ledger: PoolLedger,
    pub entries_paid: u64,
    pub entries_scored: u64,
    pub entries_expired: u64,
    pub unique_players: u32,
    pub season_eligible_players: u32,
    pub season_rollups: u32,
    pub season_rollup_sealed: bool,
    #[max_len(ARENA_BOARD_CAPACITY)]
    pub entries: Vec<ArenaBoardEntry>,
    pub bump: u8,
}

impl ArenaDaily {
    pub fn record_best(&mut self, entry: ArenaBoardEntry) {
        if let Some(current) = self
            .entries
            .iter_mut()
            .find(|current| current.player == entry.player)
        {
            if !compare_arena_entries(&entry, current).is_lt() {
                // Attempts are live resolution metadata, not part of the best
                // replay identity. A worse retry must still advance the row.
                current.attempts = current.attempts.max(entry.attempts);
                return;
            }
        }
        self.entries
            .retain(|current| current.player != entry.player);
        self.entries.push(entry);
        self.entries.sort_by(compare_arena_entries);
        self.entries.truncate(ARENA_BOARD_CAPACITY);
    }

    pub fn hypothetical_rank(&self, entry: &ArenaBoardEntry) -> usize {
        1 + self
            .entries
            .iter()
            .filter(|current| compare_arena_entries(current, entry).is_lt())
            .count()
    }

    pub fn resolved(&self) -> bool {
        self.entries_scored
            .checked_add(self.entries_expired)
            .is_some_and(|resolved| resolved == self.entries_paid)
    }

    pub fn record_expired_entry(&mut self, player: &mut ArenaPlayer) -> Result<()> {
        require!(
            self.entries_scored
                .checked_add(self.entries_expired)
                .is_some_and(|resolved| resolved < self.entries_paid)
                && player.resolved_entries < player.paid_entries,
            ErrorCode::AccountingInvariant
        );
        self.entries_expired = self
            .entries_expired
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        player.resolved_entries = player
            .resolved_entries
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        if player.has_best {
            if let Some(entry) = self
                .entries
                .iter_mut()
                .find(|entry| entry.player == player.player)
            {
                entry.attempts = entry.attempts.max(player.paid_entries);
            }
        }
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct ArenaPlayer {
    pub version: u8,
    pub challenge: Pubkey,
    pub player: Pubkey,
    pub paid_entries: u32,
    pub resolved_entries: u32,
    pub active_paid_run_id: u64,
    pub has_best: bool,
    pub best_entry: ArenaBoardEntry,
    pub season_rolled_up: bool,
    pub bump: u8,
}

impl ArenaPlayer {
    pub fn initialize(challenge: Pubkey, player: Pubkey, bump: u8) -> Self {
        Self {
            version: ARCADE_ACCOUNT_VERSION,
            challenge,
            player,
            paid_entries: 0,
            resolved_entries: 0,
            active_paid_run_id: 0,
            has_best: false,
            best_entry: ArenaBoardEntry::default(),
            season_rolled_up: false,
            bump,
        }
    }

    /// Returns true on the first scoreable attempt from this wallet.
    pub fn record_score(&mut self, entry: ArenaBoardEntry) -> bool {
        let first = !self.has_best;
        if first || compare_arena_entries(&entry, &self.best_entry).is_lt() {
            self.best_entry = entry;
        }
        self.has_best = true;
        first
    }

    pub fn resolved(&self) -> bool {
        self.resolved_entries == self.paid_entries
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub enum WeeklyMetric {
    #[default]
    HighestCombo,
    ComboScoringActions,
    ComboDerivedScore,
    HighestActionScore,
    MostLinesSingleAction,
    MostBlocksSingleAction,
    TotalLines,
    TotalBlocks,
    PerfectClears,
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct MetricBoardEntry {
    pub player: Pubkey,
    pub daily: Pubkey,
    pub run_id: u64,
    pub value: u64,
    pub finalized_at: i64,
    pub replay_hash: [u8; 32],
}

#[account]
#[derive(InitSpace)]
pub struct WeeklyJackpot {
    pub version: u8,
    pub week_id: u32,
    pub arcade_config: Pubkey,
    pub status: PeriodStatus,
    pub predecessor_rollover_applied: bool,
    pub metrics: [WeeklyMetric; 3],
    pub rules_hash: [u8; 32],
    pub opens_at: i64,
    pub closes_at: i64,
    pub finalized_at: i64,
    pub ledger: PoolLedger,
    #[max_len(WEEKLY_BOARD_CAPACITY)]
    pub combo_entries: Vec<MetricBoardEntry>,
    #[max_len(WEEKLY_BOARD_CAPACITY)]
    pub action_entries: Vec<MetricBoardEntry>,
    #[max_len(WEEKLY_BOARD_CAPACITY)]
    pub run_entries: Vec<MetricBoardEntry>,
    pub bump: u8,
}

impl WeeklyJackpot {
    pub fn record_run(&mut self, daily: Pubkey, entry: ArenaBoardEntry) {
        for index in 0..3 {
            let candidate = MetricBoardEntry {
                player: entry.player,
                daily,
                run_id: entry.run_id,
                value: entry.metrics.value(self.metrics[index]),
                finalized_at: entry.finalized_at,
                replay_hash: entry.replay_hash,
            };
            let board = match index {
                0 => &mut self.combo_entries,
                1 => &mut self.action_entries,
                _ => &mut self.run_entries,
            };
            if board
                .iter()
                .find(|current| current.player == candidate.player)
                .is_some_and(|current| !compare_metric_entries(&candidate, current).is_lt())
            {
                continue;
            }
            board.retain(|current| current.player != candidate.player);
            board.push(candidate);
            board.sort_by(compare_metric_entries);
            board.truncate(WEEKLY_BOARD_CAPACITY);
        }
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct DailySeasonResult {
    pub day_id: u32,
    pub points: u16,
    pub rank: u16,
    pub recorded_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct SeasonPlayer {
    pub version: u8,
    pub season: Pubkey,
    pub player: Pubkey,
    pub results: [DailySeasonResult; SEASON_RESULT_CAPACITY],
    pub result_count: u8,
    pub points: u16,
    pub final_counted_at: i64,
    pub bump: u8,
}

impl SeasonPlayer {
    pub fn initialize(season: Pubkey, player: Pubkey, bump: u8) -> Self {
        Self {
            version: ARCADE_ACCOUNT_VERSION,
            season,
            player,
            results: [DailySeasonResult::default(); SEASON_RESULT_CAPACITY],
            result_count: 0,
            points: 0,
            final_counted_at: 0,
            bump,
        }
    }

    pub fn record(&mut self, result: DailySeasonResult) -> Result<()> {
        require!(result.rank > 0, ErrorCode::InvalidState);
        let len = usize::from(self.result_count);
        require!(
            !self.results[..len]
                .iter()
                .any(|existing| existing.day_id == result.day_id),
            ErrorCode::AlreadySubmitted
        );
        if len < SEASON_RESULT_CAPACITY {
            self.results[len] = result;
            self.result_count = self
                .result_count
                .checked_add(1)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        } else {
            let worst = self.results[..len]
                .iter()
                .enumerate()
                .min_by(|(_, left), (_, right)| compare_season_results(left, right))
                .map(|(index, _)| index)
                .ok_or(ErrorCode::InvalidState)?;
            if compare_season_results(&result, &self.results[worst]).is_gt() {
                self.results[worst] = result;
            }
        }
        self.recompute()
    }

    fn recompute(&mut self) -> Result<()> {
        let active = &mut self.results[..usize::from(self.result_count)];
        active.sort_by(|left, right| compare_season_results(right, left));
        self.points = active.iter().try_fold(0u16, |sum, result| {
            sum.checked_add(result.points)
                .ok_or(ErrorCode::ArithmeticOverflow)
        })?;
        self.final_counted_at = active
            .iter()
            .map(|result| result.recorded_at)
            .max()
            .unwrap_or(0);
        Ok(())
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct SeasonBoardEntry {
    pub player: Pubkey,
    pub points: u16,
    pub finalized_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct Season {
    pub version: u8,
    pub season_id: u32,
    pub arcade_config: Pubkey,
    pub status: PeriodStatus,
    pub predecessor_rollover_applied: bool,
    pub opens_at: i64,
    pub closes_at: i64,
    pub finalized_at: i64,
    pub ledger: PoolLedger,
    pub sealed_dailies: u8,
    #[max_len(SEASON_BOARD_CAPACITY)]
    pub entries: Vec<SeasonBoardEntry>,
    pub bump: u8,
}

impl Season {
    pub fn record(&mut self, entry: SeasonBoardEntry) {
        self.entries
            .retain(|current| current.player != entry.player);
        self.entries.push(entry);
        self.entries.sort_by(compare_season_entries);
        self.entries.truncate(SEASON_BOARD_CAPACITY);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PayoutPlan<const N: usize> {
    pub amounts: [u64; N],
    pub count: u8,
    pub paid_lamports: u64,
    pub rollover_lamports: u64,
}

impl<const N: usize> Default for PayoutPlan<N> {
    fn default() -> Self {
        Self {
            amounts: [0; N],
            count: 0,
            paid_lamports: 0,
            rollover_lamports: 0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WeeklyRecipientPlan {
    pub players: [Pubkey; WEEKLY_MAX_PAYOUT_POSITIONS],
    pub amounts: [u64; WEEKLY_MAX_PAYOUT_POSITIONS],
    pub count: u8,
    pub total_lamports: u64,
}

impl Default for WeeklyRecipientPlan {
    fn default() -> Self {
        Self {
            players: [Pubkey::default(); WEEKLY_MAX_PAYOUT_POSITIONS],
            amounts: [0; WEEKLY_MAX_PAYOUT_POSITIONS],
            count: 0,
            total_lamports: 0,
        }
    }
}

pub fn rounded_payouts<const N: usize>(
    pool: u64,
    weights: &[u16; N],
    winners: usize,
) -> Result<PayoutPlan<N>> {
    let core = zkube_core::sol_unit_payouts(
        pool,
        *weights,
        u8::try_from(winners).map_err(|_| ErrorCode::ArithmeticOverflow)?,
    )
    .map_err(|_| error!(ErrorCode::AccountingInvariant))?;
    Ok(PayoutPlan {
        amounts: core.payouts,
        count: core.winner_count,
        paid_lamports: core.paid,
        rollover_lamports: core.rollover,
    })
}

pub fn aggregate_weekly_recipients(
    boards: [&[MetricBoardEntry]; 3],
    winner_counts: [usize; 3],
    plans: &[PayoutPlan<3>; 3],
) -> Result<WeeklyRecipientPlan> {
    let mut recipients = WeeklyRecipientPlan::default();
    for board_index in 0..3 {
        require!(
            winner_counts[board_index] <= WEEKLY_PRIZE_WEIGHTS.len()
                && winner_counts[board_index] <= boards[board_index].len(),
            ErrorCode::InvalidState
        );
        for rank in 0..winner_counts[board_index] {
            let amount = plans[board_index].amounts[rank];
            if amount == 0 {
                continue;
            }
            let player = boards[board_index][rank].player;
            let count = usize::from(recipients.count);
            if let Some(existing) = recipients.players[..count]
                .iter()
                .position(|candidate| *candidate == player)
            {
                recipients.amounts[existing] = recipients.amounts[existing]
                    .checked_add(amount)
                    .ok_or(ErrorCode::ArithmeticOverflow)?;
            } else {
                require!(
                    count < WEEKLY_MAX_PAYOUT_POSITIONS,
                    ErrorCode::AccountingInvariant
                );
                recipients.players[count] = player;
                recipients.amounts[count] = amount;
                recipients.count = recipients
                    .count
                    .checked_add(1)
                    .ok_or(ErrorCode::ArithmeticOverflow)?;
            }
            recipients.total_lamports = recipients
                .total_lamports
                .checked_add(amount)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
    }
    Ok(recipients)
}

pub const fn floor_payout(lamports: u64) -> u64 {
    lamports / zkube_core::SOL_PAYOUT_UNIT_LAMPORTS * zkube_core::SOL_PAYOUT_UNIT_LAMPORTS
}

pub fn weekly_bounty_budget(pool: u64) -> u64 {
    zkube_core::equal_sol_unit_budgets::<3>(pool)
        .map(|plan| plan.budgets[0])
        .unwrap_or(0)
}

pub fn day_id_at(timestamp: i64) -> Result<u32> {
    zkube_core::day_id_at(timestamp).map_err(|_| error!(ErrorCode::InvalidPeriod))
}

pub fn week_id_for_day(day_id: u32) -> Result<u32> {
    zkube_core::week_id_for_day(day_id).map_err(|_| error!(ErrorCode::InvalidPeriod))
}

pub fn season_id_for_day(day_id: u32) -> Result<u32> {
    zkube_core::season_id_for_day(day_id).map_err(|_| error!(ErrorCode::InvalidPeriod))
}

pub fn week_start_day(week_id: u32) -> Result<u32> {
    zkube_core::week_start_day(week_id).map_err(|_| error!(ErrorCode::InvalidPeriod))
}

pub fn season_start_day(season_id: u32) -> Result<u32> {
    zkube_core::season_start_day(season_id).map_err(|_| error!(ErrorCode::InvalidPeriod))
}

pub fn day_window(day_id: u32) -> Result<(i64, i64, i64, i64)> {
    let opens_at = i64::from(day_id)
        .checked_mul(ARCADE_SECONDS_PER_DAY)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    Ok((
        opens_at,
        opens_at
            .checked_add(ARENA_ENTRIES_CLOSE_OFFSET)
            .ok_or(ErrorCode::ArithmeticOverflow)?,
        opens_at
            .checked_add(ARENA_RUNS_CLOSE_OFFSET)
            .ok_or(ErrorCode::ArithmeticOverflow)?,
        opens_at
            .checked_add(ARENA_RUNS_CLOSE_OFFSET + STUCK_RUN_RECOVERY_SECONDS)
            .ok_or(ErrorCode::ArithmeticOverflow)?,
    ))
}

pub fn week_window(week_id: u32) -> Result<(i64, i64)> {
    let opens_at = i64::from(week_start_day(week_id)?)
        .checked_mul(ARCADE_SECONDS_PER_DAY)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    Ok((
        opens_at,
        opens_at
            .checked_add(i64::from(DAYS_PER_WEEK) * ARCADE_SECONDS_PER_DAY)
            .ok_or(ErrorCode::ArithmeticOverflow)?,
    ))
}

pub fn season_window(season_id: u32) -> Result<(i64, i64)> {
    let opens_at = i64::from(season_start_day(season_id)?)
        .checked_mul(ARCADE_SECONDS_PER_DAY)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    Ok((
        opens_at,
        opens_at
            .checked_add(i64::from(DAYS_PER_SEASON) * ARCADE_SECONDS_PER_DAY)
            .ok_or(ErrorCode::ArithmeticOverflow)?,
    ))
}

pub fn period_settlement_ready(now: i64, closes_at: i64) -> bool {
    closes_at
        .checked_add(PERIOD_SETTLEMENT_DELAY_SECONDS)
        .is_some_and(|ready_at| now >= ready_at)
}

pub fn weekly_metric_selection(week_id: u32, rules_hash: [u8; 32]) -> [WeeklyMetric; 3] {
    zkube_core::select_weekly_metrics_with::<SolanaSha256>(
        week_id,
        zkube_core::RulesHash(rules_hash),
    )
    .metrics
    .map(|metric| match metric {
        zkube_core::WeeklyMetric::MaximumCombo => WeeklyMetric::HighestCombo,
        zkube_core::WeeklyMetric::ComboScoringActions => WeeklyMetric::ComboScoringActions,
        zkube_core::WeeklyMetric::TotalComboDerivedScore => WeeklyMetric::ComboDerivedScore,
        zkube_core::WeeklyMetric::HighestActionScore => WeeklyMetric::HighestActionScore,
        zkube_core::WeeklyMetric::MostLinesInAction => WeeklyMetric::MostLinesSingleAction,
        zkube_core::WeeklyMetric::MostBlocksDestroyedInAction => {
            WeeklyMetric::MostBlocksSingleAction
        }
        zkube_core::WeeklyMetric::TotalLines => WeeklyMetric::TotalLines,
        zkube_core::WeeklyMetric::TotalBlocksDestroyed => WeeklyMetric::TotalBlocks,
        zkube_core::WeeklyMetric::PerfectClears => WeeklyMetric::PerfectClears,
    })
}

pub fn daily_points(one_based_rank: usize, participants: u32) -> u16 {
    let participants = u64::from(participants.max(1));
    let in_band = |percent: u64, cap: usize| {
        let percentile_rank = participants.saturating_mul(percent).div_ceil(100) as usize;
        one_based_rank <= cap.min(percentile_rank.max(1))
    };
    if in_band(1, 3) {
        100
    } else if in_band(5, 10) {
        60
    } else if in_band(10, 20) {
        30
    } else if in_band(25, 50) {
        10
    } else {
        2
    }
}

fn compare_arena_entries(left: &ArenaBoardEntry, right: &ArenaBoardEntry) -> core::cmp::Ordering {
    right
        .score
        .cmp(&left.score)
        .then_with(|| left.finalized_at.cmp(&right.finalized_at))
        .then_with(|| left.player.to_bytes().cmp(&right.player.to_bytes()))
}

fn compare_metric_entries(
    left: &MetricBoardEntry,
    right: &MetricBoardEntry,
) -> core::cmp::Ordering {
    right
        .value
        .cmp(&left.value)
        .then_with(|| left.finalized_at.cmp(&right.finalized_at))
        .then_with(|| left.player.to_bytes().cmp(&right.player.to_bytes()))
}

fn compare_season_results(
    left: &DailySeasonResult,
    right: &DailySeasonResult,
) -> core::cmp::Ordering {
    left.points
        .cmp(&right.points)
        .then_with(|| right.recorded_at.cmp(&left.recorded_at))
        .then_with(|| right.day_id.cmp(&left.day_id))
}

fn compare_season_entries(
    left: &SeasonBoardEntry,
    right: &SeasonBoardEntry,
) -> core::cmp::Ordering {
    right
        .points
        .cmp(&left.points)
        .then_with(|| left.finalized_at.cmp(&right.finalized_at))
        .then_with(|| left.player.to_bytes().cmp(&right.player.to_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_split_is_exact_and_static() {
        let config = ArcadeConfig::canonical(Pubkey::new_unique(), Pubkey::new_unique(), 1);
        config.validate_terms().unwrap();
        assert_eq!(
            config.daily_lamports
                + config.weekly_lamports
                + config.season_lamports
                + config.operator_lamports,
            ARENA_ENTRY_LAMPORTS
        );
    }

    #[test]
    fn periods_are_monday_aligned() {
        let (week_open, week_close) = week_window(2_950).unwrap();
        assert_eq!(week_close - week_open, 7 * ARCADE_SECONDS_PER_DAY);
        assert_eq!((week_open / ARCADE_SECONDS_PER_DAY - 4).rem_euclid(7), 0);
        let (season_open, season_close) = season_window(730).unwrap();
        assert_eq!(season_close - season_open, 28 * ARCADE_SECONDS_PER_DAY);
        assert_eq!((season_open / ARCADE_SECONDS_PER_DAY - 4).rem_euclid(7), 0);
    }

    #[test]
    fn payouts_floor_to_millisol_and_roll_all_dust() {
        let plan = rounded_payouts(101_990_000, &DAILY_PRIZE_WEIGHTS, 5).unwrap();
        assert_eq!(
            plan.amounts,
            [45_000_000, 25_000_000, 15_000_000, 10_000_000, 5_000_000]
        );
        assert_eq!(plan.paid_lamports, 100_000_000);
        assert_eq!(plan.rollover_lamports, 1_990_000);
        let fewer = rounded_payouts(101_500_000, &DAILY_PRIZE_WEIGHTS, 2).unwrap();
        assert_eq!(fewer.amounts[..2], [65_000_000, 36_000_000]);
        assert_eq!(fewer.rollover_lamports, 500_000);
    }

    #[test]
    fn weekly_selection_is_deterministic_and_category_scoped() {
        let first = weekly_metric_selection(88, [9; 32]);
        assert_eq!(first, weekly_metric_selection(88, [9; 32]));
        assert!(matches!(
            first[0],
            WeeklyMetric::HighestCombo
                | WeeklyMetric::ComboScoringActions
                | WeeklyMetric::ComboDerivedScore
        ));
        assert!(matches!(
            first[1],
            WeeklyMetric::HighestActionScore
                | WeeklyMetric::MostLinesSingleAction
                | WeeklyMetric::MostBlocksSingleAction
        ));
        assert!(matches!(
            first[2],
            WeeklyMetric::TotalLines | WeeklyMetric::TotalBlocks | WeeklyMetric::PerfectClears
        ));
    }

    #[test]
    fn season_keeps_best_twenty_results() {
        let mut player = SeasonPlayer::initialize(Pubkey::new_unique(), Pubkey::new_unique(), 1);
        for day in 0..28u32 {
            player
                .record(DailySeasonResult {
                    day_id: day,
                    points: if day < 8 { 2 } else { 10 },
                    rank: if day < 8 { 80 } else { 20 },
                    recorded_at: i64::from(day),
                })
                .unwrap();
        }
        assert_eq!(player.result_count, 20);
        assert_eq!(player.points, 200);
        assert!(player.results.iter().all(|result| result.points == 10));
    }

    #[test]
    fn worse_score_and_expiry_keep_best_replay_but_advance_attempts() {
        let wallet = Pubkey::new_unique();
        let mut daily = ArenaDaily {
            version: ARCADE_ACCOUNT_VERSION,
            day_id: 4,
            week_id: 0,
            season_id: 0,
            arcade_config: Pubkey::new_unique(),
            rules_version: 1,
            status: PeriodStatus::Open,
            predecessor_rollover_applied: true,
            content_version: 1,
            catalog_hash: [0; 32],
            rules_hash: [0; 32],
            map_id: 1,
            scoring_rule: DailyScoringRule::default(),
            rules: LevelRuleSnapshot::default(),
            pressure: DailyPressureProfile::default(),
            opens_at: 0,
            entries_close_at: 0,
            runs_close_at: 0,
            recovery_deadline_at: 0,
            finalized_at: 0,
            ledger: PoolLedger::default(),
            entries_paid: 3,
            entries_scored: 2,
            entries_expired: 0,
            unique_players: 1,
            season_eligible_players: 1,
            season_rollups: 0,
            season_rollup_sealed: false,
            entries: Vec::new(),
            bump: 1,
        };
        let best = ArenaBoardEntry {
            player: wallet,
            run_id: 1,
            score: 100,
            attempts: 1,
            finalized_at: 10,
            replay_hash: [1; 32],
            ..ArenaBoardEntry::default()
        };
        daily.record_best(best);
        daily.record_best(ArenaBoardEntry {
            player: wallet,
            run_id: 2,
            score: 90,
            attempts: 2,
            finalized_at: 11,
            replay_hash: [2; 32],
            ..ArenaBoardEntry::default()
        });
        assert_eq!(daily.entries[0].run_id, 1);
        assert_eq!(daily.entries[0].replay_hash, [1; 32]);
        assert_eq!(daily.entries[0].attempts, 2);

        let mut player = ArenaPlayer::initialize(Pubkey::new_unique(), wallet, 1);
        player.paid_entries = 3;
        player.resolved_entries = 2;
        player.has_best = true;
        player.best_entry = best;
        daily.record_expired_entry(&mut player).unwrap();
        assert_eq!(daily.entries[0].run_id, 1);
        assert_eq!(daily.entries[0].attempts, 3);
    }

    #[test]
    fn accounts_fit_normal_allocation() {
        for size in [
            ArcadeConfig::INIT_SPACE,
            OperatorRevenueVault::INIT_SPACE,
            ArenaDaily::INIT_SPACE,
            ArenaPlayer::INIT_SPACE,
            WeeklyJackpot::INIT_SPACE,
            Season::INIT_SPACE,
            SeasonPlayer::INIT_SPACE,
        ] {
            assert!(8 + size < 10_240, "account allocation too large: {size}");
        }
    }
}
