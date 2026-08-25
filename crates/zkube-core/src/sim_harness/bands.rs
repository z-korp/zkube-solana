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

/// Maximum unique Markov states the omniscient oracle may visit per seed.
pub const ORACLE_NODE_BUDGET: usize = 20_000;

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
