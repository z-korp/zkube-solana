//! Pure zKube game domain.
//!
//! This module deliberately has no Anchor account or CPI dependencies. The
//! on-chain handlers validate authorities/accounts and then call these state
//! transitions. Keeping the rules pure makes Cairo/Rust/TypeScript golden
//! fixtures possible and prevents the browser from becoming authoritative.

mod grid;
mod randomness;
mod rules;

pub use grid::{Bonus, Grid, GridError, Row, GRID_CELLS, GRID_HEIGHT, GRID_WIDTH};
pub use randomness::{row_from_vrf, BlockWeights, RandomnessError};
pub use rules::{
    calculate_level_stars, Constraint, ConstraintKind, EndlessRules, LevelRules, MoveReport,
    MutatorRules, RunEngine, RunError, RunPhase,
};
