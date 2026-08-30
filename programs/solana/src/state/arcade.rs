//! Native-SOL Daily and ranked-run accounting.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::arena_rules::{DailyPressureProfile, DailyThemeSnapshot};
use crate::state::protocol::{LevelRuleSnapshot, PlayerState};

pub const ARCADE_ACCOUNT_VERSION: u8 = zkube_core::ARCADE_ACCOUNT_VERSION;
pub const ARCADE_CONFIG_SEED: &[u8] = b"arcade";
pub const ARCADE_ARCHIVE_SEED: &[u8] = b"arcade_archive";
pub const CADENCE_FUNDING_SEED: &[u8] = b"cadence_funding";
pub const OPERATOR_REVENUE_VAULT_SEED: &[u8] = b"operator_revenue";
pub const CREDIT_VAULT_SEED: &[u8] = b"credit_vault";
pub const ARENA_DAILY_SEED: &[u8] = b"arena_daily";
pub const ARENA_BOARD_SEED: &[u8] = b"arena_board";
pub const ARENA_PLAYER_SEED: &[u8] = b"arena_player";

pub const LADDER_QUALIFY_POINTS: u32 = zkube_core::LADDER_QUALIFY_POINTS;

pub const ARENA_ENTRY_LAMPORTS: u64 = zkube_core::ARENA_ENTRY_LAMPORTS;
pub const ENTRY_DAILY_LAMPORTS: u64 = zkube_core::ENTRY_DAILY_LAMPORTS;
pub const ENTRY_OPERATOR_LAMPORTS: u64 = zkube_core::ENTRY_OPERATOR_LAMPORTS;
/// Hard safety ceiling for one independently allocated payout board. The width
/// rule remains authoritative below this ceiling and any narrowing is recorded
/// in the immutable board header.
pub const ARENA_BOARD_CAPACITY: usize = 1_536;
pub const ARENA_BOARD_CHUNK_CAPACITY: usize = 10;
pub const ARENA_BOARD_ENTRY_SIZE: usize = 84;
pub const ARENA_RUNS_CLOSE_OFFSET: i64 = 23 * 60 * 60 + 59 * 60;
pub const STUCK_RUN_RECOVERY_SECONDS: i64 = 6 * 60 * 60;
pub const ARCADE_SECONDS_PER_DAY: i64 = 86_400;

/// Routes canonical core hash schedules through Solana's SHA-256 syscall on
/// SBF while retaining byte-identical host behavior.
pub struct SolanaSha256;

impl zkube_core::Sha256Provider for SolanaSha256 {
    fn hashv(parts: &[&[u8]]) -> [u8; 32] {
        solana_sha256_hasher::hashv(parts).to_bytes()
    }
}

#[account]
#[derive(InitSpace)]
pub struct ArcadeConfig {
    pub version: u8,
    pub protocol: Pubkey,
    /// Days below this absolute identifier are suspended; zero disables it.
    pub suspended_until_day: u32,
    pub launch_seeded: bool,
    pub launch_day_id: u32,
    pub bump: u8,
}

impl ArcadeConfig {
    pub fn canonical(protocol: Pubkey, bump: u8) -> Self {
        Self {
            version: ARCADE_ACCOUNT_VERSION,
            protocol,
            suspended_until_day: 0,
            launch_seeded: false,
            launch_day_id: 0,
            bump,
        }
    }
}

/// Small, permanent commitment accumulator for recyclable cadence accounts.
///
/// The root is an append-only hash chain. `last_daily_id` advances by exactly
/// one for every archived result, beginning at the launch cadence.
/// Operational synchronization and rollup counters deliberately do not enter
/// the canonical result hashes, so those one-way cleanup steps cannot mutate
/// an already committed competition result.
#[account]
#[derive(InitSpace)]
pub struct ArcadeArchive {
    pub version: u8,
    pub arcade_config: Pubkey,
    pub first_daily_id: u32,
    pub last_daily_id: u32,
    pub daily_root: [u8; 32],
    pub bump: u8,
}

impl ArcadeArchive {
    pub fn initialize(arcade_config: Pubkey, launch_day_id: u32, bump: u8) -> Result<Self> {
        Ok(Self {
            version: ARCADE_ACCOUNT_VERSION,
            arcade_config,
            first_daily_id: launch_day_id,
            last_daily_id: launch_day_id
                .checked_sub(1)
                .ok_or(ErrorCode::InvalidPeriod)?,
            daily_root: [0; 32],
            bump,
        })
    }

    pub fn append_daily(&mut self, day_id: u32, result_hash: [u8; 32]) -> Result<()> {
        require!(
            day_id >= self.first_daily_id
                && ((self.last_daily_id < self.first_daily_id && day_id == self.first_daily_id)
                    || (self.last_daily_id >= self.first_daily_id && day_id > self.last_daily_id)),
            ErrorCode::InvalidPeriod
        );
        self.daily_root = crate::game::sha256v(&[
            b"zkube-arcade-daily-root-v1",
            &self.daily_root,
            &day_id.to_le_bytes(),
            &result_hash,
        ]);
        self.last_daily_id = day_id;
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct OperatorRevenueVault {
    pub version: u8,
    pub protocol: Pubkey,
    pub gross_operator_share: u64,
    pub withdrawn: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct CreditVault {
    pub version: u8,
    pub protocol: Pubkey,
    /// Exact 9,000,000-lamport prize deposits made by Kredit purchases.
    pub purchased_prize_lamports: u64,
    /// Exact prize deposits already routed by spent Kredits.
    pub spent_prize_lamports: u64,
    pub bump: u8,
}

impl CreditVault {
    pub fn available_prize_lamports(&self) -> Result<u64> {
        self.purchased_prize_lamports
            .checked_sub(self.spent_prize_lamports)
            .ok_or_else(|| error!(ErrorCode::AccountingInvariant))
    }

    pub fn record_purchase(&mut self, prize_lamports: u64) -> Result<()> {
        require!(prize_lamports > 0, ErrorCode::InvalidKreditPurchase);
        self.purchased_prize_lamports = self
            .purchased_prize_lamports
            .checked_add(prize_lamports)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn record_spend(&mut self, prize_lamports: u64) -> Result<()> {
        require!(
            prize_lamports == ENTRY_DAILY_LAMPORTS
                && self.available_prize_lamports()? >= prize_lamports,
            ErrorCode::AccountingInvariant
        );
        self.spent_prize_lamports = self
            .spent_prize_lamports
            .checked_add(prize_lamports)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub enum PeriodStatus {
    #[default]
    Funding,
    Open,
    Finalized,
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct PoolLedger {
    pub seeded_lamports: u64,
    pub entry_lamports: u64,
    pub rollover_in_lamports: u64,
    pub payout_lamports: u64,
    pub rollover_out_lamports: u64,
}

impl PoolLedger {
    pub fn funded_lamports(self) -> Result<u64> {
        self.seeded_lamports
            .checked_add(self.entry_lamports)
            .and_then(|value| value.checked_add(self.rollover_in_lamports))
            .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
    }

    pub fn available_lamports(self) -> Result<u64> {
        self.funded_lamports()?
            .checked_sub(self.payout_lamports)
            .and_then(|value| value.checked_sub(self.rollover_out_lamports))
            .ok_or_else(|| error!(ErrorCode::AccountingInvariant))
    }

    pub fn add_entry(&mut self, lamports: u64) -> Result<()> {
        self.entry_lamports = self
            .entry_lamports
            .checked_add(lamports)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn add_seed(&mut self, lamports: u64) -> Result<()> {
        self.seeded_lamports = self
            .seeded_lamports
            .checked_add(lamports)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn add_rollover(&mut self, lamports: u64) -> Result<()> {
        self.rollover_in_lamports = self
            .rollover_in_lamports
            .checked_add(lamports)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn settle(&mut self, payouts: u64, rollover: u64) -> Result<()> {
        require!(
            payouts.checked_add(rollover) == Some(self.available_lamports()?),
            ErrorCode::AccountingInvariant
        );
        self.payout_lamports = payouts;
        self.rollover_out_lamports = rollover;
        Ok(())
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct ArenaBoardEntry {
    pub player: Pubkey,
    pub score: u32,
    pub objective_total: u64,
    pub finalized_at: i64,
    pub replay_hash: [u8; 32],
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub enum DailyBoardKind {
    #[default]
    Score,
    Theme,
}

impl DailyBoardKind {
    pub const fn seed(self) -> &'static [u8] {
        match self {
            Self::Score => b"score",
            Self::Theme => b"theme",
        }
    }
}

#[account]
#[derive(Default, InitSpace)]
pub struct ArenaBoard {
    pub version: u8,
    pub arena_daily: Pubkey,
    pub day_id: u32,
    pub kind: DailyBoardKind,
    pub qualified_count: u32,
    pub width_count: u32,
    pub payout_count: u32,
    pub denominator: u128,
    pub pool_lamports: u64,
    pub paid_lamports: u64,
    pub rollover_lamports: u64,
    pub capacity_limited: bool,
    /// Number of verified rows already appended.
    pub cursor: u32,
    pub sealed: bool,
    /// Starts this board's independent reward-claim window.
    pub sealed_at: i64,
    pub claimed_lamports: u64,
    pub claimed_count: u32,
    pub bump: u8,
}

impl ArenaBoard {
    pub const HEADER_SIZE: usize = 8 + Self::INIT_SPACE;

    pub fn bitmap_size(payout_count: u32) -> Result<usize> {
        let count = usize::try_from(payout_count).map_err(|_| ErrorCode::ArithmeticOverflow)?;
        count
            .checked_add(7)
            .map(|value| value / 8)
            .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
    }

    pub fn account_space(payout_count: u32) -> Result<usize> {
        require!(
            usize::try_from(payout_count).is_ok_and(|count| count <= ARENA_BOARD_CAPACITY),
            ErrorCode::BoardCapacityExceeded
        );
        let rows = usize::try_from(payout_count)
            .map_err(|_| ErrorCode::ArithmeticOverflow)?
            .checked_mul(ARENA_BOARD_ENTRY_SIZE)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        let masks = Self::bitmap_size(payout_count)?;
        Self::HEADER_SIZE
            .checked_add(rows)
            .and_then(|value| value.checked_add(masks))
            .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
    }

    /// Anchor evaluates `space` before the handler can reject instruction
    /// arguments. Invalid counts deliberately map to zero so account creation
    /// fails closed without attempting an oversized allocation.
    pub fn account_space_for_init(payout_count: u32) -> usize {
        Self::account_space(payout_count).unwrap_or(0)
    }

    pub fn validate(&self, daily: Pubkey, kind: DailyBoardKind, data_len: usize) -> Result<()> {
        require!(
            self.version == ARCADE_ACCOUNT_VERSION
                && self.arena_daily == daily
                && self.kind == kind
                && self.payout_count <= self.width_count
                && self.payout_count <= self.qualified_count
                && usize::try_from(self.payout_count)
                    .is_ok_and(|count| count <= ARENA_BOARD_CAPACITY)
                && self.capacity_limited == (self.payout_count < self.width_count)
                && self.cursor <= self.payout_count
                && self.sealed == (self.cursor == self.payout_count)
                && ((!self.sealed && self.sealed_at == 0) || (self.sealed && self.sealed_at > 0))
                && self.claimed_count <= self.payout_count
                && data_len == Self::account_space(self.payout_count)?,
            ErrorCode::AccountingInvariant
        );
        Ok(())
    }

    pub fn payout_for_position(&self, position: u32) -> Result<u64> {
        require!(position < self.payout_count, ErrorCode::NoPrize);
        zkube_core::payout_for_rank(
            self.pool_lamports,
            self.denominator,
            position
                .checked_add(1)
                .ok_or(ErrorCode::ArithmeticOverflow)?,
            zkube_core::SOL_PAYOUT_UNIT_LAMPORTS,
        )
        .map_err(|_| error!(ErrorCode::AccountingInvariant))
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct SubmittedBoardEntry {
    pub score: u32,
    pub objective_total: u64,
    pub finalized_at: i64,
    pub replay_hash: [u8; 32],
}

impl SubmittedBoardEntry {
    pub fn with_player(self, player: Pubkey) -> ArenaBoardEntry {
        ArenaBoardEntry {
            player,
            score: self.score,
            objective_total: self.objective_total,
            finalized_at: self.finalized_at,
            replay_hash: self.replay_hash,
        }
    }
}

#[account]
#[derive(Default, InitSpace)]
pub struct ArenaDaily {
    pub version: u8,
    pub day_id: u32,
    pub arcade_config: Pubkey,
    pub status: PeriodStatus,
    pub predecessor_rollover_applied: bool,
    pub content_version: u32,
    pub rules_hash: [u8; 32],
    pub map_id: u8,
    pub daily_theme: DailyThemeSnapshot,
    pub rules: LevelRuleSnapshot,
    pub pressure: DailyPressureProfile,
    pub opens_at: i64,
    pub runs_close_at: i64,
    pub recovery_deadline_at: i64,
    pub finalized_at: i64,
    pub ledger: PoolLedger,
    pub entries_paid: u64,
    pub entries_scored: u64,
    pub entries_expired: u64,
    pub unique_players: u32,
    pub score_qualified_players: u32,
    pub theme_qualified_players: u32,
    /// Set exactly once after the claim window and unclaimed transfer.
    pub claims_expired: bool,
    pub bump: u8,
}

impl ArenaDaily {
    /// A first qualification on a board is exactly one transition per player,
    /// per board, per day, so the flat ladder credit rides it rather than
    /// carrying its own idempotence marker. It is never per entry: further
    /// entries may improve the retained row but report no new qualification, so
    /// the ladder cannot be bought.
    pub fn record_scored_entry(
        &mut self,
        player: &mut ArenaPlayer,
        player_state: &mut PlayerState,
        candidate: ArenaBoardEntry,
        run_id: u64,
    ) -> Result<()> {
        player_state.record_best_daily_score(candidate.score)?;
        if candidate.score > 0 && player.record_score(DailyBoardKind::Score, candidate, run_id) {
            self.score_qualified_players = self
                .score_qualified_players
                .checked_add(1)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            let _ = player_state.record_ladder_points(LADDER_QUALIFY_POINTS)?;
        }
        if candidate.objective_total > 0
            && player.record_score(DailyBoardKind::Theme, candidate, run_id)
        {
            self.theme_qualified_players = self
                .theme_qualified_players
                .checked_add(1)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            let _ = player_state.record_ladder_points(LADDER_QUALIFY_POINTS)?;
        }
        Ok(())
    }

    pub fn resolved(&self) -> bool {
        self.entries_scored
            .checked_add(self.entries_expired)
            .is_some_and(|resolved| resolved == self.entries_paid)
    }

    pub fn record_expired_entry(&mut self, player: &mut ArenaPlayer) -> Result<()> {
        require!(
            self.entries_scored
                .checked_add(self.entries_expired)
                .is_some_and(|resolved| resolved < self.entries_paid)
                && player.resolved_entries < player.paid_entries,
            ErrorCode::AccountingInvariant
        );
        self.entries_expired = self
            .entries_expired
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        player.resolved_entries = player
            .resolved_entries
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct ArenaPlayer {
    pub version: u8,
    pub challenge: Pubkey,
    pub player: Pubkey,
    /// Original signer that funded this account and receives its rent back.
    pub rent_payer: Pubkey,
    pub paid_entries: u32,
    pub resolved_entries: u32,
    pub active_paid_run_id: u64,
    pub has_score_best: bool,
    pub score_best_entry: ArenaBoardEntry,
    /// Retained outside the payout row for client replay/result identity.
    pub score_best_run_id: u64,
    pub has_theme_best: bool,
    pub theme_best_entry: ArenaBoardEntry,
    pub theme_best_run_id: u64,
    pub bump: u8,
}

impl ArenaPlayer {
    pub fn initialize(challenge: Pubkey, player: Pubkey, rent_payer: Pubkey, bump: u8) -> Self {
        Self {
            version: ARCADE_ACCOUNT_VERSION,
            challenge,
            player,
            rent_payer,
            paid_entries: 0,
            resolved_entries: 0,
            active_paid_run_id: 0,
            has_score_best: false,
            score_best_entry: ArenaBoardEntry::default(),
            score_best_run_id: 0,
            has_theme_best: false,
            theme_best_entry: ArenaBoardEntry::default(),
            theme_best_run_id: 0,
            bump,
        }
    }

    /// Returns true when this wallet first qualifies for the selected board.
    pub fn record_score(
        &mut self,
        board: DailyBoardKind,
        entry: ArenaBoardEntry,
        run_id: u64,
    ) -> bool {
        let (has_best, best, best_run_id) = match board {
            DailyBoardKind::Score => (
                &mut self.has_score_best,
                &mut self.score_best_entry,
                &mut self.score_best_run_id,
            ),
            DailyBoardKind::Theme => (
                &mut self.has_theme_best,
                &mut self.theme_best_entry,
                &mut self.theme_best_run_id,
            ),
        };
        let first = !*has_best;
        if first || compare_arena_entries(board, &entry, best).is_lt() {
            *best = entry;
            *best_run_id = run_id;
        }
        *has_best = true;
        first
    }

    pub fn resolved(&self) -> bool {
        self.resolved_entries == self.paid_entries
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BoardPayoutPlan {
    pub count: u32,
    pub width_count: u32,
    pub denominator: u128,
    pub capacity_limited: bool,
    pub paid_lamports: u64,
    pub rollover_lamports: u64,
}

pub fn board_payout_plan(pool: u64, qualified_winners: u32) -> Result<BoardPayoutPlan> {
    let width = zkube_core::board_width(
        pool,
        qualified_winners,
        ARENA_ENTRY_LAMPORTS,
        zkube_core::SOL_PAYOUT_UNIT_LAMPORTS,
    )
    .map_err(|_| error!(ErrorCode::AccountingInvariant))?;
    let maximum = u32::try_from(ARENA_BOARD_CAPACITY).map_err(|_| ErrorCode::ArithmeticOverflow)?;
    let count = width.winner_count.min(maximum);
    let paid_lamports = (1..=count).try_fold(0u64, |paid, rank| {
        let amount = zkube_core::payout_for_rank(
            pool,
            width.denominator,
            rank,
            zkube_core::SOL_PAYOUT_UNIT_LAMPORTS,
        )
        .map_err(|_| error!(ErrorCode::AccountingInvariant))?;
        paid.checked_add(amount)
            .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
    })?;
    Ok(BoardPayoutPlan {
        count,
        width_count: width.winner_count,
        denominator: width.denominator,
        capacity_limited: count < width.winner_count,
        paid_lamports,
        rollover_lamports: pool
            .checked_sub(paid_lamports)
            .ok_or(ErrorCode::AccountingInvariant)?,
    })
}

pub(crate) struct ArenaBoardInitialization {
    pub daily: Pubkey,
    pub day_id: u32,
    pub kind: DailyBoardKind,
    pub qualified_count: u32,
    pub pool_lamports: u64,
    pub plan: BoardPayoutPlan,
    pub finalized_at: i64,
    pub bump: u8,
}

pub(crate) fn initialize_arena_board(
    board: &mut ArenaBoard,
    initialization: ArenaBoardInitialization,
) {
    let ArenaBoardInitialization {
        daily,
        day_id,
        kind,
        qualified_count,
        pool_lamports,
        plan,
        finalized_at,
        bump,
    } = initialization;
    *board = ArenaBoard {
        version: ARCADE_ACCOUNT_VERSION,
        arena_daily: daily,
        day_id,
        kind,
        qualified_count,
        width_count: plan.width_count,
        payout_count: plan.count,
        denominator: plan.denominator,
        pool_lamports,
        paid_lamports: plan.paid_lamports,
        rollover_lamports: plan.rollover_lamports,
        capacity_limited: plan.capacity_limited,
        cursor: 0,
        sealed: plan.count == 0,
        sealed_at: if plan.count == 0 { finalized_at } else { 0 },
        claimed_lamports: 0,
        claimed_count: 0,
        bump,
    };
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RankedPrize {
    /// Zero-based payout position.
    pub position: u32,
    /// One-based board rank.
    pub rank: u16,
    pub amount: u64,
}

pub fn validate_finalized_board_binding(
    daily: &ArenaDaily,
    daily_key: Pubkey,
    board: &ArenaBoard,
    board_data_len: usize,
    kind: DailyBoardKind,
) -> Result<()> {
    require!(
        daily.status == PeriodStatus::Finalized,
        ErrorCode::InvalidState
    );
    board.validate(daily_key, kind, board_data_len)?;
    let pool = daily
        .ledger
        .payout_lamports
        .checked_add(daily.ledger.rollover_out_lamports)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let pools = daily_board_pools(pool, daily.theme_qualified_players);
    let (expected_pool, qualified) = match kind {
        DailyBoardKind::Score => (pools.score, daily.score_qualified_players),
        DailyBoardKind::Theme => (pools.theme, daily.theme_qualified_players),
    };
    require!(
        board.qualified_count == qualified
            && board.pool_lamports == expected_pool
            && board
                .paid_lamports
                .checked_add(board.rollover_lamports)
                .is_some_and(|accounted| accounted == expected_pool)
            && board.claimed_lamports <= board.paid_lamports,
        ErrorCode::AccountingInvariant
    );
    Ok(())
}

pub fn validate_finalized_board(
    daily: &ArenaDaily,
    daily_key: Pubkey,
    board: &ArenaBoard,
    board_data_len: usize,
    kind: DailyBoardKind,
) -> Result<()> {
    validate_finalized_board_binding(daily, daily_key, board, board_data_len, kind)?;
    let plan = board_payout_plan(board.pool_lamports, board.qualified_count)?;
    require!(
        board.payout_count == plan.count
            && board.width_count == plan.width_count
            && board.denominator == plan.denominator
            && board.capacity_limited == plan.capacity_limited
            && board.paid_lamports == plan.paid_lamports
            && board.rollover_lamports == plan.rollover_lamports,
        ErrorCode::AccountingInvariant
    );
    Ok(())
}

fn board_row_offset(position: u32) -> Result<usize> {
    let position = usize::try_from(position).map_err(|_| ErrorCode::ArithmeticOverflow)?;
    ArenaBoard::HEADER_SIZE
        .checked_add(
            position
                .checked_mul(ARENA_BOARD_ENTRY_SIZE)
                .ok_or(ErrorCode::ArithmeticOverflow)?,
        )
        .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
}

pub fn read_board_entry(info: &AccountInfo<'_>, position: u32) -> Result<ArenaBoardEntry> {
    let start = board_row_offset(position)?;
    let end = start
        .checked_add(ARENA_BOARD_ENTRY_SIZE)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let data = info.try_borrow_data()?;
    let bytes = data.get(start..end).ok_or(ErrorCode::AccountingInvariant)?;
    ArenaBoardEntry::try_from_slice(bytes).map_err(Into::into)
}

pub fn write_board_entry(
    info: &AccountInfo<'_>,
    position: u32,
    entry: &ArenaBoardEntry,
) -> Result<()> {
    let start = board_row_offset(position)?;
    let end = start
        .checked_add(ARENA_BOARD_ENTRY_SIZE)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let mut data = info.try_borrow_mut_data()?;
    let bytes = data
        .get_mut(start..end)
        .ok_or(ErrorCode::AccountingInvariant)?;
    let mut destination = &mut bytes[..];
    entry.serialize(&mut destination)?;
    require!(destination.is_empty(), ErrorCode::AccountingInvariant);
    Ok(())
}

fn board_bitmap_offset(board: &ArenaBoard, position: u32) -> Result<(usize, u8)> {
    require!(position < board.payout_count, ErrorCode::NoPrize);
    let rows = usize::try_from(board.payout_count)
        .map_err(|_| ErrorCode::ArithmeticOverflow)?
        .checked_mul(ARENA_BOARD_ENTRY_SIZE)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let position = usize::try_from(position).map_err(|_| ErrorCode::ArithmeticOverflow)?;
    let offset = ArenaBoard::HEADER_SIZE
        .checked_add(rows)
        .and_then(|value| value.checked_add(position / 8))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    Ok((offset, 1u8 << (position % 8)))
}

pub fn board_bitmap_is_set(
    info: &AccountInfo<'_>,
    board: &ArenaBoard,
    position: u32,
) -> Result<bool> {
    let (offset, bit) = board_bitmap_offset(board, position)?;
    let data = info.try_borrow_data()?;
    Ok(data.get(offset).is_some_and(|value| value & bit != 0))
}

pub fn set_board_bitmap(info: &AccountInfo<'_>, board: &ArenaBoard, position: u32) -> Result<()> {
    let (offset, bit) = board_bitmap_offset(board, position)?;
    let mut data = info.try_borrow_mut_data()?;
    let value = data.get_mut(offset).ok_or(ErrorCode::AccountingInvariant)?;
    require!(*value & bit == 0, ErrorCode::AlreadySubmitted);
    *value |= bit;
    Ok(())
}

pub fn ranked_prize_at_position(
    board: &ArenaBoard,
    board_info: &AccountInfo<'_>,
    owner: Pubkey,
    position: u32,
) -> Result<RankedPrize> {
    require!(
        board.sealed && board.cursor == board.payout_count,
        ErrorCode::BoardIncomplete
    );
    require_keys_eq!(
        read_board_entry(board_info, position)?.player,
        owner,
        ErrorCode::NoPrize
    );
    let amount = board.payout_for_position(position)?;
    require!(amount > 0, ErrorCode::NoPrize);
    Ok(RankedPrize {
        position,
        rank: u16::try_from(position + 1).map_err(|_| ErrorCode::ArithmeticOverflow)?,
        amount,
    })
}

pub fn day_id_at(timestamp: i64) -> Result<u32> {
    zkube_core::day_id_at(timestamp).map_err(|_| error!(ErrorCode::InvalidPeriod))
}

/// The first two eligible Dailies around a wall-clock day.
pub fn scheduled_daily_window(config: &ArcadeConfig, day_id: u32) -> Result<(u32, u32)> {
    let first = day_id.max(config.suspended_until_day);
    let following = first.checked_add(1).ok_or(ErrorCode::ArithmeticOverflow)?;
    Ok((first, following))
}

/// The first scheduled Daily that has not opened yet at `day_id`.
pub fn next_scheduled_daily(config: &ArcadeConfig, day_id: u32) -> Result<u32> {
    let (first, following) = scheduled_daily_window(config, day_id)?;
    Ok(if first > day_id { first } else { following })
}

/// Entries accept any later daily rather than re-deriving the schedule: the
/// expiry path pins `next_scheduled_daily` because it moves money
/// permissionlessly, but an entry's target is already fenced by account
/// existence (only the catalog-validated preparation path creates dailies)
/// and the Funding-status gate, and a misdirected entry could only fund a
/// real pot whose unclaimed balance rolls forward regardless.
pub fn valid_daily_successor(source_day_id: u32, successor_day_id: u32) -> bool {
    successor_day_id > source_day_id
}

pub fn day_window(day_id: u32) -> Result<(i64, i64, i64)> {
    let opens_at = i64::from(day_id)
        .checked_mul(ARCADE_SECONDS_PER_DAY)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    Ok((
        opens_at,
        opens_at
            .checked_add(ARENA_RUNS_CLOSE_OFFSET)
            .ok_or(ErrorCode::ArithmeticOverflow)?,
        opens_at
            .checked_add(ARENA_RUNS_CLOSE_OFFSET + STUCK_RUN_RECOVERY_SECONDS)
            .ok_or(ErrorCode::ArithmeticOverflow)?,
    ))
}

pub fn board_claim_deadline(sealed_at: i64) -> Result<i64> {
    require!(sealed_at > 0, ErrorCode::BoardIncomplete);
    sealed_at
        .checked_add(zkube_core::DAILY_REWARD_CLAIM_WINDOW_SECONDS)
        .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
}

pub fn daily_claim_deadline(score_board: &ArenaBoard, theme_board: &ArenaBoard) -> Result<i64> {
    Ok(board_claim_deadline(score_board.sealed_at)?
        .max(board_claim_deadline(theme_board.sealed_at)?))
}

/// Canonical finalized Daily result commitment. Mutable claim/profile state,
/// expiry, cursors, account bumps, and predecessor transport state are excluded
/// so archival remains immutable throughout the claim window.
pub fn daily_result_hash(
    daily: &ArenaDaily,
    score_board: &ArenaBoard,
    score_info: &AccountInfo<'_>,
    theme_board: &ArenaBoard,
    theme_info: &AccountInfo<'_>,
) -> Result<[u8; 32]> {
    require!(
        score_board.sealed
            && score_board.cursor == score_board.payout_count
            && theme_board.sealed
            && theme_board.cursor == theme_board.payout_count,
        ErrorCode::BoardIncomplete
    );
    let mut bytes = Vec::new();
    daily.version.serialize(&mut bytes)?;
    daily.day_id.serialize(&mut bytes)?;
    daily.arcade_config.serialize(&mut bytes)?;
    daily.content_version.serialize(&mut bytes)?;
    daily.rules_hash.serialize(&mut bytes)?;
    daily.map_id.serialize(&mut bytes)?;
    daily.daily_theme.serialize(&mut bytes)?;
    daily.rules.serialize(&mut bytes)?;
    daily.pressure.serialize(&mut bytes)?;
    daily.opens_at.serialize(&mut bytes)?;
    daily.runs_close_at.serialize(&mut bytes)?;
    daily.finalized_at.serialize(&mut bytes)?;
    daily.ledger.serialize(&mut bytes)?;
    daily.entries_paid.serialize(&mut bytes)?;
    daily.entries_scored.serialize(&mut bytes)?;
    daily.entries_expired.serialize(&mut bytes)?;
    daily.unique_players.serialize(&mut bytes)?;
    daily.score_qualified_players.serialize(&mut bytes)?;
    daily.theme_qualified_players.serialize(&mut bytes)?;
    let score_header = immutable_board_header(score_board)?;
    let theme_header = immutable_board_header(theme_board)?;
    let score_data = score_info.try_borrow_data()?;
    let theme_data = theme_info.try_borrow_data()?;
    let score_rows_end = board_row_offset(score_board.payout_count)?;
    let theme_rows_end = board_row_offset(theme_board.payout_count)?;
    let score_rows = score_data
        .get(ArenaBoard::HEADER_SIZE..score_rows_end)
        .ok_or(ErrorCode::AccountingInvariant)?;
    let theme_rows = theme_data
        .get(ArenaBoard::HEADER_SIZE..theme_rows_end)
        .ok_or(ErrorCode::AccountingInvariant)?;
    Ok(crate::game::sha256v(&[
        zkube_core::ARCADE_DAILY_RESULT_HASH_DOMAIN.as_bytes(),
        &bytes,
        &score_header,
        score_rows,
        &theme_header,
        theme_rows,
    ]))
}

pub fn immutable_board_header(board: &ArenaBoard) -> Result<Vec<u8>> {
    let mut bytes = Vec::with_capacity(96);
    board.version.serialize(&mut bytes)?;
    board.arena_daily.serialize(&mut bytes)?;
    board.day_id.serialize(&mut bytes)?;
    board.kind.serialize(&mut bytes)?;
    board.qualified_count.serialize(&mut bytes)?;
    board.width_count.serialize(&mut bytes)?;
    board.payout_count.serialize(&mut bytes)?;
    board.denominator.serialize(&mut bytes)?;
    board.pool_lamports.serialize(&mut bytes)?;
    board.paid_lamports.serialize(&mut bytes)?;
    board.rollover_lamports.serialize(&mut bytes)?;
    board.capacity_limited.serialize(&mut bytes)?;
    board.sealed_at.serialize(&mut bytes)?;
    Ok(bytes)
}

pub use zkube_core::{daily_board_pools, DailyBoardPools};

pub fn compare_arena_entries(
    board: DailyBoardKind,
    left: &ArenaBoardEntry,
    right: &ArenaBoardEntry,
) -> core::cmp::Ordering {
    let metric = |entry: &ArenaBoardEntry| match board {
        DailyBoardKind::Score => u64::from(entry.score),
        DailyBoardKind::Theme => entry.objective_total,
    };
    metric(right)
        .cmp(&metric(left))
        .then_with(|| left.finalized_at.cmp(&right.finalized_at))
        .then_with(|| left.player.to_bytes().cmp(&right.player.to_bytes()))
}

pub fn verify_submitted_board_entry(
    kind: DailyBoardKind,
    submitted: SubmittedBoardEntry,
    source: &ArenaPlayer,
) -> Result<ArenaBoardEntry> {
    let (has_best, expected) = match kind {
        DailyBoardKind::Score => (source.has_score_best, source.score_best_entry),
        DailyBoardKind::Theme => (source.has_theme_best, source.theme_best_entry),
    };
    let entry = submitted.with_player(source.player);
    require!(
        has_best
            && entry == expected
            && match kind {
                DailyBoardKind::Score => entry.score > 0,
                DailyBoardKind::Theme => entry.objective_total > 0,
            },
        ErrorCode::BoardEntryMismatch
    );
    Ok(entry)
}

pub fn verify_next_board_entry(
    kind: DailyBoardKind,
    previous: &ArenaBoardEntry,
    entry: &ArenaBoardEntry,
) -> Result<()> {
    require!(
        previous.player != entry.player,
        ErrorCode::DuplicateBoardPlayer
    );
    require!(
        compare_arena_entries(kind, previous, entry).is_lt(),
        ErrorCode::BoardEntryOutOfOrder
    );
    Ok(())
}

pub fn verify_board_completion(next_cursor: u32, payout_count: u32, seal: bool) -> Result<()> {
    require!(next_cursor <= payout_count, ErrorCode::AccountingInvariant);
    // Sealing is a program-computed fact. Submission is permissionless, and a
    // completing chunk without the flag would strand the board unsealable.
    require!(
        seal == (next_cursor == payout_count),
        ErrorCode::BoardIncomplete
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_split_is_exact_and_static() {
        let split = zkube_core::split_arena_entry(ARENA_ENTRY_LAMPORTS).unwrap();
        assert_eq!(split.total().unwrap(), ARENA_ENTRY_LAMPORTS);
    }

    #[test]
    fn kredit_purchase_and_spend_conserve_every_lamport() {
        let split = zkube_core::split_arena_entry(ARENA_ENTRY_LAMPORTS).unwrap();
        let count = 3u64;
        let prize = split.next_daily_lamports * count;
        let operator = split.operator_lamports * count;
        assert_eq!(prize + operator, ARENA_ENTRY_LAMPORTS * count);

        let mut vault = CreditVault {
            version: ARCADE_ACCOUNT_VERSION,
            protocol: Pubkey::new_unique(),
            purchased_prize_lamports: 0,
            spent_prize_lamports: 0,
            bump: 1,
        };
        vault.record_purchase(prize).unwrap();
        vault.record_spend(split.next_daily_lamports).unwrap();
        assert_eq!(
            vault.available_prize_lamports().unwrap(),
            split.next_daily_lamports * (count - 1)
        );
    }

    #[test]
    fn newly_prepared_daily_has_one_run_freeze_at_2359() {
        let (opens_at, runs_close_at, recovery_deadline_at) = day_window(20_658).unwrap();
        assert_eq!(runs_close_at - opens_at, 23 * 60 * 60 + 59 * 60);
        assert_eq!(
            recovery_deadline_at - runs_close_at,
            STUCK_RUN_RECOVERY_SECONDS
        );
    }

    #[test]
    fn boards_sealed_a_day_apart_each_receive_the_full_claim_window() {
        let score_sealed_at = 1_800_000_000;
        let theme_sealed_at = score_sealed_at + zkube_core::SECONDS_PER_DAY;
        let score = ArenaBoard {
            sealed: true,
            sealed_at: score_sealed_at,
            ..ArenaBoard::default()
        };
        let theme = ArenaBoard {
            sealed: true,
            sealed_at: theme_sealed_at,
            ..ArenaBoard::default()
        };
        assert_eq!(
            board_claim_deadline(score.sealed_at).unwrap(),
            score_sealed_at + zkube_core::DAILY_REWARD_CLAIM_WINDOW_SECONDS
        );
        assert_eq!(
            board_claim_deadline(theme.sealed_at).unwrap(),
            theme_sealed_at + zkube_core::DAILY_REWARD_CLAIM_WINDOW_SECONDS
        );
        assert_eq!(
            daily_claim_deadline(&score, &theme).unwrap(),
            theme_sealed_at + zkube_core::DAILY_REWARD_CLAIM_WINDOW_SECONDS
        );
    }

    #[test]
    fn archive_is_strictly_sequential() {
        let arcade = Pubkey::new_unique();
        let launch_day = 20_000;
        let mut archive = ArcadeArchive::initialize(arcade, launch_day, 7).unwrap();
        assert!(archive.append_daily(launch_day + 1, [2; 32]).is_err());
        archive.append_daily(launch_day, [1; 32]).unwrap();
        assert!(archive.append_daily(launch_day, [1; 32]).is_err());
        archive.append_daily(launch_day + 9, [3; 32]).unwrap();
        assert_eq!(archive.last_daily_id, launch_day + 9);
        assert_ne!(archive.daily_root, [0; 32]);
    }

    #[test]
    fn rank_weighted_payouts_conserve_the_board_pool() {
        let plan = board_payout_plan(101_990_000, 5).unwrap();
        assert_eq!(plan.count, 4);
        let amounts = (1..=plan.count)
            .map(|rank| {
                zkube_core::payout_for_rank(
                    101_990_000,
                    plan.denominator,
                    rank,
                    zkube_core::SOL_PAYOUT_UNIT_LAMPORTS,
                )
                .unwrap()
            })
            .collect::<Vec<_>>();
        assert!(amounts.windows(2).all(|pair| pair[0] >= pair[1]));
        assert_eq!(plan.paid_lamports + plan.rollover_lamports, 101_990_000);
        let fewer = board_payout_plan(101_500_000, 2).unwrap();
        assert_eq!(fewer.count, 2);
        assert_eq!(fewer.paid_lamports + fewer.rollover_lamports, 101_500_000);
    }

    #[test]
    fn classic_empty_theme_folds_the_whole_pool_into_score() {
        assert_eq!(
            daily_board_pools(101_000_001, 0),
            DailyBoardPools {
                score: 101_000_001,
                theme: 0,
            }
        );
        assert_eq!(
            daily_board_pools(101_000_001, 1),
            DailyBoardPools {
                score: 50_500_001,
                theme: 50_500_000,
            }
        );
    }

    #[test]
    fn twenty_thousand_entry_board_is_not_artificially_narrowed() {
        let pool = 90_000_000_000;
        let plan = board_payout_plan(pool, 20_000).unwrap();
        assert_eq!(plan.count, 1_176);
        assert_eq!(plan.width_count, 1_176);
        assert!(!plan.capacity_limited);
        assert_eq!(plan.paid_lamports + plan.rollover_lamports, pool);
    }

    #[test]
    fn zero_metrics_do_not_qualify_for_either_board() {
        let wallet = Pubkey::new_unique();
        let mut daily = ArenaDaily::default();
        let mut player = ArenaPlayer::initialize(Pubkey::new_unique(), wallet, wallet, 1);
        let mut state = PlayerState::initialize(wallet, 1);
        daily
            .record_scored_entry(
                &mut player,
                &mut state,
                ArenaBoardEntry {
                    player: wallet,
                    score: 0,
                    objective_total: 0,
                    ..ArenaBoardEntry::default()
                },
                1,
            )
            .unwrap();
        assert_eq!(daily.score_qualified_players, 0);
        assert_eq!(daily.theme_qualified_players, 0);
        assert!(!player.has_score_best);
        assert!(!player.has_theme_best);
        assert_eq!(state.ladder_points, 0);
    }

    /// Scores each `(score, objective_total)` entry as one paid run by the same
    /// player on the same day.
    fn score_entries(entries: &[(u32, u64)]) -> (ArenaDaily, ArenaPlayer, PlayerState) {
        let wallet = Pubkey::new_unique();
        let mut daily = ArenaDaily::default();
        let mut player = ArenaPlayer::initialize(Pubkey::new_unique(), wallet, wallet, 1);
        let mut state = PlayerState::initialize(wallet, 1);
        for (index, (score, objective_total)) in entries.iter().enumerate() {
            daily
                .record_scored_entry(
                    &mut player,
                    &mut state,
                    ArenaBoardEntry {
                        player: wallet,
                        score: *score,
                        objective_total: *objective_total,
                        finalized_at: i64::try_from(index).unwrap(),
                        ..ArenaBoardEntry::default()
                    },
                    u64::try_from(index).unwrap() + 1,
                )
                .unwrap();
        }
        (daily, player, state)
    }

    #[test]
    fn qualifying_on_both_boards_credits_the_ladder_twice() {
        let (daily, _, state) = score_entries(&[(100, 40)]);
        assert_eq!(daily.score_qualified_players, 1);
        assert_eq!(daily.theme_qualified_players, 1);
        assert_eq!(state.ladder_points, u64::from(LADDER_QUALIFY_POINTS) * 2);
    }

    #[test]
    fn qualifying_on_one_board_credits_the_ladder_once() {
        let (daily, _, state) = score_entries(&[(100, 0)]);
        assert_eq!(daily.score_qualified_players, 1);
        assert_eq!(daily.theme_qualified_players, 0);
        assert_eq!(state.ladder_points, u64::from(LADDER_QUALIFY_POINTS));
        // A Classic day yields no objective points at all, so its Theme board
        // credits nobody and the ladder still moves for the Score board.
    }

    #[test]
    fn the_flat_credit_is_per_board_per_day_and_never_per_entry() {
        let entries = [(10, 1), (500, 900), (20, 2), (5, 0)];
        let (daily, player, state) = score_entries(&entries);
        assert_eq!(daily.score_qualified_players, 1);
        assert_eq!(daily.theme_qualified_players, 1);
        // Twenty entries would credit no more than these four: only the first
        // qualification on each board pays, so the ladder cannot be bought.
        assert_eq!(state.ladder_points, u64::from(LADDER_QUALIFY_POINTS) * 2);
        assert_eq!(player.score_best_entry.score, 500);
        assert_eq!(player.theme_best_entry.objective_total, 900);
    }

    #[test]
    fn a_qualifier_who_never_places_still_leaves_with_a_ladder_total() {
        let (_, _, state) = score_entries(&[(1, 1)]);
        assert!(state.ladder_points > 0);
        assert_eq!(
            state.highest_ladder_tier,
            crate::state::protocol::ladder_tier_for_points(state.ladder_points)
        );
    }

    #[test]
    fn theme_only_qualification_credits_the_theme_board_alone() {
        let (daily, _, state) = score_entries(&[(0, 25)]);
        assert_eq!(daily.score_qualified_players, 0);
        assert_eq!(daily.theme_qualified_players, 1);
        assert_eq!(state.ladder_points, u64::from(LADDER_QUALIFY_POINTS));
    }

    #[test]
    fn arena_player_keeps_best_replay_and_its_run_identity() {
        let wallet = Pubkey::new_unique();
        let best = ArenaBoardEntry {
            player: wallet,
            score: 100,
            finalized_at: 10,
            replay_hash: [1; 32],
            ..ArenaBoardEntry::default()
        };
        let mut player = ArenaPlayer::initialize(Pubkey::new_unique(), wallet, wallet, 1);
        assert!(player.record_score(DailyBoardKind::Score, best, 1));
        assert!(!player.record_score(
            DailyBoardKind::Score,
            ArenaBoardEntry {
                player: wallet,
                score: 90,
                finalized_at: 11,
                replay_hash: [2; 32],
                ..ArenaBoardEntry::default()
            },
            2,
        ));
        assert_eq!(player.score_best_entry.replay_hash, [1; 32]);
        assert_eq!(player.score_best_run_id, 1);
    }

    #[test]
    fn account_sizes_and_maximum_board_rent_are_explicit() {
        assert_eq!(ArenaBoardEntry::INIT_SPACE, ARENA_BOARD_ENTRY_SIZE);
        assert_eq!(8 + ArenaDaily::INIT_SPACE, 233);
        let mut daily_bytes = Vec::new();
        ArenaDaily::default().serialize(&mut daily_bytes).unwrap();
        assert_eq!(daily_bytes.len(), 225);
        assert_eq!(ArenaBoard::INIT_SPACE, 117);
        assert_eq!(ArenaBoard::account_space(1_536).unwrap(), 129_341);
        assert_eq!(8 + ArenaPlayer::INIT_SPACE, 308);
        assert_eq!(
            Rent::default().minimum_balance(ArenaBoard::account_space(1_536).unwrap()),
            901_104_240
        );
        for size in [
            ArcadeConfig::INIT_SPACE,
            ArcadeArchive::INIT_SPACE,
            OperatorRevenueVault::INIT_SPACE,
            CreditVault::INIT_SPACE,
            ArenaDaily::INIT_SPACE,
            ArenaPlayer::INIT_SPACE,
        ] {
            assert!(8 + size < 10_240, "account allocation too large: {size}");
        }
    }

    #[test]
    fn maximum_board_last_place_can_be_read_and_claimed() {
        let count = u32::try_from(ARENA_BOARD_CAPACITY).unwrap();
        let plan = board_payout_plan(u64::MAX / 4, count).unwrap();
        let mut board = ArenaBoard::default();
        initialize_arena_board(
            &mut board,
            ArenaBoardInitialization {
                daily: Pubkey::new_unique(),
                day_id: 1,
                kind: DailyBoardKind::Score,
                qualified_count: count,
                pool_lamports: u64::MAX / 4,
                plan: BoardPayoutPlan { count, ..plan },
                finalized_at: 1,
                bump: 1,
            },
        );
        board.cursor = count;
        board.sealed = true;
        board.sealed_at = 1;
        let key = Pubkey::new_unique();
        let owner = crate::ID;
        let mut lamports = 0;
        let mut data = vec![0u8; ArenaBoard::account_space(count).unwrap()];
        let info = AccountInfo::new(&key, false, true, &mut lamports, &mut data, &owner, false);
        let player = Pubkey::new_unique();
        let entry = ArenaBoardEntry {
            player,
            score: 1,
            ..ArenaBoardEntry::default()
        };
        write_board_entry(&info, count - 1, &entry).unwrap();
        let prize = ranked_prize_at_position(&board, &info, player, count - 1).unwrap();
        assert_eq!(prize.position, count - 1);
        assert_eq!(prize.amount, board.payout_for_position(count - 1).unwrap());
        set_board_bitmap(&info, &board, count - 1).unwrap();
        assert!(board_bitmap_is_set(&info, &board, count - 1).unwrap());
    }

    fn score_source(entry: ArenaBoardEntry) -> ArenaPlayer {
        let mut source =
            ArenaPlayer::initialize(Pubkey::new_unique(), entry.player, entry.player, 1);
        source.has_score_best = true;
        source.score_best_entry = entry;
        source
    }

    fn submitted(entry: ArenaBoardEntry) -> SubmittedBoardEntry {
        SubmittedBoardEntry {
            score: entry.score,
            objective_total: entry.objective_total,
            finalized_at: entry.finalized_at,
            replay_hash: entry.replay_hash,
        }
    }

    #[test]
    fn submitted_metrics_must_match_arena_player_exactly() {
        let entry = ArenaBoardEntry {
            player: Pubkey::new_unique(),
            score: 100,
            finalized_at: 7,
            replay_hash: [9; 32],
            ..ArenaBoardEntry::default()
        };
        let source = score_source(entry);
        let mut wrong = submitted(entry);
        wrong.score += 1;
        assert!(verify_submitted_board_entry(DailyBoardKind::Score, wrong, &source).is_err());
        assert_eq!(
            verify_submitted_board_entry(DailyBoardKind::Score, submitted(entry), &source).unwrap(),
            entry
        );
    }

    #[test]
    fn board_rejects_metric_order_tiebreak_order_and_duplicates() {
        let first = ArenaBoardEntry {
            player: Pubkey::new_from_array([1; 32]),
            score: 100,
            finalized_at: 10,
            ..ArenaBoardEntry::default()
        };
        let better = ArenaBoardEntry {
            score: 101,
            ..first
        };
        assert!(verify_next_board_entry(DailyBoardKind::Score, &first, &better).is_err());

        let later_tie = ArenaBoardEntry {
            player: Pubkey::new_from_array([2; 32]),
            finalized_at: 11,
            ..first
        };
        assert!(verify_next_board_entry(DailyBoardKind::Score, &later_tie, &first).is_err());
        let wallet_tie = ArenaBoardEntry {
            finalized_at: 10,
            ..later_tie
        };
        assert!(verify_next_board_entry(DailyBoardKind::Score, &wallet_tie, &first).is_err());
        assert!(verify_next_board_entry(DailyBoardKind::Score, &first, &first).is_err());
    }

    #[test]
    fn seal_requires_the_program_computed_count_and_partial_board_is_unclaimable() {
        assert!(verify_board_completion(9, 10, true).is_err());
        assert!(verify_board_completion(11, 10, false).is_err());
        assert!(verify_board_completion(10, 10, false).is_err());
        verify_board_completion(9, 10, false).unwrap();
        verify_board_completion(10, 10, true).unwrap();

        let board = ArenaBoard {
            payout_count: 1,
            cursor: 1,
            sealed: false,
            ..ArenaBoard::default()
        };
        let key = Pubkey::new_unique();
        let owner = crate::ID;
        let mut lamports = 0;
        let mut data = vec![0u8; ArenaBoard::account_space(1).unwrap()];
        let info = AccountInfo::new(&key, false, false, &mut lamports, &mut data, &owner, false);
        assert!(ranked_prize_at_position(&board, &info, Pubkey::new_unique(), 0).is_err());
    }

    #[test]
    fn ordering_carries_across_many_chunks() {
        let entries = (0..27)
            .map(|index| ArenaBoardEntry {
                player: Pubkey::new_from_array([u8::try_from(index + 1).unwrap(); 32]),
                score: 1_000 - index,
                finalized_at: i64::from(index),
                ..ArenaBoardEntry::default()
            })
            .collect::<Vec<_>>();
        let mut carried = None;
        for chunk in entries.chunks(ARENA_BOARD_CHUNK_CAPACITY) {
            for entry in chunk {
                if let Some(previous) = carried {
                    verify_next_board_entry(DailyBoardKind::Score, &previous, entry).unwrap();
                }
                carried = Some(*entry);
            }
        }
        assert_eq!(carried, entries.last().copied());
    }

    #[test]
    fn claimed_expired_and_rounding_rollover_conserve_the_pot() {
        let pool = 90_000_000_000;
        let plan = board_payout_plan(pool, 20_000).unwrap();
        let claimed = (1..=plan.count)
            .step_by(3)
            .try_fold(0u64, |sum, rank| {
                sum.checked_add(
                    zkube_core::payout_for_rank(
                        pool,
                        plan.denominator,
                        rank,
                        zkube_core::SOL_PAYOUT_UNIT_LAMPORTS,
                    )
                    .unwrap(),
                )
            })
            .unwrap();
        let expired = plan.paid_lamports - claimed;
        assert_eq!(claimed + expired + plan.rollover_lamports, pool);
    }
}
