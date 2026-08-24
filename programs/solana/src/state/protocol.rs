//! Protocol, player, catalog, and transient-run accounts.
//!
//! These are the only account types exported by the compiled program.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::arcade::{DailyBoardKind, RunMetrics as ArcadeRunMetrics};
use crate::state::arena_rules::{DailyPressureProfile, DailyScoringRule};

pub const PROTOCOL_CONFIG_SEED: &[u8] = b"protocol";
pub const PLAYER_STATE_SEED: &[u8] = b"player";
pub const MAP_CATALOG_SEED: &[u8] = b"map";
pub const ACTIVE_RUN_SEED: &[u8] = b"run";
pub const PLAYER_FUNDING_SEED: &[u8] = b"player_funding";

pub const ACCOUNT_VERSION: u8 = zkube_core::PROTOCOL_ACCOUNT_VERSION;
/// Fresh-bootstrap PlayerState schema with independent Campaign and Arcade
/// run slots plus explicit zeroed expansion space.
pub const PLAYER_STATE_VERSION: u8 = zkube_core::PLAYER_STATE_ACCOUNT_VERSION;
pub const MAX_MAPS: usize = zkube_core::CAMPAIGN_MAP_COUNT;
pub const LEVELS_PER_MAP: usize = zkube_core::CAMPAIGN_LEVELS_PER_MAP;
pub const CAMPAIGN_LEVEL_COUNT: usize = zkube_core::CAMPAIGN_TOTAL_LEVELS;
pub const CAMPAIGN_STAR_BYTES: usize = zkube_core::CAMPAIGN_STAR_BYTES;
pub const MAX_CAMPAIGN_STARS: u16 = zkube_core::CAMPAIGN_MAX_STARS;
pub const EMBLEM_AUTO: u8 = 0;
pub const EMBLEM_FIRST_GUARDIAN: u8 = 1;
pub const EMBLEM_LAST_GUARDIAN: u8 = MAX_MAPS as u8;
pub const EMBLEM_REALM_CONQUEROR: u8 = 11;
pub const EMBLEM_WORLD_PERFECT: u8 = 12;
/// Run identifiers are per-player and begin at one on every fresh deployment.
pub const INITIAL_RUN_ID: u64 = 1;
/// Reusable owner-funded float: current maximum run/delegation rent plus a
/// 20% safety margin, rounded up to the next 0.001 SOL.
pub const PLAYER_FUNDING_TARGET_LAMPORTS: u64 = 50_000_000;
pub const LADDER_TIER_POINT_THRESHOLDS: [u64; 5] = zkube_core::LADDER_TIER_POINT_THRESHOLDS;

#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub version: u8,
    pub authority: Pubkey,
    pub pending_authority: Pubkey,
    pub team_destination: Pubkey,
    /// Chain/deployment-specific replay domain used by canonical replay v2.
    pub replay_domain: [u8; 32],
    pub content_version: u32,
    pub daily_rules_version: u32,
    pub player_funding_target_lamports: u64,
    /// Number of contiguous, authority-activated Campaign maps.
    pub campaign_map_count: u8,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct PlayerState {
    pub version: u8,
    pub owner: Pubkey,
    pub next_run_id: u64,
    /// Zero when the Arcade slot is idle.
    pub active_run_id: u64,
    /// Base-layer reservation remains authoritative while the run PDA is
    /// delegated to an ephemeral rollup.
    pub active_run_daily: Pubkey,
    pub active_run_mode: RunMode,
    pub active_run_deadline_at: i64,
    /// A deterministically expired run remains reserved until its delayed ER
    /// copy is committed and the orphan account is closed.
    pub orphan_run_id: u64,
    /// Two bits per level for exactly ten zones of ten levels. Campaign stars
    /// are the sole progression source; all unlocks and badges are derived.
    pub campaign_stars: [u8; CAMPAIGN_STAR_BYTES],
    /// Zero selects the strongest currently unlocked emblem automatically.
    pub featured_emblem: u8,
    /// Incremented exactly once when one prepaid Kredit starts a ranked run.
    pub lifetime_paid_entries: u64,
    /// The two Daily boards keep separate records. They rank the same runs by
    /// different metrics, so one aggregate cannot say whether a player wins by
    /// total performance or by playing the day's theme — which is the whole
    /// reason the pot splits in two.
    pub score_record: CompetitionRecord,
    pub theme_record: CompetitionRecord,
    /// Zero when the Campaign slot is idle.
    pub campaign_active_run_id: u64,
    /// One-way prepaid entries owned by this wallet identity.
    pub kredit_balance: u64,
    /// Monotonic, non-monetary points accumulated by Daily profile sync.
    pub ladder_points: u64,
    /// Highest placeholder tier ever reached; it never decreases.
    pub highest_ladder_tier: u8,
    /// Ladder border the player has chosen to wear. Any tier they have ever
    /// reached stays available: a rank is earned once, and a border the player
    /// liked should not be taken back by a later reset.
    pub featured_frame_tier: u8,
    /// Best `daily_score` ever recorded on a scored ranked run. A board keeps
    /// only payout-bearing rows and its accounts are recycled, so a personal
    /// best has nowhere else to survive.
    pub best_daily_score: u32,
    /// Day identifier of the most recent paid entry, which the streak below
    /// is measured against.
    pub last_entry_day_id: u32,
    /// Consecutive days carrying at least one paid entry.
    pub entry_streak_days: u16,
    /// Explicit zeroed expansion space for future profile fields.
    pub reserved: [u8; 18],
    pub bump: u8,
}

impl PlayerState {
    pub fn initialize(owner: Pubkey, bump: u8) -> Self {
        Self {
            version: PLAYER_STATE_VERSION,
            owner,
            next_run_id: INITIAL_RUN_ID,
            active_run_id: 0,
            active_run_daily: Pubkey::default(),
            active_run_mode: RunMode::Campaign,
            active_run_deadline_at: 0,
            orphan_run_id: 0,
            campaign_stars: [0; CAMPAIGN_STAR_BYTES],
            featured_emblem: EMBLEM_AUTO,
            lifetime_paid_entries: 0,
            score_record: CompetitionRecord::default(),
            theme_record: CompetitionRecord::default(),
            campaign_active_run_id: 0,
            kredit_balance: 0,
            ladder_points: 0,
            highest_ladder_tier: 0,
            featured_frame_tier: 0,
            best_daily_score: 0,
            last_entry_day_id: 0,
            entry_streak_days: 0,
            reserved: [0; 18],
            bump,
        }
    }

    pub fn schema_valid(&self) -> bool {
        self.version == PLAYER_STATE_VERSION
            && self.highest_ladder_tier >= ladder_tier_for_points(self.ladder_points)
            && self.featured_frame_tier <= self.highest_ladder_tier
            && self.reserved == [0; 18]
    }

    fn require_schema(&self) -> Result<()> {
        require!(self.schema_valid(), ErrorCode::InvalidVersion);
        Ok(())
    }

    /// Allocate the next global monotonic run id. Campaign and Arcade use
    /// separate occupancy slots but share one collision-free PDA sequence.
    fn allocate_run_id(&mut self, run_id: u64) -> Result<()> {
        require!(self.next_run_id == run_id, ErrorCode::InvalidRunId);
        self.next_run_id = self
            .next_run_id
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn reserve_campaign_run(&mut self, run_id: u64) -> Result<()> {
        self.require_schema()?;
        require!(self.campaign_active_run_id == 0, ErrorCode::ActiveRunExists);
        self.allocate_run_id(run_id)?;
        self.campaign_active_run_id = run_id;
        Ok(())
    }

    pub fn reserve_arcade_run(
        &mut self,
        run_id: u64,
        daily: Pubkey,
        mode: RunMode,
        deadline_at: i64,
    ) -> Result<()> {
        self.require_schema()?;
        require!(
            mode == RunMode::Daily && daily != Pubkey::default() && deadline_at > 0,
            ErrorCode::InvalidState
        );
        require!(
            self.active_run_id == 0 && self.orphan_run_id == 0,
            ErrorCode::ActiveRunExists
        );
        self.allocate_run_id(run_id)?;
        self.active_run_id = run_id;
        self.active_run_daily = daily;
        self.active_run_mode = mode;
        self.active_run_deadline_at = deadline_at;
        Ok(())
    }

    pub fn arcade_reservation_matches(
        &self,
        run_id: u64,
        daily: Pubkey,
        mode: RunMode,
        deadline_at: i64,
    ) -> bool {
        self.version == PLAYER_STATE_VERSION
            && self.active_run_id == run_id
            && self.active_run_daily == daily
            && self.active_run_mode == mode
            && self.active_run_deadline_at == deadline_at
    }

    pub fn campaign_reservation_matches(&self, run_id: u64) -> bool {
        self.version == PLAYER_STATE_VERSION && self.campaign_active_run_id == run_id
    }

    fn clear_arcade_slot(&mut self) {
        self.active_run_id = 0;
        self.active_run_daily = Pubkey::default();
        self.active_run_mode = RunMode::Campaign;
        self.active_run_deadline_at = 0;
    }

    /// Releases only the exact Arcade run pinned in durable state while its
    /// terminal ActiveRun is atomically consumed and closed on the base layer.
    pub fn release_arcade_run(&mut self, run_id: u64) -> Result<()> {
        self.require_schema()?;
        require!(self.active_run_id == run_id, ErrorCode::InvalidRunId);
        self.clear_arcade_slot();
        Ok(())
    }

    pub fn release_campaign_run(&mut self, run_id: u64) -> Result<()> {
        self.require_schema()?;
        require!(
            self.campaign_active_run_id == run_id,
            ErrorCode::InvalidRunId
        );
        self.campaign_active_run_id = 0;
        Ok(())
    }

    pub fn expire_arcade_run(&mut self, run_id: u64) -> Result<()> {
        self.require_schema()?;
        require!(self.orphan_run_id == 0, ErrorCode::ActiveRunExists);
        self.release_arcade_run(run_id)?;
        self.orphan_run_id = run_id;
        Ok(())
    }

    pub fn release_orphan(&mut self, run_id: u64) -> Result<()> {
        self.require_schema()?;
        require!(self.orphan_run_id == run_id, ErrorCode::InvalidRunId);
        self.orphan_run_id = 0;
        Ok(())
    }

    pub fn best_stars(&self, map_id: u8, level: u8) -> Result<u8> {
        zkube_core::CampaignStars::from_packed(self.campaign_stars)
            .best(map_id, level)
            .map_err(campaign_stars_error)
    }

    pub fn record_level_stars(&mut self, map_id: u8, level: u8, stars: u8) -> Result<u8> {
        require!(stars <= 3, ErrorCode::InvalidStars);
        // A failed run records no stars and must remain a valid terminal
        // consume operation; core only accepts completed one-to-three-star
        // results.
        if stars == 0 {
            self.best_stars(map_id, level)?;
            return Ok(0);
        }
        let mut progress = zkube_core::CampaignStars::from_packed(self.campaign_stars);
        let delta = progress
            .record_level(map_id, level, stars)
            .map_err(campaign_stars_error)?;
        self.campaign_stars = progress.packed();
        Ok(delta)
    }

    /// Initially only Zone 1 Level 1 is playable. Later levels require one
    /// star on their predecessor; each next zone requires its predecessor's
    /// guardian (Level 10) to have at least one star.
    pub fn campaign_level_unlocked(&self, map_id: u8, level: u8) -> Result<bool> {
        let progress = zkube_core::CampaignStars::from_packed(self.campaign_stars);
        progress.best(map_id, level).map_err(campaign_stars_error)?;
        Ok(progress.level_unlocked(map_id, level))
    }

    pub fn zone_cleared(&self, map_id: u8) -> Result<bool> {
        let progress = zkube_core::CampaignStars::from_packed(self.campaign_stars);
        progress.best(map_id, 1).map_err(campaign_stars_error)?;
        Ok(progress.zone_cleared(map_id))
    }

    pub fn zone_perfected(&self, map_id: u8) -> Result<bool> {
        let progress = zkube_core::CampaignStars::from_packed(self.campaign_stars);
        progress.best(map_id, 1).map_err(campaign_stars_error)?;
        Ok(progress.zone_perfected(map_id))
    }

    pub fn total_campaign_stars(&self) -> u16 {
        zkube_core::CampaignStars::from_packed(self.campaign_stars).total()
    }

    pub fn emblem_unlocked(&self, emblem_id: u8) -> bool {
        match emblem_id {
            EMBLEM_AUTO => true,
            EMBLEM_FIRST_GUARDIAN..=EMBLEM_LAST_GUARDIAN => {
                self.zone_cleared(emblem_id).unwrap_or(false)
            }
            EMBLEM_REALM_CONQUEROR => {
                zkube_core::CampaignStars::from_packed(self.campaign_stars).all_guardians_cleared()
            }
            EMBLEM_WORLD_PERFECT => {
                zkube_core::CampaignStars::from_packed(self.campaign_stars).world_perfected()
            }
            _ => false,
        }
    }

    /// Spend one prepaid Kredit and advance the entry streak.
    ///
    /// The streak counts consecutive days carrying at least one paid entry, so
    /// a second entry on the same day leaves it untouched, the day after
    /// extends it, and any longer gap restarts it at one.
    pub fn record_paid_entry(&mut self, day_id: u32) -> Result<()> {
        self.require_schema()?;
        self.kredit_balance = self
            .kredit_balance
            .checked_sub(1)
            .ok_or(ErrorCode::InsufficientKredits)?;
        self.lifetime_paid_entries = self
            .lifetime_paid_entries
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        if day_id != self.last_entry_day_id {
            let extends =
                self.entry_streak_days > 0 && day_id == self.last_entry_day_id.saturating_add(1);
            self.entry_streak_days = if extends {
                self.entry_streak_days.saturating_add(1)
            } else {
                1
            };
            self.last_entry_day_id = day_id;
        }
        Ok(())
    }

    pub fn record_kredit_purchase(&mut self, count: u64) -> Result<()> {
        self.require_schema()?;
        require!(count > 0, ErrorCode::InvalidKreditPurchase);
        self.kredit_balance = self
            .kredit_balance
            .checked_add(count)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    }

    /// Raise the lifetime best score. A max is idempotent, so replaying a
    /// result can never inflate it.
    pub fn record_best_daily_score(&mut self, score: u32) -> Result<()> {
        self.require_schema()?;
        self.best_daily_score = self.best_daily_score.max(score);
        Ok(())
    }

    /// Credit one ladder award, scaled by the entry streak, and return the
    /// amount actually added.
    ///
    /// The streak read here is the live one rather than a snapshot of the day
    /// being awarded. The qualifying half is credited while the entry is being
    /// scored, so there it is exact. The placement half is credited by the
    /// permissionless profile sync, which the keeper runs in the pass that
    /// finalizes the day — but a sync delayed past a broken streak would pay
    /// the smaller bonus. Snapshotting per day costs either a required
    /// `ArenaPlayer` on a permissionless instruction, which anyone could then
    /// deny by closing that account first, or two more bytes on every board
    /// row; a bounded, rarely reachable difference in a total that pays no SOL
    /// is the cheapest of the three.
    pub fn record_ladder_points(&mut self, base_points: u32) -> Result<u32> {
        self.require_schema()?;
        let points =
            zkube_core::apply_ladder_streak_bonus(base_points, u32::from(self.entry_streak_days));
        self.ladder_points = self
            .ladder_points
            .checked_add(u64::from(points))
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        self.highest_ladder_tier = self
            .highest_ladder_tier
            .max(ladder_tier_for_points(self.ladder_points));
        Ok(points)
    }

    /// The Daily record for one board.
    pub fn daily_record_mut(&mut self, board: DailyBoardKind) -> &mut CompetitionRecord {
        match board {
            DailyBoardKind::Score => &mut self.score_record,
            DailyBoardKind::Theme => &mut self.theme_record,
        }
    }
}

pub use zkube_core::ladder_tier_for_points;

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct CompetitionRecord {
    /// Zero means no payout-bearing Daily rank.
    pub best_prize_rank: u16,
    pub podiums: u32,
    pub wins: u32,
    pub rewards_lamports: u64,
}

impl CompetitionRecord {
    pub fn record_prize(&mut self, rank: u16, reward_lamports: u64) -> Result<()> {
        require!(rank > 0 && reward_lamports > 0, ErrorCode::NoPrize);
        self.best_prize_rank = if self.best_prize_rank == 0 {
            rank
        } else {
            self.best_prize_rank.min(rank)
        };
        if rank <= 3 {
            self.podiums = self.podiums.saturating_add(1);
        }
        if rank == 1 {
            self.wins = self.wins.saturating_add(1);
        }
        self.rewards_lamports = self
            .rewards_lamports
            .checked_add(reward_lamports)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    }
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
    /// Ranked actions and VRF callbacks are rejected at this immutable cutoff.
    /// Campaign runs use zero (no cadence deadline).
    pub deadline_at: i64,
    pub map_id: u8,
    pub level: u8,
    pub rules: LevelRuleSnapshot,
    pub grid: [u8; 80],
    pub next_row: [u8; 8],
    pub has_next_row: bool,
    pub score: u32,
    /// Arena leaderboard score: engine score plus pressure-scaled challenge bonus.
    pub daily_score: u32,
    /// Pressure-scaled points attributable only to the Daily objective.
    pub objective_total: u64,
    /// Number of actions that earned nonzero Daily challenge bonus credit.
    pub daily_bonus_triggers: u16,
    pub pressure_score: u32,
    pub daily_scoring_rule: DailyScoringRule,
    pub daily_pressure: DailyPressureProfile,
    pub action_counter: u32,
    pub moves: u16,
    pub combo_counter: u8,
    pub max_combo: u8,
    /// Canonical, full-width run metrics retained for deterministic scoring.
    pub arcade_metrics: ArcadeRunMetrics,
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
    /// Number of actual empty-board clears produced during this run.
    pub perfect_clears: u16,
    pub starting_height_target: u8,
    pub current_difficulty: u8,
    pub vrf_request_counter: u32,
    pub pending_vrf_counter: u32,
    /// Domain-separated rolling commitment over rules, VRF rows, and actions.
    pub replay_hash: [u8; 32],
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
            deadline_at: 0,
            map_id: 0,
            level: 0,
            rules: LevelRuleSnapshot::default(),
            grid: [0; 80],
            next_row: [0; 8],
            has_next_row: false,
            score: 0,
            daily_score: 0,
            objective_total: 0,
            daily_bonus_triggers: 0,
            pressure_score: 0,
            daily_scoring_rule: DailyScoringRule::default(),
            daily_pressure: DailyPressureProfile::default(),
            action_counter: 0,
            moves: 0,
            combo_counter: 0,
            max_combo: 0,
            arcade_metrics: ArcadeRunMetrics::default(),
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
            perfect_clears: 0,
            starting_height_target: 0,
            current_difficulty: 0,
            vrf_request_counter: 0,
            pending_vrf_counter: 0,
            replay_hash: [0; 32],
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

fn campaign_stars_error(error: zkube_core::CampaignStarsError) -> Error {
    match error {
        zkube_core::CampaignStarsError::InvalidMap => error!(ErrorCode::InvalidMap),
        zkube_core::CampaignStarsError::InvalidLevel => error!(ErrorCode::InvalidLevel),
        zkube_core::CampaignStarsError::InvalidStars => error!(ErrorCode::InvalidStars),
        zkube_core::CampaignStarsError::Locked => error!(ErrorCode::MapLocked),
    }
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
        assert_eq!(player.campaign_active_run_id, 0);
        assert_eq!(player.version, PLAYER_STATE_VERSION);
    }

    #[test]
    fn campaign_and_arcade_have_independent_single_run_slots() {
        let mut player = PlayerState::initialize(Pubkey::new_unique(), 1);
        let daily = Pubkey::new_unique();
        player.reserve_campaign_run(INITIAL_RUN_ID).unwrap();
        player
            .reserve_arcade_run(INITIAL_RUN_ID + 1, daily, RunMode::Daily, 1_000)
            .unwrap();
        assert_eq!(player.campaign_active_run_id, INITIAL_RUN_ID);
        assert_eq!(player.active_run_id, INITIAL_RUN_ID + 1);
        assert_eq!(player.next_run_id, INITIAL_RUN_ID + 2);
        assert!(player.reserve_campaign_run(INITIAL_RUN_ID + 2).is_err());
        assert!(player
            .reserve_arcade_run(INITIAL_RUN_ID + 2, daily, RunMode::Daily, 1_000,)
            .is_err());
        assert!(player.release_campaign_run(INITIAL_RUN_ID + 1).is_err());
        player.release_campaign_run(INITIAL_RUN_ID).unwrap();
        assert_eq!(player.active_run_id, INITIAL_RUN_ID + 1);
        player.release_arcade_run(INITIAL_RUN_ID + 1).unwrap();
        player.reserve_campaign_run(INITIAL_RUN_ID + 2).unwrap();
    }

    #[test]
    fn player_state_rejects_nonzero_reserved_bytes() {
        let mut player = PlayerState::initialize(Pubkey::new_unique(), 1);
        assert!(player.schema_valid());
        player.reserved[17] = 1;
        assert!(!player.schema_valid());
        assert!(player.reserve_campaign_run(INITIAL_RUN_ID).is_err());
    }

    #[test]
    fn ladder_points_accumulate_and_promote_without_consuming_padding() {
        let mut player = PlayerState::initialize(Pubkey::new_unique(), 1);
        assert_eq!(player.record_ladder_points(1_499).unwrap(), 1_499);
        assert_eq!(player.ladder_points, 1_499);
        assert_eq!(player.highest_ladder_tier, 0);
        player.record_ladder_points(1).unwrap();
        assert_eq!(player.highest_ladder_tier, 1);
        assert_eq!(player.reserved, [0; 18]);
        assert!(player.schema_valid());
        // A reset compresses points downward; the earned tier is permanent.
        player.ladder_points = 750;
        assert!(player.schema_valid());
        // The inverse — points implying a tier never recorded — stays invalid.
        player.ladder_points = 1_500;
        player.highest_ladder_tier = 0;
        assert!(!player.schema_valid());
    }

    #[test]
    fn a_streak_scales_every_ladder_award_it_is_credited_beside() {
        let mut player = PlayerState::initialize(Pubkey::new_unique(), 1);
        player.record_kredit_purchase(40).unwrap();
        for day in 0..40 {
            player.record_paid_entry(20_000 + day).unwrap();
        }
        assert_eq!(player.entry_streak_days, 40);
        // Forty consecutive days is +40%, applied to whichever award lands.
        assert_eq!(player.record_ladder_points(200).unwrap(), 280);
        assert_eq!(player.ladder_points, 280);
    }

    #[test]
    fn the_streak_bonus_stops_growing_at_the_core_cap() {
        let mut player = PlayerState::initialize(Pubkey::new_unique(), 1);
        player.record_kredit_purchase(400).unwrap();
        for day in 0..400 {
            player.record_paid_entry(20_000 + day).unwrap();
        }
        assert_eq!(player.entry_streak_days, 400);
        assert_eq!(player.record_ladder_points(200).unwrap(), 400);
    }

    #[test]
    fn kredit_purchase_and_spend_preserve_entry_counting() {
        let mut player = PlayerState::initialize(Pubkey::new_unique(), 1);
        player.record_kredit_purchase(3).unwrap();
        assert_eq!(player.kredit_balance, 3);
        assert_eq!(player.lifetime_paid_entries, 0);

        player.record_paid_entry(20_000).unwrap();
        assert_eq!(player.kredit_balance, 2);
        assert_eq!(player.lifetime_paid_entries, 1);
        player.kredit_balance = 0;
        assert!(player.record_paid_entry(20_000).is_err());
    }

    #[test]
    fn a_streak_counts_days_rather_than_entries() {
        let mut player = PlayerState::initialize(Pubkey::new_unique(), 1);
        player.record_kredit_purchase(10).unwrap();

        player.record_paid_entry(20_000).unwrap();
        assert_eq!(player.entry_streak_days, 1);
        // A second entry the same day is still one day of play.
        player.record_paid_entry(20_000).unwrap();
        assert_eq!(player.entry_streak_days, 1);
        player.record_paid_entry(20_001).unwrap();
        assert_eq!(player.entry_streak_days, 2);
        player.record_paid_entry(20_002).unwrap();
        assert_eq!(player.entry_streak_days, 3);
    }

    #[test]
    fn a_missed_day_restarts_the_streak_at_one() {
        let mut player = PlayerState::initialize(Pubkey::new_unique(), 1);
        player.record_kredit_purchase(10).unwrap();
        player.record_paid_entry(20_000).unwrap();
        player.record_paid_entry(20_001).unwrap();
        assert_eq!(player.entry_streak_days, 2);
        player.record_paid_entry(20_003).unwrap();
        assert_eq!(player.entry_streak_days, 1);
        assert_eq!(player.last_entry_day_id, 20_003);
    }

    #[test]
    fn a_broken_streak_takes_the_bonus_with_it() {
        let mut player = PlayerState::initialize(Pubkey::new_unique(), 1);
        player.record_kredit_purchase(10).unwrap();
        player.record_paid_entry(20_000).unwrap();
        player.record_paid_entry(20_001).unwrap();
        // The bonus floors away below a hundred base points at two days.
        assert_eq!(player.record_ladder_points(100).unwrap(), 102);
        player.record_paid_entry(20_010).unwrap();
        assert_eq!(player.record_ladder_points(100).unwrap(), 101);
    }

    #[test]
    fn a_personal_best_only_rises() {
        let mut player = PlayerState::initialize(Pubkey::new_unique(), 1);
        player.record_best_daily_score(1_200).unwrap();
        assert_eq!(player.best_daily_score, 1_200);
        player.record_best_daily_score(400).unwrap();
        assert_eq!(player.best_daily_score, 1_200);
        player.record_best_daily_score(5_000).unwrap();
        assert_eq!(player.best_daily_score, 5_000);
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
        assert_eq!(8 + std::hint::black_box(PlayerState::INIT_SPACE), 231);
        assert_eq!(8 + ActiveRun::INIT_SPACE, 550);
    }

    #[test]
    fn campaign_starts_with_only_zone_one_level_one_playable() {
        let owner = Pubkey::new_unique();
        let mut progress = PlayerState::initialize(owner, 7);
        assert!(progress.campaign_level_unlocked(1, 1).unwrap());
        assert!(!progress.campaign_level_unlocked(1, 2).unwrap());
        assert!(!progress.campaign_level_unlocked(2, 1).unwrap());
        assert!(progress.campaign_level_unlocked(11, 1).is_err());

        progress.record_level_stars(1, 1, 1).unwrap();
        assert!(progress.campaign_level_unlocked(1, 2).unwrap());
        for level in 2..=LEVELS_PER_MAP as u8 {
            progress.record_level_stars(1, level, 1).unwrap();
        }
        assert!(progress.campaign_level_unlocked(2, 1).unwrap());
        assert!(progress.zone_cleared(1).unwrap());
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
    fn campaign_stars_are_compact_monotonic_and_delta_only() {
        let owner = Pubkey::new_unique();
        let mut progress = PlayerState::initialize(owner, 1);
        assert_eq!(progress.campaign_stars.len(), 25);
        assert_eq!(progress.record_level_stars(1, 1, 2).unwrap(), 2);
        assert_eq!(progress.record_level_stars(1, 1, 1).unwrap(), 0);
        assert_eq!(progress.record_level_stars(1, 1, 3).unwrap(), 1);
        assert_eq!(progress.best_stars(1, 1).unwrap(), 3);
        for map_id in 1..=MAX_MAPS as u8 {
            let first = if map_id == 1 { 2 } else { 1 };
            for level in first..=LEVELS_PER_MAP as u8 {
                progress.record_level_stars(map_id, level, 1).unwrap();
            }
        }
        assert_eq!(progress.record_level_stars(10, 10, 3).unwrap(), 2);
        assert_eq!(progress.best_stars(10, 10).unwrap(), 3);
    }

    #[test]
    fn campaign_badges_and_emblems_are_derived_from_stars() {
        let mut player = PlayerState::initialize(Pubkey::new_unique(), 1);
        assert!(player.emblem_unlocked(EMBLEM_AUTO));
        assert!(!player.emblem_unlocked(EMBLEM_FIRST_GUARDIAN));
        assert!(!player.emblem_unlocked(EMBLEM_REALM_CONQUEROR));
        assert!(!player.emblem_unlocked(EMBLEM_WORLD_PERFECT));
        for map_id in 1..=MAX_MAPS as u8 {
            for level in 1..=LEVELS_PER_MAP as u8 {
                player.record_level_stars(map_id, level, 3).unwrap();
            }
        }
        assert_eq!(player.total_campaign_stars(), MAX_CAMPAIGN_STARS);
        assert!(player.zone_perfected(10).unwrap());
        assert!(player.emblem_unlocked(10));
        assert!(player.emblem_unlocked(EMBLEM_REALM_CONQUEROR));
        assert!(player.emblem_unlocked(EMBLEM_WORLD_PERFECT));
        assert!(!player.emblem_unlocked(13));
    }

    #[test]
    fn competition_record_counts_only_prize_results() {
        let mut record = CompetitionRecord::default();
        assert!(record.record_prize(0, 1).is_err());
        assert!(record.record_prize(1, 0).is_err());
        record.record_prize(3, 12_000_000).unwrap();
        record.record_prize(1, 20_000_000).unwrap();
        record.record_prize(5, 5_000_000).unwrap();
        assert_eq!(record.best_prize_rank, 1);
        assert_eq!(record.podiums, 2);
        assert_eq!(record.wins, 1);
        assert_eq!(record.rewards_lamports, 37_000_000);
    }
}
