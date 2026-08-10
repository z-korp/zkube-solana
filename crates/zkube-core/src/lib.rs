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
mod daily_content;
mod daily_scoring;
mod economics;
#[allow(clippy::pedantic)]
mod grid;
mod hash;
mod ladder;
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

/// Canonical account schema versions consumed by the Solana program and
/// generated TypeScript boundaries. Rules and public labels intentionally
/// retain their independent v1 schemas.
pub const PROTOCOL_ACCOUNT_VERSION: u8 = 1;
pub const PLAYER_STATE_ACCOUNT_VERSION: u8 = 1;
pub const ARCADE_ACCOUNT_VERSION: u8 = 1;
pub const RULES_ACCOUNT_VERSION: u8 = 1;
pub const PLAYER_LABEL_ACCOUNT_VERSION: u8 = 1;
pub const CORE_VERSION: &str = env!("CARGO_PKG_VERSION");

pub use campaign::{
    CAMPAIGN_LEVELS_PER_MAP, CAMPAIGN_MAP_COUNT, CAMPAIGN_MAX_STARS, CAMPAIGN_STAR_BYTES,
    CAMPAIGN_TOTAL_LEVELS, CampaignEndReason, CampaignError, CampaignRules, CampaignSimulation,
    CampaignSimulationConfig, CampaignStars, CampaignStarsError,
};
pub use daily_content::{
    DAILY_POOL_CAPACITY, DAILY_POOL_SELECTION_SEED, DailyPoolError, daily_pool_entry_index,
    daily_pool_entry_index_with,
};
pub use daily_scoring::{
    DailyObjective, DailyObjectiveRule, DailyObjectiveScore, DailyScoringError,
    score_daily_objective,
};
pub use economics::{
    ARENA_ENTRY_LAMPORTS, ENTRY_DAILY_BPS, ENTRY_DAILY_LAMPORTS, ENTRY_OPERATOR_BPS,
    ENTRY_OPERATOR_LAMPORTS, EntrySplit, EntrySplitError, split_arena_entry,
};
pub use grid::{Bonus, GRID_CELLS, GRID_HEIGHT, GRID_WIDTH, Grid, GridError, Row};
pub use hash::{Sha256Provider, SoftwareSha256};
pub use ladder::{
    LADDER_QUALIFY_POINTS, LADDER_STREAK_BONUS_CAP_DAYS, LADDER_TIER_COUNT,
    LADDER_TIER_POINT_THRESHOLDS, LadderError, apply_ladder_streak_bonus, ladder_points,
    ladder_streak_bonus_pct, ladder_tier_floor, ladder_tier_for_points,
};
pub use metrics::{ActionMetrics, MetricsError, RunMetrics};
pub use payouts::{
    BoardWidth, MIN_BOARD_PAYOUT_PLACES, PayoutError, PayoutPlan, SOL_PAYOUT_UNIT_LAMPORTS,
    board_width, payout_for_rank, rank_weighted_payouts, sol_rank_weighted_payouts,
};
pub use periods::{DAILY_REWARD_CLAIM_WINDOW_SECONDS, PeriodError, SECONDS_PER_DAY, day_id_at};
pub use randomness::{
    BlockWeights, ContinuationLayout, MAX_OPENING_HEIGHT, MIN_OPENING_HEIGHT, OpeningLayout,
    RandomnessError, continuation_from_vrf, continuation_from_vrf_with, opening_from_vrf,
    opening_from_vrf_with, reroll_row_from_vrf, reroll_row_from_vrf_with, row_from_vrf,
    row_from_vrf_with, sha256v, sha256v_with,
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
