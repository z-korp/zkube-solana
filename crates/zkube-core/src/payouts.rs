/// Protocol payout granularity: 0.001 SOL expressed in lamports.
pub const SOL_PAYOUT_UNIT_LAMPORTS: u64 = 1_000_000;
pub const MIN_BOARD_PAYOUT_PLACES: u32 = 4;

// The largest fixed-point numerator keeps every valid u32 rank non-zero.
// Its common scale cancels during normalization.
const RANK_WEIGHT_SCALE: u64 = u64::MAX;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayoutError {
    InvalidWholeUnit,
    InvalidWinnerCount,
    ZeroWeight,
    InvalidEntryPrice,
    InvalidRank,
    Overflow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PayoutPlan<const N: usize> {
    pub payouts: [u64; N],
    pub winner_count: u32,
    pub paid: u64,
    pub rollover: u64,
}

/// Allocation-free result of applying the v5 board-width rule.
///
/// `denominator` retains every structurally selected place, including any
/// trailing place later removed because its rounded payout is zero. Callers
/// must use this denominator when pricing ranks so trimming never
/// renormalizes the remaining payouts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BoardWidth {
    pub winner_count: u32,
    pub denominator: u128,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DailyBoardPools {
    pub score: u64,
    pub theme: u64,
}

/// Split one Daily pot between Score and Theme. Classic has no qualifying
/// Theme metric, so its otherwise-empty half folds back into Score.
#[must_use]
pub const fn daily_board_pools(pool: u64, theme_qualified: u32) -> DailyBoardPools {
    if theme_qualified == 0 {
        return DailyBoardPools {
            score: pool,
            theme: 0,
        };
    }
    let theme = pool / 2;
    DailyBoardPools {
        score: pool - theme,
        theme,
    }
}

/// Size a board using harmonic weights proportional to `1 / rank` without allocating
/// a payout array.
///
/// The width is the largest occupied place count whose final rounded payout
/// still meets `entry_price`, with four places as the structural minimum when
/// at least four winners qualify. The scan stops at the first failing rank
/// because last-place payouts are non-increasing as rank grows.
///
/// Trailing places whose rounded payout is zero are removed from the reported
/// count without changing the denominator. A fully starved board therefore
/// reports no winners while retaining the structural denominator needed to
/// prove that no payout was renormalized.
pub fn board_width(
    pool: u64,
    qualified_winners: u32,
    entry_price: u64,
    whole_unit: u64,
) -> Result<BoardWidth, PayoutError> {
    if whole_unit == 0 {
        return Err(PayoutError::InvalidWholeUnit);
    }
    if entry_price == 0 {
        return Err(PayoutError::InvalidEntryPrice);
    }
    if qualified_winners == 0 {
        return Ok(BoardWidth {
            winner_count: 0,
            denominator: 0,
        });
    }

    let minimum = qualified_winners.min(MIN_BOARD_PAYOUT_PLACES);
    let mut denominator = 0u128;
    for rank in 1..=minimum {
        denominator = denominator
            .checked_add(u128::from(rank_weight(rank)?))
            .ok_or(PayoutError::Overflow)?;
    }
    let mut winner_count = minimum;
    for rank in minimum + 1..=qualified_winners {
        let weight = rank_weight(rank)?;
        let candidate_denominator = denominator
            .checked_add(u128::from(weight))
            .ok_or(PayoutError::Overflow)?;
        let payout = payout_for_rank(pool, candidate_denominator, rank, whole_unit)?;
        if payout < entry_price {
            break;
        }
        denominator = candidate_denominator;
        winner_count = rank;
    }

    while winner_count > 0 && payout_for_rank(pool, denominator, winner_count, whole_unit)? == 0 {
        winner_count -= 1;
    }

    Ok(BoardWidth {
        winner_count,
        denominator,
    })
}

/// Price one rank using a denominator returned by [`board_width`].
pub fn payout_for_rank(
    pool: u64,
    denominator: u128,
    rank: u32,
    whole_unit: u64,
) -> Result<u64, PayoutError> {
    if whole_unit == 0 {
        return Err(PayoutError::InvalidWholeUnit);
    }
    if denominator == 0 {
        return Err(PayoutError::ZeroWeight);
    }
    rounded_weighted_payout(pool, rank_weight(rank)?, denominator, whole_unit)
}

/// Bounded convenience wrapper around [`board_width`] and
/// [`payout_for_rank`] for tests and small bounded consumers.
pub fn rank_weighted_payouts<const N: usize>(
    pool: u64,
    qualified_winners: u32,
    entry_price: u64,
    whole_unit: u64,
) -> Result<PayoutPlan<N>, PayoutError> {
    let qualified = usize::try_from(qualified_winners).map_err(|_| PayoutError::Overflow)?;
    if qualified > N {
        return Err(PayoutError::InvalidWinnerCount);
    }
    let width = board_width(pool, qualified_winners, entry_price, whole_unit)?;
    let winner_count = usize::try_from(width.winner_count).map_err(|_| PayoutError::Overflow)?;
    let mut payouts = [0u64; N];
    let mut paid = 0u64;
    for (index, payout) in payouts[..winner_count].iter_mut().enumerate() {
        *payout = payout_for_rank(
            pool,
            width.denominator,
            u32::try_from(index + 1).map_err(|_| PayoutError::Overflow)?,
            whole_unit,
        )?;
        paid = paid.checked_add(*payout).ok_or(PayoutError::Overflow)?;
    }
    Ok(PayoutPlan {
        payouts,
        winner_count: width.winner_count,
        paid,
        rollover: pool.checked_sub(paid).ok_or(PayoutError::Overflow)?,
    })
}

pub fn sol_rank_weighted_payouts<const N: usize>(
    pool: u64,
    qualified_winners: u32,
    entry_price: u64,
) -> Result<PayoutPlan<N>, PayoutError> {
    rank_weighted_payouts(
        pool,
        qualified_winners,
        entry_price,
        SOL_PAYOUT_UNIT_LAMPORTS,
    )
}

/// Deterministic fixed-point harmonic weight.
fn rank_weight(rank: u32) -> Result<u64, PayoutError> {
    if rank == 0 {
        return Err(PayoutError::InvalidRank);
    }
    Ok(RANK_WEIGHT_SCALE / u64::from(rank))
}

fn rounded_weighted_payout(
    pool: u64,
    weight: u64,
    denominator: u128,
    whole_unit: u64,
) -> Result<u64, PayoutError> {
    let unit_denominator = denominator
        .checked_mul(u128::from(whole_unit))
        .ok_or(PayoutError::Overflow)?;
    let whole_units = u128::from(pool)
        .checked_mul(u128::from(weight))
        .ok_or(PayoutError::Overflow)?
        / unit_denominator;
    whole_units
        .checked_mul(u128::from(whole_unit))
        .and_then(|value| u64::try_from(value).ok())
        .ok_or(PayoutError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn classic_empty_theme_folds_the_whole_pool_into_score() {
        assert_eq!(
            daily_board_pools(101_500_001, 0),
            DailyBoardPools {
                score: 101_500_001,
                theme: 0,
            }
        );
        assert_eq!(
            daily_board_pools(101_500_001, 1),
            DailyBoardPools {
                score: 50_750_001,
                theme: 50_750_000,
            }
        );
    }

    #[test]
    fn harmonic_weights_are_exact_integer_division_for_all_rank_scales() {
        for rank in [1, 2, 3, 7, 31, 255, 2_221, 20_000, u32::MAX] {
            assert_eq!(rank_weight(rank), Ok(RANK_WEIGHT_SCALE / u64::from(rank)));
            assert_ne!(rank_weight(rank), Ok(0));
        }
        assert_eq!(rank_weight(0), Err(PayoutError::InvalidRank));
    }

    #[test]
    fn rank_curve_expands_until_the_last_place_no_longer_covers_entry() {
        let plan = sol_rank_weighted_payouts::<50>(1_000_000_000, 50, 10_000_000).unwrap();
        assert_eq!(plan.winner_count, 25);
        assert!(plan.payouts[..25].windows(2).all(|pair| pair[0] >= pair[1]));
        assert!(plan.payouts[24] >= 10_000_000);
        assert_eq!(plan.payouts[25], 0);
        assert_eq!(plan.paid + plan.rollover, 1_000_000_000);
    }

    #[test]
    fn last_place_payout_is_non_increasing_as_the_board_expands() {
        let pool = 90_000_000_000;
        let mut denominator = 0u128;
        let mut previous = u64::MAX;
        for rank in 1..=20_000 {
            denominator = denominator
                .checked_add(u128::from(rank_weight(rank).unwrap()))
                .unwrap();
            let payout =
                payout_for_rank(pool, denominator, rank, SOL_PAYOUT_UNIT_LAMPORTS).unwrap();
            assert!(
                payout <= previous,
                "rank {rank} increased from {previous} to {payout}"
            );
            previous = payout;
        }
    }

    #[test]
    fn twenty_thousand_qualifiers_size_the_expected_harmonic_board() {
        let pool = 90_000_000_000;
        let entry_price = 10_000_000;
        let width = board_width(pool, 20_000, entry_price, SOL_PAYOUT_UNIT_LAMPORTS).unwrap();
        assert_eq!(width.winner_count, 1_176);
        assert!(
            payout_for_rank(
                pool,
                width.denominator,
                width.winner_count,
                SOL_PAYOUT_UNIT_LAMPORTS,
            )
            .unwrap()
                >= entry_price
        );

        let failing_rank = width.winner_count + 1;
        let failing_denominator = width
            .denominator
            .checked_add(u128::from(rank_weight(failing_rank).unwrap()))
            .unwrap();
        assert!(
            payout_for_rank(
                pool,
                failing_denominator,
                failing_rank,
                SOL_PAYOUT_UNIT_LAMPORTS,
            )
            .unwrap()
                < entry_price
        );
    }

    #[test]
    fn rank_curve_keeps_four_places_and_renormalizes_fewer_qualifiers() {
        let floor = sol_rank_weighted_payouts::<8>(20_000_000, 8, 10_000_000).unwrap();
        assert_eq!(floor.winner_count, 4);

        let fewer = sol_rank_weighted_payouts::<8>(100_000_000, 2, 10_000_000).unwrap();
        assert_eq!(fewer.winner_count, 2);
        assert_eq!(fewer.payouts, [66_000_000, 33_000_000, 0, 0, 0, 0, 0, 0]);
        assert_eq!(fewer.paid + fewer.rollover, 100_000_000);
    }

    #[test]
    fn trailing_zero_places_are_trimmed_without_renormalizing() {
        for (pool, expected_count, expected_payouts) in [
            (3_000_000, 1, [1_000_000, 0, 0, 0]),
            (5_000_000, 2, [2_000_000, 1_000_000, 0, 0]),
            (9_000_000, 4, [4_000_000, 2_000_000, 1_000_000, 1_000_000]),
        ] {
            let width = board_width(pool, 8, 10_000_000, SOL_PAYOUT_UNIT_LAMPORTS).unwrap();
            let plan = sol_rank_weighted_payouts::<8>(pool, 8, 10_000_000).unwrap();
            let paid_before_trim = (1..=MIN_BOARD_PAYOUT_PLACES)
                .map(|rank| {
                    payout_for_rank(pool, width.denominator, rank, SOL_PAYOUT_UNIT_LAMPORTS)
                        .unwrap()
                })
                .sum::<u64>();

            assert_eq!(width.winner_count, expected_count);
            assert_eq!(plan.winner_count, expected_count);
            assert_eq!(plan.payouts[..4], expected_payouts);
            assert_eq!(plan.paid, paid_before_trim);
            assert_eq!(plan.paid + plan.rollover, pool);
        }
    }

    #[test]
    fn all_zero_places_trim_to_no_winners_and_full_rollover() {
        let pool = SOL_PAYOUT_UNIT_LAMPORTS - 1;
        let width = board_width(pool, 8, 10_000_000, SOL_PAYOUT_UNIT_LAMPORTS).unwrap();
        let plan = sol_rank_weighted_payouts::<8>(pool, 8, 10_000_000).unwrap();

        assert_eq!(width.winner_count, 0);
        assert_ne!(width.denominator, 0);
        assert_eq!(plan.winner_count, 0);
        assert_eq!(plan.payouts, [0; 8]);
        assert_eq!(plan.paid, 0);
        assert_eq!(plan.rollover, pool);
    }

    #[test]
    fn rank_curve_matches_the_shared_phase_one_fixture() {
        let fixture: Value =
            serde_json::from_str(include_str!("../../../fixtures/game-parity.json")).unwrap();
        let payout = &fixture["phase1Core"]["rankPayout"];
        let plan = sol_rank_weighted_payouts::<50>(
            payout["poolLamports"].as_u64().unwrap(),
            u32::try_from(payout["qualifiedWinners"].as_u64().unwrap()).unwrap(),
            payout["entryPriceLamports"].as_u64().unwrap(),
        )
        .unwrap();
        let expected = payout["payoutsLamports"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_u64().unwrap())
            .collect::<std::vec::Vec<_>>();
        assert_eq!(plan.payouts.as_slice(), expected);
        assert_eq!(
            plan.winner_count,
            u32::try_from(payout["winnerCount"].as_u64().unwrap()).unwrap()
        );
        assert_eq!(plan.paid, payout["paidLamports"].as_u64().unwrap());
        assert_eq!(plan.rollover, payout["rolloverLamports"].as_u64().unwrap());
    }
}
