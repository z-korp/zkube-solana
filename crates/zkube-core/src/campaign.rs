use crate::{
    BlockWeights, Guardian, LevelRules, MoveReport, RunEngine, RunError, RunPhase, Sha256Provider,
    SoftwareSha256, bonus_trigger_threshold_is_valid, continuation_from_vrf, opening_from_vrf,
    reroll_row_from_vrf, row_from_vrf,
};

const CAMPAIGN_RANDOMNESS_DOMAIN: &[u8] = b"zkube-campaign-v2-rng";
/// Retained in the randomness preimage so finite-level output remains
/// byte-identical after removing the never-shipped Endless variant.
const CAMPAIGN_LEVEL_MODE_TAG: u8 = 0;
pub const CAMPAIGN_MAP_COUNT: usize = 10;
pub const CAMPAIGN_LEVELS_PER_MAP: usize = 10;
pub const CAMPAIGN_TOTAL_LEVELS: usize = CAMPAIGN_MAP_COUNT * CAMPAIGN_LEVELS_PER_MAP;
pub const CAMPAIGN_STAR_BYTES: usize = CAMPAIGN_TOTAL_LEVELS / 4;
pub const CAMPAIGN_MAX_STARS: u16 = 300;
const CAMPAIGN_MAP_COUNT_U8: u8 = 10;
const CAMPAIGN_LEVELS_PER_MAP_U8: u8 = 10;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CampaignEndReason {
    Completed,
    Exhausted,
    Abandoned,
}

impl CampaignEndReason {
    #[must_use]
    pub const fn tag(self) -> u8 {
        match self {
            Self::Completed => 1,
            Self::Exhausted => 2,
            Self::Abandoned => 3,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CampaignRules {
    pub level: LevelRules,
    pub guardian: Guardian,
    pub starting_height: u8,
    pub level_difficulty: u8,
}

impl CampaignRules {
    #[must_use]
    pub fn is_valid(self) -> bool {
        self.level.points_required > 0
            && self.level.max_moves > 0
            && self.level.primary.is_valid_primary()
            && self.level.secondary.is_valid_secondary()
            && self.level.has_valid_constraint_classes()
            && self
                .level
                .has_distinct_constraint_facts(self.guardian.trigger, self.guardian.threshold)
            && bonus_trigger_threshold_is_valid(self.guardian.trigger, self.guardian.threshold)
            && (crate::MIN_OPENING_HEIGHT..=crate::MAX_OPENING_HEIGHT)
                .contains(&self.starting_height)
            && self.level_difficulty <= 7
    }

    #[must_use]
    pub fn weights(self, difficulty: u8) -> BlockWeights {
        BlockWeights {
            values: crate::TIER_BLOCK_WEIGHTS[difficulty.min(7) as usize],
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CampaignSimulationConfig {
    pub content_version: u32,
    pub content_hash: [u8; 32],
    pub map_id: u8,
    /// Finite Campaign level 1..=10.
    pub level_id: u8,
    pub attempt: u64,
    pub seed: [u8; 32],
    pub rules: CampaignRules,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CampaignSimulation {
    pub content_version: u32,
    pub content_hash: [u8; 32],
    pub map_id: u8,
    pub level_id: u8,
    pub attempt: u64,
    pub engine: RunEngine,
    pub action_counter: u32,
    pub row_counter: u32,
    pub current_difficulty: u8,
    pub end_reason: Option<CampaignEndReason>,
    pub last_report: MoveReport,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CampaignError {
    InvalidConfig,
    InvalidPhase,
    Overflow,
    Engine(RunError),
    Randomness(crate::RandomnessError),
}

impl From<RunError> for CampaignError {
    fn from(error: RunError) -> Self {
        Self::Engine(error)
    }
}

impl From<crate::RandomnessError> for CampaignError {
    fn from(error: crate::RandomnessError) -> Self {
        Self::Randomness(error)
    }
}

impl CampaignSimulation {
    /// Start a deterministic offline run. All randomness is derived from the
    /// caller-provided seed and attempt; no platform state is observed.
    ///
    /// # Errors
    ///
    /// Returns an error when the catalog snapshot is invalid or opening
    /// generation fails.
    pub fn new(config: CampaignSimulationConfig) -> Result<Self, CampaignError> {
        if !config.rules.is_valid()
            || config.content_version == 0
            || !(1..=CAMPAIGN_MAP_COUNT_U8).contains(&config.map_id)
            || !(1..=CAMPAIGN_LEVELS_PER_MAP_U8).contains(&config.level_id)
        {
            return Err(CampaignError::InvalidConfig);
        }
        let current_difficulty = config.rules.level_difficulty;
        let output = derive_randomness(config, 1);
        let opening = opening_from_vrf(
            output,
            1,
            config.content_hash,
            config.rules.starting_height,
            config.rules.weights(current_difficulty),
        )?;
        let mut engine = RunEngine::start(opening.grid, opening.preview)?;
        engine.bonus = Some(config.rules.guardian.bonus);
        Ok(Self {
            content_version: config.content_version,
            content_hash: config.content_hash,
            map_id: config.map_id,
            level_id: config.level_id,
            attempt: config.attempt,
            engine,
            action_counter: 0,
            row_counter: 1,
            current_difficulty,
            end_reason: None,
            last_report: MoveReport::default(),
        })
    }

    #[must_use]
    pub fn matches_config(&self, config: CampaignSimulationConfig) -> bool {
        self.content_version == config.content_version
            && self.content_hash == config.content_hash
            && self.map_id == config.map_id
            && self.level_id == config.level_id
            && self.attempt == config.attempt
            && config.rules.is_valid()
    }

    #[must_use]
    pub const fn is_terminal(&self) -> bool {
        self.end_reason.is_some()
    }

    /// Apply one move atomically and synchronously derive the next preview.
    ///
    /// # Errors
    ///
    /// Returns an ordering, phase, engine, randomness, or overflow error
    /// without mutating the accepted state.
    pub fn play_move(
        &mut self,
        config: CampaignSimulationConfig,
        expected_move: u16,
        row: u8,
        start: u8,
        destination: u8,
    ) -> Result<MoveReport, CampaignError> {
        self.require_transition(config)?;
        let mut next = *self;
        let report = next.engine.play_move(
            expected_move,
            row,
            start,
            destination,
            config.rules.level,
            config.rules.guardian,
            100,
        )?;
        next.accept_action(config, report)?;
        *self = next;
        Ok(report)
    }

    /// Apply one bonus action atomically and synchronously derive a preview
    /// when the bonus clears the board.
    ///
    /// # Errors
    ///
    /// Returns a phase, engine, randomness, or overflow error without mutation.
    pub fn apply_bonus(
        &mut self,
        config: CampaignSimulationConfig,
        row: u8,
        column: u8,
    ) -> Result<MoveReport, CampaignError> {
        self.require_transition(config)?;
        let mut next = *self;
        let report =
            next.engine
                .apply_bonus(row, column, config.rules.level, config.rules.guardian, 100)?;
        next.accept_action(config, report)?;
        *self = next;
        Ok(report)
    }

    /// Spend one held reroll and synchronously derive its
    /// domain-separated replacement preview.
    ///
    /// # Errors
    ///
    /// Returns a config, phase, engine, randomness, or overflow error without
    /// mutating the accepted state.
    pub fn request_reroll(
        &mut self,
        config: CampaignSimulationConfig,
    ) -> Result<(), CampaignError> {
        self.require_transition(config)?;
        let mut next = *self;
        next.engine.request_reroll()?;
        let counter = next
            .row_counter
            .checked_add(1)
            .ok_or(CampaignError::Overflow)?;
        let output = derive_randomness(config, counter);
        let row = reroll_row_from_vrf(
            output,
            counter,
            config.content_hash,
            config.rules.weights(next.current_difficulty),
        )?;
        next.engine.provide_reroll_row(row)?;
        next.row_counter = counter;
        next.action_counter = next
            .action_counter
            .checked_add(1)
            .ok_or(CampaignError::Overflow)?;
        next.last_report = MoveReport::default();
        *self = next;
        Ok(())
    }

    /// Abandon an active run without producing progression.
    ///
    /// # Errors
    ///
    /// Returns an error when the state is already terminal or mismatched.
    pub fn abandon(&mut self, config: CampaignSimulationConfig) -> Result<(), CampaignError> {
        self.require_transition(config)?;
        let mut next = *self;
        next.engine.phase = RunPhase::Finished;
        next.engine.next_row = None;
        next.engine.latched_star_sources = 0;
        next.end_reason = Some(CampaignEndReason::Abandoned);
        *self = next;
        Ok(())
    }

    fn require_transition(&self, config: CampaignSimulationConfig) -> Result<(), CampaignError> {
        if !self.matches_config(config) {
            return Err(CampaignError::InvalidConfig);
        }
        if self.is_terminal() {
            return Err(CampaignError::InvalidPhase);
        }
        Ok(())
    }

    fn accept_action(
        &mut self,
        config: CampaignSimulationConfig,
        report: MoveReport,
    ) -> Result<(), CampaignError> {
        self.action_counter = self
            .action_counter
            .checked_add(1)
            .ok_or(CampaignError::Overflow)?;
        self.last_report = report;
        match self.engine.phase {
            RunPhase::AwaitingVrf => self.provide_next_row(config)?,
            RunPhase::LevelComplete => {
                self.end_reason = Some(CampaignEndReason::Completed);
            }
            RunPhase::Finished => {
                self.engine.phase = RunPhase::Finished;
                self.engine.next_row = None;
                self.end_reason = Some(CampaignEndReason::Exhausted);
            }
            RunPhase::Playing => {}
            RunPhase::Ready => return Err(CampaignError::InvalidPhase),
        }
        Ok(())
    }

    fn provide_next_row(&mut self, config: CampaignSimulationConfig) -> Result<(), CampaignError> {
        let counter = self
            .row_counter
            .checked_add(1)
            .ok_or(CampaignError::Overflow)?;
        let output = derive_randomness(config, counter);
        let weights = config.rules.weights(self.current_difficulty);
        if self.engine.grid.is_empty() {
            let continuation =
                continuation_from_vrf(output, counter, config.content_hash, weights)?;
            self.engine.grid = continuation.grid;
            self.engine.next_row = Some(continuation.preview);
            self.engine.phase = RunPhase::Playing;
        } else {
            let row = row_from_vrf(output, counter, weights)?;
            self.engine.provide_vrf_row(row)?;
        }
        self.row_counter = counter;
        Ok(())
    }
}

fn derive_randomness(config: CampaignSimulationConfig, request_counter: u32) -> [u8; 32] {
    SoftwareSha256::hashv(&[
        CAMPAIGN_RANDOMNESS_DOMAIN,
        &config.content_hash,
        &config.content_version.to_le_bytes(),
        &[config.map_id, config.level_id, CAMPAIGN_LEVEL_MODE_TAG],
        &config.attempt.to_le_bytes(),
        &request_counter.to_le_bytes(),
        &config.seed,
    ])
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CampaignStarsError {
    InvalidMap,
    InvalidLevel,
    InvalidStars,
    Locked,
}

/// The complete Campaign progression state: two bits for each of 100 levels.
/// Unlocks, guardians, badges, zone completion, and total stars are derived.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CampaignStars {
    packed: [u8; CAMPAIGN_STAR_BYTES],
}

impl CampaignStars {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            packed: [0; CAMPAIGN_STAR_BYTES],
        }
    }

    #[must_use]
    pub const fn from_packed(packed: [u8; CAMPAIGN_STAR_BYTES]) -> Self {
        Self { packed }
    }

    #[must_use]
    pub const fn packed(self) -> [u8; CAMPAIGN_STAR_BYTES] {
        self.packed
    }

    /// Return the lifetime-best star result for one Campaign level.
    ///
    /// # Errors
    ///
    /// Rejects a map or level outside the fixed 10-by-10 Campaign.
    pub fn best(&self, map_id: u8, level_id: u8) -> Result<u8, CampaignStarsError> {
        let index = level_index(map_id, level_id)?;
        let shift = (index % 4) * 2;
        Ok((self.packed[index / 4] >> shift) & 0b11)
    }

    #[must_use]
    pub fn level_unlocked(&self, map_id: u8, level_id: u8) -> bool {
        let Ok(index) = level_index(map_id, level_id) else {
            return false;
        };
        if index == 0 {
            return true;
        }
        let previous = index - 1;
        let shift = (previous % 4) * 2;
        ((self.packed[previous / 4] >> shift) & 0b11) > 0
    }

    #[must_use]
    pub fn zone_cleared(&self, map_id: u8) -> bool {
        self.best(map_id, CAMPAIGN_LEVELS_PER_MAP_U8)
            .is_ok_and(|stars| stars > 0)
    }

    #[must_use]
    pub fn zone_perfected(&self, map_id: u8) -> bool {
        (1..=CAMPAIGN_LEVELS_PER_MAP_U8).all(|level_id| self.best(map_id, level_id) == Ok(3))
    }

    #[must_use]
    pub fn total(&self) -> u16 {
        (1..=CAMPAIGN_MAP_COUNT_U8)
            .flat_map(|map_id| {
                (1..=CAMPAIGN_LEVELS_PER_MAP_U8).map(move |level_id| (map_id, level_id))
            })
            .map(|(map_id, level_id)| u16::from(self.best(map_id, level_id).unwrap_or(0)))
            .sum()
    }

    #[must_use]
    pub fn all_guardians_cleared(&self) -> bool {
        (1..=CAMPAIGN_MAP_COUNT_U8).all(|map_id| self.zone_cleared(map_id))
    }

    #[must_use]
    pub fn world_perfected(&self) -> bool {
        self.total() == CAMPAIGN_MAX_STARS
    }

    /// Record a completed finite level, preserving the lifetime best.
    ///
    /// # Errors
    ///
    /// Returns a bounds, lock, or stars validation error.
    pub fn record_level(
        &mut self,
        map_id: u8,
        level_id: u8,
        stars: u8,
    ) -> Result<u8, CampaignStarsError> {
        if !(1..=3).contains(&stars) {
            return Err(CampaignStarsError::InvalidStars);
        }
        let index = level_index(map_id, level_id)?;
        if !self.level_unlocked(map_id, level_id) {
            return Err(CampaignStarsError::Locked);
        }
        let previous = self.best(map_id, level_id)?;
        let next = previous.max(stars);
        if next != previous {
            let shift = (index % 4) * 2;
            let mask = !(0b11 << shift);
            self.packed[index / 4] = (self.packed[index / 4] & mask) | (next << shift);
        }
        Ok(next - previous)
    }
}

fn map_index(map_id: u8) -> Result<usize, CampaignStarsError> {
    map_id
        .checked_sub(1)
        .map(usize::from)
        .filter(|index| *index < CAMPAIGN_MAP_COUNT)
        .ok_or(CampaignStarsError::InvalidMap)
}

fn level_index(map_id: u8, level_id: u8) -> Result<usize, CampaignStarsError> {
    let map = map_index(map_id)?;
    let level = level_id
        .checked_sub(1)
        .map(usize::from)
        .filter(|index| *index < CAMPAIGN_LEVELS_PER_MAP)
        .ok_or(CampaignStarsError::InvalidLevel)?;
    Ok(map * CAMPAIGN_LEVELS_PER_MAP + level)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Bonus, Constraint, ConstraintKind};

    fn config() -> CampaignSimulationConfig {
        CampaignSimulationConfig {
            content_version: 2,
            content_hash: [7; 32],
            map_id: 1,
            level_id: 1,
            attempt: 9,
            seed: [11; 32],
            rules: CampaignRules {
                level: LevelRules::default(),
                guardian: Guardian {
                    bonus: Bonus::Wave,
                    ..Guardian::default()
                },
                starting_height: 4,
                level_difficulty: 0,
            },
        }
    }

    type ContainedFactCase = (ConstraintKind, u8, ConstraintKind, u8, u8, u8, u16);

    const CONTAINED_FACT_CASES: [ContainedFactCase; 10] = [
        (
            ConstraintKind::CombosOfExactly,
            4,
            ConstraintKind::ComboOfExactly,
            4,
            1,
            0,
            0,
        ),
        (
            ConstraintKind::CombosOfExactly,
            4,
            ConstraintKind::ComboOfAtLeast,
            3,
            1,
            0,
            0,
        ),
        (
            ConstraintKind::CombosOfAtLeast,
            4,
            ConstraintKind::ComboOfAtLeast,
            3,
            1,
            0,
            0,
        ),
        (
            ConstraintKind::BigMoves,
            20,
            ConstraintKind::BigMove,
            19,
            1,
            0,
            0,
        ),
        (
            ConstraintKind::BonusLines,
            0,
            ConstraintKind::BonusLinesInMove,
            1,
            1,
            0,
            0,
        ),
        (
            ConstraintKind::TriggerFired,
            0,
            ConstraintKind::ComboOfAtLeast,
            2,
            1,
            1,
            2,
        ),
        (
            ConstraintKind::TriggerFired,
            0,
            ConstraintKind::ComboOfExactly,
            3,
            1,
            4,
            3,
        ),
        (
            ConstraintKind::TriggerFired,
            0,
            ConstraintKind::AllWidthsInMove,
            0,
            1,
            6,
            0,
        ),
        (
            ConstraintKind::TriggerFired,
            0,
            ConstraintKind::BreakInMove,
            0,
            6,
            8,
            6,
        ),
        (
            ConstraintKind::TriggerFired,
            0,
            ConstraintKind::Streak,
            1,
            3,
            9,
            3,
        ),
    ];

    #[test]
    fn campaign_opening_is_seeded_and_reproducible() {
        let first = CampaignSimulation::new(config()).unwrap();
        let second = CampaignSimulation::new(config()).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.engine.bonus_charges, 0);
        let mut changed = config();
        changed.attempt += 1;
        assert_ne!(
            first.engine.grid,
            CampaignSimulation::new(changed).unwrap().engine.grid
        );
    }

    #[test]
    fn campaign_rules_require_valid_constraint_classes_counts_and_distinct_facts() {
        let mut rules = config().rules;
        rules.level.primary.kind = ConstraintKind::ComboOfAtLeast;
        assert!(!rules.is_valid());
        rules.level.primary.kind = ConstraintKind::CombosOfAtLeast;
        rules.level.secondary.kind = ConstraintKind::CombosOfAtLeast;
        assert!(!rules.is_valid());

        for (kind, value) in [
            (ConstraintKind::CombosOfAtLeast, 2),
            (ConstraintKind::BreakBlocks, 1),
            (ConstraintKind::ClearLines, 0),
            (ConstraintKind::CombosOfExactly, 2),
            (ConstraintKind::BigMoves, 1),
            (ConstraintKind::TriggerFired, 0),
            (ConstraintKind::BonusLines, 0),
            (ConstraintKind::BonusBreaks, 0),
        ] {
            let mut candidate = config().rules;
            candidate.level.primary = Constraint {
                kind,
                value,
                required_count: 1,
            };
            assert!(!candidate.is_valid(), "{kind:?} accepted count one");
            candidate.level.primary.required_count = 2;
            assert!(candidate.is_valid(), "{kind:?} rejected count two");
        }

        for (
            primary,
            primary_value,
            secondary,
            secondary_value,
            secondary_count,
            trigger,
            threshold,
        ) in CONTAINED_FACT_CASES
        {
            let mut candidate = config().rules;
            candidate.level.primary = Constraint {
                kind: primary,
                value: primary_value,
                required_count: 2,
            };
            candidate.level.secondary = Constraint {
                kind: secondary,
                value: secondary_value,
                required_count: secondary_count,
            };
            candidate.guardian.trigger = trigger;
            candidate.guardian.threshold = threshold;
            assert!(
                !candidate.is_valid(),
                "accepted {primary:?} | {secondary:?}"
            );
        }
    }

    #[test]
    fn campaign_perfect_clear_reseeds_board_and_preview_from_one_output() {
        let config = config();
        let mut simulation = CampaignSimulation::new(config).unwrap();
        simulation.engine.grid = crate::Grid::EMPTY;
        simulation.engine.next_row = None;
        simulation.engine.phase = RunPhase::AwaitingVrf;
        let request_counter = simulation.row_counter + 1;
        let output = derive_randomness(config, request_counter);
        let expected = continuation_from_vrf(
            output,
            request_counter,
            config.content_hash,
            config.rules.weights(simulation.current_difficulty),
        )
        .unwrap();

        simulation.provide_next_row(config).unwrap();

        assert_eq!(simulation.engine.phase, RunPhase::Playing);
        assert_eq!(simulation.engine.grid, expected.grid);
        assert_eq!(simulation.engine.next_row, Some(expected.preview));
        assert_eq!(simulation.row_counter, request_counter);
    }

    #[test]
    fn initial_reroll_spends_without_changing_guardian_inventory() {
        let mut config = config();
        config.rules.guardian.bonus = Bonus::Hammer;
        let mut simulation = CampaignSimulation::new(config).unwrap();
        let original_preview = simulation.engine.next_row;

        simulation.request_reroll(config).unwrap();

        assert_eq!(simulation.engine.reroll_charges, 0);
        assert_eq!(simulation.engine.bonus, Some(Bonus::Hammer));
        assert_eq!(simulation.engine.bonus_charges, 0);
        assert_ne!(simulation.engine.next_row, original_preview);
        assert_eq!(simulation.action_counter, 1);
        assert_eq!(
            simulation.request_reroll(config),
            Err(CampaignError::Engine(RunError::NoRerollAvailable))
        );
    }

    #[test]
    fn compact_stars_unlock_sequentially_and_keep_bests() {
        let mut progress = CampaignStars::new();
        assert!(progress.level_unlocked(1, 1));
        assert!(!progress.level_unlocked(1, 2));
        assert_eq!(progress.record_level(1, 1, 2), Ok(2));
        assert!(progress.level_unlocked(1, 2));
        assert_eq!(progress.record_level(1, 1, 1), Ok(0));
        for level in 2..=10 {
            progress.record_level(1, level, 3).unwrap();
        }
        assert!(progress.level_unlocked(2, 1));
        assert!(progress.zone_cleared(1));
        assert!(!progress.zone_perfected(1));
        assert_eq!(progress.total(), 29);
        assert_eq!(progress.packed().len(), CAMPAIGN_STAR_BYTES);
    }

    #[test]
    fn completion_and_perfection_are_fully_derived() {
        let mut progress = CampaignStars::new();
        for map_id in 1..=10 {
            for level_id in 1..=10 {
                progress.record_level(map_id, level_id, 3).unwrap();
            }
        }
        assert!(progress.all_guardians_cleared());
        assert!(progress.world_perfected());
        assert_eq!(progress.total(), 300);
    }
}
