//! Protocol, player, catalog, and transient-run accounts.
//!
//! These are the only account types exported by the compiled program.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::arcade::DailyBoardKind;
use crate::state::arena_rules::DailyThemeSnapshot;

pub const PROTOCOL_CONFIG_SEED: &[u8] = b"protocol";
pub const PLAYER_STATE_SEED: &[u8] = b"player";
pub const ACTIVE_RUN_SEED: &[u8] = b"run";

pub const ACCOUNT_VERSION: u8 = zkube_core::PROTOCOL_ACCOUNT_VERSION;
/// Fresh-bootstrap player schema with one Arcade run slot and zeroed expansion space.
pub const PLAYER_STATE_VERSION: u8 = zkube_core::PLAYER_STATE_ACCOUNT_VERSION;
pub const MAX_MAPS: usize = zkube_core::CAMPAIGN_MAP_COUNT;
pub const LEVELS_PER_MAP: usize = zkube_core::CAMPAIGN_LEVELS_PER_MAP;
pub const CAMPAIGN_LEVEL_COUNT: usize = zkube_core::CAMPAIGN_TOTAL_LEVELS;
pub const CAMPAIGN_STAR_BYTES: usize = zkube_core::CAMPAIGN_STAR_BYTES;
pub const MAX_CAMPAIGN_STARS: u16 = zkube_core::CAMPAIGN_MAX_STARS;
pub use zkube_core::{
    EMBLEM_AUTO, EMBLEM_FIRST_GUARDIAN, EMBLEM_LAST_GUARDIAN, EMBLEM_REALM_CONQUEROR,
    EMBLEM_WORLD_PERFECT,
};
/// Run identifiers are per-player and begin at one on every fresh deployment.
pub const INITIAL_RUN_ID: u64 = 1;
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
    /// One-way prepaid entries owned by this wallet identity.
    pub kredit_balance: u64,
    /// Monotonic, non-monetary points accumulated by qualification and claims.
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
    pub reserved: [u8; zkube_core::PLAYER_STATE_RESERVED_BYTES],
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
            active_run_mode: RunMode::Daily,
            active_run_deadline_at: 0,
            orphan_run_id: 0,
            campaign_stars: [0; CAMPAIGN_STAR_BYTES],
            featured_emblem: EMBLEM_AUTO,
            lifetime_paid_entries: 0,
            score_record: CompetitionRecord::default(),
            theme_record: CompetitionRecord::default(),
            kredit_balance: 0,
            ladder_points: 0,
            highest_ladder_tier: 0,
            featured_frame_tier: 0,
            best_daily_score: 0,
            last_entry_day_id: 0,
            entry_streak_days: 0,
            reserved: [0; zkube_core::PLAYER_STATE_RESERVED_BYTES],
            bump,
        }
    }

    pub fn schema_valid(&self) -> bool {
        self.version == PLAYER_STATE_VERSION
            && self.highest_ladder_tier >= ladder_tier_for_points(self.ladder_points)
            && self.featured_frame_tier <= self.highest_ladder_tier
            && self.reserved == [0; zkube_core::PLAYER_STATE_RESERVED_BYTES]
    }

    fn require_schema(&self) -> Result<()> {
        require!(self.schema_valid(), ErrorCode::InvalidVersion);
        Ok(())
    }

    /// Allocate the next monotonic Arcade run id.
    fn allocate_run_id(&mut self, run_id: u64) -> Result<()> {
        require!(self.next_run_id == run_id, ErrorCode::InvalidRunId);
        self.next_run_id = self
            .next_run_id
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
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

    fn clear_arcade_slot(&mut self) {
        self.active_run_id = 0;
        self.active_run_daily = Pubkey::default();
        self.active_run_mode = RunMode::Daily;
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

    /// Self-attested cosmetic progress; only per-level maxima are stored.
    pub fn merge_campaign_stars(&mut self, submitted: [u8; CAMPAIGN_STAR_BYTES]) {
        let mut progress = zkube_core::CampaignStars::from_packed(self.campaign_stars);
        progress.merge(zkube_core::CampaignStars::from_packed(submitted));
        self.campaign_stars = progress.packed();
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
        zkube_core::CampaignStars::from_packed(self.campaign_stars).emblem_unlocked(emblem_id)
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

    /// Credit one ladder award and return the amount added. The entry streak is
    /// visible attendance metadata and does not alter points.
    pub fn record_ladder_points(&mut self, points: u32) -> Result<u32> {
        self.require_schema()?;
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

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct GuardianSnapshot {
    pub bonus: u8,
    pub trigger: u8,
    pub threshold: u16,
}

impl GuardianSnapshot {
    pub fn to_core(self) -> Result<zkube_core::Guardian> {
        let bonus = match self.bonus {
            1 => zkube_core::Bonus::Hammer,
            2 => zkube_core::Bonus::Totem,
            3 => zkube_core::Bonus::Wave,
            _ => return err!(ErrorCode::InvalidLevel),
        };
        Ok(zkube_core::Guardian {
            bonus,
            trigger: self.trigger,
            threshold: self.threshold,
        })
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace)]
pub struct RealmRuleSnapshot {
    pub guardian: GuardianSnapshot,
    pub starting_rows: u8,
}

impl RealmRuleSnapshot {
    pub fn from_core(realm: zkube_core::RealmRules) -> Self {
        Self {
            guardian: GuardianSnapshot {
                bonus: match realm.guardian.bonus {
                    zkube_core::Bonus::Hammer => 1,
                    zkube_core::Bonus::Totem => 2,
                    zkube_core::Bonus::Wave => 3,
                },
                trigger: realm.guardian.trigger,
                threshold: realm.guardian.threshold,
            },
            starting_rows: realm.starting_height,
        }
    }
}

#[account]
#[derive(InitSpace)]
pub struct ActiveRun {
    pub version: u8,
    pub owner: Pubkey,
    /// Original signer that funded this account and receives its rent back.
    pub rent_payer: Pubkey,
    pub daily_challenge: Pubkey,
    pub run_id: u64,
    pub mode: RunMode,
    pub lifecycle: RunLifecycle,
    /// Explicit caller-selected terminal resolution. Automatic completion or
    /// exhaustion keeps this empty.
    pub finish_reason: Option<RunFinishReason>,
    pub rules_hash: [u8; 32],
    /// Ranked actions and VRF callbacks are rejected at this immutable cutoff.
    pub deadline_at: i64,
    pub map_id: u8,
    pub rules: RealmRuleSnapshot,
    pub grid: [u8; 80],
    pub next_row: [u8; 8],
    pub has_next_row: bool,
    pub score: u32,
    /// Arena leaderboard score: pressure-scaled triangular action points.
    pub daily_score: u32,
    /// Uncapped shared-kind increments attributable only to the Daily theme.
    pub objective_total: u64,
    pub pressure_score: u32,
    pub daily_theme: DailyThemeSnapshot,
    pub action_counter: u32,
    pub moves: u16,
    /// Saturating count of player moves that cleared at least two lines.
    pub combo_counter: u8,
    pub max_combo: u8,
    /// Consecutive player moves that each clear at least one line.
    pub streak: u8,
    /// Guardian trigger events produced across the run, before inventory caps.
    pub charges_earned: u8,
    pub level_lines_cleared: u16,
    pub bonus_type: u8,
    pub bonus_charges: u8,
    /// Held preview replacements; every run starts with one.
    pub reroll_charges: u8,
    /// Ramped draw tier for Daily.
    pub current_tier: u8,
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
            rent_payer: Pubkey::default(),
            daily_challenge: Pubkey::default(),
            run_id: 0,
            mode: RunMode::default(),
            lifecycle: RunLifecycle::default(),
            finish_reason: None,
            rules_hash: [0; 32],
            deadline_at: 0,
            map_id: 0,
            rules: RealmRuleSnapshot::default(),
            grid: [0; 80],
            next_row: [0; 8],
            has_next_row: false,
            score: 0,
            daily_score: 0,
            objective_total: 0,
            pressure_score: 0,
            daily_theme: DailyThemeSnapshot::default(),
            action_counter: 0,
            moves: 0,
            combo_counter: 0,
            max_combo: 0,
            streak: 0,
            charges_earned: 0,
            level_lines_cleared: 0,
            bonus_type: 0,
            bonus_charges: 0,
            reroll_charges: 0,
            current_tier: 0,
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
    Finished,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace, PartialEq, Eq)]
pub enum RunFinishReason {
    Abandon,
    Deadline,
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
    fn arcade_reservation_and_orphan_share_one_monotonic_run_sequence() {
        let mut player = PlayerState::initialize(Pubkey::new_unique(), 1);
        let daily = Pubkey::new_unique();
        player
            .reserve_arcade_run(1, daily, RunMode::Daily, 1_000)
            .unwrap();
        assert_eq!(player.next_run_id, 2);
        assert!(player
            .reserve_arcade_run(2, daily, RunMode::Daily, 1_000)
            .is_err());
        assert!(player.release_arcade_run(2).is_err());
        player.expire_arcade_run(1).unwrap();
        assert_eq!(player.orphan_run_id, 1);
        assert!(player
            .reserve_arcade_run(2, daily, RunMode::Daily, 1_000)
            .is_err());
        player.release_orphan(1).unwrap();
        player
            .reserve_arcade_run(2, daily, RunMode::Daily, 1_000)
            .unwrap();
        player.release_arcade_run(2).unwrap();
        assert_eq!(player.next_run_id, 3);
    }

    #[test]
    fn campaign_stars_merge_per_level_maximum_and_never_decrease() {
        let bytes = |player: &PlayerState| {
            let mut encoded = Vec::new();
            player.try_serialize(&mut encoded).unwrap();
            encoded
        };
        let mut player = PlayerState::initialize(Pubkey::new_unique(), 9);
        player.campaign_stars = [0b11_10_01_00; CAMPAIGN_STAR_BYTES];
        player.kredit_balance = 25;
        player.lifetime_paid_entries = 17;
        let original = bytes(&player);
        player.merge_campaign_stars([0b00_01_10_11; CAMPAIGN_STAR_BYTES]);
        assert_eq!(player.campaign_stars, [0b11_10_10_11; CAMPAIGN_STAR_BYTES]);
        let merged = bytes(&player);
        player.merge_campaign_stars([0b00_01_10_11; CAMPAIGN_STAR_BYTES]);
        player.merge_campaign_stars([0; CAMPAIGN_STAR_BYTES]);
        assert_eq!(bytes(&player), merged);
        player.campaign_stars = [0b11_10_01_00; CAMPAIGN_STAR_BYTES];
        assert_eq!(bytes(&player), original);
    }

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
        assert_eq!(player.version, PLAYER_STATE_VERSION);
    }

    #[test]
    fn player_state_rejects_nonzero_reserved_bytes() {
        let mut player = PlayerState::initialize(Pubkey::new_unique(), 1);
        assert!(player.schema_valid());
        player.reserved[17] = 1;
        assert!(!player.schema_valid());
        assert!(player
            .reserve_arcade_run(INITIAL_RUN_ID, Pubkey::new_unique(), RunMode::Daily, 1_000)
            .is_err());
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
    fn the_visible_streak_does_not_change_ladder_awards() {
        let mut player = PlayerState::initialize(Pubkey::new_unique(), 1);
        player.record_kredit_purchase(40).unwrap();
        for day in 0..40 {
            player.record_paid_entry(20_000 + day).unwrap();
        }
        assert_eq!(player.entry_streak_days, 40);
        assert_eq!(player.record_ladder_points(200).unwrap(), 200);
        assert_eq!(player.ladder_points, 200);
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
    fn a_broken_streak_remains_visible_without_changing_points() {
        let mut player = PlayerState::initialize(Pubkey::new_unique(), 1);
        player.record_kredit_purchase(10).unwrap();
        player.record_paid_entry(20_000).unwrap();
        player.record_paid_entry(20_001).unwrap();
        assert_eq!(player.record_ladder_points(100).unwrap(), 100);
        player.record_paid_entry(20_010).unwrap();
        assert_eq!(player.entry_streak_days, 1);
        assert_eq!(player.record_ladder_points(100).unwrap(), 100);
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
            ActiveRun::INIT_SPACE,
        ]);
        assert!(sizes.into_iter().all(|size| size < 10_240));
        assert_eq!(8 + std::hint::black_box(PlayerState::INIT_SPACE), 223);
        assert_eq!(8 + ActiveRun::INIT_SPACE, 339);
    }

    #[test]
    fn campaign_badges_and_emblems_are_derived_from_stars() {
        let mut player = PlayerState::initialize(Pubkey::new_unique(), 1);
        assert!(player.emblem_unlocked(EMBLEM_AUTO));
        assert!(!player.emblem_unlocked(EMBLEM_FIRST_GUARDIAN));
        assert!(!player.emblem_unlocked(EMBLEM_REALM_CONQUEROR));
        assert!(!player.emblem_unlocked(EMBLEM_WORLD_PERFECT));
        player.merge_campaign_stars([u8::MAX; CAMPAIGN_STAR_BYTES]);
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
