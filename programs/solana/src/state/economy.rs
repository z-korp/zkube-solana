//! Canonical economy and cadence accounts.
//!
//! Deterministic Arena rule rotation shared by paid play and free Practice.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::game::sha256v;

pub const ECONOMY_ACCOUNT_VERSION: u8 = 3;
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

#[cfg(any())]
mod superseded_soft_currency_state {
    use super::*;

    #[account]
    #[derive(InitSpace)]
    pub struct EconomyConfig {
        pub version: u8,
        pub protocol: Pubkey,
        pub content_version: u32,
        pub daily_rules_version: u32,
        pub revision: u64,
        pub daily_retry_cubes: u64,
        pub max_paid_daily_retries: u8,
        pub cube_pack_cubes: [u64; CUBE_PACK_COUNT],
        pub cube_pack_prices: [u64; CUBE_PACK_COUNT],
        pub cube_pack_enabled: [bool; CUBE_PACK_COUNT],
        pub sale_enabled: bool,
        pub sale_starts_at: i64,
        pub sale_ends_at: i64,
        pub sale_prices: [u64; CUBE_PACK_COUNT],
        pub team_sale_bps: u16,
        pub pot_sale_bps: u16,
        pub treasury_sale_bps: u16,
        pub pending_team_sale_bps: u16,
        pub pending_pot_sale_bps: u16,
        pub pending_treasury_sale_bps: u16,
        /// `u32::MAX` means there is no scheduled split change.
        pub split_activates_weekly: u32,
        pub bump: u8,
    }

    impl EconomyConfig {
        pub fn canonical(
            protocol: Pubkey,
            content_version: u32,
            daily_rules_version: u32,
            bump: u8,
        ) -> Self {
            Self {
                version: ECONOMY_ACCOUNT_VERSION,
                protocol,
                content_version,
                daily_rules_version,
                revision: 1,
                daily_retry_cubes: DAILY_RETRY_CUBES,
                max_paid_daily_retries: DAILY_MAX_PAID_RETRIES,
                cube_pack_cubes: CUBE_PACK_CUBES,
                cube_pack_prices: CUBE_PACK_PRICES,
                cube_pack_enabled: [true; CUBE_PACK_COUNT],
                sale_enabled: false,
                sale_starts_at: 0,
                sale_ends_at: 0,
                sale_prices: [0; CUBE_PACK_COUNT],
                team_sale_bps: TEAM_SALE_BPS,
                pot_sale_bps: POT_SALE_BPS,
                treasury_sale_bps: TREASURY_SALE_BPS,
                pending_team_sale_bps: 0,
                pending_pot_sale_bps: 0,
                pending_treasury_sale_bps: 0,
                split_activates_weekly: u32::MAX,
                bump,
            }
        }

        pub fn validate(&self) -> Result<()> {
            require!(
                self.version == ECONOMY_ACCOUNT_VERSION,
                ErrorCode::InvalidVersion
            );
            require!(self.content_version > 0, ErrorCode::ContentVersionMismatch);
            require!(self.daily_rules_version > 0, ErrorCode::InvalidState);
            require!(self.daily_retry_cubes > 0, ErrorCode::InvalidState);
            require!(self.max_paid_daily_retries > 0, ErrorCode::InvalidState);
            validate_cube_packs(
                self.cube_pack_cubes,
                self.cube_pack_prices,
                self.cube_pack_enabled,
            )?;
            validate_sale_split(
                self.team_sale_bps,
                self.pot_sale_bps,
                self.treasury_sale_bps,
            )?;
            if self.split_activates_weekly != u32::MAX {
                validate_sale_split(
                    self.pending_team_sale_bps,
                    self.pending_pot_sale_bps,
                    self.pending_treasury_sale_bps,
                )?;
            }
            if self.sale_enabled {
                require!(
                    self.sale_starts_at < self.sale_ends_at,
                    ErrorCode::InvalidState
                );
                require!(
                    self.sale_prices
                        .iter()
                        .zip(self.cube_pack_prices)
                        .zip(self.cube_pack_enabled)
                        .all(|((sale, regular), enabled)| !enabled
                            || (*sale > 0 && *sale <= regular)),
                    ErrorCode::InvalidPack
                );
            }
            Ok(())
        }

        pub fn quote(&self, pack_index: u8, now: i64) -> Result<(u64, u64)> {
            self.validate()?;
            let index = usize::from(pack_index);
            require!(
                index < CUBE_PACK_COUNT && self.cube_pack_enabled[index],
                ErrorCode::InvalidPack
            );
            let sale_is_live =
                self.sale_enabled && now >= self.sale_starts_at && now < self.sale_ends_at;
            let price = if sale_is_live {
                self.sale_prices[index]
            } else {
                self.cube_pack_prices[index]
            };
            Ok((self.cube_pack_cubes[index], price))
        }

        /// Dust from integer basis-point division is assigned to treasury.
        pub fn split_sale(&self, amount: u64, weekly_id: u32) -> Result<(u64, u64, u64)> {
            self.validate()?;
            let (team_bps, pot_bps, _) = self.sale_bps_for_weekly(weekly_id);
            let team = bps_floor(amount, team_bps)?;
            let reward = bps_floor(amount, pot_bps)?;
            let treasury = amount
                .checked_sub(team)
                .and_then(|remaining| remaining.checked_sub(reward))
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            Ok((team, reward, treasury))
        }

        pub fn sale_bps_for_weekly(&self, weekly_id: u32) -> (u16, u16, u16) {
            if self.split_activates_weekly != u32::MAX && weekly_id >= self.split_activates_weekly {
                (
                    self.pending_team_sale_bps,
                    self.pending_pot_sale_bps,
                    self.pending_treasury_sale_bps,
                )
            } else {
                (
                    self.team_sale_bps,
                    self.pot_sale_bps,
                    self.treasury_sale_bps,
                )
            }
        }
    }

    pub fn validate_sale_split(team: u16, pot: u16, treasury: u16) -> Result<()> {
        require!(team > 0 && pot > 0 && treasury > 0, ErrorCode::InvalidState);
        require!(
            u32::from(team) + u32::from(pot) + u32::from(treasury) == 10_000,
            ErrorCode::AccountingInvariant
        );
        Ok(())
    }

    /// Pack definitions are governed state, but their ordering and unit economics
    /// remain protocol invariants. Cross-multiplication avoids rounding when
    /// proving that every larger enabled pack is no worse per Cube.
    pub fn validate_cube_packs(
        cubes: [u64; CUBE_PACK_COUNT],
        prices: [u64; CUBE_PACK_COUNT],
        enabled: [bool; CUBE_PACK_COUNT],
    ) -> Result<()> {
        require!(enabled.iter().any(|value| *value), ErrorCode::InvalidPack);
        for index in 0..CUBE_PACK_COUNT {
            require!(cubes[index] > 0, ErrorCode::InvalidPack);
            require!(prices[index] > 0, ErrorCode::InvalidPack);
            if index == 0 {
                continue;
            }
            require!(cubes[index - 1] < cubes[index], ErrorCode::InvalidPack);
            require!(prices[index - 1] < prices[index], ErrorCode::InvalidPack);
            let previous_unit = u128::from(prices[index - 1])
                .checked_mul(u128::from(cubes[index]))
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            let current_unit = u128::from(prices[index])
                .checked_mul(u128::from(cubes[index - 1]))
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            require!(current_unit <= previous_unit, ErrorCode::InvalidPack);
        }
        Ok(())
    }

    #[account]
    #[derive(InitSpace)]
    pub struct CubeSalesLedger {
        pub version: u8,
        pub economy_config: Pubkey,
        pub lifetime_gross_sales: u64,
        pub lifetime_team_share: u64,
        pub lifetime_reward_share: u64,
        pub lifetime_treasury_share: u64,
        pub lifetime_cubes_sold: u64,
        pub purchase_count: u64,
        pub bump: u8,
    }

    impl CubeSalesLedger {
        pub fn record_sale(
            &mut self,
            gross: u64,
            team: u64,
            reward: u64,
            treasury: u64,
            cubes: u64,
        ) -> Result<()> {
            require!(gross > 0 && cubes > 0, ErrorCode::AccountingInvariant);
            require!(
                team.checked_add(reward)
                    .and_then(|sum| sum.checked_add(treasury))
                    == Some(gross),
                ErrorCode::AccountingInvariant
            );
            self.lifetime_gross_sales = checked_add(self.lifetime_gross_sales, gross)?;
            self.lifetime_team_share = checked_add(self.lifetime_team_share, team)?;
            self.lifetime_reward_share = checked_add(self.lifetime_reward_share, reward)?;
            self.lifetime_treasury_share = checked_add(self.lifetime_treasury_share, treasury)?;
            self.lifetime_cubes_sold = checked_add(self.lifetime_cubes_sold, cubes)?;
            self.purchase_count = checked_add(self.purchase_count, 1)?;
            self.assert_conservation()
        }

        pub fn assert_conservation(&self) -> Result<()> {
            require!(
                self.lifetime_team_share
                    .checked_add(self.lifetime_reward_share)
                    .and_then(|sum| sum.checked_add(self.lifetime_treasury_share))
                    == Some(self.lifetime_gross_sales),
                ErrorCode::AccountingInvariant
            );
            Ok(())
        }
    }
}

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
    pub weekly_id: u32,
    pub starts_day: u32,
    pub weekly_seed: [u8; 32],
    pub scoring_rule_count: u8,
    pub scoring_rules: [DailyScoringRule; DAILY_SCORE_RULE_CAPACITY],
    pub pressure: DailyPressureProfile,
    pub bump: u8,
}

impl DailyRulesCatalog {
    pub fn validate(&self) -> Result<()> {
        require!(
            self.version == ECONOMY_ACCOUNT_VERSION
                && self.rules_version > 0
                && self.weekly_id > 0
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
        let family = family_permutation(self.weekly_seed, week_id)[weekday as usize];
        self.rule_for_family_and_week(family, week_id)
    }

    pub fn map_for_day(&self, day_id: u32) -> u8 {
        const COPRIME_STEPS: [u64; 4] = [1, 3, 7, 9];
        let offset = daily_hash_u64(self.weekly_seed, b"theme-offset", 0, 0) % 10;
        let step_index =
            daily_hash_u64(self.weekly_seed, b"theme-step", 0, 0) as usize % COPRIME_STEPS.len();
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
            daily_hash_u64(self.weekly_seed, b"variant", u32::from(family), 0) as usize % count;
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

#[cfg(any())]
mod superseded_claim_state {
    use super::*;

    #[account]
    #[derive(InitSpace)]
    pub struct DailyChallenge {
        pub version: u8,
        pub day_id: u32,
        pub weekly_id: u32,
        pub economy_config: Pubkey,
        /// Receives the challenge and leaderboard rent when cleanup completes.
        pub rent_recipient: Pubkey,
        pub rules_version: u32,
        pub status: DailyStatus,
        pub content_version: u32,
        pub catalog_hash: [u8; 32],
        pub rules_hash: [u8; 32],
        pub rules_weekly_id: u32,
        pub map_id: u8,
        pub scoring_rule: DailyScoringRule,
        pub rules: LevelRuleSnapshot,
        pub pressure: DailyPressureProfile,
        pub opens_at: i64,
        pub entries_close_at: i64,
        pub runs_close_at: i64,
        pub settlement_grace_close_at: i64,
        pub finalized_at: i64,
        pub retry_cubes: u64,
        pub max_paid_retries: u8,
        pub unique_players: u32,
        /// Number of DailyPlayer records whose rent has returned to their owner vault.
        pub closed_players: u32,
        pub weekly_eligible_players: u32,
        pub weekly_rollups: u32,
        pub attempts_started: u64,
        pub runs_finalized: u64,
        pub bump: u8,
    }

    #[account]
    #[derive(InitSpace)]
    pub struct DailyPlayer {
        pub version: u8,
        pub challenge: Pubkey,
        pub player: Pubkey,
        pub attempts: u32,
        pub paid_attempts: u8,
        pub finalized_attempts: u32,
        pub best_run_id: u64,
        pub best_daily_score: u32,
        pub best_daily_bonus_triggers: u16,
        pub best_engine_score: u32,
        pub best_moves: u16,
        pub best_submitted_at: i64,
        pub daily_xp_awarded: bool,
        pub pressure_mastery_xp_awarded: bool,
        pub weekly_rolled_up: bool,
        pub cube_refunded: bool,
        pub bump: u8,
    }

    #[account]
    #[derive(InitSpace)]
    pub struct DailyLeaderboard {
        pub version: u8,
        pub challenge: Pubkey,
        #[max_len(DAILY_LEADERBOARD_CAPACITY)]
        pub entries: Vec<DailyLeaderboardEntry>,
        pub bump: u8,
    }

    #[derive(
        AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
    )]
    pub struct DailyLeaderboardEntry {
        pub player: Pubkey,
        pub run_id: u64,
        pub daily_score: u32,
        pub daily_bonus_triggers: u16,
        pub engine_score: u32,
        pub moves: u16,
        pub finalized_attempts: u32,
        pub submitted_at: i64,
    }

    impl DailyLeaderboard {
        pub fn record_best(&mut self, entry: DailyLeaderboardEntry) {
            if let Some(index) = self
                .entries
                .iter()
                .position(|current| current.player == entry.player)
            {
                self.entries.remove(index);
            }
            let index = self
                .entries
                .binary_search_by(|current| compare_daily_entries(current, &entry))
                .unwrap_or_else(|index| index);
            self.entries.insert(index, entry);
            if self.entries.len() > DAILY_LEADERBOARD_CAPACITY {
                self.entries.pop();
            }
        }

        pub fn rank_of(&self, player: Pubkey) -> Option<usize> {
            let entry = self.entries.iter().find(|entry| entry.player == player)?;
            Some(
                self.entries
                    .iter()
                    .filter(|current| compare_daily_entries(current, entry).is_lt())
                    .count(),
            )
        }
    }

    pub fn daily_entry_is_better(
        candidate: &DailyLeaderboardEntry,
        current: &DailyLeaderboardEntry,
    ) -> bool {
        compare_daily_entries(candidate, current).is_lt()
    }

    #[derive(
        AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
    )]
    pub enum LegacyWeeklyStatus {
        #[default]
        Open,
        Claimable,
        Closed,
    }

    #[account]
    #[derive(InitSpace)]
    pub struct WeeklyChallenge {
        pub version: u8,
        pub weekly_id: u32,
        pub economy_config: Pubkey,
        /// Receives the challenge and leaderboard rent when cleanup completes.
        pub rent_recipient: Pubkey,
        pub status: LegacyWeeklyStatus,
        pub opens_at: i64,
        pub closes_at: i64,
        pub finalizes_at: i64,
        pub finalized_at: i64,
        pub claims_close_at: i64,
        pub committed_sol_pool: u64,
        pub purchase_funded_sol: u64,
        pub founder_seeded_sol: u64,
        pub rolled_over_sol: u64,
        pub sol_claimed: u64,
        pub sol_forfeited: u64,
        pub participants: u32,
        /// Number of LegacyWeeklyPlayer records whose rent has returned to their owner vault.
        pub closed_players: u32,
        pub sol_winner_count: u8,
        pub cube_winner_count: u8,
        pub bump: u8,
    }

    #[derive(
        AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
    )]
    pub struct WeeklyDailyResult {
        pub day_id: u32,
        pub points: u16,
    }

    #[account]
    #[derive(InitSpace)]
    pub struct LegacyWeeklyPlayer {
        pub version: u8,
        pub challenge: Pubkey,
        pub player: Pubkey,
        pub results: [WeeklyDailyResult; SEASON_DAILY_RESULTS],
        pub result_count: u8,
        pub score: u16,
        pub sol_claimed: bool,
        pub cubes_claimed: bool,
        pub bump: u8,
    }

    impl LegacyWeeklyPlayer {
        pub fn record_daily(&mut self, day_id: u32, points: u16) -> Result<()> {
            require!(
                !self.results[..usize::from(self.result_count)]
                    .iter()
                    .any(|result| result.day_id == day_id),
                ErrorCode::AlreadySubmitted
            );
            let index = usize::from(self.result_count);
            require!(index < SEASON_DAILY_RESULTS, ErrorCode::InvalidState);
            self.results[index] = WeeklyDailyResult { day_id, points };
            self.result_count = self
                .result_count
                .checked_add(1)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            self.score = best_ten_score(&self.results[..usize::from(self.result_count)])?;
            Ok(())
        }
    }

    #[account]
    #[derive(InitSpace)]
    pub struct WeeklyLeaderboard {
        pub version: u8,
        pub challenge: Pubkey,
        #[max_len(SEASON_LEADERBOARD_CAPACITY)]
        pub entries: Vec<WeeklyLeaderboardEntry>,
        pub bump: u8,
    }

    #[derive(
        AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
    )]
    pub struct WeeklyLeaderboardEntry {
        pub player: Pubkey,
        pub score: u16,
        pub updated_at: i64,
    }

    impl WeeklyLeaderboard {
        pub fn record_score(&mut self, entry: WeeklyLeaderboardEntry) {
            self.entries
                .retain(|current| current.player != entry.player);
            self.entries.push(entry);
            self.entries.sort_unstable_by(|left, right| {
                right
                    .score
                    .cmp(&left.score)
                    .then_with(|| left.updated_at.cmp(&right.updated_at))
                    .then_with(|| left.player.to_bytes().cmp(&right.player.to_bytes()))
            });
            self.entries.truncate(SEASON_LEADERBOARD_CAPACITY);
        }

        pub fn rank_of(&self, player: Pubkey) -> Option<usize> {
            self.entries.iter().position(|entry| entry.player == player)
        }
    }
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
    day_id.saturating_add(3) / 7
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

#[cfg(any())]
pub fn weekly_winner_counts(participants: u32, has_sol_pool: bool) -> (u8, u8) {
    if participants == 0 {
        return (0, 0);
    }
    let sol = if has_sol_pool {
        participants.min(5) as u8
    } else {
        0
    };
    let cubes = participants.saturating_sub(5).min(15) as u8;
    (sol, cubes)
}

#[cfg(any())]
pub fn weekly_sol_amount(pool: u64, rank: usize, winner_count: u8) -> Result<u64> {
    require!(winner_count > 0 && winner_count <= 5, ErrorCode::NoPrize);
    require!(rank < usize::from(winner_count), ErrorCode::NoPrize);
    let active = &SEASON_SOL_WEIGHTS[..usize::from(winner_count)];
    let denominator = active.iter().try_fold(0u64, |sum, weight| {
        sum.checked_add(u64::from(*weight))
            .ok_or(ErrorCode::ArithmeticOverflow)
    })?;
    if rank + 1 == usize::from(winner_count) {
        let prior = active[..rank].iter().try_fold(0u64, |sum, weight| {
            let amount = u128::from(pool)
                .checked_mul(u128::from(*weight))
                .and_then(|value| value.checked_div(u128::from(denominator)))
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            let amount = u64::try_from(amount).map_err(|_| ErrorCode::ArithmeticOverflow)?;
            sum.checked_add(amount).ok_or(ErrorCode::ArithmeticOverflow)
        })?;
        return pool
            .checked_sub(prior)
            .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow));
    }
    let amount = u128::from(pool)
        .checked_mul(u128::from(active[rank]))
        .and_then(|value| value.checked_div(u128::from(denominator)))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    u64::try_from(amount).map_err(|_| error!(ErrorCode::ArithmeticOverflow))
}

#[cfg(any())]
pub fn weekly_cube_amount(relative_rank: usize, cube_winner_count: u8) -> Result<u64> {
    let count = usize::from(cube_winner_count);
    require!(count > 0 && relative_rank < count, ErrorCode::NoPrize);
    let tier = (relative_rank / 3).min(4);
    Ok(SEASON_CUBE_REWARDS[tier])
}

#[cfg(any())]
pub fn weekly_cube_reward_for_rank(
    rank: usize,
    _sol_winner_count: u8,
    cube_winner_count: u8,
) -> Result<u64> {
    const CUBE_PRIZE_START_RANK: usize = 5;
    require!(rank >= CUBE_PRIZE_START_RANK, ErrorCode::NoPrize);
    weekly_cube_amount(rank - CUBE_PRIZE_START_RANK, cube_winner_count)
}

#[cfg(any())]
fn compare_daily_entries(
    left: &DailyLeaderboardEntry,
    right: &DailyLeaderboardEntry,
) -> std::cmp::Ordering {
    right
        .daily_score
        .cmp(&left.daily_score)
        .then_with(|| right.daily_bonus_triggers.cmp(&left.daily_bonus_triggers))
        .then_with(|| left.submitted_at.cmp(&right.submitted_at))
}

#[cfg(any())]
fn best_ten_score(results: &[WeeklyDailyResult]) -> Result<u16> {
    let mut points = [0u16; SEASON_DAILY_RESULTS];
    for (index, result) in results.iter().enumerate() {
        points[index] = result.points;
    }
    points.sort_unstable_by(|left, right| right.cmp(left));
    points[..SEASON_COUNTED_DAYS]
        .iter()
        .try_fold(0u16, |sum, value| {
            sum.checked_add(*value).ok_or(ErrorCode::ArithmeticOverflow)
        })
        .map_err(Into::into)
}

#[cfg(any())]
fn bps_floor(amount: u64, bps: u16) -> Result<u64> {
    let value = u128::from(amount)
        .checked_mul(u128::from(bps))
        .and_then(|product| product.checked_div(10_000))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    u64::try_from(value).map_err(|_| error!(ErrorCode::ArithmeticOverflow))
}

#[cfg(any())]
fn checked_add(left: u64, right: u64) -> Result<u64> {
    left.checked_add(right)
        .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
}

#[cfg(all(test, any()))]
mod tests {
    use super::*;

    fn daily_catalog() -> DailyRulesCatalog {
        DailyRulesCatalog {
            version: ECONOMY_ACCOUNT_VERSION,
            rules_version: 1,
            economy_config: Pubkey::new_unique(),
            content_version: 1,
            catalog_hash: [4; 32],
            weekly_id: 1,
            starts_day: 0,
            weekly_seed: [7; 32],
            scoring_rule_count: 15,
            scoring_rules: canonical_daily_scoring_rules(),
            pressure: DailyPressureProfile::canonical(),
            bump: 1,
        }
    }

    #[test]
    fn canonical_sale_split_is_twenty_forty_forty_and_conserves_dust() {
        let config = EconomyConfig::canonical(Pubkey::new_unique(), 2, 1, 1);
        assert_eq!(
            config.split_sale(1_000_000, 0).unwrap(),
            (200_000, 400_000, 400_000)
        );
        assert_eq!(config.split_sale(11, 0).unwrap(), (2, 4, 5));
        for amount in [1, 9, 10, 11, 4_750_000, 80_000_001, u64::MAX] {
            let (team, reward, treasury) = config.split_sale(amount, 0).unwrap();
            assert_eq!(
                team.checked_add(reward)
                    .and_then(|sum| sum.checked_add(treasury)),
                Some(amount)
            );
        }
    }

    #[test]
    fn governed_cube_packs_are_ordered_with_monotonic_bulk_value() {
        validate_cube_packs(CUBE_PACK_CUBES, CUBE_PACK_PRICES, [true; CUBE_PACK_COUNT]).unwrap();
        assert!(validate_cube_packs(
            [10, 50, 200, 500],
            [20_000_000, 90_000_000, 300_000_000, 800_000_000],
            [true; CUBE_PACK_COUNT],
        )
        .is_err());
        assert!(
            validate_cube_packs([10, 50, 50, 500], CUBE_PACK_PRICES, [true; CUBE_PACK_COUNT],)
                .is_err()
        );
        assert!(
            validate_cube_packs(CUBE_PACK_CUBES, CUBE_PACK_PRICES, [false; CUBE_PACK_COUNT])
                .is_err()
        );
    }

    #[test]
    fn canonical_daily_catalog_has_fifteen_unique_weighted_rules() {
        let catalog = daily_catalog();
        catalog.validate().unwrap();
        let active = &catalog.scoring_rules[..usize::from(catalog.scoring_rule_count)];
        assert_eq!(active.len(), 15);
        assert_eq!(active[0].bonus_multiplier_x100, 0);
        assert!(active[1..]
            .iter()
            .all(|rule| rule.bonus_multiplier_x100 > 0));
        assert_eq!(
            active.iter().map(|rule| rule.id).collect::<Vec<_>>(),
            (1..=15).collect::<Vec<_>>()
        );
    }

    #[test]
    fn sale_quotes_switch_only_inside_the_half_open_window() {
        let mut config = EconomyConfig::canonical(Pubkey::new_unique(), 2, 1, 1);
        config.sale_enabled = true;
        config.sale_starts_at = 100;
        config.sale_ends_at = 200;
        config.sale_prices = [9_000_000, 40_000_000, 80_000_000, 400_000_000];

        assert_eq!(config.quote(0, 99).unwrap(), (10, 20_000_000));
        assert_eq!(config.quote(0, 100).unwrap(), (10, 9_000_000));
        assert_eq!(config.quote(0, 199).unwrap(), (10, 9_000_000));
        assert_eq!(config.quote(0, 200).unwrap(), (10, 20_000_000));

        config.cube_pack_enabled[0] = false;
        assert!(config.quote(0, 150).is_err());
        assert!(config.quote(CUBE_PACK_COUNT as u8, 150).is_err());
    }

    #[test]
    fn daily_points_use_cumulative_percentiles_and_rank_caps() {
        assert_eq!(daily_points_for_rank(Some(0), 1), 100);
        assert_eq!(daily_points_for_rank(Some(2), 1_000), 100);
        assert_eq!(daily_points_for_rank(Some(3), 1_000), 60);
        assert_eq!(daily_points_for_rank(Some(10), 1_000), 30);
        assert_eq!(daily_points_for_rank(Some(20), 1_000), 10);
        assert_eq!(daily_points_for_rank(None, 1_000), 2);
    }

    #[test]
    fn procedural_daily_rotation_covers_every_family_each_week() {
        let catalog = daily_catalog();
        catalog.validate().unwrap();
        for week in 100..110 {
            let start_day = week * 7 - 3;
            let mut families = [false; DAILY_SCORE_FAMILY_COUNT];
            for offset in 0..7 {
                let rule = catalog.scoring_rule_for_day(start_day + offset).unwrap();
                families[usize::from(rule.family)] = true;
            }
            assert!(families.into_iter().all(|present| present));
        }
    }

    #[test]
    fn procedural_variants_and_themes_avoid_immediate_repeats() {
        let catalog = daily_catalog();
        for family in 1..=5 {
            for week in 1..20 {
                let current = catalog.rule_for_family_and_week(family, week).unwrap();
                let prior = catalog.rule_for_family_and_week(family, week - 1).unwrap();
                assert_ne!(current.id, prior.id);
            }
        }
        for day in 1..100 {
            assert_ne!(catalog.map_for_day(day), catalog.map_for_day(day - 1));
        }
    }

    #[test]
    fn pressure_profile_is_playable_and_advances_at_boundaries() {
        let pressure = DailyPressureProfile::canonical();
        pressure.validate().unwrap();
        assert_eq!(pressure.max_moves, 100);
        assert_eq!(pressure.difficulty_for_score(7), 0);
        assert_eq!(pressure.difficulty_for_score(8), 1);
        assert_eq!(pressure.difficulty_for_score(78), 7);
    }

    #[test]
    fn daily_leaderboard_uses_score_triggers_then_earlier_completion() {
        let player = Pubkey::new_unique();
        let mut entries = vec![
            DailyLeaderboardEntry {
                player,
                run_id: 1,
                daily_score: 10,
                daily_bonus_triggers: 3,
                engine_score: 5,
                moves: 70,
                finalized_attempts: 1,
                submitted_at: 99,
            },
            DailyLeaderboardEntry {
                player: Pubkey::new_unique(),
                run_id: 2,
                daily_score: 10,
                daily_bonus_triggers: 2,
                engine_score: 8,
                moves: 90,
                finalized_attempts: 1,
                submitted_at: 1,
            },
            DailyLeaderboardEntry {
                player: Pubkey::new_unique(),
                run_id: 3,
                daily_score: 11,
                daily_bonus_triggers: 0,
                engine_score: 1,
                moves: 1,
                finalized_attempts: 1,
                submitted_at: 3,
            },
            DailyLeaderboardEntry {
                player: Pubkey::new_unique(),
                run_id: 4,
                daily_score: 10,
                daily_bonus_triggers: 3,
                engine_score: 1,
                moves: 1,
                finalized_attempts: 1,
                submitted_at: 50,
            },
        ];
        entries.sort_unstable_by(compare_daily_entries);
        assert_eq!(entries[0].run_id, 3);
        assert_eq!(entries[1].run_id, 4);
        assert_eq!(entries[2].run_id, 1);
        assert_eq!(entries[3].run_id, 2);

        let statistical_tie = DailyLeaderboardEntry {
            player: Pubkey::new_unique(),
            run_id: 5,
            engine_score: 999,
            moves: 0,
            ..entries[2]
        };
        assert_eq!(
            compare_daily_entries(&entries[2], &statistical_tie),
            std::cmp::Ordering::Equal
        );
        let board = DailyLeaderboard {
            version: ECONOMY_ACCOUNT_VERSION,
            challenge: Pubkey::new_unique(),
            entries: vec![entries[2], statistical_tie],
            bump: 1,
        };
        assert_eq!(board.rank_of(entries[2].player), Some(0));
        assert_eq!(board.rank_of(statistical_tie.player), Some(0));
    }

    #[test]
    fn weekly_score_counts_only_best_ten_days() {
        let mut player = LegacyWeeklyPlayer {
            version: ECONOMY_ACCOUNT_VERSION,
            challenge: Pubkey::new_unique(),
            player: Pubkey::new_unique(),
            results: [WeeklyDailyResult::default(); SEASON_DAILY_RESULTS],
            result_count: 0,
            score: 0,
            sol_claimed: false,
            cubes_claimed: false,
            bump: 1,
        };
        for (day, points) in [2, 100, 10, 60, 30, 2, 10, 5, 90, 80, 70, 40, 20, 1]
            .into_iter()
            .enumerate()
        {
            player.record_daily(day as u32, points).unwrap();
        }
        assert_eq!(player.score, 510);
        assert!(player.record_daily(0, 100).is_err());
    }

    #[test]
    fn winner_bands_and_rewards_match_policy() {
        assert_eq!(weekly_winner_counts(1, true), (1, 0));
        assert_eq!(weekly_winner_counts(21, true), (5, 15));
        assert_eq!(weekly_winner_counts(1_000, true), (5, 15));
        assert_eq!(weekly_winner_counts(1_000, false), (0, 15));
        assert_eq!(weekly_sol_amount(100, 0, 1).unwrap(), 100);
        assert_eq!(weekly_sol_amount(85, 0, 2).unwrap(), 54);
        assert_eq!(weekly_sol_amount(85, 1, 2).unwrap(), 31);
        assert_eq!(weekly_cube_amount(0, 15).unwrap(), 30);
        assert_eq!(weekly_cube_amount(4, 15).unwrap(), 25);
        assert_eq!(weekly_cube_amount(14, 15).unwrap(), 10);
    }

    #[test]
    fn level_curve_and_monday_week_boundaries_are_stable() {
        assert_eq!(player_level(0), 1);
        assert_eq!(player_level(1_599), 9);
        assert_eq!(player_level(1_600), 10);
        assert_eq!(player_level(160_000), 100);
        assert_eq!(weekly_id_for_day(3), 0);
        assert_eq!(weekly_id_for_day(4), 1);
        let (open, close, finalize) = weekly_window(1).unwrap();
        assert_eq!(open, 11 * SECONDS_PER_DAY);
        assert_eq!(close, 25 * SECONDS_PER_DAY);
        assert_eq!(finalize, close + SEASON_FINALIZE_DELAY_SECONDS);
    }

    #[test]
    fn economy_accounts_fit_normal_account_limits() {
        let sizes = [
            EconomyConfig::INIT_SPACE,
            CubeSalesLedger::INIT_SPACE,
            DailyRulesCatalog::INIT_SPACE,
            DailyChallenge::INIT_SPACE,
            DailyPlayer::INIT_SPACE,
            DailyLeaderboard::INIT_SPACE,
            WeeklyChallenge::INIT_SPACE,
            LegacyWeeklyPlayer::INIT_SPACE,
            WeeklyLeaderboard::INIT_SPACE,
        ];
        assert!(sizes.into_iter().all(|size| size < 10_240));
    }

    #[test]
    fn cadence_account_allocations_include_full_leaderboard_capacity() {
        assert_eq!(8 + DailyChallenge::INIT_SPACE, 416);
        assert_eq!(8 + DailyLeaderboard::INIT_SPACE, 3_246);
        assert_eq!(8 + DailyPlayer::INIT_SPACE, 115);
        assert_eq!(8 + WeeklyChallenge::INIT_SPACE, 177);
        assert_eq!(8 + WeeklyLeaderboard::INIT_SPACE, 2_146);
    }

    #[test]
    fn cube_prizes_are_separate_from_the_top_five_sol_winners() {
        assert!(weekly_cube_reward_for_rank(0, 5, 15).is_err());
        assert!(weekly_cube_reward_for_rank(4, 5, 15).is_err());
        assert_eq!(weekly_cube_reward_for_rank(5, 5, 15).unwrap(), 30);
        assert_eq!(weekly_cube_reward_for_rank(19, 5, 15).unwrap(), 10);
        assert!(weekly_cube_reward_for_rank(20, 5, 15).is_err());
    }
}
