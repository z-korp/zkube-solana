//! Native-SOL Daily and arcade-run accounting.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::protocol::{ACCOUNT_VERSION, PlayerState};

pub const CADENCE_FUNDING_SEED: &[u8] = b"cadence_funding";
pub const CREDIT_VAULT_SEED: &[u8] = b"credit_vault";
pub const ARENA_DAILY_SEED: &[u8] = b"arena_daily";
pub const ARENA_BOARD_SEED: &[u8] = b"arena_board";
pub const ARENA_PLAYER_SEED: &[u8] = b"arena_player";

pub const LADDER_QUALIFY_POINTS: u32 = zkube_core::LADDER_QUALIFY_POINTS;

pub const ARENA_ENTRY_LAMPORTS: u64 = zkube_core::ARENA_ENTRY_LAMPORTS;
/// The most rows one board retains, during the day and after finalization.
/// The width rule remains authoritative below this ceiling and any narrowing
/// is recorded in the immutable board header.
pub const ARENA_BOARD_CAPACITY: usize = zkube_core::ARENA_BOARD_CAPACITY;
/// Distinct players one Daily admits: the widest board the core sizes.
pub const ARENA_DAILY_PLAYER_CAPACITY: u32 = zkube_core::ARENA_DAILY_PLAYER_CAPACITY;
/// Rent a player's first entry of the day moves into each board: one row and
/// its claim bit, rounded up to a byte.
pub const ARENA_BOARD_FUNDED_ROW_BYTES: usize = ArenaBoardEntry::INIT_SPACE + 1;
pub const STUCK_RUN_RECOVERY_SECONDS: i64 = zkube_core::RUN_RECOVERY_SECONDS;

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
pub struct CreditVault {
    pub version: u8,
    pub protocol: Pubkey,
    /// Prize deposits not yet routed to a Daily by spent Kredits.
    pub available_prize_lamports: u64,
    pub bump: u8,
}

impl CreditVault {
    pub fn record_purchase(&mut self, prize_lamports: u64) -> Result<()> {
        require!(prize_lamports > 0, ErrorCode::InvalidState);
        self.available_prize_lamports = self
            .available_prize_lamports
            .checked_add(prize_lamports)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn record_spend(&mut self, prize_lamports: u64) -> Result<()> {
        self.available_prize_lamports = self
            .available_prize_lamports
            .checked_sub(prize_lamports)
            .ok_or(ErrorCode::AccountingInvariant)?;
        Ok(())
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct PoolLedger {
    pub seeded_lamports: u64,
    /// The prize share of the entries of the Daily before this one.
    pub entry_lamports: u64,
    pub rollover_in_lamports: u64,
    pub payout_lamports: u64,
    pub rollover_out_lamports: u64,
    /// The prize share of this Daily's own entries. It waits here, outside
    /// this Daily's pot, and moves to the next Daily at finalization.
    pub next_pot_lamports: u64,
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

    pub fn add_next_pot(&mut self, lamports: u64) -> Result<()> {
        self.next_pot_lamports = self
            .next_pot_lamports
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

/// Logged when a Daily really finalizes: not when a finalization finds it done
/// already, and not when one yields for lack of compute. The public read model
/// records a finalization only from this.
#[event]
pub struct DailyFinalized {
    pub day_id: u32,
}

/// Logged when a scored run is consumed. A finalized board keeps only its
/// paying rows and daily player accounts close, so this is the public record
/// of every result, including the ranks below the paying rows. It grants
/// nothing: boards and claims never read it.
#[event]
pub struct RunScored {
    pub day_id: u32,
    pub run_id: u64,
    pub row: ArenaBoardEntry,
}

/// A wallet's best result on one board of one Daily. The wallet is the
/// daily player account's own `player`, so it is not repeated here.
#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace, PartialEq, Eq,
)]
pub struct BestRun {
    pub score: u32,
    pub objective_total: u64,
    pub finalized_at: i64,
    pub replay_hash: [u8; 32],
}

impl BestRun {
    pub fn of(entry: &ArenaBoardEntry) -> Self {
        Self {
            score: entry.score,
            objective_total: entry.objective_total,
            finalized_at: entry.finalized_at,
            replay_hash: entry.replay_hash,
        }
    }

    /// The board row this result makes for `player`.
    pub fn row(self, player: Pubkey) -> ArenaBoardEntry {
        ArenaBoardEntry {
            player,
            score: self.score,
            objective_total: self.objective_total,
            finalized_at: self.finalized_at,
            replay_hash: self.replay_hash,
        }
    }
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

/// One board of a Daily. While the Daily runs, the account is this header
/// followed by the retained rows, best first; only consuming a run writes
/// them. Finalization fills the payout fields, keeps the paying rows and
/// appends one claim bit per row. A board is sealed exactly when its Daily is
/// finalized, so it carries no clock of its own.
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

    /// Size while the Daily runs: the header and `rows` retained rows.
    pub fn open_space(rows: usize) -> Result<usize> {
        require!(rows <= ARENA_BOARD_CAPACITY, ErrorCode::BoardIncomplete);
        Ok(Self::HEADER_SIZE + rows * ArenaBoardEntry::INIT_SPACE)
    }

    /// The retained row count of a board whose Daily is still running.
    pub fn open_rows(data_len: usize) -> Result<usize> {
        let rows = data_len
            .checked_sub(Self::HEADER_SIZE)
            .ok_or(ErrorCode::AccountingInvariant)?;
        require!(
            rows % ArenaBoardEntry::INIT_SPACE == 0
                && rows / ArenaBoardEntry::INIT_SPACE <= ARENA_BOARD_CAPACITY,
            ErrorCode::AccountingInvariant
        );
        Ok(rows / ArenaBoardEntry::INIT_SPACE)
    }

    /// Size once finalized: the header, the paying rows and their claim bits.
    pub fn account_space(payout_count: u32) -> Result<usize> {
        let rows = usize::try_from(payout_count).map_err(|_| ErrorCode::ArithmeticOverflow)?;
        Ok(Self::open_space(rows)? + Self::bitmap_size(payout_count)?)
    }

    /// The most a board that has taken `entrants` first entries can need, in
    /// either shape: every entrant's row and claim bit.
    pub fn funded_space(entrants: u32) -> usize {
        let rows = usize::try_from(entrants)
            .unwrap_or(ARENA_BOARD_CAPACITY)
            .min(ARENA_BOARD_CAPACITY);
        Self::HEADER_SIZE + rows * ARENA_BOARD_FUNDED_ROW_BYTES
    }

    pub fn bound_to(&self, daily: Pubkey, kind: DailyBoardKind) -> bool {
        self.version == ACCOUNT_VERSION && self.arena_daily == daily && self.kind == kind
    }

    /// Checks a finalized board's shape.
    pub fn validate(&self, daily: Pubkey, kind: DailyBoardKind, data_len: usize) -> Result<()> {
        require!(
            self.bound_to(daily, kind)
                && self.payout_count <= self.width_count
                && self.payout_count <= self.qualified_count
                && usize::try_from(self.payout_count)
                    .is_ok_and(|count| count <= ARENA_BOARD_CAPACITY)
                && self.capacity_limited == (self.payout_count < self.width_count)
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

#[account]
#[derive(Debug, Default, InitSpace, PartialEq, Eq)]
pub struct ArenaDaily {
    pub version: u8,
    pub day_id: u32,
    /// The Daily prepared before this one. Its entries' prize share and its
    /// rollover reach this Daily only from that day, when it finalizes.
    pub predecessor_day: u32,
    pub predecessor_rollover_applied: bool,
    pub rules_hash: [u8; 32],
    pub finalized_at: i64,
    pub ledger: PoolLedger,
    pub entries_paid: u64,
    pub entries_scored: u64,
    pub entries_expired: u64,
    pub unique_players: u32,
    pub score_qualified_players: u32,
    pub theme_qualified_players: u32,
    pub bump: u8,
}

impl ArenaDaily {
    /// A Daily has no status to set: it is open while the clock is inside its
    /// window, and finalized once it carries the time it was.
    pub fn finalized(&self) -> bool {
        self.finalized_at != 0
    }

    /// A Daily prepared for a day before the launch day. Launch happened on
    /// a later Daily, so this one was never seeded or entered, is no member of
    /// the chain or the result root, and holds nothing but rent.
    pub fn never_launched(&self, launch_day: u32) -> bool {
        launch_day != 0
            && self.day_id < launch_day
            && !self.finalized()
            && self.entries_paid == 0
            && self.ledger == PoolLedger::default()
    }

    /// Finalizes this Daily's money: unresolved entries count as expired, the
    /// pot that reached it from before is split into what its boards pay and
    /// what they do not, and the successor receives the rest together with
    /// this Daily's own entries' share, which was never in its pot.
    pub fn settle_into(&mut self, successor: &mut ArenaDaily, now: i64) -> Result<DailySettlement> {
        self.entries_expired = self
            .entries_paid
            .checked_sub(self.entries_scored)
            .ok_or(ErrorCode::AccountingInvariant)?;
        let pool = self.ledger.available_lamports()?;
        let next_pot = self.ledger.next_pot_lamports;
        let pools = daily_board_pools(pool, self.theme_qualified_players);
        let score = board_payout_plan(pools.score, self.score_qualified_players)?;
        let theme = board_payout_plan(pools.theme, self.theme_qualified_players)?;
        let paid = score
            .paid_lamports
            .checked_add(theme.paid_lamports)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        let rollover = score
            .rollover_lamports
            .checked_add(theme.rollover_lamports)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        self.ledger.settle(paid, rollover)?;
        successor.ledger.add_rollover(rollover)?;
        successor.ledger.add_entry(next_pot)?;
        successor.predecessor_rollover_applied = true;
        self.finalized_at = now;
        Ok(DailySettlement {
            pools,
            score,
            theme,
            forwarded_lamports: rollover
                .checked_add(next_pot)
                .ok_or(ErrorCode::ArithmeticOverflow)?,
            held_lamports: pool
                .checked_add(next_pot)
                .ok_or(ErrorCode::ArithmeticOverflow)?,
        })
    }

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
    ) -> Result<[BestRow; 2]> {
        player_state.record_best_daily_score(candidate.score)?;
        let mut changes = [BestRow::Kept; 2];
        for (index, kind, metric) in [
            (0, DailyBoardKind::Score, u64::from(candidate.score)),
            (1, DailyBoardKind::Theme, candidate.objective_total),
        ] {
            if metric == 0 {
                continue;
            }
            changes[index] = player.record_score(kind, candidate);
            if changes[index] == BestRow::First {
                let qualified = match kind {
                    DailyBoardKind::Score => &mut self.score_qualified_players,
                    DailyBoardKind::Theme => &mut self.theme_qualified_players,
                };
                *qualified = qualified
                    .checked_add(1)
                    .ok_or(ErrorCode::ArithmeticOverflow)?;
                let _ = player_state.record_ladder_points(LADDER_QUALIFY_POINTS)?;
            }
        }
        Ok(changes)
    }

    /// The one funding edge out of `self`: the Daily prepared directly after
    /// it. Later suspension changes never remap an edge.
    pub fn require_funding_successor(&self, successor: &ArenaDaily) -> Result<()> {
        require!(
            successor.version == ACCOUNT_VERSION
                && successor.day_id > self.day_id
                && successor.predecessor_day == self.day_id,
            ErrorCode::InvalidPeriod
        );
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
    pub score_best: BestRun,
    pub theme_best: BestRun,
    pub bump: u8,
}

impl ArenaPlayer {
    pub fn initialize(challenge: Pubkey, player: Pubkey, rent_payer: Pubkey, bump: u8) -> Self {
        Self {
            version: ACCOUNT_VERSION,
            challenge,
            player,
            rent_payer,
            paid_entries: 0,
            resolved_entries: 0,
            active_paid_run_id: 0,
            score_best: BestRun::default(),
            theme_best: BestRun::default(),
            bump,
        }
    }

    /// Keeps the better of this wallet's stored row and `entry` for the
    /// selected board, and says what the board must do about it.
    pub fn record_score(&mut self, board: DailyBoardKind, entry: ArenaBoardEntry) -> BestRow {
        let player = self.player;
        let best = match board {
            DailyBoardKind::Score => &mut self.score_best,
            DailyBoardKind::Theme => &mut self.theme_best,
        };
        let first = match board {
            DailyBoardKind::Score => best.score == 0,
            DailyBoardKind::Theme => best.objective_total == 0,
        };
        if first {
            *best = BestRun::of(&entry);
            BestRow::First
        } else if compare_arena_entries(board, &entry, &best.row(player)).is_lt() {
            BestRow::Improved(core::mem::replace(best, BestRun::of(&entry)).row(player))
        } else {
            BestRow::Kept
        }
    }

    pub fn resolved(&self) -> bool {
        self.resolved_entries == self.paid_entries
    }
}

/// What one scored run did to a wallet's best row on one board.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BestRow {
    /// The stored row still stands; the board is untouched.
    Kept,
    /// The wallet's first qualification on this board today.
    First,
    /// A better row replaced the one given here.
    Improved(ArenaBoardEntry),
}

/// What finalizing a Daily decided: each board's pool and plan, what the
/// account held for it, and what moves to its successor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DailySettlement {
    pub pools: DailyBoardPools,
    pub score: BoardPayoutPlan,
    pub theme: BoardPayoutPlan,
    pub forwarded_lamports: u64,
    pub held_lamports: u64,
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
    let paid_lamports = zkube_core::sum_rank_payouts(
        pool,
        width.denominator,
        count,
        zkube_core::SOL_PAYOUT_UNIT_LAMPORTS,
    )
    .map_err(|_| error!(ErrorCode::AccountingInvariant))?;
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

/// Where one consumed result goes among a board's retained rows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RowPlacement {
    /// The board is full and the result ranks below its last row.
    Outside,
    /// Write the row at `at`, moving the rows from there up to `vacated` one
    /// place down. `vacated` is the wallet's earlier row, the new last row of
    /// a growing board, or the last row a full board drops.
    Insert {
        at: usize,
        vacated: usize,
        grows: bool,
    },
}

fn board_row(rows: &[u8], position: usize) -> Result<ArenaBoardEntry> {
    let start = position * ArenaBoardEntry::INIT_SPACE;
    let bytes = rows
        .get(start..start + ArenaBoardEntry::INIT_SPACE)
        .ok_or(ErrorCode::AccountingInvariant)?;
    ArenaBoardEntry::try_from_slice(bytes).map_err(Into::into)
}

/// Binary search among `count` rows sorted best first.
fn find_board_row(
    rows: &[u8],
    count: usize,
    kind: DailyBoardKind,
    entry: &ArenaBoardEntry,
) -> Result<core::result::Result<usize, usize>> {
    let (mut low, mut high) = (0, count);
    while low < high {
        let middle = low + (high - low) / 2;
        match compare_arena_entries(kind, &board_row(rows, middle)?, entry) {
            core::cmp::Ordering::Less => low = middle + 1,
            core::cmp::Ordering::Greater => high = middle,
            core::cmp::Ordering::Equal => return Ok(Ok(middle)),
        }
    }
    Ok(Err(low))
}

/// The one owner of board ranking. `rows` holds `count` rows sorted best
/// first, at most one per wallet. `previous` is the wallet's earlier best row
/// when it had one; it is still on the board unless better rows pushed it off
/// the end. Because a row only ever leaves from the end, every wallet outside
/// the board ranks below every row on it, so the rows always equal a full
/// sort of every qualifier's best, cut at capacity, in any consume order.
pub fn place_board_row(
    rows: &[u8],
    count: usize,
    kind: DailyBoardKind,
    previous: Option<&ArenaBoardEntry>,
    entry: &ArenaBoardEntry,
) -> Result<RowPlacement> {
    let earlier = match previous {
        Some(previous) => find_board_row(rows, count, kind, previous)?.ok(),
        None => None,
    };
    let Err(at) = find_board_row(rows, count, kind, entry)? else {
        return err!(ErrorCode::AccountingInvariant);
    };
    Ok(match earlier {
        Some(vacated) => {
            require!(at <= vacated, ErrorCode::AccountingInvariant);
            RowPlacement::Insert {
                at,
                vacated,
                grows: false,
            }
        }
        None if count < ARENA_BOARD_CAPACITY => RowPlacement::Insert {
            at,
            vacated: count,
            grows: true,
        },
        None if at < count => RowPlacement::Insert {
            at,
            vacated: count - 1,
            grows: false,
        },
        None => RowPlacement::Outside,
    })
}

/// Applies an [`RowPlacement::Insert`] to rows that already have room for it.
pub fn write_board_row(
    rows: &mut [u8],
    at: usize,
    vacated: usize,
    entry: &ArenaBoardEntry,
) -> Result<()> {
    const ROW: usize = ArenaBoardEntry::INIT_SPACE;
    require!(
        at <= vacated && (vacated + 1) * ROW <= rows.len(),
        ErrorCode::AccountingInvariant
    );
    rows.copy_within(at * ROW..vacated * ROW, (at + 1) * ROW);
    let mut destination = &mut rows[at * ROW..(at + 1) * ROW];
    entry.serialize(&mut destination)?;
    Ok(())
}

/// Offers one consumed result to an open board account. The first entry of
/// each wallet already moved a row's rent into the board, so growth needs no
/// payer here.
pub fn retain_board_row(
    info: &AccountInfo<'_>,
    kind: DailyBoardKind,
    previous: Option<&ArenaBoardEntry>,
    entry: &ArenaBoardEntry,
) -> Result<()> {
    let count = ArenaBoard::open_rows(info.data_len())?;
    let placement = place_board_row(
        &info.try_borrow_data()?[ArenaBoard::HEADER_SIZE..],
        count,
        kind,
        previous,
        entry,
    )?;
    let RowPlacement::Insert { at, vacated, grows } = placement else {
        return Ok(());
    };
    if grows {
        let space = ArenaBoard::open_space(count + 1)?;
        require!(
            info.lamports() >= Rent::get()?.minimum_balance(space),
            ErrorCode::AccountingInvariant
        );
        info.resize(space)?;
    }
    write_board_row(
        &mut info.try_borrow_mut_data()?[ArenaBoard::HEADER_SIZE..],
        at,
        vacated,
        entry,
    )
}

/// Fills a board's payout fields at finalization. The caller then cuts the
/// account to its paying rows and claim bits.
pub(crate) fn seal_arena_board(
    board: &mut ArenaBoard,
    qualified_count: u32,
    pool_lamports: u64,
    plan: BoardPayoutPlan,
) {
    board.qualified_count = qualified_count;
    board.width_count = plan.width_count;
    board.payout_count = plan.count;
    board.denominator = plan.denominator;
    board.pool_lamports = pool_lamports;
    board.paid_lamports = plan.paid_lamports;
    board.rollover_lamports = plan.rollover_lamports;
    board.capacity_limited = plan.capacity_limited;
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
    require!(daily.finalized(), ErrorCode::InvalidState);
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

fn board_row_offset(position: u32) -> Result<usize> {
    let position = usize::try_from(position).map_err(|_| ErrorCode::ArithmeticOverflow)?;
    ArenaBoard::HEADER_SIZE
        .checked_add(
            position
                .checked_mul(ArenaBoardEntry::INIT_SPACE)
                .ok_or(ErrorCode::ArithmeticOverflow)?,
        )
        .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
}

pub fn read_board_entry(info: &AccountInfo<'_>, position: u32) -> Result<ArenaBoardEntry> {
    let start = board_row_offset(position)?;
    let end = start
        .checked_add(ArenaBoardEntry::INIT_SPACE)
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
        .checked_add(ArenaBoardEntry::INIT_SPACE)
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
        .checked_mul(ArenaBoardEntry::INIT_SPACE)
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
    require!(*value & bit == 0, ErrorCode::InvalidState);
    *value |= bit;
    Ok(())
}

pub fn arcade_prize_at_position(
    board: &ArenaBoard,
    board_info: &AccountInfo<'_>,
    owner: Pubkey,
    position: u32,
) -> Result<RankedPrize> {
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

pub fn day_window(day_id: u32) -> Result<(i64, i64, i64)> {
    Ok(zkube_core::daily_window(day_id))
}

/// Rewards stay claimable for the claim window from the Daily's finalization,
/// which is when both of its boards seal.
pub fn daily_claim_deadline(daily: &ArenaDaily) -> Result<i64> {
    require!(daily.finalized(), ErrorCode::BoardIncomplete);
    daily
        .finalized_at
        .checked_add(zkube_core::DAILY_REWARD_CLAIM_WINDOW_SECONDS)
        .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
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
    require!(daily.finalized(), ErrorCode::BoardIncomplete);
    let mut bytes = Vec::new();
    daily.version.serialize(&mut bytes)?;
    daily.day_id.serialize(&mut bytes)?;
    daily.rules_hash.serialize(&mut bytes)?;
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
    Ok(zkube_core::sha256v_with::<SolanaSha256>(&[
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
    Ok(bytes)
}

pub use zkube_core::{DailyBoardPools, daily_board_pools};

pub fn compare_arena_entries(
    board: DailyBoardKind,
    left: &ArenaBoardEntry,
    right: &ArenaBoardEntry,
) -> core::cmp::Ordering {
    let metric = |entry: &ArenaBoardEntry| match board {
        DailyBoardKind::Score => u64::from(entry.score),
        DailyBoardKind::Theme => entry.objective_total,
    };
    zkube_core::compare_board_entries(
        metric(left),
        left.finalized_at,
        &left.player.to_bytes(),
        metric(right),
        right.finalized_at,
        &right.player.to_bytes(),
    )
}

/// The most cadence funding one Daily's two boards can hold at once under
/// the SDK rent schedule: every row and claim bit at the protocol capacity.
pub fn maximum_board_rent_lamports() -> u64 {
    2 * Rent::default().minimum_balance(ArenaBoard::funded_space(u32::MAX))
}

/// Sizes of the accounts a device pays for when it sends a player's first
/// entry of a Daily and delegates the run in the same transaction. The buffer
/// exists only inside that transaction; the record and metadata are the
/// pinned delegation program's, for this run's seeds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FirstEntryAccounts {
    pub arena_player: usize,
    pub active_run: usize,
    pub delegation_buffer: usize,
    pub delegation_record: usize,
    pub delegation_metadata: usize,
}

impl FirstEntryAccounts {
    pub fn sizes() -> Self {
        use crate::state::protocol::{ACTIVE_RUN_SEED, ActiveRun};
        use ephemeral_rollups_sdk::dlp_api::state::{
            DelegationMetadata, DelegationRecord, UndelegationRequester,
        };
        let run = 8 + ActiveRun::INIT_SPACE;
        Self {
            arena_player: 8 + ArenaPlayer::INIT_SPACE,
            active_run: run,
            delegation_buffer: run,
            delegation_record: DelegationRecord::size_with_discriminator(),
            delegation_metadata: DelegationMetadata {
                last_commit_id: 0,
                undelegation_requester: UndelegationRequester::None,
                seeds: vec![
                    ACTIVE_RUN_SEED.to_vec(),
                    b"active".to_vec(),
                    vec![0; 32],
                    vec![0; 8],
                ],
                rent_payer: Default::default(),
            }
            .serialized_size(),
        }
    }

    /// Rent for the daily player account, returned when it closes.
    pub fn arena_player_rent(self) -> u64 {
        Rent::default().minimum_balance(self.arena_player)
    }

    /// The most rent the entry transaction holds at once.
    pub fn peak_rent(self) -> u64 {
        [
            self.arena_player,
            self.active_run,
            self.delegation_buffer,
            self.delegation_record,
            self.delegation_metadata,
        ]
        .into_iter()
        .map(|space| Rent::default().minimum_balance(space))
        .sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::protocol::ProtocolConfig;

    #[test]
    fn first_entry_accounts_are_the_real_account_and_delegation_sizes() {
        let accounts = FirstEntryAccounts::sizes();
        assert_eq!(
            accounts,
            FirstEntryAccounts {
                arena_player: 226,
                active_run: 336,
                delegation_buffer: 336,
                delegation_record: 96,
                delegation_metadata: 118,
            }
        );
        assert_eq!(accounts.arena_player_rent(), 2_463_840);
        assert_eq!(accounts.peak_rent(), 12_193_920);
    }

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
            version: ACCOUNT_VERSION,
            protocol: Pubkey::new_unique(),
            available_prize_lamports: 0,
            bump: 1,
        };
        vault.record_purchase(prize).unwrap();
        vault.record_spend(split.next_daily_lamports).unwrap();
        assert_eq!(
            vault.available_prize_lamports,
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
    fn one_claim_clock_runs_from_the_dailys_finalization() {
        let finalized_at = 1_800_000_000;
        let mut daily = ArenaDaily {
            finalized_at,
            ..ArenaDaily::default()
        };
        assert!(daily.finalized());
        assert_eq!(
            daily_claim_deadline(&daily).unwrap(),
            finalized_at + zkube_core::DAILY_REWARD_CLAIM_WINDOW_SECONDS
        );
        // A Daily that is still running has no claim window yet.
        daily.finalized_at = 0;
        assert!(!daily.finalized());
        assert!(daily_claim_deadline(&daily).is_err());
    }

    #[test]
    fn the_funding_edge_is_the_recorded_predecessor_whatever_the_suspension() {
        let daily = |day_id, predecessor_day| ArenaDaily {
            version: ACCOUNT_VERSION,
            day_id,
            predecessor_day,
            predecessor_rollover_applied: true,
            ..ArenaDaily::default()
        };
        for day in [5, 20_000, u32::MAX - 1] {
            let source = daily(day, day - 1);
            assert!(
                source
                    .require_funding_successor(&daily(day + 1, day))
                    .is_ok()
            );
            // A gap is one edge when the next Daily was prepared after it.
            assert!(
                source
                    .require_funding_successor(&daily(u32::MAX, day))
                    .is_ok()
            );
            assert!(
                source
                    .require_funding_successor(&daily(u32::MAX, day - 1))
                    .is_err()
            );
            assert!(source.require_funding_successor(&source).is_err());
            assert!(
                source
                    .require_funding_successor(&daily(day - 1, day))
                    .is_err()
            );
        }
        let mut protocol = ProtocolConfig::default();
        assert_eq!(protocol.record_prepared_daily(7).unwrap(), 0);
        assert_eq!(protocol.record_prepared_daily(u32::MAX).unwrap(), 7);
        assert!(protocol.record_prepared_daily(u32::MAX).is_err());
        assert!(protocol.record_prepared_daily(8).is_err());
    }

    #[test]
    fn archive_is_strictly_sequential() {
        let launch_day = 20_000;
        let mut archive = ProtocolConfig {
            launch_day_id: launch_day,
            last_daily_id: launch_day - 1,
            ..ProtocolConfig::default()
        };
        assert!(
            archive
                .append_daily(launch_day + 1, launch_day, [2; 32])
                .is_err()
        );
        archive.append_daily(launch_day, 0, [1; 32]).unwrap();
        assert!(archive.append_daily(launch_day, 0, [1; 32]).is_err());
        // A finalized Daily further along the chain cannot pass over the
        // next member, and a gap is one step only when the chain records it.
        let root = archive.daily_root;
        assert!(
            archive
                .append_daily(launch_day + 2, launch_day + 1, [3; 32])
                .is_err()
        );
        assert_eq!(
            (archive.last_daily_id, archive.daily_root),
            (launch_day, root)
        );
        archive
            .append_daily(launch_day + 1, launch_day, [2; 32])
            .unwrap();
        archive
            .append_daily(launch_day + 9, launch_day + 1, [3; 32])
            .unwrap();
        assert_eq!(archive.last_daily_id, launch_day + 9);
        assert_ne!(archive.daily_root, [0; 32]);
    }

    #[test]
    fn the_first_root_member_is_the_first_daily_of_the_chain_from_launch() {
        let launch_day = 20_000;
        let fresh = ProtocolConfig {
            launch_day_id: launch_day,
            ..ProtocolConfig::default()
        };
        // The launch day was skipped while suspended: its successor took over
        // its predecessor, a day before launch, and is the first member.
        let mut skipped = fresh.clone();
        assert!(
            skipped
                .append_daily(launch_day + 4, launch_day + 3, [1; 32])
                .is_err()
        );
        assert!(
            skipped
                .append_daily(launch_day - 1, launch_day - 2, [1; 32])
                .is_err()
        );
        skipped
            .append_daily(launch_day + 3, launch_day - 1, [1; 32])
            .unwrap();
        // From then on the chain alone decides, as after an ordinary launch.
        assert!(
            skipped
                .append_daily(launch_day + 5, launch_day - 1, [2; 32])
                .is_err()
        );
        skipped
            .append_daily(launch_day + 4, launch_day + 3, [2; 32])
            .unwrap();
        // A Daily that still follows the launch day is not the first member.
        let mut ordinary = fresh;
        assert!(
            ordinary
                .append_daily(launch_day + 1, launch_day, [1; 32])
                .is_err()
        );
        ordinary.append_daily(launch_day, 0, [1; 32]).unwrap();
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
            )
            .unwrap();
        assert_eq!(daily.score_qualified_players, 0);
        assert_eq!(daily.theme_qualified_players, 0);
        assert_eq!(player.score_best.score, 0);
        assert_eq!(player.theme_best.objective_total, 0);
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
        assert_eq!(player.score_best.score, 500);
        assert_eq!(player.theme_best.objective_total, 900);
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
        assert_eq!(
            player.record_score(DailyBoardKind::Score, best),
            BestRow::First
        );
        let worse = ArenaBoardEntry {
            player: wallet,
            score: 90,
            finalized_at: 11,
            replay_hash: [2; 32],
            ..ArenaBoardEntry::default()
        };
        assert_eq!(
            player.record_score(DailyBoardKind::Score, worse),
            BestRow::Kept
        );
        assert_eq!(player.score_best.replay_hash, [1; 32]);
        let better = ArenaBoardEntry {
            score: 101,
            ..worse
        };
        assert_eq!(
            player.record_score(DailyBoardKind::Score, better),
            BestRow::Improved(best)
        );
        // The stored result carries no wallet: its row takes the account's.
        assert_eq!(player.score_best, BestRun::of(&better));
        assert_eq!(player.score_best.row(wallet), better);
    }

    #[test]
    fn account_sizes_and_maximum_board_rent_are_explicit() {
        assert_eq!(ArenaBoardEntry::INIT_SPACE, 84);
        assert_eq!(8 + ArenaDaily::INIT_SPACE, 143);
        let mut daily_bytes = Vec::new();
        ArenaDaily::default().serialize(&mut daily_bytes).unwrap();
        assert_eq!(daily_bytes.len(), 135);
        assert_eq!(ArenaBoard::HEADER_SIZE, 112);
        assert_eq!(ArenaBoard::open_space(1_536).unwrap(), 129_136);
        assert_eq!(ArenaBoard::account_space(1_536).unwrap(), 129_328);
        assert_eq!(8 + ArenaPlayer::INIT_SPACE, 226);
        // Each entrant funds a row and its claim bit, so a board always holds
        // the rent of either shape, and two full boards bound cadence funding.
        for entrants in [0, 1, 7, 8, 1_535, 1_536, 50_000] {
            let rows = entrants.min(1_536);
            assert!(ArenaBoard::funded_space(entrants) >= ArenaBoard::account_space(rows).unwrap());
            assert!(
                ArenaBoard::funded_space(entrants)
                    >= ArenaBoard::open_space(rows as usize).unwrap()
            );
        }
        assert_eq!(ArenaBoard::funded_space(u32::MAX), 130_672);
        assert_eq!(maximum_board_rent_lamports(), 2 * 910_368_000);
        for size in [
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
        seal_arena_board(
            &mut board,
            count,
            u64::MAX / 4,
            BoardPayoutPlan { count, ..plan },
        );
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
        assert_eq!(read_board_entry(&info, count - 1).unwrap(), entry);
        let prize = arcade_prize_at_position(&board, &info, player, count - 1).unwrap();
        assert_eq!(usize::from(prize.rank), ARENA_BOARD_CAPACITY);
        assert!(!board_bitmap_is_set(&info, &board, count - 1).unwrap());
        set_board_bitmap(&info, &board, count - 1).unwrap();
        assert!(board_bitmap_is_set(&info, &board, count - 1).unwrap());
        assert!(set_board_bitmap(&info, &board, count - 1).is_err());
        assert!(arcade_prize_at_position(&board, &info, Pubkey::new_unique(), count - 1).is_err());
        assert!(arcade_prize_at_position(&board, &info, player, count).is_err());
    }

    /// A Daily's players and one board, driven only through the two steps
    /// consume takes: the wallet's best row, then the board placement.
    struct Field {
        kind: DailyBoardKind,
        rows: Vec<u8>,
        count: usize,
        players: std::collections::BTreeMap<Pubkey, ArenaPlayer>,
    }

    impl Field {
        fn new(kind: DailyBoardKind) -> Self {
            Self {
                kind,
                rows: Vec::new(),
                count: 0,
                players: std::collections::BTreeMap::new(),
            }
        }

        fn consume(&mut self, wallet: Pubkey, metric: u32, finalized_at: i64) {
            let entry = ArenaBoardEntry {
                player: wallet,
                score: metric,
                objective_total: u64::from(metric),
                finalized_at,
                replay_hash: [metric as u8; 32],
            };
            let player = self
                .players
                .entry(wallet)
                .or_insert_with(|| ArenaPlayer::initialize(Pubkey::default(), wallet, wallet, 1));
            let previous = match player.record_score(self.kind, entry) {
                BestRow::Kept => return,
                BestRow::First => None,
                BestRow::Improved(previous) => Some(previous),
            };
            match place_board_row(&self.rows, self.count, self.kind, previous.as_ref(), &entry)
                .unwrap()
            {
                RowPlacement::Outside => {}
                RowPlacement::Insert { at, vacated, grows } => {
                    if grows {
                        self.count += 1;
                        self.rows
                            .resize(self.count * ArenaBoardEntry::INIT_SPACE, 0);
                    }
                    write_board_row(&mut self.rows, at, vacated, &entry).unwrap();
                }
            }
        }

        fn board(&self) -> Vec<ArenaBoardEntry> {
            (0..self.count)
                .map(|position| board_row(&self.rows, position).unwrap())
                .collect()
        }

        /// Every qualifier's best row, fully sorted and cut at capacity.
        fn full_sort(&self) -> Vec<ArenaBoardEntry> {
            let mut best = self
                .players
                .values()
                .map(|player| match self.kind {
                    DailyBoardKind::Score => player.score_best.row(player.player),
                    DailyBoardKind::Theme => player.theme_best.row(player.player),
                })
                .collect::<Vec<_>>();
            best.sort_by(|left, right| compare_arena_entries(self.kind, left, right));
            best.truncate(ARENA_BOARD_CAPACITY);
            best
        }

        fn assert_is_the_full_sort(&self) {
            assert_eq!(self.board(), self.full_sort());
        }
    }

    fn wallet(index: u32) -> Pubkey {
        let mut bytes = [9u8; 32];
        bytes[..4].copy_from_slice(&index.to_be_bytes());
        Pubkey::new_from_array(bytes)
    }

    #[test]
    fn retained_rows_equal_a_full_sort_in_any_consume_order() {
        for (kind, seed) in [
            (DailyBoardKind::Score, 1u64),
            (DailyBoardKind::Theme, 2),
            (DailyBoardKind::Score, 3),
        ] {
            let mut field = Field::new(kind);
            let mut state = seed;
            let mut next = |modulus: u64| {
                state = state
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695_040_888_963_407);
                (state >> 33) % modulus
            };
            // More wallets than the board holds, few distinct metrics and
            // times so ties on both are common, and repeat entries throughout.
            for step in 0..9_000u32 {
                let wallet = wallet(next(2_000) as u32);
                field.consume(wallet, 1 + next(60) as u32, 1 + next(40) as i64);
                if step % 1_500 == 0 {
                    field.assert_is_the_full_sort();
                }
            }
            field.assert_is_the_full_sort();
            assert_eq!(field.count, ARENA_BOARD_CAPACITY);
            assert!(field.players.len() > ARENA_BOARD_CAPACITY);
        }
    }

    #[test]
    fn a_hostile_consume_order_at_capacity_still_yields_the_full_sort() {
        for kind in [DailyBoardKind::Score, DailyBoardKind::Theme] {
            let capacity = u32::try_from(ARENA_BOARD_CAPACITY).unwrap();
            let mut field = Field::new(kind);
            // The worst row is consumed first, then a full board of better
            // ones in ascending order, which pushes it off the end.
            let dropped = wallet(u32::MAX);
            field.consume(dropped, 10, 5);
            for index in 0..capacity {
                field.consume(wallet(index), 100 + index, 50);
            }
            field.assert_is_the_full_sort();
            assert!(field.board().iter().all(|row| row.player != dropped));
            let last = *field.board().last().unwrap();
            assert_eq!((last.score, last.finalized_at), (100, 50));

            // The dropped wallet comes back just below the last row, level
            // with it on the metric but later, and then just above it.
            field.consume(dropped, 99, 1);
            field.assert_is_the_full_sort();
            assert!(field.board().iter().all(|row| row.player != dropped));
            field.consume(dropped, 100, 51);
            field.assert_is_the_full_sort();
            assert!(field.board().iter().all(|row| row.player != dropped));
            field.consume(dropped, 100, 49);
            field.assert_is_the_full_sort();
            assert_eq!(field.board().last().unwrap().player, dropped);
            assert!(field.board().iter().all(|row| row.player != last.player));

            // The wallet it displaced returns the same way, and a wallet on
            // the board moves from the last row to the first.
            field.consume(last.player, 101, 60);
            field.consume(dropped, 5_000, 70);
            field.assert_is_the_full_sort();
            assert_eq!(field.board()[0].player, dropped);
            assert_eq!(field.count, ARENA_BOARD_CAPACITY);
        }
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
