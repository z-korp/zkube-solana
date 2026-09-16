//! Thin Solana adapter over the chain-neutral deterministic engine.
//!
//! All gameplay types and transitions are owned by `zkube-core`. Only hashing
//! is adapted so SBF uses Solana's SHA-256 syscall with the canonical schedule.

use crate::state::arcade::SolanaSha256;

pub fn sha256v(values: &[&[u8]]) -> [u8; 32] {
    zkube_core::sha256v_with::<SolanaSha256>(values)
}
