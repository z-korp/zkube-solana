use crate::{
    ActionMetrics, BlockWeights, Bonus, ChainDomain, ChallengeId, DailyObjective,
    DailyObjectiveRule, DailyScoringError, MetricsError, MutatorRules, PlayerId, RandomnessError,
    ReplayCommitment, ReplayEvent, ReplayMode, RulesHash, RunEngine, RunError, RunMetrics,
    RunPhase, Sha256Provider, SoftwareSha256, continuation_from_vrf, derive_player_id,
    opening_from_vrf, row_from_vrf, score_daily_objective,
};

const DAILY_RULES_HASH_DOMAIN: &[u8] = b"zkube-daily-rules-v1";
const DAILY_CHALLENGE_RULES_HASH_DOMAIN: &[u8] = b"zkube-arena-rules-v2";
pub const CANONICAL_DAILY_RULES_LEN: usize = 145;
const PRESSURE_TIER_COUNT: usize = 8;

/// The score-driven pressure schedule snapshotted into a Daily run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DailyPressureRules {
    pub thresholds: [u32; 7],
    pub score_multipliers_x100: [u16; PRESSURE_TIER_COUNT],
    pub block_weights: [[u16; 5]; PRESSURE_TIER_COUNT],
    pub starting_height: u8,
}

impl DailyPressureRules {
    #[must_use]
    pub const fn canonical() -> Self {
        Self {
            thresholds: [8, 18, 30, 42, 54, 66, 78],
            score_multipliers_x100: [100, 110, 125, 140, 160, 180, 210, 250],
            block_weights: [
                [25, 30, 25, 15, 5],
                [22, 28, 25, 18, 7],
                [20, 25, 25, 20, 10],
                [18, 22, 24, 22, 14],
                [16, 20, 22, 24, 18],
                [14, 18, 20, 26, 22],
                [12, 16, 18, 28, 26],
                [10, 14, 16, 30, 30],
            ],
            starting_height: 4,
        }
    }

    #[must_use]
    pub fn is_valid(self) -> bool {
        self.thresholds.windows(2).all(|pair| pair[0] < pair[1])
            && self
                .score_multipliers_x100
                .iter()
                .all(|multiplier| *multiplier > 0)
            && self.block_weights.iter().all(|weights| {
                BlockWeights { values: *weights }.validate().is_ok()
                    && weights.iter().map(|weight| u32::from(*weight)).sum::<u32>() == 100
            })
            && (crate::MIN_OPENING_HEIGHT..=crate::MAX_OPENING_HEIGHT)
                .contains(&self.starting_height)
    }

    #[must_use]
    pub fn difficulty_for_score(self, pressure_score: u32) -> u8 {
        self.thresholds
            .iter()
            .take_while(|threshold| pressure_score >= **threshold)
            .fold(0u8, |difficulty, _| difficulty + 1)
    }

    #[must_use]
    pub fn multiplier(self, difficulty: u8) -> u16 {
        self.score_multipliers_x100[usize::from(difficulty.min(7))]
    }

    #[must_use]
    pub fn weights(self, difficulty: u8) -> BlockWeights {
        BlockWeights {
            values: self.block_weights[usize::from(difficulty.min(7))],
        }
    }
}

impl Default for DailyPressureRules {
    fn default() -> Self {
        Self::canonical()
    }
}

/// Every gameplay and competition rule needed to reproduce one Daily run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DailyRunRules {
    pub max_moves: u16,
    /// Base mutator before the current pressure multiplier is applied.
    pub mutator: MutatorRules,
    pub bonus: Option<Bonus>,
    pub starting_bonus_charges: u8,
    pub objective: DailyObjectiveRule,
    pub pressure: DailyPressureRules,
}

impl DailyRunRules {
    #[must_use]
    pub fn is_valid(self) -> bool {
        let trigger_valid = match self.mutator.bonus_trigger_type {
            0 => self.mutator.bonus_threshold == 0,
            1..=7 => self.mutator.bonus_threshold > 0,
            _ => false,
        };
        let bonus_valid = match self.bonus {
            None => self.starting_bonus_charges == 0,
            Some(_) => self.starting_bonus_charges <= 15,
        };
        self.max_moves > 0
            && self.mutator.score_multiplier_x100 > 0
            && self.mutator.combo_multiplier_x100 > 0
            && trigger_valid
            && bonus_valid
            && self.objective.is_valid()
            && self.pressure.is_valid()
            && self
                .pressure
                .score_multipliers_x100
                .iter()
                .all(|pressure| self.action_score_multiplier(*pressure).is_ok())
    }

    #[must_use]
    pub fn canonical_bytes(self) -> CanonicalDailyRulesBytes {
        let mut encoded = CanonicalDailyRulesBytes::default();
        encoded.push(&self.max_moves.to_le_bytes());
        encoded.push(&self.mutator.score_multiplier_x100.to_le_bytes());
        encoded.push(&self.mutator.combo_multiplier_x100.to_le_bytes());
        encoded.push(&self.mutator.line_clear_bonus.to_le_bytes());
        encoded.push(&self.mutator.perfect_clear_bonus.to_le_bytes());
        encoded.push(&[self.mutator.star_threshold_modifier]);
        encoded.push(&[self.mutator.bonus_trigger_type]);
        encoded.push(&self.mutator.bonus_threshold.to_le_bytes());
        encoded.push(&[bonus_tag(self.bonus), self.starting_bonus_charges]);
        let (objective_tag, objective_parameter) = objective_encoding(self.objective.objective);
        encoded.push(&[objective_tag, objective_parameter]);
        encoded.push(&self.objective.bonus_multiplier_x100.to_le_bytes());
        for threshold in self.pressure.thresholds {
            encoded.push(&threshold.to_le_bytes());
        }
        for multiplier in self.pressure.score_multipliers_x100 {
            encoded.push(&multiplier.to_le_bytes());
        }
        for tier in self.pressure.block_weights {
            for weight in tier {
                encoded.push(&weight.to_le_bytes());
            }
        }
        encoded.push(&[self.pressure.starting_height]);
        debug_assert_eq!(encoded.len(), CANONICAL_DAILY_RULES_LEN);
        encoded
    }

    #[must_use]
    pub fn snapshot_hash(self) -> RulesHash {
        self.snapshot_hash_with::<SoftwareSha256>()
    }

    #[must_use]
    pub fn snapshot_hash_with<H: Sha256Provider>(self) -> RulesHash {
        let encoded = self.canonical_bytes();
        RulesHash(H::hashv(&[DAILY_RULES_HASH_DOMAIN, encoded.as_slice()]))
    }

    fn action_mutator(self, difficulty: u8) -> Result<MutatorRules, SimulationError> {
        let pressure = self.pressure.multiplier(difficulty);
        Ok(MutatorRules {
            score_multiplier_x100: self.action_score_multiplier(pressure)?,
            ..self.mutator
        })
    }

    fn action_score_multiplier(self, pressure: u16) -> Result<u16, SimulationError> {
        u32::from(self.mutator.score_multiplier_x100)
            .checked_mul(u32::from(pressure))
            .and_then(|value| value.checked_div(100))
            .and_then(|value| u16::try_from(value).ok())
            .ok_or(SimulationError::Overflow)
    }
}

/// Fixed-allocation canonical rules bytes hashed into every simulation replay.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CanonicalDailyRulesBytes {
    bytes: [u8; CANONICAL_DAILY_RULES_LEN],
    len: usize,
}

impl Default for CanonicalDailyRulesBytes {
    fn default() -> Self {
        Self {
            bytes: [0; CANONICAL_DAILY_RULES_LEN],
            len: 0,
        }
    }
}

impl CanonicalDailyRulesBytes {
    fn push(&mut self, value: &[u8]) {
        let start = self.len;
        let end = start + value.len();
        self.bytes[start..end].copy_from_slice(value);
        self.len = end;
    }

    #[must_use]
    pub fn as_slice(&self) -> &[u8] {
        &self.bytes[..self.len]
    }

    #[must_use]
    pub const fn len(&self) -> usize {
        self.len
    }

    #[must_use]
    pub const fn is_empty(&self) -> bool {
        self.len == 0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DailySimulationConfig {
    pub chain_domain: ChainDomain,
    pub challenge: ChallengeId,
    pub raw_account: [u8; 32],
    pub run_id: u64,
    pub mode: ReplayMode,
    /// Canonical Daily challenge hash read from finalized chain state.
    pub rules_hash: RulesHash,
    pub rules: DailyRunRules,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DailySimulation {
    pub engine: RunEngine,
    pub metrics: RunMetrics,
    pub action_counter: u32,
    pub daily_score: u32,
    pub pressure_score: u32,
    pub current_difficulty: u8,
    pub last_vrf_counter: u32,
    pub replay: ReplayCommitment,
    pub player_id: PlayerId,
    pub rules_hash: RulesHash,
    pub rules_snapshot_hash: RulesHash,
    pub deadline_finished: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SimulationError {
    InvalidRules,
    InvalidActionOrder,
    InvalidVrfOrder,
    InvalidPhase,
    Overflow,
    Engine(RunError),
    Randomness(RandomnessError),
    DailyScoring(DailyScoringError),
    Metrics(MetricsError),
}

impl From<RunError> for SimulationError {
    fn from(error: RunError) -> Self {
        Self::Engine(error)
    }
}

impl From<RandomnessError> for SimulationError {
    fn from(error: RandomnessError) -> Self {
        Self::Randomness(error)
    }
}

impl From<DailyScoringError> for SimulationError {
    fn from(error: DailyScoringError) -> Self {
        Self::DailyScoring(error)
    }
}

impl From<MetricsError> for SimulationError {
    fn from(error: MetricsError) -> Self {
        Self::Metrics(error)
    }
}

impl DailySimulation {
    /// Whether the terminal score may enter ranked settlement.
    ///
    /// Deadline closure is valid even when no gameplay action was accepted;
    /// eligibility is deliberately a separate property of the frozen state.
    #[must_use]
    pub const fn is_score_eligible(&self) -> bool {
        self.action_counter > 0
    }

    /// Initialize the deterministic state before the opening VRF callback.
    ///
    /// # Errors
    ///
    /// Returns [`SimulationError::InvalidRules`] when the snapshotted rules
    /// are internally inconsistent.
    pub fn new(config: DailySimulationConfig) -> Result<Self, SimulationError> {
        if !config.rules.is_valid() {
            return Err(SimulationError::InvalidRules);
        }
        let player_id = derive_player_id(config.chain_domain, config.raw_account);
        let rules_hash = config.rules_hash;
        let rules_snapshot_hash = config.rules.snapshot_hash();
        let replay = ReplayCommitment::initial(
            config.chain_domain,
            config.challenge,
            rules_hash,
            player_id,
            config.run_id,
            config.mode,
        );
        Ok(Self {
            engine: RunEngine {
                phase: RunPhase::AwaitingVrf,
                bonus: config.rules.bonus,
                bonus_charges: config.rules.starting_bonus_charges,
                starting_height_target: config.rules.pressure.starting_height,
                ..RunEngine::default()
            },
            metrics: RunMetrics::default(),
            action_counter: 0,
            daily_score: 0,
            pressure_score: 0,
            current_difficulty: 0,
            last_vrf_counter: 0,
            replay,
            player_id,
            rules_hash,
            rules_snapshot_hash,
            deadline_finished: false,
        })
    }

    /// Apply the next verified VRF output in strict request order.
    ///
    /// # Errors
    ///
    /// Returns an ordering, phase, randomness, or engine error without
    /// mutating the simulation.
    pub fn apply_vrf(
        &mut self,
        rules: DailyRunRules,
        request_counter: u32,
        output: [u8; 32],
    ) -> Result<(), SimulationError> {
        if rules.snapshot_hash() != self.rules_snapshot_hash {
            return Err(SimulationError::InvalidRules);
        }
        if self.engine.phase != RunPhase::AwaitingVrf {
            return Err(SimulationError::InvalidPhase);
        }
        if self.last_vrf_counter.checked_add(1) != Some(request_counter) {
            return Err(SimulationError::InvalidVrfOrder);
        }
        let mut next = *self;
        if request_counter == 1 {
            let opening = opening_from_vrf(
                output,
                request_counter,
                next.rules_hash.to_bytes(),
                rules.pressure.starting_height,
                rules.pressure.weights(next.current_difficulty),
            )?;
            next.engine.grid = opening.grid;
            next.engine.next_row = Some(opening.preview);
            next.engine.starting_height_target = 0;
            next.engine.phase = RunPhase::Playing;
        } else if next.engine.grid.is_empty() {
            let continuation = continuation_from_vrf(
                output,
                request_counter,
                next.rules_hash.to_bytes(),
                rules.pressure.weights(next.current_difficulty),
            )?;
            next.engine.grid = continuation.grid;
            next.engine.next_row = Some(continuation.preview);
            next.engine.phase = RunPhase::Playing;
        } else {
            let row = row_from_vrf(
                output,
                request_counter,
                rules.pressure.weights(next.current_difficulty),
            )?;
            next.engine.provide_vrf_row(row)?;
        }
        next.replay = next.replay.fold(ReplayEvent::Vrf {
            request_counter,
            output,
        });
        next.last_vrf_counter = request_counter;
        *self = next;
        Ok(())
    }

    /// Apply one ordered move and update both engine and competition scores.
    ///
    /// # Errors
    ///
    /// Returns an ordering, rules, engine, scoring, metrics, or arithmetic
    /// error without mutating the simulation.
    #[allow(clippy::too_many_arguments)]
    pub fn play_move(
        &mut self,
        rules: DailyRunRules,
        action: u32,
        expected_move: u16,
        row: u8,
        start: u8,
        destination: u8,
    ) -> Result<(), SimulationError> {
        if rules.snapshot_hash() != self.rules_snapshot_hash {
            return Err(SimulationError::InvalidRules);
        }
        if action != self.action_counter {
            return Err(SimulationError::InvalidActionOrder);
        }
        let mut next = *self;
        let combo_before = next.engine.combo_counter;
        let mut report = next.engine.play_move(
            expected_move,
            row,
            start,
            destination,
            daily_level_rules(rules),
            rules.action_mutator(next.current_difficulty)?,
        )?;
        report.difficulty_at_action = next.current_difficulty;
        next.record_action(rules, report, combo_before)?;
        next.replay = next.replay.fold(ReplayEvent::Move {
            action,
            expected_move,
            row,
            start,
            destination,
        });
        *self = next;
        Ok(())
    }

    /// Apply one ordered bonus action and update competition accounting.
    ///
    /// # Errors
    ///
    /// Returns an ordering, rules, engine, scoring, metrics, or arithmetic
    /// error without mutating the simulation.
    pub fn apply_bonus(
        &mut self,
        rules: DailyRunRules,
        action: u32,
        row: u8,
        column: u8,
    ) -> Result<(), SimulationError> {
        if rules.snapshot_hash() != self.rules_snapshot_hash {
            return Err(SimulationError::InvalidRules);
        }
        if action != self.action_counter {
            return Err(SimulationError::InvalidActionOrder);
        }
        let mut next = *self;
        let combo_before = next.engine.combo_counter;
        let mut report = next.engine.apply_bonus(
            row,
            column,
            daily_level_rules(rules),
            rules.action_mutator(next.current_difficulty)?,
        )?;
        report.difficulty_at_action = next.current_difficulty;
        next.record_action(rules, report, combo_before)?;
        next.replay = next.replay.fold(ReplayEvent::Bonus {
            action,
            row,
            column,
        });
        *self = next;
        Ok(())
    }

    /// Freeze the last fully accepted state at the Daily deadline.
    ///
    /// # Errors
    ///
    /// Returns an error for an already-terminal or otherwise invalid phase.
    /// A run with zero accepted actions is still frozen and committed, but
    /// [`Self::is_score_eligible`] returns `false` for that terminal state.
    pub fn finish_at_deadline(&mut self) -> Result<(), SimulationError> {
        if !matches!(self.engine.phase, RunPhase::Playing | RunPhase::AwaitingVrf) {
            return Err(SimulationError::InvalidPhase);
        }
        let mut next = *self;
        next.engine.phase = RunPhase::Finished;
        next.engine.next_row = None;
        next.replay = next.replay.fold(ReplayEvent::DailyDeadline {
            action: next.action_counter,
        });
        next.deadline_finished = true;
        *self = next;
        Ok(())
    }

    fn record_action(
        &mut self,
        rules: DailyRunRules,
        report: crate::MoveReport,
        combo_before: u8,
    ) -> Result<(), SimulationError> {
        let pressure_multiplier = rules.pressure.multiplier(self.current_difficulty);
        let objective = score_daily_objective(rules.objective, &report, pressure_multiplier)?;
        let blocks_destroyed = report
            .blocks_destroyed_by_size
            .into_iter()
            .try_fold(0u32, |sum, blocks| sum.checked_add(u32::from(blocks)))
            .ok_or(SimulationError::Overflow)?;
        self.metrics.record_action(ActionMetrics {
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
        })?;
        self.daily_score = self
            .daily_score
            .checked_add(report.points_earned)
            .and_then(|score| score.checked_add(objective.awarded_bonus))
            .ok_or(SimulationError::Overflow)?;
        self.pressure_score = self
            .pressure_score
            .checked_add(report.neutral_points_earned)
            .and_then(|score| score.checked_add(objective.weighted_raw_bonus))
            .ok_or(SimulationError::Overflow)?;
        self.current_difficulty = rules.pressure.difficulty_for_score(self.pressure_score);
        self.action_counter = self
            .action_counter
            .checked_add(1)
            .ok_or(SimulationError::Overflow)?;
        Ok(())
    }
}

fn daily_level_rules(rules: DailyRunRules) -> crate::LevelRules {
    crate::LevelRules {
        points_required: u32::MAX,
        max_moves: rules.max_moves,
        primary: crate::Constraint::default(),
        secondary: crate::Constraint::default(),
    }
}

/// Reproduce the Daily challenge hash stored by the Solana program. The
/// catalog hash is independently bound to the published full catalog; this
/// function binds its selected day, revision, theme, and objective variant.
#[must_use]
pub fn daily_challenge_rules_hash(
    day_id: u32,
    catalog_hash: [u8; 32],
    rules_version: u32,
    theme_id: u8,
    scoring_rule_id: u8,
) -> RulesHash {
    daily_challenge_rules_hash_with::<SoftwareSha256>(
        day_id,
        catalog_hash,
        rules_version,
        theme_id,
        scoring_rule_id,
    )
}

#[must_use]
pub fn daily_challenge_rules_hash_with<H: Sha256Provider>(
    day_id: u32,
    catalog_hash: [u8; 32],
    rules_version: u32,
    theme_id: u8,
    scoring_rule_id: u8,
) -> RulesHash {
    RulesHash(H::hashv(&[
        DAILY_CHALLENGE_RULES_HASH_DOMAIN,
        &day_id.to_le_bytes(),
        &catalog_hash,
        &rules_version.to_le_bytes(),
        &[theme_id, scoring_rule_id],
    ]))
}

const fn bonus_tag(bonus: Option<Bonus>) -> u8 {
    match bonus {
        None => 0,
        Some(Bonus::Hammer) => 1,
        Some(Bonus::Totem) => 2,
        Some(Bonus::Wave) => 3,
    }
}

const fn objective_encoding(objective: DailyObjective) -> (u8, u8) {
    match objective {
        DailyObjective::Classic => (0, 0),
        DailyObjective::Combo { minimum_lines } => (1, minimum_lines),
        DailyObjective::ExactLines { lines } => (2, lines),
        DailyObjective::Blocks { size } => (3, size),
        DailyObjective::Clutch { minimum_height } => (4, minimum_height),
        DailyObjective::Clean { maximum_height } => (5, maximum_height),
        DailyObjective::Survival => (6, 0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules() -> DailyRunRules {
        DailyRunRules {
            max_moves: 100,
            mutator: MutatorRules::default(),
            bonus: None,
            starting_bonus_charges: 0,
            objective: DailyObjectiveRule {
                objective: DailyObjective::Survival,
                bonus_multiplier_x100: 100,
            },
            pressure: DailyPressureRules::canonical(),
        }
    }

    fn config() -> DailySimulationConfig {
        DailySimulationConfig {
            chain_domain: ChainDomain([1; 32]),
            challenge: ChallengeId([2; 32]),
            raw_account: [3; 32],
            run_id: 4,
            mode: ReplayMode::Ranked,
            rules_hash: RulesHash([5; 32]),
            rules: rules(),
        }
    }

    #[test]
    fn simulation_enforces_vrf_and_action_order_atomically() {
        let mut simulation = DailySimulation::new(config()).unwrap();
        let untouched = simulation;
        assert_eq!(
            simulation.apply_vrf(rules(), 2, [9; 32]),
            Err(SimulationError::InvalidVrfOrder)
        );
        assert_eq!(simulation, untouched);
        simulation.apply_vrf(rules(), 1, [9; 32]).unwrap();
        let opened = simulation;
        assert_eq!(
            simulation.play_move(rules(), 1, 0, 0, 0, 0),
            Err(SimulationError::InvalidActionOrder)
        );
        assert_eq!(simulation, opened);
    }

    #[test]
    fn one_vrf_recovers_an_empty_post_clear_board_and_preview() {
        let mut simulation = DailySimulation::new(config()).unwrap();
        simulation.apply_vrf(rules(), 1, [9; 32]).unwrap();
        simulation.engine.grid = crate::Grid::EMPTY;
        simulation.engine.next_row = None;
        simulation.engine.phase = RunPhase::AwaitingVrf;

        simulation.apply_vrf(rules(), 2, [10; 32]).unwrap();

        assert_eq!(simulation.engine.phase, RunPhase::Playing);
        assert_eq!(simulation.engine.grid.occupied_height(), 1);
        assert!(simulation.engine.next_row.is_some());
        assert_eq!(simulation.last_vrf_counter, 2);
    }

    #[test]
    fn canonical_rules_are_fixed_and_hash_every_field() {
        let baseline = rules();
        assert_eq!(baseline.canonical_bytes().len(), CANONICAL_DAILY_RULES_LEN);
        let mut changed = baseline;
        changed.pressure.block_weights[7][4] -= 1;
        assert_ne!(baseline.snapshot_hash(), changed.snapshot_hash());
        changed = baseline;
        changed.objective = DailyObjectiveRule {
            objective: DailyObjective::Combo { minimum_lines: 2 },
            bonus_multiplier_x100: 200,
        };
        assert_ne!(baseline.snapshot_hash(), changed.snapshot_hash());
    }

    #[test]
    fn deadline_freezes_zero_action_run_without_making_it_score_eligible() {
        let mut simulation = DailySimulation::new(config()).unwrap();
        let replay_before = simulation.replay;
        simulation.finish_at_deadline().unwrap();
        assert_eq!(simulation.engine.phase, RunPhase::Finished);
        assert!(simulation.deadline_finished);
        assert!(!simulation.is_score_eligible());
        assert_ne!(simulation.replay, replay_before);
    }
}
