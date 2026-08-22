//! Canonical Arena rules and cadence helpers.
//!
//! Deterministic Arena rule rotation for paid play.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;

pub const RULES_ACCOUNT_VERSION: u8 = zkube_core::RULES_ACCOUNT_VERSION;
pub const DAILY_RULES_CATALOG_SEED: &[u8] = b"daily_rules";
pub const DAILY_SCORE_RULE_CAPACITY: usize = 16;
pub const DAILY_SCORE_FAMILY_COUNT: usize = 7;
pub const DAILY_PRESSURE_TIERS: usize = 8;
pub const DAILY_POOL_ENTRY_CAPACITY: usize = zkube_core::DAILY_POOL_CAPACITY;

/// A catalog revision must state an effective day at least this many days
/// ahead: the entry count drives both the permutation and the modulus, so a
/// nearer revision would re-map already-derivable days, including tomorrow.
pub const DAILY_CATALOG_REVISION_MIN_LEAD_DAYS: u32 = 7;
pub const DAILY_DIFFICULTY_BAND_CAPACITY: usize = 4;
pub const DAILY_MAX_MOVES: u16 = 100;

pub const DAILY_FAMILY_CLASSIC: u8 = 0;
pub const DAILY_FAMILY_COMBO: u8 = 1;
pub const DAILY_FAMILY_LINES: u8 = 2;
pub const DAILY_FAMILY_BLOCKS: u8 = 3;
pub const DAILY_FAMILY_CLUTCH: u8 = 4;
pub const DAILY_FAMILY_CLEAN: u8 = 5;
pub const DAILY_FAMILY_SURVIVAL: u8 = 6;

pub const DAILY_SCORE_CLASSIC: u8 = 0;
pub const DAILY_SCORE_COMBO: u8 = 1;
pub const DAILY_SCORE_EXACT_LINES: u8 = 2;
pub const DAILY_SCORE_BLOCKS: u8 = 4;
pub const DAILY_SCORE_CLUTCH: u8 = 5;
pub const DAILY_SCORE_CLEAN: u8 = 6;
pub const DAILY_SCORE_SURVIVAL: u8 = 7;

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct DailyScoringRule {
    pub id: u8,
    pub family: u8,
    pub kind: u8,
    pub parameter: u8,
    /// Raw objective points are scaled by this value before pressure.
    pub bonus_multiplier_x100: u16,
}

impl DailyScoringRule {
    pub fn validate(self) -> Result<()> {
        let valid = matches!(
            (self.family, self.kind, self.parameter),
            (DAILY_FAMILY_CLASSIC, DAILY_SCORE_CLASSIC, 0)
                | (DAILY_FAMILY_COMBO, DAILY_SCORE_COMBO, 2 | 3)
                | (DAILY_FAMILY_LINES, DAILY_SCORE_EXACT_LINES, 1..=3)
                | (DAILY_FAMILY_BLOCKS, DAILY_SCORE_BLOCKS, 1..=4)
                | (DAILY_FAMILY_CLUTCH, DAILY_SCORE_CLUTCH, 6 | 7)
                | (DAILY_FAMILY_CLEAN, DAILY_SCORE_CLEAN, 2 | 3)
                | (DAILY_FAMILY_SURVIVAL, DAILY_SCORE_SURVIVAL, 0)
        );
        let bonus_valid = if self.kind == DAILY_SCORE_CLASSIC {
            self.bonus_multiplier_x100 == 0
        } else {
            (25..=10_000).contains(&self.bonus_multiplier_x100)
        };
        require!(self.id > 0 && valid && bonus_valid, ErrorCode::InvalidLevel);
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace, PartialEq, Eq)]
pub struct DailyPressureProfile {
    pub thresholds: [u32; 7],
    pub score_multipliers_x100: [u16; DAILY_PRESSURE_TIERS],
    pub block_weights: [[u16; 5]; DAILY_PRESSURE_TIERS],
    pub starting_height: u8,
    pub max_moves: u16,
}

impl Default for DailyPressureProfile {
    fn default() -> Self {
        Self::canonical()
    }
}

/// One complete authored Daily in the published pool.
///
/// Map identifiers bind the entry back to the Campaign catalogs. The copied
/// active and passive fields make the selected Daily independently immutable;
/// preparation verifies them against those catalogs so a guardian's mutator
/// can never be re-paired with another realm.
#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct DailyPoolEntry {
    pub id: u8,
    /// Zero is allowed for a standalone wildcard entry with no guardian realm.
    pub realm_map_id: u8,
    pub passive_map_id: u8,
    pub active_mutator_id: u8,
    pub passive_mutator_id: u8,
    pub scoring_rule: DailyScoringRule,
    pub score_multiplier_x100: u16,
    pub combo_multiplier_x100: u16,
    pub line_clear_bonus: u16,
    pub perfect_clear_bonus: u16,
    pub bonus_type: u8,
    pub bonus_trigger_type: u8,
    pub bonus_threshold: u16,
    pub starting_charges: u8,
    pub starting_rows: u8,
    pub difficulty_band: u8,
}

impl DailyPoolEntry {
    pub fn validate(self, difficulty_band_count: u8) -> Result<()> {
        require!(
            self.id > 0
                && self.realm_map_id <= 32
                && (1..=32).contains(&self.passive_map_id)
                && self.active_mutator_id > 0
                && self.passive_mutator_id > 0
                // The engine bonus range — Hammer, Totem, Wave, Reroll: an
                // entry outside it would fail every run of its day at first
                // bonus use.
                && (1..=4).contains(&self.bonus_type)
                && (1..=7).contains(&self.bonus_trigger_type)
                && self.score_multiplier_x100 > 0
                && self.combo_multiplier_x100 > 0
                && self.bonus_threshold > 0
                && self.starting_charges <= 15
                && self.difficulty_band < difficulty_band_count,
            ErrorCode::InvalidLevel
        );
        require!(
            (crate::game::MIN_OPENING_HEIGHT..=crate::game::MAX_OPENING_HEIGHT)
                .contains(&self.starting_rows),
            ErrorCode::InvalidLevel
        );
        self.scoring_rule.validate()
    }
}

impl DailyPressureProfile {
    pub const fn canonical() -> Self {
        Self {
            thresholds: [8, 18, 30, 42, 54, 66, 78],
            score_multipliers_x100: [100, 110, 125, 140, 160, 180, 210, 250],
            block_weights: [
                [25, 30, 25, 15, 5],
                [22, 28, 25, 18, 7],
                [20, 25, 25, 20, 10],
                [18, 22, 24, 22, 14],
                [16, 20, 22, 24, 18],
                [14, 18, 20, 26, 22],
                [12, 16, 18, 28, 26],
                [10, 14, 16, 30, 30],
            ],
            starting_height: 4,
            max_moves: DAILY_MAX_MOVES,
        }
    }

    pub fn validate(self) -> Result<()> {
        require!(
            self.thresholds.windows(2).all(|pair| pair[0] < pair[1]),
            ErrorCode::InvalidLevel
        );
        require!(
            self.score_multipliers_x100.iter().all(|value| *value > 0),
            ErrorCode::InvalidLevel
        );
        require!(
            self.block_weights.iter().all(|weights| {
                weights[0] > 0
                    && weights[1..].iter().any(|weight| *weight > 0)
                    && weights.iter().map(|value| u32::from(*value)).sum::<u32>() == 100
            }),
            ErrorCode::InvalidBlockWeights
        );
        require!(
            (crate::game::MIN_OPENING_HEIGHT..=crate::game::MAX_OPENING_HEIGHT)
                .contains(&self.starting_height)
                && self.max_moves == DAILY_MAX_MOVES,
            ErrorCode::InvalidLevel
        );
        Ok(())
    }

    pub fn difficulty_for_score(self, pressure_score: u32) -> u8 {
        self.thresholds
            .iter()
            .take_while(|threshold| pressure_score >= **threshold)
            .count() as u8
    }
}

pub const fn canonical_daily_scoring_rules() -> [DailyScoringRule; DAILY_SCORE_RULE_CAPACITY] {
    [
        DailyScoringRule {
            id: 1,
            family: DAILY_FAMILY_CLASSIC,
            kind: DAILY_SCORE_CLASSIC,
            parameter: 0,
            bonus_multiplier_x100: 0,
        },
        DailyScoringRule {
            id: 2,
            family: DAILY_FAMILY_COMBO,
            kind: DAILY_SCORE_COMBO,
            parameter: 2,
            bonus_multiplier_x100: 200,
        },
        DailyScoringRule {
            id: 3,
            family: DAILY_FAMILY_COMBO,
            kind: DAILY_SCORE_COMBO,
            parameter: 3,
            bonus_multiplier_x100: 1_250,
        },
        DailyScoringRule {
            id: 4,
            family: DAILY_FAMILY_LINES,
            kind: DAILY_SCORE_EXACT_LINES,
            parameter: 1,
            bonus_multiplier_x100: 100,
        },
        DailyScoringRule {
            id: 5,
            family: DAILY_FAMILY_LINES,
            kind: DAILY_SCORE_EXACT_LINES,
            parameter: 2,
            bonus_multiplier_x100: 250,
        },
        DailyScoringRule {
            id: 6,
            family: DAILY_FAMILY_LINES,
            kind: DAILY_SCORE_EXACT_LINES,
            parameter: 3,
            bonus_multiplier_x100: 1_250,
        },
        DailyScoringRule {
            id: 7,
            family: DAILY_FAMILY_BLOCKS,
            kind: DAILY_SCORE_BLOCKS,
            parameter: 1,
            bonus_multiplier_x100: 50,
        },
        DailyScoringRule {
            id: 8,
            family: DAILY_FAMILY_BLOCKS,
            kind: DAILY_SCORE_BLOCKS,
            parameter: 2,
            bonus_multiplier_x100: 125,
        },
        DailyScoringRule {
            id: 9,
            family: DAILY_FAMILY_BLOCKS,
            kind: DAILY_SCORE_BLOCKS,
            parameter: 3,
            bonus_multiplier_x100: 140,
        },
        DailyScoringRule {
            id: 10,
            family: DAILY_FAMILY_BLOCKS,
            kind: DAILY_SCORE_BLOCKS,
            parameter: 4,
            bonus_multiplier_x100: 200,
        },
        DailyScoringRule {
            id: 11,
            family: DAILY_FAMILY_CLUTCH,
            kind: DAILY_SCORE_CLUTCH,
            parameter: 6,
            bonus_multiplier_x100: 200,
        },
        DailyScoringRule {
            id: 12,
            family: DAILY_FAMILY_CLUTCH,
            kind: DAILY_SCORE_CLUTCH,
            parameter: 7,
            bonus_multiplier_x100: 270,
        },
        DailyScoringRule {
            id: 13,
            family: DAILY_FAMILY_CLEAN,
            kind: DAILY_SCORE_CLEAN,
            parameter: 2,
            bonus_multiplier_x100: 450,
        },
        DailyScoringRule {
            id: 14,
            family: DAILY_FAMILY_CLEAN,
            kind: DAILY_SCORE_CLEAN,
            parameter: 3,
            bonus_multiplier_x100: 250,
        },
        DailyScoringRule {
            id: 15,
            family: DAILY_FAMILY_SURVIVAL,
            kind: DAILY_SCORE_SURVIVAL,
            parameter: 0,
            bonus_multiplier_x100: 100,
        },
        DailyScoringRule {
            id: 0,
            family: 0,
            kind: 0,
            parameter: 0,
            bonus_multiplier_x100: 0,
        },
    ]
}

#[account]
#[derive(InitSpace)]
pub struct DailyRulesCatalog {
    pub version: u8,
    pub rules_version: u32,
    pub protocol: Pubkey,
    pub content_version: u32,
    pub catalog_hash: [u8; 32],
    pub pool_revision: u32,
    pub starts_day: u32,
    pub selection_seed: [u8; 32],
    pub pool_entry_count: u8,
    #[max_len(DAILY_POOL_ENTRY_CAPACITY)]
    pub pool_entries: Vec<DailyPoolEntry>,
    pub difficulty_band_count: u8,
    pub difficulty_bands: [DailyPressureProfile; DAILY_DIFFICULTY_BAND_CAPACITY],
    pub bump: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DailyContentSelection {
    pub pool_index: u8,
    pub entry: DailyPoolEntry,
    pub pressure: DailyPressureProfile,
}

impl DailyRulesCatalog {
    pub fn validate(&self) -> Result<()> {
        require!(
            self.version == RULES_ACCOUNT_VERSION
                && self.rules_version > 0
                && self.pool_revision > 0
                && self.selection_seed == zkube_core::DAILY_POOL_SELECTION_SEED
                && usize::from(self.pool_entry_count) <= DAILY_POOL_ENTRY_CAPACITY
                && self.pool_entries.len() == usize::from(self.pool_entry_count)
                && usize::from(self.difficulty_band_count) <= DAILY_DIFFICULTY_BAND_CAPACITY,
            ErrorCode::InvalidVersion
        );
        if self.pool_entry_count == 0 {
            require!(self.difficulty_band_count == 0, ErrorCode::InvalidLevel);
            return Ok(());
        }
        require!(self.difficulty_band_count > 0, ErrorCode::InvalidLevel);
        for pressure in &self.difficulty_bands[..usize::from(self.difficulty_band_count)] {
            pressure.validate()?;
        }
        for (index, entry) in self.pool_entries.iter().enumerate() {
            entry.validate(self.difficulty_band_count)?;
            require!(
                index == 0 || self.pool_entries[index - 1].id < entry.id,
                ErrorCode::InvalidLevel
            );
        }
        Ok(())
    }

    pub fn is_scheduled(&self, day_id: u32) -> bool {
        self.pool_entry_count > 0 && day_id >= self.starts_day
    }

    pub fn content_for_day(&self, day_id: u32) -> Result<DailyContentSelection> {
        self.validate()?;
        require!(self.is_scheduled(day_id), ErrorCode::DailyNotScheduled);
        let pool_index =
            zkube_core::daily_pool_entry_index_with::<crate::state::arcade::SolanaSha256>(
                self.selection_seed,
                self.starts_day,
                day_id,
                self.pool_entry_count,
            )
            .map_err(|_| error!(ErrorCode::DailyNotScheduled))?;
        let entry = self.pool_entries[usize::from(pool_index)];
        Ok(DailyContentSelection {
            pool_index,
            entry,
            pressure: self.difficulty_bands[usize::from(entry.difficulty_band)],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pool_entry(id: u8, realm_map_id: u8, passive_map_id: u8) -> DailyPoolEntry {
        let scoring_rules = canonical_daily_scoring_rules();
        DailyPoolEntry {
            id,
            realm_map_id,
            passive_map_id,
            active_mutator_id: realm_map_id.max(1),
            passive_mutator_id: passive_map_id,
            scoring_rule: scoring_rules[usize::from(id - 1) % (DAILY_SCORE_RULE_CAPACITY - 1)],
            score_multiplier_x100: 100,
            combo_multiplier_x100: 100,
            line_clear_bonus: 1,
            perfect_clear_bonus: 2,
            bonus_type: 1,
            bonus_trigger_type: 1,
            bonus_threshold: 10,
            starting_charges: 0,
            starting_rows: 4,
            difficulty_band: 0,
        }
    }

    #[test]
    fn pool_entries_stay_inside_the_engine_bonus_range() {
        let mut entry = pool_entry(1, 1, 1);
        entry.bonus_type = 5;
        assert!(entry.validate(1).is_err());
        entry.bonus_type = 4;
        entry.validate(1).unwrap();
        entry.bonus_trigger_type = 8;
        assert!(entry.validate(1).is_err());
        entry.bonus_trigger_type = 1;
        entry.validate(1).unwrap();
    }

    fn catalog(entry_count: u8) -> DailyRulesCatalog {
        let pool_entries = (0..usize::from(entry_count))
            .map(|index| {
                pool_entry(
                    u8::try_from(index + 1).unwrap(),
                    u8::try_from(index % 32 + 1).unwrap(),
                    u8::try_from(index % 32 + 1).unwrap(),
                )
            })
            .collect();
        let mut difficulty_bands =
            [DailyPressureProfile::default(); DAILY_DIFFICULTY_BAND_CAPACITY];
        difficulty_bands[0] = DailyPressureProfile::canonical();
        DailyRulesCatalog {
            version: RULES_ACCOUNT_VERSION,
            rules_version: 1,
            protocol: Pubkey::new_unique(),
            content_version: 1,
            catalog_hash: [1; 32],
            pool_revision: 1,
            starts_day: 20_000,
            selection_seed: zkube_core::DAILY_POOL_SELECTION_SEED,
            pool_entry_count: entry_count,
            pool_entries,
            difficulty_band_count: u8::from(entry_count > 0),
            difficulty_bands,
            bump: 1,
        }
    }

    #[test]
    fn published_pool_draws_a_complete_reproducible_cycle() {
        assert_eq!(DailyPoolEntry::INIT_SPACE, 26);
        assert_eq!(8 + DailyRulesCatalog::INIT_SPACE, 3_964);
        let catalog = catalog(10);
        catalog.validate().unwrap();
        let first = (catalog.starts_day..catalog.starts_day + 10)
            .map(|day| catalog.content_for_day(day).unwrap().pool_index)
            .collect::<Vec<_>>();
        for index in 0..10 {
            assert_eq!(first.iter().filter(|entry| **entry == index).count(), 1);
        }
        let second = (catalog.starts_day + 10..catalog.starts_day + 20)
            .map(|day| catalog.content_for_day(day).unwrap().pool_index)
            .collect::<Vec<_>>();
        assert_ne!(second, first);
        assert_eq!(
            catalog.content_for_day(catalog.starts_day + 1).unwrap(),
            catalog.content_for_day(catalog.starts_day + 1).unwrap()
        );
    }

    #[test]
    fn empty_pool_and_days_before_start_are_not_scheduled() {
        let suspended = catalog(0);
        suspended.validate().unwrap();
        assert!(!suspended.is_scheduled(suspended.starts_day));
        assert!(suspended.content_for_day(suspended.starts_day).is_err());

        let active = catalog(3);
        assert!(!active.is_scheduled(active.starts_day - 1));
        assert!(active.content_for_day(active.starts_day - 1).is_err());
        assert!(active.is_scheduled(active.starts_day));
    }

    #[test]
    fn pool_identity_order_is_canonical() {
        let mut catalog = catalog(2);
        catalog.pool_entries.swap(0, 1);
        assert!(catalog.validate().is_err());
    }

    #[test]
    fn raised_capacity_catalog_draws_every_entry_once() {
        let catalog = catalog(u8::try_from(DAILY_POOL_ENTRY_CAPACITY).unwrap());
        catalog.validate().unwrap();
        let cycle_start = u32::try_from(DAILY_POOL_ENTRY_CAPACITY).unwrap() * 200;
        let mut selected = (cycle_start
            ..cycle_start + u32::try_from(DAILY_POOL_ENTRY_CAPACITY).unwrap())
            .map(|day| catalog.content_for_day(day).unwrap().pool_index)
            .collect::<Vec<_>>();
        selected.sort_unstable();
        assert_eq!(
            selected,
            (0..u8::try_from(DAILY_POOL_ENTRY_CAPACITY).unwrap()).collect::<Vec<_>>()
        );
    }

    #[test]
    fn suspension_gap_routes_funding_to_the_next_catalog_start() {
        let mut resumed = catalog(3);
        resumed.starts_day = 20_010;
        assert_eq!(
            crate::state::scheduled_daily_window(&resumed, 20_000).unwrap(),
            (20_010, 20_011)
        );
        assert!(crate::state::valid_daily_successor(20_000, 20_010));
    }
}
