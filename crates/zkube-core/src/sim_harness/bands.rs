//! Owner bands and compute budgets for the design instrument.

/// One planner role's bounded work per accepted action.
///
/// `iterations` also bounds node expansion: one iteration expands at most one
/// previously unvisited edge, so a decision retains at most `iterations + 1`
/// tree nodes. `tree_depth` bounds selection, `rollout_actions` is the skill
/// dial for simulated lookahead, and `action_width` bounds legal-action
/// expansion while retaining a representative bonus and reroll when available.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PlannerBudget {
    /// Monte Carlo samples, and therefore the per-decision node limit minus one.
    pub iterations: u16,
    /// Maximum UCT selection depth before the rollout policy takes over.
    pub tree_depth: u8,
    /// Maximum accepted actions played by the rollout policy per sample.
    pub rollout_actions: u16,
    /// Maximum legal root or child actions retained at one tree node.
    pub action_width: u8,
}

/// Strong-player search budget used by every findability and star assertion.
pub const PLANNER_STRONG: PlannerBudget = PlannerBudget {
    iterations: 32,
    tree_depth: 4,
    rollout_actions: 48,
    action_width: 12,
};

/// Low-budget planner used when an explicitly mid-skill population is needed.
pub const PLANNER_CASUAL: PlannerBudget = PlannerBudget {
    iterations: 8,
    tree_depth: 2,
    rollout_actions: 20,
    action_width: 6,
};

/// Reduced strong-policy budget used only by the sub-two-minute eight-seed gate.
pub const PLANNER_GATE: PlannerBudget = PlannerBudget {
    iterations: 1,
    tree_depth: 1,
    rollout_actions: 2,
    action_width: 2,
};

/// Maximum unique Markov states the omniscient oracle may visit per seed.
pub const ORACLE_NODE_BUDGET: usize = 200_000;

/// Integer UCT exploration weight; large enough to revisit every expanded arm.
pub const PLANNER_UCT_EXPLORATION: u64 = 120_000;

/// Reward distance between adjacent terminal Campaign star results.
pub const PLANNER_STAR_STEP: u64 = 250_000;

/// Reward range for progress toward the Campaign score target.
pub const PLANNER_SCORE_PROGRESS_RANGE: u64 = 100_000;

/// Reward range for progress toward the level's explicit apex predicate.
pub const PLANNER_APEX_PROGRESS_RANGE: u64 = 80_000;

/// Reward range for progress on the Campaign primary constraint.
pub const PLANNER_CAMPAIGN_PRIMARY_RANGE: u64 = 50_000;

/// Extra reward range used only by the combo-weighted Campaign value.
pub const PLANNER_CAMPAIGN_COMBO_RANGE: u64 = 40_000;

/// Small survival tie-break awarded for keeping the board below capacity.
pub const PLANNER_HEIGHT_RANGE: u64 = 20_000;

/// Metric at which a Daily rollout's Score or Theme reward saturates.
pub const PLANNER_DAILY_METRIC_CAP: u64 = 50_000;

/// Reward range occupied by the selected Daily board metric.
pub const PLANNER_DAILY_METRIC_RANGE: u64 = 980_000;

/// First holdout seed index used by every assertion population.
pub const ASSERTION_SEED_START: u64 = 1_024;
/// Seed count for assertions evaluated in the ordinary validation gate.
pub const GATE_SEEDS: u32 = 8;
/// Minimum planner and oracle seed count in a full acceptance run.
pub const ACCEPTANCE_PLANNER_SEEDS: u32 = 32;
/// Minimum naive seed count resolving the narrow guardian luck band.
pub const ACCEPTANCE_NAIVE_SEEDS: u32 = 100;

/// Wilson score interval confidence multiplier, scaled by one thousand.
pub const CONFIDENCE_Z_MILLI: u32 = 1_960;

/// Minimum mean-star gain, in thousandths, for constraint pursuit.
pub const CONSTRAINT_MEAN_STAR_GAIN_MILLI: i32 = 300;
/// Alternative two-star-rate gain for constraint pursuit, in basis points.
pub const CONSTRAINT_TWO_STAR_GAIN_BPS: i32 = 1_000;
/// Level-one lower first-star rate, in basis points.
pub const FIRST_STAR_START_MIN_BPS: u32 = 8_500;
/// Level-one upper first-star rate, in basis points.
pub const FIRST_STAR_START_MAX_BPS: u32 = 9_500;
/// Guardian lower first-star rate, in basis points.
pub const FIRST_STAR_END_MIN_BPS: u32 = 4_500;
/// Guardian upper first-star rate, in basis points.
pub const FIRST_STAR_END_MAX_BPS: u32 = 6_000;
/// Level-one lower second-star rate, in basis points.
pub const SECOND_STAR_START_MIN_BPS: u32 = 6_000;
/// Level-one upper second-star rate, in basis points.
pub const SECOND_STAR_START_MAX_BPS: u32 = 8_000;
/// Guardian lower second-star rate, in basis points.
pub const SECOND_STAR_END_MIN_BPS: u32 = 2_500;
/// Guardian upper second-star rate, in basis points.
pub const SECOND_STAR_END_MAX_BPS: u32 = 4_000;
/// Level-one lower third-star rate, in basis points.
pub const THIRD_STAR_START_MIN_BPS: u32 = 3_000;
/// Level-one upper third-star rate, in basis points.
pub const THIRD_STAR_START_MAX_BPS: u32 = 5_000;
/// Guardian lower third-star rate, in basis points.
pub const THIRD_STAR_END_MIN_BPS: u32 = 1_000;
/// Guardian upper third-star rate, in basis points.
pub const THIRD_STAR_END_MAX_BPS: u32 = 2_000;
/// Lower trigger firing rate in either mode, in basis points.
pub const TRIGGER_LIVENESS_MIN_BPS: u32 = 3_000;
/// Minimum success-rate drop at the adjacent tier, in basis points.
pub const TIER_STEP_MIN_DROP_BPS: i32 = 500;
/// Maximum success-rate drop at the adjacent tier, in basis points.
pub const TIER_STEP_MAX_DROP_BPS: i32 = 1_500;
/// Minimum mean-star gain from a combo-weighted planner, in thousandths.
pub const PASSIVE_MEAN_STAR_GAIN_MILLI: i32 = 300;
/// Maximum Score/Theme Spearman coefficient, in thousandths.
pub const BOARD_DIVERGENCE_MAX_RHO_MILLI: i32 = 600;
/// Minimum frozen Theme qualification rate, in basis points.
pub const THEME_POLICY_MIN_BPS: u32 = 9_000;
/// Maximum identical pre-guardian level tuples shared by two realms.
pub const REALM_IDENTITY_MAX_SHARED_TUPLES: u32 = 5;
/// Number of pre-guardian tuples used by the realm-identity comparison.
pub const REALM_IDENTITY_TUPLES: usize = 9;
/// Minimum distinct kinds required in each constraint slot per realm.
pub const KIND_VARIETY_MIN_DISTINCT: usize = 4;
/// Maximum consecutive levels carrying one constraint kind.
pub const KIND_VARIETY_MAX_CONSECUTIVE: usize = 2;
/// Maximum allowed adjacent success-rate rise within a zone, in basis points.
pub const ZONE_MONOTONICITY_MAX_RISE_BPS: i32 = 1_000;
/// Minimum seed-omniscient apex reachability rate, in basis points.
pub const APEX_REACHABLE_MIN_BPS: u32 = 6_000;
/// Level-one lower naive apex-fact rate, in basis points.
pub const APEX_LUCKABLE_START_MIN_BPS: u32 = 500;
/// Level-one upper naive apex-fact rate, in basis points.
pub const APEX_LUCKABLE_START_MAX_BPS: u32 = 3_000;
/// Guardian lower naive apex-fact rate, in basis points.
pub const APEX_LUCKABLE_END_MIN_BPS: u32 = 100;
/// Guardian upper naive apex-fact rate, in basis points.
pub const APEX_LUCKABLE_END_MAX_BPS: u32 = 300;
/// Minimum third-star latch count resolving the setup conditional.
pub const APEX_HIT_MIN_EVENTS: u32 = 10;
/// Minimum success rate among planner runs without a third-star latch.
pub const APEX_OPTIONAL_MIN_BPS: u32 = 5_000;
/// Minimum no-latch run count resolving the optional conditional.
pub const APEX_OPTIONAL_MIN_EVENTS: u32 = 10;
/// Minimum recent-charge share among third-star latches, in basis points.
pub const APEX_SETUP_MIN_BPS: u32 = 6_000;
/// Minimum reroll spend count resolving the held-height median.
pub const REROLL_HELD_MIN_EVENTS: u32 = 20;
/// Lower per-run Arcade reroll grant rate, in basis points.
pub const REROLL_GRANT_MIN_BPS: u32 = 1_000;
/// Upper per-run Arcade reroll grant rate, in basis points.
pub const REROLL_GRANT_MAX_BPS: u32 = 4_000;
/// Maximum discarded share of all reroll grants, in basis points.
pub const REROLL_GRANT_MAX_DISCARD_BPS: u32 = 1_000;
