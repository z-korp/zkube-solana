//! Deterministic, feature-gated design instrumentation.
//!
//! A ply is one accepted player action: a move, a board bonus, or a reroll
//! request. VRF callbacks are environment transitions and do not consume a
//! ply. Every candidate is evaluated by copying the simulation and invoking
//! its real transition; no grid, scoring, trigger, pressure, or constraint rule
//! is reproduced here. The greedy floors search one ply. Planner rollouts use
//! sampled, policy-only futures and never observe the run's future VRF output.
//! The oracle instead resolves the real seed output for each request counter.
//!
//! The player models are deliberately small and auditable:
//! - `Naive` chooses uniformly among legal moves and spends a usable bonus on
//!   every fourth ply. It rerolls every third eligible ply.
//! - `LineClearer` maximizes lines, then a perfect clear, then lower resulting
//!   height, neutral engine points, and destroyed blocks.
//! - `DailyScore` maximizes the exact one-ply change in `daily_score`, then
//!   lines, lower height, and theme score.
//! - `Theme` maximizes the exact one-ply change in `objective_total`. On the
//!   three-line objectives, it preserves a dense, non-terminal setup instead
//!   of cashing a sub-threshold clear until its first Theme hit; other states
//!   use Daily score, lines, and lower height as tie-breakers.
//! - `CampaignConstraints` maximizes completion, primary and secondary
//!   progress, engine score, lines, then lower height.
//! - planner variants use the same closed-loop Monte Carlo tree search with an
//!   integer UCT selector. Role selects the budget; value selects Campaign
//!   stars, combo play, Daily Score, or Daily Theme.
//!
//! A non-naive model spends a board bonus only when a legal bonus transition
//! has a strictly better policy value than its best move and either clears a
//! line, makes a perfect clear, lowers occupied height by at least two, or
//! advances a Campaign constraint. It rerolls only when its best legal move
//! clears no line and raises occupied height. All policy values and field-model
//! accounting are integers.

pub mod assertions;
pub mod bands;

use self::bands::{
    ORACLE_NODE_BUDGET, PLANNER_APEX_PROGRESS_RANGE, PLANNER_CAMPAIGN_COMBO_RANGE,
    PLANNER_CAMPAIGN_PRIMARY_RANGE, PLANNER_DAILY_METRIC_CAP, PLANNER_DAILY_METRIC_RANGE,
    PLANNER_HEIGHT_RANGE, PLANNER_SCORE_PROGRESS_RANGE, PLANNER_STAR_STEP, PLANNER_STRONG,
    PLANNER_UCT_EXPLORATION, PlannerBudget,
};
use crate::{
    ARENA_ENTRY_LAMPORTS, ActionMetrics, Bonus, CampaignEndReason, CampaignError, CampaignRules,
    CampaignSimulation, CampaignSimulationConfig, ChainDomain, ChallengeId, Constraint,
    ConstraintKind, DailyObjective, DailyObjectiveRule, DailyPressureRules, DailyRunRules,
    DailySimulation, DailySimulationConfig, ENTRY_DAILY_LAMPORTS, GRID_HEIGHT, GRID_WIDTH, Grid,
    LADDER_QUALIFY_POINTS, LADDER_TIER_POINT_THRESHOLDS, MoveReport, MutatorRules, ReplayMode,
    RulesHash, RunMetrics, RunPhase, SOL_PAYOUT_UNIT_LAMPORTS, Sha256Provider, SimulationError,
    SoftwareSha256, board_width, daily_pool_entry_index, ladder_points, ladder_tier_for_points,
    neutral_daily_mutator_rules,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet, hash_map::Entry},
    fmt::Write as _,
    format,
    string::{String, ToString},
    vec,
    vec::Vec,
};

const HARNESS_VRF_DOMAIN: &[u8] = b"zkube-sim-harness-vrf-v1";
const HARNESS_POLICY_DOMAIN: &[u8] = b"zkube-sim-harness-policy-v1";
const HARNESS_PLANNER_DOMAIN: &[u8] = b"zkube-sim-harness-planner-v1";
const HARNESS_PLANNER_STATE_DOMAIN: &[u8] = b"zkube-sim-harness-planner-state-v1";
const HARNESS_ORACLE_STATE_DOMAIN: &[u8] = b"zkube-sim-harness-oracle-state-v1";
const HARNESS_DECISION_DOMAIN: &[u8] = b"zkube-sim-harness-decision-v1";
const HARNESS_CAMPAIGN_SEED_DOMAIN: &[u8] = b"zkube-sim-harness-campaign-seed-v1";
const HARNESS_DAILY_RULES_DOMAIN: &[u8] = b"zkube-sim-harness-daily-rules-v1";
const HARNESS_FIELD_DOMAIN: &[u8] = b"zkube-sim-harness-field-v1";
const MAX_HARNESS_PLIES: u32 = 256;
const FIELD_LADDER_TIERS: usize = LADDER_TIER_POINT_THRESHOLDS.len();

// Fresh 64-seed holdout starting at index 1024, measured per real Daily run.
// Score qualification was 93.91%, 100%, 100%, and 100%; non-Classic Theme
// qualification was 55.21%, 88.19%, 88.54%, and 99.48% for the four field
// abilities. Mean Score metrics were 12, 132, 137, and 146; non-Classic Theme
// means were 6, 65, 68, and 86. The field uses those rounded anchors and
// independent deterministic variation, then the real board-width and log-rank
// functions.
const FIELD_SCORE_QUALIFICATION_BPS: [u16; 4] = [9_391, 10_000, 10_000, 10_000];
const FIELD_THEME_QUALIFICATION_BPS: [u16; 4] = [5_521, 8_819, 8_854, 9_948];
const FIELD_SCORE_ANCHORS: [u32; 4] = [12, 132, 137, 146];
const FIELD_THEME_ANCHORS: [u32; 4] = [6, 65, 68, 86];

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
    PlannerStrong,
    PlannerCasual,
    PlannerStrongTheme,
    PlannerStrongCombo,
    /// Reduced-budget strong policy used only by the eight-seed gate.
    PlannerGate,
}

impl PlayerModel {
    const fn tag(self) -> u8 {
        match self {
            Self::Naive => 0,
            Self::LineClearer => 1,
            Self::DailyScore => 2,
            Self::Theme => 3,
            Self::CampaignConstraints => 4,
            Self::PlannerStrong => 5,
            Self::PlannerCasual => 6,
            Self::PlannerStrongTheme => 7,
            Self::PlannerStrongCombo => 8,
            Self::PlannerGate => 9,
        }
    }

    const fn planner(self) -> Option<PlannerSpec> {
        match self {
            Self::PlannerStrong => Some(PlannerSpec {
                budget: PLANNER_STRONG,
                value: PlannerValue::Default,
            }),
            Self::PlannerCasual => Some(PlannerSpec {
                budget: bands::PLANNER_CASUAL,
                value: PlannerValue::Default,
            }),
            Self::PlannerStrongTheme => Some(PlannerSpec {
                budget: PLANNER_STRONG,
                value: PlannerValue::DailyTheme,
            }),
            Self::PlannerStrongCombo => Some(PlannerSpec {
                budget: PLANNER_STRONG,
                value: PlannerValue::CampaignCombo,
            }),
            Self::PlannerGate => Some(PlannerSpec {
                budget: bands::PLANNER_GATE,
                value: PlannerValue::Default,
            }),
            Self::Naive
            | Self::LineClearer
            | Self::DailyScore
            | Self::Theme
            | Self::CampaignConstraints => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PlannerValue {
    Default,
    DailyTheme,
    CampaignCombo,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PlannerSpec {
    budget: PlannerBudget,
    value: PlannerValue,
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
    pub metrics: RunMetrics,
    pub charges_earned_before_cap: u32,
    pub charges_spent: u16,
    pub charges_discarded_at_cap: u16,
    pub bonuses_used: u16,
    pub rerolls_used: u16,
    pub bonus_charge_earned_events: Vec<TimedRunEvent>,
    pub bonus_charge_discarded_events: Vec<TimedRunEvent>,
    pub bonus_spent_events: Vec<TimedRunEvent>,
    pub reroll_spent_events: Vec<TimedRunEvent>,
    /// Populated once brief 04 adds deterministic reroll grants to `MoveReport`.
    pub reroll_granted_events: Vec<TimedRunEvent>,
    /// Populated once brief 04 reports grants discarded at the reroll cap.
    pub reroll_grant_discarded_events: Vec<TimedRunEvent>,
    pub apex_hit_action: Option<u32>,
    pub terminal_action: Option<u32>,
    pub decision_digest_hex: String,
    pub primary_progress: u8,
    pub secondary_progress: u8,
    pub earned_stars: u8,
}

/// One measured inventory event at an accepted-action boundary.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimedRunEvent {
    pub action: u32,
    pub board_height: u8,
    pub count: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DailyCatalogEntry {
    pub id: u8,
    pub realm_map_id: u8,
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
    pub apex: ApexPredicate,
}

/// Harness-side apex target until brief 04 makes the authored secondary the
/// third star. Progress is kept beside search state so predicates that read a
/// single action cannot be confused with cumulative engine counters.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApexPredicate {
    None,
    SecondaryConstraint(Constraint),
    PerfectClears { required: u8 },
    LinesInAction { minimum: u8 },
    BlocksOfSizeInAction { size: u8, minimum: u8 },
}

/// Stable report vocabulary for harness-authored apex predicates.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApexPredicateKind {
    None,
    ComboLines,
    BreakBlocks,
    ComboMeter,
    PerfectClears,
    LinesInAction,
    BlocksOfSizeInAction,
}

/// Serializable apex definition carried by per-level reports.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApexDefinition {
    pub kind: ApexPredicateKind,
    pub value: u8,
    pub required_count: u8,
}

impl ApexPredicate {
    const fn from_secondary(secondary: Constraint) -> Self {
        if matches!(secondary.kind, ConstraintKind::None) {
            Self::None
        } else {
            Self::SecondaryConstraint(secondary)
        }
    }

    fn advance(
        self,
        progress: ApexProgress,
        report: MoveReport,
        engine: crate::RunEngine,
    ) -> ApexProgress {
        let next = match self {
            Self::None => 0,
            Self::SecondaryConstraint(_) => u16::from(engine.secondary_progress),
            Self::PerfectClears { .. } => {
                progress.0.saturating_add(u16::from(report.perfect_clear))
            }
            Self::LinesInAction { minimum } => {
                u16::from(progress.0 > 0 || report.lines_cleared >= minimum)
            }
            Self::BlocksOfSizeInAction { size, minimum } => {
                let destroyed = size
                    .checked_sub(1)
                    .and_then(|index| report.blocks_destroyed_by_size.get(usize::from(index)))
                    .copied()
                    .unwrap_or(0);
                u16::from(progress.0 > 0 || destroyed >= minimum)
            }
        };
        ApexProgress(next)
    }

    fn is_satisfied(self, progress: ApexProgress) -> bool {
        match self {
            Self::None => false,
            Self::SecondaryConstraint(constraint) => {
                constraint.is_satisfied(u8::try_from(progress.0).unwrap_or(u8::MAX))
            }
            Self::PerfectClears { required } => progress.0 >= u16::from(required),
            Self::LinesInAction { .. } | Self::BlocksOfSizeInAction { .. } => progress.0 > 0,
        }
    }

    fn progress_x1000(self, progress: ApexProgress) -> u64 {
        let required = match self {
            Self::None => return 0,
            Self::SecondaryConstraint(constraint) => u16::from(constraint.required_count.max(1)),
            Self::PerfectClears { required } => u16::from(required.max(1)),
            Self::LinesInAction { .. } | Self::BlocksOfSizeInAction { .. } => 1,
        };
        u64::from(progress.0.min(required)).saturating_mul(1_000) / u64::from(required)
    }

    const fn definition(self) -> ApexDefinition {
        match self {
            Self::None => ApexDefinition {
                kind: ApexPredicateKind::None,
                value: 0,
                required_count: 0,
            },
            Self::SecondaryConstraint(constraint) => ApexDefinition {
                kind: match constraint.kind {
                    ConstraintKind::None => ApexPredicateKind::None,
                    ConstraintKind::ComboLines => ApexPredicateKind::ComboLines,
                    ConstraintKind::BreakBlocks => ApexPredicateKind::BreakBlocks,
                    ConstraintKind::ComboMeter => ApexPredicateKind::ComboMeter,
                },
                value: constraint.value,
                required_count: constraint.required_count,
            },
            Self::PerfectClears { required } => ApexDefinition {
                kind: ApexPredicateKind::PerfectClears,
                value: 0,
                required_count: required,
            },
            Self::LinesInAction { minimum } => ApexDefinition {
                kind: ApexPredicateKind::LinesInAction,
                value: minimum,
                required_count: 1,
            },
            Self::BlocksOfSizeInAction { size, minimum } => ApexDefinition {
                kind: ApexPredicateKind::BlocksOfSizeInAction,
                value: size,
                required_count: minimum,
            },
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct ApexProgress(u16);

#[derive(Debug, Default)]
struct Counters {
    charges_earned: u32,
    charges_spent: u16,
    charges_discarded: u16,
    bonuses_used: u16,
    rerolls_used: u16,
    max_difficulty: u8,
    tier_actions: [u16; 8],
    metrics: RunMetrics,
    bonus_charge_earned_events: Vec<TimedRunEvent>,
    bonus_charge_discarded_events: Vec<TimedRunEvent>,
    bonus_spent_events: Vec<TimedRunEvent>,
    reroll_spent_events: Vec<TimedRunEvent>,
    reroll_granted_events: Vec<TimedRunEvent>,
    reroll_grant_discarded_events: Vec<TimedRunEvent>,
    apex_hit_action: Option<u32>,
    apex_progress: ApexProgress,
    terminal_action: Option<u32>,
    decision_commitment: [u8; 32],
}

#[derive(Clone, Copy, Debug)]
struct MoveObservation {
    action: ActionKind,
    action_index: u32,
    combo_before: u8,
    before_charges: u8,
    spent: u8,
    after_charges: u8,
    report: MoveReport,
    apex_before: ApexProgress,
    apex_after: ApexProgress,
    apex: ApexPredicate,
    terminal: bool,
}

impl Counters {
    fn observe(&mut self, observation: MoveObservation) {
        let MoveObservation {
            action,
            action_index,
            combo_before,
            before_charges,
            spent,
            after_charges,
            report,
            apex_before,
            apex_after,
            apex,
            terminal,
        } = observation;
        self.observe_decision(action);
        let blocks_destroyed = report
            .blocks_destroyed_by_size
            .into_iter()
            .map(u32::from)
            .sum();
        self.metrics
            .record_action(ActionMetrics {
                score: u64::from(report.points_earned),
                lines: u32::from(report.lines_cleared),
                blocks_destroyed,
                combo: u32::from(report.combo_counter),
                combo_derived_score: if report.combo_counter > combo_before {
                    u64::from(report.points_earned)
                } else {
                    0
                },
                perfect_clear: report.perfect_clear,
            })
            .expect("the bounded harness action count cannot overflow RunMetrics");
        let earned = report.charges_earned;
        self.charges_earned = self.charges_earned.saturating_add(u32::from(earned));
        self.charges_spent = self.charges_spent.saturating_add(u16::from(spent));
        let uncapped = u16::from(before_charges.saturating_sub(spent)) + u16::from(earned);
        let discarded = uncapped.saturating_sub(u16::from(after_charges));
        self.charges_discarded = self.charges_discarded.saturating_add(discarded);
        if earned > 0 {
            self.bonus_charge_earned_events.push(TimedRunEvent {
                action: action_index,
                board_height: report.height_after,
                count: u16::from(earned),
            });
        }
        if discarded > 0 {
            self.bonus_charge_discarded_events.push(TimedRunEvent {
                action: action_index,
                board_height: report.height_after,
                count: discarded,
            });
        }
        if spent > 0 {
            self.bonus_spent_events.push(TimedRunEvent {
                action: action_index,
                board_height: report.height_before,
                count: u16::from(spent),
            });
        }
        if self.apex_hit_action.is_none()
            && !apex.is_satisfied(apex_before)
            && apex.is_satisfied(apex_after)
        {
            self.apex_hit_action = Some(action_index);
        }
        self.apex_progress = apex_after;
        if terminal {
            self.terminal_action = Some(action_index);
        }
        let tier = usize::from(report.difficulty_at_action.min(7));
        self.tier_actions[tier] = self.tier_actions[tier].saturating_add(1);
        self.max_difficulty = self.max_difficulty.max(report.difficulty_at_action);
    }

    fn observe_decision(&mut self, action: ActionKind) {
        let encoded = action.encoded();
        self.decision_commitment =
            SoftwareSha256::hashv(&[HARNESS_DECISION_DOMAIN, &self.decision_commitment, &encoded]);
    }

    fn observe_reroll(&mut self, action_index: u32, board_height: u8) {
        self.rerolls_used = self.rerolls_used.saturating_add(1);
        self.reroll_spent_events.push(TimedRunEvent {
            action: action_index,
            board_height,
            count: 1,
        });
        self.observe_decision(ActionKind::Reroll);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ActionKind {
    Move { row: u8, start: u8, destination: u8 },
    Bonus { row: u8, column: u8 },
    Reroll,
}

#[derive(Clone, Copy, Debug)]
struct CampaignPlannerState {
    simulation: CampaignSimulation,
    metrics: RunMetrics,
    apex_progress: ApexProgress,
}

#[derive(Clone, Copy, Debug)]
struct PlannerEdge {
    action: ActionKind,
    visits: u32,
    value_sum: u128,
}

#[derive(Debug, Default)]
struct PlannerNode {
    visits: u32,
    edges: Vec<PlannerEdge>,
}

/// The three independently measured reachability outcomes for one oracle run.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OracleReachability {
    pub one_star_reachable: bool,
    pub two_stars_reachable: bool,
    pub apex_reachable: bool,
}

/// Bounded reachability result for one authored level and seed. A node-cap hit
/// means a false reachability bit is unknown rather than proven impossible.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OracleResult {
    #[serde(flatten)]
    pub reachability: OracleReachability,
    pub visited_states: usize,
    pub node_cap_hit: bool,
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

#[derive(Clone, Copy, Debug)]
enum SelectedAction<Candidate> {
    Transition(Candidate),
    Reroll,
    NoLegalAction,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DailyPoolFixture {
    schema_version: u32,
    content_version: u32,
    entries: Vec<DailyPoolFixtureEntry>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DailyPoolFixtureEntry {
    id: u8,
    realm_map_id: u8,
    scoring_index: usize,
    starting_rows: u8,
}

/// Load the authored Campaign catalog used by production codegen.
///
/// # Panics
///
/// Panics only when the repository fixture is malformed; its normal codegen
/// validation catches the same condition before a release can be built.
#[must_use]
pub fn campaign_catalog() -> Vec<CampaignCatalogLevel> {
    let fixture: CampaignFixture =
        serde_json::from_str(include_str!("../../../../fixtures/campaign-v2.json"))
            .expect("Campaign fixture must parse");
    let mut levels = Vec::with_capacity(100);
    for map in fixture.maps {
        let bonus = bonus_from_tag(map.rules[5]);
        for (level_index, level) in map.levels.into_iter().enumerate() {
            let level_id = u8::try_from(level_index + 1).expect("ten Campaign levels fit u8");
            let secondary = constraint_from_tuple(level.4);
            levels.push(CampaignCatalogLevel {
                catalog_id: u16::from(map.map_id) * 100 + u16::from(level_id),
                map_id: map.map_id,
                level_id,
                rules: CampaignRules {
                    level: crate::LevelRules {
                        points_required: level.0,
                        max_moves: level.1,
                        primary: constraint_from_tuple(level.3),
                        secondary,
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
                apex: ApexPredicate::from_secondary(secondary),
            });
        }
    }
    assert_eq!(fixture.content_version, 2);
    levels
}

/// Snapshot the currently-authored Daily pool. The pool fixture owns entry
/// identity, realm, scoring rule, and starting rows; guardian ability and
/// inventory remain derived from the selected Campaign realm.
///
/// # Panics
///
/// Panics only when the repository fixture is malformed; codegen validation
/// rejects the same condition.
#[must_use]
pub fn daily_catalog() -> Vec<DailyCatalogEntry> {
    let campaign: CampaignFixture =
        serde_json::from_str(include_str!("../../../../fixtures/campaign-v2.json"))
            .expect("Campaign fixture must parse");
    let pool: DailyPoolFixture =
        serde_json::from_str(include_str!("../../../../fixtures/daily-pool-v2.json"))
            .expect("Daily pool fixture must parse");
    let realms = campaign
        .maps
        .into_iter()
        .map(|map| (map.map_id, map.rules))
        .collect::<HashMap<_, _>>();
    let entries = pool
        .entries
        .into_iter()
        .map(|entry| {
            let map_rules = realms
                .get(&entry.realm_map_id)
                .copied()
                .expect("Daily pool realm must exist in Campaign");
            let (family, objective) = daily_objective(entry.scoring_index);
            let rules = DailyRunRules {
                max_moves: crate::DAILY_MAX_MOVES,
                mutator: neutral_daily_mutator_rules(
                    u8::try_from(map_rules[6]).expect("validated trigger fits u8"),
                    map_rules[7],
                ),
                bonus: bonus_from_tag(map_rules[5]),
                starting_bonus_charges: u8::try_from(map_rules[8])
                    .expect("validated charges fit u8"),
                starting_height: entry.starting_rows,
                objective,
                pressure: DailyPressureRules::canonical(),
            };
            let authored_rules_valid = rules.is_valid();
            DailyCatalogEntry {
                id: entry.id,
                realm_map_id: entry.realm_map_id,
                family,
                authored_rules_valid,
                rules,
            }
        })
        .collect();
    assert_eq!(pool.schema_version, 1);
    assert_eq!(pool.content_version, campaign.content_version);
    entries
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
        metrics: simulation.metrics,
        charges_earned_before_cap: counters.charges_earned,
        charges_spent: counters.charges_spent,
        charges_discarded_at_cap: counters.charges_discarded,
        bonuses_used: counters.bonuses_used,
        rerolls_used: counters.rerolls_used,
        bonus_charge_earned_events: counters.bonus_charge_earned_events,
        bonus_charge_discarded_events: counters.bonus_charge_discarded_events,
        bonus_spent_events: counters.bonus_spent_events,
        reroll_spent_events: counters.reroll_spent_events,
        reroll_granted_events: counters.reroll_granted_events,
        reroll_grant_discarded_events: counters.reroll_grant_discarded_events,
        apex_hit_action: counters.apex_hit_action,
        terminal_action: counters.terminal_action,
        decision_digest_hex: bytes_to_hex(counters.decision_commitment),
        primary_progress: simulation.engine.primary_progress,
        secondary_progress: simulation.engine.secondary_progress,
        earned_stars: 0,
    })
}

fn choose_daily_action(
    simulation: &DailySimulation,
    rules: DailyRunRules,
    entry_id: u8,
    model: PlayerModel,
    seed: u64,
) -> Result<SelectedAction<DailyCandidate>, SimulationError> {
    if let Some(spec) = model.planner() {
        let action = plan_daily_action(simulation, rules, entry_id, spec, seed)?
            .ok_or(SimulationError::InvalidPhase)?;
        if action == ActionKind::Reroll {
            return Ok(SelectedAction::Reroll);
        }
        let mut next = *simulation;
        let report = match action {
            ActionKind::Move {
                row,
                start,
                destination,
            } => next.play_move(
                rules,
                simulation.action_counter,
                simulation.engine.moves,
                row,
                start,
                destination,
            )?,
            ActionKind::Bonus { row, column } => {
                next.apply_bonus(rules, simulation.action_counter, row, column)?
            }
            ActionKind::Reroll => unreachable!("reroll returned above"),
        };
        return Ok(SelectedAction::Transition(DailyCandidate {
            action,
            next,
            report,
            key: [0; 8],
        }));
    }

    let moves = daily_move_candidates(simulation, rules, model);
    let best_move = choose_daily(&moves, seed, simulation.action_counter, model)
        .ok_or(SimulationError::InvalidPhase)?;
    if simulation.engine.reroll_available
        && should_reroll(model, simulation.action_counter, &best_move.report)
    {
        return Ok(SelectedAction::Reroll);
    }
    let bonuses = daily_bonus_candidates(simulation, rules, model);
    let best_bonus = choose_daily(&bonuses, seed, simulation.action_counter, model);
    let selected = if should_spend_daily_bonus(model, &best_move, best_bonus.as_ref()) {
        best_bonus.unwrap_or(best_move)
    } else {
        best_move
    };
    Ok(SelectedAction::Transition(selected))
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

        let selected = match choose_daily_action(&simulation, rules, entry_id, model, seed)? {
            SelectedAction::Reroll => {
                let action_index = simulation.action_counter;
                let height = simulation.engine.grid.occupied_height();
                simulation.request_reroll(rules, action_index)?;
                counters.observe_reroll(action_index, height);
                continue;
            }
            SelectedAction::Transition(selected) => selected,
            SelectedAction::NoLegalAction => return Err(SimulationError::InvalidPhase),
        };
        let action = simulation.action_counter;
        let combo_before = simulation.engine.combo_counter;
        let before_charges = simulation.engine.bonus_charges;
        let spent = u8::from(matches!(selected.action, ActionKind::Bonus { .. }));
        simulation = selected.next;
        let action_was_terminal = simulation.engine.phase == RunPhase::Finished;
        counters.observe(MoveObservation {
            action: selected.action,
            action_index: action,
            combo_before,
            before_charges,
            spent,
            after_charges: simulation.engine.bonus_charges,
            report: selected.report,
            apex_before: counters.apex_progress,
            apex_after: counters.apex_progress,
            apex: ApexPredicate::None,
            terminal: action_was_terminal,
        });
        if spent > 0 {
            counters.bonuses_used = counters.bonuses_used.saturating_add(1);
        }
        if simulation.engine.phase == RunPhase::Finished {
            terminal = Some(if selected.report.preview_insertion_blocked {
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
    debug_assert_eq!(counters.metrics, simulation.metrics);
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
    let config = campaign_simulation_config(level, partition, seed);
    let simulation = CampaignSimulation::new(config)?;
    let (simulation, counters, terminal_cause) =
        play_campaign_to_terminal(simulation, config, level.apex, model, seed)?;
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
        metrics: counters.metrics,
        charges_earned_before_cap: counters.charges_earned,
        charges_spent: counters.charges_spent,
        charges_discarded_at_cap: counters.charges_discarded,
        bonuses_used: counters.bonuses_used,
        rerolls_used: counters.rerolls_used,
        bonus_charge_earned_events: counters.bonus_charge_earned_events,
        bonus_charge_discarded_events: counters.bonus_charge_discarded_events,
        bonus_spent_events: counters.bonus_spent_events,
        reroll_spent_events: counters.reroll_spent_events,
        reroll_granted_events: counters.reroll_granted_events,
        reroll_grant_discarded_events: counters.reroll_grant_discarded_events,
        apex_hit_action: counters.apex_hit_action,
        terminal_action: counters.terminal_action,
        decision_digest_hex: bytes_to_hex(counters.decision_commitment),
        primary_progress: simulation.engine.primary_progress,
        secondary_progress: simulation.engine.secondary_progress,
        earned_stars: simulation.earned_stars,
    })
}

/// Paired success measurement for one authored level at tier N and N+1.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedTierSummary {
    pub catalog_id: u16,
    pub model: PlayerModel,
    pub partition: SeedPartition,
    pub seed_start: u64,
    pub seeds: u32,
    pub base_tier: u8,
    pub raised_tier: u8,
    pub base_successes: u32,
    pub raised_successes: u32,
    pub base_engine_stalls: u32,
    pub raised_engine_stalls: u32,
    pub base_success_rate_bps: u32,
    pub raised_success_rate_bps: u32,
    /// Raised-tier rate minus base-tier rate. A harder next tier is negative.
    pub success_rate_delta_bps: i32,
}

/// Seed populations for the reachable/findable/luckable apex report.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApexSamplePlan {
    pub seed_start: u64,
    pub oracle_seeds: u32,
    pub naive_seeds: u32,
    pub planner_seeds: u32,
}

/// Per-level apex measurements consumed by the assertion layer.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApexLevelSummary {
    pub catalog_id: u16,
    pub apex: ApexDefinition,
    pub partition: SeedPartition,
    pub samples: ApexSamplePlan,
    pub oracle_reachable_seeds: u32,
    pub oracle_node_cap_hits: u32,
    pub oracle_reachable_rate_bps: u32,
    pub naive_hits: u32,
    pub naive_engine_stalls: u32,
    pub naive_hit_rate_bps: u32,
    pub planner_hits: u32,
    pub planner_engine_stalls: u32,
    pub planner_hit_rate_bps: u32,
    pub planner_decisive_hits: u32,
    pub planner_decisive_share_bps: Option<u32>,
    pub planner_no_hit_runs: u32,
    pub planner_no_hit_successes: u32,
    pub planner_success_without_apex_rate_bps: Option<u32>,
    pub planner_set_up_hits: u32,
    pub planner_set_up_share_bps: Option<u32>,
}

/// Run a level at its authored tier and the adjacent harder tier over the same
/// seed indexes. The raw randomness inputs are identical in each pair; only
/// the block weights selected by `level_difficulty` change.
///
/// # Errors
///
/// Rejects an empty sample, a tier-seven level, seed overflow, or a Campaign
/// transition error.
pub fn paired_tier_summary(
    level: CampaignCatalogLevel,
    model: PlayerModel,
    partition: SeedPartition,
    seed_start: u64,
    seeds: u32,
) -> Result<PairedTierSummary, String> {
    if seeds == 0 {
        return Err(String::from("paired-tier sample must not be empty"));
    }
    if level.rules.level_difficulty >= 7 {
        return Err(String::from("paired-tier level must be below tier seven"));
    }
    let mut raised = level;
    raised.rules.level_difficulty = raised.rules.level_difficulty.saturating_add(1);
    let mut base_successes = 0u32;
    let mut raised_successes = 0u32;
    let mut base_engine_stalls = 0u32;
    let mut raised_engine_stalls = 0u32;
    for offset in 0..seeds {
        let seed = seed_start
            .checked_add(u64::from(offset))
            .ok_or_else(|| String::from("paired-tier seed range overflow"))?;
        let base_record = run_campaign(level, model, partition, seed)
            .map_err(|error| format!("base-tier Campaign failed: {error:?}"))?;
        let raised_record = run_campaign(raised, model, partition, seed)
            .map_err(|error| format!("raised-tier Campaign failed: {error:?}"))?;
        base_successes = base_successes.saturating_add(u32::from(base_record.earned_stars > 0));
        raised_successes =
            raised_successes.saturating_add(u32::from(raised_record.earned_stars > 0));
        base_engine_stalls = base_engine_stalls.saturating_add(u32::from(
            base_record.terminal_cause == TerminalCause::EngineStall,
        ));
        raised_engine_stalls = raised_engine_stalls.saturating_add(u32::from(
            raised_record.terminal_cause == TerminalCause::EngineStall,
        ));
    }
    let base_success_rate_bps = rate_bps(base_successes, seeds);
    let raised_success_rate_bps = rate_bps(raised_successes, seeds);
    let success_rate_delta_bps =
        i32::try_from(i64::from(raised_success_rate_bps) - i64::from(base_success_rate_bps))
            .map_err(|_| String::from("paired-tier rate delta overflow"))?;
    Ok(PairedTierSummary {
        catalog_id: level.catalog_id,
        model,
        partition,
        seed_start,
        seeds,
        base_tier: level.rules.level_difficulty,
        raised_tier: raised.rules.level_difficulty,
        base_successes,
        raised_successes,
        base_engine_stalls,
        raised_engine_stalls,
        base_success_rate_bps,
        raised_success_rate_bps,
        success_rate_delta_bps,
    })
}

/// Measure one level's reachable/findable/luckable apex triple and the three
/// conditional diagnostics over their pinned model populations.
///
/// # Errors
///
/// Rejects a level without an apex, an empty population, seed overflow, or a
/// Campaign transition error.
pub fn apex_level_summary(
    level: CampaignCatalogLevel,
    partition: SeedPartition,
    samples: ApexSamplePlan,
) -> Result<ApexLevelSummary, String> {
    if matches!(level.apex, ApexPredicate::None) {
        return Err(String::from("apex report requires an authored predicate"));
    }
    if samples.oracle_seeds == 0 || samples.naive_seeds == 0 || samples.planner_seeds == 0 {
        return Err(String::from("apex sample populations must not be empty"));
    }

    let mut oracle_reachable_seeds = 0u32;
    let mut oracle_node_cap_hits = 0u32;
    for offset in 0..samples.oracle_seeds {
        let seed = sample_seed(samples.seed_start, offset)?;
        let result = oracle_campaign(level, partition, seed)
            .map_err(|error| format!("apex oracle failed: {error:?}"))?;
        oracle_reachable_seeds =
            oracle_reachable_seeds.saturating_add(u32::from(result.reachability.apex_reachable));
        oracle_node_cap_hits = oracle_node_cap_hits.saturating_add(u32::from(result.node_cap_hit));
    }

    let mut naive_hits = 0u32;
    let mut naive_engine_stalls = 0u32;
    for offset in 0..samples.naive_seeds {
        let seed = sample_seed(samples.seed_start, offset)?;
        let record = run_campaign(level, PlayerModel::Naive, partition, seed)
            .map_err(|error| format!("apex naive run failed: {error:?}"))?;
        naive_hits = naive_hits.saturating_add(u32::from(record.apex_hit_action.is_some()));
        naive_engine_stalls = naive_engine_stalls.saturating_add(u32::from(
            record.terminal_cause == TerminalCause::EngineStall,
        ));
    }

    let mut planner_hits = 0u32;
    let mut planner_engine_stalls = 0u32;
    let mut planner_decisive_hits = 0u32;
    let mut planner_no_hit_runs = 0u32;
    let mut planner_no_hit_successes = 0u32;
    let mut planner_set_up_hits = 0u32;
    for offset in 0..samples.planner_seeds {
        let seed = sample_seed(samples.seed_start, offset)?;
        let record = run_campaign(level, PlayerModel::PlannerStrong, partition, seed)
            .map_err(|error| format!("apex planner run failed: {error:?}"))?;
        planner_engine_stalls = planner_engine_stalls.saturating_add(u32::from(
            record.terminal_cause == TerminalCause::EngineStall,
        ));
        if let Some(hit_action) = record.apex_hit_action {
            planner_hits = planner_hits.saturating_add(1);
            planner_decisive_hits = planner_decisive_hits
                .saturating_add(u32::from(record.terminal_action == Some(hit_action)));
            planner_set_up_hits = planner_set_up_hits
                .saturating_add(u32::from(apex_hit_has_recent_charge(&record, hit_action)));
        } else {
            planner_no_hit_runs = planner_no_hit_runs.saturating_add(1);
            planner_no_hit_successes =
                planner_no_hit_successes.saturating_add(u32::from(record.earned_stars > 0));
        }
    }

    Ok(ApexLevelSummary {
        catalog_id: level.catalog_id,
        apex: level.apex.definition(),
        partition,
        samples,
        oracle_reachable_seeds,
        oracle_node_cap_hits,
        oracle_reachable_rate_bps: rate_bps(oracle_reachable_seeds, samples.oracle_seeds),
        naive_hits,
        naive_engine_stalls,
        naive_hit_rate_bps: rate_bps(naive_hits, samples.naive_seeds),
        planner_hits,
        planner_engine_stalls,
        planner_hit_rate_bps: rate_bps(planner_hits, samples.planner_seeds),
        planner_decisive_hits,
        planner_decisive_share_bps: optional_rate_bps(planner_decisive_hits, planner_hits),
        planner_no_hit_runs,
        planner_no_hit_successes,
        planner_success_without_apex_rate_bps: optional_rate_bps(
            planner_no_hit_successes,
            planner_no_hit_runs,
        ),
        planner_set_up_hits,
        planner_set_up_share_bps: optional_rate_bps(planner_set_up_hits, planner_hits),
    })
}

fn apex_hit_has_recent_charge(record: &RunRecord, hit_action: u32) -> bool {
    record
        .bonus_charge_earned_events
        .iter()
        .any(|event| event.action <= hit_action && hit_action.saturating_sub(event.action) <= 5)
}

fn sample_seed(seed_start: u64, offset: u32) -> Result<u64, String> {
    seed_start
        .checked_add(u64::from(offset))
        .ok_or_else(|| String::from("sample seed range overflow"))
}

fn rate_bps(hits: u32, samples: u32) -> u32 {
    u32::try_from(u64::from(hits).saturating_mul(10_000) / u64::from(samples)).unwrap_or(u32::MAX)
}

fn optional_rate_bps(hits: u32, samples: u32) -> Option<u32> {
    (samples > 0).then(|| rate_bps(hits, samples))
}

fn campaign_simulation_config(
    level: CampaignCatalogLevel,
    partition: SeedPartition,
    seed: u64,
) -> CampaignSimulationConfig {
    let seed_bytes = SoftwareSha256::hashv(&[
        HARNESS_CAMPAIGN_SEED_DOMAIN,
        &seed.to_le_bytes(),
        &[partition.tag(), level.map_id, level.level_id],
    ]);
    CampaignSimulationConfig {
        content_version: 2,
        content_hash: SoftwareSha256::hashv(&[b"zkube-sim-harness-campaign-content-v1"]),
        map_id: level.map_id,
        level_id: level.level_id,
        attempt: seed,
        seed: seed_bytes,
        rules: level.rules,
    }
}

/// Search one seed with its real, counter-keyed Campaign randomness.
///
/// # Errors
///
/// Returns an authored-rule or engine transition error if the real Campaign
/// simulation cannot be initialized or advanced.
pub fn oracle_campaign(
    level: CampaignCatalogLevel,
    partition: SeedPartition,
    seed: u64,
) -> Result<OracleResult, CampaignError> {
    let config = campaign_simulation_config(level, partition, seed);
    let state = CampaignPlannerState {
        simulation: CampaignSimulation::new(config)?,
        metrics: RunMetrics::default(),
        apex_progress: ApexProgress::default(),
    };
    let mut result = OracleResult::default();
    let mut visited = HashSet::new();
    oracle_search(state, config, level.apex, &mut visited, &mut result)?;
    result.visited_states = visited.len();
    Ok(result)
}

fn oracle_search(
    state: CampaignPlannerState,
    config: CampaignSimulationConfig,
    apex: ApexPredicate,
    visited: &mut HashSet<[u8; 32]>,
    result: &mut OracleResult,
) -> Result<(), CampaignError> {
    result.reachability.one_star_reachable |= state.simulation.earned_stars >= 1;
    result.reachability.two_stars_reachable |= state.simulation.earned_stars >= 2;
    result.reachability.apex_reachable |= apex.is_satisfied(state.apex_progress);
    if result.reachability.one_star_reachable
        && result.reachability.two_stars_reachable
        && result.reachability.apex_reachable
    {
        return Ok(());
    }
    if state.simulation.is_terminal() {
        return Ok(());
    }
    let key = campaign_oracle_state_key(state);
    if visited.contains(&key) {
        return Ok(());
    }
    if visited.len() >= ORACLE_NODE_BUDGET {
        result.node_cap_hit = true;
        return Ok(());
    }
    visited.insert(key);

    let mut candidates =
        campaign_move_candidates(state.simulation, config, PlayerModel::LineClearer)
            .into_iter()
            .chain(campaign_bonus_candidates(
                state.simulation,
                config,
                PlayerModel::LineClearer,
            ))
            .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .key
            .cmp(&left.key)
            .then_with(|| left.action.encoded().cmp(&right.action.encoded()))
    });
    for candidate in candidates {
        let combo_before = state.simulation.engine.combo_counter;
        let next = CampaignPlannerState {
            simulation: candidate.next,
            metrics: record_campaign_metrics(state.metrics, combo_before, candidate.report),
            apex_progress: apex.advance(
                state.apex_progress,
                candidate.report,
                candidate.next.engine,
            ),
        };
        oracle_search(next, config, apex, visited, result)?;
        if result.reachability.one_star_reachable
            && result.reachability.two_stars_reachable
            && result.reachability.apex_reachable
        {
            return Ok(());
        }
    }
    if state.simulation.engine.reroll_available {
        let rerolled = apply_campaign_planner_action(state, config, apex, ActionKind::Reroll)?;
        oracle_search(rerolled, config, apex, visited, result)?;
    }
    Ok(())
}

fn choose_campaign_action(
    simulation: CampaignSimulation,
    config: CampaignSimulationConfig,
    apex: ApexPredicate,
    model: PlayerModel,
    seed: u64,
    metrics: RunMetrics,
    apex_progress: ApexProgress,
) -> Result<SelectedAction<CampaignCandidate>, CampaignError> {
    if let Some(spec) = model.planner() {
        let state = CampaignPlannerState {
            simulation,
            metrics,
            apex_progress,
        };
        let Some(action) = plan_campaign_action(state, config, apex, spec, seed)? else {
            return Ok(SelectedAction::NoLegalAction);
        };
        if action == ActionKind::Reroll {
            return Ok(SelectedAction::Reroll);
        }
        let mut next = simulation;
        let mut report = match action {
            ActionKind::Move {
                row,
                start,
                destination,
            } => next.play_move(config, simulation.engine.moves, row, start, destination)?,
            ActionKind::Bonus { row, column } => next.apply_bonus(config, row, column)?,
            ActionKind::Reroll => unreachable!("reroll returned above"),
        };
        report.difficulty_at_action = simulation.current_difficulty;
        return Ok(SelectedAction::Transition(CampaignCandidate {
            action,
            next,
            report,
            key: [0; 8],
        }));
    }

    let moves = campaign_move_candidates(simulation, config, model);
    let Some(best_move) = choose_campaign(&moves, seed, simulation.action_counter, model) else {
        return Ok(SelectedAction::NoLegalAction);
    };
    if simulation.engine.reroll_available
        && should_reroll(model, simulation.action_counter, &best_move.report)
    {
        return Ok(SelectedAction::Reroll);
    }
    let bonuses = campaign_bonus_candidates(simulation, config, model);
    let best_bonus = choose_campaign(&bonuses, seed, simulation.action_counter, model);
    let selected =
        if should_spend_campaign_bonus(model, &simulation, &best_move, best_bonus.as_ref()) {
            best_bonus.unwrap_or(best_move)
        } else {
            best_move
        };
    Ok(SelectedAction::Transition(selected))
}

fn play_campaign_to_terminal(
    mut simulation: CampaignSimulation,
    config: CampaignSimulationConfig,
    apex: ApexPredicate,
    model: PlayerModel,
    seed: u64,
) -> Result<(CampaignSimulation, Counters, TerminalCause), CampaignError> {
    let mut counters = Counters::default();
    let mut last_blocked = false;
    let mut engine_stalled = false;

    while !simulation.is_terminal() && simulation.action_counter < MAX_HARNESS_PLIES {
        let selected = match choose_campaign_action(
            simulation,
            config,
            apex,
            model,
            seed,
            counters.metrics,
            counters.apex_progress,
        )? {
            SelectedAction::Reroll => {
                let action_index = simulation.action_counter;
                let height = simulation.engine.grid.occupied_height();
                simulation.request_reroll(config)?;
                counters.observe_reroll(action_index, height);
                continue;
            }
            SelectedAction::NoLegalAction => {
                engine_stalled = true;
                break;
            }
            SelectedAction::Transition(selected) => selected,
        };
        let action = simulation.action_counter;
        let combo_before = simulation.engine.combo_counter;
        let before_charges = simulation.engine.bonus_charges;
        let apex_before = counters.apex_progress;
        let spent = u8::from(matches!(selected.action, ActionKind::Bonus { .. }));
        simulation = selected.next;
        let apex_after = apex.advance(apex_before, selected.report, simulation.engine);
        let terminal = simulation.is_terminal();
        counters.observe(MoveObservation {
            action: selected.action,
            action_index: action,
            combo_before,
            before_charges,
            spent,
            after_charges: simulation.engine.bonus_charges,
            report: selected.report,
            apex_before,
            apex_after,
            apex,
            terminal,
        });
        if spent > 0 {
            counters.bonuses_used = counters.bonuses_used.saturating_add(1);
        }
        last_blocked = selected.report.preview_insertion_blocked;
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
    Ok((simulation, counters, terminal_cause))
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
        if let Ok(report) = next.play_move(
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
                key: daily_key(model, rules.objective.objective, simulation, &next, report),
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
        if let Ok(report) = next.apply_bonus(rules, simulation.action_counter, row, column) {
            candidates.push(DailyCandidate {
                action: ActionKind::Bonus { row, column },
                key: daily_key(model, rules.objective.objective, simulation, &next, report),
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
    objective: DailyObjective,
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
        PlayerModel::DailyScore
        | PlayerModel::PlannerStrong
        | PlayerModel::PlannerCasual
        | PlayerModel::PlannerStrongCombo
        | PlayerModel::PlannerGate => [
            daily_delta,
            i64::from(report.lines_cleared),
            lower_height,
            theme_delta,
            i64::from(report.perfect_clear),
            destroyed,
            0,
            0,
        ],
        PlayerModel::Theme | PlayerModel::PlannerStrongTheme => theme_key(
            objective,
            before.objective_total == 0,
            after,
            report,
            theme_delta,
            daily_delta,
        ),
    }
}

fn theme_key(
    objective: DailyObjective,
    needs_first_hit: bool,
    after: &DailySimulation,
    report: MoveReport,
    theme_delta: i64,
    daily_delta: i64,
) -> [i64; 8] {
    if needs_first_hit
        && matches!(
            objective,
            DailyObjective::Combo { minimum_lines: 3 } | DailyObjective::ExactLines { lines: 3 }
        )
    {
        // A one- or two-line clear pays no Theme points here and destroys the
        // dense stack from which a three-line cascade is made. The old generic
        // Daily-score tie-break preferred that immediate score, so Theme never
        // built the state its own threshold required. Keep the run alive,
        // defer sub-threshold clears, then retain cells until a scoring action
        // is available. Once the first hit proves the policy can reach its
        // objective, ordinary Theme tie-breakers resume.
        let occupied_cells = after
            .engine
            .grid
            .cells()
            .iter()
            .filter(|cell| **cell != 0)
            .count();
        return [
            theme_delta,
            i64::from(!report.preview_insertion_blocked),
            -i64::from(report.lines_cleared),
            i64::try_from(occupied_cells).expect("the fixed grid size fits i64"),
            daily_delta,
            -i64::from(report.height_after),
            i64::from(report.perfect_clear),
            0,
        ];
    }
    [
        theme_delta,
        daily_delta,
        i64::from(report.lines_cleared),
        -i64::from(report.height_after),
        i64::from(report.perfect_clear),
        report
            .blocks_destroyed_by_size
            .into_iter()
            .map(i64::from)
            .sum(),
        0,
        0,
    ]
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
        PlayerModel::LineClearer
        | PlayerModel::DailyScore
        | PlayerModel::Theme
        | PlayerModel::PlannerStrong
        | PlayerModel::PlannerCasual
        | PlayerModel::PlannerStrongTheme
        | PlayerModel::PlannerStrongCombo
        | PlayerModel::PlannerGate => [
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

/// Closed-loop Monte Carlo tree search shared by Campaign and Daily.
///
/// Each node is a fully observed state. Expansion is bounded by the role's
/// action width, selection uses an integer UCT score, and the first unvisited
/// edge receives a line-clearer rollout. Stochastic outputs are supplied only
/// by the caller's policy-domain sampler, so the tree cannot inspect the run's
/// future VRF stream.
#[allow(clippy::too_many_arguments)]
fn mcts_plan<S, E, Key, Actions, Apply, Rollout, Value, Terminal>(
    initial: S,
    budget: PlannerBudget,
    seed: u64,
    root_action: u32,
    mut state_key: Key,
    mut actions: Actions,
    mut apply: Apply,
    mut rollout: Rollout,
    mut value: Value,
    mut terminal: Terminal,
) -> Result<Option<ActionKind>, E>
where
    S: Copy,
    Key: FnMut(S) -> [u8; 32],
    Actions: FnMut(S, u16, u8) -> Result<Vec<ActionKind>, E>,
    Apply: FnMut(S, ActionKind, u16, u8) -> Result<S, E>,
    Rollout: FnMut(S, u16, u8) -> Result<S, E>,
    Value: FnMut(S) -> u64,
    Terminal: FnMut(S) -> bool,
{
    let root_key = state_key(initial);
    let mut nodes = HashMap::<[u8; 32], PlannerNode>::new();
    for iteration in 0..budget.iterations {
        let mut state = initial;
        let mut path = Vec::<([u8; 32], usize)>::new();
        let mut expanded = false;
        for depth in 0..budget.tree_depth {
            if terminal(state) {
                break;
            }
            let key = state_key(state);
            if let Entry::Vacant(entry) = nodes.entry(key) {
                let edges = actions(state, iteration, depth)?
                    .into_iter()
                    .map(|action| PlannerEdge {
                        action,
                        visits: 0,
                        value_sum: 0,
                    })
                    .collect();
                entry.insert(PlannerNode { visits: 0, edges });
            }
            let Some(node) = nodes.get(&key) else {
                unreachable!("the planner node was inserted above");
            };
            if node.edges.is_empty() {
                break;
            }
            let unvisited = node
                .edges
                .iter()
                .enumerate()
                .filter_map(|(index, edge)| (edge.visits == 0).then_some(index))
                .collect::<Vec<_>>();
            let edge_index = if unvisited.is_empty() {
                select_uct_edge(node)
            } else {
                let slot = planner_policy_index(
                    seed,
                    root_action,
                    iteration,
                    depth,
                    &key,
                    unvisited.len(),
                );
                unvisited[slot]
            };
            let action = node.edges[edge_index].action;
            let was_unvisited = node.edges[edge_index].visits == 0;
            path.push((key, edge_index));
            state = apply(state, action, iteration, depth)?;
            if was_unvisited {
                state = rollout(state, iteration, depth.saturating_add(1))?;
                expanded = true;
                break;
            }
        }
        if !expanded && !terminal(state) {
            state = rollout(state, iteration, budget.tree_depth)?;
        }
        let reward = value(state);
        for (key, edge_index) in path {
            let node = nodes
                .get_mut(&key)
                .expect("every traversed planner node remains in the tree");
            node.visits = node.visits.saturating_add(1);
            let edge = &mut node.edges[edge_index];
            edge.visits = edge.visits.saturating_add(1);
            edge.value_sum = edge.value_sum.saturating_add(u128::from(reward));
        }
    }
    Ok(nodes.get(&root_key).and_then(best_root_action))
}

fn select_uct_edge(node: &PlannerNode) -> usize {
    node.edges
        .iter()
        .enumerate()
        .max_by(|(_, left), (_, right)| {
            uct_score(node.visits, left)
                .cmp(&uct_score(node.visits, right))
                .then_with(|| right.action.encoded().cmp(&left.action.encoded()))
        })
        .map_or(0, |(index, _)| index)
}

fn uct_score(parent_visits: u32, edge: &PlannerEdge) -> u128 {
    if edge.visits == 0 {
        return u128::MAX;
    }
    let mean = edge.value_sum / u128::from(edge.visits);
    // `ilog2 + 1` is a deterministic integer surrogate for ln(N). The base
    // changes only the exploration constant, not UCT's ordering or purpose.
    let log_parent = u64::from(parent_visits.max(2).ilog2() + 1);
    let exploration_ratio = log_parent.saturating_mul(1_000_000) / u64::from(edge.visits);
    let exploration = PLANNER_UCT_EXPLORATION.saturating_mul(exploration_ratio.isqrt()) / 1_000;
    mean.saturating_add(u128::from(exploration))
}

fn best_root_action(node: &PlannerNode) -> Option<ActionKind> {
    node.edges
        .iter()
        .filter(|edge| edge.visits > 0)
        .max_by(|left, right| {
            let left_mean = left.value_sum / u128::from(left.visits);
            let right_mean = right.value_sum / u128::from(right.visits);
            left.visits
                .cmp(&right.visits)
                .then_with(|| left_mean.cmp(&right_mean))
                .then_with(|| right.action.encoded().cmp(&left.action.encoded()))
        })
        .map(|edge| edge.action)
}

fn planner_policy_index(
    seed: u64,
    root_action: u32,
    iteration: u16,
    depth: u8,
    state_key: &[u8; 32],
    len: usize,
) -> usize {
    if len <= 1 {
        return 0;
    }
    let digest = SoftwareSha256::hashv(&[
        HARNESS_PLANNER_DOMAIN,
        b"select",
        &seed.to_le_bytes(),
        &root_action.to_le_bytes(),
        &iteration.to_le_bytes(),
        &[depth],
        state_key,
    ]);
    let value = u64::from_le_bytes(digest[..8].try_into().expect("eight digest bytes"));
    usize::try_from(value % len as u64).expect("modulo result fits usize")
}

fn bounded_actions(
    mut ranked: Vec<(ActionKind, [i64; 8])>,
    reroll_available: bool,
    width: u8,
) -> Vec<ActionKind> {
    ranked.sort_by(|left, right| {
        right
            .1
            .cmp(&left.1)
            .then_with(|| left.0.encoded().cmp(&right.0.encoded()))
    });
    ranked.dedup_by_key(|candidate| candidate.0.encoded());
    let width = usize::from(width.max(1));
    let best_bonus = ranked.iter().find_map(|candidate| {
        matches!(candidate.0, ActionKind::Bonus { .. }).then_some(candidate.0)
    });
    let reserve_reroll = usize::from(reroll_available);
    let reserve_bonus = usize::from(best_bonus.is_some() && width > reserve_reroll);
    let ranked_capacity = width.saturating_sub(reserve_reroll + reserve_bonus);
    let mut actions = ranked
        .iter()
        .take(ranked_capacity)
        .map(|candidate| candidate.0)
        .collect::<Vec<_>>();
    if let Some(bonus) = best_bonus.filter(|bonus| !actions.contains(bonus)) {
        actions.push(bonus);
    }
    if reroll_available {
        actions.push(ActionKind::Reroll);
    }
    for (action, _) in ranked {
        if actions.len() >= width {
            break;
        }
        if !actions.contains(&action) {
            actions.push(action);
        }
    }
    actions.truncate(width);
    actions
}

fn campaign_planner_actions(
    state: CampaignPlannerState,
    config: CampaignSimulationConfig,
    width: u8,
) -> Vec<ActionKind> {
    let mut ranked = campaign_move_candidates(state.simulation, config, PlayerModel::LineClearer)
        .into_iter()
        .chain(campaign_bonus_candidates(
            state.simulation,
            config,
            PlayerModel::LineClearer,
        ))
        .map(|candidate| (candidate.action, candidate.key))
        .collect::<Vec<_>>();
    let reroll_available = state.simulation.engine.reroll_available;
    if ranked.is_empty() && !reroll_available {
        return Vec::new();
    }
    bounded_actions(core::mem::take(&mut ranked), reroll_available, width)
}

fn daily_planner_actions(
    simulation: &DailySimulation,
    rules: DailyRunRules,
    width: u8,
) -> Vec<ActionKind> {
    let mut ranked = daily_move_candidates(simulation, rules, PlayerModel::LineClearer)
        .into_iter()
        .chain(daily_bonus_candidates(
            simulation,
            rules,
            PlayerModel::LineClearer,
        ))
        .map(|candidate| (candidate.action, candidate.key))
        .collect::<Vec<_>>();
    let reroll_available = simulation.engine.reroll_available;
    if ranked.is_empty() && !reroll_available {
        return Vec::new();
    }
    bounded_actions(core::mem::take(&mut ranked), reroll_available, width)
}

fn apply_campaign_planner_action(
    mut state: CampaignPlannerState,
    config: CampaignSimulationConfig,
    apex: ApexPredicate,
    action: ActionKind,
) -> Result<CampaignPlannerState, CampaignError> {
    if action == ActionKind::Reroll {
        state.simulation.request_reroll(config)?;
        return Ok(state);
    }
    let combo_before = state.simulation.engine.combo_counter;
    let mut report = match action {
        ActionKind::Move {
            row,
            start,
            destination,
        } => state.simulation.play_move(
            config,
            state.simulation.engine.moves,
            row,
            start,
            destination,
        )?,
        ActionKind::Bonus { row, column } => state.simulation.apply_bonus(config, row, column)?,
        ActionKind::Reroll => unreachable!("reroll returned above"),
    };
    report.difficulty_at_action = state.simulation.current_difficulty;
    state.metrics = record_campaign_metrics(state.metrics, combo_before, report);
    state.apex_progress = apex.advance(state.apex_progress, report, state.simulation.engine);
    Ok(state)
}

fn record_campaign_metrics(
    mut metrics: RunMetrics,
    combo_before: u8,
    report: MoveReport,
) -> RunMetrics {
    let blocks_destroyed = report
        .blocks_destroyed_by_size
        .into_iter()
        .map(u32::from)
        .sum();
    metrics
        .record_action(ActionMetrics {
            score: u64::from(report.points_earned),
            lines: u32::from(report.lines_cleared),
            blocks_destroyed,
            combo: u32::from(report.combo_counter),
            combo_derived_score: if report.combo_counter > combo_before {
                u64::from(report.points_earned)
            } else {
                0
            },
            perfect_clear: report.perfect_clear,
        })
        .expect("bounded Campaign planner metrics cannot overflow");
    metrics
}

fn apply_daily_planner_action(
    mut simulation: DailySimulation,
    rules: DailyRunRules,
    action: ActionKind,
) -> Result<DailySimulation, SimulationError> {
    match action {
        ActionKind::Move {
            row,
            start,
            destination,
        } => {
            simulation.play_move(
                rules,
                simulation.action_counter,
                simulation.engine.moves,
                row,
                start,
                destination,
            )?;
        }
        ActionKind::Bonus { row, column } => {
            simulation.apply_bonus(rules, simulation.action_counter, row, column)?;
        }
        ActionKind::Reroll => {
            simulation.request_reroll(rules, simulation.action_counter)?;
        }
    }
    Ok(simulation)
}

fn campaign_rollout(
    mut state: CampaignPlannerState,
    config: CampaignSimulationConfig,
    apex: ApexPredicate,
    action_budget: u16,
) -> Result<CampaignPlannerState, CampaignError> {
    let start = state.simulation.action_counter;
    let policy_seed = u64::from_le_bytes(
        config.seed[..8]
            .try_into()
            .expect("Campaign seed has eight prefix bytes"),
    );
    while !state.simulation.is_terminal()
        && state.simulation.action_counter.saturating_sub(start) < u32::from(action_budget)
    {
        let moves = campaign_move_candidates(state.simulation, config, PlayerModel::LineClearer);
        let Some(best_move) = choose_campaign(
            &moves,
            policy_seed,
            state.simulation.action_counter,
            PlayerModel::LineClearer,
        ) else {
            break;
        };
        let action = if state.simulation.engine.reroll_available
            && should_reroll(
                PlayerModel::LineClearer,
                state.simulation.action_counter,
                &best_move.report,
            ) {
            ActionKind::Reroll
        } else {
            let bonuses =
                campaign_bonus_candidates(state.simulation, config, PlayerModel::LineClearer);
            let best_bonus = choose_campaign(
                &bonuses,
                policy_seed,
                state.simulation.action_counter,
                PlayerModel::LineClearer,
            );
            if should_spend_campaign_bonus(
                PlayerModel::LineClearer,
                &state.simulation,
                &best_move,
                best_bonus.as_ref(),
            ) {
                best_bonus.map_or(best_move.action, |candidate| candidate.action)
            } else {
                best_move.action
            }
        };
        state = apply_campaign_planner_action(state, config, apex, action)?;
    }
    Ok(state)
}

#[allow(clippy::too_many_arguments)]
fn daily_rollout(
    mut simulation: DailySimulation,
    rules: DailyRunRules,
    entry_id: u8,
    seed: u64,
    root_action: u32,
    iteration: u16,
    action_budget: u16,
) -> Result<DailySimulation, SimulationError> {
    let start = simulation.action_counter;
    while simulation.action_counter.saturating_sub(start) < u32::from(action_budget) {
        resolve_daily_planner_vrf(
            &mut simulation,
            rules,
            entry_id,
            seed,
            root_action,
            iteration,
        )?;
        if simulation.engine.phase == RunPhase::Finished {
            break;
        }
        let moves = daily_move_candidates(&simulation, rules, PlayerModel::LineClearer);
        let Some(best_move) = choose_daily(
            &moves,
            seed,
            simulation.action_counter,
            PlayerModel::LineClearer,
        ) else {
            break;
        };
        let action = if simulation.engine.reroll_available
            && should_reroll(
                PlayerModel::LineClearer,
                simulation.action_counter,
                &best_move.report,
            ) {
            ActionKind::Reroll
        } else {
            let bonuses = daily_bonus_candidates(&simulation, rules, PlayerModel::LineClearer);
            let best_bonus = choose_daily(
                &bonuses,
                seed,
                simulation.action_counter,
                PlayerModel::LineClearer,
            );
            if should_spend_daily_bonus(PlayerModel::LineClearer, &best_move, best_bonus.as_ref()) {
                best_bonus.map_or(best_move.action, |candidate| candidate.action)
            } else {
                best_move.action
            }
        };
        simulation = apply_daily_planner_action(simulation, rules, action)?;
    }
    Ok(simulation)
}

fn planner_campaign_config(
    mut config: CampaignSimulationConfig,
    seed: u64,
    root_action: u32,
    iteration: u16,
) -> CampaignSimulationConfig {
    config.seed = SoftwareSha256::hashv(&[
        HARNESS_PLANNER_DOMAIN,
        b"campaign-future",
        &seed.to_le_bytes(),
        &root_action.to_le_bytes(),
        &iteration.to_le_bytes(),
    ]);
    config
}

fn resolve_daily_planner_vrf(
    simulation: &mut DailySimulation,
    rules: DailyRunRules,
    entry_id: u8,
    seed: u64,
    root_action: u32,
    iteration: u16,
) -> Result<(), SimulationError> {
    if simulation.engine.phase != RunPhase::AwaitingVrf {
        return Ok(());
    }
    let counter = simulation.last_vrf_counter.saturating_add(1);
    let output = SoftwareSha256::hashv(&[
        HARNESS_PLANNER_DOMAIN,
        b"daily-future",
        &seed.to_le_bytes(),
        &root_action.to_le_bytes(),
        &iteration.to_le_bytes(),
        &[entry_id],
        &counter.to_le_bytes(),
    ]);
    simulation.apply_vrf(rules, counter, output)
}

fn campaign_planner_value(
    state: CampaignPlannerState,
    rules: CampaignRules,
    apex: ApexPredicate,
    value: PlannerValue,
) -> u64 {
    let star_value =
        u64::from(state.simulation.earned_stars.min(3)).saturating_mul(PLANNER_STAR_STEP);
    let score_target = u64::from(rules.level.points_required.max(1));
    let score_progress = u64::from(state.simulation.engine.score)
        .min(score_target)
        .saturating_mul(PLANNER_SCORE_PROGRESS_RANGE)
        / score_target;
    let primary_required = u64::from(rules.level.primary.required_count.max(1));
    let primary_progress = u64::from(state.simulation.engine.primary_progress)
        .min(primary_required)
        .saturating_mul(PLANNER_CAMPAIGN_PRIMARY_RANGE)
        / primary_required;
    let apex_progress = apex
        .progress_x1000(state.apex_progress)
        .saturating_mul(PLANNER_APEX_PROGRESS_RANGE)
        / 1_000;
    let combo = if value == PlannerValue::CampaignCombo {
        u64::from(state.metrics.maximum_combo.min(8)).saturating_mul(PLANNER_CAMPAIGN_COMBO_RANGE)
            / 8
    } else {
        0
    };
    let height = u64::try_from(GRID_HEIGHT)
        .expect("grid height fits u64")
        .saturating_sub(u64::from(state.simulation.engine.grid.occupied_height()))
        .saturating_mul(PLANNER_HEIGHT_RANGE)
        / u64::try_from(GRID_HEIGHT).expect("grid height fits u64");
    star_value
        .saturating_add(score_progress)
        .saturating_add(primary_progress)
        .saturating_add(apex_progress)
        .saturating_add(combo)
        .saturating_add(height)
}

fn daily_planner_value(simulation: &DailySimulation, value: PlannerValue) -> u64 {
    let metric = if value == PlannerValue::DailyTheme {
        simulation.objective_total
    } else {
        u64::from(simulation.daily_score)
    };
    let metric_value = metric
        .min(PLANNER_DAILY_METRIC_CAP)
        .saturating_mul(PLANNER_DAILY_METRIC_RANGE)
        / PLANNER_DAILY_METRIC_CAP;
    let height = u64::try_from(GRID_HEIGHT)
        .expect("grid height fits u64")
        .saturating_sub(u64::from(simulation.engine.grid.occupied_height()))
        .saturating_mul(PLANNER_HEIGHT_RANGE)
        / u64::try_from(GRID_HEIGHT).expect("grid height fits u64");
    metric_value.saturating_add(height)
}

fn plan_campaign_action(
    state: CampaignPlannerState,
    config: CampaignSimulationConfig,
    apex: ApexPredicate,
    spec: PlannerSpec,
    seed: u64,
) -> Result<Option<ActionKind>, CampaignError> {
    let root_action = state.simulation.action_counter;
    mcts_plan(
        state,
        spec.budget,
        seed,
        root_action,
        campaign_planner_state_key,
        |current, iteration, _| {
            let sampled = planner_campaign_config(config, seed, root_action, iteration);
            Ok(campaign_planner_actions(
                current,
                sampled,
                spec.budget.action_width,
            ))
        },
        |current, action, iteration, _| {
            let sampled = planner_campaign_config(config, seed, root_action, iteration);
            apply_campaign_planner_action(current, sampled, apex, action)
        },
        |current, iteration, _| {
            let sampled = planner_campaign_config(config, seed, root_action, iteration);
            campaign_rollout(current, sampled, apex, spec.budget.rollout_actions)
        },
        |current| campaign_planner_value(current, config.rules, apex, spec.value),
        |current| current.simulation.is_terminal(),
    )
}

fn plan_daily_action(
    simulation: &DailySimulation,
    rules: DailyRunRules,
    entry_id: u8,
    spec: PlannerSpec,
    seed: u64,
) -> Result<Option<ActionKind>, SimulationError> {
    let root_action = simulation.action_counter;
    mcts_plan(
        *simulation,
        spec.budget,
        seed,
        root_action,
        |current| daily_planner_state_key(&current),
        |current, _, _| {
            Ok(daily_planner_actions(
                &current,
                rules,
                spec.budget.action_width,
            ))
        },
        |current, action, iteration, _| {
            let mut next = apply_daily_planner_action(current, rules, action)?;
            resolve_daily_planner_vrf(&mut next, rules, entry_id, seed, root_action, iteration)?;
            Ok(next)
        },
        |current, iteration, _| {
            daily_rollout(
                current,
                rules,
                entry_id,
                seed,
                root_action,
                iteration,
                spec.budget.rollout_actions,
            )
        },
        |current| daily_planner_value(&current, spec.value),
        |current| current.engine.phase == RunPhase::Finished,
    )
}

fn encode_engine(engine: crate::RunEngine, output: &mut Vec<u8>) {
    let crate::RunEngine {
        grid,
        next_row,
        phase,
        score,
        moves,
        combo_counter,
        max_combo,
        primary_progress,
        secondary_progress,
        level_lines_cleared,
        bonus,
        bonus_charges,
        reroll_available,
        perfect_trigger_available,
        starting_height_target,
    } = engine;
    output.extend_from_slice(grid.cells());
    output.push(u8::from(next_row.is_some()));
    output.extend_from_slice(&next_row.unwrap_or([0; GRID_WIDTH]));
    output.push(match phase {
        RunPhase::Ready => 0,
        RunPhase::Playing => 1,
        RunPhase::AwaitingVrf => 2,
        RunPhase::LevelComplete => 3,
        RunPhase::Finished => 4,
    });
    output.extend_from_slice(&score.to_le_bytes());
    output.extend_from_slice(&moves.to_le_bytes());
    output.extend_from_slice(&[
        combo_counter,
        max_combo,
        primary_progress,
        secondary_progress,
    ]);
    output.extend_from_slice(&level_lines_cleared.to_le_bytes());
    output.push(match bonus {
        None => 0,
        Some(Bonus::Hammer) => 1,
        Some(Bonus::Totem) => 2,
        Some(Bonus::Wave) => 3,
    });
    output.extend_from_slice(&[
        bonus_charges,
        u8::from(reroll_available),
        u8::from(perfect_trigger_available),
        starting_height_target,
    ]);
}

fn encode_metrics(metrics: RunMetrics, output: &mut Vec<u8>) {
    let RunMetrics {
        maximum_combo,
        combo_scoring_actions,
        total_combo_derived_score,
        highest_action_score,
        most_lines_in_action,
        most_blocks_destroyed_in_action,
        total_lines,
        total_blocks_destroyed,
        perfect_clears,
    } = metrics;
    output.extend_from_slice(&maximum_combo.to_le_bytes());
    output.extend_from_slice(&combo_scoring_actions.to_le_bytes());
    output.extend_from_slice(&total_combo_derived_score.to_le_bytes());
    output.extend_from_slice(&highest_action_score.to_le_bytes());
    output.extend_from_slice(&most_lines_in_action.to_le_bytes());
    output.extend_from_slice(&most_blocks_destroyed_in_action.to_le_bytes());
    output.extend_from_slice(&total_lines.to_le_bytes());
    output.extend_from_slice(&total_blocks_destroyed.to_le_bytes());
    output.extend_from_slice(&perfect_clears.to_le_bytes());
}

fn campaign_planner_state_key(state: CampaignPlannerState) -> [u8; 32] {
    let mut encoded = Vec::with_capacity(160);
    encode_engine(state.simulation.engine, &mut encoded);
    encoded.extend_from_slice(&state.simulation.action_counter.to_le_bytes());
    encoded.extend_from_slice(&state.simulation.row_counter.to_le_bytes());
    encoded.push(state.simulation.current_difficulty);
    encoded.push(match state.simulation.end_reason {
        None => 0,
        Some(CampaignEndReason::Completed) => 1,
        Some(CampaignEndReason::Exhausted) => 2,
        Some(CampaignEndReason::Abandoned) => 3,
    });
    encoded.push(state.simulation.earned_stars);
    encode_metrics(state.metrics, &mut encoded);
    encoded.extend_from_slice(&state.apex_progress.0.to_le_bytes());
    SoftwareSha256::hashv(&[HARNESS_PLANNER_STATE_DOMAIN, &encoded])
}

fn campaign_oracle_state_key(state: CampaignPlannerState) -> [u8; 32] {
    let mut encoded = Vec::with_capacity(128);
    encode_engine(state.simulation.engine, &mut encoded);
    encoded.extend_from_slice(&state.simulation.action_counter.to_le_bytes());
    encoded.extend_from_slice(&state.simulation.row_counter.to_le_bytes());
    encoded.push(state.simulation.current_difficulty);
    // Brief 04 moves this byte into the engine. Keeping it here until then
    // makes today's search key equally complete across that transition.
    encoded.push(state.simulation.earned_stars);
    encoded.extend_from_slice(&state.apex_progress.0.to_le_bytes());
    SoftwareSha256::hashv(&[HARNESS_ORACLE_STATE_DOMAIN, &encoded])
}

fn daily_planner_state_key(simulation: &DailySimulation) -> [u8; 32] {
    let mut encoded = Vec::with_capacity(192);
    encode_engine(simulation.engine, &mut encoded);
    encode_metrics(simulation.metrics, &mut encoded);
    encoded.extend_from_slice(&simulation.action_counter.to_le_bytes());
    encoded.extend_from_slice(&simulation.daily_score.to_le_bytes());
    encoded.extend_from_slice(&simulation.objective_total.to_le_bytes());
    encoded.extend_from_slice(&simulation.pressure_score.to_le_bytes());
    encoded.push(simulation.current_difficulty);
    encoded.extend_from_slice(&simulation.last_vrf_counter.to_le_bytes());
    encoded.push(u8::from(simulation.deadline_finished));
    SoftwareSha256::hashv(&[HARNESS_PLANNER_STATE_DOMAIN, &encoded])
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
    // Pack target: a just-in-time player exercises 1 and 10, a seven-Kredit
    // reorder exercises 10 and 25, and a ten-Kredit reorder exercises 25. The
    // 365-day field holdout bought [50,553, 5,790, 0], [0, 20,056, 1,237], and
    // [0, 0, 16,739] packs in those three scenarios respectively.
    #[must_use]
    pub const fn low_retention() -> Self {
        Self {
            seed: 0x4610,
            measured_days: 365,
            wallets: 2_000,
            ability_mix_bps: [2_500, 3_000, 3_000, 1_500],
            base_attendance_bps: [700, 1_200, 1_500, 1_700],
            streak_response_bps_per_day: 8,
            multi_entry_wallet_bps: 1_000,
            maximum_entries_per_attendance: 3,
            reorder_target: 0,
        }
    }

    #[must_use]
    pub const fn base() -> Self {
        Self {
            seed: 0x4611,
            measured_days: 365,
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
            measured_days: 365,
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
    pub wallets_by_ability: [u32; 4],
    pub ending_ladder_tiers_by_ability: [[u32; FIELD_LADDER_TIERS]; 4],
    /// Median first-reach day among wallets of that ability that reached the
    /// tier; zero means no wallet reached it in the measured window.
    pub median_ladder_reach_day_by_ability: [[u16; FIELD_LADDER_TIERS]; 4],
    pub median_ladder_points_by_ability: [u64; 4],
    pub top_ladder_points_by_ability: [u64; 4],
}

#[derive(Clone, Copy, Debug, Default)]
struct WalletState {
    ability: usize,
    balance: u16,
    streak: u16,
    attended_ever: bool,
    ladder_points: u64,
    ladder_reach_day: [u16; FIELD_LADDER_TIERS],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct QualifiedWallet {
    wallet_index: usize,
    metric: u32,
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
    validate_field_inputs(assumptions, pack_sizes)?;
    let mut wallets = (0..assumptions.wallets)
        .map(|wallet| WalletState {
            ability: field_ability(assumptions, wallet),
            ..WalletState::default()
        })
        .collect::<Vec<_>>();
    let mut totals = FieldTotals {
        pack_purchases: vec![0u64; pack_sizes.len()],
        ..FieldTotals::default()
    };
    let daily_entries = daily_catalog();
    let entry_count = u8::try_from(daily_entries.len())
        .map_err(|_| String::from("Daily field catalog exceeds u8"))?;
    let mut current_daily_pot = 0u64;

    for day in 0..=u32::from(assumptions.measured_days) {
        let entry_index = usize::from(
            daily_pool_entry_index(0, day, entry_count)
                .map_err(|error| format!("field draw failed: {error:?}"))?,
        );
        let classic =
            daily_entries[entry_index].rules.objective.objective == DailyObjective::Classic;
        let mut score_qualified = Vec::new();
        let mut theme_qualified = Vec::new();
        let mut next_daily_pot = 0u64;
        for (wallet_id, wallet) in (0..assumptions.wallets).zip(wallets.iter_mut()) {
            let Some(entries) = wallet_entries_today(assumptions, day, wallet_id, wallet)? else {
                continue;
            };
            totals.longest_streak = totals.longest_streak.max(wallet.streak);
            reorder_kredits(
                wallet,
                entries,
                assumptions.reorder_target,
                pack_sizes,
                (day > 0).then_some(&mut totals.pack_purchases),
            );
            wallet.balance = wallet.balance.saturating_sub(entries);
            next_daily_pot = u64::from(entries)
                .checked_mul(ENTRY_DAILY_LAMPORTS)
                .and_then(|lamports| next_daily_pot.checked_add(lamports))
                .ok_or_else(|| String::from("field pot overflow"))?;
            if day == 0 {
                totals.warmup_entries = totals.warmup_entries.saturating_add(u32::from(entries));
            } else {
                totals.record_measured(wallet.ability, entries);
                let (score, theme) = qualify_wallet_day(
                    assumptions.seed,
                    day,
                    wallet_id,
                    wallet.ability,
                    entries,
                    classic,
                );
                let wallet_index = usize::try_from(wallet_id)
                    .map_err(|_| String::from("wallet index exceeds usize"))?;
                score_qualified.extend(score.map(|metric| QualifiedWallet {
                    wallet_index,
                    metric,
                }));
                theme_qualified.extend(theme.map(|metric| QualifiedWallet {
                    wallet_index,
                    metric,
                }));
            }
        }
        if day > 0 {
            award_field_ladder_day(
                day,
                current_daily_pot,
                classic,
                &mut score_qualified,
                &mut theme_qualified,
                &mut wallets,
            )?;
        }
        current_daily_pot = next_daily_pot;
    }
    summarize_field(assumptions, pack_sizes, &wallets, totals)
}

/// Decide whether the wallet attends today and, if so, how many entries it
/// buys. Attendance is the ability's base rate plus the streak response;
/// a missed day resets the streak. Returns `None` on a missed day.
fn wallet_entries_today(
    assumptions: FieldAssumptions,
    day: u32,
    wallet_id: u32,
    wallet: &mut WalletState,
) -> Result<Option<u16>, String> {
    let attendance = u32::from(assumptions.base_attendance_bps[wallet.ability])
        .saturating_add(
            u32::from(wallet.streak)
                .saturating_mul(u32::from(assumptions.streak_response_bps_per_day)),
        )
        .min(10_000);
    if field_draw(assumptions.seed, day, wallet_id, 0) >= attendance {
        wallet.streak = 0;
        return Ok(None);
    }
    wallet.streak = wallet.streak.saturating_add(1);
    wallet.attended_ever = true;
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
        u16::try_from(extra).map_err(|_| String::from("per-attendance entries exceed u16"))?,
    );
    Ok(Some(entries))
}

/// Split the day's pot across the two boards — all of it to Score on a
/// Classic day — and award both ladders.
fn award_field_ladder_day(
    day: u32,
    pot: u64,
    classic: bool,
    score_qualified: &mut [QualifiedWallet],
    theme_qualified: &mut [QualifiedWallet],
    wallets: &mut [WalletState],
) -> Result<(), String> {
    let score_pool = if classic { pot } else { pot / 2 };
    let theme_pool = pot.saturating_sub(score_pool);
    award_field_ladder_board(day, score_pool, score_qualified, wallets)?;
    award_field_ladder_board(day, theme_pool, theme_qualified, wallets)
}

fn validate_field_inputs(assumptions: FieldAssumptions, pack_sizes: &[u8]) -> Result<(), String> {
    let mix_sums_to_one = assumptions
        .ability_mix_bps
        .iter()
        .map(|value| u32::from(*value))
        .sum::<u32>()
        == 10_000;
    let attendance_is_probability = assumptions
        .base_attendance_bps
        .iter()
        .all(|value| *value <= 10_000);
    let packs_ascend = !pack_sizes.is_empty()
        && !pack_sizes.contains(&0)
        && pack_sizes.windows(2).all(|pair| pair[0] < pair[1]);
    if assumptions.wallets == 0
        || assumptions.measured_days == 0
        || !mix_sums_to_one
        || !attendance_is_probability
        || assumptions.maximum_entries_per_attendance == 0
        || !packs_ascend
    {
        return Err(String::from("invalid field assumptions or pack sizes"));
    }
    Ok(())
}

/// Buy the smallest pack that restores `entries + reorder_target` Kredits,
/// falling back to the largest pack, until the day's entries are covered.
/// Warm-up purchases pass `None` so they are not counted.
fn reorder_kredits(
    wallet: &mut WalletState,
    entries: u16,
    reorder_target: u8,
    pack_sizes: &[u8],
    mut pack_purchases: Option<&mut Vec<u64>>,
) {
    while wallet.balance < entries {
        let target = entries.saturating_add(u16::from(reorder_target));
        let needed = target.saturating_sub(wallet.balance);
        let pack_index = pack_sizes
            .iter()
            .position(|size| u16::from(*size) >= needed)
            .unwrap_or(pack_sizes.len() - 1);
        wallet.balance = wallet
            .balance
            .saturating_add(u16::from(pack_sizes[pack_index]));
        if let Some(purchases) = pack_purchases.as_deref_mut() {
            purchases[pack_index] = purchases[pack_index].saturating_add(1);
        }
    }
}

/// The wallet's best qualifying Score and Theme metrics for the day, if any.
/// A Classic day has no Theme board, so its Theme metric is always absent.
fn qualify_wallet_day(
    seed: u64,
    day: u32,
    wallet_id: u32,
    ability: usize,
    entries: u16,
    classic: bool,
) -> (Option<u32>, Option<u32>) {
    let score = field_best_metric(
        seed,
        day,
        wallet_id,
        entries,
        FIELD_SCORE_QUALIFICATION_BPS[ability],
        FIELD_SCORE_ANCHORS[ability],
        16,
    );
    let theme = if classic {
        None
    } else {
        field_best_metric(
            seed,
            day,
            wallet_id,
            entries,
            FIELD_THEME_QUALIFICATION_BPS[ability],
            FIELD_THEME_ANCHORS[ability],
            32,
        )
    };
    (score, theme)
}

/// Per-run counters that the day loop accumulates before the wallets are
/// summarised.
#[derive(Default)]
struct FieldTotals {
    warmup_entries: u32,
    measured_entries: u64,
    entries_by_ability: [u64; 4],
    wallet_days: [u64; 4],
    pack_purchases: Vec<u64>,
    longest_streak: u16,
}

impl FieldTotals {
    fn record_measured(&mut self, ability: usize, entries: u16) {
        self.measured_entries = self.measured_entries.saturating_add(u64::from(entries));
        self.entries_by_ability[ability] =
            self.entries_by_ability[ability].saturating_add(u64::from(entries));
        self.wallet_days[ability] = self.wallet_days[ability].saturating_add(1);
    }
}

fn summarize_field(
    assumptions: FieldAssumptions,
    pack_sizes: &[u8],
    wallets: &[WalletState],
    totals: FieldTotals,
) -> Result<FieldSummary, String> {
    let mut wallets_by_ability = [0u32; 4];
    let mut ending_ladder_tiers_by_ability = [[0u32; FIELD_LADDER_TIERS]; 4];
    let mut ladder_points_by_ability: [Vec<u64>; 4] = core::array::from_fn(|_| Vec::new());
    let mut ladder_days_by_ability: [[Vec<u16>; FIELD_LADDER_TIERS]; 4] =
        core::array::from_fn(|_| core::array::from_fn(|_| Vec::new()));
    for wallet in wallets {
        wallets_by_ability[wallet.ability] = wallets_by_ability[wallet.ability].saturating_add(1);
        let tier = usize::from(ladder_tier_for_points(wallet.ladder_points));
        ending_ladder_tiers_by_ability[wallet.ability][tier] =
            ending_ladder_tiers_by_ability[wallet.ability][tier].saturating_add(1);
        ladder_points_by_ability[wallet.ability].push(wallet.ladder_points);
        for (tier, day) in wallet.ladder_reach_day.iter().copied().enumerate().skip(1) {
            if day > 0 {
                ladder_days_by_ability[wallet.ability][tier].push(day);
            }
        }
    }
    let mut median_ladder_reach_day_by_ability = [[0u16; FIELD_LADDER_TIERS]; 4];
    let mut median_ladder_points_by_ability = [0u64; 4];
    let mut top_ladder_points_by_ability = [0u64; 4];
    for ability in 0..4 {
        ladder_points_by_ability[ability].sort_unstable();
        median_ladder_points_by_ability[ability] =
            median(&ladder_points_by_ability[ability]).unwrap_or(0);
        top_ladder_points_by_ability[ability] = ladder_points_by_ability[ability]
            .last()
            .copied()
            .unwrap_or(0);
        for tier in 1..FIELD_LADDER_TIERS {
            ladder_days_by_ability[ability][tier].sort_unstable();
            median_ladder_reach_day_by_ability[ability][tier] =
                median(&ladder_days_by_ability[ability][tier]).unwrap_or(0);
        }
    }
    Ok(FieldSummary {
        assumptions,
        pack_sizes: pack_sizes.to_vec(),
        warmup_entries: totals.warmup_entries,
        measured_entries: totals.measured_entries,
        unique_attending_wallets: u32::try_from(
            wallets.iter().filter(|wallet| wallet.attended_ever).count(),
        )
        .map_err(|_| String::from("attending wallet count exceeds u32"))?,
        entries_by_ability: totals.entries_by_ability,
        attending_wallet_days_by_ability: totals.wallet_days,
        pack_purchases: totals.pack_purchases,
        ending_kredits: wallets.iter().map(|wallet| u64::from(wallet.balance)).sum(),
        longest_streak: totals.longest_streak,
        wallets_by_ability,
        ending_ladder_tiers_by_ability,
        median_ladder_reach_day_by_ability,
        median_ladder_points_by_ability,
        top_ladder_points_by_ability,
    })
}

fn field_best_metric(
    seed: u64,
    day: u32,
    wallet: u32,
    entries: u16,
    qualification_bps: u16,
    anchor: u32,
    purpose_base: u8,
) -> Option<u32> {
    let mut best = None;
    for attempt in 0..u8::try_from(entries).ok()? {
        let purpose = purpose_base.checked_add(attempt.checked_mul(2)?)?;
        if field_draw(seed, day, wallet, purpose) >= u32::from(qualification_bps) {
            continue;
        }
        let variation = field_draw(seed, day, wallet, purpose.checked_add(1)?);
        best = Some(
            best.unwrap_or(0)
                .max(anchor.saturating_mul(100) + variation),
        );
    }
    best
}

fn award_field_ladder_board(
    day: u32,
    pool: u64,
    qualified: &mut [QualifiedWallet],
    wallets: &mut [WalletState],
) -> Result<(), String> {
    let qualified_count = u32::try_from(qualified.len())
        .map_err(|_| String::from("field qualified count exceeds u32"))?;
    if qualified_count == 0 {
        return Ok(());
    }
    qualified.sort_unstable_by(|left, right| {
        right
            .metric
            .cmp(&left.metric)
            .then_with(|| left.wallet_index.cmp(&right.wallet_index))
    });
    for row in qualified.iter() {
        record_field_ladder_points(
            &mut wallets[row.wallet_index],
            u64::from(LADDER_QUALIFY_POINTS),
            day,
        )?;
    }
    let width = board_width(
        pool,
        qualified_count,
        ARENA_ENTRY_LAMPORTS,
        SOL_PAYOUT_UNIT_LAMPORTS,
    )
    .map_err(|error| format!("field board width failed: {error:?}"))?;
    let winner_count = usize::try_from(width.winner_count)
        .map_err(|_| String::from("field winner count exceeds usize"))?;
    for (index, row) in qualified[..winner_count].iter().enumerate() {
        let rank = u32::try_from(index + 1).map_err(|_| String::from("field rank exceeds u32"))?;
        let points = ladder_points(qualified_count, rank)
            .map_err(|error| format!("field ladder points failed: {error:?}"))?;
        record_field_ladder_points(&mut wallets[row.wallet_index], u64::from(points), day)?;
    }
    Ok(())
}

fn record_field_ladder_points(
    wallet: &mut WalletState,
    points: u64,
    day: u32,
) -> Result<(), String> {
    wallet.ladder_points = wallet
        .ladder_points
        .checked_add(points)
        .ok_or_else(|| String::from("field ladder points overflow"))?;
    let day = u16::try_from(day).map_err(|_| String::from("field day exceeds u16"))?;
    for (tier, threshold) in LADDER_TIER_POINT_THRESHOLDS
        .iter()
        .copied()
        .enumerate()
        .skip(1)
    {
        if wallet.ladder_reach_day[tier] == 0 && wallet.ladder_points >= threshold {
            wallet.ladder_reach_day[tier] = day;
        }
    }
    Ok(())
}

fn median<T: Copy>(sorted: &[T]) -> Option<T> {
    sorted.get(sorted.len() / 2).copied()
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

    const HOLDOUT_SEED_PREFIX: u64 = 0x9000_0000_0000_0000;

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
            "{\"dailyRuns\":2,\"campaignRuns\":2,\"dailyScoreSum\":319,\"objectiveSum\":158,\"campaignScoreSum\":15,\"completedCampaignRuns\":1,\"chargesEarned\":7,\"digestHex\":\"71ffdaf1b49604116d7ef60b3f7f7e90274dc9e480da7948251b6d29e4df8874\"}"
        );
    }

    #[test]
    fn run_records_preserve_decisions_and_expose_canonical_instrumentation() {
        let daily_entries = daily_catalog();
        let campaign_levels = campaign_catalog();
        let records = [
            run_daily(
                daily_entries[1],
                PlayerModel::DailyScore,
                SeedPartition::Holdout,
                41,
            )
            .unwrap(),
            run_daily(
                daily_entries[6],
                PlayerModel::Theme,
                SeedPartition::Holdout,
                73,
            )
            .unwrap(),
            run_campaign(
                campaign_levels[2],
                PlayerModel::CampaignConstraints,
                SeedPartition::Holdout,
                101,
            )
            .unwrap(),
            run_campaign(
                campaign_levels[79],
                PlayerModel::LineClearer,
                SeedPartition::Holdout,
                211,
            )
            .unwrap(),
        ];
        assert_eq!(
            records
                .iter()
                .map(|record| record.decision_digest_hex.as_str())
                .collect::<Vec<_>>(),
            [
                "2ac947a6b92017582123e6d693df49817cc334977827bf4df8bfce4cd86ebde3",
                "73a81721cf1d3c448efdea5a50c3955a160844fd487a771a9830ade6bda607a0",
                "76a43dafd04e011185eb7e430a121167c66d5302e4c77e5b5ef8c04bb2bf2de1",
                "b8381b2b18c1caa38c9ad62e41927353c2b4f0467aaf58267e4e96e29700fbad",
            ]
        );
        for record in records {
            assert_ne!(record.metrics, RunMetrics::default());
            assert_eq!(
                record
                    .bonus_charge_earned_events
                    .iter()
                    .map(|event| u32::from(event.count))
                    .sum::<u32>(),
                record.charges_earned_before_cap
            );
            assert_eq!(
                record
                    .bonus_spent_events
                    .iter()
                    .map(|event| event.count)
                    .sum::<u16>(),
                record.charges_spent
            );
            assert_eq!(
                record
                    .reroll_spent_events
                    .iter()
                    .map(|event| event.count)
                    .sum::<u16>(),
                record.rerolls_used
            );
            assert!(record.reroll_granted_events.is_empty());
            assert!(record.reroll_grant_discarded_events.is_empty());
        }
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

        let level = campaign_catalog()[0];
        let actual = campaign_simulation_config(level, SeedPartition::Holdout, 9);
        let sampled = planner_campaign_config(actual, 9, 3, 0);
        assert_ne!(actual.seed, sampled.seed);
        assert_ne!(vrf, sampled.seed);
    }

    #[test]
    fn planner_is_future_blind_and_reproducible() {
        let level = campaign_catalog()[0];
        let config = campaign_simulation_config(level, SeedPartition::Holdout, 1_024);
        let state = CampaignPlannerState {
            simulation: CampaignSimulation::new(config).unwrap(),
            metrics: RunMetrics::default(),
            apex_progress: ApexProgress::default(),
        };
        let spec = PlayerModel::PlannerCasual.planner().unwrap();
        let first = plan_campaign_action(state, config, level.apex, spec, 1_024).unwrap();
        let second = plan_campaign_action(state, config, level.apex, spec, 1_024).unwrap();
        assert_eq!(first, second);

        // The observed state is held fixed while the run's hidden future is
        // changed. Planning must remain unchanged because every rollout gets a
        // policy-domain sample instead of that hidden stream.
        let mut hidden_future_changed = config;
        hidden_future_changed.seed = [0xa5; 32];
        assert_eq!(
            first,
            plan_campaign_action(state, hidden_future_changed, level.apex, spec, 1_024,).unwrap()
        );
    }

    #[test]
    fn planner_gate_digest_covers_eight_holdout_seeds() {
        let level = campaign_catalog()[0];
        let spec = PlayerModel::PlannerStrong.planner().unwrap();
        let mut digest = [0; 32];
        for seed_index in 1_024..1_032 {
            let seed = HOLDOUT_SEED_PREFIX | seed_index;
            let config = campaign_simulation_config(level, SeedPartition::Holdout, seed);
            let state = CampaignPlannerState {
                simulation: CampaignSimulation::new(config).unwrap(),
                metrics: RunMetrics::default(),
                apex_progress: ApexProgress::default(),
            };
            let action = plan_campaign_action(state, config, level.apex, spec, seed)
                .unwrap()
                .expect("an authored opening has a legal action");
            digest = SoftwareSha256::hashv(&[
                b"zkube-sim-harness-planner-gate-v1",
                &digest,
                &seed.to_le_bytes(),
                &action.encoded(),
            ]);
        }
        assert_eq!(
            bytes_to_hex(digest),
            "c2e7641b3d7290de2a9472efabedea81ad1a8cd3547549fb73fa62849107d2dc"
        );
    }

    #[test]
    fn bounded_planner_expansion_retains_every_action_class() {
        let level = campaign_catalog()[0];
        let config = campaign_simulation_config(level, SeedPartition::Holdout, 1_024);
        let mut simulation = CampaignSimulation::new(config).unwrap();
        simulation.engine.bonus = Some(Bonus::Hammer);
        simulation.engine.bonus_charges = 1;
        simulation.engine.reroll_available = true;
        let state = CampaignPlannerState {
            simulation,
            metrics: RunMetrics::default(),
            apex_progress: ApexProgress::default(),
        };
        let actions = campaign_planner_actions(state, config, PLANNER_STRONG.action_width);
        assert!(
            actions
                .iter()
                .any(|action| matches!(action, ActionKind::Move { .. }))
        );
        assert!(
            actions
                .iter()
                .any(|action| matches!(action, ActionKind::Bonus { .. }))
        );
        assert!(actions.contains(&ActionKind::Reroll));
    }

    #[test]
    fn oracle_key_covers_transition_counters_and_predicate_progress() {
        let level = campaign_catalog()[0];
        let config = campaign_simulation_config(level, SeedPartition::Holdout, 1_024);
        let state = CampaignPlannerState {
            simulation: CampaignSimulation::new(config).unwrap(),
            metrics: RunMetrics::default(),
            apex_progress: ApexProgress::default(),
        };
        let key = campaign_oracle_state_key(state);

        let mut changed = state;
        changed.simulation.engine.bonus_charges =
            changed.simulation.engine.bonus_charges.saturating_add(1);
        assert_ne!(key, campaign_oracle_state_key(changed));
        changed = state;
        changed.simulation.engine.primary_progress = 1;
        assert_ne!(key, campaign_oracle_state_key(changed));
        changed = state;
        changed.simulation.action_counter = 1;
        assert_ne!(key, campaign_oracle_state_key(changed));
        changed = state;
        changed.simulation.row_counter = changed.simulation.row_counter.saturating_add(1);
        assert_ne!(key, campaign_oracle_state_key(changed));
        changed = state;
        changed.simulation.current_difficulty =
            changed.simulation.current_difficulty.saturating_add(1);
        assert_ne!(key, campaign_oracle_state_key(changed));
        changed = state;
        changed.apex_progress = ApexProgress(1);
        assert_ne!(key, campaign_oracle_state_key(changed));

        let rerolled =
            apply_campaign_planner_action(state, config, ApexPredicate::None, ActionKind::Reroll)
                .unwrap();
        assert_ne!(key, campaign_oracle_state_key(rerolled));
        assert_eq!(
            rerolled.simulation.row_counter,
            state.simulation.row_counter + 1
        );
    }

    #[test]
    fn oracle_is_bounded_reproducible_and_targets_the_apex_predicate() {
        let mut level = campaign_catalog()[0];
        level.rules.level.points_required = u32::MAX;
        level.rules.level.max_moves = 1;
        let no_constraint = Constraint {
            kind: ConstraintKind::None,
            value: 0,
            required_count: 0,
        };
        level.rules.level.primary = no_constraint;
        level.rules.level.secondary = no_constraint;
        level.rules.mutator = MutatorRules::default();
        level.rules.bonus = None;
        level.rules.starting_bonus_charges = 0;
        level.apex = ApexPredicate::LinesInAction { minimum: 1 };

        let first = oracle_campaign(level, SeedPartition::Holdout, 1_024).unwrap();
        let second = oracle_campaign(level, SeedPartition::Holdout, 1_024).unwrap();
        assert_eq!(first, second);
        assert!(!first.reachability.one_star_reachable);
        assert!(!first.reachability.two_stars_reachable);
        assert!(first.reachability.apex_reachable);
        assert!(!first.node_cap_hit);
        assert!(first.visited_states <= ORACLE_NODE_BUDGET);
    }

    #[test]
    fn casual_planner_drives_both_real_simulations_to_a_terminal_state() {
        let campaign = run_campaign(
            campaign_catalog()[0],
            PlayerModel::PlannerCasual,
            SeedPartition::Holdout,
            1_024,
        )
        .unwrap();
        let daily = run_daily(
            daily_catalog()[0],
            PlayerModel::PlannerCasual,
            SeedPartition::Holdout,
            1_024,
        )
        .unwrap();
        for record in [campaign, daily] {
            assert_ne!(record.terminal_cause, TerminalCause::EngineStall);
            assert!(record.actions > 0);
            assert_ne!(record.decision_digest_hex, bytes_to_hex([0; 32]));
        }
    }

    #[test]
    fn paired_tier_runner_changes_only_the_weight_tier_for_each_seed() {
        let level = campaign_catalog()[0];
        let mut raised = level;
        raised.rules.level_difficulty += 1;
        let base_config = campaign_simulation_config(level, SeedPartition::Holdout, 1_024);
        let raised_config = campaign_simulation_config(raised, SeedPartition::Holdout, 1_024);
        assert_eq!(base_config.seed, raised_config.seed);
        assert_eq!(base_config.attempt, raised_config.attempt);
        assert_eq!(base_config.content_hash, raised_config.content_hash);
        assert_eq!(base_config.map_id, raised_config.map_id);
        assert_eq!(base_config.level_id, raised_config.level_id);
        assert_eq!(
            raised_config.rules.level_difficulty,
            base_config.rules.level_difficulty + 1
        );

        let first = paired_tier_summary(
            level,
            PlayerModel::LineClearer,
            SeedPartition::Holdout,
            1_024,
            4,
        )
        .unwrap();
        let second = paired_tier_summary(
            level,
            PlayerModel::LineClearer,
            SeedPartition::Holdout,
            1_024,
            4,
        )
        .unwrap();
        assert_eq!(first, second);
        assert_eq!(first.base_tier + 1, first.raised_tier);
        assert!(first.base_successes <= first.seeds);
        assert!(first.raised_successes <= first.seeds);
        assert_eq!(
            first.base_success_rate_bps,
            rate_bps(first.base_successes, 4)
        );
        assert_eq!(
            first.success_rate_delta_bps,
            i32::try_from(first.raised_success_rate_bps).unwrap()
                - i32::try_from(first.base_success_rate_bps).unwrap()
        );
    }

    #[test]
    fn paired_tier_runner_rejects_empty_and_tier_seven_samples() {
        let level = campaign_catalog()[0];
        assert!(
            paired_tier_summary(
                level,
                PlayerModel::LineClearer,
                SeedPartition::Holdout,
                1_024,
                0,
            )
            .is_err()
        );
        let mut tier_seven = level;
        tier_seven.rules.level_difficulty = 7;
        assert!(
            paired_tier_summary(
                tier_seven,
                PlayerModel::LineClearer,
                SeedPartition::Holdout,
                1_024,
                1,
            )
            .is_err()
        );
    }

    #[test]
    fn campaign_catalog_declares_exactly_the_current_forty_eight_apexes() {
        let levels = campaign_catalog();
        let apex_levels = levels
            .iter()
            .filter(|level| !matches!(level.apex, ApexPredicate::None))
            .collect::<Vec<_>>();
        assert_eq!(apex_levels.len(), 48);
        for level in levels {
            let secondary_present = level.rules.level.secondary.kind != ConstraintKind::None;
            assert_eq!(
                secondary_present,
                !matches!(level.apex, ApexPredicate::None),
                "Campaign level {} must declare its current apex explicitly",
                level.catalog_id
            );
            if secondary_present {
                assert_eq!(
                    level.apex.definition(),
                    ApexPredicate::SecondaryConstraint(level.rules.level.secondary).definition()
                );
            }
        }
    }

    #[test]
    fn apex_level_report_is_reproducible_and_preserves_empty_conditionals() {
        let mut level = campaign_catalog()[0];
        level.rules.level.points_required = u32::MAX;
        level.rules.level.max_moves = 1;
        let no_constraint = Constraint {
            kind: ConstraintKind::None,
            value: 0,
            required_count: 0,
        };
        level.rules.level.primary = no_constraint;
        level.rules.level.secondary = no_constraint;
        level.rules.mutator = MutatorRules::default();
        level.rules.bonus = None;
        level.rules.starting_bonus_charges = 0;
        level.apex = ApexPredicate::LinesInAction { minimum: 8 };
        let samples = ApexSamplePlan {
            seed_start: 1_024,
            oracle_seeds: 2,
            naive_seeds: 2,
            planner_seeds: 2,
        };
        let first = apex_level_summary(level, SeedPartition::Holdout, samples).unwrap();
        let second = apex_level_summary(level, SeedPartition::Holdout, samples).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.apex, level.apex.definition());
        assert_eq!(first.oracle_reachable_rate_bps, 0);
        assert_eq!(first.naive_hit_rate_bps, 0);
        assert_eq!(first.planner_hit_rate_bps, 0);
        assert_eq!(first.planner_decisive_share_bps, None);
        assert_eq!(first.planner_set_up_share_bps, None);
        assert_eq!(first.planner_no_hit_runs, samples.planner_seeds);
        assert_eq!(first.planner_success_without_apex_rate_bps, Some(0));
    }

    #[test]
    fn apex_setup_window_is_inclusive_and_never_counts_future_charges() {
        let mut record = run_campaign(
            campaign_catalog()[0],
            PlayerModel::LineClearer,
            SeedPartition::Holdout,
            1_024,
        )
        .unwrap();
        record.bonus_charge_earned_events = vec![TimedRunEvent {
            action: 10,
            board_height: 4,
            count: 1,
        }];
        assert!(apex_hit_has_recent_charge(&record, 10));
        assert!(apex_hit_has_recent_charge(&record, 15));
        assert!(!apex_hit_has_recent_charge(&record, 16));
        assert!(!apex_hit_has_recent_charge(&record, 9));
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
    fn field_model_keeps_packs_useful_and_the_ladder_climbable() {
        let low = simulate_field(FieldAssumptions::low_retention(), &[1, 10, 25]).unwrap();
        let base = simulate_field(FieldAssumptions::base(), &[1, 10, 25]).unwrap();
        let high = simulate_field(FieldAssumptions::streak_sensitive(), &[1, 10, 25]).unwrap();
        for pack in 0..3 {
            assert!(
                low.pack_purchases[pack] + base.pack_purchases[pack] + high.pack_purchases[pack]
                    > 0
            );
        }

        // Base-attendance naive players reach tier one within three months;
        // every competent base cohort reaches tier two within six. Under high
        // attendance every competent cohort reaches tier three within a year,
        // while only the strongest Theme frontier reaches the top tier.
        assert!(base.median_ladder_reach_day_by_ability[0][1] <= 90);
        for ability in 1..4 {
            assert!(base.median_ladder_reach_day_by_ability[ability][2] <= 180);
            assert!(high.median_ladder_reach_day_by_ability[ability][3] <= 365);
        }
        assert!(high.ending_ladder_tiers_by_ability[3][4] > 0);
        assert!(high.median_ladder_reach_day_by_ability[3][4] <= 365);
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
