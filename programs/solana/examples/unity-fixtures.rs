//! Offline integration scenarios serialized by the program and the Rust core.
#[path = "unity_fixtures/accounts.rs"]
mod accounts;
#[path = "unity_fixtures/boards.rs"]
mod boards;
#[path = "unity_fixtures/device.rs"]
mod device;
#[path = "unity_fixtures/economy.rs"]
mod economy;
#[path = "unity_fixtures/runs.rs"]
mod runs;
#[path = "unity_fixtures/transactions.rs"]
mod transactions;
#[path = "unity_fixtures/ui.rs"]
mod ui;

use anchor_lang::prelude::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{io::Write, str::FromStr};

const NOW: i64 = 1_788_912_000;
const DAY: u32 = (NOW / zkube_core::SECONDS_PER_DAY) as u32;
const RUN_ID: u64 = 9_007_199_254_740_993;

fn owner() -> Pubkey {
    Pubkey::from_str("AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9").unwrap()
}
fn device() -> Pubkey {
    Pubkey::from_str("9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu").unwrap()
}
fn validator() -> Pubkey {
    Pubkey::new_from_array([3; 32])
}
fn blockhash() -> solana_hash::Hash {
    solana_hash::Hash::new_from_array([9; 32])
}
fn pda(seeds: &[&[u8]]) -> (Pubkey, u8) {
    Pubkey::find_program_address(seeds, &solana::ID)
}
fn encoded(bytes: impl AsRef<[u8]>) -> String {
    STANDARD.encode(bytes)
}

fn envelope<T: AccountSerialize>(address: Pubkey, account: &T, size: usize) -> Value {
    let mut bytes = Vec::new();
    account.try_serialize(&mut bytes).unwrap();
    assert!(bytes.len() <= size);
    bytes.resize(size, 0);
    json!({"address": address.to_string(), "owner": solana::ID.to_string(),
        "executable": false, "data": encoded(bytes)})
}

fn inputs() -> Value {
    json!({"owner": owner().to_string(), "device": device().to_string(),
        "validator": validator().to_string(), "now": NOW, "nowUnix": NOW,
        "day": DAY, "dayId": DAY, "runId": RUN_ID.to_string(), "nextRunId": RUN_ID.to_string(),
        "blockhash": blockhash().to_string(), "programId": solana::ID.to_string(), "delegationProgramId": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"})
}

fn run() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let accounts = accounts::scenarios();
    let transactions = transactions::scenarios();
    let mut account_rows = vec![];
    let mut player = envelope(
        accounts::player_address(),
        &accounts::player(RUN_ID, RUN_ID + 2),
        8 + solana::state::PlayerState::INIT_SPACE,
    );
    player["id"] = json!("player-valid");
    player["kind"] = json!("PlayerState");
    account_rows.push(player);
    let mut token = accounts["session"].clone();
    token["id"] = json!("session-valid");
    token["kind"] = json!("SessionTokenV2");
    account_rows.push(token);
    let mut runs = runs::scenarios();
    account_rows.extend(runs["cases"].as_array().unwrap().iter().cloned());
    runs["ownerConsume"] = json!({"daily": transactions::consume(owner())});
    runs["deviceConsume"] = json!({"daily": transactions::consume(device())});
    let mut read_accounts = accounts.clone();
    read_accounts["oldDaily"] = economy::finalized(DAY - 200);
    let mut read_inputs = inputs();
    read_inputs["oldDay"] = json!(DAY - 200);
    let mut board_cases: Vec<_> = [solana::state::DailyBoardKind::Score, solana::state::DailyBoardKind::Theme].into_iter().map(|kind| json!({
        "kind": if kind == solana::state::DailyBoardKind::Score { "score" } else { "theme" }, "variant": "sealed",
        "envelope": boards::board(DAY - 200, kind, false, true, false, owner()) })).collect();
    for row in &mut board_cases {
        row["daily"] = economy::finalized(DAY - 200);
    }
    board_cases.push(json!({"kind": "score", "variant": "empty", "daily": economy::finalized(DAY - 200), "envelope": boards::empty(DAY - 200)}));
    let output = json!({"schema": 1,
        "solana": {"inputs": inputs(), "accounts": account_rows, "transactions": transactions,
            "pdas": [{"id": "run-high-u64", "address": accounts::run_address(RUN_ID).to_string()}]},
        "plans": {"inputs": inputs(), "accounts": accounts, "runs": {"daily": runs::row("playing", RUN_ID)},
            "terminalRuns": {"daily": runs::row("finished", RUN_ID)}, "boards": boards::scenarios()},
        "runs": runs, "device": device::scenarios(), "economy": economy::scenarios(), "ui": ui::scenarios(),
        "reads": {"inputs": read_inputs, "accounts": read_accounts, "boardCases": board_cases}});
    std::io::stdout()
        .lock()
        .write_all((serde_json::to_string_pretty(&output)? + "\n").as_bytes())?;
    Ok(())
}

fn main() -> std::process::ExitCode {
    match run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("unity-fixtures: {error}; inspect fixtures/program-unity-v1.json");
            std::process::ExitCode::FAILURE
        }
    }
}
