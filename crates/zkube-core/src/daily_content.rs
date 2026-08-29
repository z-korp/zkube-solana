use crate::{Constraint, ConstraintKind, MoveReport, Sha256Provider, SoftwareSha256};

pub const REALM_COUNT: usize = 10;
pub const OBJECTIVE_COUNT: usize = 16;
pub const DAILY_PAIR_COUNT: usize = REALM_COUNT * OBJECTIVE_COUNT;
/// Protocol-fixed permutation seed. Daily content is code, so no publisher can
/// grind either the seed or the size of the product space.
pub const DAILY_PAIR_SELECTION_SEED: [u8; 32] = *b"zkube-daily-pool-v01-public-seed";
const DAILY_PAIR_DRAW_DOMAIN: &[u8] = b"zkube-daily-pair-draw-v1";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DailyTheme {
    pub kind: ConstraintKind,
    pub value: u8,
}

impl DailyTheme {
    #[must_use]
    pub const fn is_classic(self) -> bool {
        matches!(self.kind, ConstraintKind::None)
    }

    #[must_use]
    pub fn action_increment(self, report: &MoveReport) -> u8 {
        Constraint {
            kind: self.kind,
            value: self.value,
            required_count: 1,
        }
        .action_increment(report)
    }
}

pub const DAILY_THEMES: [DailyTheme; OBJECTIVE_COUNT] = [
    DailyTheme {
        kind: ConstraintKind::None,
        value: 0,
    },
    DailyTheme {
        kind: ConstraintKind::CombosOfAtLeast,
        value: 2,
    },
    DailyTheme {
        kind: ConstraintKind::CombosOfAtLeast,
        value: 3,
    },
    DailyTheme {
        kind: ConstraintKind::CombosOfExactly,
        value: 2,
    },
    DailyTheme {
        kind: ConstraintKind::CombosOfExactly,
        value: 3,
    },
    DailyTheme {
        kind: ConstraintKind::BreakBlocks,
        value: 1,
    },
    DailyTheme {
        kind: ConstraintKind::BreakBlocks,
        value: 2,
    },
    DailyTheme {
        kind: ConstraintKind::BreakBlocks,
        value: 3,
    },
    DailyTheme {
        kind: ConstraintKind::BreakBlocks,
        value: 4,
    },
    DailyTheme {
        kind: ConstraintKind::TriggerFired,
        value: 0,
    },
    DailyTheme {
        kind: ConstraintKind::BonusLines,
        value: 0,
    },
    DailyTheme {
        kind: ConstraintKind::BonusBreaks,
        value: 0,
    },
    DailyTheme {
        kind: ConstraintKind::ClutchClears,
        value: 7,
    },
    DailyTheme {
        kind: ConstraintKind::ClutchClears,
        value: 8,
    },
    DailyTheme {
        kind: ConstraintKind::CleanClears,
        value: 3,
    },
    DailyTheme {
        kind: ConstraintKind::CleanClears,
        value: 4,
    },
];

/// Resolve an absolute day to one index in the realm × objective product.
/// Consecutive day identifiers traverse a complete independently shuffled
/// cycle before any pair repeats.
#[must_use]
pub fn daily_pair_index(day_id: u32) -> usize {
    daily_pair_index_with::<SoftwareSha256>(day_id)
}

#[must_use]
pub fn daily_pair_index_with<H: Sha256Provider>(day_id: u32) -> usize {
    let cycle_index = day_id / u32::try_from(DAILY_PAIR_COUNT).unwrap_or(1);
    let mut permutation: [u8; DAILY_PAIR_COUNT] =
        core::array::from_fn(|index| u8::try_from(index).unwrap_or(0));
    for index in (1..DAILY_PAIR_COUNT).rev() {
        let upper_bound = u64::try_from(index + 1).unwrap_or(1);
        let swap = usize::try_from(
            pair_hash_u64_with::<H>(cycle_index, u8::try_from(index).unwrap_or(0)) % upper_bound,
        )
        .unwrap_or(0);
        permutation.swap(index, swap);
    }
    usize::from(
        permutation
            [usize::try_from(day_id % u32::try_from(DAILY_PAIR_COUNT).unwrap_or(1)).unwrap_or(0)],
    )
}

#[must_use]
pub fn daily_pair(day_id: u32) -> (u8, DailyTheme) {
    daily_pair_with::<SoftwareSha256>(day_id)
}

#[must_use]
pub fn daily_pair_with<H: Sha256Provider>(day_id: u32) -> (u8, DailyTheme) {
    let index = daily_pair_index_with::<H>(day_id);
    let realm = u8::try_from(index / OBJECTIVE_COUNT).unwrap_or(0) + 1;
    (realm, DAILY_THEMES[index % OBJECTIVE_COUNT])
}

fn pair_hash_u64_with<H: Sha256Provider>(cycle_index: u32, index: u8) -> u64 {
    let digest = H::hashv(&[
        DAILY_PAIR_DRAW_DOMAIN,
        &DAILY_PAIR_SELECTION_SEED,
        &cycle_index.to_le_bytes(),
        &[index],
    ]);
    u64::from_le_bytes(
        digest[..8]
            .try_into()
            .expect("SHA-256 prefix is eight bytes"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daily_draw_is_reproducible_from_seed_and_day() {
        let first_day = 160 * 200;
        let expected = (first_day..first_day + 160)
            .map(daily_pair_index)
            .collect::<std::vec::Vec<_>>();
        assert_eq!(
            &expected[..20],
            &[
                53, 131, 145, 13, 73, 91, 31, 97, 74, 39, 5, 132, 138, 26, 151, 99, 20, 119, 54, 15
            ]
        );
        assert_eq!(
            expected,
            (first_day..first_day + 160)
                .map(daily_pair_index)
                .collect::<std::vec::Vec<_>>()
        );
        let mut sorted = expected;
        sorted.sort_unstable();
        assert_eq!(sorted, (0..DAILY_PAIR_COUNT).collect::<std::vec::Vec<_>>());

        let pairs = (first_day..first_day + 160)
            .map(daily_pair)
            .collect::<std::vec::Vec<_>>();
        for realm in 1..=10 {
            for theme in DAILY_THEMES {
                assert_eq!(
                    pairs.iter().filter(|pair| **pair == (realm, theme)).count(),
                    1
                );
            }
        }
    }

    #[test]
    fn daily_objective_is_the_shared_kind_increment() {
        let report = MoveReport {
            lines_cleared: 3,
            points_earned: 12,
            height_before: 8,
            height_after: 3,
            blocks_destroyed_by_size: [1, 2, 3, 4],
            ..MoveReport::default()
        };
        for theme in DAILY_THEMES {
            let campaign = Constraint {
                kind: theme.kind,
                value: theme.value,
                required_count: u8::MAX,
            };
            assert_eq!(
                theme.action_increment(&report),
                campaign.action_increment(&report)
            );
        }
    }
}
