use std::{collections::BTreeSet, fs, path::Path};

fn idl() -> serde_json::Value {
    serde_json::from_str(include_str!("../../../tools/chain/idl/solana.json")).unwrap()
}

#[test]
fn fresh_bootstrap_interface_is_locked() {
    let idl = idl();
    assert_eq!(idl["instructions"].as_array().unwrap().len(), 29);
    assert_eq!(idl["accounts"].as_array().unwrap().len(), 7);
}

#[test]
fn no_instruction_accepts_a_board_row() {
    // Board rows come only from a run's own terminal state when it is
    // consumed. No instruction takes a row, a list, or any struct argument a
    // caller could fill with one.
    let idl = idl();
    for instruction in idl["instructions"].as_array().unwrap() {
        let writes_a_board = instruction["accounts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|account| {
                account["writable"] == true
                    && account["name"].as_str().is_some_and(|name| name.ends_with("_board"))
            });
        for argument in instruction["args"].as_array().unwrap() {
            let kind = argument["type"].to_string();
            assert!(!kind.contains("ArenaBoardEntry"), "{}", instruction["name"]);
            // An instruction that can write a board takes at most which board
            // and which position: never data to put on it.
            assert!(
                !writes_a_board || ["\"u32\"", "\"u64\"", "{\"defined\":{\"name\":\"DailyBoardKind\"}}"]
                    .contains(&kind.as_str()),
                "{} takes {kind}",
                instruction["name"]
            );
        }
    }
    assert!(idl["instructions"]
        .as_array()
        .unwrap()
        .iter()
        .all(|instruction| instruction["name"] != "submit_arena_board_chunk"));
}

#[test]
fn undelegation_callback_is_constrained_to_its_buffer_pda() {
    let idl = idl();
    let callback = idl["instructions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|instruction| instruction["name"] == "process_undelegation")
        .unwrap();
    let accounts = callback["accounts"].as_array().unwrap();
    let buffer = accounts
        .iter()
        .find(|account| account["name"] == "buffer")
        .unwrap();
    let seeds = &buffer["pda"]["seeds"];
    assert_eq!(
        seeds[0]["value"],
        serde_json::json!(b"undelegate-buffer".to_vec())
    );
    assert_eq!(seeds[1]["kind"], "account");
    assert_eq!(seeds[1]["path"], "base_account");
    assert_eq!(buffer["pda"]["program"]["kind"], "const");
    let system = accounts
        .iter()
        .find(|account| account["name"] == "system_program")
        .unwrap();
    assert_eq!(system["address"], "11111111111111111111111111111111");
}

#[test]
fn every_program_capacity_has_an_sbf_test_at_its_maximum() {
    fn capacities(directory: &Path, output: &mut BTreeSet<String>) {
        for entry in fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                capacities(&path, output);
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                let source = fs::read_to_string(path).unwrap();
                for tail in source.split("const ").skip(1) {
                    let name = tail.split(':').next().unwrap().trim();
                    if name.ends_with("_CAPACITY") || name.starts_with("MAX_") {
                        output.insert(name.to_owned());
                    }
                }
            }
        }
    }
    let guards = [
        (
            "ARENA_BOARD_CAPACITY",
            "finalization_cuts_to_the_paying_rows_and_returns_the_excess_rent",
            "consume_keeps_both_boards_sorted_at_capacity",
        ),
        (
            "ARENA_DAILY_PLAYER_CAPACITY",
            "a_full_daily_admits_its_last_player_and_refuses_the_next",
            "finalization_sizes_a_full_daily_field_in_one_transaction",
        ),
    ];
    let mut actual = BTreeSet::new();
    capacities(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut actual,
    );
    assert_eq!(
        actual,
        guards
            .iter()
            .map(|(name, _, _)| (*name).to_owned())
            .collect()
    );
    let contracts = include_str!("sbf_contract.rs");
    for (capacity, allocation, compute) in guards {
        for (test, meter) in [(allocation, false), (compute, true)] {
            let marker = format!("#[test]\nfn {test}() {{");
            let body = contracts
                .split(&marker)
                .nth(1)
                .unwrap()
                .split("\n}")
                .next()
                .unwrap();
            assert!(
                body.contains(capacity),
                "{test} does not exercise {capacity}"
            );
            if meter {
                assert!(
                    body.contains("compute_units_consumed"),
                    "{test} does not meter compute"
                );
            }
        }
    }
}
