//! Safe byte contracts used by the native ABI and generated managed bindings.
//! These are client transport formats, never account or replay encodings.

use crate::run::{bonus_tag, end_reason_tag, phase_tag};
use crate::{
    BoundaryError, RUN_CONFIG_LEN, RUN_STATE_LEN, array_32, board_width, build_run_config,
    daily_board_pools, daily_pair_index, decode_run_state, empty_continuation_rows,
    encode_board_pools, encode_board_width, encode_run_state, initial_replay_commitment,
    initialize_run, ladder_points, ladder_tier, ladder_tier_floor, payout_for_rank,
    qualified_player_id, reconcile_run_state,
};
use zkube_core::{PresentationEvent, PresentationObserver, Run, RunEndReason, SoftwareSha256};

pub const ABI_VERSION: u16 = 1;
pub const TRACE_VERSION: u16 = 1;
pub const MAX_REQUEST_BYTES: usize = 4096;
// An action can only move the board's cells downward plus one insertion.
// 80 cells * 10 rows bounds individual falls; each movement record is 9 bytes.
// This allocation envelope also covers clears, previews, replacement and state.
pub const RESPONSE_CAPACITY: usize = 16 * 1024;
pub const PHASE_TAGS: &[(u8, &str)] = &[
    (phase_tag(zkube_core::RunPhase::Playing), "Playing"),
    (phase_tag(zkube_core::RunPhase::AwaitingVrf), "AwaitingVrf"),
    (
        phase_tag(zkube_core::RunPhase::LevelComplete),
        "LevelComplete",
    ),
    (phase_tag(zkube_core::RunPhase::Finished), "Finished"),
];

#[derive(Clone, Copy, Debug)]
pub enum FieldType {
    U8,
    U16,
    U32,
    U64,
    Bytes(usize),
}

impl FieldType {
    #[must_use]
    pub const fn byte_len(self) -> usize {
        match self {
            Self::U8 => 1,
            Self::U16 => 2,
            Self::U32 => 4,
            Self::U64 => 8,
            Self::Bytes(n) => n,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Field {
    pub name: &'static str,
    pub kind: FieldType,
}

macro_rules! fields {
    ($($name:ident: $kind:expr),* $(,)?) => { &[$(Field { name: stringify!($name), kind: $kind }),*] };
}
use FieldType::{Bytes, U8, U16, U32, U64};

pub const CONFIG_FIELDS: &[Field] = fields![
    RulesHash: Bytes(32), InitialReplay: Bytes(32), MaxMoves: U16,
    BonusType: U8, Trigger: U8, TriggerThreshold: U16, StartingHeight: U8,
    TierPolicy: U8, FixedTier: U8, PointsRequired: U32,
    PrimaryKind: U8, PrimaryValue: U8, PrimaryCount: U8,
    SecondaryKind: U8, SecondaryValue: U8, SecondaryCount: U8,
    ObjectiveKind: U8, ObjectiveValue: U8,
];

pub const SNAPSHOT_FIELDS: &[Field] = fields![
    Config: Bytes(RUN_CONFIG_LEN), Phase: U8, EndReason: U8, BonusType: U8,
    BonusCharges: U8, RerollCharges: U8, ComboCounter: U8, MaxCombo: U8,
    PrimaryProgress: U8, SecondaryProgress: U8, LatchedStarSources: U8,
    Streak: U8, ChargesEarned: U8, CurrentTier: U8, LevelLinesCleared: U16,
    Moves: U16, ActionCounter: U32, VrfRequestCounter: U32, PendingVrfCounter: U32,
    Score: U32, DailyScore: U32, ObjectiveTotal: U64, PressureScore: U32,
    Grid: Bytes(80), HasNextRow: U8, NextRow: Bytes(8), ReplayHash: Bytes(32),
];

pub const SUMMARY_FIELDS: &[Field] = fields![
    Phase: U8, EndReason: U8, ScoreEligible: U8, BonusType: U8, BonusCharges: U8,
    RerollCharges: U8, ComboCounter: U8, MaxCombo: U8, PrimaryProgress: U8,
    SecondaryProgress: U8, LatchedStarSources: U8, Streak: U8, ChargesEarned: U8,
    CurrentTier: U8, LevelLinesCleared: U16, Moves: U16, ActionCounter: U32,
    LastVrfCounter: U32, Score: U32, DailyScore: U32, ObjectiveTotal: U64,
    PressureScore: U32, Grid: Bytes(80), HasNextRow: U8, NextRow: Bytes(8),
    ReplayHash: Bytes(32), RulesHash: Bytes(32),
];

#[derive(Clone, Copy)]
pub struct Operation {
    pub id: u32,
    pub name: &'static str,
    pub fields: &'static [Field],
}

pub const OPERATIONS: &[Operation] = &[
    Operation {
        id: 1,
        name: "BuildConfig",
        fields: CONFIG_FIELDS,
    },
    Operation {
        id: 2,
        name: "Reconcile",
        fields: SNAPSHOT_FIELDS,
    },
    Operation {
        id: 3,
        name: "Initialize",
        fields: fields![Config: Bytes(RUN_CONFIG_LEN)],
    },
    Operation {
        id: 4,
        name: "ApplyVrf",
        fields: fields![Config: Bytes(RUN_CONFIG_LEN), State: Bytes(RUN_STATE_LEN), Trace: U8, Counter: U32, Output: Bytes(32)],
    },
    Operation {
        id: 5,
        name: "PlayMove",
        fields: fields![Config: Bytes(RUN_CONFIG_LEN), State: Bytes(RUN_STATE_LEN), Trace: U8, Action: U32, ExpectedMove: U16, Row: U8, Start: U8, Destination: U8],
    },
    Operation {
        id: 6,
        name: "ApplyBonus",
        fields: fields![Config: Bytes(RUN_CONFIG_LEN), State: Bytes(RUN_STATE_LEN), Trace: U8, Action: U32, Row: U8, Column: U8],
    },
    Operation {
        id: 7,
        name: "RequestReroll",
        fields: fields![Config: Bytes(RUN_CONFIG_LEN), State: Bytes(RUN_STATE_LEN), Trace: U8, Action: U32],
    },
    Operation {
        id: 8,
        name: "Finish",
        fields: fields![Config: Bytes(RUN_CONFIG_LEN), State: Bytes(RUN_STATE_LEN), Trace: U8, Reason: U8],
    },
    Operation {
        id: 9,
        name: "Summary",
        fields: fields![State: Bytes(RUN_STATE_LEN)],
    },
    Operation {
        id: 10,
        name: "PlayerId",
        fields: fields![ChainDomain: Bytes(32), Account: Bytes(32)],
    },
    Operation {
        id: 11,
        name: "InitialReplay",
        fields: fields![ChainDomain: Bytes(32), Challenge: Bytes(32), RulesHash: Bytes(32), Account: Bytes(32), RunId: U64, Mode: U8],
    },
    Operation {
        id: 12,
        name: "DailyPairIndex",
        fields: fields![Day: U32],
    },
    Operation {
        id: 13,
        name: "CampaignMoveBudget",
        fields: fields![Level: U8, Tier: U8],
    },
    Operation {
        id: 14,
        name: "LadderPoints",
        fields: fields![Qualified: U32, Rank: U32],
    },
    Operation {
        id: 15,
        name: "LadderTier",
        fields: fields![Points: U64],
    },
    Operation {
        id: 16,
        name: "LadderTierFloor",
        fields: fields![Tier: U8],
    },
    Operation {
        id: 17,
        name: "DailyBoardPools",
        fields: fields![Pool: U64, ThemeQualified: U32],
    },
    Operation {
        id: 18,
        name: "BoardWidth",
        fields: fields![Pool: U64, Qualified: U32],
    },
    Operation {
        id: 19,
        name: "PayoutForRank",
        fields: fields![Pool: U64, Denominator: Bytes(16), Rank: U32],
    },
    Operation {
        id: 20,
        name: "EmptyContinuation",
        fields: fields![Counter: U32, Output: Bytes(32), RulesHash: Bytes(32), Weights: Bytes(10)],
    },
];

/// One registry drives safe Rust indexing and generated managed layout.
///
/// # Panics
/// A programmer-supplied name absent from the schema is a code defect.
#[must_use]
pub fn field_range(fields: &[Field], name: &str) -> std::ops::Range<usize> {
    let mut offset = 0;
    for field in fields {
        let end = offset + field.kind.byte_len();
        if field.name == name {
            return offset..end;
        }
        offset = end;
    }
    panic!("unknown native schema field: {name}");
}

#[must_use]
pub fn fields_len(fields: &[Field]) -> usize {
    fields.iter().map(|f| f.kind.byte_len()).sum()
}

pub const STATUSES: &[(i32, &str)] = &[
    (0, "Success"),
    (1, "InvalidPointer"),
    (2, "InvalidLength"),
    (3, "UnsupportedVersion"),
    (4, "UnknownOperation"),
    (5, "OutputTooSmall"),
    (6, "InvalidEncoding"),
    (7, "Panic"),
    (100, "InvalidRules"),
    (101, "InvalidActionOrder"),
    (102, "InvalidVrfOrder"),
    (103, "InvalidPhase"),
    (104, "Overflow"),
    (110, "MoveLimitReached"),
    (111, "MissingNextRow"),
    (112, "RowAlreadyAvailable"),
    (113, "InvalidExpectedMove"),
    (114, "NoBonusCharge"),
    (115, "NoRerollAvailable"),
    (116, "RerollRequiresVrf"),
    (120, "InvalidRow"),
    (121, "InvalidColumn"),
    (122, "EmptySelection"),
    (123, "SelectionInsideBlock"),
    (124, "InvalidBlock"),
    (125, "DestinationOccupied"),
    (126, "IncoherentRow"),
    (127, "CapacityExceeded"),
    (200, "ZeroTotalWeight"),
    (201, "NoEmptyWeight"),
    (202, "NoBlockWeight"),
    (203, "InvalidOpeningHeight"),
    (204, "InvalidGeneratedRow"),
    (300, "InvalidLadderRank"),
    (310, "InvalidWholeUnit"),
    (311, "InvalidWinnerCount"),
    (312, "ZeroWeight"),
    (313, "InvalidEntryPrice"),
    (314, "InvalidRank"),
];

#[must_use]
pub fn error_status(error: BoundaryError) -> i32 {
    use zkube_core::{
        GridError as G, PayoutError as P, RandomnessError as R, RunError as E,
        RunTransitionError as T,
    };
    fn random(error: R) -> i32 {
        match error {
            R::ZeroTotalWeight => 200,
            R::NoEmptyWeight => 201,
            R::NoBlockWeight => 202,
            R::InvalidOpeningHeight => 203,
            R::InvalidGeneratedRow(_) => 204,
        }
    }
    match error {
        BoundaryError::InvalidLength => 2,
        BoundaryError::InvalidEncoding | BoundaryError::InvalidMode => 6,
        BoundaryError::Randomness(e) => random(e),
        BoundaryError::Ladder(_) => 300,
        BoundaryError::Payout(e) => match e {
            P::InvalidWholeUnit => 310,
            P::InvalidWinnerCount => 311,
            P::ZeroWeight => 312,
            P::InvalidEntryPrice => 313,
            P::InvalidRank => 314,
            P::Overflow => 104,
        },
        BoundaryError::Run(e) => match e {
            T::InvalidRules => 100,
            T::InvalidActionOrder => 101,
            T::InvalidVrfOrder => 102,
            T::InvalidPhase => 103,
            T::Overflow => 104,
            T::Randomness(e) => random(e),
            T::Engine(e) => match e {
                E::InvalidPhase => 103,
                E::MoveLimitReached => 110,
                E::MissingNextRow => 111,
                E::RowAlreadyAvailable => 112,
                E::InvalidExpectedMove => 113,
                E::NoBonusCharge => 114,
                E::NoRerollAvailable => 115,
                E::RerollRequiresVrf => 116,
                E::Grid(e) => match e {
                    G::InvalidRow => 120,
                    G::InvalidColumn => 121,
                    G::EmptySelection => 122,
                    G::SelectionInsideBlock => 123,
                    G::InvalidBlock => 124,
                    G::DestinationOccupied => 125,
                    G::IncoherentRow => 126,
                    G::CapacityExceeded => 127,
                },
            },
        },
    }
}

struct Input<'a> {
    bytes: &'a [u8],
    fields: &'static [Field],
}
impl Input<'_> {
    fn bytes(&self, name: &str) -> &[u8] {
        &self.bytes[field_range(self.fields, name)]
    }
    fn u8(&self, name: &str) -> u8 {
        self.bytes(name)[0]
    }
    fn u16(&self, name: &str) -> u16 {
        u16::from_le_bytes(self.bytes(name).try_into().expect("schema u16"))
    }
    fn u32(&self, name: &str) -> u32 {
        u32::from_le_bytes(self.bytes(name).try_into().expect("schema u32"))
    }
    fn u64(&self, name: &str) -> u64 {
        u64::from_le_bytes(self.bytes(name).try_into().expect("schema u64"))
    }
    fn boolean(&self, name: &str) -> Result<bool, BoundaryError> {
        match self.u8(name) {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(BoundaryError::InvalidEncoding),
        }
    }
}

/// Execute a validated finite operation without exposing native pointers.
/// Output is unpublished until the complete operation succeeds.
///
/// # Errors
/// Returns the ABI status for malformed requests or rejected core operations.
pub fn dispatch(operation: u32, request: &[u8]) -> Result<Vec<u8>, i32> {
    if request.len() < 2 || request.len() > MAX_REQUEST_BYTES {
        return Err(2);
    }
    if u16::from_le_bytes([request[0], request[1]]) != ABI_VERSION {
        return Err(3);
    }
    let spec = OPERATIONS.iter().find(|op| op.id == operation).ok_or(4)?;
    if request.len() != 2 + fields_len(spec.fields) {
        return Err(2);
    }
    let output = execute(
        operation,
        &Input {
            bytes: &request[2..],
            fields: spec.fields,
        },
    )
    .map_err(error_status)?;
    if output.len() > RESPONSE_CAPACITY {
        return Err(104);
    }
    Ok(output)
}

#[allow(clippy::too_many_lines)]
fn execute(operation: u32, input: &Input<'_>) -> Result<Vec<u8>, BoundaryError> {
    let b = |name| input.bytes(name);
    let n = |name| input.u8(name);
    let u = |name| input.u32(name);
    match operation {
        1 => build_run_config(
            b("RulesHash"),
            b("InitialReplay"),
            input.u16("MaxMoves"),
            n("BonusType"),
            n("Trigger"),
            input.u16("TriggerThreshold"),
            n("StartingHeight"),
            n("TierPolicy"),
            n("FixedTier"),
            u("PointsRequired"),
            n("PrimaryKind"),
            n("PrimaryValue"),
            n("PrimaryCount"),
            n("SecondaryKind"),
            n("SecondaryValue"),
            n("SecondaryCount"),
            n("ObjectiveKind"),
            n("ObjectiveValue"),
        ),
        2 => {
            let preview = if input.boolean("HasNextRow")? {
                b("NextRow")
            } else {
                if b("NextRow") != [0; 8] {
                    return Err(BoundaryError::InvalidEncoding);
                }
                &[]
            };
            reconcile_run_state(
                b("Config"),
                n("Phase"),
                n("EndReason"),
                n("BonusType"),
                n("BonusCharges"),
                n("RerollCharges"),
                n("ComboCounter"),
                n("MaxCombo"),
                n("PrimaryProgress"),
                n("SecondaryProgress"),
                n("LatchedStarSources"),
                n("Streak"),
                n("ChargesEarned"),
                n("CurrentTier"),
                input.u16("LevelLinesCleared"),
                input.u16("Moves"),
                u("ActionCounter"),
                u("VrfRequestCounter"),
                u("PendingVrfCounter"),
                u("Score"),
                u("DailyScore"),
                input.u64("ObjectiveTotal"),
                u("PressureScore"),
                b("Grid"),
                preview,
                b("ReplayHash"),
            )
        }
        3 => initialize_run(b("Config")),
        4..=8 => transition(operation, input),
        9 => Ok(encode_summary(decode_run_state(b("State"))?)),
        10 => qualified_player_id(b("ChainDomain"), b("Account")).map(|v| v.to_vec()),
        11 => initial_replay_commitment(
            b("ChainDomain"),
            b("Challenge"),
            b("RulesHash"),
            b("Account"),
            input.u64("RunId"),
            n("Mode"),
        )
        .map(|v| v.to_vec()),
        12 => Ok(daily_pair_index(u("Day")).to_le_bytes().to_vec()),
        13 => zkube_core::campaign_move_budget(n("Level"), n("Tier"))
            .map(|v| v.to_le_bytes().to_vec())
            .ok_or(BoundaryError::InvalidEncoding),
        14 => ladder_points(u("Qualified"), u("Rank")).map(|v| v.to_le_bytes().to_vec()),
        15 => Ok(vec![ladder_tier(input.u64("Points"))]),
        16 => Ok(ladder_tier_floor(n("Tier")).to_le_bytes().to_vec()),
        17 => Ok(encode_board_pools(daily_board_pools(
            input.u64("Pool"),
            u("ThemeQualified"),
        ))),
        18 => board_width(
            input.u64("Pool"),
            u("Qualified"),
            zkube_core::ARENA_ENTRY_LAMPORTS,
            zkube_core::SOL_PAYOUT_UNIT_LAMPORTS,
        )
        .map(encode_board_width),
        19 => payout_for_rank(
            input.u64("Pool"),
            u128::from_le_bytes(b("Denominator").try_into().expect("schema u128")),
            u("Rank"),
            zkube_core::SOL_PAYOUT_UNIT_LAMPORTS,
        )
        .map(|v| v.to_le_bytes().to_vec()),
        20 => {
            let weights: Vec<u16> = b("Weights")
                .chunks_exact(2)
                .map(|s| u16::from_le_bytes([s[0], s[1]]))
                .collect();
            empty_continuation_rows(u("Counter"), b("Output"), b("RulesHash"), &weights)
                .map(|v| v.to_vec())
        }
        _ => unreachable!("operation registry exhaustively checked"),
    }
}

fn transition(operation: u32, input: &Input<'_>) -> Result<Vec<u8>, BoundaryError> {
    let (config, mut run) =
        crate::run::decode_for_transition(input.bytes("Config"), input.bytes("State"))?;
    let mut trace = Trace {
        enabled: input.boolean("Trace")?,
        events: Vec::new(),
    };
    match operation {
        4 => run.apply_vrf_observed(
            config.rules,
            input.u32("Counter"),
            array_32(input.bytes("Output"))?,
            &mut trace,
        )?,
        5 => {
            run.play_move_observed_with::<SoftwareSha256, _>(
                config.rules,
                input.u32("Action"),
                input.u16("ExpectedMove"),
                input.u8("Row"),
                input.u8("Start"),
                input.u8("Destination"),
                &mut trace,
            )?;
        }
        6 => {
            run.apply_bonus_observed_with::<SoftwareSha256, _>(
                config.rules,
                input.u32("Action"),
                input.u8("Row"),
                input.u8("Column"),
                &mut trace,
            )?;
        }
        7 => run.request_reroll(config.rules, input.u32("Action"))?,
        8 => {
            let reason = match input.u8("Reason") {
                3 => RunEndReason::Abandoned,
                4 => RunEndReason::Deadline,
                _ => return Err(BoundaryError::InvalidEncoding),
            };
            run.finish_observed(config.rules, reason, &mut trace)?;
        }
        _ => unreachable!(),
    }
    let trace_bytes = if trace.enabled {
        encode_trace(&trace.events)
    } else {
        Vec::new()
    };
    let mut response = Vec::with_capacity(10 + RUN_STATE_LEN + trace_bytes.len());
    response.extend_from_slice(&ABI_VERSION.to_le_bytes());
    response.extend_from_slice(
        &u32::try_from(RUN_STATE_LEN)
            .expect("state size")
            .to_le_bytes(),
    );
    response.extend_from_slice(
        &u32::try_from(trace_bytes.len())
            .expect("bounded board trace")
            .to_le_bytes(),
    );
    response.extend_from_slice(&encode_run_state(run));
    response.extend_from_slice(&trace_bytes);
    Ok(response)
}

struct Trace {
    enabled: bool,
    events: Vec<PresentationEvent>,
}
impl PresentationObserver for Trace {
    fn observe(&mut self, event: PresentationEvent) {
        if self.enabled {
            self.events.push(event);
        }
    }
}

pub const TRACE_EVENTS: &[(u8, &str, usize)] = &[
    (1, "BlockMoved", 6),
    (2, "RowsCleared", 2),
    (3, "RowInserted", 8),
    (4, "BonusApplied", 11),
    (5, "BoardReplaced", 80),
    (6, "PreviewChanged", 9),
    (7, "Terminal", 1),
    (8, "PerfectClear", 1),
];

fn encode_trace(events: &[PresentationEvent]) -> Vec<u8> {
    let mut output = Vec::new();
    output.extend_from_slice(&TRACE_VERSION.to_le_bytes());
    output.extend_from_slice(
        &u32::try_from(events.len())
            .expect("bounded board trace")
            .to_le_bytes(),
    );
    for event in events {
        let (tag, payload) = match *event {
            PresentationEvent::BlockMoved {
                gravity,
                from_row,
                from_column,
                to_row,
                to_column,
                width,
            } => (
                1,
                vec![
                    u8::from(gravity),
                    from_row,
                    from_column,
                    to_row,
                    to_column,
                    width,
                ],
            ),
            PresentationEvent::RowsCleared { rows } => (2, rows.to_le_bytes().to_vec()),
            PresentationEvent::RowInserted { row } => (3, row.to_vec()),
            PresentationEvent::BonusApplied { bonus, removed } => {
                let mut v = vec![bonus_tag(Some(bonus))];
                v.extend_from_slice(&removed);
                (4, v)
            }
            PresentationEvent::BoardReplaced { cells } => (5, cells.to_vec()),
            PresentationEvent::PreviewChanged { row } => {
                let mut v = vec![u8::from(row.is_some())];
                v.extend_from_slice(&row.unwrap_or([0; 8]));
                (6, v)
            }
            PresentationEvent::Terminal { reason } => (7, vec![reason_tag(Some(reason))]),
            PresentationEvent::PerfectClear { reroll_granted } => {
                (8, vec![u8::from(reroll_granted)])
            }
        };
        debug_assert_eq!(
            TRACE_EVENTS.iter().find(|e| e.0 == tag).unwrap().2,
            payload.len()
        );
        output.push(tag);
        output.extend_from_slice(
            &u16::try_from(payload.len())
                .expect("small trace event")
                .to_le_bytes(),
        );
        output.extend_from_slice(&payload);
    }
    output
}

fn reason_tag(reason: Option<RunEndReason>) -> u8 {
    reason.map_or(0, end_reason_tag)
}

/// Render a validated token with the one generated field layout. Managed code
/// never indexes the opaque run token itself.
#[must_use]
pub fn encode_summary(run: Run) -> Vec<u8> {
    let mut bytes = vec![0; fields_len(SUMMARY_FIELDS)];
    let mut put =
        |name: &str, value: &[u8]| bytes[field_range(SUMMARY_FIELDS, name)].copy_from_slice(value);
    macro_rules! scalar {
        ($name:literal, $v:expr) => {
            put($name, &$v.to_le_bytes())
        };
    }
    scalar!("Phase", phase_tag(run.engine.phase));
    scalar!("EndReason", reason_tag(run.end_reason));
    scalar!("ScoreEligible", u8::from(run.is_score_eligible()));
    scalar!("BonusType", bonus_tag(run.engine.bonus));
    scalar!("BonusCharges", run.engine.bonus_charges);
    scalar!("RerollCharges", run.engine.reroll_charges);
    scalar!("ComboCounter", run.engine.combo_counter);
    scalar!("MaxCombo", run.engine.max_combo);
    scalar!("PrimaryProgress", run.engine.primary_progress);
    scalar!("SecondaryProgress", run.engine.secondary_progress);
    scalar!("LatchedStarSources", run.engine.latched_star_sources);
    scalar!("Streak", run.engine.streak);
    scalar!("ChargesEarned", run.engine.charges_earned);
    scalar!("CurrentTier", run.current_tier);
    scalar!("LevelLinesCleared", run.engine.level_lines_cleared);
    scalar!("Moves", run.engine.moves);
    scalar!("ActionCounter", run.action_counter);
    scalar!("LastVrfCounter", run.last_vrf_counter);
    scalar!("Score", run.engine.score);
    scalar!("DailyScore", run.daily_score);
    scalar!("ObjectiveTotal", run.objective_total);
    scalar!("PressureScore", run.pressure_score);
    scalar!("HasNextRow", u8::from(run.engine.next_row.is_some()));
    put("Grid", run.engine.grid.cells());
    put("NextRow", &run.engine.next_row.unwrap_or([0; 8]));
    put("ReplayHash", run.replay.as_bytes());
    put("RulesHash", run.rules_hash.as_bytes());
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_schema_is_bounded_unique_and_rejects_all_wrong_lengths() {
        let mut ids = std::collections::HashSet::new();
        for operation in OPERATIONS {
            assert!(ids.insert(operation.id));
            let mut names = std::collections::HashSet::new();
            for field in operation.fields {
                assert!(names.insert(field.name));
            }
            let length = 2 + fields_len(operation.fields);
            assert!(length <= MAX_REQUEST_BYTES);
            let mut request = vec![0; length];
            request[..2].copy_from_slice(&ABI_VERSION.to_le_bytes());
            assert_eq!(dispatch(operation.id, &request[..length - 1]), Err(2));
            request.push(0);
            assert_eq!(dispatch(operation.id, &request), Err(2));
        }
        assert_eq!(dispatch(u32::MAX, &ABI_VERSION.to_le_bytes()), Err(4));
        let status_ids: std::collections::HashSet<_> = STATUSES.iter().map(|v| v.0).collect();
        assert_eq!(status_ids.len(), STATUSES.len());
    }
}
