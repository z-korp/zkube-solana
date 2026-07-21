use crate::*;
use serde::Deserialize;
use std::{string::String, vec::Vec};

#[derive(Deserialize)]
struct GoldenMutator {
    score_multiplier_x100: u16,
    combo_multiplier_x100: u16,
    line_clear_bonus: u16,
    perfect_clear_bonus: u16,
    star_threshold_modifier: u8,
    bonus_trigger_type: u8,
    bonus_threshold: u16,
}

#[derive(Deserialize)]
struct GoldenObjective {
    kind: String,
    parameter: u8,
    bonus_multiplier_x100: u16,
}

#[derive(Deserialize)]
struct GoldenPressure {
    thresholds: [u32; 7],
    score_multipliers_x100: [u16; 8],
    block_weights: [[u16; 5]; 8],
    starting_height: u8,
}

#[derive(Deserialize)]
struct GoldenRules {
    max_moves: u16,
    mutator: GoldenMutator,
    bonus: String,
    starting_bonus_charges: u8,
    objective: GoldenObjective,
    pressure: GoldenPressure,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum GoldenEvent {
    Vrf {
        request_counter: u32,
        output_hex: String,
    },
    Move {
        action: u32,
        expected_move: u16,
        row: u8,
        start: u8,
        destination: u8,
    },
    Bonus {
        action: u32,
        row: u8,
        column: u8,
    },
    DailyDeadline {
        action: u32,
    },
}

#[derive(Deserialize)]
struct GoldenMetrics {
    maximum_combo: u32,
    combo_scoring_actions: u32,
    total_combo_derived_score: u64,
    highest_action_score: u64,
    most_lines_in_action: u32,
    most_blocks_destroyed_in_action: u32,
    total_lines: u64,
    total_blocks_destroyed: u64,
    perfect_clears: u32,
}

#[derive(Deserialize)]
struct GoldenExpected {
    phase: String,
    deadline_finished: bool,
    score_eligible: bool,
    final_grid: Vec<u8>,
    next_row: Option<[u8; 8]>,
    base_score: u32,
    daily_score: u32,
    pressure_score: u32,
    current_difficulty: u8,
    moves: u16,
    action_counter: u32,
    last_vrf_counter: u32,
    combo_counter: u8,
    maximum_engine_combo: u8,
    primary_progress: u8,
    secondary_progress: u8,
    level_lines_cleared: u16,
    bonus: String,
    bonus_charges: u8,
    perfect_trigger_available: bool,
    starting_height_target: u8,
    metrics: GoldenMetrics,
    final_replay_hash_hex: String,
}

#[derive(Deserialize)]
struct GoldenDailyRun {
    version: u8,
    chain_domain_hex: String,
    challenge_id_hex: String,
    raw_account_hex: String,
    run_id: String,
    mode: String,
    rules: GoldenRules,
    rules_snapshot_hash_hex: String,
    day_id: u32,
    catalog_hash_hex: String,
    rules_version: u32,
    theme_id: u8,
    scoring_rule_id: u8,
    rules_hash_hex: String,
    player_id_hex: String,
    initial_replay_hash_hex: String,
    events: Vec<GoldenEvent>,
    expected: GoldenExpected,
}

fn decode_32(value: &str) -> [u8; 32] {
    assert_eq!(value.len(), 64);
    let mut result = [0u8; 32];
    for (index, byte) in result.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).unwrap();
    }
    result
}

fn bonus(value: &str) -> Option<Bonus> {
    match value {
        "none" => None,
        "hammer" => Some(Bonus::Hammer),
        "totem" => Some(Bonus::Totem),
        "wave" => Some(Bonus::Wave),
        _ => panic!("unknown bonus"),
    }
}

fn fixture_rules(value: &GoldenRules) -> DailyRunRules {
    let objective = match value.objective.kind.as_str() {
        "classic" => DailyObjective::Classic,
        "combo" => DailyObjective::Combo {
            minimum_lines: value.objective.parameter,
        },
        "exact_lines" => DailyObjective::ExactLines {
            lines: value.objective.parameter,
        },
        "blocks" => DailyObjective::Blocks {
            size: value.objective.parameter,
        },
        "clutch" => DailyObjective::Clutch {
            minimum_height: value.objective.parameter,
        },
        "clean" => DailyObjective::Clean {
            maximum_height: value.objective.parameter,
        },
        "survival" => DailyObjective::Survival,
        _ => panic!("unknown objective"),
    };
    DailyRunRules {
        max_moves: value.max_moves,
        mutator: MutatorRules {
            score_multiplier_x100: value.mutator.score_multiplier_x100,
            combo_multiplier_x100: value.mutator.combo_multiplier_x100,
            line_clear_bonus: value.mutator.line_clear_bonus,
            perfect_clear_bonus: value.mutator.perfect_clear_bonus,
            star_threshold_modifier: value.mutator.star_threshold_modifier,
            bonus_trigger_type: value.mutator.bonus_trigger_type,
            bonus_threshold: value.mutator.bonus_threshold,
        },
        bonus: bonus(&value.bonus),
        starting_bonus_charges: value.starting_bonus_charges,
        objective: DailyObjectiveRule {
            objective,
            bonus_multiplier_x100: value.objective.bonus_multiplier_x100,
        },
        pressure: DailyPressureRules {
            thresholds: value.pressure.thresholds,
            score_multipliers_x100: value.pressure.score_multipliers_x100,
            block_weights: value.pressure.block_weights,
            starting_height: value.pressure.starting_height,
        },
    }
}

#[allow(clippy::too_many_lines)]
fn verify_daily_run_vector(json: &str) {
    let fixture: GoldenDailyRun = serde_json::from_str(json).unwrap();
    assert_eq!(fixture.version, 1);
    let rules = fixture_rules(&fixture.rules);
    assert_eq!(
        rules.snapshot_hash().to_bytes(),
        decode_32(&fixture.rules_snapshot_hash_hex)
    );
    let rules_hash = daily_challenge_rules_hash(
        fixture.day_id,
        decode_32(&fixture.catalog_hash_hex),
        fixture.rules_version,
        fixture.theme_id,
        fixture.scoring_rule_id,
    );
    assert_eq!(rules_hash.to_bytes(), decode_32(&fixture.rules_hash_hex));
    let config = DailySimulationConfig {
        chain_domain: ChainDomain(decode_32(&fixture.chain_domain_hex)),
        challenge: ChallengeId(decode_32(&fixture.challenge_id_hex)),
        raw_account: decode_32(&fixture.raw_account_hex),
        run_id: fixture.run_id.parse().unwrap(),
        mode: match fixture.mode.as_str() {
            "ranked" => ReplayMode::Ranked,
            "practice" => ReplayMode::Practice,
            _ => panic!("unknown mode"),
        },
        rules_hash,
        rules,
    };
    let mut simulation = DailySimulation::new(config).unwrap();
    assert_eq!(simulation.rules_hash.to_bytes(), rules_hash.to_bytes());
    assert_eq!(
        simulation.player_id.to_bytes(),
        decode_32(&fixture.player_id_hex)
    );
    assert_eq!(
        simulation.replay.to_bytes(),
        decode_32(&fixture.initial_replay_hash_hex)
    );

    for event in fixture.events {
        match event {
            GoldenEvent::Vrf {
                request_counter,
                output_hex,
            } => simulation
                .apply_vrf(rules, request_counter, decode_32(&output_hex))
                .unwrap(),
            GoldenEvent::Move {
                action,
                expected_move,
                row,
                start,
                destination,
            } => simulation
                .play_move(rules, action, expected_move, row, start, destination)
                .unwrap(),
            GoldenEvent::Bonus {
                action,
                row,
                column,
            } => simulation.apply_bonus(rules, action, row, column).unwrap(),
            GoldenEvent::DailyDeadline { action } => {
                assert_eq!(action, simulation.action_counter);
                simulation.finish_at_deadline().unwrap();
            }
        }
    }

    let expected = fixture.expected;
    assert_eq!(expected.phase, "finished");
    assert_eq!(simulation.engine.phase, RunPhase::Finished);
    assert_eq!(simulation.deadline_finished, expected.deadline_finished);
    assert_eq!(simulation.is_score_eligible(), expected.score_eligible);
    assert_eq!(
        simulation.engine.grid.cells(),
        &<[u8; GRID_CELLS]>::try_from(expected.final_grid).unwrap()
    );
    assert_eq!(simulation.engine.next_row, expected.next_row);
    assert_eq!(simulation.engine.score, expected.base_score);
    assert_eq!(simulation.daily_score, expected.daily_score);
    assert_eq!(simulation.pressure_score, expected.pressure_score);
    assert_eq!(simulation.current_difficulty, expected.current_difficulty);
    assert_eq!(simulation.engine.moves, expected.moves);
    assert_eq!(simulation.action_counter, expected.action_counter);
    assert_eq!(simulation.last_vrf_counter, expected.last_vrf_counter);
    assert_eq!(simulation.engine.combo_counter, expected.combo_counter);
    assert_eq!(simulation.engine.max_combo, expected.maximum_engine_combo);
    assert_eq!(
        simulation.engine.primary_progress,
        expected.primary_progress
    );
    assert_eq!(
        simulation.engine.secondary_progress,
        expected.secondary_progress
    );
    assert_eq!(
        simulation.engine.level_lines_cleared,
        expected.level_lines_cleared
    );
    assert_eq!(simulation.engine.bonus, bonus(&expected.bonus));
    assert_eq!(simulation.engine.bonus_charges, expected.bonus_charges);
    assert_eq!(
        simulation.engine.perfect_trigger_available,
        expected.perfect_trigger_available
    );
    assert_eq!(
        simulation.engine.starting_height_target,
        expected.starting_height_target
    );
    assert_eq!(
        simulation.metrics,
        RunMetrics {
            maximum_combo: expected.metrics.maximum_combo,
            combo_scoring_actions: expected.metrics.combo_scoring_actions,
            total_combo_derived_score: expected.metrics.total_combo_derived_score,
            highest_action_score: expected.metrics.highest_action_score,
            most_lines_in_action: expected.metrics.most_lines_in_action,
            most_blocks_destroyed_in_action: expected.metrics.most_blocks_destroyed_in_action,
            total_lines: expected.metrics.total_lines,
            total_blocks_destroyed: expected.metrics.total_blocks_destroyed,
            perfect_clears: expected.metrics.perfect_clears,
        }
    );
    assert_eq!(
        simulation.replay.to_bytes(),
        decode_32(&expected.final_replay_hash_hex)
    );
}

#[test]
fn committed_daily_run_vector_recomputes_end_to_end() {
    verify_daily_run_vector(include_str!(
        "../../../fixtures/replays/golden-daily-run-v1.json"
    ));
}

#[test]
fn committed_zero_action_deadline_vector_recomputes_end_to_end() {
    verify_daily_run_vector(include_str!(
        "../../../fixtures/replays/golden-zero-action-deadline-v1.json"
    ));
}
