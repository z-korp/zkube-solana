pub const CAMPAIGN_MAP_COUNT: usize = 10;
pub const CAMPAIGN_LEVELS_PER_MAP: usize = 10;
pub const CAMPAIGN_TOTAL_LEVELS: usize = CAMPAIGN_MAP_COUNT * CAMPAIGN_LEVELS_PER_MAP;
pub const CAMPAIGN_STAR_BYTES: usize = CAMPAIGN_TOTAL_LEVELS / 4;
pub(crate) const CAMPAIGN_MAX_STARS: u16 = 300;
const CAMPAIGN_MAP_COUNT_U8: u8 = 10;
const CAMPAIGN_LEVELS_PER_MAP_U8: u8 = 10;
pub const EMBLEM_AUTO: u8 = 0;
pub const EMBLEM_FIRST_GUARDIAN: u8 = 1;
pub(crate) const EMBLEM_LAST_GUARDIAN: u8 = CAMPAIGN_MAP_COUNT_U8;
pub const EMBLEM_REALM_CONQUEROR: u8 = EMBLEM_LAST_GUARDIAN + 1;
pub const EMBLEM_WORLD_PERFECT: u8 = EMBLEM_REALM_CONQUEROR + 1;
pub const CAMPAIGN_EMBLEM_COUNT: usize = EMBLEM_WORLD_PERFECT as usize + 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CampaignStarsError {
    InvalidMap,
    InvalidLevel,
    InvalidStars,
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

    /// Pack the local save's unpacked star values.
    ///
    /// # Errors
    /// Rejects a value outside the two-bit star range.
    pub fn from_unpacked(stars: [u8; CAMPAIGN_TOTAL_LEVELS]) -> Result<Self, CampaignStarsError> {
        let mut packed = [0; CAMPAIGN_STAR_BYTES];
        for (index, stars) in stars.into_iter().enumerate() {
            if stars > 3 {
                return Err(CampaignStarsError::InvalidStars);
            }
            packed[index / 4] |= stars << ((index % 4) * 2);
        }
        Ok(Self::from_packed(packed))
    }

    #[must_use]
    pub fn unpacked(self) -> [u8; CAMPAIGN_TOTAL_LEVELS] {
        core::array::from_fn(|index| (self.packed[index / 4] >> ((index % 4) * 2)) & 3)
    }

    /// Merge one local result, including a zero-star attempt, by lifetime maximum.
    ///
    /// # Errors
    /// Rejects an invalid map, level or star count.
    pub fn merge_level(&mut self, map: u8, level: u8, stars: u8) -> Result<u8, CampaignStarsError> {
        if stars > 3 {
            return Err(CampaignStarsError::InvalidStars);
        }
        let index = level_index(map, level)?;
        let previous = self.best(map, level)?;
        let next = previous.max(stars);
        let shift = (index % 4) * 2;
        self.packed[index / 4] = (self.packed[index / 4] & !(3 << shift)) | (next << shift);
        Ok(next - previous)
    }

    #[must_use]
    pub fn emblem_unlocked(&self, id: u8) -> bool {
        match id {
            EMBLEM_AUTO => true,
            EMBLEM_FIRST_GUARDIAN..=EMBLEM_LAST_GUARDIAN => self.zone_cleared(id),
            EMBLEM_REALM_CONQUEROR => self.all_guardians_cleared(),
            EMBLEM_WORLD_PERFECT => self.world_perfected(),
            _ => false,
        }
    }

    #[must_use]
    pub fn strongest_emblem(&self) -> u8 {
        (EMBLEM_FIRST_GUARDIAN..=EMBLEM_WORLD_PERFECT)
            .rev()
            .find(|id| self.emblem_unlocked(*id))
            .unwrap_or(EMBLEM_AUTO)
    }

    #[must_use]
    pub fn emblem_gold(&self, id: u8) -> bool {
        match id {
            EMBLEM_AUTO => {
                let strongest = self.strongest_emblem();
                strongest != EMBLEM_AUTO && self.emblem_gold(strongest)
            }
            EMBLEM_FIRST_GUARDIAN..=EMBLEM_LAST_GUARDIAN => self.zone_perfected(id),
            EMBLEM_REALM_CONQUEROR | EMBLEM_WORLD_PERFECT => self.world_perfected(),
            _ => false,
        }
    }

    /// Merge a self-attested cosmetic record by each level's lifetime maximum.
    /// Every packed array encodes exactly 100 valid two-bit values; progression
    /// order is a local play rule and does not constrain this merge.
    pub fn merge(&mut self, incoming: Self) {
        for (stored, submitted) in self.packed.iter_mut().zip(incoming.packed) {
            let mut merged = 0;
            for shift in [0, 2, 4, 6] {
                merged |= ((*stored >> shift) & 3).max((submitted >> shift) & 3) << shift;
            }
            *stored = merged;
        }
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

    #[test]
    fn campaign_packing_roundtrips_and_local_results_preserve_the_maximum() {
        for value in 0..=u8::MAX {
            let packed = CampaignStars::from_packed([value; CAMPAIGN_STAR_BYTES]);
            assert_eq!(CampaignStars::from_unpacked(packed.unpacked()), Ok(packed));
        }
        assert_eq!(
            CampaignStars::from_unpacked([4; CAMPAIGN_TOTAL_LEVELS]),
            Err(CampaignStarsError::InvalidStars)
        );
        let mut record = CampaignStars::new();
        assert_eq!(record.merge_level(10, 10, 2), Ok(2));
        for stars in [0, 1, 2] {
            assert_eq!(record.merge_level(10, 10, stars), Ok(0));
        }
        assert_eq!(record.best(10, 10), Ok(2));
        let before = record;
        for (map, level, stars) in [(0, 1, 1), (11, 1, 1), (1, 0, 1), (1, 11, 1), (1, 1, 4)] {
            assert!(record.merge_level(map, level, stars).is_err());
            assert_eq!(record, before);
        }
    }

    #[test]
    fn campaign_eligibility_handles_sparse_saves_and_unsupported_emblems() {
        let mut record = CampaignStars::new();
        assert!(record.emblem_unlocked(EMBLEM_AUTO));
        assert!(!record.emblem_gold(EMBLEM_AUTO));
        for map in 1..=10 {
            record.merge_level(map, 10, 1).unwrap();
            assert!(record.emblem_unlocked(map));
            assert!(!record.zone_perfected(map));
            assert_eq!(
                record.strongest_emblem(),
                if map == 10 {
                    EMBLEM_REALM_CONQUEROR
                } else {
                    map
                }
            );
        }
        assert!(record.all_guardians_cleared());
        assert!(!record.world_perfected());
        assert_eq!(record.total(), 10);
        for id in 13..=u8::MAX {
            assert!(!record.emblem_unlocked(id));
            assert!(!record.emblem_gold(id));
        }
        let perfect = CampaignStars::from_packed([255; CAMPAIGN_STAR_BYTES]);
        assert_eq!(perfect.strongest_emblem(), EMBLEM_WORLD_PERFECT);
        assert!(perfect.emblem_gold(EMBLEM_AUTO));
    }

    #[test]
    fn campaign_stars_merge_per_level_maximum_and_never_decrease() {
        // Exhaust every pair of packed bytes, including opposite improvements
        // within one byte, at every position in the complete record.
        for stored in 0..=u8::MAX {
            for submitted in 0..=u8::MAX {
                let before = CampaignStars::from_packed([stored; CAMPAIGN_STAR_BYTES]);
                let incoming = CampaignStars::from_packed([submitted; CAMPAIGN_STAR_BYTES]);
                let mut merged = before;
                merged.merge(incoming);
                for map in 1..=CAMPAIGN_MAP_COUNT_U8 {
                    for level in 1..=CAMPAIGN_LEVELS_PER_MAP_U8 {
                        assert_eq!(
                            merged.best(map, level).unwrap(),
                            before
                                .best(map, level)
                                .unwrap()
                                .max(incoming.best(map, level).unwrap())
                        );
                    }
                }
                let mut reversed = incoming;
                reversed.merge(before);
                assert_eq!(merged, reversed);
                reversed.merge(incoming);
                reversed.merge(CampaignStars::new());
                assert_eq!(merged, reversed);
            }
        }
        let mut farthest = [0; CAMPAIGN_STAR_BYTES];
        farthest[CAMPAIGN_STAR_BYTES - 1] = 3 << 6;
        let mut merged = CampaignStars::new();
        merged.merge(CampaignStars::from_packed(farthest));
        assert_eq!(merged.best(10, 10), Ok(3));
        assert_eq!(merged.best(1, 1), Ok(0));
    }

    #[test]
    fn campaign_move_budget_is_derived_from_the_ladder_and_tier() {
        const EXPECTED: [[u16; 8]; 10] = [
            [16, 15, 14, 13, 12, 11, 10, 9],
            [23, 21, 20, 19, 17, 16, 14, 13],
            [29, 27, 26, 24, 22, 20, 18, 17],
            [36, 33, 31, 29, 27, 25, 22, 20],
            [44, 41, 38, 36, 33, 30, 27, 25],
            [52, 48, 45, 42, 39, 36, 32, 29],
            [60, 56, 52, 49, 45, 41, 37, 34],
            [68, 63, 59, 55, 51, 47, 42, 38],
            [74, 69, 65, 60, 56, 51, 46, 42],
            [80, 75, 70, 65, 60, 55, 50, 45],
        ];
        for (level_index, expected_tiers) in EXPECTED.iter().enumerate() {
            for (tier, expected) in expected_tiers.iter().enumerate() {
                assert_eq!(
                    crate::campaign_move_budget(
                        u8::try_from(level_index).unwrap() + 1,
                        u8::try_from(tier).unwrap(),
                    ),
                    Some(*expected),
                );
            }
        }
        assert_eq!(crate::campaign_move_budget(0, 0), None);
        assert_eq!(crate::campaign_move_budget(11, 0), None);
        assert_eq!(crate::campaign_move_budget(1, 8), None);
    }
    use crate::{Bonus, Constraint, ConstraintKind, Guardian, RunRules, StarRules, TierPolicy};

    fn rules() -> RunRules {
        RunRules {
            guardian: Guardian {
                bonus: Bonus::Wave,
                ..Guardian::default()
            },
            starting_height: 4,
            max_moves: 20,
            tier: TierPolicy::Fixed(0),
            stars: Some(StarRules {
                points_required: 1,
                primary: Constraint::default(),
                secondary: Constraint::default(),
            }),
            objective: None,
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
    fn campaign_rules_require_valid_constraint_classes_counts_and_distinct_facts() {
        let mut invalid = rules();
        invalid.stars.as_mut().unwrap().primary.kind = ConstraintKind::ComboOfAtLeast;
        assert!(!invalid.is_valid());
        invalid.stars.as_mut().unwrap().primary.kind = ConstraintKind::CombosOfAtLeast;
        invalid.stars.as_mut().unwrap().secondary.kind = ConstraintKind::CombosOfAtLeast;
        assert!(!invalid.is_valid());

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
            let mut candidate = rules();
            candidate.stars.as_mut().unwrap().primary = Constraint {
                kind,
                value,
                required_count: 1,
            };
            assert!(!candidate.is_valid(), "{kind:?} accepted count one");
            candidate.stars.as_mut().unwrap().primary.required_count = 2;
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
            let mut candidate = rules();
            candidate.stars.as_mut().unwrap().primary = Constraint {
                kind: primary,
                value: primary_value,
                required_count: 2,
            };
            candidate.stars.as_mut().unwrap().secondary = Constraint {
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
    fn compact_stars_unlock_sequentially_and_keep_bests() {
        let mut progress = CampaignStars::new();
        assert!(progress.level_unlocked(1, 1));
        assert!(!progress.level_unlocked(1, 2));
        assert_eq!(progress.merge_level(1, 1, 2), Ok(2));
        assert!(progress.level_unlocked(1, 2));
        assert_eq!(progress.merge_level(1, 1, 1), Ok(0));
        for level in 2..=10 {
            progress.merge_level(1, level, 3).unwrap();
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
                progress.merge_level(map_id, level_id, 3).unwrap();
            }
        }
        assert!(progress.all_guardians_cleared());
        assert!(progress.world_perfected());
        assert_eq!(progress.total(), 300);
    }
}
