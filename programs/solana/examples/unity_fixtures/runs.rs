use super::*;
use solana::state::*;
use zkube_core::{ReplayCommitment, RulesHash, Run, RunConfig, RunEndReason, RunRules, TierPolicy};
use zkube_core_host::{encode_run_config, encode_run_state};

fn config() -> RunConfig {
    let daily = accounts::daily(DAY);
    let realm = zkube_core::REALM_RULES
        [usize::from(zkube_core::daily_pair_with::<SolanaSha256>(daily.day_id).0 - 1)];
    RunConfig {
        rules_hash: RulesHash(daily.rules_hash),
        initial_replay: ReplayCommitment([6; 32]),
        rules: RunRules {
            guardian: realm.guardian,
            starting_height: realm.starting_height,
            max_moves: zkube_core::DAILY_MAX_MOVES,
            tier: TierPolicy::Pressure,
            stars: None,
            objective: Some(zkube_core::daily_pair_with::<SolanaSha256>(daily.day_id).1),
        },
    }
}

pub fn state(phase: &str) -> Run {
    let config = config();
    let mut run = Run::new(config).unwrap();
    if phase == "prepared" {
        return run;
    }
    run.apply_vrf_observed_with::<zkube_core::SoftwareSha256, _>(
        config.rules,
        1,
        [8; 32],
        &mut zkube_core::NoPresentation,
    )
    .unwrap();
    if phase == "playing" {
        return run;
    }
    if phase == "moved" || phase == "movedRow" {
        let (row, start, destination) = daily_move();
        run.play_move_observed_with::<zkube_core::SoftwareSha256, _>(
            config.rules,
            0,
            0,
            row,
            start,
            destination,
            &mut zkube_core::NoPresentation,
        )
        .unwrap();
        if phase == "movedRow" {
            run.apply_vrf_observed_with::<zkube_core::SoftwareSha256, _>(
                config.rules,
                2,
                [9; 32],
                &mut zkube_core::NoPresentation,
            )
            .unwrap();
        }
        return run;
    }
    run.request_reroll(config.rules, 0).unwrap();
    if phase == "awaitingVrf" {
        return run;
    }
    run.apply_vrf_observed_with::<zkube_core::SoftwareSha256, _>(
        config.rules,
        2,
        [9; 32],
        &mut zkube_core::NoPresentation,
    )
    .unwrap();
    if phase == "finished" {
        run.finish_observed_with::<zkube_core::SoftwareSha256, _>(
            config.rules,
            RunEndReason::Abandoned,
            &mut zkube_core::NoPresentation,
        )
        .unwrap();
    }
    run
}

/// The move the moved rows play on the playing board: the first that clears a
/// line and leaves the run waiting for its row, else the first that leaves it so.
pub fn daily_move() -> (u8, u8, u8) {
    let (config, playing) = (config(), state("playing"));
    let mut first = None;
    for row in 0..10 {
        for start in 0..8 {
            for destination in 0..8 {
                let mut run = playing;
                let played = run.play_move_observed_with::<zkube_core::SoftwareSha256, _>(
                    config.rules,
                    0,
                    0,
                    row,
                    start,
                    destination,
                    &mut zkube_core::NoPresentation,
                );
                if played.is_err() || run.engine.phase != zkube_core::RunPhase::AwaitingVrf {
                    continue;
                }
                if run.engine.level_lines_cleared > 0 {
                    return (row, start, destination);
                }
                first.get_or_insert((row, start, destination));
            }
        }
    }
    first.expect("the playing board has a move")
}

pub fn account(phase: &str, id: u64) -> ActiveRun {
    let run = state(phase);
    let awaiting = phase == "awaitingVrf" || phase == "moved";
    let daily = accounts::daily(DAY);
    let mut active = ActiveRun {
        version: ACCOUNT_VERSION,
        owner: owner(),
        rent_payer: device(),
        daily_challenge: accounts::daily_address(DAY),
        run_id: id,
        rules_hash: run.rules_hash.0,
        deadline_at: NOW + zkube_core::DAILY_RUN_CLOSE_OFFSET,
        map_id: zkube_core::daily_pair_with::<SolanaSha256>(daily.day_id).0,
        rules: RealmRuleSnapshot::from_core(
            zkube_core::REALM_RULES
                [usize::from(zkube_core::daily_pair_with::<SolanaSha256>(daily.day_id).0 - 1)],
        ),
        daily_theme: DailyThemeSnapshot::from_core(config().rules.objective.unwrap()),
        vrf_request_counter: run.last_vrf_counter + u32::from(awaiting),
        pending_vrf_counter: if awaiting { 2 } else { 0 },
        bump: pda(&[
            ACTIVE_RUN_SEED,
            b"active",
            owner().as_ref(),
            &id.to_le_bytes(),
        ])
        .1,
        ..ActiveRun::default()
    };
    solana::instructions::run_lifecycle::write_run(&mut active, &run, NOW).unwrap();
    if phase == "prepared" {
        active.lifecycle = RunLifecycle::Prepared;
    }
    active
}

pub fn row(phase: &str, id: u64) -> Value {
    let run = state(phase);
    let mut row = envelope(
        accounts::run_address(id),
        &account(phase, id),
        8 + ActiveRun::INIT_SPACE,
    );
    row["id"] = json!(format!("active-daily-{phase}"));
    row["kind"] = json!("ActiveRun");
    row["expectedAuthority"] = json!(owner().to_string());
    row["token"] = json!({"config": encoded(encode_run_config(RunConfig { initial_replay: run.replay, ..config() })),
        "state": encoded(encode_run_state(run))});
    if phase == "moved" || phase == "movedRow" {
        let (at, start, destination) = daily_move();
        row["move"] = json!({"row": at, "start": start, "destination": destination});
    }
    row
}

fn profile(active: u64, next: u64) -> Value {
    envelope(
        accounts::player_address(),
        &accounts::player(active, next),
        8 + PlayerState::INIT_SPACE,
    )
}

pub fn scenarios() -> Value {
    let cases: Vec<_> = [
        "prepared",
        "playing",
        "awaitingVrf",
        "rerolled",
        "finished",
        "moved",
        "movedRow",
    ]
    .map(|phase| row(phase, RUN_ID))
    .into();
    let mut changed = account("playing", RUN_ID);
    changed.rules_hash = [5; 32];
    let changed = envelope(
        accounts::run_address(RUN_ID),
        &changed,
        8 + ActiveRun::INIT_SPACE,
    );
    json!({"cases": cases, "player": profile(RUN_ID, RUN_ID + 2),
        "consumedPlayers": {"daily": profile(0, RUN_ID + 2)},
        "initialPlayers": {"daily": profile(0, RUN_ID)},
        "preparedPlayers": {"daily": profile(RUN_ID, RUN_ID + 1)},
        "rulesChanged": changed, "successor": row("playing", RUN_ID + 1),
        "successorPrepared": row("prepared", RUN_ID + 1), "successorPlayer": profile(RUN_ID + 1, RUN_ID + 2),
        "successors": {"daily": {"run": row("playing", RUN_ID + 1), "player": profile(RUN_ID + 1, RUN_ID + 2)}}})
}
