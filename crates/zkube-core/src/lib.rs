#![no_std]
#![forbid(unsafe_code)]

//! Chain-neutral deterministic primitives shared by every zKube runtime.
//!
//! This crate intentionally performs no allocation. Protocol encodings use
//! fixed-size buffers, money uses checked integer arithmetic, and hashing is
//! routed through [`Sha256Provider`] so on-chain consumers can substitute a
//! native syscall without changing the byte schedule.

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod golden_run;

// The extracted v4 engine preserves its already-reviewed arithmetic and
// compact casts so the existing parity fixtures remain authoritative.
mod campaign;
mod daily_scoring;
mod economics;
#[allow(clippy::pedantic)]
mod grid;
mod hash;
mod metrics;
#[allow(clippy::missing_errors_doc)]
mod payouts;
#[allow(clippy::missing_errors_doc)]
mod periods;
#[allow(clippy::pedantic)]
mod randomness;
mod replay;
#[allow(clippy::pedantic)]
mod rules;
mod simulation;
mod weekly;

/// Canonical account schema versions consumed by the Solana program and
/// generated TypeScript boundaries. Rules and public labels intentionally
/// retain their independent v1 schemas.
pub const PROTOCOL_ACCOUNT_VERSION: u8 = 2;
pub const ARCADE_ACCOUNT_VERSION: u8 = 3;
pub const RULES_ACCOUNT_VERSION: u8 = 1;
pub const PLAYER_LABEL_ACCOUNT_VERSION: u8 = 1;

pub use campaign::{
    CAMPAIGN_LEVELS_PER_MAP, CAMPAIGN_MAP_COUNT, CAMPAIGN_MAX_STARS, CAMPAIGN_STAR_BYTES,
    CAMPAIGN_TOTAL_LEVELS, CampaignEndReason, CampaignError, CampaignMode, CampaignRules,
    CampaignSimulation, CampaignSimulationConfig, CampaignStars, CampaignStarsError,
};
pub use daily_scoring::{
    DailyObjective, DailyObjectiveRule, DailyObjectiveScore, DailyScoringError,
    score_daily_objective,
};
pub use economics::{
    ARENA_ENTRY_LAMPORTS, ENTRY_DAILY_BPS, ENTRY_OPERATOR_BPS, ENTRY_SEASON_BPS, ENTRY_WEEKLY_BPS,
    EntrySplit, EntrySplitError, split_arena_entry,
};
pub use grid::{Bonus, GRID_CELLS, GRID_HEIGHT, GRID_WIDTH, Grid, GridError, Row};
pub use hash::{Sha256Provider, SoftwareSha256};
pub use metrics::{ActionMetrics, MetricsError, RunMetrics};
pub use payouts::{
    EqualBudgetPlan, PayoutError, PayoutPlan, SOL_PAYOUT_UNIT_LAMPORTS, equal_sol_unit_budgets,
    equal_whole_budgets, sol_unit_payouts, whole_unit_payouts,
};
pub use periods::{
    FundingPeriods, MONDAY_EPOCH_DAY_ID, PeriodError, SEASON_DAYS, SECONDS_PER_DAY, WEEK_DAYS,
    day_id_at, funding_periods_for_day, season_id_at, season_id_for_day, season_start_day,
    week_id_at, week_id_for_day, week_start_day,
};
pub use randomness::{
    BlockWeights, ContinuationLayout, MAX_OPENING_HEIGHT, MIN_OPENING_HEIGHT, OpeningLayout,
    RandomnessError, continuation_from_vrf, continuation_from_vrf_with, opening_from_vrf,
    opening_from_vrf_with, row_from_vrf, row_from_vrf_with, sha256v, sha256v_with,
};
pub use replay::{
    CanonicalEventBytes, ChainDomain, ChallengeId, PlayerId, ReplayCommitment, ReplayEvent,
    ReplayMode, RulesHash, derive_player_id, derive_player_id_with,
};
pub use rules::{
    Constraint, ConstraintKind, EndlessRules, LevelRules, MoveReport, MutatorRules, RunEngine,
    RunError, RunPhase, calculate_level_stars,
};
pub use simulation::{
    CANONICAL_DAILY_RULES_LEN, CanonicalDailyRulesBytes, DailyPressureRules, DailyRunRules,
    DailySimulation, DailySimulationConfig, SimulationError, daily_challenge_rules_hash,
    daily_challenge_rules_hash_with,
};
pub use weekly::{
    WeeklyMetric, WeeklyMetricSelection, select_weekly_metrics, select_weekly_metrics_with,
};
