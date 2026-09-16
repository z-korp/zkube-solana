//! Safe byte contracts used by the native ABI and generated managed bindings.
//! These are client transport formats, never account or replay encodings.

use crate::run::{bonus_tag, end_reason_tag, phase_tag};
use crate::{
    BoundaryError, RUN_CONFIG_LEN, RUN_STATE_LEN, array_32, board_width, build_run_config,
    daily_board_pools, decode_run_state, empty_continuation_rows, encode_board_pools,
    encode_board_width, encode_run_state, initial_replay_commitment, initialize_run, ladder_points,
    ladder_tier, ladder_tier_floor, payout_for_rank, qualified_player_id, reconcile_run_state,
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

pub const DAILY_PAIR_FIELDS: &[Field] = fields![Index: U32, Realm: U8, Kind: U8, Value: U8];
pub const DAILY_WINDOW_FIELDS: &[Field] =
    fields![OpensAt: U64, FreezesAt: U64, RecoveryDeadlineAt: U64];
pub const CAMPAIGN_PROGRESS_FIELDS: &[Field] = fields![
    Stars: Bytes(zkube_core::CAMPAIGN_TOTAL_LEVELS), Total: U16,
    LevelUnlocked: Bytes(zkube_core::CAMPAIGN_TOTAL_LEVELS),
    RealmUnlocked: Bytes(zkube_core::CAMPAIGN_MAP_COUNT),
    Cleared: Bytes(zkube_core::CAMPAIGN_MAP_COUNT), Perfected: Bytes(zkube_core::CAMPAIGN_MAP_COUNT),
    EmblemUnlocked: Bytes(zkube_core::CAMPAIGN_EMBLEM_COUNT),
    EmblemGold: Bytes(zkube_core::CAMPAIGN_EMBLEM_COUNT), StrongestEmblem: U8,
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
    Operation {
        id: 22,
        name: "LocalRowRandomness",
        fields: fields![Seed: Bytes(32), SeedLength: U8, Counter: U32],
    },
    Operation {
        id: 21,
        name: "MergeCampaignStars",
        fields: fields![Stored: Bytes(zkube_core::CAMPAIGN_STAR_BYTES), Incoming: Bytes(zkube_core::CAMPAIGN_STAR_BYTES)],
    },
    Operation {
        id: 23,
        name: "PackCampaignStars",
        fields: fields![Stars: Bytes(zkube_core::CAMPAIGN_TOTAL_LEVELS)],
    },
    Operation {
        id: 24,
        name: "CampaignProgress",
        fields: fields![Stars: Bytes(zkube_core::CAMPAIGN_STAR_BYTES)],
    },
    Operation {
        id: 25,
        name: "CampaignRules",
        fields: fields![Realm: U8, Level: U8, Tier: U8, Primary: Bytes(3), Secondary: Bytes(3)],
    },
    Operation {
        id: 26,
        name: "RecordLocalCampaignResult",
        fields: fields![Stars: Bytes(zkube_core::CAMPAIGN_STAR_BYTES), Realm: U8, Level: U8, State: Bytes(RUN_STATE_LEN)],
    },
    Operation {
        id: 27,
        name: "DailyWindow",
        fields: fields![Day: U32],
    },
    Operation {
        id: 28,
        name: "BoardOrder",
        fields: fields![LeftMetric: U64, LeftTime: Bytes(8), LeftOwner: Bytes(32), RightMetric: U64, RightTime: Bytes(8), RightOwner: Bytes(32)],
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
        12 => {
            let index = zkube_core::daily_pair_index(u("Day"));
            let (realm, theme) = zkube_core::decode_daily_pair(index).expect("draw index");
            let mut bytes = u32::try_from(index)
                .expect("pair index")
                .to_le_bytes()
                .to_vec();
            bytes.extend_from_slice(&[realm, theme.kind.tag(), theme.value]);
            Ok(bytes)
        }
        23 => {
            zkube_core::CampaignStars::from_unpacked(b("Stars").try_into().expect("schema stars"))
                .map(|stars| stars.packed().to_vec())
                .map_err(|_| BoundaryError::InvalidEncoding)
        }
        24 => Ok(encode_campaign_progress(
            zkube_core::CampaignStars::from_packed(b("Stars").try_into().expect("schema stars")),
        )),
        25 => {
            let realm = n("Realm")
                .checked_sub(1)
                .and_then(|i| zkube_core::REALM_RULES.get(usize::from(i)))
                .ok_or(BoundaryError::InvalidEncoding)?;
            let constraint = |name| -> Result<zkube_core::Constraint, BoundaryError> {
                let value = b(name);
                Ok(zkube_core::Constraint {
                    kind: zkube_core::ConstraintKind::from_tag(value[0])
                        .ok_or(BoundaryError::InvalidEncoding)?,
                    value: value[1],
                    required_count: value[2],
                })
            };
            let rules = zkube_core::RunRules::campaign(
                *realm,
                n("Level"),
                n("Tier"),
                constraint("Primary")?,
                constraint("Secondary")?,
            )
            .ok_or(BoundaryError::InvalidEncoding)?;
            Ok(encode_config_request(zkube_core::RunConfig {
                rules,
                rules_hash: zkube_core::RulesHash([0; 32]),
                initial_replay: zkube_core::ReplayCommitment([0; 32]),
            }))
        }
        26 => {
            let run = decode_run_state(b("State"))?;
            if !matches!(
                run.engine.phase,
                zkube_core::RunPhase::Finished | zkube_core::RunPhase::LevelComplete
            ) {
                return Err(BoundaryError::InvalidEncoding);
            }
            let mut stars = zkube_core::CampaignStars::from_packed(
                b("Stars").try_into().expect("schema stars"),
            );
            stars
                .merge_level(n("Realm"), n("Level"), run.engine.latched_star_count())
                .map_err(|_| BoundaryError::InvalidEncoding)?;
            Ok(stars.packed().to_vec())
        }
        28 => {
            let order = zkube_core::compare_board_entries(
                input.u64("LeftMetric"),
                i64::from_le_bytes(b("LeftTime").try_into().expect("timestamp")),
                &array_32(b("LeftOwner"))?,
                input.u64("RightMetric"),
                i64::from_le_bytes(b("RightTime").try_into().expect("timestamp")),
                &array_32(b("RightOwner"))?,
            );
            Ok(vec![match order {
                std::cmp::Ordering::Less => 0,
                std::cmp::Ordering::Equal => 1,
                std::cmp::Ordering::Greater => 2,
            }])
        }
        27 => {
            let (opens, closes, recovery) = zkube_core::daily_window(u("Day"));
            Ok([
                opens.to_le_bytes(),
                closes.to_le_bytes(),
                recovery.to_le_bytes(),
            ]
            .concat())
        }
        21 => crate::merge_campaign_stars(b("Stored"), b("Incoming")),
        22 => {
            let seed = b("Seed")
                .get(..usize::from(n("SeedLength")))
                .ok_or(BoundaryError::InvalidEncoding)?;
            Ok(zkube_core::local_row_randomness(seed, u("Counter")).to_vec())
        }
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

/// Encode Campaign presentation facts from the core progression owner.
///
/// # Panics
/// Panics if the fixed catalog dimensions exceed the byte-sized realm or level IDs.
#[must_use]
pub fn encode_campaign_progress(stars: zkube_core::CampaignStars) -> Vec<u8> {
    let mut bytes = vec![0; fields_len(CAMPAIGN_PROGRESS_FIELDS)];
    let mut put = |name: &str, value: &[u8]| {
        bytes[field_range(CAMPAIGN_PROGRESS_FIELDS, name)].copy_from_slice(value);
    };
    put("Stars", &stars.unpacked());
    put("Total", &stars.total().to_le_bytes());
    let levels: [u8; zkube_core::CAMPAIGN_TOTAL_LEVELS] = core::array::from_fn(|i| {
        u8::from(stars.level_unlocked(
            u8::try_from(i / zkube_core::CAMPAIGN_LEVELS_PER_MAP + 1).unwrap(),
            u8::try_from(i % zkube_core::CAMPAIGN_LEVELS_PER_MAP + 1).unwrap(),
        ))
    });
    put("LevelUnlocked", &levels);
    for (name, query) in [
        (
            "RealmUnlocked",
            (|s: &zkube_core::CampaignStars, map| s.level_unlocked(map, 1))
                as fn(&zkube_core::CampaignStars, u8) -> bool,
        ),
        ("Cleared", zkube_core::CampaignStars::zone_cleared),
        ("Perfected", zkube_core::CampaignStars::zone_perfected),
    ] {
        let values: [u8; zkube_core::CAMPAIGN_MAP_COUNT] =
            core::array::from_fn(|i| u8::from(query(&stars, u8::try_from(i + 1).unwrap())));
        put(name, &values);
    }
    for (name, query) in [
        (
            "EmblemUnlocked",
            zkube_core::CampaignStars::emblem_unlocked
                as fn(&zkube_core::CampaignStars, u8) -> bool,
        ),
        ("EmblemGold", zkube_core::CampaignStars::emblem_gold),
    ] {
        let values: [u8; zkube_core::CAMPAIGN_EMBLEM_COUNT] =
            core::array::from_fn(|i| u8::from(query(&stars, u8::try_from(i).unwrap())));
        put(name, &values);
    }
    put("StrongestEmblem", &[stars.strongest_emblem()]);
    bytes
}

/// Encode the generated config request, shared with fixture production.
#[must_use]
pub fn encode_config_request(config: zkube_core::RunConfig) -> Vec<u8> {
    let mut bytes = vec![0; 2 + fields_len(CONFIG_FIELDS)];
    bytes[..2].copy_from_slice(&ABI_VERSION.to_le_bytes());
    let mut put = |name: &str, value: &[u8]| {
        bytes[2 + field_range(CONFIG_FIELDS, name).start..2 + field_range(CONFIG_FIELDS, name).end]
            .copy_from_slice(value);
    };
    put("RulesHash", config.rules_hash.as_bytes());
    put("InitialReplay", config.initial_replay.as_bytes());
    put("MaxMoves", &config.rules.max_moves.to_le_bytes());
    put("BonusType", &[bonus_tag(Some(config.rules.guardian.bonus))]);
    put("Trigger", &[config.rules.guardian.trigger]);
    put(
        "TriggerThreshold",
        &config.rules.guardian.threshold.to_le_bytes(),
    );
    put("StartingHeight", &[config.rules.starting_height]);
    match config.rules.tier {
        zkube_core::TierPolicy::Fixed(tier) => put("FixedTier", &[tier]),
        zkube_core::TierPolicy::Pressure => put("TierPolicy", &[1]),
    }
    if let Some(stars) = config.rules.stars {
        put("PointsRequired", &stars.points_required.to_le_bytes());
        for (prefix, value) in [("Primary", stars.primary), ("Secondary", stars.secondary)] {
            put(&format!("{prefix}Kind"), &[value.kind.tag()]);
            put(&format!("{prefix}Value"), &[value.value]);
            put(&format!("{prefix}Count"), &[value.required_count]);
        }
    }
    if let Some(theme) = config.rules.objective {
        put("ObjectiveKind", &[theme.kind.tag()]);
        put("ObjectiveValue", &[theme.value]);
    }
    bytes
}

fn transition(operation: u32, input: &Input<'_>) -> Result<Vec<u8>, BoundaryError> {
    let (config, mut run) =
        crate::run::decode_for_transition(input.bytes("Config"), input.bytes("State"))?;
    let mut trace = Trace {
        enabled: input.boolean("Trace")?,
        events: Vec::new(),
    };
    match operation {
        4 => run.apply_vrf_observed_with::<zkube_core::SoftwareSha256, _>(
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
            run.finish_observed_with::<zkube_core::SoftwareSha256, _>(
                config.rules,
                reason,
                &mut trace,
            )?;
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
