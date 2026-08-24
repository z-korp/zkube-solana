//! Deterministic, feature-gated balance instrumentation.
//!
//! A ply is one accepted player action: a move, a board bonus, or a reroll
//! request. VRF callbacks are environment transitions and do not consume a
//! ply. Every candidate is evaluated by copying the simulation and invoking
//! its real transition; no grid, scoring, trigger, pressure, or constraint rule
//! is reproduced here. Candidate search is one ply deep and never observes a
//! future VRF output. Equal policy values are broken by a policy-only SHA-256
//! stream, while Daily VRF bytes come from a separately domain-separated
//! stream.
//!
//! The player models are deliberately small and auditable:
//! - `Naive` chooses uniformly among legal moves and spends a usable bonus on
//!   every fourth ply. It rerolls every third eligible ply.
//! - `LineClearer` maximizes lines, then a perfect clear, then lower resulting
//!   height, neutral engine points, and destroyed blocks.
//! - `DailyScore` maximizes the exact one-ply change in `daily_score`, then
//!   lines, lower height, and theme score.
//! - `Theme` maximizes the exact one-ply change in `objective_total`, then
//!   Daily score, lines, and lower height.
//! - `CampaignConstraints` maximizes completion, primary and secondary
//!   progress, engine score, lines, then lower height.
//!
//! A non-naive model spends a board bonus only when a legal bonus transition
//! has a strictly better policy value than its best move and either clears a
//! line, makes a perfect clear, lowers occupied height by at least two, or
//! advances a Campaign constraint. It rerolls only when its best legal move
//! clears no line and raises occupied height. All policy values and field-model
//! accounting are integers.

use crate::{
    Bonus, CampaignEndReason, CampaignError, CampaignRules, CampaignSimulation,
    CampaignSimulationConfig, ChainDomain, ChallengeId, Constraint, ConstraintKind, DailyObjective,
    DailyObjectiveRule, DailyPressureRules, DailyRunRules, DailySimulation, DailySimulationConfig,
    GRID_HEIGHT, GRID_WIDTH, Grid, MoveReport, MutatorRules, ReplayMode, RulesHash, RunPhase,
    Sha256Provider, SimulationError, SoftwareSha256, daily_pool_entry_index,
};
use serde::{Deserialize, Serialize};
use std::{
    fmt::Write as _,
    format,
    string::{String, ToString},
    vec,
    vec::Vec,
};

const HARNESS_VRF_DOMAIN: &[u8] = b"zkube-sim-harness-vrf-v1";
const HARNESS_POLICY_DOMAIN: &[u8] = b"zkube-sim-harness-policy-v1";
const HARNESS_DECISION_DOMAIN: &[u8] = b"zkube-sim-harness-decision-v1";
const HARNESS_CAMPAIGN_SEED_DOMAIN: &[u8] = b"zkube-sim-harness-campaign-seed-v1";
const HARNESS_DAILY_RULES_DOMAIN: &[u8] = b"zkube-sim-harness-daily-rules-v1";
const HARNESS_FIELD_DOMAIN: &[u8] = b"zkube-sim-harness-field-v1";
const DAILY_SCORING_INDEXES: [usize; 10] = [0, 1, 3, 6, 10, 12, 14, 2, 5, 9];
const MAX_HARNESS_PLIES: u32 = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SeedPartition {
    Tuning,
    Holdout,
}

impl SeedPartition {
    const fn tag(self) -> u8 {
        match self {
            Self::Tuning => 0,
            Self::Holdout => 1,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlayerModel {
    Naive,
    LineClearer,
    DailyScore,
    Theme,
    CampaignConstraints,
}

impl PlayerModel {
    const fn tag(self) -> u8 {
        match self {
            Self::Naive => 0,
            Self::LineClearer => 1,
            Self::DailyScore => 2,
            Self::Theme => 3,
            Self::CampaignConstraints => 4,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminalCause {
    Completion,
    Overflow,
    MoveBudget,
    Deadline,
    Abandoned,
    EngineStall,
}

/// Run termination is classified in this order: completion, overflow while
/// inserting the consumed preview, move budget, explicit deadline, abandon.
/// The order matters because Campaign completion intentionally wins when the
/// same action both satisfies the level and would otherwise overflow. An
/// `EngineStall` is recorded only when the real transition path leaves a
/// non-terminal run with no legal next action; it is a regression sentinel,
/// not a simulated terminal rule.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub mode: String,
    pub catalog_id: u16,
    pub family: u8,
    pub difficulty_band: u8,
    pub authored_rules_valid: bool,
    pub model: PlayerModel,
    pub partition: SeedPartition,
    pub seed: u64,
    pub terminal_cause: TerminalCause,
    pub actions: u32,
    pub moves: u16,
    pub engine_score: u32,
    pub pressure_score: u32,
    pub daily_score: u32,
    pub objective_total: u64,
    pub final_height: u8,
    pub max_difficulty: u8,
    pub tier_actions: [u16; 8],
    pub charges_earned_before_cap: u32,
    pub charges_spent: u16,
    pub charges_discarded_at_cap: u16,
    pub bonuses_used: u16,
    pub rerolls_used: u16,
    pub decision_digest_hex: String,
    pub primary_progress: u8,
    pub secondary_progress: u8,
    pub stars: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DailyCatalogEntry {
    pub id: u8,
    pub family: u8,
    pub authored_rules_valid: bool,
    pub rules: DailyRunRules,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CampaignCatalogLevel {
    pub catalog_id: u16,
    pub map_id: u8,
    pub level_id: u8,
    pub rules: CampaignRules,
}

#[derive(Clone, Copy, Debug, Default)]
struct Counters {
    charges_earned: u32,
    charges_spent: u16,
    charges_discarded: u16,
    bonuses_used: u16,
    rerolls_used: u16,
    max_difficulty: u8,
    tier_actions: [u16; 8],
    decision_commitment: [u8; 32],
}

impl Counters {
    fn observe(
        &mut self,
        action: ActionKind,
        before_charges: u8,
        spent: u8,
        after_charges: u8,
        report: MoveReport,
    ) {
        self.observe_decision(action);
        let earned = report.harness_charges_earned;
        self.charges_earned = self.charges_earned.saturating_add(u32::from(earned));
        self.charges_spent = self.charges_spent.saturating_add(u16::from(spent));
        let uncapped = u16::from(before_charges.saturating_sub(spent)) + u16::from(earned);
        self.charges_discarded = self
            .charges_discarded
            .saturating_add(uncapped.saturating_sub(u16::from(after_charges)));
        let tier = usize::from(report.difficulty_at_action.min(7));
        self.tier_actions[tier] = self.tier_actions[tier].saturating_add(1);
        self.max_difficulty = self.max_difficulty.max(report.difficulty_at_action);
    }

    fn observe_decision(&mut self, action: ActionKind) {
        let encoded = action.encoded();
        self.decision_commitment =
            SoftwareSha256::hashv(&[HARNESS_DECISION_DOMAIN, &self.decision_commitment, &encoded]);
    }
}

#[derive(Clone, Copy, Debug)]
enum ActionKind {
    Move { row: u8, start: u8, destination: u8 },
    Bonus { row: u8, column: u8 },
    Reroll,
}

impl ActionKind {
    const fn encoded(self) -> [u8; 4] {
        match self {
            Self::Move {
                row,
                start,
                destination,
            } => [1, row, start, destination],
            Self::Bonus { row, column } => [2, row, column, 0],
            Self::Reroll => [3, 0, 0, 0],
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct DailyCandidate {
    action: ActionKind,
    next: DailySimulation,
    report: MoveReport,
    key: [i64; 8],
}

#[derive(Clone, Copy, Debug)]
struct CampaignCandidate {
    action: ActionKind,
    next: CampaignSimulation,
    report: MoveReport,
    key: [i64; 8],
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CampaignFixture {
    content_version: u32,
    difficulty_weights: [[u16; 5]; 8],
    maps: Vec<CampaignFixtureMap>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CampaignFixtureMap {
    map_id: u8,
    rules: [u16; 10],
    levels: Vec<CampaignFixtureLevel>,
}

type CampaignFixtureLevel = (u32, u16, u8, [u8; 3], [u8; 3]);

/// Load the authored Campaign catalog used by production codegen.
///
/// # Panics
///
/// Panics only when the repository fixture is malformed; its normal codegen
/// validation catches the same condition before a release can be built.
#[must_use]
pub fn campaign_catalog() -> Vec<CampaignCatalogLevel> {
    let fixture: CampaignFixture =
        serde_json::from_str(include_str!("../../../fixtures/campaign-v2.json"))
            .expect("Campaign fixture must parse");
    let mut levels = Vec::with_capacity(100);
    for map in fixture.maps {
        let bonus = bonus_from_tag(map.rules[5]);
        for (level_index, level) in map.levels.into_iter().enumerate() {
            let level_id = u8::try_from(level_index + 1).expect("ten Campaign levels fit u8");
            levels.push(CampaignCatalogLevel {
                catalog_id: u16::from(map.map_id) * 100 + u16::from(level_id),
                map_id: map.map_id,
                level_id,
                rules: CampaignRules {
                    level: crate::LevelRules {
                        points_required: level.0,
                        max_moves: level.1,
                        primary: constraint_from_tuple(level.3),
                        secondary: constraint_from_tuple(level.4),
                    },
                    mutator: MutatorRules {
                        score_multiplier_x100: map.rules[0],
                        combo_multiplier_x100: map.rules[1],
                        line_clear_bonus: map.rules[2],
                        perfect_clear_bonus: map.rules[3],
                        star_threshold_modifier: u8::try_from(map.rules[4])
                            .expect("validated Campaign star modifier fits u8"),
                        bonus_trigger_type: u8::try_from(map.rules[6])
                            .expect("validated Campaign trigger fits u8"),
                        bonus_threshold: map.rules[7],
                    },
                    bonus,
                    starting_bonus_charges: u8::try_from(map.rules[8])
                        .expect("validated Campaign charges fit u8"),
                    starting_height: u8::try_from(map.rules[9])
                        .expect("validated Campaign height fits u8"),
                    level_difficulty: level.2,
                    block_weights: fixture.difficulty_weights,
                },
            });
        }
    }
    assert_eq!(fixture.content_version, 2);
    levels
}

/// Snapshot the ten currently-authored Daily entries. Production publication
/// validates their realm/passive fields against the same Campaign fixture; the
/// only Daily-specific authored choice is the scoring-rule index below.
///
/// # Panics
///
/// Panics only when the repository fixture is malformed; codegen validation
/// rejects the same condition.
#[must_use]
pub fn daily_catalog() -> Vec<DailyCatalogEntry> {
    let fixture: CampaignFixture =
        serde_json::from_str(include_str!("../../../fixtures/campaign-v2.json"))
            .expect("Campaign fixture must parse");
    fixture
        .maps
        .into_iter()
        .zip(DAILY_SCORING_INDEXES)
        .map(|(map, scoring_index)| {
            let (family, objective) = daily_objective(scoring_index);
            let rules = DailyRunRules {
                max_moves: crate::DAILY_MAX_MOVES,
                mutator: MutatorRules {
                    score_multiplier_x100: map.rules[0],
                    combo_multiplier_x100: map.rules[1],
                    line_clear_bonus: map.rules[2],
                    perfect_clear_bonus: map.rules[3],
                    star_threshold_modifier: u8::try_from(map.rules[4])
                        .expect("validated star modifier fits u8"),
                    bonus_trigger_type: u8::try_from(map.rules[6])
                        .expect("validated trigger fits u8"),
                    bonus_threshold: map.rules[7],
                },
                bonus: bonus_from_tag(map.rules[5]),
                starting_bonus_charges: u8::try_from(map.rules[8])
                    .expect("validated charges fit u8"),
                starting_height: u8::try_from(map.rules[9]).expect("validated height fits u8"),
                objective,
                pressure: DailyPressureRules::canonical(),
            };
            let authored_rules_valid = rules.is_valid();
            DailyCatalogEntry {
                id: map.map_id,
                family,
                authored_rules_valid,
                rules,
            }
        })
        .collect()
}

fn bonus_from_tag(tag: u16) -> Option<Bonus> {
    match tag {
        0 => None,
        1 => Some(Bonus::Hammer),
        2 => Some(Bonus::Totem),
        3 => Some(Bonus::Wave),
        _ => panic!("unknown authored bonus tag {tag}"),
    }
}

fn constraint_from_tuple(tuple: [u8; 3]) -> Constraint {
    let kind = match tuple[0] {
        0 => ConstraintKind::None,
        1 => ConstraintKind::ComboLines,
        2 => ConstraintKind::BreakBlocks,
        3 => ConstraintKind::ComboMeter,
        tag => panic!("unknown authored constraint tag {tag}"),
    };
    Constraint {
        kind,
        value: tuple[1],
        required_count: tuple[2],
    }
}

fn daily_objective(index: usize) -> (u8, DailyObjectiveRule) {
    let (family, objective, multiplier) = match index {
        0 => (0, DailyObjective::Classic, 0),
        1 => (1, DailyObjective::Combo { minimum_lines: 2 }, 200),
        2 => (1, DailyObjective::Combo { minimum_lines: 3 }, 1_250),
        3 => (2, DailyObjective::ExactLines { lines: 1 }, 100),
        4 => (2, DailyObjective::ExactLines { lines: 2 }, 250),
        5 => (2, DailyObjective::ExactLines { lines: 3 }, 1_250),
        6 => (3, DailyObjective::Blocks { size: 1 }, 50),
        7 => (3, DailyObjective::Blocks { size: 2 }, 125),
        8 => (3, DailyObjective::Blocks { size: 3 }, 140),
        9 => (3, DailyObjective::Blocks { size: 4 }, 200),
        10 => (4, DailyObjective::Clutch { minimum_height: 6 }, 200),
        11 => (4, DailyObjective::Clutch { minimum_height: 7 }, 270),
        12 => (5, DailyObjective::Clean { maximum_height: 2 }, 450),
        13 => (5, DailyObjective::Clean { maximum_height: 3 }, 250),
        14 => (6, DailyObjective::Survival, 100),
        _ => panic!("unknown Daily scoring index {index}"),
    };
    (
        family,
        DailyObjectiveRule {
            objective,
            bonus_multiplier_x100: multiplier,
        },
    )
}

/// Run one authored Daily through its real simulation and VRF paths.
///
/// # Errors
///
/// Returns an error if an authored rule or selected engine transition fails.
pub fn run_daily(
    entry: DailyCatalogEntry,
    model: PlayerModel,
    partition: SeedPartition,
    seed: u64,
) -> Result<RunRecord, SimulationError> {
    let rules = entry.rules;
    let identity = [entry.id; 32];
    let config = DailySimulationConfig {
        chain_domain: ChainDomain([0x51; 32]),
        challenge: ChallengeId([entry.id; 32]),
        raw_account: identity,
        run_id: seed,
        mode: ReplayMode::Ranked,
        // The harness identity pairs seeds within each authored entry and
        // partition. It is not a publishable protocol rules hash.
        rules_hash: RulesHash(SoftwareSha256::hashv(&[
            HARNESS_DAILY_RULES_DOMAIN,
            &[entry.id, partition.tag()],
        ])),
        rules,
    };
    let mut simulation = DailySimulation::new(config)?;
    simulation.apply_vrf(rules, 1, vrf_bytes(seed, entry.id, 1))?;
    let (simulation, counters, terminal_cause) =
        play_daily_to_terminal(simulation, rules, entry.id, model, seed)?;
    Ok(RunRecord {
        mode: String::from("daily"),
        catalog_id: u16::from(entry.id),
        family: entry.family,
        // Daily has one global pressure profile; zero distinguishes it from
        // Campaign's authored level-difficulty axis in combined reports.
        difficulty_band: 0,
        authored_rules_valid: entry.authored_rules_valid,
        model,
        partition,
        seed,
        terminal_cause,
        actions: simulation.action_counter,
        moves: simulation.engine.moves,
        engine_score: simulation.engine.score,
        pressure_score: simulation.pressure_score,
        daily_score: simulation.daily_score,
        objective_total: simulation.objective_total,
        final_height: simulation.engine.grid.occupied_height(),
        max_difficulty: counters.max_difficulty,
        tier_actions: counters.tier_actions,
        charges_earned_before_cap: counters.charges_earned,
        charges_spent: counters.charges_spent,
        charges_discarded_at_cap: counters.charges_discarded,
        bonuses_used: counters.bonuses_used,
        rerolls_used: counters.rerolls_used,
        decision_digest_hex: bytes_to_hex(counters.decision_commitment),
        primary_progress: simulation.engine.primary_progress,
        secondary_progress: simulation.engine.secondary_progress,
        stars: 0,
    })
}

fn play_daily_to_terminal(
    mut simulation: DailySimulation,
    rules: DailyRunRules,
    entry_id: u8,
    model: PlayerModel,
    seed: u64,
) -> Result<(DailySimulation, Counters, TerminalCause), SimulationError> {
    let mut counters = Counters::default();
    let mut terminal = None;

    while terminal.is_none() && simulation.action_counter < MAX_HARNESS_PLIES {
        if simulation.engine.phase == RunPhase::AwaitingVrf {
            let counter = simulation.last_vrf_counter.saturating_add(1);
            simulation.apply_vrf(rules, counter, vrf_bytes(seed, entry_id, counter))?;
            continue;
        }
        if simulation.engine.phase == RunPhase::Finished {
            terminal = Some(TerminalCause::MoveBudget);
            break;
        }

        let moves = daily_move_candidates(&simulation, rules, model);
        let best_move = choose_daily(&moves, seed, simulation.action_counter, model)
            .ok_or(SimulationError::InvalidPhase)?;

        if simulation.engine.reroll_available
            && should_reroll(model, simulation.action_counter, &best_move.report)
        {
            simulation.request_reroll(rules, simulation.action_counter)?;
            counters.rerolls_used = counters.rerolls_used.saturating_add(1);
            counters.observe_decision(ActionKind::Reroll);
            continue;
        }

        let bonuses = daily_bonus_candidates(&simulation, rules, model);
        let best_bonus = choose_daily(&bonuses, seed, simulation.action_counter, model);
        let selected = if should_spend_daily_bonus(model, &best_move, best_bonus.as_ref()) {
            best_bonus.unwrap_or(best_move)
        } else {
            best_move
        };
        let before_charges = simulation.engine.bonus_charges;
        let spent = u8::from(matches!(selected.action, ActionKind::Bonus { .. }));
        simulation = selected.next;
        counters.observe(
            selected.action,
            before_charges,
            spent,
            simulation.engine.bonus_charges,
            selected.report,
        );
        if spent > 0 {
            counters.bonuses_used = counters.bonuses_used.saturating_add(1);
        }
        if simulation.engine.phase == RunPhase::Finished {
            terminal = Some(if selected.report.harness_preview_insertion_blocked {
                TerminalCause::Overflow
            } else {
                TerminalCause::MoveBudget
            });
        }
    }

    let terminal_cause = if let Some(cause) = terminal {
        cause
    } else {
        if matches!(
            simulation.engine.phase,
            RunPhase::Playing | RunPhase::AwaitingVrf
        ) {
            simulation.finish_at_deadline()?;
        }
        TerminalCause::Deadline
    };
    Ok((simulation, counters, terminal_cause))
}

/// Run one authored Campaign level through its exact offline simulation.
///
/// # Errors
///
/// Returns an error if an authored rule or selected engine transition fails.
pub fn run_campaign(
    level: CampaignCatalogLevel,
    model: PlayerModel,
    partition: SeedPartition,
    seed: u64,
) -> Result<RunRecord, CampaignError> {
    let seed_bytes = SoftwareSha256::hashv(&[
        HARNESS_CAMPAIGN_SEED_DOMAIN,
        &seed.to_le_bytes(),
        &[partition.tag(), level.map_id, level.level_id],
    ]);
    let config = CampaignSimulationConfig {
        content_version: 2,
        content_hash: SoftwareSha256::hashv(&[b"zkube-sim-harness-campaign-content-v1"]),
        map_id: level.map_id,
        level_id: level.level_id,
        attempt: seed,
        seed: seed_bytes,
        rules: level.rules,
    };
    let mut simulation = CampaignSimulation::new(config)?;
    let mut counters = Counters::default();
    let mut last_blocked = false;
    let mut engine_stalled = false;

    while !simulation.is_terminal() && simulation.action_counter < MAX_HARNESS_PLIES {
        let moves = campaign_move_candidates(simulation, config, model);
        let Some(best_move) = choose_campaign(&moves, seed, simulation.action_counter, model)
        else {
            engine_stalled = true;
            break;
        };
        if simulation.engine.reroll_available
            && should_reroll(model, simulation.action_counter, &best_move.report)
        {
            simulation.request_reroll(config)?;
            counters.rerolls_used = counters.rerolls_used.saturating_add(1);
            counters.observe_decision(ActionKind::Reroll);
            continue;
        }
        let bonuses = campaign_bonus_candidates(simulation, config, model);
        let best_bonus = choose_campaign(&bonuses, seed, simulation.action_counter, model);
        let selected =
            if should_spend_campaign_bonus(model, &simulation, &best_move, best_bonus.as_ref()) {
                best_bonus.unwrap_or(best_move)
            } else {
                best_move
            };
        let before_charges = simulation.engine.bonus_charges;
        let spent = u8::from(matches!(selected.action, ActionKind::Bonus { .. }));
        simulation = selected.next;
        counters.observe(
            selected.action,
            before_charges,
            spent,
            simulation.engine.bonus_charges,
            selected.report,
        );
        if spent > 0 {
            counters.bonuses_used = counters.bonuses_used.saturating_add(1);
        }
        last_blocked = selected.report.harness_preview_insertion_blocked;
    }

    if !simulation.is_terminal() && !engine_stalled {
        simulation.abandon(config)?;
    }
    let terminal_cause = if engine_stalled {
        TerminalCause::EngineStall
    } else {
        match simulation.end_reason {
            Some(CampaignEndReason::Completed) => TerminalCause::Completion,
            Some(CampaignEndReason::Exhausted) if last_blocked => TerminalCause::Overflow,
            Some(CampaignEndReason::Exhausted) => TerminalCause::MoveBudget,
            Some(CampaignEndReason::Abandoned) | None => TerminalCause::Abandoned,
        }
    };
    Ok(RunRecord {
        mode: String::from("campaign"),
        catalog_id: level.catalog_id,
        family: constraint_family(level.rules.level.primary),
        difficulty_band: level.rules.level_difficulty,
        authored_rules_valid: true,
        model,
        partition,
        seed,
        terminal_cause,
        actions: simulation.action_counter,
        moves: simulation.engine.moves,
        engine_score: simulation.engine.score,
        pressure_score: 0,
        daily_score: 0,
        objective_total: 0,
        final_height: simulation.engine.grid.occupied_height(),
        max_difficulty: counters.max_difficulty,
        tier_actions: counters.tier_actions,
        charges_earned_before_cap: counters.charges_earned,
        charges_spent: counters.charges_spent,
        charges_discarded_at_cap: counters.charges_discarded,
        bonuses_used: counters.bonuses_used,
        rerolls_used: counters.rerolls_used,
        decision_digest_hex: bytes_to_hex(counters.decision_commitment),
        primary_progress: simulation.engine.primary_progress,
        secondary_progress: simulation.engine.secondary_progress,
        stars: simulation.earned_stars,
    })
}

fn constraint_family(constraint: Constraint) -> u8 {
    match constraint.kind {
        ConstraintKind::None => 0,
        ConstraintKind::ComboLines => 1,
        ConstraintKind::BreakBlocks => 2,
        ConstraintKind::ComboMeter => 3,
    }
}

fn daily_move_candidates(
    simulation: &DailySimulation,
    rules: DailyRunRules,
    model: PlayerModel,
) -> Vec<DailyCandidate> {
    let mut candidates = Vec::new();
    for (row, start, destination) in legal_move_coordinates(simulation.engine.grid) {
        let mut next = *simulation;
        if let Ok(report) = next.harness_play_move(
            rules,
            simulation.action_counter,
            simulation.engine.moves,
            row,
            start,
            destination,
        ) {
            candidates.push(DailyCandidate {
                action: ActionKind::Move {
                    row,
                    start,
                    destination,
                },
                key: daily_key(model, simulation, &next, report),
                next,
                report,
            });
        }
    }
    candidates
}

fn daily_bonus_candidates(
    simulation: &DailySimulation,
    rules: DailyRunRules,
    model: PlayerModel,
) -> Vec<DailyCandidate> {
    if simulation.engine.bonus_charges == 0 || simulation.engine.bonus.is_none() {
        return Vec::new();
    }
    let mut candidates = Vec::new();
    for (row, column) in occupied_coordinates(simulation.engine.grid) {
        let mut next = *simulation;
        if let Ok(report) = next.harness_apply_bonus(rules, simulation.action_counter, row, column)
        {
            candidates.push(DailyCandidate {
                action: ActionKind::Bonus { row, column },
                key: daily_key(model, simulation, &next, report),
                next,
                report,
            });
        }
    }
    candidates
}

fn campaign_move_candidates(
    simulation: CampaignSimulation,
    config: CampaignSimulationConfig,
    model: PlayerModel,
) -> Vec<CampaignCandidate> {
    let mut candidates = Vec::new();
    for (row, start, destination) in legal_move_coordinates(simulation.engine.grid) {
        let mut next = simulation;
        if let Ok(mut report) =
            next.play_move(config, simulation.engine.moves, row, start, destination)
        {
            report.difficulty_at_action = simulation.current_difficulty;
            candidates.push(CampaignCandidate {
                action: ActionKind::Move {
                    row,
                    start,
                    destination,
                },
                key: campaign_key(model, simulation, next, report),
                next,
                report,
            });
        }
    }
    candidates
}

fn campaign_bonus_candidates(
    simulation: CampaignSimulation,
    config: CampaignSimulationConfig,
    model: PlayerModel,
) -> Vec<CampaignCandidate> {
    if simulation.engine.bonus_charges == 0 || simulation.engine.bonus.is_none() {
        return Vec::new();
    }
    let mut candidates = Vec::new();
    for (row, column) in occupied_coordinates(simulation.engine.grid) {
        let mut next = simulation;
        if let Ok(mut report) = next.apply_bonus(config, row, column) {
            report.difficulty_at_action = simulation.current_difficulty;
            candidates.push(CampaignCandidate {
                action: ActionKind::Bonus { row, column },
                key: campaign_key(model, simulation, next, report),
                next,
                report,
            });
        }
    }
    candidates
}

fn legal_move_coordinates(grid: Grid) -> Vec<(u8, u8, u8)> {
    let mut actions = Vec::new();
    for row in 0..GRID_HEIGHT {
        let Some(cells) = grid.row(row) else {
            continue;
        };
        let mut start = 0usize;
        while start < GRID_WIDTH {
            let size = usize::from(cells[start]);
            if size == 0 {
                start += 1;
                continue;
            }
            if size > 4 || start + size > GRID_WIDTH {
                break;
            }
            for destination in 0..=GRID_WIDTH - size {
                actions.push((
                    u8::try_from(row).expect("grid row fits u8"),
                    u8::try_from(start).expect("grid column fits u8"),
                    u8::try_from(destination).expect("grid column fits u8"),
                ));
            }
            start += size;
        }
    }
    actions
}

fn occupied_coordinates(grid: Grid) -> Vec<(u8, u8)> {
    let mut coordinates = Vec::new();
    for row in 0..GRID_HEIGHT {
        if let Some(cells) = grid.row(row) {
            for (column, cell) in cells.iter().enumerate() {
                if *cell != 0 {
                    coordinates.push((
                        u8::try_from(row).expect("grid row fits u8"),
                        u8::try_from(column).expect("grid column fits u8"),
                    ));
                }
            }
        }
    }
    coordinates
}

fn daily_key(
    model: PlayerModel,
    before: &DailySimulation,
    after: &DailySimulation,
    report: MoveReport,
) -> [i64; 8] {
    let daily_delta = i64::from(after.daily_score.saturating_sub(before.daily_score));
    let theme_delta = i64::try_from(after.objective_total.saturating_sub(before.objective_total))
        .unwrap_or(i64::MAX);
    let lower_height = -i64::from(report.height_after);
    let destroyed = report
        .blocks_destroyed_by_size
        .into_iter()
        .map(i64::from)
        .sum::<i64>();
    match model {
        PlayerModel::Naive => [0; 8],
        PlayerModel::LineClearer | PlayerModel::CampaignConstraints => [
            i64::from(report.lines_cleared),
            i64::from(report.perfect_clear),
            lower_height,
            i64::from(report.neutral_points_earned),
            destroyed,
            daily_delta,
            theme_delta,
            0,
        ],
        PlayerModel::DailyScore => [
            daily_delta,
            i64::from(report.lines_cleared),
            lower_height,
            theme_delta,
            i64::from(report.perfect_clear),
            destroyed,
            0,
            0,
        ],
        PlayerModel::Theme => [
            theme_delta,
            daily_delta,
            i64::from(report.lines_cleared),
            lower_height,
            i64::from(report.perfect_clear),
            destroyed,
            0,
            0,
        ],
    }
}

fn campaign_key(
    model: PlayerModel,
    before: CampaignSimulation,
    after: CampaignSimulation,
    report: MoveReport,
) -> [i64; 8] {
    let primary = i64::from(
        after
            .engine
            .primary_progress
            .saturating_sub(before.engine.primary_progress),
    );
    let secondary = i64::from(
        after
            .engine
            .secondary_progress
            .saturating_sub(before.engine.secondary_progress),
    );
    match model {
        PlayerModel::Naive => [0; 8],
        PlayerModel::CampaignConstraints => [
            i64::from(after.end_reason == Some(CampaignEndReason::Completed)),
            primary,
            secondary,
            i64::from(report.points_earned),
            i64::from(report.lines_cleared),
            -i64::from(report.height_after),
            i64::from(report.perfect_clear),
            0,
        ],
        _ => [
            i64::from(report.lines_cleared),
            i64::from(report.perfect_clear),
            -i64::from(report.height_after),
            i64::from(report.points_earned),
            primary,
            secondary,
            0,
            0,
        ],
    }
}

fn choose_daily(
    candidates: &[DailyCandidate],
    seed: u64,
    action: u32,
    model: PlayerModel,
) -> Option<DailyCandidate> {
    choose_by_key(candidates, seed, action, model, |candidate| candidate.key).copied()
}

fn choose_campaign(
    candidates: &[CampaignCandidate],
    seed: u64,
    action: u32,
    model: PlayerModel,
) -> Option<CampaignCandidate> {
    choose_by_key(candidates, seed, action, model, |candidate| candidate.key).copied()
}

fn choose_by_key<T, F>(
    candidates: &[T],
    seed: u64,
    action: u32,
    model: PlayerModel,
    key: F,
) -> Option<&T>
where
    F: Fn(&T) -> [i64; 8],
{
    let best = candidates.iter().map(&key).max()?;
    let ties = candidates
        .iter()
        .filter(|candidate| key(candidate) == best)
        .collect::<Vec<_>>();
    let index = policy_index(seed, action, model, ties.len());
    ties.get(index).copied()
}

fn should_reroll(model: PlayerModel, action: u32, best_move: &MoveReport) -> bool {
    if model == PlayerModel::Naive {
        return action % 3 == 2;
    }
    best_move.lines_cleared == 0 && best_move.height_after > best_move.height_before
}

fn should_spend_daily_bonus(
    model: PlayerModel,
    best_move: &DailyCandidate,
    best_bonus: Option<&DailyCandidate>,
) -> bool {
    let Some(bonus) = best_bonus else {
        return false;
    };
    if model == PlayerModel::Naive {
        return best_move.next.action_counter % 4 == 0;
    }
    bonus.key > best_move.key && bonus_is_material(best_move.report.height_before, bonus.report)
}

fn should_spend_campaign_bonus(
    model: PlayerModel,
    before: &CampaignSimulation,
    best_move: &CampaignCandidate,
    best_bonus: Option<&CampaignCandidate>,
) -> bool {
    let Some(bonus) = best_bonus else {
        return false;
    };
    if model == PlayerModel::Naive {
        return before.action_counter % 4 == 3;
    }
    let advances_constraint = bonus.next.engine.primary_progress > before.engine.primary_progress
        || bonus.next.engine.secondary_progress > before.engine.secondary_progress;
    bonus.key > best_move.key
        && (advances_constraint
            || bonus_is_material(before.engine.grid.occupied_height(), bonus.report))
}

fn bonus_is_material(height_before: u8, report: MoveReport) -> bool {
    report.lines_cleared > 0
        || report.perfect_clear
        || height_before.saturating_sub(report.height_after) >= 2
}

fn policy_index(seed: u64, action: u32, model: PlayerModel, len: usize) -> usize {
    if len <= 1 {
        return 0;
    }
    let digest = SoftwareSha256::hashv(&[
        HARNESS_POLICY_DOMAIN,
        &seed.to_le_bytes(),
        &action.to_le_bytes(),
        &[model.tag()],
    ]);
    let value = u64::from_le_bytes(digest[..8].try_into().expect("eight digest bytes"));
    usize::try_from(value % len as u64).expect("modulo result fits usize")
}

fn vrf_bytes(seed: u64, entry_id: u8, counter: u32) -> [u8; 32] {
    SoftwareSha256::hashv(&[
        HARNESS_VRF_DOMAIN,
        &seed.to_le_bytes(),
        &[entry_id],
        &counter.to_le_bytes(),
    ])
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawSummary {
    pub entry_count: u8,
    pub measured_days: u32,
    pub adjacent_repeats: u32,
    pub shortest_repeat_gap: u32,
    pub longest_repeat_gap: u32,
    pub appearances: Vec<u32>,
}

/// Measure actual protocol draw offsets after one predecessor warm-up day.
///
/// # Errors
///
/// Returns an error for an unsupported pool size or day range.
pub fn draw_summary(entry_count: u8, measured_days: u32) -> Result<DrawSummary, String> {
    if entry_count == 0 || measured_days == 0 {
        return Err(String::from(
            "entry count and measured days must be positive",
        ));
    }
    let mut appearances = vec![0u32; usize::from(entry_count)];
    let mut last_seen = vec![None; usize::from(entry_count)];
    let mut previous = None;
    let mut adjacent_repeats = 0u32;
    let mut shortest = u32::MAX;
    let mut longest = 0u32;
    // Day zero supplies the predecessor pot and previous draw; reported days
    // start at one so no first-day special case can flatter repeat behavior.
    for day in 0..=measured_days {
        let index = usize::from(
            daily_pool_entry_index(0, day, entry_count)
                .map_err(|error| format!("draw failed: {error:?}"))?,
        );
        if day > 0 {
            appearances[index] = appearances[index].saturating_add(1);
            if previous == Some(index) {
                adjacent_repeats = adjacent_repeats.saturating_add(1);
            }
            if let Some(last) = last_seen[index] {
                let gap = day.saturating_sub(last);
                shortest = shortest.min(gap);
                longest = longest.max(gap);
            }
        }
        last_seen[index] = Some(day);
        previous = Some(index);
    }
    Ok(DrawSummary {
        entry_count,
        measured_days,
        adjacent_repeats,
        shortest_repeat_gap: if shortest == u32::MAX { 0 } else { shortest },
        longest_repeat_gap: longest,
        appearances,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldAssumptions {
    pub seed: u64,
    pub measured_days: u16,
    pub wallets: u32,
    /// Persistent naive, line-clearer, Daily-score, and Theme wallet shares.
    pub ability_mix_bps: [u16; 4],
    pub base_attendance_bps: [u16; 4],
    pub streak_response_bps_per_day: u16,
    pub multi_entry_wallet_bps: u16,
    pub maximum_entries_per_attendance: u8,
    /// Reorder to this many post-entry Kredits when the current balance cannot
    /// cover the day's intended entries.
    pub reorder_target: u8,
}

impl FieldAssumptions {
    #[must_use]
    pub const fn low_retention() -> Self {
        Self {
            seed: 0x4610,
            measured_days: 90,
            wallets: 2_000,
            ability_mix_bps: [2_500, 3_000, 3_000, 1_500],
            base_attendance_bps: [700, 1_200, 1_500, 1_700],
            streak_response_bps_per_day: 8,
            multi_entry_wallet_bps: 1_000,
            maximum_entries_per_attendance: 3,
            reorder_target: 5,
        }
    }

    #[must_use]
    pub const fn base() -> Self {
        Self {
            seed: 0x4611,
            measured_days: 90,
            wallets: 2_000,
            ability_mix_bps: [2_000, 3_000, 3_000, 2_000],
            base_attendance_bps: [1_200, 2_000, 2_400, 2_600],
            streak_response_bps_per_day: 15,
            multi_entry_wallet_bps: 2_500,
            maximum_entries_per_attendance: 4,
            reorder_target: 7,
        }
    }

    #[must_use]
    pub const fn streak_sensitive() -> Self {
        Self {
            seed: 0x4612,
            measured_days: 90,
            wallets: 2_000,
            ability_mix_bps: [1_500, 3_000, 3_000, 2_500],
            base_attendance_bps: [1_800, 2_700, 3_000, 3_200],
            streak_response_bps_per_day: 35,
            multi_entry_wallet_bps: 4_000,
            maximum_entries_per_attendance: 5,
            reorder_target: 10,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldSummary {
    pub assumptions: FieldAssumptions,
    pub pack_sizes: Vec<u8>,
    pub warmup_entries: u32,
    pub measured_entries: u64,
    pub unique_attending_wallets: u32,
    pub entries_by_ability: [u64; 4],
    pub attending_wallet_days_by_ability: [u64; 4],
    pub pack_purchases: Vec<u64>,
    pub ending_kredits: u64,
    pub longest_streak: u16,
}

#[derive(Clone, Copy, Debug, Default)]
struct WalletState {
    ability: usize,
    balance: u16,
    streak: u16,
    attended_ever: bool,
}

/// Simulate wallet attendance and Kredit reorders without assigning unbacked
/// entries. Ability is persistent. Attendance probability is the model's base
/// rate plus the live streak response, capped at 100%. An attending wallet
/// wants one entry, or a deterministic 2..=N when its multi-entry draw hits.
/// If its balance is insufficient it buys the smallest available pack that
/// reaches the reorder target; if no pack can do so it buys the largest pack
/// repeatedly. Day zero is stateful warm-up and excluded from reported totals.
///
/// # Errors
///
/// Returns an error for invalid probability totals, pack sizes, or bounds.
pub fn simulate_field(
    assumptions: FieldAssumptions,
    pack_sizes: &[u8],
) -> Result<FieldSummary, String> {
    if assumptions.wallets == 0
        || assumptions.measured_days == 0
        || assumptions
            .ability_mix_bps
            .iter()
            .map(|value| u32::from(*value))
            .sum::<u32>()
            != 10_000
        || assumptions
            .base_attendance_bps
            .iter()
            .any(|value| *value > 10_000)
        || assumptions.maximum_entries_per_attendance == 0
        || pack_sizes.is_empty()
        || pack_sizes.contains(&0)
        || !pack_sizes.windows(2).all(|pair| pair[0] < pair[1])
    {
        return Err(String::from("invalid field assumptions or pack sizes"));
    }
    let mut wallets = (0..assumptions.wallets)
        .map(|wallet| WalletState {
            ability: field_ability(assumptions, wallet),
            ..WalletState::default()
        })
        .collect::<Vec<_>>();
    let mut warmup_entries = 0u32;
    let mut measured_entries = 0u64;
    let mut entries_by_ability = [0u64; 4];
    let mut wallet_days = [0u64; 4];
    let mut pack_purchases = vec![0u64; pack_sizes.len()];
    let mut longest_streak = 0u16;

    for day in 0..=u32::from(assumptions.measured_days) {
        for (wallet_id, wallet) in (0..assumptions.wallets).zip(wallets.iter_mut()) {
            let attendance = u32::from(assumptions.base_attendance_bps[wallet.ability])
                .saturating_add(
                    u32::from(wallet.streak)
                        .saturating_mul(u32::from(assumptions.streak_response_bps_per_day)),
                )
                .min(10_000);
            if field_draw(assumptions.seed, day, wallet_id, 0) >= attendance {
                wallet.streak = 0;
                continue;
            }
            wallet.streak = wallet.streak.saturating_add(1);
            wallet.attended_ever = true;
            longest_streak = longest_streak.max(wallet.streak);
            let extra = if assumptions.maximum_entries_per_attendance > 1
                && field_draw(assumptions.seed, day, wallet_id, 1)
                    < u32::from(assumptions.multi_entry_wallet_bps)
            {
                1 + field_draw(assumptions.seed, day, wallet_id, 2)
                    % u32::from(assumptions.maximum_entries_per_attendance - 1)
            } else {
                0
            };
            let entries = 1u16.saturating_add(
                u16::try_from(extra)
                    .map_err(|_| String::from("per-attendance entries exceed u16"))?,
            );
            while wallet.balance < entries {
                let target = entries.saturating_add(u16::from(assumptions.reorder_target));
                let needed = target.saturating_sub(wallet.balance);
                let pack_index = pack_sizes
                    .iter()
                    .position(|size| u16::from(*size) >= needed)
                    .unwrap_or(pack_sizes.len() - 1);
                wallet.balance = wallet
                    .balance
                    .saturating_add(u16::from(pack_sizes[pack_index]));
                if day > 0 {
                    pack_purchases[pack_index] = pack_purchases[pack_index].saturating_add(1);
                }
            }
            wallet.balance = wallet.balance.saturating_sub(entries);
            if day == 0 {
                warmup_entries = warmup_entries.saturating_add(u32::from(entries));
            } else {
                measured_entries = measured_entries.saturating_add(u64::from(entries));
                entries_by_ability[wallet.ability] =
                    entries_by_ability[wallet.ability].saturating_add(u64::from(entries));
                wallet_days[wallet.ability] = wallet_days[wallet.ability].saturating_add(1);
            }
        }
    }
    Ok(FieldSummary {
        assumptions,
        pack_sizes: pack_sizes.to_vec(),
        warmup_entries,
        measured_entries,
        unique_attending_wallets: u32::try_from(
            wallets.iter().filter(|wallet| wallet.attended_ever).count(),
        )
        .map_err(|_| String::from("attending wallet count exceeds u32"))?,
        entries_by_ability,
        attending_wallet_days_by_ability: wallet_days,
        pack_purchases,
        ending_kredits: wallets.iter().map(|wallet| u64::from(wallet.balance)).sum(),
        longest_streak,
    })
}

fn field_ability(assumptions: FieldAssumptions, wallet: u32) -> usize {
    let draw = field_draw(assumptions.seed, 0, wallet, 0xff);
    let mut cumulative = 0u32;
    assumptions
        .ability_mix_bps
        .iter()
        .position(|share| {
            cumulative = cumulative.saturating_add(u32::from(*share));
            draw < cumulative
        })
        .unwrap_or(3)
}

fn field_draw(seed: u64, day: u32, wallet: u32, purpose: u8) -> u32 {
    let digest = SoftwareSha256::hashv(&[
        HARNESS_FIELD_DOMAIN,
        &seed.to_le_bytes(),
        &day.to_le_bytes(),
        &wallet.to_le_bytes(),
        &[purpose],
    ]);
    u32::from_le_bytes(digest[..4].try_into().expect("four digest bytes")) % 10_000
}

fn bytes_to_hex(bytes: [u8; 32]) -> String {
    bytes.iter().fold(String::new(), |mut output, byte| {
        write!(output, "{byte:02x}").expect("writing to a String cannot fail");
        output
    })
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmokeSummary {
    pub daily_runs: usize,
    pub campaign_runs: usize,
    pub daily_score_sum: u64,
    pub objective_sum: u64,
    pub campaign_score_sum: u64,
    pub completed_campaign_runs: usize,
    pub charges_earned: u64,
    pub digest_hex: String,
}

/// Small deterministic end-to-end sample used as the committed golden smoke.
///
/// # Errors
///
/// Returns an engine error if either real simulation path stops accepting the
/// deterministic policy sequence.
pub fn golden_smoke() -> Result<SmokeSummary, String> {
    let daily_entries = daily_catalog();
    let campaign_levels = campaign_catalog();
    let mut records = Vec::new();
    for (entry, model, seed) in [
        (daily_entries[1], PlayerModel::DailyScore, 41),
        (daily_entries[6], PlayerModel::Theme, 73),
    ] {
        records.push(
            run_daily(entry, model, SeedPartition::Holdout, seed)
                .map_err(|error| format!("Daily smoke failed: {error:?}"))?,
        );
    }
    for (level, model, seed) in [
        (campaign_levels[2], PlayerModel::CampaignConstraints, 101),
        (campaign_levels[79], PlayerModel::LineClearer, 211),
    ] {
        records.push(
            run_campaign(level, model, SeedPartition::Holdout, seed)
                .map_err(|error| format!("Campaign smoke failed: {error:?}"))?,
        );
    }
    let canonical = serde_json::to_vec(&records).map_err(|error| error.to_string())?;
    let digest = SoftwareSha256::hashv(&[b"zkube-sim-harness-smoke-v1", &canonical]);
    Ok(SmokeSummary {
        daily_runs: records
            .iter()
            .filter(|record| record.mode == "daily")
            .count(),
        campaign_runs: records
            .iter()
            .filter(|record| record.mode == "campaign")
            .count(),
        daily_score_sum: records
            .iter()
            .map(|record| u64::from(record.daily_score))
            .sum(),
        objective_sum: records.iter().map(|record| record.objective_total).sum(),
        campaign_score_sum: records
            .iter()
            .filter(|record| record.mode == "campaign")
            .map(|record| u64::from(record.engine_score))
            .sum(),
        completed_campaign_runs: records
            .iter()
            .filter(|record| record.terminal_cause == TerminalCause::Completion)
            .count(),
        charges_earned: records
            .iter()
            .map(|record| u64::from(record.charges_earned_before_cap))
            .sum(),
        digest_hex: bytes_to_hex(digest),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn golden_smoke_uses_both_real_simulations() {
        let summary = golden_smoke().unwrap();
        assert_eq!(summary.daily_runs, 2);
        assert_eq!(summary.campaign_runs, 2);
        assert_eq!(summary.digest_hex.len(), 64);
        // Filled after the first reviewed feature-gated run. This assertion is
        // deliberately one object so a policy or engine drift cannot update a
        // handful of friendly-looking totals while hiding another change.
        assert_eq!(
            serde_json::to_string(&summary).unwrap(),
            "{\"dailyRuns\":2,\"campaignRuns\":2,\"dailyScoreSum\":525,\"objectiveSum\":157,\"campaignScoreSum\":32,\"completedCampaignRuns\":1,\"chargesEarned\":14,\"digestHex\":\"2ae76b0e314d27618ca5285eb80d3ec2680c970ba42cc6bd02a0e60e0955323e\"}"
        );
    }

    #[test]
    fn policy_and_vrf_streams_are_domain_separated() {
        let vrf = vrf_bytes(9, 1, 3);
        let policy = SoftwareSha256::hashv(&[
            HARNESS_POLICY_DOMAIN,
            &9u64.to_le_bytes(),
            &3u32.to_le_bytes(),
            &[PlayerModel::Naive.tag()],
        ]);
        assert_ne!(vrf, policy);
    }

    #[test]
    fn draw_and_field_samples_are_reproducible() {
        let draw = draw_summary(10, 365).unwrap();
        assert_eq!(draw.appearances.iter().sum::<u32>(), 365);
        let first = simulate_field(FieldAssumptions::base(), &[1, 10, 25]).unwrap();
        let second = simulate_field(FieldAssumptions::base(), &[1, 10, 25]).unwrap();
        assert_eq!(first, second);
        assert!(first.warmup_entries > 0);
        assert!(first.measured_entries > u64::from(first.unique_attending_wallets));
    }

    #[test]
    fn authored_daily_triggers_follow_shared_threshold_semantics() {
        let invalid = daily_catalog()
            .into_iter()
            .filter(|entry| !entry.authored_rules_valid)
            .map(|entry| entry.id)
            .collect::<Vec<_>>();
        assert!(invalid.is_empty());
    }

    #[test]
    fn campaign_transition_stalls_are_closed() {
        let mut stalls = 0usize;
        for level in campaign_catalog() {
            for model in [
                PlayerModel::Naive,
                PlayerModel::LineClearer,
                PlayerModel::CampaignConstraints,
            ] {
                let record = run_campaign(level, model, SeedPartition::Tuning, 1_u64 << 60)
                    .expect("Campaign transitions must remain measurable");
                stalls += usize::from(record.terminal_cause == TerminalCause::EngineStall);
            }
        }
        assert_eq!(stalls, 0);
    }
}
