use std::{collections::BTreeSet, fs, path::Path};

fn idl() -> serde_json::Value {
    serde_json::from_str(include_str!("../../../tools/chain/idl/solana.json")).unwrap()
}

#[test]
fn fresh_bootstrap_interface_is_locked() {
    let idl = idl();
    assert_eq!(idl["instructions"].as_array().unwrap().len(), 30);
    assert_eq!(idl["accounts"].as_array().unwrap().len(), 7);
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
            "cadence_funding_creates_exact_boards_through_the_full_capacity",
            "full_board_finalization_stays_below_one_million_compute_units",
        ),
        (
            "ARENA_BOARD_CHUNK_CAPACITY",
            "cadence_funding_creates_exact_boards_through_the_full_capacity",
            "cadence_funding_creates_exact_boards_through_the_full_capacity",
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
