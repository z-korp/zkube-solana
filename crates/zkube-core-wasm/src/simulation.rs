use crate::BoundaryError;
use zkube_core::{
    Bonus, CANONICAL_DAILY_RULES_LEN, ChainDomain, ChallengeId, DailyObjective, DailyObjectiveRule,
    DailyPressureRules, DailyRunRules, DailySimulation, DailySimulationConfig, Grid, MutatorRules,
    PlayerId, ReplayCommitment, ReplayMode, RulesHash, RunEngine, RunMetrics, RunPhase,
    derive_player_id,
};

/// Versioned fixed encoding consumed by the stateless WASM transition API.
///
/// Layout: chain domain (32), challenge (32), raw account (32), run ID LE (8),
/// replay mode (1), finalized Daily rules hash (32), then the 145-byte
/// canonical [`DailyRunRules`] snapshot encoding.
pub const DAILY_SIMULATION_CONFIG_LEN: usize = 282;
/// Versioned state layout returned by every transition.
///
/// The first byte is version 1, followed by engine flags/counters, the 80-byte
/// grid, optional next row, nine metrics, replay commitment, player ID, and
/// rules hash. Callers should treat these bytes as an opaque preview token and
/// use generated decoders for display; the chain remains authoritative.
pub const DAILY_SIMULATION_STATE_LEN: usize = 305;
const STATE_VERSION: u8 = 1;

/// Encode a typed configuration for the frontend WASM boundary.
#[must_use]
pub fn encode_daily_simulation_config(
    config: DailySimulationConfig,
) -> [u8; DAILY_SIMULATION_CONFIG_LEN] {
    let mut writer = Writer::new();
    writer.write(config.chain_domain.as_bytes());
    writer.write(config.challenge.as_bytes());
    writer.write(&config.raw_account);
    writer.write(&config.run_id.to_le_bytes());
    writer.write(&[config.mode.tag()]);
    writer.write(config.rules_hash.as_bytes());
    writer.write(config.rules.canonical_bytes().as_slice());
    writer.finish()
}

/// Decode and validate the fixed frontend configuration.
///
/// # Errors
///
/// Returns a boundary error for a wrong length, unknown tag, malformed rules,
/// or trailing bytes.
pub fn decode_daily_simulation_config(
    bytes: &[u8],
) -> Result<DailySimulationConfig, BoundaryError> {
    if bytes.len() != DAILY_SIMULATION_CONFIG_LEN {
        return Err(BoundaryError::InvalidLength);
    }
    let mut reader = Reader::new(bytes);
    let chain_domain = ChainDomain(reader.array()?);
    let challenge = ChallengeId(reader.array()?);
    let raw_account = reader.array()?;
    let run_id = reader.u64()?;
    let mode = match reader.u8()? {
        0 => ReplayMode::Ranked,
        1 => ReplayMode::Practice,
        _ => return Err(BoundaryError::InvalidMode),
    };
    let rules_hash = RulesHash(reader.array()?);
    let rules = decode_rules(&mut reader)?;
    reader.finish()?;
    if !rules.is_valid() {
        return Err(BoundaryError::InvalidEncoding);
    }
    Ok(DailySimulationConfig {
        chain_domain,
        challenge,
        raw_account,
        run_id,
        mode,
        rules_hash,
        rules,
    })
}

/// Encode a typed simulation state as the opaque frontend transition token.
#[must_use]
pub fn encode_daily_simulation_state(
    simulation: DailySimulation,
) -> [u8; DAILY_SIMULATION_STATE_LEN] {
    let mut writer = Writer::new();
    writer.write(&[STATE_VERSION]);
    writer.write(&[phase_tag(simulation.engine.phase)]);
    writer.write(&[u8::from(simulation.deadline_finished)]);
    writer.write(&[u8::from(simulation.engine.next_row.is_some())]);
    writer.write(&[bonus_tag(simulation.engine.bonus)]);
    writer.write(&[simulation.engine.bonus_charges]);
    writer.write(&[u8::from(simulation.engine.perfect_trigger_available)]);
    writer.write(&[simulation.engine.starting_height_target]);
    writer.write(&[simulation.current_difficulty]);
    writer.write(&[simulation.engine.combo_counter]);
    writer.write(&[simulation.engine.max_combo]);
    writer.write(&[simulation.engine.primary_progress]);
    writer.write(&[simulation.engine.secondary_progress]);
    writer.write(&simulation.engine.level_lines_cleared.to_le_bytes());
    writer.write(&simulation.engine.moves.to_le_bytes());
    writer.write(&simulation.action_counter.to_le_bytes());
    writer.write(&simulation.last_vrf_counter.to_le_bytes());
    writer.write(&simulation.engine.score.to_le_bytes());
    writer.write(&simulation.daily_score.to_le_bytes());
    writer.write(&simulation.pressure_score.to_le_bytes());
    writer.write(simulation.engine.grid.cells());
    writer.write(&simulation.engine.next_row.unwrap_or([0; 8]));
    encode_metrics(&mut writer, simulation.metrics);
    writer.write(simulation.replay.as_bytes());
    writer.write(simulation.player_id.as_bytes());
    writer.write(simulation.rules_hash.as_bytes());
    writer.write(simulation.rules_snapshot_hash.as_bytes());
    writer.finish()
}

/// Decode and structurally validate an opaque frontend transition token.
///
/// # Errors
///
/// Returns a boundary error for a wrong version/length, invalid tag, malformed
/// grid/preview, impossible flag combination, or trailing bytes.
pub fn decode_daily_simulation_state(bytes: &[u8]) -> Result<DailySimulation, BoundaryError> {
    if bytes.len() != DAILY_SIMULATION_STATE_LEN {
        return Err(BoundaryError::InvalidLength);
    }
    let mut reader = Reader::new(bytes);
    if reader.u8()? != STATE_VERSION {
        return Err(BoundaryError::InvalidEncoding);
    }
    let phase = decode_phase(reader.u8()?)?;
    let deadline_finished = reader.bool()?;
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
    let last_vrf_counter = reader.u32()?;
    let score = reader.u32()?;
    let daily_score = reader.u32()?;
    let pressure_score = reader.u32()?;
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
    let metrics = decode_metrics(&mut reader)?;
    let replay = ReplayCommitment(reader.array()?);
    let player_id = PlayerId(reader.array()?);
    let rules_hash = RulesHash(reader.array()?);
    let rules_snapshot_hash = RulesHash(reader.array()?);
    reader.finish()?;

    if current_difficulty > 7
        || (deadline_finished && phase != RunPhase::Finished)
        || (phase == RunPhase::Playing && next_row.is_none())
        || (phase == RunPhase::AwaitingVrf && next_row.is_some())
    {
        return Err(BoundaryError::InvalidEncoding);
    }
    Ok(DailySimulation {
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
        metrics,
        action_counter,
        daily_score,
        pressure_score,
        current_difficulty,
        last_vrf_counter,
        replay,
        player_id,
        rules_hash,
        rules_snapshot_hash,
        deadline_finished,
    })
}

/// Initialize from the first verified VRF callback and return encoded state.
///
/// # Errors
///
/// Returns an encoding or simulation transition error.
pub fn initialize_daily_simulation(
    config: &[u8],
    request_counter: u32,
    vrf_output: &[u8],
) -> Result<Vec<u8>, BoundaryError> {
    let config = decode_daily_simulation_config(config)?;
    let mut simulation = DailySimulation::new(config)?;
    simulation.apply_vrf(config.rules, request_counter, array_32(vrf_output)?)?;
    Ok(encode_daily_simulation_state(simulation).to_vec())
}

/// Apply the next verified VRF callback to an encoded simulation.
///
/// # Errors
///
/// Returns an encoding or simulation transition error.
pub fn simulation_apply_vrf(
    config: &[u8],
    state: &[u8],
    request_counter: u32,
    vrf_output: &[u8],
) -> Result<Vec<u8>, BoundaryError> {
    let (config, mut simulation) = decode_for_transition(config, state)?;
    simulation.apply_vrf(config.rules, request_counter, array_32(vrf_output)?)?;
    Ok(encode_daily_simulation_state(simulation).to_vec())
}

/// Apply an ordered move to an encoded simulation.
///
/// # Errors
///
/// Returns an encoding or simulation transition error.
#[allow(clippy::too_many_arguments)]
pub fn simulation_play_move(
    config: &[u8],
    state: &[u8],
    action: u32,
    expected_move: u16,
    row: u8,
    start: u8,
    destination: u8,
) -> Result<Vec<u8>, BoundaryError> {
    let (config, mut simulation) = decode_for_transition(config, state)?;
    simulation.play_move(config.rules, action, expected_move, row, start, destination)?;
    Ok(encode_daily_simulation_state(simulation).to_vec())
}

/// Apply an ordered bonus action to an encoded simulation.
///
/// # Errors
///
/// Returns an encoding or simulation transition error.
pub fn simulation_apply_bonus(
    config: &[u8],
    state: &[u8],
    action: u32,
    row: u8,
    column: u8,
) -> Result<Vec<u8>, BoundaryError> {
    let (config, mut simulation) = decode_for_transition(config, state)?;
    simulation.apply_bonus(config.rules, action, row, column)?;
    Ok(encode_daily_simulation_state(simulation).to_vec())
}

/// Finish an encoded simulation at the Daily deadline.
///
/// # Errors
///
/// Returns an encoding or simulation transition error.
pub fn simulation_finish_deadline(config: &[u8], state: &[u8]) -> Result<Vec<u8>, BoundaryError> {
    let (_, mut simulation) = decode_for_transition(config, state)?;
    simulation.finish_at_deadline()?;
    Ok(encode_daily_simulation_state(simulation).to_vec())
}

/// Report whether an encoded state has accepted an action and is therefore
/// eligible to submit a ranked score.
///
/// # Errors
///
/// Returns an encoding error for a malformed state token.
pub fn simulation_score_eligible(state: &[u8]) -> Result<bool, BoundaryError> {
    Ok(decode_daily_simulation_state(state)?.is_score_eligible())
}

fn decode_for_transition(
    config: &[u8],
    state: &[u8],
) -> Result<(DailySimulationConfig, DailySimulation), BoundaryError> {
    let config = decode_daily_simulation_config(config)?;
    let simulation = decode_daily_simulation_state(state)?;
    if simulation.rules_hash != config.rules_hash
        || simulation.rules_snapshot_hash != config.rules.snapshot_hash()
        || simulation.player_id != derive_player_id(config.chain_domain, config.raw_account)
        || simulation.engine.bonus != config.rules.bonus
    {
        return Err(BoundaryError::InvalidEncoding);
    }
    Ok((config, simulation))
}

fn decode_rules(reader: &mut Reader<'_>) -> Result<DailyRunRules, BoundaryError> {
    let max_moves = reader.u16()?;
    let mutator = MutatorRules {
        score_multiplier_x100: reader.u16()?,
        combo_multiplier_x100: reader.u16()?,
        line_clear_bonus: reader.u16()?,
        perfect_clear_bonus: reader.u16()?,
        star_threshold_modifier: reader.u8()?,
        bonus_trigger_type: reader.u8()?,
        bonus_threshold: reader.u16()?,
    };
    let bonus = decode_bonus(reader.u8()?)?;
    let starting_bonus_charges = reader.u8()?;
    let objective_tag = reader.u8()?;
    let objective_parameter = reader.u8()?;
    let objective = match objective_tag {
        0 if objective_parameter == 0 => DailyObjective::Classic,
        1 => DailyObjective::Combo {
            minimum_lines: objective_parameter,
        },
        2 => DailyObjective::ExactLines {
            lines: objective_parameter,
        },
        3 => DailyObjective::Blocks {
            size: objective_parameter,
        },
        4 => DailyObjective::Clutch {
            minimum_height: objective_parameter,
        },
        5 => DailyObjective::Clean {
            maximum_height: objective_parameter,
        },
        6 if objective_parameter == 0 => DailyObjective::Survival,
        _ => return Err(BoundaryError::InvalidEncoding),
    };
    let objective = DailyObjectiveRule {
        objective,
        bonus_multiplier_x100: reader.u16()?,
    };
    let mut thresholds = [0; 7];
    for threshold in &mut thresholds {
        *threshold = reader.u32()?;
    }
    let mut score_multipliers_x100 = [0; 8];
    for multiplier in &mut score_multipliers_x100 {
        *multiplier = reader.u16()?;
    }
    let mut block_weights = [[0; 5]; 8];
    for tier in &mut block_weights {
        for weight in tier {
            *weight = reader.u16()?;
        }
    }
    let starting_height = reader.u8()?;
    Ok(DailyRunRules {
        max_moves,
        mutator,
        bonus,
        starting_bonus_charges,
        objective,
        pressure: DailyPressureRules {
            thresholds,
            score_multipliers_x100,
            block_weights,
            starting_height,
        },
    })
}

fn encode_metrics<const N: usize>(writer: &mut Writer<N>, metrics: RunMetrics) {
    writer.write(&metrics.maximum_combo.to_le_bytes());
    writer.write(&metrics.combo_scoring_actions.to_le_bytes());
    writer.write(&metrics.total_combo_derived_score.to_le_bytes());
    writer.write(&metrics.highest_action_score.to_le_bytes());
    writer.write(&metrics.most_lines_in_action.to_le_bytes());
    writer.write(&metrics.most_blocks_destroyed_in_action.to_le_bytes());
    writer.write(&metrics.total_lines.to_le_bytes());
    writer.write(&metrics.total_blocks_destroyed.to_le_bytes());
    writer.write(&metrics.perfect_clears.to_le_bytes());
}

fn decode_metrics(reader: &mut Reader<'_>) -> Result<RunMetrics, BoundaryError> {
    Ok(RunMetrics {
        maximum_combo: reader.u32()?,
        combo_scoring_actions: reader.u32()?,
        total_combo_derived_score: reader.u64()?,
        highest_action_score: reader.u64()?,
        most_lines_in_action: reader.u32()?,
        most_blocks_destroyed_in_action: reader.u32()?,
        total_lines: reader.u64()?,
        total_blocks_destroyed: reader.u64()?,
        perfect_clears: reader.u32()?,
    })
}

fn array_32(bytes: &[u8]) -> Result<[u8; 32], BoundaryError> {
    bytes.try_into().map_err(|_| BoundaryError::InvalidLength)
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

const fn bonus_tag(bonus: Option<Bonus>) -> u8 {
    match bonus {
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

const _: () = assert!(DAILY_SIMULATION_CONFIG_LEN == 137 + CANONICAL_DAILY_RULES_LEN);

#[cfg(test)]
mod tests {
    use super::*;

    fn rules() -> DailyRunRules {
        DailyRunRules {
            max_moves: 100,
            mutator: MutatorRules::default(),
            bonus: Some(Bonus::Wave),
            starting_bonus_charges: 1,
            objective: DailyObjectiveRule {
                objective: DailyObjective::Survival,
                bonus_multiplier_x100: 100,
            },
            pressure: DailyPressureRules::canonical(),
        }
    }

    fn config() -> DailySimulationConfig {
        let rules = rules();
        DailySimulationConfig {
            chain_domain: ChainDomain(core::array::from_fn(|index| u8::try_from(index).unwrap())),
            challenge: ChallengeId(core::array::from_fn(|index| {
                0x20 + u8::try_from(index).unwrap()
            })),
            raw_account: core::array::from_fn(|index| 0x40 + u8::try_from(index).unwrap()),
            run_id: 0x0102_0304_0506_0708,
            mode: ReplayMode::Ranked,
            rules_hash: zkube_core::daily_challenge_rules_hash(
                42,
                rules.snapshot_hash().to_bytes(),
                7,
                3,
                15,
            ),
            rules,
        }
    }

    #[test]
    fn config_and_state_codecs_round_trip_exactly() {
        let config = config();
        let encoded_config = encode_daily_simulation_config(config);
        assert_eq!(encoded_config.len(), DAILY_SIMULATION_CONFIG_LEN);
        assert_eq!(
            decode_daily_simulation_config(&encoded_config).unwrap(),
            config
        );

        let mut simulation = DailySimulation::new(config).unwrap();
        simulation.apply_vrf(config.rules, 1, [0x11; 32]).unwrap();
        let encoded_state = encode_daily_simulation_state(simulation);
        assert_eq!(encoded_state.len(), DAILY_SIMULATION_STATE_LEN);
        assert_eq!(
            decode_daily_simulation_state(&encoded_state).unwrap(),
            simulation
        );
    }

    #[test]
    fn stateless_boundary_matches_typed_core_transitions() {
        let config = config();
        let config_bytes = encode_daily_simulation_config(config);
        let mut expected = DailySimulation::new(config).unwrap();
        expected.apply_vrf(config.rules, 1, [0x11; 32]).unwrap();
        let mut state = initialize_daily_simulation(&config_bytes, 1, &[0x11; 32]).unwrap();
        assert_eq!(decode_daily_simulation_state(&state).unwrap(), expected);

        expected.apply_bonus(config.rules, 0, 0, 0).unwrap();
        state = simulation_apply_bonus(&config_bytes, &state, 0, 0, 0).unwrap();
        assert_eq!(decode_daily_simulation_state(&state).unwrap(), expected);

        expected.play_move(config.rules, 1, 0, 0, 1, 0).unwrap();
        state = simulation_play_move(&config_bytes, &state, 1, 0, 0, 1, 0).unwrap();
        assert_eq!(decode_daily_simulation_state(&state).unwrap(), expected);

        expected.apply_vrf(config.rules, 2, [0x22; 32]).unwrap();
        state = simulation_apply_vrf(&config_bytes, &state, 2, &[0x22; 32]).unwrap();
        assert_eq!(decode_daily_simulation_state(&state).unwrap(), expected);

        expected.finish_at_deadline().unwrap();
        state = simulation_finish_deadline(&config_bytes, &state).unwrap();
        assert_eq!(decode_daily_simulation_state(&state).unwrap(), expected);
        assert!(simulation_score_eligible(&state).unwrap());
    }

    #[test]
    fn zero_action_deadline_is_terminal_but_not_score_eligible() {
        let config = config();
        let config_bytes = encode_daily_simulation_config(config);
        let state = initialize_daily_simulation(&config_bytes, 1, &[0x11; 32]).unwrap();
        assert!(!simulation_score_eligible(&state).unwrap());

        let finished = simulation_finish_deadline(&config_bytes, &state).unwrap();
        let decoded = decode_daily_simulation_state(&finished).unwrap();
        assert_eq!(decoded.engine.phase, RunPhase::Finished);
        assert!(decoded.deadline_finished);
        assert_eq!(decoded.action_counter, 0);
        assert!(!simulation_score_eligible(&finished).unwrap());
    }

    #[test]
    fn boundary_rejects_truncation_unknown_tags_and_cross_config_state() {
        let config = config();
        let mut config_bytes = encode_daily_simulation_config(config);
        assert_eq!(
            decode_daily_simulation_config(&config_bytes[..config_bytes.len() - 1]),
            Err(BoundaryError::InvalidLength)
        );
        config_bytes[104] = 9;
        assert_eq!(
            decode_daily_simulation_config(&config_bytes),
            Err(BoundaryError::InvalidMode)
        );

        let original_config = encode_daily_simulation_config(config);
        let state = initialize_daily_simulation(&original_config, 1, &[0x11; 32]).unwrap();
        let mut other = config;
        other.raw_account = [9; 32];
        assert_eq!(
            simulation_apply_bonus(&encode_daily_simulation_config(other), &state, 0, 0, 0),
            Err(BoundaryError::InvalidEncoding)
        );
    }
}
