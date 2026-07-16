//! Protocol, player, catalog, and transient-run accounts.
//!
//! These are the only account types exported by the compiled program.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::economy::{DailyPressureProfile, DailyScoringRule};

pub const PROTOCOL_CONFIG_SEED: &[u8] = b"protocol";
pub const PLAYER_STATE_SEED: &[u8] = b"player";
pub const MAP_CATALOG_SEED: &[u8] = b"map";
pub const ACTIVE_RUN_SEED: &[u8] = b"run";
pub const PLAYER_FUNDING_SEED: &[u8] = b"player_funding";
pub const REWARD_VAULT_SEED: &[u8] = b"reward_vault";

pub const ACCOUNT_VERSION: u8 = 1;
pub const MAX_MAPS: usize = 32;
pub const LEVELS_PER_MAP: usize = 10;
pub const MAX_QUEST_COUNTERS: usize = 16;
pub const MAX_ACHIEVEMENTS: usize = 24;
pub const MAX_QUESTS: usize = 12;
pub const DAILY_ACTIVE_QUESTS: usize = 3;
pub const DAILY_FINISHER_INDEX: usize = 9;
pub const BLOCK_QUEST_COUNTERS: [usize; 4] = [7, 12, 13, 14];
/// Run identifiers are per-player and begin at one on every fresh deployment.
pub const INITIAL_RUN_ID: u64 = 1;
/// Reusable owner-funded float: current maximum run/delegation rent plus a
/// 20% safety margin, rounded up to the next 0.001 SOL.
pub const PLAYER_FUNDING_TARGET_LAMPORTS: u64 = 25_000_000;

#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub version: u8,
    pub authority: Pubkey,
    pub pending_authority: Pubkey,
    pub pricing_operator: Pubkey,
    pub team_destination: Pubkey,
    pub treasury_destination: Pubkey,
    pub reward_vault: Pubkey,
    pub content_version: u32,
    pub player_funding_target_lamports: u64,
    /// Number of contiguous, authority-activated Campaign maps.
    pub campaign_map_count: u8,
    pub paused: bool,
    pub bump: u8,
}

/// Program-owned native-SOL reserve used only for bounded Weekly prizes.
#[account]
#[derive(InitSpace)]
pub struct RewardVault {
    pub version: u8,
    pub protocol: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct PlayerState {
    pub version: u8,
    pub owner: Pubkey,
    pub stars_balance: u64,
    pub lifetime_stars_earned: u64,
    pub lifetime_stars_spent: u64,
    pub next_run_id: u64,
    /// Zero when idle; otherwise the only run that may exist for this owner.
    /// This durable pointer makes resume deterministic across devices and
    /// prevents two valid device sessions from opening concurrent runs.
    pub active_run_id: u64,
    pub daily_eligible: bool,
    /// Bit per canonical achievement; the catalog is bounded to 24 entries.
    pub achievement_flags: u32,
    /// All progression XP, regardless of whether it came from achievements,
    /// quests, Daily play, or finite Campaign rewards.
    pub lifetime_xp: u64,
    pub quest_cadence_day: u32,
    pub quest_cadence_week: u32,
    pub quest_counters: [u32; MAX_QUEST_COUNTERS],
    pub lifetime_runs_started: u64,
    pub lifetime_lines_cleared: u64,
    pub lifetime_bosses_cleared: u64,
    pub lifetime_perfect_levels: u64,
    pub lifetime_daily_challenges: u64,
    pub lifetime_bonus_uses: u64,
    pub lifetime_max_combo: u8,
    pub last_daily_challenge_day: u32,
    /// Bit `map_id - 1`; Map 1 is unlocked on initialization.
    pub unlocked_maps: u32,
    pub purchased_maps: u32,
    pub cleared_maps: u32,
    pub perfected_maps: u32,
    /// Two bits per Campaign level across all maps.
    pub level_stars: [u8; 80],
    pub daily_claim_cadence_id: u32,
    pub weekly_claim_cadence_id: u32,
    pub daily_claimed: u16,
    pub weekly_claimed: u16,
    /// Bits 0..9 represent levels 10, 20, ... 100.
    pub milestone_claimed: u16,
    pub milestone_stars_claimed: u64,
    pub stipend_week_id: u32,
    pub stipend_recurring_xp: u32,
    pub stipend_stars_awarded: bool,
    pub lifetime_stipend_stars_awarded: u64,
    pub bump: u8,
}

impl PlayerState {
    pub fn initialize(owner: Pubkey, bump: u8) -> Self {
        Self {
            version: ACCOUNT_VERSION,
            owner,
            stars_balance: 0,
            lifetime_stars_earned: 0,
            lifetime_stars_spent: 0,
            next_run_id: INITIAL_RUN_ID,
            active_run_id: 0,
            daily_eligible: false,
            achievement_flags: 0,
            lifetime_xp: 0,
            quest_cadence_day: 0,
            quest_cadence_week: 0,
            quest_counters: [0; MAX_QUEST_COUNTERS],
            lifetime_runs_started: 0,
            lifetime_lines_cleared: 0,
            lifetime_bosses_cleared: 0,
            lifetime_perfect_levels: 0,
            lifetime_daily_challenges: 0,
            lifetime_bonus_uses: 0,
            lifetime_max_combo: 0,
            last_daily_challenge_day: u32::MAX,
            unlocked_maps: 1,
            purchased_maps: 0,
            cleared_maps: 0,
            perfected_maps: 0,
            level_stars: [0; 80],
            daily_claim_cadence_id: 0,
            weekly_claim_cadence_id: 0,
            daily_claimed: 0,
            weekly_claimed: 0,
            milestone_claimed: 0,
            milestone_stars_claimed: 0,
            stipend_week_id: 0,
            stipend_recurring_xp: 0,
            stipend_stars_awarded: false,
            lifetime_stipend_stars_awarded: 0,
            bump,
        }
    }

    /// Atomically reserves the next monotonic run id for this owner.
    pub fn reserve_run(&mut self, run_id: u64) -> Result<()> {
        require!(self.next_run_id == run_id, ErrorCode::InvalidRunId);
        require!(self.active_run_id == 0, ErrorCode::ActiveRunExists);
        self.next_run_id = self
            .next_run_id
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        self.active_run_id = run_id;
        Ok(())
    }

    /// Releases only the exact run pinned in durable state while its terminal
    /// ActiveRun is atomically consumed and closed on the base layer.
    pub fn release_run(&mut self, run_id: u64) -> Result<()> {
        require!(self.active_run_id == run_id, ErrorCode::InvalidRunId);
        self.active_run_id = 0;
        Ok(())
    }

    pub fn credit_stars(&mut self, amount: u64) -> Result<()> {
        self.stars_balance = self
            .stars_balance
            .checked_add(amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        self.lifetime_stars_earned = self
            .lifetime_stars_earned
            .checked_add(amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn credit_progression_rewards(&mut self, stars: u64, xp: u32) -> Result<()> {
        if stars > 0 {
            self.credit_stars(stars)?;
        }
        self.lifetime_xp = self
            .lifetime_xp
            .checked_add(u64::from(xp))
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn spend_stars(&mut self, amount: u64) -> Result<()> {
        require!(self.stars_balance >= amount, ErrorCode::InsufficientStars);
        self.stars_balance = self
            .stars_balance
            .checked_sub(amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        self.lifetime_stars_spent = self
            .lifetime_stars_spent
            .checked_add(amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn refund_stars(&mut self, amount: u64) -> Result<()> {
        self.stars_balance = self
            .stars_balance
            .checked_add(amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        self.lifetime_stars_spent = self
            .lifetime_stars_spent
            .checked_sub(amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn roll_quest_cadences(&mut self, now: i64) {
        let day = cadence_day(now);
        let week = cadence_week(now);
        if self.quest_cadence_day != day {
            self.quest_cadence_day = day;
            self.quest_counters[..10].fill(0);
            self.quest_counters[12..15].fill(0);
        }
        if self.quest_cadence_week != week {
            self.quest_cadence_week = week;
            self.quest_counters[10..12].fill(0);
        }
    }

    pub fn record_run_started(&mut self, now: i64) -> Result<()> {
        self.roll_quest_cadences(now);
        self.lifetime_runs_started = checked_add_u64(self.lifetime_runs_started, 1)?;
        Ok(())
    }

    pub fn record_daily_join(&mut self, day_id: u32, now: i64) -> Result<()> {
        self.roll_quest_cadences(now);
        if self.last_daily_challenge_day != day_id {
            self.last_daily_challenge_day = day_id;
            self.lifetime_daily_challenges = checked_add_u64(self.lifetime_daily_challenges, 1)?;
            self.quest_counters[4] = checked_add_u32(self.quest_counters[4], 1)?;
            self.quest_counters[11] = checked_add_u32(self.quest_counters[11], 1)?;
        }
        Ok(())
    }

    pub fn record_run_metrics(&mut self, metrics: RunProgressMetrics, now: i64) -> Result<()> {
        self.roll_quest_cadences(now);
        self.lifetime_lines_cleared = checked_add_u64(
            self.lifetime_lines_cleared,
            u64::from(metrics.lines_cleared),
        )?;
        self.lifetime_bonus_uses =
            checked_add_u64(self.lifetime_bonus_uses, u64::from(metrics.bonus_uses))?;
        self.lifetime_max_combo = self.lifetime_max_combo.max(metrics.max_combo);
        self.quest_counters[0] =
            checked_add_u32(self.quest_counters[0], u32::from(metrics.lines_cleared))?;
        self.quest_counters[1] =
            checked_add_u32(self.quest_counters[1], u32::from(metrics.bonus_uses))?;
        self.quest_counters[2] =
            checked_add_u32(self.quest_counters[2], u32::from(metrics.high_combo_hits))?;
        self.quest_counters[3] =
            checked_add_u32(self.quest_counters[3], u32::from(metrics.combo3_hits))?;
        self.quest_counters[6] =
            checked_add_u32(self.quest_counters[6], u32::from(metrics.combo4_hits))?;
        self.quest_counters[8] =
            checked_add_u32(self.quest_counters[8], u32::from(metrics.combo2_hits))?;
        for (counter, destroyed) in BLOCK_QUEST_COUNTERS
            .into_iter()
            .zip(metrics.blocks_destroyed_by_size)
        {
            self.quest_counters[counter] =
                checked_add_u32(self.quest_counters[counter], u32::from(destroyed))?;
        }
        self.quest_counters[10] =
            checked_add_u32(self.quest_counters[10], u32::from(metrics.lines_cleared))?;
        if metrics.campaign_level_completed {
            self.quest_counters[5] = checked_add_u32(self.quest_counters[5], 1)?;
        }
        if metrics.new_perfect_level {
            self.lifetime_perfect_levels = checked_add_u64(self.lifetime_perfect_levels, 1)?;
        }
        if metrics.boss_cleared {
            self.lifetime_bosses_cleared = checked_add_u64(self.lifetime_bosses_cleared, 1)?;
        }
        Ok(())
    }

    pub fn achievement_metric(&self, metric: u8) -> Option<u64> {
        match metric {
            0 => Some(self.lifetime_runs_started),
            1 => Some(self.lifetime_lines_cleared),
            2 => Some(u64::from(self.lifetime_max_combo)),
            3 => Some(self.lifetime_bosses_cleared),
            4 => Some(u64::from(self.cleared_maps.count_ones())),
            5 => Some(self.lifetime_perfect_levels),
            6 => Some(self.lifetime_daily_challenges),
            7 => Some(self.lifetime_bonus_uses),
            _ => None,
        }
    }

    pub fn is_map_unlocked(&self, map_id: u8) -> bool {
        map_bit(map_id).is_some_and(|bit| self.unlocked_maps & bit != 0)
    }

    pub fn unlock_map(&mut self, map_id: u8, purchased: bool) -> Result<()> {
        let bit = map_bit(map_id).ok_or(ErrorCode::InvalidMap)?;
        self.unlocked_maps |= bit;
        if purchased {
            self.purchased_maps |= bit;
        }
        Ok(())
    }

    pub fn best_stars(&self, map_id: u8, level: u8) -> Result<u8> {
        let (byte, shift) = star_position(map_id, level)?;
        Ok((self.level_stars[byte] >> shift) & 0x3)
    }

    pub fn record_level_stars(&mut self, map_id: u8, level: u8, stars: u8) -> Result<u8> {
        require!(stars <= 3, ErrorCode::InvalidStars);
        let (byte, shift) = star_position(map_id, level)?;
        let current = (self.level_stars[byte] >> shift) & 0x3;
        if stars <= current {
            return Ok(0);
        }
        let mask = 0x3u8 << shift;
        self.level_stars[byte] = (self.level_stars[byte] & !mask) | (stars << shift);
        Ok(stars - current)
    }

    pub fn roll_claims(&mut self, day: u32, week: u32) {
        if self.daily_claim_cadence_id != day {
            self.daily_claim_cadence_id = day;
            self.daily_claimed = 0;
        }
        if self.weekly_claim_cadence_id != week {
            self.weekly_claim_cadence_id = week;
            self.weekly_claimed = 0;
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RunProgressMetrics {
    pub lines_cleared: u16,
    pub bonus_uses: u16,
    pub combo2_hits: u16,
    pub combo3_hits: u16,
    pub combo4_hits: u16,
    pub high_combo_hits: u16,
    pub blocks_destroyed_by_size: [u16; 4],
    pub max_combo: u8,
    pub campaign_level_completed: bool,
    pub new_perfect_level: bool,
    pub boss_cleared: bool,
}

#[account]
#[derive(InitSpace)]
pub struct MapCatalog {
    pub version: u8,
    pub content_version: u32,
    pub map_id: u8,
    pub theme_id: u8,
    pub enabled: bool,
    /// Rules that define one consistent identity across the whole map.
    pub map_rules: CampaignMapRuleSnapshot,
    pub levels: [CampaignLevelSnapshot; LEVELS_PER_MAP],
    pub bump: u8,
}

impl MapCatalog {
    pub fn expanded_level(&self, level: u8) -> Result<LevelRuleSnapshot> {
        require!(
            (1..=LEVELS_PER_MAP as u8).contains(&level),
            ErrorCode::InvalidLevel
        );
        let authored = self.levels[usize::from(level - 1)];
        let map = self.map_rules;
        Ok(LevelRuleSnapshot {
            level: authored.level,
            points_required: authored.points_required,
            max_moves: authored.max_moves,
            difficulty: authored.difficulty,
            primary: authored.primary,
            secondary: authored.secondary,
            active_mutator_id: map.active_mutator_id,
            passive_mutator_id: map.passive_mutator_id,
            boss_id: u8::from(level == LEVELS_PER_MAP as u8) * map.boss_id,
            block_weights: authored.block_weights,
            score_multiplier_x100: map.score_multiplier_x100,
            combo_multiplier_x100: map.combo_multiplier_x100,
            line_clear_bonus: map.line_clear_bonus,
            perfect_clear_bonus: map.perfect_clear_bonus,
            star_threshold_modifier: map.star_threshold_modifier,
            bonus_type: map.bonus_type,
            bonus_trigger_type: map.bonus_trigger_type,
            bonus_threshold: map.bonus_threshold,
            starting_charges: map.starting_charges,
            starting_rows: map.starting_rows,
        })
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace)]
pub struct CampaignMapRuleSnapshot {
    pub active_mutator_id: u8,
    pub passive_mutator_id: u8,
    pub boss_id: u8,
    pub score_multiplier_x100: u16,
    pub combo_multiplier_x100: u16,
    pub line_clear_bonus: u16,
    pub perfect_clear_bonus: u16,
    pub star_threshold_modifier: u8,
    pub bonus_type: u8,
    pub bonus_trigger_type: u8,
    pub bonus_threshold: u16,
    pub starting_charges: u8,
    pub starting_rows: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace)]
pub struct CampaignLevelSnapshot {
    pub level: u8,
    pub points_required: u32,
    pub max_moves: u16,
    pub difficulty: u8,
    pub primary: ConstraintSnapshot,
    pub secondary: ConstraintSnapshot,
    pub block_weights: [u16; 5],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace)]
pub struct LevelRuleSnapshot {
    pub level: u8,
    pub points_required: u32,
    pub max_moves: u16,
    pub difficulty: u8,
    pub primary: ConstraintSnapshot,
    pub secondary: ConstraintSnapshot,
    pub active_mutator_id: u8,
    pub passive_mutator_id: u8,
    pub boss_id: u8,
    pub block_weights: [u16; 5],
    pub score_multiplier_x100: u16,
    pub combo_multiplier_x100: u16,
    pub line_clear_bonus: u16,
    pub perfect_clear_bonus: u16,
    pub star_threshold_modifier: u8,
    pub bonus_type: u8,
    pub bonus_trigger_type: u8,
    pub bonus_threshold: u16,
    pub starting_charges: u8,
    pub starting_rows: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace)]
pub struct ConstraintSnapshot {
    pub kind: u8,
    pub value: u8,
    pub required_count: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ActiveRun {
    pub version: u8,
    pub owner: Pubkey,
    pub daily_challenge: Pubkey,
    pub run_id: u64,
    pub mode: RunMode,
    pub lifecycle: RunLifecycle,
    pub rules_hash: [u8; 32],
    pub map_id: u8,
    pub level: u8,
    pub rules: LevelRuleSnapshot,
    pub grid: [u8; 80],
    pub next_row: [u8; 8],
    pub has_next_row: bool,
    pub score: u32,
    /// Daily leaderboard score: engine score plus pressure-scaled challenge bonus.
    pub daily_score: u32,
    /// Number of actions that earned nonzero Daily challenge bonus credit.
    pub daily_bonus_triggers: u16,
    pub pressure_score: u32,
    pub daily_scoring_rule: DailyScoringRule,
    pub daily_pressure: DailyPressureProfile,
    pub action_counter: u32,
    pub moves: u16,
    pub combo_counter: u8,
    pub max_combo: u8,
    pub primary_progress: u8,
    pub secondary_progress: u8,
    pub level_lines_cleared: u16,
    pub total_lines_cleared: u16,
    pub bonus_uses: u16,
    pub combo2_hits: u16,
    pub combo3_hits: u16,
    pub combo4_hits: u16,
    pub high_combo_hits: u16,
    pub blocks_destroyed_by_size: [u16; 4],
    pub bonus_type: u8,
    pub bonus_charges: u8,
    /// Perfect-clear trigger may award at most once between player moves.
    pub perfect_trigger_available: bool,
    pub starting_height_target: u8,
    pub current_difficulty: u8,
    pub vrf_request_counter: u32,
    pub pending_vrf_counter: u32,
    pub finished_at: i64,
    pub bump: u8,
}

impl Default for ActiveRun {
    fn default() -> Self {
        Self {
            version: 0,
            owner: Pubkey::default(),
            daily_challenge: Pubkey::default(),
            run_id: 0,
            mode: RunMode::default(),
            lifecycle: RunLifecycle::default(),
            rules_hash: [0; 32],
            map_id: 0,
            level: 0,
            rules: LevelRuleSnapshot::default(),
            grid: [0; 80],
            next_row: [0; 8],
            has_next_row: false,
            score: 0,
            daily_score: 0,
            daily_bonus_triggers: 0,
            pressure_score: 0,
            daily_scoring_rule: DailyScoringRule::default(),
            daily_pressure: DailyPressureProfile::default(),
            action_counter: 0,
            moves: 0,
            combo_counter: 0,
            max_combo: 0,
            primary_progress: 0,
            secondary_progress: 0,
            level_lines_cleared: 0,
            total_lines_cleared: 0,
            bonus_uses: 0,
            combo2_hits: 0,
            combo3_hits: 0,
            combo4_hits: 0,
            high_combo_hits: 0,
            blocks_destroyed_by_size: [0; 4],
            bonus_type: 0,
            bonus_charges: 0,
            perfect_trigger_available: false,
            starting_height_target: 0,
            current_difficulty: 0,
            vrf_request_counter: 0,
            pending_vrf_counter: 0,
            finished_at: 0,
            bump: 0,
        }
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub enum RunMode {
    #[default]
    Campaign,
    Daily,
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub enum RunLifecycle {
    #[default]
    Prepared,
    Delegated,
    AwaitingVrf,
    Playing,
    LevelComplete,
    Finished,
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub enum DailyStatus {
    #[default]
    Draft,
    Open,
    EntriesClosed,
    Finalizing,
    Claimable,
    Cancelled,
    Closed,
}

fn map_bit(map_id: u8) -> Option<u32> {
    (1..=MAX_MAPS as u8)
        .contains(&map_id)
        .then(|| 1u32 << (map_id - 1))
}

fn star_position(map_id: u8, level: u8) -> Result<(usize, usize)> {
    require!(
        (1..=MAX_MAPS as u8).contains(&map_id),
        ErrorCode::InvalidMap
    );
    require!(
        (1..=LEVELS_PER_MAP as u8).contains(&level),
        ErrorCode::InvalidLevel
    );
    let bit = (usize::from(map_id - 1) * LEVELS_PER_MAP + usize::from(level - 1)) * 2;
    Ok((bit / 8, bit % 8))
}

pub fn cadence_day(now: i64) -> u32 {
    if now <= 0 {
        0
    } else {
        u32::try_from(now / 86_400).unwrap_or(u32::MAX)
    }
}

pub fn cadence_week(now: i64) -> u32 {
    if now <= 0 {
        0
    } else {
        u32::try_from(now.saturating_add(259_200) / 604_800).unwrap_or(u32::MAX)
    }
}

fn checked_add_u64(left: u64, right: u64) -> Result<u64> {
    left.checked_add(right)
        .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
}

fn checked_add_u32(left: u32, right: u32) -> Result<u32> {
    left.checked_add(right)
        .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_profile_run_id_matches_the_shared_protocol_invariant() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../fixtures/protocol-invariants.json"
        ))
        .unwrap();
        let expected = fixture["initialRunId"].as_u64().unwrap();
        let player = PlayerState::initialize(Pubkey::new_unique(), 1);
        assert_eq!(INITIAL_RUN_ID, expected);
        assert_eq!(player.next_run_id, expected);
        assert_eq!(player.active_run_id, 0);
    }

    #[test]
    fn one_owner_cannot_reserve_overlapping_runs() {
        let mut player = PlayerState::initialize(Pubkey::new_unique(), 1);
        player.reserve_run(INITIAL_RUN_ID).unwrap();
        assert_eq!(player.active_run_id, INITIAL_RUN_ID);
        assert_eq!(player.next_run_id, INITIAL_RUN_ID + 1);
        assert!(player.reserve_run(INITIAL_RUN_ID + 1).is_err());
        assert!(player.release_run(INITIAL_RUN_ID + 1).is_err());
        player.release_run(INITIAL_RUN_ID).unwrap();
        player.reserve_run(INITIAL_RUN_ID + 1).unwrap();
    }

    #[test]
    fn target_accounts_fit_normal_solana_account_limits() {
        let sizes = std::hint::black_box([
            ProtocolConfig::INIT_SPACE,
            PlayerState::INIT_SPACE,
            MapCatalog::INIT_SPACE,
            ActiveRun::INIT_SPACE,
        ]);
        assert!(sizes.into_iter().all(|size| size < 10_240));
        assert_eq!(8 + std::hint::black_box(PlayerState::INIT_SPACE), 355);
        assert_eq!(8 + ActiveRun::INIT_SPACE, 449);
    }

    #[test]
    fn campaign_state_starts_with_only_map_one() {
        let owner = Pubkey::new_unique();
        let mut progress = PlayerState::initialize(owner, 7);
        assert!(progress.is_map_unlocked(1));
        assert!(!progress.is_map_unlocked(2));
        progress.unlock_map(2, true).unwrap();
        assert!(progress.is_map_unlocked(2));
        assert_eq!(progress.purchased_maps, 0b10);
        progress.unlock_map(32, true).unwrap();
        assert!(progress.is_map_unlocked(32));
        assert_eq!(progress.purchased_maps, 0x8000_0002);
        assert_eq!(progress.record_level_stars(32, 10, 3).unwrap(), 3);
        assert_eq!(progress.best_stars(32, 10).unwrap(), 3);
    }

    #[test]
    fn map_catalog_expands_one_identity_across_all_ten_levels() {
        let map_rules = CampaignMapRuleSnapshot {
            active_mutator_id: 13,
            passive_mutator_id: 14,
            boss_id: 5,
            score_multiplier_x100: 175,
            combo_multiplier_x100: 100,
            star_threshold_modifier: 128,
            bonus_type: 1,
            bonus_trigger_type: 4,
            bonus_threshold: 3,
            starting_charges: 1,
            starting_rows: 5,
            ..CampaignMapRuleSnapshot::default()
        };
        let levels = std::array::from_fn(|index| CampaignLevelSnapshot {
            level: index as u8 + 1,
            points_required: 20 + index as u32,
            max_moves: 30,
            difficulty: index.min(7) as u8,
            block_weights: [20; 5],
            ..CampaignLevelSnapshot::default()
        });
        let catalog = MapCatalog {
            version: ACCOUNT_VERSION,
            content_version: 1,
            map_id: 7,
            theme_id: 7,
            enabled: true,
            map_rules,
            levels,
            bump: 1,
        };

        let first = catalog.expanded_level(1).unwrap();
        let boss = catalog.expanded_level(10).unwrap();
        assert_eq!(first.active_mutator_id, boss.active_mutator_id);
        assert_eq!(first.bonus_trigger_type, 4);
        assert_eq!(first.bonus_threshold, 3);
        assert_eq!(first.boss_id, 0);
        assert_eq!(boss.boss_id, 5);
        assert_eq!(boss.level, 10);
    }

    #[test]
    fn stars_are_delta_only_and_accounted() {
        let owner = Pubkey::new_unique();
        let mut progress = PlayerState::initialize(owner, 1);
        assert_eq!(progress.record_level_stars(1, 1, 2).unwrap(), 2);
        assert_eq!(progress.record_level_stars(1, 1, 1).unwrap(), 0);
        assert_eq!(progress.record_level_stars(1, 1, 3).unwrap(), 1);
        assert_eq!(progress.best_stars(1, 1).unwrap(), 3);

        let mut player = PlayerState::initialize(owner, 1);
        player.credit_stars(3).unwrap();
        player.spend_stars(2).unwrap();
        assert_eq!(player.stars_balance, 1);
        assert_eq!(player.lifetime_stars_earned, 3);
        assert_eq!(player.lifetime_stars_spent, 2);
    }

    #[test]
    fn lifetime_xp_is_non_spendable_and_does_not_inflate_stars() {
        let mut player = PlayerState::initialize(Pubkey::new_unique(), 1);
        player.credit_progression_rewards(0, 50).unwrap();
        assert_eq!(player.lifetime_xp, 50);
        assert_eq!(player.stars_balance, 0);
        assert_eq!(player.lifetime_stars_earned, 0);

        player.credit_progression_rewards(2, 150).unwrap();
        assert_eq!(player.lifetime_xp, 200);
        assert_eq!(player.stars_balance, 2);
        assert_eq!(player.lifetime_stars_earned, 2);
    }

    #[test]
    fn stars_conserve_across_defined_issuance_burn_and_refund_events() {
        let owner = Pubkey::new_unique();
        let mut player = PlayerState::initialize(owner, 1);
        for reward in [3, 25, 7] {
            player.credit_stars(reward).unwrap();
        }
        player.spend_stars(20).unwrap();
        player.spend_stars(10).unwrap();
        player.refund_stars(10).unwrap();

        assert_eq!(player.lifetime_stars_earned, 35);
        assert_eq!(player.lifetime_stars_spent, 20);
        assert_eq!(player.stars_balance, 15);
        assert_eq!(
            player.lifetime_stars_earned - player.lifetime_stars_spent,
            player.stars_balance,
        );
        assert!(player.spend_stars(16).is_err());
        assert_eq!(player.stars_balance, 15);
    }

    #[test]
    fn star_refund_reverses_spend_without_minting_lifetime_earnings() {
        let owner = Pubkey::new_unique();
        let mut player = PlayerState::initialize(owner, 1);
        player.stars_balance = 5;
        player.lifetime_stars_earned = 10;
        player.lifetime_stars_spent = 5;
        player.daily_eligible = true;
        player.refund_stars(5).unwrap();
        assert_eq!(player.stars_balance, 10);
        assert_eq!(player.lifetime_stars_earned, 10);
        assert_eq!(player.lifetime_stars_spent, 0);
    }

    #[test]
    fn progress_metrics_are_checked_and_cadence_scoped() {
        let owner = Pubkey::new_unique();
        let mut player = PlayerState::initialize(owner, 1);
        let day_one = 86_400;
        player.record_run_started(day_one).unwrap();
        player
            .record_run_metrics(
                RunProgressMetrics {
                    lines_cleared: 20,
                    bonus_uses: 3,
                    combo2_hits: 5,
                    combo3_hits: 2,
                    combo4_hits: 1,
                    high_combo_hits: 1,
                    blocks_destroyed_by_size: [6, 10, 8, 5],
                    max_combo: 10,
                    campaign_level_completed: true,
                    new_perfect_level: true,
                    boss_cleared: true,
                },
                day_one,
            )
            .unwrap();
        assert_eq!(player.lifetime_runs_started, 1);
        assert_eq!(player.lifetime_lines_cleared, 20);
        assert_eq!(player.lifetime_bonus_uses, 3);
        assert_eq!(player.lifetime_max_combo, 10);
        assert_eq!(player.lifetime_perfect_levels, 1);
        assert_eq!(player.lifetime_bosses_cleared, 1);
        assert_eq!(player.quest_counters[0], 20);
        assert_eq!(player.quest_counters[5], 1);
        assert_eq!(player.quest_counters[7], 6);
        assert_eq!(player.quest_counters[12], 10);
        assert_eq!(player.quest_counters[13], 8);
        assert_eq!(player.quest_counters[14], 5);
        assert_eq!(player.quest_counters[10], 20);

        player.roll_quest_cadences(day_one + 86_400);
        assert_eq!(player.quest_counters[0], 0);
        assert_eq!(player.quest_counters[7], 0);
        assert_eq!(player.quest_counters[12], 0);
        assert_eq!(player.quest_counters[13], 0);
        assert_eq!(player.quest_counters[14], 0);
        assert_eq!(player.quest_counters[10], 20);
    }

    #[test]
    fn quest_claim_bitmaps_reset_only_for_their_own_cadence() {
        let mut claims = PlayerState::initialize(Pubkey::new_unique(), 1);
        claims.daily_claim_cadence_id = 10;
        claims.weekly_claim_cadence_id = 2;
        claims.daily_claimed = 0b11;
        claims.weekly_claimed = 0b100;
        claims.roll_claims(11, 2);
        assert_eq!(claims.daily_claimed, 0);
        assert_eq!(claims.weekly_claimed, 0b100);
        claims.roll_claims(11, 3);
        assert_eq!(claims.weekly_claimed, 0);
    }
}
