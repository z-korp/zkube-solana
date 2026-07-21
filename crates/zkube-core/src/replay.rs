use crate::{Sha256Provider, SoftwareSha256};

const PLAYER_ID_DOMAIN: &[u8] = b"zkube-player-id-v1";
const REPLAY_INIT_DOMAIN: &[u8] = b"zkube-replay-v2:init";
const REPLAY_FOLD_DOMAIN: &[u8] = b"zkube-replay-v2:fold";

pub const VRF_EVENT_TAG: u8 = 1;
pub const MOVE_EVENT_TAG: u8 = 2;
pub const BONUS_EVENT_TAG: u8 = 3;
pub const PLAYER_ABANDON_EVENT_TAG: u8 = 4;
pub const DAILY_DEADLINE_EVENT_TAG: u8 = 5;
pub const MAX_CANONICAL_EVENT_LEN: usize = 37;

macro_rules! bytes32_newtype {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
        #[repr(transparent)]
        pub struct $name(pub [u8; 32]);

        impl $name {
            #[must_use]
            pub const fn new(bytes: [u8; 32]) -> Self {
                Self(bytes)
            }

            #[must_use]
            pub const fn to_bytes(self) -> [u8; 32] {
                self.0
            }

            #[must_use]
            pub const fn as_bytes(&self) -> &[u8; 32] {
                &self.0
            }
        }

        impl From<[u8; 32]> for $name {
            fn from(bytes: [u8; 32]) -> Self {
                Self(bytes)
            }
        }
    };
}

bytes32_newtype!(ChainDomain);
bytes32_newtype!(ChallengeId);
bytes32_newtype!(RulesHash);
bytes32_newtype!(PlayerId);
bytes32_newtype!(ReplayCommitment);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum ReplayMode {
    Ranked = 0,
    Practice = 1,
}

impl ReplayMode {
    #[must_use]
    pub const fn tag(self) -> u8 {
        self as u8
    }
}

/// One event in the canonical replay stream.
///
/// The action number is the pre-action counter expected by the state machine.
/// Binding it into player actions and terminal events makes omissions,
/// duplication, and reordering observable in the commitment.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReplayEvent {
    Vrf {
        request_counter: u32,
        output: [u8; 32],
    },
    Move {
        action: u32,
        expected_move: u16,
        row: u8,
        start: u8,
        destination: u8,
    },
    Bonus {
        action: u32,
        row: u8,
        column: u8,
    },
    PlayerAbandon {
        action: u32,
    },
    DailyDeadline {
        action: u32,
    },
}

/// A stack-backed canonical event encoding.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CanonicalEventBytes {
    bytes: [u8; MAX_CANONICAL_EVENT_LEN],
    len: u8,
}

impl CanonicalEventBytes {
    #[must_use]
    pub fn as_slice(&self) -> &[u8] {
        &self.bytes[..usize::from(self.len)]
    }

    #[must_use]
    pub const fn len(&self) -> usize {
        self.len as usize
    }

    #[must_use]
    pub const fn is_empty(&self) -> bool {
        self.len == 0
    }
}

impl ReplayEvent {
    /// Encode with stable one-byte tags and little-endian integers.
    #[must_use]
    pub fn canonical_bytes(self) -> CanonicalEventBytes {
        let mut bytes = [0u8; MAX_CANONICAL_EVENT_LEN];
        let len = match self {
            Self::Vrf {
                request_counter,
                output,
            } => {
                bytes[0] = VRF_EVENT_TAG;
                bytes[1..5].copy_from_slice(&request_counter.to_le_bytes());
                bytes[5..37].copy_from_slice(&output);
                37
            }
            Self::Move {
                action,
                expected_move,
                row,
                start,
                destination,
            } => {
                bytes[0] = MOVE_EVENT_TAG;
                bytes[1..5].copy_from_slice(&action.to_le_bytes());
                bytes[5..7].copy_from_slice(&expected_move.to_le_bytes());
                bytes[7] = row;
                bytes[8] = start;
                bytes[9] = destination;
                10
            }
            Self::Bonus {
                action,
                row,
                column,
            } => {
                bytes[0] = BONUS_EVENT_TAG;
                bytes[1..5].copy_from_slice(&action.to_le_bytes());
                bytes[5] = row;
                bytes[6] = column;
                7
            }
            Self::PlayerAbandon { action } => {
                bytes[0] = PLAYER_ABANDON_EVENT_TAG;
                bytes[1..5].copy_from_slice(&action.to_le_bytes());
                5
            }
            Self::DailyDeadline { action } => {
                bytes[0] = DAILY_DEADLINE_EVENT_TAG;
                bytes[1..5].copy_from_slice(&action.to_le_bytes());
                5
            }
        };
        CanonicalEventBytes { bytes, len }
    }
}

#[must_use]
pub fn derive_player_id(domain: ChainDomain, raw_account_bytes: [u8; 32]) -> PlayerId {
    derive_player_id_with::<SoftwareSha256>(domain, raw_account_bytes)
}

#[must_use]
pub fn derive_player_id_with<H: Sha256Provider>(
    domain: ChainDomain,
    raw_account_bytes: [u8; 32],
) -> PlayerId {
    PlayerId(H::hashv(&[
        PLAYER_ID_DOMAIN,
        domain.as_bytes(),
        &raw_account_bytes,
    ]))
}

impl ReplayCommitment {
    #[must_use]
    pub fn initial(
        domain: ChainDomain,
        challenge: ChallengeId,
        rules_hash: RulesHash,
        player_id: PlayerId,
        run_id: u64,
        mode: ReplayMode,
    ) -> Self {
        Self::initial_with::<SoftwareSha256>(domain, challenge, rules_hash, player_id, run_id, mode)
    }

    #[must_use]
    pub fn initial_with<H: Sha256Provider>(
        domain: ChainDomain,
        challenge: ChallengeId,
        rules_hash: RulesHash,
        player_id: PlayerId,
        run_id: u64,
        mode: ReplayMode,
    ) -> Self {
        Self(H::hashv(&[
            REPLAY_INIT_DOMAIN,
            domain.as_bytes(),
            challenge.as_bytes(),
            rules_hash.as_bytes(),
            player_id.as_bytes(),
            &run_id.to_le_bytes(),
            &[mode.tag()],
        ]))
    }

    #[must_use]
    pub fn fold(self, event: ReplayEvent) -> Self {
        self.fold_with::<SoftwareSha256>(event)
    }

    #[must_use]
    pub fn fold_with<H: Sha256Provider>(self, event: ReplayEvent) -> Self {
        let encoded = event.canonical_bytes();
        Self(H::hashv(&[
            REPLAY_FOLD_DOMAIN,
            self.as_bytes(),
            encoded.as_slice(),
        ]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use std::string::String;

    #[derive(Deserialize)]
    struct GoldenEvent {
        canonical_hex: String,
        commitment_hex: String,
    }

    #[derive(Deserialize)]
    struct GoldenReplay {
        version: u8,
        chain_domain_hex: String,
        challenge_id_hex: String,
        rules_hash_hex: String,
        raw_account_hex: String,
        run_id: String,
        mode: String,
        player_id_hex: String,
        initial_commitment_hex: String,
        events: [GoldenEvent; 4],
        final_commitment_hex: String,
    }

    fn decode_32(value: &str) -> [u8; 32] {
        assert_eq!(value.len(), 64);
        let mut result = [0u8; 32];
        for (index, byte) in result.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).unwrap();
        }
        result
    }

    fn decode(value: &str) -> std::vec::Vec<u8> {
        assert_eq!(value.len() % 2, 0);
        (0..value.len() / 2)
            .map(|index| u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).unwrap())
            .collect()
    }

    fn fixture_events() -> [ReplayEvent; 4] {
        [
            ReplayEvent::Vrf {
                request_counter: 1,
                output: [0xa5; 32],
            },
            ReplayEvent::Move {
                action: 0,
                expected_move: 513,
                row: 7,
                start: 2,
                destination: 5,
            },
            ReplayEvent::Bonus {
                action: 1,
                row: 3,
                column: 6,
            },
            ReplayEvent::DailyDeadline { action: 2 },
        ]
    }

    #[test]
    fn canonical_event_tags_and_layouts_are_stable() {
        let events = fixture_events();
        assert_eq!(events[0].canonical_bytes().len(), 37);
        assert_eq!(
            events[1].canonical_bytes().as_slice(),
            [2, 0, 0, 0, 0, 1, 2, 7, 2, 5]
        );
        assert_eq!(
            events[2].canonical_bytes().as_slice(),
            [3, 1, 0, 0, 0, 3, 6]
        );
        assert_eq!(
            ReplayEvent::PlayerAbandon { action: 2 }
                .canonical_bytes()
                .as_slice(),
            [4, 2, 0, 0, 0]
        );
        assert_eq!(events[3].canonical_bytes().as_slice(), [5, 2, 0, 0, 0]);
    }

    #[test]
    fn replay_v2_matches_the_committed_golden_fixture() {
        let fixture: GoldenReplay = serde_json::from_str(include_str!(
            "../../../fixtures/replays/golden-replay-v2.json"
        ))
        .unwrap();
        assert_eq!(fixture.version, 2);
        let domain = ChainDomain(decode_32(&fixture.chain_domain_hex));
        let challenge = ChallengeId(decode_32(&fixture.challenge_id_hex));
        let rules_hash = RulesHash(decode_32(&fixture.rules_hash_hex));
        let raw_account = decode_32(&fixture.raw_account_hex);
        let run_id = fixture.run_id.parse::<u64>().unwrap();
        let mode = match fixture.mode.as_str() {
            "ranked" => ReplayMode::Ranked,
            "practice" => ReplayMode::Practice,
            _ => panic!("unknown fixture mode"),
        };
        let player_id = derive_player_id(domain, raw_account);
        assert_eq!(player_id.to_bytes(), decode_32(&fixture.player_id_hex));
        let mut commitment =
            ReplayCommitment::initial(domain, challenge, rules_hash, player_id, run_id, mode);
        assert_eq!(
            commitment.to_bytes(),
            decode_32(&fixture.initial_commitment_hex)
        );

        for (event, expected) in fixture_events().into_iter().zip(fixture.events) {
            assert_eq!(
                event.canonical_bytes().as_slice(),
                decode(&expected.canonical_hex)
            );
            commitment = commitment.fold(event);
            assert_eq!(commitment.to_bytes(), decode_32(&expected.commitment_hex));
        }
        assert_eq!(
            commitment.to_bytes(),
            decode_32(&fixture.final_commitment_hex)
        );
    }

    #[test]
    fn domain_mode_player_and_run_all_change_the_initial_commitment() {
        let domain = ChainDomain([1; 32]);
        let challenge = ChallengeId([2; 32]);
        let rules = RulesHash([3; 32]);
        let player = derive_player_id(domain, [4; 32]);
        let baseline =
            ReplayCommitment::initial(domain, challenge, rules, player, 7, ReplayMode::Ranked);
        assert_ne!(
            baseline,
            ReplayCommitment::initial(
                ChainDomain([9; 32]),
                challenge,
                rules,
                player,
                7,
                ReplayMode::Ranked
            )
        );
        assert_ne!(
            baseline,
            ReplayCommitment::initial(
                domain,
                challenge,
                rules,
                derive_player_id(domain, [5; 32]),
                7,
                ReplayMode::Ranked
            )
        );
        assert_ne!(
            baseline,
            ReplayCommitment::initial(domain, challenge, rules, player, 8, ReplayMode::Ranked)
        );
        assert_ne!(
            baseline,
            ReplayCommitment::initial(domain, challenge, rules, player, 7, ReplayMode::Practice)
        );
    }
}
