//! The release gate is the loader a cluster runs, not a copy of its rules: the
//! pinned solana-bpf-loader-program deploys the ELF exactly as the upgradeable
//! loader's final deploy instruction does, verifying it and resolving every
//! syscall it imports against the pinned agave syscall registry.

use std::sync::Arc;

use anchor_lang::prelude::Pubkey;
use mollusk_svm::{program::ProgramCache, Mollusk};

const UPGRADEABLE_LOADER: Pubkey =
    Pubkey::from_str_const("BPFLoaderUpgradeab1e11111111111111111111111");

/// Deploys `elf` under a feature set with every feature gate on, or every one
/// off: the most conservative cluster, which has only the syscalls no gate holds.
pub fn deploy(elf: &[u8], every_gate_on: bool) -> Result<(), String> {
    let mut runtime = Mollusk::default();
    if !every_gate_on {
        runtime.feature_set = Default::default();
    }
    let environment = ProgramCache::new(&runtime.feature_set, &runtime.compute_budget)
        .program_runtime_environment;
    let mut loaded = Default::default();
    solana_bpf_loader_program::deploy_program(
        None,
        &mut loaded,
        Arc::new(environment),
        &solana::ID,
        &UPGRADEABLE_LOADER,
        elf.len(),
        elf,
        0,
    )
    .map(|_| ())
    .map_err(|error| format!("{error:?}"))
}
