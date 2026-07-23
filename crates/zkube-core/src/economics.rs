pub const ARENA_ENTRY_LAMPORTS: u64 = 10_000_000;
pub const ENTRY_DAILY_BPS: u16 = 6_000;
pub const ENTRY_WEEKLY_BPS: u16 = 2_000;
pub const ENTRY_SEASON_BPS: u16 = 1_000;
pub const ENTRY_OPERATOR_BPS: u16 = 1_000;
pub const ENTRY_DAILY_LAMPORTS: u64 = ARENA_ENTRY_LAMPORTS * ENTRY_DAILY_BPS as u64 / 10_000;
pub const ENTRY_WEEKLY_LAMPORTS: u64 = ARENA_ENTRY_LAMPORTS * ENTRY_WEEKLY_BPS as u64 / 10_000;
pub const ENTRY_SEASON_LAMPORTS: u64 = ARENA_ENTRY_LAMPORTS * ENTRY_SEASON_BPS as u64 / 10_000;
pub const ENTRY_OPERATOR_LAMPORTS: u64 = ARENA_ENTRY_LAMPORTS * ENTRY_OPERATOR_BPS as u64 / 10_000;

const BASIS_POINTS: u128 = 10_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EntrySplitError {
    InvalidEntryAmount,
    InvalidShares,
    Overflow,
}

/// Exact native-SOL routing for one owner-authorized ranked entry.
///
/// The three prize contributions fund successor periods. Period IDs are
/// determined separately by `funding_periods_for_day`; this value object only
/// proves that the fixed entry price is conserved exactly.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EntrySplit {
    pub next_daily_lamports: u64,
    pub next_weekly_lamports: u64,
    pub next_season_lamports: u64,
    pub operator_lamports: u64,
}

impl EntrySplit {
    /// Return the conserved total or fail instead of wrapping.
    ///
    /// # Errors
    ///
    /// Returns [`EntrySplitError::Overflow`] if the four destinations cannot
    /// be added without exceeding `u64`.
    pub fn total(self) -> Result<u64, EntrySplitError> {
        self.next_daily_lamports
            .checked_add(self.next_weekly_lamports)
            .and_then(|value| value.checked_add(self.next_season_lamports))
            .and_then(|value| value.checked_add(self.operator_lamports))
            .ok_or(EntrySplitError::Overflow)
    }
}

fn share(amount: u64, basis_points: u16) -> Result<u64, EntrySplitError> {
    let numerator = u128::from(amount)
        .checked_mul(u128::from(basis_points))
        .ok_or(EntrySplitError::Overflow)?;
    if numerator % BASIS_POINTS != 0 {
        return Err(EntrySplitError::InvalidShares);
    }
    u64::try_from(numerator / BASIS_POINTS).map_err(|_| EntrySplitError::Overflow)
}

/// Split the protocol's exact 0.01 SOL entry using integer basis points.
///
/// # Errors
///
/// Rejects any amount other than [`ARENA_ENTRY_LAMPORTS`] and any arithmetic
/// result that cannot be represented without loss or overflow.
pub fn split_arena_entry(lamports: u64) -> Result<EntrySplit, EntrySplitError> {
    if lamports != ARENA_ENTRY_LAMPORTS {
        return Err(EntrySplitError::InvalidEntryAmount);
    }
    let total_bps = u32::from(ENTRY_DAILY_BPS)
        .checked_add(u32::from(ENTRY_WEEKLY_BPS))
        .and_then(|value| value.checked_add(u32::from(ENTRY_SEASON_BPS)))
        .and_then(|value| value.checked_add(u32::from(ENTRY_OPERATOR_BPS)))
        .ok_or(EntrySplitError::Overflow)?;
    if total_bps != u32::try_from(BASIS_POINTS).map_err(|_| EntrySplitError::Overflow)? {
        return Err(EntrySplitError::InvalidShares);
    }

    let split = EntrySplit {
        next_daily_lamports: share(lamports, ENTRY_DAILY_BPS)?,
        next_weekly_lamports: share(lamports, ENTRY_WEEKLY_BPS)?,
        next_season_lamports: share(lamports, ENTRY_SEASON_BPS)?,
        operator_lamports: share(lamports, ENTRY_OPERATOR_BPS)?,
    };
    if split.total()? != lamports {
        return Err(EntrySplitError::InvalidShares);
    }
    Ok(split)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_entry_routes_to_successor_prize_periods_and_operator() {
        let split = split_arena_entry(ARENA_ENTRY_LAMPORTS).unwrap();
        assert_eq!(
            split,
            EntrySplit {
                next_daily_lamports: 6_000_000,
                next_weekly_lamports: 2_000_000,
                next_season_lamports: 1_000_000,
                operator_lamports: 1_000_000,
            }
        );
        assert_eq!(split.total(), Ok(ARENA_ENTRY_LAMPORTS));
    }

    #[test]
    fn entry_amount_is_not_implicitly_rounded_or_substituted() {
        assert_eq!(
            split_arena_entry(ARENA_ENTRY_LAMPORTS - 1),
            Err(EntrySplitError::InvalidEntryAmount)
        );
        assert_eq!(
            split_arena_entry(ARENA_ENTRY_LAMPORTS + 1),
            Err(EntrySplitError::InvalidEntryAmount)
        );
    }
}
