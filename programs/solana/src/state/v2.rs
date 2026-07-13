//! Versioned accounts for the zKube Solana/MagicBlock program.
//!
//! These are the only account types exported by the compiled program.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;

pub const PROTOCOL_CONFIG_SEED: &[u8] = b"protocol";
pub const PLAYER_PROFILE_SEED: &[u8] = b"player";
pub const CAMPAIGN_PROGRESS_SEED: &[u8] = b"campaign";
pub const MAP_CATALOG_SEED: &[u8] = b"map";
pub const RUN_SHELL_SEED: &[u8] = b"run";
pub const RUN_RECEIPT_SEED: &[u8] = b"receipt";
pub const DAILY_CHALLENGE_SEED: &[u8] = b"daily";
pub const DAILY_PLAYER_SEED: &[u8] = b"daily_player";
pub const DAILY_VAULT_SEED: &[u8] = b"daily_vault";
pub const DAILY_LEADERBOARD_SEED: &[u8] = b"daily_board";
pub const PROGRESS_CATALOG_SEED: &[u8] = b"progress_catalog";
pub const QUEST_CLAIMS_SEED: &[u8] = b"quest_claims";
pub const SPONSOR_ALLOWANCE_SEED: &[u8] = b"sponsor_allowance";
pub const TREASURY_LEDGER_SEED: &[u8] = b"treasury_ledger";
pub const GOVERNANCE_PROPOSAL_SEED: &[u8] = b"governance";
pub const YIELD_POLICY_SEED: &[u8] = b"yield_policy";

pub const ACCOUNT_VERSION_V1: u8 = 1;
pub const MAX_MAPS: usize = 10;
pub const LEVELS_PER_MAP: usize = 10;
pub const MAX_QUEST_COUNTERS: usize = 16;
pub const DAILY_WINNERS: usize = 10;
pub const MAX_ACHIEVEMENTS: usize = 24;
pub const MAX_QUESTS: usize = 12;
pub const MAX_PROGRESS_REWARD: u64 = 1_000;
pub const MAX_ACHIEVEMENT_XP_REWARD: u32 = 1_000;
pub const ACTIVATION_QUEST_COUNT: u8 = 12;
pub const DAILY_ROTATING_QUESTS: usize = 9;
pub const DAILY_ACTIVE_QUESTS: usize = 3;
pub const DAILY_FINISHER_INDEX: usize = 9;
pub const PRIZE_CLAIM_WINDOW_SECONDS: i64 = 90 * 86_400;
pub const MIN_GOVERNANCE_DELAY_SECONDS: u32 = 60 * 60;
pub const MAX_GOVERNANCE_DELAY_SECONDS: u32 = 30 * 86_400;
pub const MAX_YIELD_EXPOSURE_BPS: u16 = 5_000;
pub const MIN_YIELD_LIQUID_RESERVE_BPS: u16 = 5_000;
pub const MAX_YIELD_SLIPPAGE_BPS: u16 = 100;
pub const MAX_YIELD_LOSS_BPS: u16 = 1_000;
pub const DEFAULT_YIELD_REWARD_BPS: u16 = 10_000;

#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub version: u8,
    pub authority: Pubkey,
    pub pending_authority: Pubkey,
    pub paymaster: Pubkey,
    pub team_vault: Pubkey,
    pub paymaster_vault: Pubkey,
    pub treasury_vault: Pubkey,
    pub reward_vault: Pubkey,
    pub paymaster_cap: u64,
    pub revenue_reward_bps: u16,
    pub sponsorship_daily_tx_limit: u16,
    pub sponsorship_daily_paid_attempt_limit: u16,
    pub payment_mint: Pubkey,
    pub payment_token_program: Pubkey,
    pub payment_vault: Pubkey,
    pub yield_policy: Pubkey,
    pub treasury_ledger: Pubkey,
    pub content_version: u32,
    pub progress_version: u32,
    pub governance_delay_seconds: u32,
    pub governance_execution_window_seconds: u32,
    pub next_governance_proposal_id: u64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct TreasuryLedger {
    pub version: u8,
    pub protocol: Pubkey,
    pub payment_mint: Pubkey,
    pub lifetime_rake_received: u64,
    pub lifetime_team_distributed: u64,
    pub lifetime_paymaster_distributed: u64,
    pub lifetime_treasury_distributed: u64,
    pub lifetime_prizes_forfeited_to_rewards: u64,
    pub lifetime_map_sales: u64,
    pub lifetime_revenue_swept: u64,
    pub lifetime_revenue_to_treasury: u64,
    pub lifetime_revenue_to_rewards: u64,
    pub realized_yield: u64,
    pub yield_allocated_to_rewards: u64,
    pub yield_retained_in_treasury: u64,
    pub lifetime_strategy_deposited: u64,
    pub lifetime_strategy_principal_repaid: u64,
    pub strategy_principal: u64,
    pub realized_strategy_losses: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct YieldStrategyPolicy {
    pub version: u8,
    pub protocol: Pubkey,
    pub strategy_version: u32,
    pub adapter_program: Pubkey,
    pub market: Pubkey,
    pub reserve: Pubkey,
    pub receipt_mint: Pubkey,
    pub max_principal: u64,
    pub max_exposure_bps: u16,
    pub min_liquid_reserve_bps: u16,
    pub max_slippage_bps: u16,
    pub max_loss_bps: u16,
    pub yield_reward_bps: u16,
    pub deposits_enabled: bool,
    pub emergency_exit: bool,
    pub bump: u8,
}

impl YieldStrategyPolicy {
    pub fn initialize(protocol: Pubkey, bump: u8) -> Self {
        Self {
            version: ACCOUNT_VERSION_V1,
            protocol,
            strategy_version: 0,
            adapter_program: Pubkey::default(),
            market: Pubkey::default(),
            reserve: Pubkey::default(),
            receipt_mint: Pubkey::default(),
            max_principal: 0,
            max_exposure_bps: 0,
            min_liquid_reserve_bps: 10_000,
            max_slippage_bps: 0,
            max_loss_bps: 0,
            yield_reward_bps: DEFAULT_YIELD_REWARD_BPS,
            deposits_enabled: false,
            emergency_exit: false,
            bump,
        }
    }

    pub fn is_configured(&self) -> bool {
        self.adapter_program != Pubkey::default()
            && self.strategy_version > 0
            && self.market != Pubkey::default()
            && self.reserve != Pubkey::default()
            && self.receipt_mint != Pubkey::default()
            && self.max_principal > 0
    }
}

impl TreasuryLedger {
    pub fn initialize(protocol: Pubkey, payment_mint: Pubkey, bump: u8) -> Self {
        Self {
            version: ACCOUNT_VERSION_V1,
            protocol,
            payment_mint,
            lifetime_rake_received: 0,
            lifetime_team_distributed: 0,
            lifetime_paymaster_distributed: 0,
            lifetime_treasury_distributed: 0,
            lifetime_prizes_forfeited_to_rewards: 0,
            lifetime_map_sales: 0,
            lifetime_revenue_swept: 0,
            lifetime_revenue_to_treasury: 0,
            lifetime_revenue_to_rewards: 0,
            realized_yield: 0,
            yield_allocated_to_rewards: 0,
            yield_retained_in_treasury: 0,
            lifetime_strategy_deposited: 0,
            lifetime_strategy_principal_repaid: 0,
            strategy_principal: 0,
            realized_strategy_losses: 0,
            bump,
        }
    }

    pub fn record_rake_distribution(
        &mut self,
        rake: u64,
        team: u64,
        paymaster: u64,
        treasury: u64,
    ) -> Result<()> {
        require!(
            team.checked_add(paymaster)
                .and_then(|value| value.checked_add(treasury))
                == Some(rake),
            ErrorCode::AccountingInvariant
        );
        self.lifetime_rake_received = checked_add_u64(self.lifetime_rake_received, rake)?;
        self.lifetime_team_distributed = checked_add_u64(self.lifetime_team_distributed, team)?;
        self.lifetime_paymaster_distributed =
            checked_add_u64(self.lifetime_paymaster_distributed, paymaster)?;
        self.lifetime_treasury_distributed =
            checked_add_u64(self.lifetime_treasury_distributed, treasury)?;
        Ok(())
    }

    pub fn record_prize_forfeiture(&mut self, amount: u64) -> Result<()> {
        self.lifetime_prizes_forfeited_to_rewards =
            checked_add_u64(self.lifetime_prizes_forfeited_to_rewards, amount)?;
        Ok(())
    }

    pub fn record_map_sale(&mut self, amount: u64) -> Result<()> {
        self.lifetime_map_sales = checked_add_u64(self.lifetime_map_sales, amount)?;
        Ok(())
    }

    pub fn unswept_map_revenue(&self) -> Result<u64> {
        self.lifetime_map_sales
            .checked_sub(self.lifetime_revenue_swept)
            .ok_or_else(|| error!(ErrorCode::AccountingInvariant))
    }

    pub fn record_revenue_sweep(&mut self, amount: u64, treasury: u64, rewards: u64) -> Result<()> {
        require!(
            treasury.checked_add(rewards) == Some(amount)
                && amount <= self.unswept_map_revenue()?,
            ErrorCode::AccountingInvariant
        );
        self.lifetime_revenue_swept = checked_add_u64(self.lifetime_revenue_swept, amount)?;
        self.lifetime_revenue_to_treasury =
            checked_add_u64(self.lifetime_revenue_to_treasury, treasury)?;
        self.lifetime_revenue_to_rewards =
            checked_add_u64(self.lifetime_revenue_to_rewards, rewards)?;
        Ok(())
    }

    pub fn record_strategy_deposit(&mut self, amount: u64) -> Result<()> {
        self.validate_strategy_accounting()?;
        require!(amount > 0, ErrorCode::AccountingInvariant);
        let next_principal = checked_add_u64(self.strategy_principal, amount)?;
        let next_lifetime_deposited = checked_add_u64(self.lifetime_strategy_deposited, amount)?;
        self.strategy_principal = next_principal;
        self.lifetime_strategy_deposited = next_lifetime_deposited;
        Ok(())
    }

    pub fn record_strategy_settlement(
        &mut self,
        principal_repaid: u64,
        realized_yield: u64,
        realized_loss: u64,
    ) -> Result<()> {
        self.validate_strategy_accounting()?;
        require!(
            principal_repaid > 0 || realized_yield > 0 || realized_loss > 0,
            ErrorCode::AccountingInvariant
        );
        let principal_closed = principal_repaid
            .checked_add(realized_loss)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        require!(
            principal_closed <= self.strategy_principal,
            ErrorCode::AccountingInvariant
        );
        let next_principal = self
            .strategy_principal
            .checked_sub(principal_closed)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        let next_realized_yield = checked_add_u64(self.realized_yield, realized_yield)?;
        let next_realized_losses = checked_add_u64(self.realized_strategy_losses, realized_loss)?;
        let next_lifetime_repaid =
            checked_add_u64(self.lifetime_strategy_principal_repaid, principal_repaid)?;
        self.strategy_principal = next_principal;
        self.realized_yield = next_realized_yield;
        self.realized_strategy_losses = next_realized_losses;
        self.lifetime_strategy_principal_repaid = next_lifetime_repaid;
        Ok(())
    }

    pub fn validate_strategy_accounting(&self) -> Result<()> {
        let accounted_principal = self
            .strategy_principal
            .checked_add(self.lifetime_strategy_principal_repaid)
            .and_then(|value| value.checked_add(self.realized_strategy_losses))
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        require!(
            accounted_principal == self.lifetime_strategy_deposited,
            ErrorCode::AccountingInvariant
        );
        self.unallocated_realized_yield()?;
        Ok(())
    }

    pub fn unallocated_realized_yield(&self) -> Result<u64> {
        self.realized_yield
            .checked_sub(self.yield_allocated_to_rewards)
            .and_then(|value| value.checked_sub(self.yield_retained_in_treasury))
            .ok_or_else(|| error!(ErrorCode::AccountingInvariant))
    }

    pub fn record_yield_allocation(
        &mut self,
        amount: u64,
        treasury: u64,
        rewards: u64,
    ) -> Result<()> {
        require!(
            amount > 0
                && treasury.checked_add(rewards) == Some(amount)
                && amount <= self.unallocated_realized_yield()?,
            ErrorCode::AccountingInvariant
        );
        let next_rewards = checked_add_u64(self.yield_allocated_to_rewards, rewards)?;
        let next_treasury = checked_add_u64(self.yield_retained_in_treasury, treasury)?;
        self.yield_allocated_to_rewards = next_rewards;
        self.yield_retained_in_treasury = next_treasury;
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum GovernanceAction {
    SetPendingAuthority {
        new_authority: Pubkey,
    },
    SetPaymasterPolicy {
        paymaster: Pubkey,
        daily_transaction_limit: u16,
        daily_paid_attempt_limit: u16,
        paymaster_cap: u64,
    },
    ConfigureYieldStrategy {
        strategy_version: u32,
        adapter_program: Pubkey,
        market: Pubkey,
        reserve: Pubkey,
        receipt_mint: Pubkey,
        max_principal: u64,
        max_exposure_bps: u16,
        min_liquid_reserve_bps: u16,
        max_slippage_bps: u16,
        max_loss_bps: u16,
    },
    SetYieldStrategyStatus {
        deposits_enabled: bool,
        emergency_exit: bool,
    },
    SetYieldAllocation {
        reward_bps: u16,
    },
    SetRevenueAllocation {
        reward_bps: u16,
    },
    SetContentVersion {
        content_version: u32,
    },
    SetProgressVersion {
        progress_version: u32,
    },
    SetGovernanceTiming {
        delay_seconds: u32,
        execution_window_seconds: u32,
    },
    Unpause,
}

#[account]
#[derive(InitSpace)]
pub struct GovernanceProposal {
    pub version: u8,
    pub protocol: Pubkey,
    pub proposal_id: u64,
    pub proposer: Pubkey,
    pub action: GovernanceAction,
    pub created_at: i64,
    pub execute_after: i64,
    pub expires_at: i64,
    pub executed_at: i64,
    pub cancelled_at: i64,
    pub bump: u8,
}

impl GovernanceProposal {
    pub fn is_pending(&self) -> bool {
        self.executed_at == 0 && self.cancelled_at == 0
    }
}

#[account]
#[derive(InitSpace)]
pub struct PlayerProfile {
    pub version: u8,
    pub owner: Pubkey,
    pub stars_balance: u64,
    pub lifetime_stars_earned: u64,
    pub lifetime_stars_spent: u64,
    pub next_run_id: u64,
    pub daily_eligible: bool,
    pub achievement_flags: [u64; 4],
    pub achievement_xp: u64,
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
    pub bump: u8,
}

impl PlayerProfile {
    pub fn initialize(owner: Pubkey, bump: u8) -> Self {
        Self {
            version: ACCOUNT_VERSION_V1,
            owner,
            stars_balance: 0,
            lifetime_stars_earned: 0,
            lifetime_stars_spent: 0,
            next_run_id: 1,
            daily_eligible: false,
            achievement_flags: [0; 4],
            achievement_xp: 0,
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
            bump,
        }
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

    pub fn credit_achievement_rewards(&mut self, stars: u64, xp: u32) -> Result<()> {
        if stars > 0 {
            self.credit_stars(stars)?;
        }
        self.achievement_xp = self
            .achievement_xp
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
        }
        if self.quest_cadence_week != week {
            self.quest_cadence_week = week;
            self.quest_counters[10..12].fill(0);
        }
    }

    pub fn record_run_started(&mut self, now: i64) -> Result<()> {
        self.roll_quest_cadences(now);
        self.lifetime_runs_started = checked_add_u64(self.lifetime_runs_started, 1)?;
        self.quest_counters[7] = checked_add_u32(self.quest_counters[7], 1)?;
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
        self.quest_counters[10] =
            checked_add_u32(self.quest_counters[10], u32::from(metrics.lines_cleared))?;
        if metrics.perfect_level {
            self.lifetime_perfect_levels = checked_add_u64(self.lifetime_perfect_levels, 1)?;
            self.quest_counters[5] = checked_add_u32(self.quest_counters[5], 1)?;
        }
        if metrics.boss_cleared {
            self.lifetime_bosses_cleared = checked_add_u64(self.lifetime_bosses_cleared, 1)?;
        }
        Ok(())
    }

    pub fn achievement_metric(&self, metric: u8, campaign: &CampaignProgress) -> Option<u64> {
        match metric {
            0 => Some(self.lifetime_runs_started),
            1 => Some(self.lifetime_lines_cleared),
            2 => Some(u64::from(self.lifetime_max_combo)),
            3 => Some(self.lifetime_bosses_cleared),
            4 => Some(u64::from(campaign.cleared_maps.count_ones())),
            5 => Some(self.lifetime_perfect_levels),
            6 => Some(self.lifetime_daily_challenges),
            7 => Some(self.lifetime_bonus_uses),
            _ => None,
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
    pub max_combo: u8,
    pub perfect_level: bool,
    pub boss_cleared: bool,
}

#[account]
#[derive(InitSpace)]
pub struct CampaignProgress {
    pub version: u8,
    pub owner: Pubkey,
    /// Bit `map_id - 1`; Map 1 is set on initialization.
    pub unlocked_maps: u16,
    pub purchased_maps: u16,
    pub cleared_maps: u16,
    pub perfected_maps: u16,
    /// Two bits per level, ten levels per map.
    pub level_stars: [u32; MAX_MAPS],
    /// Prevents replayed receipts from changing progress twice.
    pub last_consumed_run_id: u64,
    pub bump: u8,
}

impl CampaignProgress {
    pub fn initialize(owner: Pubkey, bump: u8) -> Self {
        Self {
            version: ACCOUNT_VERSION_V1,
            owner,
            unlocked_maps: 1,
            purchased_maps: 0,
            cleared_maps: 0,
            perfected_maps: 0,
            level_stars: [0; MAX_MAPS],
            last_consumed_run_id: 0,
            bump,
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
        let (map, shift) = star_position(map_id, level)?;
        Ok(((self.level_stars[map] >> shift) & 0x3) as u8)
    }

    /// Returns only newly earned stars; replaying an equal/worse result earns
    /// zero and cannot reduce the stored best.
    pub fn record_level_stars(&mut self, map_id: u8, level: u8, stars: u8) -> Result<u8> {
        require!(stars <= 3, ErrorCode::InvalidStars);
        let (map, shift) = star_position(map_id, level)?;
        let current = ((self.level_stars[map] >> shift) & 0x3) as u8;
        if stars <= current {
            return Ok(0);
        }
        let mask = 0x3u32 << shift;
        self.level_stars[map] = (self.level_stars[map] & !mask) | (u32::from(stars) << shift);
        Ok(stars - current)
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
    pub star_unlock_cost: u64,
    pub usdc_unlock_cost: u64,
    pub levels: [LevelRuleSnapshot; LEVELS_PER_MAP],
    pub bump: u8,
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
pub struct RunShell {
    pub version: u8,
    pub owner: Pubkey,
    pub run_id: u64,
    pub mode: RunMode,
    pub settlement_target: SettlementTarget,
    pub content_version: u32,
    pub rules_hash: [u8; 32],
    pub map_catalog: Pubkey,
    pub daily_challenge: Pubkey,
    pub action_authority: Pubkey,
    pub delegated_validator: Pubkey,
    pub lifecycle: RunLifecycle,
    pub created_at: i64,
    pub settled_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ActiveRun {
    pub version: u8,
    pub owner: Pubkey,
    pub run_shell: Pubkey,
    pub daily_challenge: Pubkey,
    pub run_id: u64,
    pub mode: RunMode,
    pub lifecycle: RunLifecycle,
    pub action_authority: Pubkey,
    pub content_version: u32,
    pub rules_hash: [u8; 32],
    pub map_id: u8,
    pub level: u8,
    pub rules: LevelRuleSnapshot,
    pub grid: [u8; 80],
    pub next_row: [u8; 8],
    pub has_next_row: bool,
    pub score: u32,
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
    pub bonus_type: u8,
    pub bonus_charges: u8,
    pub initial_rows_remaining: u8,
    pub current_difficulty: u8,
    pub endless_thresholds: [u32; 7],
    pub endless_score_multipliers_x100: [u16; 8],
    pub endless_ramp_multiplier_x100: u16,
    pub vrf_request_counter: u32,
    pub pending_vrf_counter: u32,
    pub vrf_requested_at: i64,
    pub action_hash: [u8; 32],
    pub vrf_hash: [u8; 32],
    pub started_at: i64,
    pub finished_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct RunReceipt {
    pub version: u8,
    pub owner: Pubkey,
    pub run_shell: Pubkey,
    pub run_id: u64,
    pub mode: RunMode,
    pub settlement_target: SettlementTarget,
    pub content_version: u32,
    pub rules_hash: [u8; 32],
    pub map_id: u8,
    pub level: u8,
    pub score: u32,
    pub moves: u16,
    pub level_stars: u8,
    pub lines_cleared: u16,
    pub bonus_uses: u16,
    pub combo2_hits: u16,
    pub combo3_hits: u16,
    pub combo4_hits: u16,
    pub high_combo_hits: u16,
    pub max_combo: u8,
    pub completed: bool,
    pub action_hash: [u8; 32],
    pub vrf_hash: [u8; 32],
    pub started_at: i64,
    pub finished_at: i64,
    pub consumed_at: i64,
    pub consumed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ProgressCatalog {
    pub version: u8,
    pub progress_version: u32,
    pub achievement_count: u8,
    pub quest_count: u8,
    pub achievements: [AchievementRule; MAX_ACHIEVEMENTS],
    pub quests: [QuestRule; MAX_QUESTS],
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace)]
pub struct AchievementRule {
    pub metric: u8,
    pub enabled: bool,
    pub threshold: u64,
    pub star_reward: u64,
    pub xp_reward: u32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace)]
pub struct QuestRule {
    pub metric: u8,
    /// 0=daily, 1=weekly.
    pub cadence: u8,
    pub rotation_modulus: u8,
    pub rotation_remainder: u8,
    pub enabled: bool,
    pub threshold: u32,
    pub star_reward: u64,
}

#[account]
#[derive(InitSpace)]
pub struct QuestClaims {
    pub version: u8,
    pub owner: Pubkey,
    pub progress_version: u32,
    pub daily_cadence_id: u32,
    pub weekly_cadence_id: u32,
    pub daily_claimed: u16,
    pub weekly_claimed: u16,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct SponsorAllowance {
    pub version: u8,
    pub owner: Pubkey,
    pub cadence_day: u32,
    pub sponsored_transactions: u16,
    pub paid_daily_attempts: u16,
    pub bump: u8,
}

impl SponsorAllowance {
    pub fn initialize(owner: Pubkey, day: u32, bump: u8) -> Self {
        Self {
            version: ACCOUNT_VERSION_V1,
            owner,
            cadence_day: day,
            sponsored_transactions: 0,
            paid_daily_attempts: 0,
            bump,
        }
    }

    pub fn consume(
        &mut self,
        day: u32,
        paid_attempts: u16,
        transaction_limit: u16,
        paid_attempt_limit: u16,
    ) -> Result<()> {
        require!(
            transaction_limit > 0 && paid_attempt_limit > 0,
            ErrorCode::SponsorshipLimitExceeded
        );
        if self.cadence_day != day {
            self.cadence_day = day;
            self.sponsored_transactions = 0;
            self.paid_daily_attempts = 0;
        }
        // The per-player daily sponsored-transaction count is tracked for
        // telemetry but no longer gated: rent from settled/abandoned runs
        // returns to the paymaster (self-sustaining) and the stateless relay
        // already bounds abuse by instruction shape and IP rate limit, so
        // capping gameplay/settlement here only stranded runs. Only the paid
        // Daily-attempt (USDC) economic limit is still enforced.
        let transactions = self.sponsored_transactions.saturating_add(1);
        let paid = self
            .paid_daily_attempts
            .checked_add(paid_attempts)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        require!(
            paid <= paid_attempt_limit,
            ErrorCode::SponsorshipLimitExceeded
        );
        self.sponsored_transactions = transactions;
        self.paid_daily_attempts = paid;
        Ok(())
    }
}

impl QuestClaims {
    pub fn roll(&mut self, day: u32, week: u32) {
        if self.daily_cadence_id != day {
            self.daily_cadence_id = day;
            self.daily_claimed = 0;
        }
        if self.weekly_cadence_id != week {
            self.weekly_cadence_id = week;
            self.weekly_claimed = 0;
        }
    }
}

#[account]
#[derive(InitSpace)]
pub struct DailyChallenge {
    pub version: u8,
    pub day_id: u32,
    pub authority: Pubkey,
    pub status: DailyStatus,
    pub content_version: u32,
    pub rules_hash: [u8; 32],
    pub map_id: u8,
    pub rules: LevelRuleSnapshot,
    pub endless_thresholds: [u32; 7],
    pub endless_score_multipliers_x100: [u16; 8],
    pub endless_ramp_multiplier_x100: u16,
    pub payment_mint: Pubkey,
    pub payment_token_program: Pubkey,
    pub payment_vault: Pubkey,
    pub opens_at: i64,
    pub entries_close_at: i64,
    pub runs_close_at: i64,
    pub settlement_grace_close_at: i64,
    pub finalized_at: i64,
    pub claims_close_at: i64,
    pub entry_price: u64,
    pub star_entry_cost: u64,
    pub prize_bps: u16,
    pub rake_bps: u16,
    pub sponsor_funding: u64,
    pub paid_entry_funding: u64,
    pub prize_liability: u64,
    pub rake_accrued: u64,
    pub rake_distributed: u64,
    pub refunds_paid: u64,
    pub prize_claimed: u64,
    pub prize_forfeited: u64,
    pub settled_prize_pool: u64,
    pub sponsor_reclaimed: bool,
    pub payout_bps: [u16; DAILY_WINNERS],
    pub total_paid_attempts: u64,
    pub total_free_attempts: u64,
    pub runs_started: u64,
    pub runs_finalized: u64,
    pub bump: u8,
}

impl DailyChallenge {
    pub fn validate_policy(&self) -> Result<()> {
        let total = self
            .prize_bps
            .checked_add(self.rake_bps)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        require!(total == 10_000, ErrorCode::InvalidBasisPoints);
        require!(self.prize_bps == 9_000, ErrorCode::InvalidBasisPoints);
        require!(self.rake_bps == 1_000, ErrorCode::InvalidBasisPoints);
        let payout_total = self.payout_bps.iter().try_fold(0u16, |sum, share| {
            sum.checked_add(*share).ok_or(ErrorCode::ArithmeticOverflow)
        })?;
        require!(payout_total == 10_000, ErrorCode::InvalidBasisPoints);
        Ok(())
    }

    pub fn split_entry(&self, amount: u64) -> Result<(u64, u64)> {
        self.validate_policy()?;
        let prize = u128::from(amount)
            .checked_mul(u128::from(self.prize_bps))
            .ok_or(ErrorCode::ArithmeticOverflow)?
            .checked_div(10_000)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        let prize = u64::try_from(prize).map_err(|_| ErrorCode::ArithmeticOverflow)?;
        let rake = amount
            .checked_sub(prize)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok((prize, rake))
    }

    /// Returns the token balance that must remain in the challenge vault after
    /// every recorded inflow and outflow. This identity keeps refundable entry
    /// principal, rake, prize liabilities, sponsor returns, claims, and
    /// forfeitures in one checked equation.
    pub fn expected_vault_balance(&self) -> Result<u64> {
        let inflows = self
            .paid_entry_funding
            .checked_add(self.sponsor_funding)
            .ok_or(ErrorCode::AccountingInvariant)?;
        let sponsor_returned = if self.sponsor_reclaimed {
            self.sponsor_funding
        } else {
            0
        };
        let outflows = self
            .refunds_paid
            .checked_add(sponsor_returned)
            .and_then(|value| value.checked_add(self.rake_distributed))
            .and_then(|value| value.checked_add(self.prize_claimed))
            .and_then(|value| value.checked_add(self.prize_forfeited))
            .ok_or(ErrorCode::AccountingInvariant)?;
        inflows
            .checked_sub(outflows)
            .ok_or_else(|| error!(ErrorCode::AccountingInvariant))
    }

    pub fn assert_accounting_invariant(&self) -> Result<()> {
        let outstanding_rake = self
            .rake_accrued
            .checked_sub(self.rake_distributed)
            .ok_or(ErrorCode::AccountingInvariant)?;
        let tracked_balance = self
            .prize_liability
            .checked_add(outstanding_rake)
            .ok_or(ErrorCode::AccountingInvariant)?;
        require!(
            self.expected_vault_balance()? == tracked_balance,
            ErrorCode::AccountingInvariant
        );
        require!(
            self.prize_claimed
                .checked_add(self.prize_forfeited)
                .is_some_and(
                    |resolved| resolved <= self.settled_prize_pool || self.finalized_at == 0
                ),
            ErrorCode::AccountingInvariant
        );
        Ok(())
    }
}

impl DailyLeaderboard {
    pub fn record_best(&mut self, entry: DailyLeaderboardEntry) {
        self.entries
            .retain(|existing| existing.player != entry.player);
        self.entries.push(entry);
        self.entries.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then_with(|| left.submitted_at.cmp(&right.submitted_at))
                .then_with(|| left.player.to_bytes().cmp(&right.player.to_bytes()))
        });
        self.entries.truncate(DAILY_WINNERS);
    }

    pub fn rank_of(&self, player: Pubkey) -> Option<usize> {
        self.entries.iter().position(|entry| entry.player == player)
    }
}

#[account]
#[derive(InitSpace)]
pub struct DailyPlayer {
    pub version: u8,
    pub challenge: Pubkey,
    pub player: Pubkey,
    pub free_attempt_used: bool,
    pub paid_attempts: u32,
    pub finalized_attempts: u32,
    pub best_run_id: u64,
    pub best_receipt: Pubkey,
    pub best_score: u32,
    pub best_submitted_at: i64,
    pub rank: u32,
    pub prize_amount: u64,
    pub claimed: bool,
    pub refunded_amount: u64,
    pub star_refunded: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct DailyLeaderboard {
    pub version: u8,
    pub challenge: Pubkey,
    #[max_len(DAILY_WINNERS)]
    pub entries: Vec<DailyLeaderboardEntry>,
    pub bump: u8,
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct DailyLeaderboardEntry {
    pub player: Pubkey,
    pub receipt: Pubkey,
    pub run_id: u64,
    pub score: u32,
    pub submitted_at: i64,
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
pub enum SettlementTarget {
    #[default]
    CampaignProgress,
    DailyLeaderboard,
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
    Committing,
    Settled,
    Cancelled,
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

fn map_bit(map_id: u8) -> Option<u16> {
    (1..=MAX_MAPS as u8)
        .contains(&map_id)
        .then(|| 1u16 << (map_id - 1))
}

fn star_position(map_id: u8, level: u8) -> Result<(usize, u32)> {
    require!(
        (1..=MAX_MAPS as u8).contains(&map_id),
        ErrorCode::InvalidMap
    );
    require!(
        (1..=LEVELS_PER_MAP as u8).contains(&level),
        ErrorCode::InvalidLevel
    );
    Ok(((map_id - 1) as usize, u32::from((level - 1) * 2)))
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
    fn target_accounts_fit_normal_solana_account_limits() {
        let sizes = std::hint::black_box([
            ProtocolConfig::INIT_SPACE,
            PlayerProfile::INIT_SPACE,
            CampaignProgress::INIT_SPACE,
            MapCatalog::INIT_SPACE,
            RunShell::INIT_SPACE,
            ActiveRun::INIT_SPACE,
            RunReceipt::INIT_SPACE,
            DailyChallenge::INIT_SPACE,
            DailyPlayer::INIT_SPACE,
            DailyLeaderboard::INIT_SPACE,
            ProgressCatalog::INIT_SPACE,
            QuestClaims::INIT_SPACE,
            SponsorAllowance::INIT_SPACE,
            TreasuryLedger::INIT_SPACE,
            YieldStrategyPolicy::INIT_SPACE,
            GovernanceProposal::INIT_SPACE,
        ]);
        assert!(sizes.into_iter().all(|size| size < 10_240));
    }

    #[test]
    fn campaign_progress_starts_with_only_map_one() {
        let owner = Pubkey::new_unique();
        let mut progress = CampaignProgress::initialize(owner, 7);
        assert!(progress.is_map_unlocked(1));
        assert!(!progress.is_map_unlocked(2));
        progress.unlock_map(2, true).unwrap();
        assert!(progress.is_map_unlocked(2));
        assert_eq!(progress.purchased_maps, 0b10);
    }

    #[test]
    fn stars_are_delta_only_and_accounted() {
        let owner = Pubkey::new_unique();
        let mut progress = CampaignProgress::initialize(owner, 1);
        assert_eq!(progress.record_level_stars(1, 1, 2).unwrap(), 2);
        assert_eq!(progress.record_level_stars(1, 1, 1).unwrap(), 0);
        assert_eq!(progress.record_level_stars(1, 1, 3).unwrap(), 1);
        assert_eq!(progress.best_stars(1, 1).unwrap(), 3);

        let mut player = PlayerProfile::initialize(owner, 1);
        player.credit_stars(3).unwrap();
        player.spend_stars(2).unwrap();
        assert_eq!(player.stars_balance, 1);
        assert_eq!(player.lifetime_stars_earned, 3);
        assert_eq!(player.lifetime_stars_spent, 2);
    }

    #[test]
    fn achievement_xp_is_non_spendable_and_does_not_inflate_stars() {
        let mut player = PlayerProfile::initialize(Pubkey::new_unique(), 1);
        player.credit_achievement_rewards(0, 50).unwrap();
        assert_eq!(player.achievement_xp, 50);
        assert_eq!(player.stars_balance, 0);
        assert_eq!(player.lifetime_stars_earned, 0);

        player.credit_achievement_rewards(2, 150).unwrap();
        assert_eq!(player.achievement_xp, 200);
        assert_eq!(player.stars_balance, 2);
        assert_eq!(player.lifetime_stars_earned, 2);
    }

    #[test]
    fn stars_conserve_across_defined_issuance_burn_and_refund_events() {
        let owner = Pubkey::new_unique();
        let mut player = PlayerProfile::initialize(owner, 1);
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
    fn entry_split_conserves_every_base_unit() {
        let challenge = daily_challenge_fixture();
        for amount in [0, 1, 9, 10, 11, 999_999, 1_000_000, u64::MAX] {
            let (prize, rake) = challenge.split_entry(amount).unwrap();
            assert_eq!(prize.checked_add(rake), Some(amount));
        }
    }

    #[test]
    fn daily_vault_accounting_conserves_large_scenario_matrix() {
        for paid_attempts in 0..=2_048u64 {
            let mut challenge = daily_challenge_fixture();
            let paid = paid_attempts.checked_mul(challenge.entry_price).unwrap();
            let sponsor = paid_attempts
                .checked_mul(17_003)
                .unwrap()
                .checked_add(29)
                .unwrap();
            let (paid_prize, paid_rake) = challenge.split_entry(paid).unwrap();
            challenge.paid_entry_funding = paid;
            challenge.sponsor_funding = sponsor;
            challenge.prize_liability = paid_prize.checked_add(sponsor).unwrap();
            challenge.rake_accrued = paid_rake;
            challenge.total_paid_attempts = paid_attempts;
            challenge.assert_accounting_invariant().unwrap();
            assert_eq!(challenge.expected_vault_balance().unwrap(), paid + sponsor);

            challenge.finalized_at = 1;
            challenge.settled_prize_pool = challenge.prize_liability;
            challenge.status = DailyStatus::Claimable;
            let claim = challenge.settled_prize_pool / 3;
            let forfeit = (challenge.settled_prize_pool - claim) / 2;
            challenge.prize_claimed = claim;
            challenge.prize_forfeited = forfeit;
            challenge.prize_liability = challenge
                .settled_prize_pool
                .checked_sub(claim)
                .and_then(|value| value.checked_sub(forfeit))
                .unwrap();
            challenge.rake_distributed = paid_rake;
            challenge.assert_accounting_invariant().unwrap();
            assert_eq!(
                challenge.expected_vault_balance().unwrap(),
                challenge.prize_liability
            );

            let mut cancelled = daily_challenge_fixture();
            cancelled.status = DailyStatus::Cancelled;
            cancelled.paid_entry_funding = paid;
            cancelled.sponsor_funding = sponsor;
            cancelled.refunds_paid = paid;
            cancelled.sponsor_reclaimed = true;
            cancelled.assert_accounting_invariant().unwrap();
            assert_eq!(cancelled.expected_vault_balance().unwrap(), 0);
        }
    }

    #[test]
    fn daily_vault_accounting_rejects_drift_and_overflow() {
        let mut challenge = daily_challenge_fixture();
        challenge.paid_entry_funding = 1_000_000;
        challenge.prize_liability = 899_999;
        challenge.rake_accrued = 100_000;
        assert!(challenge.assert_accounting_invariant().is_err());

        let mut impossible_outflow = daily_challenge_fixture();
        impossible_outflow.refunds_paid = 1;
        assert!(impossible_outflow.expected_vault_balance().is_err());

        let mut overflow = daily_challenge_fixture();
        overflow.paid_entry_funding = u64::MAX;
        overflow.sponsor_funding = 1;
        assert!(overflow.expected_vault_balance().is_err());
    }

    #[test]
    fn daily_leaderboard_keeps_one_best_score_and_deterministic_ties() {
        let challenge = Pubkey::new_unique();
        let early = Pubkey::new_unique();
        let late = Pubkey::new_unique();
        let mut board = DailyLeaderboard {
            version: 1,
            challenge,
            entries: Vec::new(),
            bump: 1,
        };
        board.record_best(DailyLeaderboardEntry {
            player: late,
            receipt: Pubkey::new_unique(),
            run_id: 1,
            score: 100,
            submitted_at: 20,
        });
        board.record_best(DailyLeaderboardEntry {
            player: early,
            receipt: Pubkey::new_unique(),
            run_id: 2,
            score: 100,
            submitted_at: 10,
        });
        board.record_best(DailyLeaderboardEntry {
            player: late,
            receipt: Pubkey::new_unique(),
            run_id: 3,
            score: 120,
            submitted_at: 30,
        });
        assert_eq!(board.entries.len(), 2);
        assert_eq!(board.entries[0].player, late);
        assert_eq!(board.entries[0].run_id, 3);
        assert_eq!(board.rank_of(early), Some(1));
    }

    #[test]
    fn daily_leaderboard_remains_bounded_and_sorted_under_load() {
        let mut board = DailyLeaderboard {
            version: 1,
            challenge: Pubkey::new_unique(),
            entries: Vec::new(),
            bump: 1,
        };
        for run_id in 1..=5_000u64 {
            let player_id = run_id % 257;
            let mut player_bytes = [0u8; 32];
            player_bytes[..8].copy_from_slice(&player_id.to_le_bytes());
            let mut receipt_bytes = [0u8; 32];
            receipt_bytes[..8].copy_from_slice(&run_id.to_le_bytes());
            board.record_best(DailyLeaderboardEntry {
                player: Pubkey::new_from_array(player_bytes),
                receipt: Pubkey::new_from_array(receipt_bytes),
                run_id,
                score: ((run_id * 7_919) % 100_000) as u32,
                submitted_at: (run_id % 97) as i64,
            });
            assert!(board.entries.len() <= DAILY_WINNERS);
        }
        assert_eq!(board.entries.len(), DAILY_WINNERS);
        for pair in board.entries.windows(2) {
            let [left, right] = pair else { unreachable!() };
            assert!(
                left.score > right.score
                    || left.score == right.score
                        && (left.submitted_at < right.submitted_at
                            || left.submitted_at == right.submitted_at
                                && left.player.to_bytes() < right.player.to_bytes())
            );
        }
        let unique = board
            .entries
            .iter()
            .map(|entry| entry.player)
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(unique.len(), board.entries.len());
    }

    fn daily_challenge_fixture() -> DailyChallenge {
        DailyChallenge {
            version: 1,
            day_id: 1,
            authority: Pubkey::new_unique(),
            status: DailyStatus::Open,
            content_version: 1,
            rules_hash: [0; 32],
            map_id: 1,
            rules: LevelRuleSnapshot::default(),
            endless_thresholds: [15, 40, 80, 150, 280, 500, 900],
            endless_score_multipliers_x100: [100, 150, 200, 300, 400, 600, 800, 1_000],
            endless_ramp_multiplier_x100: 100,
            payment_mint: Pubkey::new_unique(),
            payment_token_program: Pubkey::new_unique(),
            payment_vault: Pubkey::new_unique(),
            opens_at: 0,
            entries_close_at: 1,
            runs_close_at: 2,
            settlement_grace_close_at: 3,
            finalized_at: 0,
            claims_close_at: 0,
            entry_price: 1_000_000,
            star_entry_cost: 10,
            prize_bps: 9_000,
            rake_bps: 1_000,
            sponsor_funding: 0,
            paid_entry_funding: 0,
            prize_liability: 0,
            rake_accrued: 0,
            rake_distributed: 0,
            refunds_paid: 0,
            prize_claimed: 0,
            prize_forfeited: 0,
            settled_prize_pool: 0,
            sponsor_reclaimed: false,
            payout_bps: [4_000, 2_000, 1_200, 800, 600, 400, 300, 300, 200, 200],
            total_paid_attempts: 0,
            total_free_attempts: 0,
            runs_started: 0,
            runs_finalized: 0,
            bump: 1,
        }
    }

    #[test]
    fn star_refund_reverses_spend_without_minting_lifetime_earnings() {
        let owner = Pubkey::new_unique();
        let mut player = PlayerProfile::initialize(owner, 1);
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
        let mut player = PlayerProfile::initialize(owner, 1);
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
                    max_combo: 10,
                    perfect_level: true,
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
        assert_eq!(player.quest_counters[10], 20);

        player.roll_quest_cadences(day_one + 86_400);
        assert_eq!(player.quest_counters[0], 0);
        assert_eq!(player.quest_counters[10], 20);
    }

    #[test]
    fn quest_claim_bitmaps_reset_only_for_their_own_cadence() {
        let mut claims = QuestClaims {
            version: 1,
            owner: Pubkey::new_unique(),
            progress_version: 1,
            daily_cadence_id: 10,
            weekly_cadence_id: 2,
            daily_claimed: 0b11,
            weekly_claimed: 0b100,
            bump: 1,
        };
        claims.roll(11, 2);
        assert_eq!(claims.daily_claimed, 0);
        assert_eq!(claims.weekly_claimed, 0b100);
        claims.roll(11, 3);
        assert_eq!(claims.weekly_claimed, 0);
    }

    #[test]
    fn sponsorship_allowance_rolls_daily_and_gates_only_paid_attempts() {
        let owner = Pubkey::new_unique();
        let mut allowance = SponsorAllowance::initialize(owner, 10, 1);
        // The sponsored-transaction COUNT is no longer capped: many free
        // gameplay/settlement txs in a day all succeed and are only tracked.
        allowance.consume(10, 0, 2, 1).unwrap();
        allowance.consume(10, 0, 2, 1).unwrap();
        allowance.consume(10, 0, 2, 1).unwrap();
        allowance.consume(10, 0, 2, 1).unwrap();
        assert_eq!(allowance.sponsored_transactions, 4);
        assert_eq!(allowance.paid_daily_attempts, 0);
        // The paid Daily-attempt (USDC) limit is still enforced.
        allowance.consume(10, 1, 2, 1).unwrap();
        assert_eq!(allowance.paid_daily_attempts, 1);
        assert!(allowance.consume(10, 1, 2, 1).is_err());
        assert_eq!(allowance.paid_daily_attempts, 1);
        // Daily rollover resets both counters.
        allowance.consume(11, 1, 2, 1).unwrap();
        assert_eq!(allowance.sponsored_transactions, 1);
        assert_eq!(allowance.paid_daily_attempts, 1);
    }

    #[test]
    fn treasury_ledger_preserves_flow_classification_and_conservation() {
        let mut ledger = TreasuryLedger::initialize(Pubkey::new_unique(), Pubkey::new_unique(), 1);
        ledger.record_rake_distribution(101, 25, 25, 51).unwrap();
        ledger.record_prize_forfeiture(77).unwrap();
        ledger.record_map_sale(2_000_000).unwrap();
        ledger
            .record_revenue_sweep(2_000_000, 1_750_000, 250_000)
            .unwrap();
        assert_eq!(ledger.lifetime_rake_received, 101);
        assert_eq!(ledger.lifetime_team_distributed, 25);
        assert_eq!(ledger.lifetime_paymaster_distributed, 25);
        assert_eq!(ledger.lifetime_treasury_distributed, 51);
        assert_eq!(ledger.lifetime_prizes_forfeited_to_rewards, 77);
        assert_eq!(ledger.lifetime_map_sales, 2_000_000);
        assert_eq!(ledger.lifetime_revenue_swept, 2_000_000);
        assert_eq!(ledger.lifetime_revenue_to_treasury, 1_750_000);
        assert_eq!(ledger.lifetime_revenue_to_rewards, 250_000);
        assert_eq!(ledger.unswept_map_revenue().unwrap(), 0);
        ledger.record_strategy_deposit(1_000).unwrap();
        ledger.record_strategy_settlement(250, 50, 10).unwrap();
        ledger.record_strategy_settlement(0, 20, 0).unwrap();
        assert_eq!(ledger.lifetime_strategy_deposited, 1_000);
        assert_eq!(ledger.lifetime_strategy_principal_repaid, 250);
        assert_eq!(ledger.strategy_principal, 740);
        assert_eq!(ledger.realized_yield, 70);
        assert_eq!(ledger.realized_strategy_losses, 10);
        assert_eq!(ledger.unallocated_realized_yield().unwrap(), 70);
        ledger.record_yield_allocation(70, 10, 60).unwrap();
        assert_eq!(ledger.yield_allocated_to_rewards, 60);
        assert_eq!(ledger.yield_retained_in_treasury, 10);
        assert_eq!(ledger.unallocated_realized_yield().unwrap(), 0);
        ledger.validate_strategy_accounting().unwrap();
        assert!(ledger.record_strategy_settlement(741, 0, 0).is_err());
        assert!(ledger.record_yield_allocation(1, 0, 1).is_err());
        assert!(ledger.record_rake_distribution(100, 25, 25, 49).is_err());
    }
}
