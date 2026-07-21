//! Thin Solana adapter over the chain-neutral deterministic engine.
//!
//! All gameplay types and transitions are owned by `zkube-core`. Only hashing
//! is adapted so SBF uses Solana's SHA-256 syscall with the canonical schedule.

pub use zkube_core::{
    calculate_level_stars, BlockWeights, Bonus, Constraint, ConstraintKind, EndlessRules, Grid,
    GridError, LevelRules, MoveReport, MutatorRules, OpeningLayout, RandomnessError, Row,
    RunEngine, RunError, RunPhase, GRID_CELLS, GRID_HEIGHT, GRID_WIDTH, MAX_OPENING_HEIGHT,
    MIN_OPENING_HEIGHT,
};

use crate::state::arcade::SolanaSha256;

pub fn sha256v(values: &[&[u8]]) -> [u8; 32] {
    zkube_core::sha256v_with::<SolanaSha256>(values)
}

pub fn opening_from_vrf(
    randomness: [u8; 32],
    request_counter: u32,
    rules_hash: [u8; 32],
    height: u8,
    weights: BlockWeights,
) -> Result<OpeningLayout, RandomnessError> {
    zkube_core::opening_from_vrf_with::<SolanaSha256>(
        randomness,
        request_counter,
        rules_hash,
        height,
        weights,
    )
}

pub fn row_from_vrf(
    randomness: [u8; 32],
    request_counter: u32,
    weights: BlockWeights,
) -> Result<Row, RandomnessError> {
    zkube_core::row_from_vrf_with::<SolanaSha256>(randomness, request_counter, weights)
}
