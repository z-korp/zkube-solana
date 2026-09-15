use crate::{BoundaryError, array_32};
use zkube_core::{
    BONUS_CHARGE_CAP, Bonus, CANONICAL_RUN_RULES_LEN, Constraint, ConstraintKind, DailyTheme, Grid,
    Guardian, ReplayCommitment, RulesHash, Run, RunConfig, RunEndReason, RunEngine, RunPhase,
    RunRules, StarRules, TierPolicy,
};

/// Versioned `RunConfig` token shared by Campaign and Daily callers.
pub const RUN_CONFIG_LEN: usize = 88;
/// Versioned opaque `Run` token returned by every transition.
pub const RUN_STATE_LEN: usize = 231;
const CONFIG_VERSION: u8 = 1;
const STATE_VERSION: u8 = 1;

/// Build the one versioned config token from fields published in an
/// `ActiveRun`. Mode selects the only two valid shapes: fixed-tier Campaign
/// rules carry stars, while pressure-tier Daily rules carry an optional theme.
///
/// # Errors
///
/// Rejects malformed hashes, tags, or a rules combination the core would not
/// accept for a run.
#[allow(clippy::too_many_arguments)]
pub fn build_run_config(
    rules_hash: &[u8],
    initial_replay: &[u8],
    max_moves: u16,
    bonus: u8,
    trigger: u8,
    trigger_threshold: u16,
    starting_height: u8,
    tier_policy: u8,
    fixed_tier: u8,
    points_required: u32,
    primary_kind: u8,
    primary_value: u8,
    primary_count: u8,
    secondary_kind: u8,
    secondary_value: u8,
    secondary_count: u8,
    objective_kind: u8,
    objective_value: u8,
) -> Result<Vec<u8>, BoundaryError> {
    let guardian = Guardian {
        bonus: decode_bonus(bonus)?.ok_or(BoundaryError::InvalidEncoding)?,
        trigger,
        threshold: trigger_threshold,
    };
    let (tier, stars, objective) = match tier_policy {
        0 => {
            if objective_kind != 0 || objective_value != 0 {
                return Err(BoundaryError::InvalidEncoding);
            }
            (
                TierPolicy::Fixed(fixed_tier),
                Some(StarRules {
                    points_required,
                    primary: constraint_from_parts(primary_kind, primary_value, primary_count)?,
                    secondary: constraint_from_parts(
                        secondary_kind,
                        secondary_value,
                        secondary_count,
                    )?,
                }),
                None,
            )
        }
        1 => {
            if fixed_tier != 0
                || points_required != 0
                || primary_kind != 0
                || primary_value != 0
                || primary_count != 0
                || secondary_kind != 0
                || secondary_value != 0
                || secondary_count != 0
            {
                return Err(BoundaryError::InvalidEncoding);
            }
            let objective = if objective_kind == 0 {
                if objective_value != 0 {
                    return Err(BoundaryError::InvalidEncoding);
                }
                None
            } else {
                Some(DailyTheme {
                    kind: ConstraintKind::from_tag(objective_kind)
                        .ok_or(BoundaryError::InvalidEncoding)?,
                    value: objective_value,
                })
            };
            (TierPolicy::Pressure, None, objective)
        }
        _ => return Err(BoundaryError::InvalidEncoding),
    };
    let config = RunConfig {
        rules_hash: RulesHash(array_32(rules_hash)?),
        rules: RunRules {
            guardian,
            starting_height,
            max_moves,
            tier,
            stars,
            objective,
        },
        initial_replay: ReplayCommitment(array_32(initial_replay)?),
    };
    if !config.rules.is_valid() {
        return Err(BoundaryError::InvalidEncoding);
    }
    Ok(encode_run_config(config).to_vec())
}

/// Rebuild the opaque core token from one validated chain snapshot. The
/// account decoder owns identity and Borsh; this function owns every engine
/// invariant, phase mapping, counter relationship, and codec byte.
///
/// # Errors
///
/// Rejects malformed fields or a snapshot that cannot be a state of `config`.
#[allow(clippy::too_many_arguments)]
pub fn reconcile_run_state(
    config: &[u8],
    phase: u8,
    end_reason: u8,
    bonus: u8,
    bonus_charges: u8,
    reroll_charges: u8,
    combo_counter: u8,
    max_combo: u8,
    primary_progress: u8,
    secondary_progress: u8,
    latched_star_sources: u8,
    streak: u8,
    charges_earned: u8,
    current_tier: u8,
    level_lines_cleared: u16,
    moves: u16,
    action_counter: u32,
    vrf_request_counter: u32,
    pending_vrf_counter: u32,
    score: u32,
    daily_score: u32,
    objective_total: u64,
    pressure_score: u32,
    grid: &[u8],
    next_row: &[u8],
    replay: &[u8],
) -> Result<Vec<u8>, BoundaryError> {
    let config_value = decode_run_config(config)?;
    let bonus = decode_bonus(bonus)?;
    if bonus != Some(config_value.rules.guardian.bonus) {
        return Err(BoundaryError::InvalidEncoding);
    }
    let grid = Grid::try_from_cells(grid.try_into().map_err(|_| BoundaryError::InvalidLength)?)
        .map_err(|_| BoundaryError::InvalidEncoding)?;
    let next_row = if next_row.is_empty() {
        None
    } else {
        let row: [u8; 8] = next_row
            .try_into()
            .map_err(|_| BoundaryError::InvalidLength)?;
        Grid::validate_row(&row).map_err(|_| BoundaryError::InvalidEncoding)?;
        Some(row)
    };
    let last_vrf_counter = if pending_vrf_counter == 0 {
        vrf_request_counter
    } else {
        if pending_vrf_counter != vrf_request_counter {
            return Err(BoundaryError::InvalidEncoding);
        }
        vrf_request_counter
            .checked_sub(1)
            .ok_or(BoundaryError::InvalidEncoding)?
    };
    let current_tier = match config_value.rules.tier {
        TierPolicy::Fixed(tier) => {
            if current_tier != 0 && current_tier != tier {
                return Err(BoundaryError::InvalidEncoding);
            }
            tier
        }
        TierPolicy::Pressure => current_tier,
    };
    let run = Run {
        engine: RunEngine {
            grid,
            next_row,
            phase: decode_phase(phase)?,
            score,
            moves,
            combo_counter,
            max_combo,
            primary_progress,
            secondary_progress,
            latched_star_sources,
            streak,
            charges_earned,
            level_lines_cleared,
            bonus,
            bonus_charges,
            reroll_charges,
        },
        action_counter,
        daily_score,
        objective_total,
        pressure_score,
        current_tier,
        last_vrf_counter,
        replay: ReplayCommitment(array_32(replay)?),
        rules_hash: config_value.rules_hash,
        rules_snapshot_hash: config_value.rules.snapshot_hash(),
        end_reason: decode_end_reason(end_reason)?,
    };
    let state = encode_run_state(run);
    decode_for_transition(config, &state)?;
    Ok(state.to_vec())
}

#[must_use]
pub fn encode_run_config(config: RunConfig) -> [u8; RUN_CONFIG_LEN] {
    let mut writer = Writer::new();
    writer.write(&[CONFIG_VERSION]);
    writer.write(config.rules_hash.as_bytes());
    writer.write(config.initial_replay.as_bytes());
    writer.write(config.rules.canonical_bytes().as_slice());
    writer.finish()
}

/// Decode the one rules/config shape used by both modes.
///
/// # Errors
///
/// Rejects a wrong version or length, malformed tags, invalid rules, and
/// trailing bytes.
pub fn decode_run_config(bytes: &[u8]) -> Result<RunConfig, BoundaryError> {
    if bytes.len() != RUN_CONFIG_LEN {
        return Err(BoundaryError::InvalidLength);
    }
    let mut reader = Reader::new(bytes);
    if reader.u8()? != CONFIG_VERSION {
        return Err(BoundaryError::InvalidEncoding);
    }
    let rules_hash = RulesHash(reader.array()?);
    let initial_replay = ReplayCommitment(reader.array()?);
    let rules = decode_rules(&mut reader)?;
    reader.finish()?;
    if !rules.is_valid() {
        return Err(BoundaryError::InvalidEncoding);
    }
    Ok(RunConfig {
        rules_hash,
        rules,
        initial_replay,
    })
}

#[must_use]
pub fn encode_run_state(run: Run) -> [u8; RUN_STATE_LEN] {
    let mut writer = Writer::new();
    writer.write(&[STATE_VERSION]);
    writer.write(&[phase_tag(run.engine.phase)]);
    writer.write(&[u8::from(run.engine.next_row.is_some())]);
    writer.write(&[bonus_tag(run.engine.bonus)]);
    writer.write(&[
        run.engine.bonus_charges,
        run.engine.reroll_charges,
        run.engine.combo_counter,
        run.engine.max_combo,
        run.engine.primary_progress,
        run.engine.secondary_progress,
        run.engine.latched_star_sources,
        run.engine.streak,
        run.engine.charges_earned,
        run.current_tier,
    ]);
    writer.write(&run.engine.level_lines_cleared.to_le_bytes());
    writer.write(&run.engine.moves.to_le_bytes());
    writer.write(&run.action_counter.to_le_bytes());
    writer.write(&run.last_vrf_counter.to_le_bytes());
    writer.write(&run.engine.score.to_le_bytes());
    writer.write(&run.daily_score.to_le_bytes());
    writer.write(&run.objective_total.to_le_bytes());
    writer.write(&run.pressure_score.to_le_bytes());
    writer.write(run.engine.grid.cells());
    writer.write(&run.engine.next_row.unwrap_or([0; 8]));
    writer.write(run.replay.as_bytes());
    writer.write(run.rules_hash.as_bytes());
    writer.write(run.rules_snapshot_hash.as_bytes());
    writer.write(&[run.end_reason.map_or(0, end_reason_tag)]);
    writer.finish()
}

/// Decode and structurally validate an opaque shared run token.
///
/// # Errors
///
/// Rejects malformed state, impossible terminal/phase pairs, and invalid grid
/// or preview bytes.
pub fn decode_run_state(bytes: &[u8]) -> Result<Run, BoundaryError> {
    if bytes.len() != RUN_STATE_LEN {
        return Err(BoundaryError::InvalidLength);
    }
    let mut reader = Reader::new(bytes);
    if reader.u8()? != STATE_VERSION {
        return Err(BoundaryError::InvalidEncoding);
    }
    let phase = decode_phase(reader.u8()?)?;
    let has_next_row = reader.bool()?;
    let bonus = decode_bonus(reader.u8()?)?;
    let bonus_charges = reader.u8()?;
    let reroll_charges = reader.u8()?;
    let combo_counter = reader.u8()?;
    let max_combo = reader.u8()?;
    let primary_progress = reader.u8()?;
    let secondary_progress = reader.u8()?;
    let latched_star_sources = reader.u8()?;
    let streak = reader.u8()?;
    let charges_earned = reader.u8()?;
    let current_tier = reader.u8()?;
    let level_lines_cleared = reader.u16()?;
    let moves = reader.u16()?;
    let action_counter = reader.u32()?;
    let last_vrf_counter = reader.u32()?;
    let score = reader.u32()?;
    let daily_score = reader.u32()?;
    let objective_total = reader.u64()?;
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
    let replay = ReplayCommitment(reader.array()?);
    let rules_hash = RulesHash(reader.array()?);
    let rules_snapshot_hash = RulesHash(reader.array()?);
    let end_reason = decode_end_reason(reader.u8()?)?;
    reader.finish()?;

    let phase_matches_end = matches!(
        (phase, end_reason),
        (RunPhase::AwaitingVrf | RunPhase::Playing, None)
            | (RunPhase::LevelComplete, Some(RunEndReason::Completed))
            | (
                RunPhase::Finished,
                Some(RunEndReason::Exhausted | RunEndReason::Abandoned | RunEndReason::Deadline)
            )
    );
    if !phase_matches_end
        || (phase == RunPhase::Playing && next_row.is_none())
        || reroll_charges > BONUS_CHARGE_CAP
        || latched_star_sources & !0b111 != 0
    {
        return Err(BoundaryError::InvalidEncoding);
    }
    Ok(Run {
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
            latched_star_sources,
            streak,
            charges_earned,
            level_lines_cleared,
            bonus,
            bonus_charges,
            reroll_charges,
        },
        action_counter,
        daily_score,
        objective_total,
        pressure_score,
        current_tier,
        last_vrf_counter,
        replay,
        rules_hash,
        rules_snapshot_hash,
        end_reason,
    })
}

/// Initialize one shared run before its opening VRF callback.
///
/// # Errors
///
/// Returns a codec or core transition error.
pub fn initialize_run(config: &[u8]) -> Result<Vec<u8>, BoundaryError> {
    let config = decode_run_config(config)?;
    Ok(encode_run_state(Run::new(config)?).to_vec())
}

/// Apply the next verified VRF callback.
///
/// # Errors
///
/// Returns a codec or core transition error without partial state.
pub fn run_apply_vrf(
    config: &[u8],
    state: &[u8],
    request_counter: u32,
    vrf_output: &[u8],
) -> Result<Vec<u8>, BoundaryError> {
    let (config, mut run) = decode_for_transition(config, state)?;
    run.apply_vrf(
        config.rules,
        request_counter,
        vrf_output
            .try_into()
            .map_err(|_| BoundaryError::InvalidLength)?,
    )?;
    Ok(encode_run_state(run).to_vec())
}

/// Apply one ordered move.
///
/// # Errors
///
/// Returns a codec or core transition error without partial state.
#[allow(clippy::too_many_arguments)]
pub fn run_play_move(
    config: &[u8],
    state: &[u8],
    action: u32,
    expected_move: u16,
    row: u8,
    start: u8,
    destination: u8,
) -> Result<Vec<u8>, BoundaryError> {
    let (config, mut run) = decode_for_transition(config, state)?;
    run.play_move(config.rules, action, expected_move, row, start, destination)?;
    Ok(encode_run_state(run).to_vec())
}

/// Apply one ordered guardian bonus.
///
/// # Errors
///
/// Returns a codec or core transition error without partial state.
pub fn run_apply_bonus(
    config: &[u8],
    state: &[u8],
    action: u32,
    row: u8,
    column: u8,
) -> Result<Vec<u8>, BoundaryError> {
    let (config, mut run) = decode_for_transition(config, state)?;
    run.apply_bonus(config.rules, action, row, column)?;
    Ok(encode_run_state(run).to_vec())
}

/// Request one ordered reroll.
///
/// # Errors
///
/// Returns a codec or core transition error without partial state.
pub fn run_request_reroll(
    config: &[u8],
    state: &[u8],
    action: u32,
) -> Result<Vec<u8>, BoundaryError> {
    let (config, mut run) = decode_for_transition(config, state)?;
    run.request_reroll(config.rules, action)?;
    Ok(encode_run_state(run).to_vec())
}

/// Finish with Abandon (tag 3) or Deadline (tag 4).
///
/// # Errors
///
/// Returns a codec or rejected finish transition without partial state.
pub fn run_finish(config: &[u8], state: &[u8], reason_tag: u8) -> Result<Vec<u8>, BoundaryError> {
    let reason = match reason_tag {
        3 => RunEndReason::Abandoned,
        4 => RunEndReason::Deadline,
        _ => return Err(BoundaryError::InvalidEncoding),
    };
    let (config, mut run) = decode_for_transition(config, state)?;
    run.finish(config.rules, reason)?;
    Ok(encode_run_state(run).to_vec())
}

/// # Errors
///
/// Rejects a malformed state token.
pub fn run_score_eligible(state: &[u8]) -> Result<bool, BoundaryError> {
    Ok(decode_run_state(state)?.is_score_eligible())
}

/// # Errors
///
/// Rejects a malformed state token.
pub fn run_latched_star_sources(state: &[u8]) -> Result<u8, BoundaryError> {
    Ok(decode_run_state(state)?.engine.latched_star_sources)
}

/// Zero means active; 1-4 encode completed, exhausted, abandoned, deadline.
///
/// # Errors
///
/// Rejects a malformed state token.
pub fn run_end_reason(state: &[u8]) -> Result<u8, BoundaryError> {
    Ok(decode_run_state(state)?
        .end_reason
        .map_or(0, end_reason_tag))
}

pub(crate) fn decode_for_transition(
    config: &[u8],
    state: &[u8],
) -> Result<(RunConfig, Run), BoundaryError> {
    let config = decode_run_config(config)?;
    let run = decode_run_state(state)?;
    if run.rules_hash != config.rules_hash
        || run.rules_snapshot_hash != config.rules.snapshot_hash()
        || run.engine.bonus != Some(config.rules.guardian.bonus)
        || run.current_tier != config.rules.current_tier(run.pressure_score)
    {
        return Err(BoundaryError::InvalidEncoding);
    }
    Ok((config, run))
}

fn decode_rules(reader: &mut Reader<'_>) -> Result<RunRules, BoundaryError> {
    let max_moves = reader.u16()?;
    let guardian = Guardian {
        bonus: decode_bonus(reader.u8()?)?.ok_or(BoundaryError::InvalidEncoding)?,
        trigger: reader.u8()?,
        threshold: reader.u16()?,
    };
    let starting_height = reader.u8()?;
    let tier = match (reader.u8()?, reader.u8()?) {
        (0, value @ 0..=7) => TierPolicy::Fixed(value),
        (1, 0) => TierPolicy::Pressure,
        _ => return Err(BoundaryError::InvalidEncoding),
    };
    let stars = match reader.u8()? {
        0 => {
            if reader.array::<10>()? != [0; 10] {
                return Err(BoundaryError::InvalidEncoding);
            }
            None
        }
        1 => Some(StarRules {
            points_required: reader.u32()?,
            primary: decode_constraint(reader)?,
            secondary: decode_constraint(reader)?,
        }),
        _ => return Err(BoundaryError::InvalidEncoding),
    };
    let objective = match reader.u8()? {
        0 => {
            if reader.array::<2>()? != [0; 2] {
                return Err(BoundaryError::InvalidEncoding);
            }
            None
        }
        1 => Some(DailyTheme {
            kind: ConstraintKind::from_tag(reader.u8()?).ok_or(BoundaryError::InvalidEncoding)?,
            value: reader.u8()?,
        }),
        _ => return Err(BoundaryError::InvalidEncoding),
    };
    Ok(RunRules {
        guardian,
        starting_height,
        max_moves,
        tier,
        stars,
        objective,
    })
}

fn decode_constraint(reader: &mut Reader<'_>) -> Result<Constraint, BoundaryError> {
    constraint_from_parts(reader.u8()?, reader.u8()?, reader.u8()?)
}

fn constraint_from_parts(
    kind: u8,
    value: u8,
    required_count: u8,
) -> Result<Constraint, BoundaryError> {
    Ok(Constraint {
        kind: ConstraintKind::from_tag(kind).ok_or(BoundaryError::InvalidEncoding)?,
        value,
        required_count,
    })
}

pub(crate) const fn phase_tag(phase: RunPhase) -> u8 {
    match phase {
        RunPhase::Playing => 1,
        RunPhase::AwaitingVrf => 2,
        RunPhase::LevelComplete => 3,
        RunPhase::Finished => 4,
    }
}

fn decode_phase(tag: u8) -> Result<RunPhase, BoundaryError> {
    match tag {
        1 => Ok(RunPhase::Playing),
        2 => Ok(RunPhase::AwaitingVrf),
        3 => Ok(RunPhase::LevelComplete),
        4 => Ok(RunPhase::Finished),
        _ => Err(BoundaryError::InvalidEncoding),
    }
}

pub(crate) const fn bonus_tag(bonus: Option<Bonus>) -> u8 {
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

pub(crate) const fn end_reason_tag(reason: RunEndReason) -> u8 {
    match reason {
        RunEndReason::Completed => 1,
        RunEndReason::Exhausted => 2,
        RunEndReason::Abandoned => 3,
        RunEndReason::Deadline => 4,
    }
}

fn decode_end_reason(tag: u8) -> Result<Option<RunEndReason>, BoundaryError> {
    match tag {
        0 => Ok(None),
        1 => Ok(Some(RunEndReason::Completed)),
        2 => Ok(Some(RunEndReason::Exhausted)),
        3 => Ok(Some(RunEndReason::Abandoned)),
        4 => Ok(Some(RunEndReason::Deadline)),
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

const _: () = assert!(RUN_CONFIG_LEN == 65 + CANONICAL_RUN_RULES_LEN);

#[cfg(test)]
mod tests {
    use super::*;

    fn campaign_config() -> RunConfig {
        let rules = RunRules {
            guardian: Guardian {
                bonus: Bonus::Wave,
                ..Guardian::default()
            },
            starting_height: 4,
            max_moves: 24,
            tier: TierPolicy::Fixed(2),
            stars: Some(StarRules {
                points_required: 4_000,
                primary: Constraint {
                    kind: ConstraintKind::CombosOfAtLeast,
                    value: 3,
                    required_count: 2,
                },
                secondary: Constraint {
                    kind: ConstraintKind::BigMove,
                    value: 12,
                    required_count: 1,
                },
            }),
            objective: None,
        };
        RunConfig {
            rules_hash: RulesHash([7; 32]),
            rules,
            initial_replay: ReplayCommitment([9; 32]),
        }
    }

    #[test]
    fn shared_run_config_and_state_codecs_round_trip_both_rule_shapes() {
        let campaign = campaign_config();
        let config_bytes = encode_run_config(campaign);
        assert_eq!(decode_run_config(&config_bytes), Ok(campaign));
        let state = initialize_run(&config_bytes).unwrap();
        assert_eq!(state.len(), RUN_STATE_LEN);
        assert_eq!(
            decode_run_state(&state).unwrap(),
            Run::new(campaign).unwrap()
        );

        let mut daily = campaign;
        daily.rules.tier = TierPolicy::Pressure;
        daily.rules.stars = None;
        daily.rules.objective = Some(zkube_core::DAILY_THEMES[1]);
        let daily_bytes = encode_run_config(daily);
        assert_eq!(decode_run_config(&daily_bytes), Ok(daily));
        assert_eq!(
            decode_run_state(&initialize_run(&daily_bytes).unwrap()).unwrap(),
            Run::new(daily).unwrap()
        );
    }

    #[test]
    fn shared_boundary_rejects_cross_config_and_corruption() {
        let config = campaign_config();
        let config_bytes = encode_run_config(config);
        let state = initialize_run(&config_bytes).unwrap();
        let mut other = config;
        other.rules_hash = RulesHash([8; 32]);
        assert_eq!(
            run_request_reroll(&encode_run_config(other), &state, 0),
            Err(BoundaryError::InvalidEncoding)
        );
        let mut corrupt = state;
        corrupt[0] = 2;
        assert_eq!(
            decode_run_state(&corrupt),
            Err(BoundaryError::InvalidEncoding)
        );
    }
}
