//! Canonical Arena rules and cadence helpers.
//!
//! Deterministic Arena rule rotation shared by paid play and free Practice.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::game::sha256v;

pub const RULES_ACCOUNT_VERSION: u8 = 1;
pub const DAILY_RULES_CATALOG_SEED: &[u8] = b"daily_rules";
pub const DAILY_SCORE_RULE_CAPACITY: usize = 16;
pub const DAILY_SCORE_FAMILY_COUNT: usize = 7;
pub const DAILY_PRESSURE_TIERS: usize = 8;
pub const DAILY_MAX_MOVES: u16 = 100;
/// Campaign XP follows the lifetime best rating for one map-level. Each newly
/// earned star is worth ten XP, so a level can mint at most thirty XP across
/// all of its clears, independent of the one-time perfect-map reward.
pub const CAMPAIGN_LEVEL_XP_PER_STAR: u32 = 10;
pub const PERFECT_MAP_XP: u32 = 300;

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
    pub rotation_id: u32,
    pub starts_day: u32,
    pub rotation_seed: [u8; 32],
    pub scoring_rule_count: u8,
    pub scoring_rules: [DailyScoringRule; DAILY_SCORE_RULE_CAPACITY],
    pub pressure: DailyPressureProfile,
    pub bump: u8,
}

impl DailyRulesCatalog {
    pub fn validate(&self) -> Result<()> {
        require!(
            self.version == RULES_ACCOUNT_VERSION
                && self.rules_version > 0
                && self.rotation_id > 0
                && self.scoring_rule_count as usize <= DAILY_SCORE_RULE_CAPACITY,
            ErrorCode::InvalidVersion
        );
        require!(
            usize::from(self.scoring_rule_count) >= DAILY_SCORE_FAMILY_COUNT,
            ErrorCode::InvalidLevel
        );
        self.pressure.validate()?;
        let active = &self.scoring_rules[..usize::from(self.scoring_rule_count)];
        for (index, rule) in active.iter().enumerate() {
            rule.validate()?;
            require!(
                !active[..index].iter().any(|prior| prior.id == rule.id),
                ErrorCode::InvalidLevel
            );
        }
        for family in 0..DAILY_SCORE_FAMILY_COUNT as u8 {
            require!(
                active.iter().any(|rule| rule.family == family),
                ErrorCode::InvalidLevel
            );
        }
        Ok(())
    }

    pub fn scoring_rule_for_day(&self, day_id: u32) -> Result<DailyScoringRule> {
        self.validate()?;
        require!(day_id >= self.starts_day, ErrorCode::ChallengeNotStarted);
        let week_id = weekly_id_for_day(day_id);
        let weekday = day_id.saturating_add(3) % 7;
        let family = family_permutation(self.rotation_seed, week_id)[weekday as usize];
        self.rule_for_family_and_week(family, week_id)
    }

    pub fn map_for_day(&self, day_id: u32) -> u8 {
        const COPRIME_STEPS: [u64; 4] = [1, 3, 7, 9];
        let offset = daily_hash_u64(self.rotation_seed, b"theme-offset", 0, 0) % 10;
        let step_index =
            daily_hash_u64(self.rotation_seed, b"theme-step", 0, 0) as usize % COPRIME_STEPS.len();
        let theme = (offset + u64::from(day_id) * COPRIME_STEPS[step_index]) % 10;
        theme as u8 + 1
    }

    fn rule_for_family_and_week(&self, family: u8, week_id: u32) -> Result<DailyScoringRule> {
        let active = &self.scoring_rules[..usize::from(self.scoring_rule_count)];
        let mut candidates = [DailyScoringRule::default(); DAILY_SCORE_RULE_CAPACITY];
        let mut count = 0usize;
        for rule in active.iter().filter(|rule| rule.family == family) {
            candidates[count] = *rule;
            count += 1;
        }
        require!(count > 0, ErrorCode::InvalidLevel);
        let offset =
            daily_hash_u64(self.rotation_seed, b"variant", u32::from(family), 0) as usize % count;
        let index = (offset + week_id as usize) % count;
        Ok(candidates[index])
    }
}

fn family_permutation(seed: [u8; 32], week_id: u32) -> [u8; DAILY_SCORE_FAMILY_COUNT] {
    let mut families = [0, 1, 2, 3, 4, 5, 6];
    for index in (1..DAILY_SCORE_FAMILY_COUNT).rev() {
        let swap = daily_hash_u64(seed, b"family", week_id, index as u8) as usize % (index + 1);
        families.swap(index, swap);
    }
    families
}

fn daily_hash_u64(seed: [u8; 32], domain: &[u8], value: u32, discriminator: u8) -> u64 {
    let value = value.to_le_bytes();
    let digest = sha256v(&[
        b"zkube-daily-selection-v1",
        &seed,
        domain,
        &value,
        &[discriminator],
    ]);
    u64::from_le_bytes(
        digest[..8]
            .try_into()
            .expect("SHA-256 prefix is eight bytes"),
    )
}

pub fn player_level(xp: u64) -> u8 {
    let mut level = 1u8;
    for candidate in 2u8..=100 {
        let threshold = 16u64 * u64::from(candidate) * u64::from(candidate);
        if xp < threshold {
            break;
        }
        level = candidate;
    }
    level
}

pub fn weekly_id_for_day(day_id: u32) -> u32 {
    // Days before the shared Monday epoch are outside v4 competition time;
    // retain zero as their inert cadence while routing every supported day
    // through the one canonical period implementation.
    zkube_core::week_id_for_day(day_id).unwrap_or(0)
}

pub fn daily_points_for_rank(rank: Option<usize>, participants: u32) -> u16 {
    let Some(rank) = rank.map(|value| value + 1) else {
        return 2;
    };
    let participants = u64::from(participants.max(1));
    let in_band = |percent: u64, cap: usize| {
        let percentile_rank = participants.saturating_mul(percent).div_ceil(100) as usize;
        rank <= cap.min(percentile_rank.max(1))
    };
    if in_band(1, 3) {
        100
    } else if in_band(5, 10) {
        60
    } else if in_band(10, 20) {
        30
    } else if in_band(25, 50) {
        10
    } else {
        2
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scoring_rotation_uses_the_canonical_monday_week_at_boundaries() {
        for (day, expected) in [(4, 0), (10, 0), (11, 1)] {
            assert_eq!(weekly_id_for_day(day), expected);
            assert_eq!(
                weekly_id_for_day(day),
                zkube_core::week_id_for_day(day).unwrap()
            );
        }

        let catalog = DailyRulesCatalog {
            version: RULES_ACCOUNT_VERSION,
            rules_version: 1,
            protocol: Pubkey::new_unique(),
            content_version: 1,
            catalog_hash: [1; 32],
            rotation_id: 1,
            starts_day: 4,
            rotation_seed: [7; 32],
            scoring_rule_count: 15,
            scoring_rules: canonical_daily_scoring_rules(),
            pressure: DailyPressureProfile::canonical(),
            bump: 1,
        };
        for day in [4, 10, 11] {
            let week = zkube_core::week_id_for_day(day).unwrap();
            let weekday = day.saturating_add(3) % 7;
            let family = family_permutation(catalog.rotation_seed, week)[weekday as usize];
            assert_eq!(
                catalog.scoring_rule_for_day(day).unwrap(),
                catalog.rule_for_family_and_week(family, week).unwrap()
            );
        }
    }
}
