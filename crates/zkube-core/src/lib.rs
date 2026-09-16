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
mod golden_rules {
    use crate::*;
    include!("golden_rules.rs");
}

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
mod presentation;
#[allow(clippy::pedantic)]
mod randomness;
mod replay;
#[allow(clippy::pedantic)]
mod rules;
mod simulation;
include!("tier_weights.generated.rs");
include!("realm_rules.generated.rs");

/// Version of the protocol-owned realm and level catalog.
pub const CATALOG_VERSION: u32 = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RealmRules {
    pub guardian: Guardian,
    pub starting_height: u8,
}

/// One score target for each Campaign level, shared by all realms.
pub const CAMPAIGN_TARGET_LADDER: [u16; CAMPAIGN_LEVELS_PER_MAP] =
    [10, 14, 18, 22, 27, 32, 37, 42, 46, 50];
/// Campaign moves per target point in tenths, indexed by the authored tier.
pub const MOVES_PER_POINT: [u16; TIER_BLOCK_WEIGHTS.len()] = [16, 15, 14, 13, 12, 11, 10, 9];

/// Derive the only Campaign move budget from its level and authored tier.
#[must_use]
pub const fn campaign_move_budget(level: u8, tier: u8) -> Option<u16> {
    if level == 0
        || level as usize > CAMPAIGN_TARGET_LADDER.len()
        || tier as usize >= MOVES_PER_POINT.len()
    {
        return None;
    }
    let target = CAMPAIGN_TARGET_LADDER[level as usize - 1];
    let scaled = target * MOVES_PER_POINT[tier as usize];
    Some(scaled.div_ceil(10))
}

/// Maximum retained rows in one payout board.
pub const ARENA_BOARD_CAPACITY: usize = 1_536;

/// Canonical account schema versions consumed by the Solana program and
/// generated TypeScript boundaries.
pub const PROTOCOL_ACCOUNT_VERSION: u8 = 4;
pub const PLAYER_STATE_ACCOUNT_VERSION: u8 = 3;
pub const PLAYER_STATE_RESERVED_BYTES: usize = 18;
pub const ARCADE_ACCOUNT_VERSION: u8 = 4;
pub const ARCADE_DAILY_RESULT_HASH_DOMAIN: &str = "zkube-arcade-daily-result-v5";
pub const CORE_VERSION: &str = env!("CARGO_PKG_VERSION");

pub use campaign::{
    CAMPAIGN_EMBLEM_COUNT, CAMPAIGN_LEVELS_PER_MAP, CAMPAIGN_MAP_COUNT, CAMPAIGN_MAX_STARS,
    CAMPAIGN_STAR_BYTES, CAMPAIGN_TOTAL_LEVELS, CampaignStars, CampaignStarsError, EMBLEM_AUTO,
    EMBLEM_FIRST_GUARDIAN, EMBLEM_LAST_GUARDIAN, EMBLEM_REALM_CONQUEROR, EMBLEM_WORLD_PERFECT,
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
    rank_weighted_payouts, sol_rank_weighted_payouts, sum_rank_payouts,
};
pub use periods::{
    DAILY_REWARD_CLAIM_WINDOW_SECONDS, DAILY_RUN_CLOSE_OFFSET, PeriodError, RUN_RECOVERY_SECONDS,
    SECONDS_PER_DAY, daily_window, day_id_at,
};
pub use presentation::{NoPresentation, PresentationEvent, PresentationObserver};
pub use randomness::{
    BlockWeights, ContinuationLayout, MAX_OPENING_HEIGHT, MIN_OPENING_HEIGHT, OpeningLayout,
    RandomnessError, continuation_from_vrf, continuation_from_vrf_with, local_row_randomness,
    opening_from_vrf, opening_from_vrf_with, reroll_row_from_vrf, reroll_row_from_vrf_with,
    row_from_vrf, row_from_vrf_with, sha256v, sha256v_with,
};
pub use replay::{
    CanonicalEventBytes, ChainDomain, ChallengeId, PlayerId, ReplayCommitment, ReplayEvent,
    RulesHash, derive_player_id, derive_player_id_with,
};
pub use rules::{
    BONUS_CHARGE_CAP, Constraint, ConstraintClass, ConstraintKind, Guardian, LevelRules,
    MoveReport, RunEngine, RunError, RunPhase, STAR_SOURCE_PRIMARY, STAR_SOURCE_SCORE,
    STAR_SOURCE_SECONDARY, StarRules, bonus_trigger_threshold_is_valid,
};
pub use simulation::{
    CANONICAL_RUN_RULES_LEN, CanonicalRunRulesBytes, DAILY_MAX_MOVES, PRESSURE_STEP, RULES_VERSION,
    Run, RunConfig, RunEndReason, RunRules, RunTransitionError, TierPolicy, daily_rules_hash,
    daily_rules_hash_with,
};
