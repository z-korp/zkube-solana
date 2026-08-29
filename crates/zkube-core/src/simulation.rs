use crate::{
    ActionMetrics, BlockWeights, Bonus, ChainDomain, ChallengeId, DailyTheme, Guardian,
    MetricsError, PlayerId, RandomnessError, ReplayCommitment, ReplayEvent, ReplayMode, RulesHash,
    RunEngine, RunError, RunMetrics, RunPhase, Sha256Provider, SoftwareSha256,
    bonus_trigger_threshold_is_valid, continuation_from_vrf, derive_player_id, opening_from_vrf,
    reroll_row_from_vrf, row_from_vrf,
};

const DAILY_RULES_HASH_DOMAIN: &[u8] = b"zkube-daily-rules-v1";
const DAILY_CHALLENGE_RULES_HASH_DOMAIN: &[u8] = b"zkube-arena-rules-v3";
pub const RULES_VERSION: u32 = 3;
pub const CANONICAL_DAILY_RULES_LEN: usize = 25;
pub const DAILY_MAX_MOVES: u16 = 100;
pub const PRESSURE_STEP: u32 = 20;
const PRESSURE_TIER_COUNT: usize = 8;

/// The protocol-owned score multiplier ramp for a Daily run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DailyPressureRules {
    pub score_multipliers_x100: [u16; PRESSURE_TIER_COUNT],
}

impl DailyPressureRules {
    #[must_use]
    pub const fn canonical() -> Self {
        Self {
            score_multipliers_x100: [100, 150, 200, 250, 300, 350, 400, 450],
        }
    }

    #[must_use]
    pub fn is_valid(self) -> bool {
        self.score_multipliers_x100
            .iter()
            .all(|multiplier| *multiplier > 0)
    }

    #[must_use]
    pub fn difficulty_for_score(self, pressure_score: u32) -> u8 {
        u8::try_from((pressure_score / PRESSURE_STEP).min(7)).unwrap_or(7)
    }

    #[must_use]
    pub fn multiplier(self, difficulty: u8) -> u16 {
        self.score_multipliers_x100[usize::from(difficulty.min(7))]
    }

    #[must_use]
    pub fn weights(self, difficulty: u8) -> BlockWeights {
        BlockWeights {
            values: crate::TIER_BLOCK_WEIGHTS[usize::from(difficulty.min(7))],
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
    pub guardian: Guardian,
    /// Realm opening height snapshotted with the run.
    pub starting_height: u8,
    pub objective: DailyTheme,
    pub pressure: DailyPressureRules,
}

impl DailyRunRules {
    #[must_use]
    pub fn is_valid(self) -> bool {
        self.max_moves > 0
            && bonus_trigger_threshold_is_valid(self.guardian.trigger, self.guardian.threshold)
            && (crate::MIN_OPENING_HEIGHT..=crate::MAX_OPENING_HEIGHT)
                .contains(&self.starting_height)
            && crate::DAILY_THEMES.contains(&self.objective)
            && self.pressure.is_valid()
    }

    #[must_use]
    pub fn canonical_bytes(self) -> CanonicalDailyRulesBytes {
        let mut encoded = CanonicalDailyRulesBytes::default();
        encoded.push(&self.max_moves.to_le_bytes());
        encoded.push(&[bonus_tag(Some(self.guardian.bonus)), self.guardian.trigger]);
        encoded.push(&self.guardian.threshold.to_le_bytes());
        encoded.push(&[self.starting_height]);
        encoded.push(&[self.objective.kind.tag(), self.objective.value]);
        for multiplier in self.pressure.score_multipliers_x100 {
            encoded.push(&multiplier.to_le_bytes());
        }
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

    fn action_score_multiplier(self, difficulty: u8) -> u16 {
        self.pressure.multiplier(difficulty)
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
    pub objective_total: u64,
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
                bonus: Some(config.rules.guardian.bonus),
                bonus_charges: 0,
                starting_height_target: config.rules.starting_height,
                ..RunEngine::default()
            },
            metrics: RunMetrics::default(),
            action_counter: 0,
            daily_score: 0,
            objective_total: 0,
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
                rules.starting_height,
                rules.pressure.weights(next.current_difficulty),
            )?;
            next.engine.grid = opening.grid;
            next.engine.next_row = Some(opening.preview);
            next.engine.starting_height_target = 0;
            next.engine.phase = RunPhase::Playing;
        } else if next.engine.reroll_pending() {
            let row = reroll_row_from_vrf(
                output,
                request_counter,
                next.rules_hash.to_bytes(),
                rules.pressure.weights(next.current_difficulty),
            )?;
            next.engine.provide_reroll_row(row)?;
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
    ) -> Result<crate::MoveReport, SimulationError> {
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
            rules.guardian,
            rules.action_score_multiplier(next.current_difficulty),
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
        Ok(report)
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
    ) -> Result<crate::MoveReport, SimulationError> {
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
            rules.guardian,
            rules.action_score_multiplier(next.current_difficulty),
        )?;
        report.difficulty_at_action = next.current_difficulty;
        next.record_action(rules, report, combo_before)?;
        next.replay = next.replay.fold(ReplayEvent::Bonus {
            action,
            row,
            column,
        });
        *self = next;
        Ok(report)
    }

    /// Consume a reroll charge and request a domain-separated replacement for
    /// the visible preview. The action is committed before the VRF callback so
    /// deadline recovery preserves the accepted request even when no output
    /// arrives in time.
    ///
    /// # Errors
    ///
    /// Returns an ordering, rules, engine-state, or arithmetic error without
    /// mutating the simulation.
    pub fn request_reroll(
        &mut self,
        rules: DailyRunRules,
        action: u32,
    ) -> Result<(), SimulationError> {
        if rules.snapshot_hash() != self.rules_snapshot_hash {
            return Err(SimulationError::InvalidRules);
        }
        if action != self.action_counter {
            return Err(SimulationError::InvalidActionOrder);
        }
        let mut next = *self;
        next.engine.request_reroll()?;
        next.action_counter = next
            .action_counter
            .checked_add(1)
            .ok_or(SimulationError::Overflow)?;
        next.replay = next.replay.fold(ReplayEvent::Reroll { action });
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
        let objective_increment = rules.objective.action_increment(&report);
        let blocks_destroyed = report
            .blocks_destroyed_by_size
            .into_iter()
            .try_fold(0u32, |sum, blocks| sum.checked_add(u32::from(blocks)))
            .ok_or(SimulationError::Overflow)?;
        self.metrics.record_action(ActionMetrics {
            score: u64::from(report.points_earned),
            lines: u32::from(report.lines_cleared),
            blocks_destroyed,
            combo: if report.combo_counter > combo_before {
                u32::from(report.lines_cleared)
            } else {
                0
            },
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
            .ok_or(SimulationError::Overflow)?;
        self.objective_total = self
            .objective_total
            .checked_add(u64::from(objective_increment))
            .ok_or(SimulationError::Overflow)?;
        self.pressure_score = self
            .pressure_score
            .checked_add(report.neutral_points_earned)
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

/// Reproduce the Daily rules identity stored by the Solana program.
#[must_use]
pub fn daily_rules_hash(
    day_id: u32,
    content_version: u32,
    guardian: Guardian,
    starting_height: u8,
    objective: DailyTheme,
) -> RulesHash {
    daily_rules_hash_with::<SoftwareSha256>(
        day_id,
        content_version,
        guardian,
        starting_height,
        objective,
    )
}

#[must_use]
pub fn daily_rules_hash_with<H: Sha256Provider>(
    day_id: u32,
    content_version: u32,
    guardian: Guardian,
    starting_height: u8,
    objective: DailyTheme,
) -> RulesHash {
    daily_rules_hash_components_with::<H>(
        day_id,
        content_version,
        guardian,
        starting_height,
        objective,
        RULES_VERSION,
    )
}

fn daily_rules_hash_components_with<H: Sha256Provider>(
    day_id: u32,
    content_version: u32,
    guardian: Guardian,
    starting_height: u8,
    objective: DailyTheme,
    rules_version: u32,
) -> RulesHash {
    RulesHash(H::hashv(&[
        DAILY_CHALLENGE_RULES_HASH_DOMAIN,
        &day_id.to_le_bytes(),
        &content_version.to_le_bytes(),
        &[bonus_tag(Some(guardian.bonus)), guardian.trigger],
        &guardian.threshold.to_le_bytes(),
        &[starting_height, objective.kind.tag(), objective.value],
        &rules_version.to_le_bytes(),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn rules() -> DailyRunRules {
        DailyRunRules {
            max_moves: 100,
            guardian: Guardian {
                bonus: Bonus::Wave,
                ..Guardian::default()
            },
            starting_height: 4,
            objective: crate::DAILY_THEMES[1],
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
        changed.pressure.score_multipliers_x100[7] -= 1;
        assert_ne!(baseline.snapshot_hash(), changed.snapshot_hash());
        changed = baseline;
        changed.objective = crate::DAILY_THEMES[2];
        assert_ne!(baseline.snapshot_hash(), changed.snapshot_hash());
        changed = baseline;
        changed.starting_height += 1;
        assert_ne!(baseline.snapshot_hash(), changed.snapshot_hash());
        changed.starting_height = crate::MIN_OPENING_HEIGHT - 1;
        assert!(!changed.is_valid());
        changed.starting_height = crate::MAX_OPENING_HEIGHT + 1;
        assert!(!changed.is_valid());
    }

    #[test]
    fn daily_rules_hash_binds_day_realm_objective_and_protocol_constants() {
        let rules = rules();
        let baseline = daily_rules_hash(
            32_000,
            2,
            rules.guardian,
            rules.starting_height,
            rules.objective,
        );
        let changed = |day_id, content_version, guardian, starting_height, objective| {
            daily_rules_hash(
                day_id,
                content_version,
                guardian,
                starting_height,
                objective,
            )
        };
        assert_ne!(
            baseline,
            changed(
                32_000 + u32::try_from(crate::DAILY_PAIR_COUNT).unwrap(),
                2,
                rules.guardian,
                rules.starting_height,
                rules.objective
            )
        );
        assert_ne!(
            baseline,
            changed(
                32_000,
                3,
                rules.guardian,
                rules.starting_height,
                rules.objective
            )
        );
        let mut guardian = rules.guardian;
        guardian.threshold += 1;
        assert_ne!(
            baseline,
            changed(32_000, 2, guardian, rules.starting_height, rules.objective)
        );
        let mut guardian = rules.guardian;
        guardian.bonus = Bonus::Hammer;
        assert_ne!(
            baseline,
            changed(32_000, 2, guardian, rules.starting_height, rules.objective)
        );
        assert_ne!(
            baseline,
            changed(
                32_000,
                2,
                rules.guardian,
                rules.starting_height + 1,
                rules.objective
            )
        );
        assert_ne!(
            baseline,
            changed(
                32_000,
                2,
                rules.guardian,
                rules.starting_height,
                crate::DAILY_THEMES[2]
            )
        );
        assert_ne!(
            baseline,
            daily_rules_hash_components_with::<SoftwareSha256>(
                32_000,
                2,
                rules.guardian,
                rules.starting_height,
                rules.objective,
                RULES_VERSION + 1,
            )
        );
    }

    #[test]
    fn daily_runs_start_without_guardian_charges() {
        let simulation = DailySimulation::new(config()).unwrap();
        assert_eq!(simulation.engine.bonus_charges, 0);
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

    #[test]
    fn reroll_replaces_only_the_preview_after_a_distinct_vrf_request() {
        let reroll_rules = rules();
        let mut reroll_config = config();
        reroll_config.rules = reroll_rules;
        let mut simulation = DailySimulation::new(reroll_config).unwrap();
        simulation.apply_vrf(reroll_rules, 1, [9; 32]).unwrap();
        let grid = simulation.engine.grid;
        let preview = simulation.engine.next_row.unwrap();
        let replay_before = simulation.replay;

        simulation.request_reroll(reroll_rules, 0).unwrap();
        assert_eq!(simulation.engine.phase, RunPhase::AwaitingVrf);
        assert_eq!(simulation.engine.grid, grid);
        assert_eq!(simulation.engine.next_row, Some(preview));
        assert_eq!(simulation.engine.moves, 0);
        assert_eq!(simulation.action_counter, 1);
        assert_eq!(simulation.engine.reroll_charges, 0);
        assert_ne!(simulation.replay, replay_before);

        let replay_after_request = simulation.replay;
        simulation.apply_vrf(reroll_rules, 2, [10; 32]).unwrap();
        assert_eq!(simulation.engine.phase, RunPhase::Playing);
        assert_eq!(simulation.engine.grid, grid);
        assert_ne!(simulation.engine.next_row, Some(preview));
        assert_eq!(simulation.engine.moves, 0);
        assert_eq!(simulation.daily_score, 0);
        assert_eq!(simulation.objective_total, 0);
        assert_eq!(simulation.last_vrf_counter, 2);
        assert_ne!(simulation.replay, replay_after_request);
    }

    #[test]
    fn pending_reroll_is_an_accepted_action_at_deadline() {
        let reroll_rules = rules();
        let mut reroll_config = config();
        reroll_config.rules = reroll_rules;
        let mut simulation = DailySimulation::new(reroll_config).unwrap();
        simulation.apply_vrf(reroll_rules, 1, [9; 32]).unwrap();
        simulation.request_reroll(reroll_rules, 0).unwrap();

        simulation.finish_at_deadline().unwrap();

        assert!(simulation.is_score_eligible());
        assert!(simulation.deadline_finished);
        assert_eq!(simulation.engine.next_row, None);
    }
}
