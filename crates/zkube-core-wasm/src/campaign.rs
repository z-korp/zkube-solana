use crate::BoundaryError;
use zkube_core::{
    Bonus, CAMPAIGN_MAP_COUNT, CAMPAIGN_TOTAL_LEVELS, CampaignEndReason, CampaignMode,
    CampaignProgress, CampaignRules, CampaignSimulation, CampaignSimulationConfig, Constraint,
    ConstraintKind, EndlessRules, Grid, LevelRules, MoveReport, MutatorRules, RunEngine, RunPhase,
};

pub const CAMPAIGN_SIMULATION_CONFIG_LEN: usize = 234;
pub const CAMPAIGN_SIMULATION_STATE_LEN: usize = 183;
pub const CAMPAIGN_PROGRESS_LEN: usize = 185;
const CONFIG_VERSION: u8 = 1;
const STATE_VERSION: u8 = 1;
const PROGRESS_VERSION: u8 = 1;

#[must_use]
pub fn encode_campaign_simulation_config(
    config: CampaignSimulationConfig,
) -> [u8; CAMPAIGN_SIMULATION_CONFIG_LEN] {
    let mut writer = Writer::new();
    writer.write(&[CONFIG_VERSION]);
    writer.write(&config.content_version.to_le_bytes());
    writer.write(&config.content_hash);
    writer.write(&[config.map_id, config.level_id]);
    writer.write(&config.attempt.to_le_bytes());
    writer.write(&config.seed);
    writer.write(&[config.mode.tag()]);
    encode_level(&mut writer, config.rules.level);
    encode_mutator(&mut writer, config.rules.mutator);
    writer.write(&[bonus_tag(config.rules.bonus)]);
    writer.write(&[
        config.rules.starting_bonus_charges,
        config.rules.starting_height,
        config.rules.level_difficulty,
    ]);
    for tier in config.rules.block_weights {
        for value in tier {
            writer.write(&value.to_le_bytes());
        }
    }
    for threshold in config.rules.endless.thresholds {
        writer.write(&threshold.to_le_bytes());
    }
    for multiplier in config.rules.endless.score_multipliers_x100 {
        writer.write(&multiplier.to_le_bytes());
    }
    writer.write(&config.rules.endless.ramp_multiplier_x100.to_le_bytes());
    writer.finish()
}

/// # Errors
///
/// Rejects unknown versions, tags, malformed rules, and incorrect lengths.
pub fn decode_campaign_simulation_config(
    bytes: &[u8],
) -> Result<CampaignSimulationConfig, BoundaryError> {
    if bytes.len() != CAMPAIGN_SIMULATION_CONFIG_LEN {
        return Err(BoundaryError::InvalidLength);
    }
    let mut reader = Reader::new(bytes);
    if reader.u8()? != CONFIG_VERSION {
        return Err(BoundaryError::InvalidEncoding);
    }
    let content_version = reader.u32()?;
    let content_hash = reader.array()?;
    let map_id = reader.u8()?;
    let level_id = reader.u8()?;
    let attempt = reader.u64()?;
    let seed = reader.array()?;
    let mode = decode_mode(reader.u8()?)?;
    let level = decode_level(&mut reader)?;
    let mutator = decode_mutator(&mut reader)?;
    let bonus = decode_bonus(reader.u8()?)?;
    let starting_bonus_charges = reader.u8()?;
    let starting_height = reader.u8()?;
    let level_difficulty = reader.u8()?;
    let mut block_weights = [[0; 5]; 8];
    for tier in &mut block_weights {
        for value in tier {
            *value = reader.u16()?;
        }
    }
    let mut thresholds = [0; 7];
    for threshold in &mut thresholds {
        *threshold = reader.u32()?;
    }
    let mut score_multipliers_x100 = [0; 8];
    for multiplier in &mut score_multipliers_x100 {
        *multiplier = reader.u16()?;
    }
    let ramp_multiplier_x100 = reader.u16()?;
    reader.finish()?;
    let config = CampaignSimulationConfig {
        content_version,
        content_hash,
        map_id,
        level_id,
        attempt,
        seed,
        mode,
        rules: CampaignRules {
            level,
            mutator,
            bonus,
            starting_bonus_charges,
            starting_height,
            level_difficulty,
            block_weights,
            endless: EndlessRules {
                thresholds,
                score_multipliers_x100,
                ramp_multiplier_x100,
            },
        },
    };
    if !config.rules.is_valid() {
        return Err(BoundaryError::InvalidEncoding);
    }
    Ok(config)
}

#[must_use]
pub fn encode_campaign_simulation_state(
    simulation: CampaignSimulation,
) -> [u8; CAMPAIGN_SIMULATION_STATE_LEN] {
    let mut writer = Writer::new();
    writer.write(&[STATE_VERSION]);
    writer.write(&simulation.content_version.to_le_bytes());
    writer.write(&simulation.content_hash);
    writer.write(&[simulation.map_id, simulation.level_id]);
    writer.write(&simulation.attempt.to_le_bytes());
    writer.write(&[simulation.mode.tag()]);
    writer.write(&[phase_tag(simulation.engine.phase)]);
    writer.write(&[u8::from(simulation.engine.next_row.is_some())]);
    writer.write(&[bonus_tag(simulation.engine.bonus)]);
    writer.write(&[
        simulation.engine.bonus_charges,
        u8::from(simulation.engine.perfect_trigger_available),
        simulation.engine.starting_height_target,
        simulation.current_difficulty,
        simulation.engine.combo_counter,
        simulation.engine.max_combo,
        simulation.engine.primary_progress,
        simulation.engine.secondary_progress,
    ]);
    writer.write(&simulation.engine.level_lines_cleared.to_le_bytes());
    writer.write(&simulation.engine.moves.to_le_bytes());
    writer.write(&simulation.action_counter.to_le_bytes());
    writer.write(&simulation.row_counter.to_le_bytes());
    writer.write(&simulation.engine.score.to_le_bytes());
    writer.write(simulation.engine.grid.cells());
    writer.write(&simulation.engine.next_row.unwrap_or([0; 8]));
    writer.write(&[simulation.end_reason.map_or(0, CampaignEndReason::tag)]);
    writer.write(&[simulation.earned_stars]);
    encode_report(&mut writer, simulation.last_report);
    writer.finish()
}

/// # Errors
///
/// Rejects malformed or internally inconsistent state tokens.
pub fn decode_campaign_simulation_state(bytes: &[u8]) -> Result<CampaignSimulation, BoundaryError> {
    if bytes.len() != CAMPAIGN_SIMULATION_STATE_LEN {
        return Err(BoundaryError::InvalidLength);
    }
    let mut reader = Reader::new(bytes);
    if reader.u8()? != STATE_VERSION {
        return Err(BoundaryError::InvalidEncoding);
    }
    let content_version = reader.u32()?;
    let content_hash = reader.array()?;
    let map_id = reader.u8()?;
    let level_id = reader.u8()?;
    let attempt = reader.u64()?;
    let mode = decode_mode(reader.u8()?)?;
    let phase = decode_phase(reader.u8()?)?;
    let has_next_row = reader.bool()?;
    let bonus = decode_bonus(reader.u8()?)?;
    let bonus_charges = reader.u8()?;
    let perfect_trigger_available = reader.bool()?;
    let starting_height_target = reader.u8()?;
    let current_difficulty = reader.u8()?;
    let combo_counter = reader.u8()?;
    let max_combo = reader.u8()?;
    let primary_progress = reader.u8()?;
    let secondary_progress = reader.u8()?;
    let level_lines_cleared = reader.u16()?;
    let moves = reader.u16()?;
    let action_counter = reader.u32()?;
    let row_counter = reader.u32()?;
    let score = reader.u32()?;
    let grid = Grid::try_from_cells(reader.array()?).map_err(|_| BoundaryError::InvalidEncoding)?;
    let next_row_bytes = reader.array()?;
    let next_row = if has_next_row {
        Grid::validate_row(&next_row_bytes).map_err(|_| BoundaryError::InvalidEncoding)?;
        Some(next_row_bytes)
    } else {
        if next_row_bytes != [0; 8] {
            return Err(BoundaryError::InvalidEncoding);
        }
        None
    };
    let end_reason = decode_end_reason(reader.u8()?)?;
    let earned_stars = reader.u8()?;
    let last_report = decode_report(&mut reader)?;
    reader.finish()?;
    let terminal_valid = match end_reason {
        None => phase == RunPhase::Playing && earned_stars == 0 && next_row.is_some(),
        Some(CampaignEndReason::Completed) => {
            mode == CampaignMode::Level
                && phase == RunPhase::LevelComplete
                && (1..=3).contains(&earned_stars)
        }
        Some(CampaignEndReason::Exhausted | CampaignEndReason::Abandoned) => {
            phase == RunPhase::Finished && earned_stars == 0 && next_row.is_none()
        }
    };
    if !terminal_valid || current_difficulty > 7 || row_counter == 0 {
        return Err(BoundaryError::InvalidEncoding);
    }
    Ok(CampaignSimulation {
        content_version,
        content_hash,
        map_id,
        level_id,
        attempt,
        mode,
        engine: RunEngine {
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
            perfect_trigger_available,
            starting_height_target,
        },
        action_counter,
        row_counter,
        current_difficulty,
        end_reason,
        earned_stars,
        last_report,
    })
}

/// # Errors
///
/// Returns a configuration or deterministic engine error.
pub fn initialize_campaign_simulation(config: &[u8]) -> Result<Vec<u8>, BoundaryError> {
    let config = decode_campaign_simulation_config(config)?;
    Ok(encode_campaign_simulation_state(CampaignSimulation::new(config)?).to_vec())
}

/// # Errors
///
/// Returns a codec or rejected transition error without returning partial state.
pub fn campaign_simulation_play_move(
    config: &[u8],
    state: &[u8],
    expected_move: u16,
    row: u8,
    start: u8,
    destination: u8,
) -> Result<Vec<u8>, BoundaryError> {
    let (config, mut simulation) = decode_for_transition(config, state)?;
    simulation.play_move(config, expected_move, row, start, destination)?;
    Ok(encode_campaign_simulation_state(simulation).to_vec())
}

/// # Errors
///
/// Returns a codec or rejected transition error without partial state.
pub fn campaign_simulation_apply_bonus(
    config: &[u8],
    state: &[u8],
    row: u8,
    column: u8,
) -> Result<Vec<u8>, BoundaryError> {
    let (config, mut simulation) = decode_for_transition(config, state)?;
    simulation.apply_bonus(config, row, column)?;
    Ok(encode_campaign_simulation_state(simulation).to_vec())
}

/// # Errors
///
/// Returns a codec or rejected transition error without partial state.
pub fn campaign_simulation_abandon(config: &[u8], state: &[u8]) -> Result<Vec<u8>, BoundaryError> {
    let (config, mut simulation) = decode_for_transition(config, state)?;
    simulation.abandon(config)?;
    Ok(encode_campaign_simulation_state(simulation).to_vec())
}

/// # Errors
///
/// Returns an encoding error for an invalid state.
pub fn campaign_simulation_earned_stars(state: &[u8]) -> Result<u8, BoundaryError> {
    Ok(decode_campaign_simulation_state(state)?.earned_stars)
}

/// Zero means active; 1, 2, and 3 mean completed, exhausted, and abandoned.
///
/// # Errors
///
/// Returns an encoding error for an invalid state.
pub fn campaign_simulation_end_reason(state: &[u8]) -> Result<u8, BoundaryError> {
    Ok(decode_campaign_simulation_state(state)?
        .end_reason
        .map_or(0, CampaignEndReason::tag))
}

fn decode_for_transition(
    config: &[u8],
    state: &[u8],
) -> Result<(CampaignSimulationConfig, CampaignSimulation), BoundaryError> {
    let config = decode_campaign_simulation_config(config)?;
    let simulation = decode_campaign_simulation_state(state)?;
    if !simulation.matches_config(config)
        || simulation.engine.bonus != config.rules.bonus
        || simulation.current_difficulty
            != match config.mode {
                CampaignMode::Level => config.rules.level_difficulty,
                CampaignMode::Endless => config
                    .rules
                    .endless
                    .difficulty_for_score(simulation.engine.score),
            }
    {
        return Err(BoundaryError::InvalidEncoding);
    }
    Ok((config, simulation))
}

#[must_use]
pub fn encode_campaign_progress(progress: CampaignProgress) -> [u8; CAMPAIGN_PROGRESS_LEN] {
    let mut writer = Writer::new();
    writer.write(&[PROGRESS_VERSION]);
    writer.write(&progress.content_version.to_le_bytes());
    writer.write(&progress.content_hash);
    writer.write(&progress.next_attempt.to_le_bytes());
    writer.write(&progress.best_stars);
    for score in progress.endless_best_scores {
        writer.write(&score.to_le_bytes());
    }
    writer.finish()
}

/// # Errors
///
/// Rejects invalid versions, lengths, and star values.
pub fn decode_campaign_progress(bytes: &[u8]) -> Result<CampaignProgress, BoundaryError> {
    if bytes.len() != CAMPAIGN_PROGRESS_LEN {
        return Err(BoundaryError::InvalidLength);
    }
    let mut reader = Reader::new(bytes);
    if reader.u8()? != PROGRESS_VERSION {
        return Err(BoundaryError::InvalidEncoding);
    }
    let content_version = reader.u32()?;
    let content_hash = reader.array()?;
    let next_attempt = reader.u64()?;
    let best_stars = reader.array()?;
    let mut endless_best_scores = [0; CAMPAIGN_MAP_COUNT];
    for score in &mut endless_best_scores {
        *score = reader.u32()?;
    }
    reader.finish()?;
    let progress = CampaignProgress {
        content_version,
        content_hash,
        next_attempt,
        best_stars,
        endless_best_scores,
    };
    if !progress.is_valid() {
        return Err(BoundaryError::InvalidEncoding);
    }
    Ok(progress)
}

/// # Errors
///
/// Returns a content validation error.
pub fn initialize_campaign_progress(
    content_version: u32,
    content_hash: &[u8],
) -> Result<Vec<u8>, BoundaryError> {
    let progress = CampaignProgress::new(content_version, array_32(content_hash)?)?;
    Ok(encode_campaign_progress(progress).to_vec())
}

/// # Errors
///
/// Returns an encoding error for invalid progress.
pub fn campaign_progress_next_attempt(progress: &[u8]) -> Result<u64, BoundaryError> {
    Ok(decode_campaign_progress(progress)?.next_attempt)
}

/// # Errors
///
/// Returns an encoding or attempt-overflow error.
pub fn reserve_campaign_attempt(progress: &[u8]) -> Result<Vec<u8>, BoundaryError> {
    let mut progress = decode_campaign_progress(progress)?;
    progress.reserve_attempt()?;
    Ok(encode_campaign_progress(progress).to_vec())
}

/// # Errors
///
/// Returns an encoding, bounds, lock, or stars error.
pub fn record_campaign_level_result(
    progress: &[u8],
    map_id: u8,
    level_id: u8,
    stars: u8,
) -> Result<Vec<u8>, BoundaryError> {
    let mut progress = decode_campaign_progress(progress)?;
    progress.record_level(map_id, level_id, stars)?;
    Ok(encode_campaign_progress(progress).to_vec())
}

/// # Errors
///
/// Returns an encoding, bounds, or lock error.
pub fn record_campaign_endless_result(
    progress: &[u8],
    map_id: u8,
    score: u32,
) -> Result<Vec<u8>, BoundaryError> {
    let mut progress = decode_campaign_progress(progress)?;
    progress.record_endless(map_id, score)?;
    Ok(encode_campaign_progress(progress).to_vec())
}

/// # Errors
///
/// Returns an encoding error for invalid progress.
pub fn campaign_level_unlocked(
    progress: &[u8],
    map_id: u8,
    level_id: u8,
) -> Result<bool, BoundaryError> {
    Ok(decode_campaign_progress(progress)?.level_unlocked(map_id, level_id))
}

/// # Errors
///
/// Returns an encoding error for invalid progress.
pub fn campaign_endless_unlocked(progress: &[u8], map_id: u8) -> Result<bool, BoundaryError> {
    Ok(decode_campaign_progress(progress)?.endless_unlocked(map_id))
}

/// # Errors
///
/// Returns an encoding error for invalid progress.
pub fn campaign_map_perfected(progress: &[u8], map_id: u8) -> Result<bool, BoundaryError> {
    Ok(decode_campaign_progress(progress)?.map_perfected(map_id))
}

fn encode_level<const N: usize>(writer: &mut Writer<N>, level: LevelRules) {
    writer.write(&level.points_required.to_le_bytes());
    writer.write(&level.max_moves.to_le_bytes());
    encode_constraint(writer, level.primary);
    encode_constraint(writer, level.secondary);
}

fn decode_level(reader: &mut Reader<'_>) -> Result<LevelRules, BoundaryError> {
    Ok(LevelRules {
        points_required: reader.u32()?,
        max_moves: reader.u16()?,
        primary: decode_constraint(reader)?,
        secondary: decode_constraint(reader)?,
    })
}

fn encode_constraint<const N: usize>(writer: &mut Writer<N>, constraint: Constraint) {
    writer.write(&[
        constraint_tag(constraint.kind),
        constraint.value,
        constraint.required_count,
    ]);
}

fn decode_constraint(reader: &mut Reader<'_>) -> Result<Constraint, BoundaryError> {
    Ok(Constraint {
        kind: match reader.u8()? {
            0 => ConstraintKind::None,
            1 => ConstraintKind::ComboLines,
            2 => ConstraintKind::BreakBlocks,
            3 => ConstraintKind::ComboMeter,
            _ => return Err(BoundaryError::InvalidEncoding),
        },
        value: reader.u8()?,
        required_count: reader.u8()?,
    })
}

fn encode_mutator<const N: usize>(writer: &mut Writer<N>, mutator: MutatorRules) {
    writer.write(&mutator.score_multiplier_x100.to_le_bytes());
    writer.write(&mutator.combo_multiplier_x100.to_le_bytes());
    writer.write(&mutator.line_clear_bonus.to_le_bytes());
    writer.write(&mutator.perfect_clear_bonus.to_le_bytes());
    writer.write(&[mutator.star_threshold_modifier, mutator.bonus_trigger_type]);
    writer.write(&mutator.bonus_threshold.to_le_bytes());
}

fn decode_mutator(reader: &mut Reader<'_>) -> Result<MutatorRules, BoundaryError> {
    Ok(MutatorRules {
        score_multiplier_x100: reader.u16()?,
        combo_multiplier_x100: reader.u16()?,
        line_clear_bonus: reader.u16()?,
        perfect_clear_bonus: reader.u16()?,
        star_threshold_modifier: reader.u8()?,
        bonus_trigger_type: reader.u8()?,
        bonus_threshold: reader.u16()?,
    })
}

fn encode_report<const N: usize>(writer: &mut Writer<N>, report: MoveReport) {
    writer.write(&[report.lines_cleared]);
    writer.write(&report.points_earned.to_le_bytes());
    writer.write(&[
        report.combo_counter,
        report.height_before,
        report.height_after,
        u8::from(report.perfect_clear),
    ]);
    writer.write(&report.blocks_destroyed_by_size);
    writer.write(&report.neutral_points_earned.to_le_bytes());
    writer.write(&[report.difficulty_at_action]);
}

fn decode_report(reader: &mut Reader<'_>) -> Result<MoveReport, BoundaryError> {
    Ok(MoveReport {
        lines_cleared: reader.u8()?,
        points_earned: reader.u32()?,
        combo_counter: reader.u8()?,
        height_before: reader.u8()?,
        height_after: reader.u8()?,
        perfect_clear: reader.bool()?,
        blocks_destroyed_by_size: reader.array()?,
        neutral_points_earned: reader.u32()?,
        difficulty_at_action: reader.u8()?,
    })
}

const fn constraint_tag(value: ConstraintKind) -> u8 {
    match value {
        ConstraintKind::None => 0,
        ConstraintKind::ComboLines => 1,
        ConstraintKind::BreakBlocks => 2,
        ConstraintKind::ComboMeter => 3,
    }
}

fn decode_mode(tag: u8) -> Result<CampaignMode, BoundaryError> {
    match tag {
        0 => Ok(CampaignMode::Level),
        1 => Ok(CampaignMode::Endless),
        _ => Err(BoundaryError::InvalidMode),
    }
}

const fn phase_tag(phase: RunPhase) -> u8 {
    match phase {
        RunPhase::Ready => 0,
        RunPhase::Playing => 1,
        RunPhase::AwaitingVrf => 2,
        RunPhase::LevelComplete => 3,
        RunPhase::Finished => 4,
    }
}

fn decode_phase(tag: u8) -> Result<RunPhase, BoundaryError> {
    match tag {
        0 => Ok(RunPhase::Ready),
        1 => Ok(RunPhase::Playing),
        2 => Ok(RunPhase::AwaitingVrf),
        3 => Ok(RunPhase::LevelComplete),
        4 => Ok(RunPhase::Finished),
        _ => Err(BoundaryError::InvalidEncoding),
    }
}

const fn bonus_tag(value: Option<Bonus>) -> u8 {
    match value {
        None => 0,
        Some(Bonus::Hammer) => 1,
        Some(Bonus::Totem) => 2,
        Some(Bonus::Wave) => 3,
    }
}

fn decode_bonus(tag: u8) -> Result<Option<Bonus>, BoundaryError> {
    match tag {
        0 => Ok(None),
        1 => Ok(Some(Bonus::Hammer)),
        2 => Ok(Some(Bonus::Totem)),
        3 => Ok(Some(Bonus::Wave)),
        _ => Err(BoundaryError::InvalidEncoding),
    }
}

fn decode_end_reason(tag: u8) -> Result<Option<CampaignEndReason>, BoundaryError> {
    match tag {
        0 => Ok(None),
        1 => Ok(Some(CampaignEndReason::Completed)),
        2 => Ok(Some(CampaignEndReason::Exhausted)),
        3 => Ok(Some(CampaignEndReason::Abandoned)),
        _ => Err(BoundaryError::InvalidEncoding),
    }
}

fn array_32(bytes: &[u8]) -> Result<[u8; 32], BoundaryError> {
    bytes.try_into().map_err(|_| BoundaryError::InvalidLength)
}

struct Writer<const N: usize> {
    bytes: [u8; N],
    cursor: usize,
}

impl<const N: usize> Writer<N> {
    const fn new() -> Self {
        Self {
            bytes: [0; N],
            cursor: 0,
        }
    }

    fn write(&mut self, value: &[u8]) {
        let end = self.cursor + value.len();
        self.bytes[self.cursor..end].copy_from_slice(value);
        self.cursor = end;
    }

    fn finish(self) -> [u8; N] {
        debug_assert_eq!(self.cursor, N);
        self.bytes
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    cursor: usize,
}

impl<'a> Reader<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, cursor: 0 }
    }

    fn array<const N: usize>(&mut self) -> Result<[u8; N], BoundaryError> {
        let end = self
            .cursor
            .checked_add(N)
            .ok_or(BoundaryError::InvalidEncoding)?;
        let bytes = self
            .bytes
            .get(self.cursor..end)
            .ok_or(BoundaryError::InvalidLength)?;
        self.cursor = end;
        bytes.try_into().map_err(|_| BoundaryError::InvalidLength)
    }

    fn u8(&mut self) -> Result<u8, BoundaryError> {
        Ok(self.array::<1>()?[0])
    }

    fn bool(&mut self) -> Result<bool, BoundaryError> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(BoundaryError::InvalidEncoding),
        }
    }

    fn u16(&mut self) -> Result<u16, BoundaryError> {
        Ok(u16::from_le_bytes(self.array()?))
    }

    fn u32(&mut self) -> Result<u32, BoundaryError> {
        Ok(u32::from_le_bytes(self.array()?))
    }

    fn u64(&mut self) -> Result<u64, BoundaryError> {
        Ok(u64::from_le_bytes(self.array()?))
    }

    fn finish(self) -> Result<(), BoundaryError> {
        if self.cursor == self.bytes.len() {
            Ok(())
        } else {
            Err(BoundaryError::InvalidEncoding)
        }
    }
}

const _: () = assert!(CAMPAIGN_TOTAL_LEVELS == 100);

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> CampaignSimulationConfig {
        CampaignSimulationConfig {
            content_version: 2,
            content_hash: [7; 32],
            map_id: 1,
            level_id: 1,
            attempt: 9,
            seed: [11; 32],
            mode: CampaignMode::Level,
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
    fn campaign_config_state_and_progress_round_trip() {
        let config = config();
        let encoded = encode_campaign_simulation_config(config);
        assert_eq!(decode_campaign_simulation_config(&encoded), Ok(config));
        let state = CampaignSimulation::new(config).unwrap();
        let encoded_state = encode_campaign_simulation_state(state);
        assert_eq!(decode_campaign_simulation_state(&encoded_state), Ok(state));

        let progress = CampaignProgress::new(2, [7; 32]).unwrap();
        let encoded_progress = encode_campaign_progress(progress);
        assert_eq!(decode_campaign_progress(&encoded_progress), Ok(progress));
    }

    #[test]
    fn stateless_campaign_boundary_rejects_cross_content_and_corruption() {
        let config = config();
        let config_bytes = encode_campaign_simulation_config(config);
        let state = initialize_campaign_simulation(&config_bytes).unwrap();
        let mut other = config;
        other.content_hash = [8; 32];
        assert_eq!(
            campaign_simulation_abandon(&encode_campaign_simulation_config(other), &state),
            Err(BoundaryError::InvalidEncoding)
        );
        let mut corrupted = state;
        corrupted[0] = 9;
        assert_eq!(
            decode_campaign_simulation_state(&corrupted),
            Err(BoundaryError::InvalidEncoding)
        );
    }

    #[test]
    fn progress_boundary_enforces_sequential_unlocks() {
        let mut progress = initialize_campaign_progress(2, &[7; 32]).unwrap();
        assert!(campaign_level_unlocked(&progress, 1, 1).unwrap());
        assert!(!campaign_level_unlocked(&progress, 1, 2).unwrap());
        progress = record_campaign_level_result(&progress, 1, 1, 2).unwrap();
        assert!(campaign_level_unlocked(&progress, 1, 2).unwrap());
        assert_eq!(campaign_progress_next_attempt(&progress), Ok(0));
        progress = reserve_campaign_attempt(&progress).unwrap();
        assert_eq!(campaign_progress_next_attempt(&progress), Ok(1));
    }
}
