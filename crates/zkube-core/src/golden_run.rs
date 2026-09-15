use crate::*;
use serde::Deserialize;
use std::{string::String, vec::Vec};

#[derive(Deserialize)]
struct GoldenGuardian {
    bonus: String,
    trigger: u8,
    threshold: u16,
}

#[derive(Deserialize)]
struct GoldenObjective {
    kind: String,
    parameter: u8,
}

#[derive(Deserialize)]
struct GoldenRules {
    max_moves: u16,
    guardian: GoldenGuardian,
    starting_height: u8,
    objective: GoldenObjective,
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
struct GoldenExpected {
    phase: String,
    end_reason: String,
    score_eligible: bool,
    final_grid: Vec<u8>,
    next_row: Option<[u8; 8]>,
    base_score: u32,
    daily_score: u32,
    objective_total: u64,
    pressure_score: u32,
    current_tier: u8,
    moves: u16,
    action_counter: u32,
    last_vrf_counter: u32,
    combo_counter: u8,
    streak: u8,
    maximum_engine_combo: u8,
    primary_progress: u8,
    secondary_progress: u8,
    level_lines_cleared: u16,
    bonus: String,
    bonus_charges: u8,
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
    content_version: u32,
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

fn fixture_rules(value: &GoldenRules) -> RunRules {
    let kind = match value.objective.kind.as_str() {
        "classic" => ConstraintKind::None,
        "combos_of_at_least" => ConstraintKind::CombosOfAtLeast,
        "combos_of_exactly" => ConstraintKind::CombosOfExactly,
        "break_blocks" => ConstraintKind::BreakBlocks,
        "trigger_fired" => ConstraintKind::TriggerFired,
        "bonus_lines" => ConstraintKind::BonusLines,
        "bonus_breaks" => ConstraintKind::BonusBreaks,
        "clutch_clears" => ConstraintKind::ClutchClears,
        "clean_clears" => ConstraintKind::CleanClears,
        _ => panic!("unknown objective"),
    };
    RunRules {
        guardian: Guardian {
            bonus: bonus(&value.guardian.bonus).unwrap(),
            trigger: value.guardian.trigger,
            threshold: value.guardian.threshold,
        },
        starting_height: value.starting_height,
        max_moves: value.max_moves,
        tier: TierPolicy::Pressure,
        stars: None,
        objective: (kind != ConstraintKind::None).then_some(DailyTheme {
            kind,
            value: value.objective.parameter,
        }),
    }
}

#[allow(clippy::too_many_lines)]
fn verify_daily_run_vector(json: &str) {
    let fixture: GoldenDailyRun = serde_json::from_str(json).unwrap();
    assert_eq!(fixture.version, 2);
    assert_eq!(fixture.content_version, CATALOG_VERSION);
    let rules = fixture_rules(&fixture.rules);
    assert_eq!(
        rules.snapshot_hash().to_bytes(),
        decode_32(&fixture.rules_snapshot_hash_hex)
    );
    let rules_hash = daily_rules_hash(
        fixture.day_id,
        rules.guardian,
        rules.starting_height,
        DailyTheme {
            kind: rules
                .objective
                .map_or(ConstraintKind::None, |theme| theme.kind),
            value: rules.objective.map_or(0, |theme| theme.value),
        },
    );
    assert_eq!(rules_hash.to_bytes(), decode_32(&fixture.rules_hash_hex));
    let domain = ChainDomain(decode_32(&fixture.chain_domain_hex));
    let challenge = ChallengeId(decode_32(&fixture.challenge_id_hex));
    let player_id = derive_player_id(domain, decode_32(&fixture.raw_account_hex));
    let mode = match fixture.mode.as_str() {
        "ranked" => ReplayMode::Ranked,
        _ => panic!("unknown mode"),
    };
    let initial_replay = ReplayCommitment::initial(
        domain,
        challenge,
        rules_hash,
        player_id,
        fixture.run_id.parse().unwrap(),
        mode,
    );
    let config = RunConfig {
        rules_hash,
        rules,
        initial_replay,
    };
    let mut simulation = Run::new(config).unwrap();
    assert_eq!(simulation.rules_hash.to_bytes(), rules_hash.to_bytes());
    assert_eq!(player_id.to_bytes(), decode_32(&fixture.player_id_hex));
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
            } => {
                simulation
                    .play_move(rules, action, expected_move, row, start, destination)
                    .unwrap();
            }
            GoldenEvent::Bonus {
                action,
                row,
                column,
            } => {
                simulation.apply_bonus(rules, action, row, column).unwrap();
            }
            GoldenEvent::DailyDeadline { action } => {
                assert_eq!(action, simulation.action_counter);
                simulation.finish(rules, RunEndReason::Deadline).unwrap();
            }
        }
    }

    let expected = fixture.expected;
    assert_eq!(expected.phase, "finished");
    assert_eq!(simulation.engine.phase, RunPhase::Finished);
    assert_eq!(expected.end_reason, "deadline");
    assert_eq!(simulation.end_reason, Some(RunEndReason::Deadline));
    assert_eq!(simulation.is_score_eligible(), expected.score_eligible);
    assert_eq!(
        simulation.engine.grid.cells(),
        &<[u8; GRID_CELLS]>::try_from(expected.final_grid).unwrap()
    );
    assert_eq!(simulation.engine.next_row, expected.next_row);
    assert_eq!(simulation.engine.score, expected.base_score);
    assert_eq!(simulation.daily_score, expected.daily_score);
    assert_eq!(simulation.objective_total, expected.objective_total);
    assert_eq!(simulation.pressure_score, expected.pressure_score);
    assert_eq!(simulation.current_tier, expected.current_tier);
    assert_eq!(simulation.engine.moves, expected.moves);
    assert_eq!(simulation.action_counter, expected.action_counter);
    assert_eq!(simulation.last_vrf_counter, expected.last_vrf_counter);
    assert_eq!(simulation.engine.combo_counter, expected.combo_counter);
    assert_eq!(simulation.engine.streak, expected.streak);
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
