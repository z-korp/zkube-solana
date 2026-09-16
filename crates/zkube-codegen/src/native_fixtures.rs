//! Checked native/managed vectors. Synthetic starting snapshots are explicitly
//! labelled; they are not represented as proofs of an entire on-chain run.
use super::{CampaignCatalog, CampaignMap, EncodedLevel, constraint};
use serde_json::{Value, json};
use zkube_core::{
    Bonus, CORE_VERSION, Constraint, ConstraintKind, DAILY_MAX_MOVES, DAILY_THEMES, Grid, Guardian,
    ReplayCommitment, RulesHash, Run, RunConfig, RunEndReason, RunPhase, RunRules, StarRules,
    TierPolicy, daily_pair, daily_pair_index,
};
use zkube_core_host::{self as boundary, native};

pub fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(String::new(), |mut output, b| {
        write!(output, "{b:02x}").unwrap();
        output
    })
}
// A stable day exercises the native draw boundary against the core.
const PUBLICATION_DAY: u32 = 20_705;

fn daily_publication() -> Result<Value, String> {
    let day = PUBLICATION_DAY;
    let pair_index = u32::try_from(daily_pair_index(day))
        .map_err(|_| "Daily pair index exceeds the native u32 boundary")?;
    let (realm, objective) = daily_pair(day);
    let mut request = Request::new(12);
    request.put("Day", &day.to_le_bytes());
    let actual = native::dispatch(request.operation, &request.bytes)
        .map_err(|status| format!("Daily publication native query rejected: {status}"))?;
    let mut expected = pair_index.to_le_bytes().to_vec();
    expected.extend_from_slice(&[realm, objective.kind.tag(), objective.value]);
    if actual != expected {
        return Err("Daily publication native query disagrees with core draw".into());
    }
    Ok(json!({
        "day": day, "pairIndex": pair_index, "realm": realm,
        "objective": { "kind": objective.kind as u8, "value": objective.value },
        "maxMoves": DAILY_MAX_MOVES
    }))
}

fn local_randomness_vectors() -> Result<Vec<Value>, String> {
    let mut vectors = Vec::new();
    for seed in [b"zkube-local-daily-row-seed-v1".to_vec(), (0..32).collect()] {
        for counter in [0_u32, 1, 20_705, u32::MAX] {
            let expected = zkube_core::local_row_randomness(&seed, counter);
            let mut padded = [0; 32];
            padded[..seed.len()].copy_from_slice(&seed);
            let mut request = Request::new(22);
            request.put("Seed", &padded);
            request.put("SeedLength", &[u8::try_from(seed.len()).unwrap()]);
            request.put("Counter", &counter.to_le_bytes());
            let actual = native::dispatch(request.operation, &request.bytes)
                .map_err(|status| format!("Local row randomness rejected: {status}"))?;
            if actual != expected {
                return Err("Local row randomness differs across the native boundary".into());
            }
            vectors.push(
                json!({"seedHex": hex(&seed), "counter": counter, "outputHex": hex(&expected)}),
            );
        }
    }
    Ok(vectors)
}

fn daily_window_vectors() -> Vec<Value> {
    [0_u32, 1, 20_000, u32::MAX]
        .into_iter()
        .map(|day| {
            let mut request = Request::new(27);
            request.put("Day", &day.to_le_bytes());
            let (opens, closes, recovery) = zkube_core::daily_window(day);
            let expected = [
                opens.to_le_bytes(),
                closes.to_le_bytes(),
                recovery.to_le_bytes(),
            ]
            .concat();
            assert_eq!(native::dispatch(27, &request.bytes).unwrap(), expected);
            json!({"name": format!("daily-window-{day}"), "operation": 27,
            "requestHex": hex(&request.bytes), "responseHex": hex(&expected)})
        })
        .collect()
}

fn campaign_boundary_vectors(
    catalog: &CampaignCatalog,
    cases: &[Value],
) -> Result<Vec<Value>, String> {
    let mut vectors = Vec::new();
    let mut record = |name: String, request: Request, expected: Vec<u8>| -> Result<(), String> {
        let actual = native::dispatch(request.operation, &request.bytes)
            .map_err(|status| format!("{name}: {status}"))?;
        if actual != expected {
            return Err(format!("{name}: native response differs from core"));
        }
        vectors.push(json!({"name": name, "operation": request.operation,
            "requestHex": hex(&request.bytes), "responseHex": hex(&expected)}));
        Ok(())
    };
    for day in (0..160).chain([20_705, u32::MAX]) {
        let mut request = Request::new(12);
        request.put("Day", &day.to_le_bytes());
        let (realm, theme) = daily_pair(day);
        let mut expected = u32::try_from(daily_pair_index(day))
            .unwrap()
            .to_le_bytes()
            .to_vec();
        expected.extend_from_slice(&[realm, theme.kind.tag(), theme.value]);
        record(format!("daily-pair-{day}"), request, expected)?;
    }
    for value in [0, 1, 2, 3, 4, 16, 64, 85, 170, 192, 255] {
        let stars =
            zkube_core::CampaignStars::from_packed([value; zkube_core::CAMPAIGN_STAR_BYTES]);
        let mut request = Request::new(23);
        request.put("Stars", &stars.unpacked());
        record(
            format!("pack-stars-{value}"),
            request,
            stars.packed().to_vec(),
        )?;
        let mut request = Request::new(24);
        request.put("Stars", &stars.packed());
        record(
            format!("progress-{value}"),
            request,
            native::encode_campaign_progress(stars),
        )?;
    }
    for map in &catalog.maps {
        for (index, level) in map.levels.iter().enumerate() {
            let number = u8::try_from(index + 1).unwrap();
            let mut request = Request::new(25);
            request.put("Realm", &[map.map_id]);
            request.put("Level", &[number]);
            request.put("Tier", &[level.0]);
            request.put("Primary", &level.1);
            request.put("Secondary", &level.2);
            let config = RunConfig {
                rules: campaign_rules(map, number, *level)?,
                rules_hash: RulesHash([0; 32]),
                initial_replay: ReplayCommitment([0; 32]),
            };
            record(
                format!("campaign-rules-{}-{number}", map.map_id),
                request,
                native::encode_config_request(config),
            )?;
        }
    }
    for case in cases {
        let text = case["finalStateHex"].as_str().unwrap();
        let state = (0..text.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&text[i..i + 2], 16).map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        let run = boundary::decode_run_state(&state).map_err(|error| format!("{error:?}"))?;
        if !matches!(
            run.engine.phase,
            RunPhase::Finished | RunPhase::LevelComplete
        ) {
            continue;
        }
        for prior in [0, 3] {
            let mut stars = zkube_core::CampaignStars::new();
            stars.merge_level(1, 1, prior).unwrap();
            let mut request = Request::new(26);
            request.put("Stars", &stars.packed());
            request.put("Realm", &[1]);
            request.put("Level", &[1]);
            request.put("State", &state);
            stars
                .merge_level(1, 1, run.engine.latched_star_count())
                .unwrap();
            record(
                format!("record-{}-{prior}", case["name"].as_str().unwrap()),
                request,
                stars.packed().to_vec(),
            )?;
        }
    }
    Ok(vectors)
}

struct Request {
    operation: u32,
    bytes: Vec<u8>,
}
impl Request {
    fn new(operation: u32) -> Self {
        let schema = native::OPERATIONS
            .iter()
            .find(|op| op.id == operation)
            .unwrap();
        let mut bytes = vec![0; 2 + native::fields_len(schema.fields)];
        bytes[..2].copy_from_slice(&native::ABI_VERSION.to_le_bytes());
        Self { operation, bytes }
    }
    fn put(&mut self, name: &str, value: &[u8]) {
        let schema = native::OPERATIONS
            .iter()
            .find(|op| op.id == self.operation)
            .unwrap();
        let range = native::field_range(schema.fields, name);
        self.bytes[range.start + 2..range.end + 2].copy_from_slice(value);
    }
}

#[derive(Clone, Copy)]
enum Action {
    Vrf(u32, [u8; 32]),
    Move(u8, u8, u8),
    Bonus(u8, u8),
    Reroll,
    Finish(u8),
}

struct Trajectory {
    name: String,
    origin: &'static str,
    config: RunConfig,
    initial: Vec<u8>,
    state: Vec<u8>,
    steps: Vec<Value>,
}

impl Trajectory {
    fn new(name: &str, config: RunConfig, snapshot: Option<Run>) -> Result<Self, String> {
        let state = snapshot
            .map_or_else(
                || boundary::initialize_run(&boundary::encode_run_config(config)),
                |run| Ok(boundary::encode_run_state(run).to_vec()),
            )
            .map_err(|e| format!("{name}: {e:?}"))?;
        let mut value = Self {
            name: name.into(),
            origin: if snapshot.is_some() {
                "validatedSnapshot"
            } else {
                "opening"
            },
            config,
            initial: state.clone(),
            state,
            steps: Vec::new(),
        };
        let mut request = config_request(config);
        value.record(&request, &boundary::encode_run_config(config))?;
        request = Request::new(3);
        request.put("Config", &boundary::encode_run_config(config));
        let initialized = boundary::initialize_run(&boundary::encode_run_config(config))
            .map_err(|e| format!("{e:?}"))?;
        value.record(&request, &initialized)?;
        value.reconcile()?;
        Ok(value)
    }
    fn record(&mut self, request: &Request, expected: &[u8]) -> Result<(), String> {
        let actual = native::dispatch(request.operation, &request.bytes).map_err(|s| {
            format!(
                "{} operation {} rejected: {s}",
                self.name, request.operation
            )
        })?;
        if actual != expected {
            return Err(format!(
                "{} operation {} disagrees with existing safe boundary",
                self.name, request.operation
            ));
        }
        self.steps.push(json!({ "operation": request.operation, "requestHex": hex(&request.bytes), "responseHex": hex(&actual) }));
        Ok(())
    }
    fn run(&self) -> Run {
        boundary::decode_run_state(&self.state).unwrap()
    }
    fn apply(&mut self, action: Action) -> Result<(), String> {
        let before = self.run();
        let config = boundary::encode_run_config(self.config);
        let operation = match action {
            Action::Vrf(..) => 4,
            Action::Move(..) => 5,
            Action::Bonus(..) => 6,
            Action::Reroll => 7,
            Action::Finish(..) => 8,
        };
        let mut request = Request::new(operation);
        request.put("Config", &config);
        request.put("State", &self.state);
        request.put("Trace", &[1]);
        let expected = match action {
            Action::Vrf(counter, output) => {
                request.put("Counter", &counter.to_le_bytes());
                request.put("Output", &output);
                boundary::run_apply_vrf(&config, &self.state, counter, &output)
            }
            Action::Move(row, start, destination) => {
                request.put("Action", &before.action_counter.to_le_bytes());
                request.put("ExpectedMove", &before.engine.moves.to_le_bytes());
                request.put("Row", &[row]);
                request.put("Start", &[start]);
                request.put("Destination", &[destination]);
                boundary::run_play_move(
                    &config,
                    &self.state,
                    before.action_counter,
                    before.engine.moves,
                    row,
                    start,
                    destination,
                )
            }
            Action::Bonus(row, column) => {
                request.put("Action", &before.action_counter.to_le_bytes());
                request.put("Row", &[row]);
                request.put("Column", &[column]);
                boundary::run_apply_bonus(&config, &self.state, before.action_counter, row, column)
            }
            Action::Reroll => {
                request.put("Action", &before.action_counter.to_le_bytes());
                boundary::run_request_reroll(&config, &self.state, before.action_counter)
            }
            Action::Finish(reason) => {
                request.put("Reason", &[reason]);
                boundary::run_finish(&config, &self.state, reason)
            }
        }
        .map_err(|e| format!("{} action rejected: {e:?}", self.name))?;
        let traced = native::dispatch(operation, &request.bytes)
            .map_err(|s| format!("{} native action status {s}", self.name))?;
        if traced[10..10 + boundary::RUN_STATE_LEN] != expected {
            return Err(format!("{} tracing changed state", self.name));
        }
        self.record(&request, &traced)?;
        request.put("Trace", &[0]);
        let untraced = native::dispatch(operation, &request.bytes)
            .map_err(|s| format!("native untraced status {s}"))?;
        if untraced[10..] != expected {
            return Err("disabled tracing changed state".into());
        }
        self.record(&request, &untraced)?;
        self.state = expected;
        let mut summary = Request::new(9);
        summary.put("State", &self.state);
        self.record(&summary, &native::encode_summary(self.run()))?;
        self.reconcile()
    }
    fn reconcile(&mut self) -> Result<(), String> {
        if self.config.rules.stars.is_some() {
            return Ok(());
        }
        let run = self.run();
        let summary = native::encode_summary(run);
        let mut request = Request::new(2);
        request.put("Config", &boundary::encode_run_config(self.config));
        for field in native::SNAPSHOT_FIELDS {
            if native::SUMMARY_FIELDS.iter().any(|f| f.name == field.name) {
                request.put(
                    field.name,
                    &summary[native::field_range(native::SUMMARY_FIELDS, field.name)],
                );
            }
        }
        let pending = if run.engine.phase == RunPhase::AwaitingVrf {
            run.last_vrf_counter + 1
        } else {
            0
        };
        request.put(
            "VrfRequestCounter",
            &run.last_vrf_counter.max(pending).to_le_bytes(),
        );
        request.put("PendingVrfCounter", &pending.to_le_bytes());
        self.record(&request, &self.state.clone())
    }
    fn finish(self) -> Value {
        json!({ "name": self.name, "origin": self.origin, "configHex": hex(&boundary::encode_run_config(self.config)), "initialStateHex": hex(&self.initial), "finalStateHex": hex(&self.state), "finalReplayHex": hex(self.run().replay.as_bytes()), "steps": self.steps })
    }
}

fn config_request(config: RunConfig) -> Request {
    Request {
        operation: 1,
        bytes: native::encode_config_request(config),
    }
}

fn config(rules: RunRules, identity: u8) -> RunConfig {
    RunConfig {
        rules,
        rules_hash: RulesHash([identity; 32]),
        initial_replay: ReplayCommitment([identity.wrapping_add(1); 32]),
    }
}

fn best_move(run: Run, rules: RunRules) -> Option<Action> {
    let mut best = None;
    let mut best_score = 0;
    for row in 0..10 {
        for start in 0..8 {
            for destination in 0..8 {
                if start == destination {
                    continue;
                }
                let mut candidate = run;
                if let Ok(report) = candidate
                    .play_move_observed_with::<zkube_core::SoftwareSha256, _>(
                        rules,
                        run.action_counter,
                        run.engine.moves,
                        row,
                        start,
                        destination,
                        &mut zkube_core::NoPresentation,
                    )
                {
                    let score = u32::from(report.lines_cleared) * 100
                        + u32::from(candidate.engine.bonus_charges);
                    if best.is_none() || score > best_score {
                        best = Some(Action::Move(row, start, destination));
                        best_score = score;
                    }
                }
            }
        }
    }
    best
}

#[allow(clippy::too_many_lines)] // Keep the named scenario coverage explicit in one generator.
pub fn render(catalog: &CampaignCatalog) -> Result<String, String> {
    let mut cases = Vec::new();
    // Every published realm uses its real guardian/height rules in both modes.
    for map in &catalog.maps {
        for daily in [false, true] {
            let mut rules = campaign_rules(map, 1, map.levels[0])?;
            if daily {
                rules.tier = TierPolicy::Pressure;
                rules.stars = None;
                rules.objective = Some(DAILY_THEMES[usize::from(map.map_id)]);
                rules.max_moves = DAILY_MAX_MOVES;
            }
            let mode = if daily { "daily" } else { "campaign" };
            let mut t = Trajectory::new(
                &format!("realm-{}-{mode}", map.map_id),
                config(rules, map.map_id),
                None,
            )?;
            t.apply(Action::Vrf(1, [map.map_id; 32]))?;
            t.apply(Action::Reroll)?;
            t.apply(Action::Vrf(2, [map.map_id + 20; 32]))?;
            for turn in 0..4u8 {
                let run = t.run();
                if run.engine.phase != RunPhase::Playing {
                    break;
                }
                if let Some(action) = best_move(run, rules) {
                    t.apply(action)?;
                } else {
                    break;
                }
                if t.run().engine.phase == RunPhase::AwaitingVrf {
                    t.apply(Action::Vrf(t.run().last_vrf_counter + 1, [40 + turn; 32]))?;
                }
            }
            if matches!(
                t.run().engine.phase,
                RunPhase::Playing | RunPhase::AwaitingVrf
            ) {
                t.apply(Action::Finish(if daily { 4 } else { 3 }))?;
            }
            cases.push(t.finish());
        }
    }
    // Focused presentation evidence starts from validated snapshots. The prior
    // counters are explicit setup, not a claimed opening-to-action history.
    // All three use Balam's published guardian and height, with protocol themes.
    let balam = catalog
        .maps
        .iter()
        .find(|map| map.map_id == 8)
        .ok_or("missing published Balam realm")?;
    let balam_rules = campaign_rules(balam, 1, balam.levels[0])?;
    if balam_rules.guardian
        != (Guardian {
            bonus: Bonus::Totem,
            trigger: 1,
            threshold: 3,
        })
    {
        return Err("Balam evidence requires its published three-line Totem trigger".into());
    }
    let before_pressure = zkube_core::PRESSURE_STEP
        .checked_sub(1)
        .ok_or("pressure evidence requires a positive step")?;
    let pressure_moves =
        u16::try_from(before_pressure).map_err(|_| "pressure evidence move count exceeds u16")?;
    for (name, lines, theme, moves, score, prior_lines, prior_combo, gain, combo, charges, tier) in [
        (
            "balam-combo-2",
            2_u8,
            1_usize,
            1_u16,
            3_u32,
            2_u16,
            1_u8,
            3_u32,
            2_u8,
            0_u8,
            0_u8,
        ),
        ("balam-earned-totem", 3, 9, 0, 0, 0, 0, 6, 1, 1, 0),
        (
            "daily-pressure-crossing",
            1,
            0,
            pressure_moves,
            before_pressure,
            pressure_moves,
            0,
            1,
            0,
            0,
            1,
        ),
    ] {
        let rules = RunRules {
            tier: TierPolicy::Pressure,
            stars: None,
            // Classic is the absent objective in the canonical host contract.
            objective: (DAILY_THEMES[theme].kind != ConstraintKind::None)
                .then_some(DAILY_THEMES[theme]),
            max_moves: DAILY_MAX_MOVES,
            ..balam_rules
        };
        let cfg = config(rules, 98);
        let mut run = Run::new(cfg).map_err(|e| format!("{name}: {e:?}"))?;
        let mut cells = [0; 80];
        let top = usize::from(lines) * 8;
        cells[..top].fill(1);
        cells[top] = 1;
        run.engine.grid = Grid::try_from_cells(cells).map_err(|e| format!("{name}: {e:?}"))?;
        run.engine.next_row = Some([1, 0, 0, 0, 0, 0, 0, 0]);
        run.engine.phase = RunPhase::Playing;
        run.engine.moves = moves;
        run.action_counter = u32::from(moves);
        run.last_vrf_counter = u32::from(moves) + 1;
        run.engine.score = score;
        run.daily_score = score;
        run.pressure_score = score;
        run.current_tier = rules.current_tier(score);
        run.engine.level_lines_cleared = prior_lines;
        run.engine.combo_counter = prior_combo;
        run.engine.max_combo = if prior_combo > 0 { 2 } else { 0 };
        run.objective_total = u64::from(prior_combo);
        let mut t = Trajectory::new(name, cfg, Some(run))?;
        // One top-row drag clears the prepared full rows without a perfect clear.
        // Trajectory::apply checks traced/untraced state and native reconciliation.
        t.apply(Action::Move(lines, 0, 1))?;
        let after = t.run();
        let expected_objective = match theme {
            1 => 2,
            9 => 1,
            _ => 0,
        };
        if after.daily_score != score + gain
            || after.engine.score != score + gain
            || after.pressure_score != score + gain
            || after.current_tier != tier
            || after.engine.combo_counter != combo
            || after.engine.bonus_charges != charges
            || after.engine.charges_earned != charges
            || after.objective_total != expected_objective
            || after.engine.level_lines_cleared != prior_lines + u16::from(lines)
            || after.engine.moves != moves + 1
            || after.action_counter != u32::from(moves) + 1
            || after.engine.reroll_charges != run.engine.reroll_charges
            || after.engine.grid.is_empty()
            || after.engine.phase != RunPhase::AwaitingVrf
        {
            return Err(format!("{name}: native accepted feedback facts drifted"));
        }
        t.apply(Action::Vrf(after.last_vrf_counter + 1, [0x62; 32]))?;
        cases.push(t.finish());
    }
    let base = RunRules {
        guardian: Guardian {
            bonus: Bonus::Hammer,
            trigger: 0,
            threshold: 0,
        },
        starting_height: 3,
        max_moves: 100,
        tier: TierPolicy::Pressure,
        stars: None,
        objective: Some(DAILY_THEMES[10]),
    };
    for bonus in [Bonus::Hammer, Bonus::Totem, Bonus::Wave] {
        let rules = RunRules {
            guardian: Guardian {
                bonus,
                ..base.guardian
            },
            ..base
        };
        let cfg = config(rules, 91);
        let mut run = Run::new(cfg).map_err(|e| format!("{e:?}"))?;
        let mut cells = [0; 80];
        cells[..8].fill(1);
        cells[8..10].fill(2);
        run.engine.grid = Grid::try_from_cells(cells).unwrap();
        run.engine.next_row = Some([0, 1, 0, 0, 0, 0, 0, 0]);
        run.engine.phase = RunPhase::Playing;
        run.engine.bonus_charges = 1;
        run.engine.charges_earned = 1;
        run.last_vrf_counter = 1;
        let mut t = Trajectory::new(
            &format!("{bonus:?}-perfect-clear-continuation"),
            cfg,
            Some(run),
        )?;
        t.apply(Action::Bonus(1, 0))?;
        if !t.run().engine.grid.is_empty() || t.run().engine.reroll_charges != 2 {
            return Err("bonus scenario did not perfect-clear and earn a reroll".into());
        }
        t.apply(Action::Vrf(2, [0x42; 32]))?;
        t.apply(Action::Reroll)?;
        t.apply(Action::Finish(4))?;
        cases.push(t.finish());
    }
    // Observational perfect-clear feedback also exists when the reroll grant
    // is discarded at the cap. These are labelled snapshots, not full runs.
    for (name, bonus, charges) in [
        ("move-perfect-clear-grant", false, 1),
        (
            "move-perfect-clear-cap",
            false,
            zkube_core::BONUS_CHARGE_CAP,
        ),
        (
            "Hammer-perfect-clear-cap",
            true,
            zkube_core::BONUS_CHARGE_CAP,
        ),
    ] {
        let cfg = config(base, 94);
        let mut run = Run::new(cfg).map_err(|e| format!("{e:?}"))?;
        let mut cells = [0; 80];
        cells[0] = 1;
        if !bonus {
            cells[2..8].fill(1);
            cells[8] = 1;
        }
        run.engine.grid = Grid::try_from_cells(cells).unwrap();
        run.engine.next_row = Some([1; 8]);
        run.engine.phase = RunPhase::Playing;
        run.engine.bonus_charges = 1;
        run.engine.charges_earned = 1;
        run.engine.reroll_charges = charges;
        run.last_vrf_counter = 1;
        let mut t = Trajectory::new(name, cfg, Some(run))?;
        t.apply(if bonus {
            Action::Bonus(0, 0)
        } else {
            Action::Move(1, 0, 1)
        })?;
        if !t.run().engine.grid.is_empty()
            || t.run().engine.reroll_charges != (charges + 1).min(zkube_core::BONUS_CHARGE_CAP)
        {
            return Err("perfect-clear feedback snapshot did not preserve native grant/cap".into());
        }
        t.apply(Action::Vrf(2, [0x42; 32]))?;
        t.apply(Action::Finish(4))?;
        cases.push(t.finish());
    }
    // Independent star transitions plus their simultaneous completion.
    for (name, target, primary_count, expected_mask) in [
        ("score-latch", 1, 9, 1),
        ("shape-latch", 99, 2, 2),
        ("blow-latch", 99, 9, 4),
        ("all-star-completion", 1, 2, 7),
    ] {
        let stars = StarRules {
            points_required: target,
            primary: Constraint {
                kind: ConstraintKind::ClearLines,
                value: 0,
                required_count: primary_count,
            },
            secondary: Constraint {
                kind: ConstraintKind::PerfectClear,
                value: 0,
                required_count: 1,
            },
        };
        let rules = RunRules {
            tier: TierPolicy::Fixed(0),
            stars: Some(stars),
            objective: None,
            ..base
        };
        let cfg = config(rules, 92);
        let mut run = Run::new(cfg).map_err(|e| format!("star rules: {e:?}"))?;
        let mut cells = [0; 80];
        cells[..16].fill(1);
        cells[16..18].fill(2);
        // Keep a surviving block for the two single-latch cases.
        if expected_mask == 1 || expected_mask == 2 {
            cells[19] = 1;
        }
        run.engine.grid = Grid::try_from_cells(cells).unwrap();
        run.engine.next_row = Some([0, 1, 0, 0, 0, 0, 0, 0]);
        run.engine.phase = RunPhase::Playing;
        run.engine.bonus_charges = 1;
        run.engine.charges_earned = 1;
        run.last_vrf_counter = 1;
        let mut t = Trajectory::new(name, cfg, Some(run))?;
        t.apply(Action::Bonus(2, 0))?;
        if t.run().engine.latched_star_sources != expected_mask {
            return Err(format!(
                "{name} wrong latch mask {}",
                t.run().engine.latched_star_sources
            ));
        }
        if expected_mask != 7 {
            t.apply(Action::Finish(3))?;
        }
        cases.push(t.finish());
    }
    // Deadline after accepted reroll and move-budget exhaustion.
    let mut t = Trajectory::new("accepted-reroll-deadline", config(base, 94), None)?;
    t.apply(Action::Vrf(1, [1; 32]))?;
    t.apply(Action::Reroll)?;
    t.apply(Action::Finish(4))?;
    cases.push(t.finish());
    let rules = RunRules {
        max_moves: 1,
        ..base
    };
    let mut t = Trajectory::new("move-budget-exhaustion", config(rules, 95), None)?;
    t.apply(Action::Vrf(1, [1; 32]))?;
    t.apply(best_move(t.run(), rules).ok_or("no exhaustion move")?)?;
    if t.run().end_reason != Some(RunEndReason::Exhausted) {
        return Err("move-budget fixture did not exhaust".into());
    }
    cases.push(t.finish());
    let cfg = config(base, 96);
    let mut run = Run::new(cfg).map_err(|e| format!("{e:?}"))?;
    let mut cells = [0; 80];
    for row in 0..10 {
        cells[row * 8] = 1;
    }
    cells[3] = 1;
    run.engine.grid = Grid::try_from_cells(cells).unwrap();
    run.engine.next_row = Some([0, 1, 0, 0, 0, 0, 0, 0]);
    run.engine.phase = RunPhase::Playing;
    run.last_vrf_counter = 1;
    let mut t = Trajectory::new("blocked-eleventh-row", cfg, Some(run))?;
    t.apply(Action::Move(0, 3, 4))?;
    if t.run().end_reason != Some(RunEndReason::Exhausted) || !t.run().engine.grid.is_full() {
        return Err("overflow fixture did not preserve the full board".into());
    }
    cases.push(t.finish());
    // Display bounds are recovered snapshots, not claims that a 100-move run
    // can reach these metrics. Both configs still use published protocol rules.
    // Streak is Campaign-only; the Daily uses its actual TriggerFired theme.
    let campaign_map = &catalog.maps[3];
    let campaign = campaign_rules(campaign_map, 1, campaign_map.levels[0])?;
    if campaign.stars.unwrap().secondary.kind != ConstraintKind::Streak {
        return Err("display fixture requires the published long Campaign constraint".into());
    }
    let daily = RunRules {
        tier: TierPolicy::Pressure,
        stars: None,
        objective: Some(
            *DAILY_THEMES
                .iter()
                .find(|theme| theme.kind == ConstraintKind::TriggerFired)
                .ok_or("missing guardian Daily theme")?,
        ),
        max_moves: DAILY_MAX_MOVES,
        ..campaign
    };
    for (name, rules) in [
        ("display-boundary-daily", daily),
        ("display-long-campaign-constraint", campaign),
    ] {
        let cfg = config(rules, 97);
        let mut run = Run::new(cfg).map_err(|e| format!("display rules: {e:?}"))?;
        run.apply_vrf_observed_with::<zkube_core::SoftwareSha256, _>(
            rules,
            1,
            [0x61; 32],
            &mut zkube_core::NoPresentation,
        )
        .map_err(|e| format!("display opening: {e:?}"))?;
        if rules.is_pressure() {
            run.daily_score = u32::MAX;
            run.objective_total = u64::MAX;
            run.pressure_score = u32::MAX;
            run.current_tier = rules.current_tier(run.pressure_score);
            run.engine.score = u32::MAX;
            run.engine.moves = 99;
            run.action_counter = 99;
            run.last_vrf_counter = 100;
        }
        let mut t = Trajectory::new(name, cfg, Some(run))?;
        t.origin = "reconcile";
        let mut summary = Request::new(9);
        summary.put("State", &t.state);
        t.record(&summary, &native::encode_summary(t.run()))?;
        t.apply(Action::Finish(if rules.is_pressure() { 4 } else { 3 }))?;
        cases.push(t.finish());
    }
    serde_json::to_string_pretty(&json!({ "schemaVersion": 1, "coreVersion": CORE_VERSION,
            "dailyWindows": daily_window_vectors(), "campaignBoundary": campaign_boundary_vectors(catalog, &cases)?, "dailyPublication": daily_publication()?, "localRandomness": local_randomness_vectors()?, "cases": cases }))
    .map(|s| s + "\n")
    .map_err(|e| e.to_string())
}

fn campaign_rules(
    map: &CampaignMap,
    level_number: u8,
    level: EncodedLevel,
) -> Result<RunRules, String> {
    let realm = zkube_core::REALM_RULES
        .get(usize::from(map.map_id - 1))
        .ok_or("invalid realm")?;
    RunRules::campaign(
        *realm,
        level_number,
        level.0,
        constraint(level.1)?,
        constraint(level.2)?,
    )
    .ok_or_else(|| "invalid Campaign level".into())
}

#[cfg(test)]
mod tests {
    #[test]
    fn managed_fixture_inputs_retain_native_parity() {
        let catalog =
            serde_json::from_str(include_str!("../../../fixtures/campaign-catalog.json")).unwrap();
        super::render(&catalog).unwrap();
    }
}
