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
mod economics;
#[allow(clippy::pedantic)]
mod grid;
mod hash;
mod ladder;
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
include!("tier_weights.generated.rs");

/// Canonical account schema versions consumed by the Solana program and
/// generated TypeScript boundaries.
pub const PROTOCOL_ACCOUNT_VERSION: u8 = 1;
pub const PLAYER_STATE_ACCOUNT_VERSION: u8 = 1;
pub const ARCADE_ACCOUNT_VERSION: u8 = 1;
pub const PLAYER_LABEL_ACCOUNT_VERSION: u8 = 1;
pub const ARCADE_DAILY_RESULT_HASH_DOMAIN: &str = "zkube-arcade-daily-result-v5";
pub const CORE_VERSION: &str = env!("CARGO_PKG_VERSION");

pub use campaign::{
    CAMPAIGN_LEVELS_PER_MAP, CAMPAIGN_MAP_COUNT, CAMPAIGN_MAX_STARS, CAMPAIGN_STAR_BYTES,
    CAMPAIGN_TOTAL_LEVELS, CampaignStars, CampaignStarsError,
};
pub use daily_content::{
    DAILY_PAIR_COUNT, DAILY_PAIR_SELECTION_SEED, DAILY_THEMES, DailyTheme, OBJECTIVE_COUNT,
    REALM_COUNT, daily_pair, daily_pair_index, daily_pair_index_with, daily_pair_with,
};
pub use economics::{
    ARENA_ENTRY_LAMPORTS, ENTRY_DAILY_BPS, ENTRY_DAILY_LAMPORTS, ENTRY_OPERATOR_BPS,
    ENTRY_OPERATOR_LAMPORTS, EntrySplit, EntrySplitError, split_arena_entry,
};
pub use grid::{Bonus, GRID_CELLS, GRID_HEIGHT, GRID_WIDTH, Grid, GridError, Row};
pub use hash::{Sha256Provider, SoftwareSha256};
pub use ladder::{
    LADDER_QUALIFY_POINTS, LADDER_TIER_COUNT, LADDER_TIER_POINT_THRESHOLDS, LadderError,
    ladder_points, ladder_tier_floor, ladder_tier_for_points,
};
pub use payouts::{
    BoardWidth, DailyBoardPools, MIN_BOARD_PAYOUT_PLACES, PayoutError, PayoutPlan,
    SOL_PAYOUT_UNIT_LAMPORTS, board_width, daily_board_pools, payout_for_rank,
    rank_weighted_payouts, sol_rank_weighted_payouts,
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
    BONUS_CHARGE_CAP, Constraint, ConstraintClass, ConstraintKind, Guardian, LevelRules,
    MoveReport, RunEngine, RunError, RunPhase, STAR_SOURCE_PRIMARY, STAR_SOURCE_SCORE,
    STAR_SOURCE_SECONDARY, StarRules, bonus_trigger_threshold_is_valid,
};
pub use simulation::{
    CANONICAL_RUN_RULES_LEN, CanonicalRunRulesBytes, DAILY_MAX_MOVES, DailyPressureRules,
    PRESSURE_STEP, RULES_VERSION, Run, RunConfig, RunEndReason, RunRules, RunTransitionError,
    TierPolicy, daily_rules_hash, daily_rules_hash_with,
};
