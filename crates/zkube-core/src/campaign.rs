use crate::{
    BlockWeights, Bonus, Constraint, ConstraintKind, EndlessRules, LevelRules, MoveReport,
    MutatorRules, RunEngine, RunError, RunPhase, Sha256Provider, SoftwareSha256,
    calculate_level_stars, opening_from_vrf, row_from_vrf,
};

const CAMPAIGN_RANDOMNESS_DOMAIN: &[u8] = b"zkube-campaign-v2-rng";
pub const CAMPAIGN_MAP_COUNT: usize = 10;
pub const CAMPAIGN_LEVELS_PER_MAP: usize = 10;
pub const CAMPAIGN_TOTAL_LEVELS: usize = CAMPAIGN_MAP_COUNT * CAMPAIGN_LEVELS_PER_MAP;
pub const CAMPAIGN_STAR_BYTES: usize = CAMPAIGN_TOTAL_LEVELS / 4;
pub const CAMPAIGN_MAX_STARS: u16 = 300;
const CAMPAIGN_MAP_COUNT_U8: u8 = 10;
const CAMPAIGN_LEVELS_PER_MAP_U8: u8 = 10;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CampaignMode {
    Level,
    Endless,
}

impl CampaignMode {
    #[must_use]
    pub const fn tag(self) -> u8 {
        match self {
            Self::Level => 0,
            Self::Endless => 1,
        }
    }
}

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
    pub mutator: MutatorRules,
    pub bonus: Option<Bonus>,
    pub starting_bonus_charges: u8,
    pub starting_height: u8,
    pub level_difficulty: u8,
    pub block_weights: [[u16; 5]; 8],
    pub endless: EndlessRules,
}

impl CampaignRules {
    #[must_use]
    pub fn is_valid(self) -> bool {
        self.level.points_required > 0
            && self.level.max_moves > 0
            && constraint_is_valid(self.level.primary)
            && constraint_is_valid(self.level.secondary)
            && self.mutator.score_multiplier_x100 > 0
            && self.mutator.combo_multiplier_x100 > 0
            && match self.mutator.bonus_trigger_type {
                0 | 5 | 6 => self.mutator.bonus_threshold == 0,
                1..=4 | 7 => self.mutator.bonus_threshold > 0,
                _ => false,
            }
            && match self.bonus {
                None => self.starting_bonus_charges == 0,
                Some(_) => self.starting_bonus_charges <= 15,
            }
            && (crate::MIN_OPENING_HEIGHT..=crate::MAX_OPENING_HEIGHT)
                .contains(&self.starting_height)
            && self.level_difficulty <= 7
            && self.block_weights.iter().all(|weights| {
                BlockWeights { values: *weights }.validate().is_ok()
                    && weights.iter().map(|value| u32::from(*value)).sum::<u32>() == 100
            })
            && self.endless.ramp_multiplier_x100 > 0
            && self
                .endless
                .thresholds
                .windows(2)
                .all(|pair| pair[0] < pair[1])
            && self
                .endless
                .score_multipliers_x100
                .iter()
                .all(|value| *value > 0)
    }

    #[must_use]
    pub fn weights(self, difficulty: u8) -> BlockWeights {
        BlockWeights {
            values: self.block_weights[difficulty.min(7) as usize],
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CampaignSimulationConfig {
    pub content_version: u32,
    pub content_hash: [u8; 32],
    pub map_id: u8,
    /// Level 1..=10 for finite runs and zero for Endless.
    pub level_id: u8,
    pub attempt: u64,
    pub seed: [u8; 32],
    pub mode: CampaignMode,
    pub rules: CampaignRules,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CampaignSimulation {
    pub content_version: u32,
    pub content_hash: [u8; 32],
    pub map_id: u8,
    pub level_id: u8,
    pub attempt: u64,
    pub mode: CampaignMode,
    pub engine: RunEngine,
    pub action_counter: u32,
    pub row_counter: u32,
    pub current_difficulty: u8,
    pub end_reason: Option<CampaignEndReason>,
    pub earned_stars: u8,
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
            || match config.mode {
                CampaignMode::Level => !(1..=CAMPAIGN_LEVELS_PER_MAP_U8).contains(&config.level_id),
                CampaignMode::Endless => config.level_id != 0,
            }
        {
            return Err(CampaignError::InvalidConfig);
        }
        let current_difficulty = match config.mode {
            CampaignMode::Level => config.rules.level_difficulty,
            CampaignMode::Endless => 0,
        };
        let output = derive_randomness(config, 1);
        let opening = opening_from_vrf(
            output,
            1,
            config.content_hash,
            config.rules.starting_height,
            config.rules.weights(current_difficulty),
        )?;
        let mut engine = RunEngine::start(opening.grid, opening.preview)?;
        engine.bonus = config.rules.bonus;
        engine.bonus_charges = config.rules.starting_bonus_charges;
        Ok(Self {
            content_version: config.content_version,
            content_hash: config.content_hash,
            map_id: config.map_id,
            level_id: config.level_id,
            attempt: config.attempt,
            mode: config.mode,
            engine,
            action_counter: 0,
            row_counter: 1,
            current_difficulty,
            end_reason: None,
            earned_stars: 0,
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
            && self.mode == config.mode
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
            effective_level(config),
            effective_mutator(config, next.current_difficulty)?,
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
        let report = next.engine.apply_bonus(
            row,
            column,
            effective_level(config),
            effective_mutator(config, next.current_difficulty)?,
        )?;
        next.accept_action(config, report)?;
        *self = next;
        Ok(report)
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
        next.end_reason = Some(CampaignEndReason::Abandoned);
        next.earned_stars = 0;
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
        if self.mode == CampaignMode::Endless {
            self.current_difficulty = config.rules.endless.difficulty_for_score(self.engine.score);
        }
        match self.engine.phase {
            RunPhase::AwaitingVrf => self.provide_next_row(config)?,
            RunPhase::LevelComplete if self.mode == CampaignMode::Level => {
                self.end_reason = Some(CampaignEndReason::Completed);
                self.earned_stars = calculate_level_stars(
                    config.rules.level.max_moves,
                    self.engine.moves,
                    config.rules.mutator.star_threshold_modifier,
                );
            }
            RunPhase::LevelComplete | RunPhase::Finished => {
                self.engine.phase = RunPhase::Finished;
                self.engine.next_row = None;
                self.end_reason = Some(CampaignEndReason::Exhausted);
                self.earned_stars = 0;
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
        let row = row_from_vrf(
            output,
            counter,
            config.rules.weights(self.current_difficulty),
        )?;
        self.engine.provide_vrf_row(row)?;
        self.row_counter = counter;
        Ok(())
    }
}

fn derive_randomness(config: CampaignSimulationConfig, request_counter: u32) -> [u8; 32] {
    SoftwareSha256::hashv(&[
        CAMPAIGN_RANDOMNESS_DOMAIN,
        &config.content_hash,
        &config.content_version.to_le_bytes(),
        &[config.map_id, config.level_id, config.mode.tag()],
        &config.attempt.to_le_bytes(),
        &request_counter.to_le_bytes(),
        &config.seed,
    ])
}

fn effective_level(config: CampaignSimulationConfig) -> LevelRules {
    match config.mode {
        CampaignMode::Level => config.rules.level,
        CampaignMode::Endless => LevelRules {
            points_required: u32::MAX,
            max_moves: u16::MAX,
            primary: Constraint::default(),
            secondary: Constraint::default(),
        },
    }
}

fn effective_mutator(
    config: CampaignSimulationConfig,
    difficulty: u8,
) -> Result<MutatorRules, CampaignError> {
    if config.mode == CampaignMode::Level {
        return Ok(config.rules.mutator);
    }
    let multiplier = u32::from(config.rules.mutator.score_multiplier_x100)
        .checked_mul(u32::from(config.rules.endless.score_multiplier(difficulty)))
        .and_then(|value| value.checked_div(100))
        .and_then(|value| u16::try_from(value).ok())
        .ok_or(CampaignError::Overflow)?;
    Ok(MutatorRules {
        score_multiplier_x100: multiplier,
        ..config.rules.mutator
    })
}

fn constraint_is_valid(value: Constraint) -> bool {
    match value.kind {
        ConstraintKind::None => value.value == 0 && value.required_count == 0,
        ConstraintKind::ComboLines => (1..=8).contains(&value.value) && value.required_count > 0,
        ConstraintKind::BreakBlocks => (1..=4).contains(&value.value) && value.required_count > 0,
        ConstraintKind::ComboMeter => value.value > 0 && value.required_count == 1,
    }
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

    fn config(mode: CampaignMode) -> CampaignSimulationConfig {
        CampaignSimulationConfig {
            content_version: 2,
            content_hash: [7; 32],
            map_id: 1,
            level_id: u8::from(mode == CampaignMode::Level),
            attempt: 9,
            seed: [11; 32],
            mode,
            rules: CampaignRules {
                level: LevelRules::default(),
                mutator: MutatorRules::default(),
                bonus: None,
                starting_bonus_charges: 0,
                starting_height: 4,
                level_difficulty: 0,
                block_weights: [[20; 5]; 8],
                endless: EndlessRules::default(),
            },
        }
    }

    #[test]
    fn campaign_opening_is_seeded_and_reproducible() {
        let first = CampaignSimulation::new(config(CampaignMode::Level)).unwrap();
        let second = CampaignSimulation::new(config(CampaignMode::Level)).unwrap();
        assert_eq!(first, second);
        let mut changed = config(CampaignMode::Level);
        changed.attempt += 1;
        assert_ne!(
            first.engine.grid,
            CampaignSimulation::new(changed).unwrap().engine.grid
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
