/// Protocol payout granularity: 0.001 SOL expressed in lamports.
pub const SOL_PAYOUT_UNIT_LAMPORTS: u64 = 1_000_000;
pub(crate) const MIN_BOARD_PAYOUT_PLACES: u32 = 4;

// The largest fixed-point numerator keeps every valid u32 rank non-zero.
// Its common scale cancels during normalization.
const RANK_WEIGHT_SCALE: u64 = u64::MAX;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayoutError {
    InvalidWholeUnit,
    ZeroWeight,
    InvalidEntryPrice,
    InvalidRank,
    Overflow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PayoutPlan<const N: usize> {
    pub payouts: [u64; N],
    pub width: BoardWidth,
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
    let minimum_units = entry_price.div_ceil(whole_unit);
    let minimum_price = minimum_units.checked_mul(whole_unit);
    let mut winner_count = minimum;
    for rank in minimum + 1..=qualified_winners {
        let weight = rank_weight(rank)?;
        let candidate_denominator = denominator
            .checked_add(u128::from(weight))
            .ok_or(PayoutError::Overflow)?;
        // Compare n with D * ceil(entry/unit) rather than dividing n by D.
        // The rounded threshold is prepared once; overflow cannot qualify a
        // u64 pot, but the original divisor-overflow error still takes priority.
        let minimum_numerator =
            minimum_price.and_then(|price| checked_scale(candidate_denominator, price));
        if minimum_numerator.is_none() {
            checked_scale(candidate_denominator, whole_unit).ok_or(PayoutError::Overflow)?;
            break;
        }
        if wide_product(pool, weight) < minimum_numerator.unwrap_or(u128::MAX) {
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
    if rank == 0 && denominator != 0 && whole_unit != 0 {
        return Err(PayoutError::InvalidRank);
    }
    PayoutPricing::new(pool, denominator, whole_unit)?.for_rank(rank)
}

/// Bounded convenience wrapper around [`board_width`] and
/// [`payout_for_rank`] for tests and small bounded consumers.
pub fn rank_weighted_payouts<const N: usize>(
    pool: u64,
    qualified_winners: u32,
    entry_price: u64,
    whole_unit: u64,
) -> Result<PayoutPlan<N>, PayoutError> {
    let width = board_width(pool, qualified_winners, entry_price, whole_unit)?;
    let winner_count = usize::try_from(width.winner_count)
        .map_err(|_| PayoutError::Overflow)?
        .min(N);
    let mut payouts = [0u64; N];
    let mut paid = 0u64;
    if winner_count > 0 {
        let pricing = PayoutPricing::new(pool, width.denominator, whole_unit)?;
        for (index, payout) in payouts[..winner_count].iter_mut().enumerate() {
            *payout =
                pricing.for_rank(u32::try_from(index + 1).map_err(|_| PayoutError::Overflow)?)?;
            paid = paid.checked_add(*payout).ok_or(PayoutError::Overflow)?;
        }
    }
    Ok(PayoutPlan {
        payouts,
        width,
        winner_count: u32::try_from(winner_count).map_err(|_| PayoutError::Overflow)?,
        paid,
        rollover: pool.checked_sub(paid).ok_or(PayoutError::Overflow)?,
    })
}

/// Deterministic fixed-point harmonic weight.
fn rank_weight(rank: u32) -> Result<u64, PayoutError> {
    if rank == 0 {
        return Err(PayoutError::InvalidRank);
    }
    Ok(RANK_WEIGHT_SCALE / u64::from(rank))
}

// Form the full u64 product from four base-2^32 products. Each middle sum
// fits u64; explicit wrapping on the limb additions avoids redundant overflow
// machinery in the SBF compiler while the assembled u128 product is exact.
#[allow(clippy::inline_always)] // Avoids SBF generic wide multiplication in pricing loops.
#[inline(always)]
fn wide_product(left: u64, right: u64) -> u128 {
    let mask = u64::from(u32::MAX);
    let left_low = left & mask;
    let left_high = left >> 32;
    let right_low = right & mask;
    let right_high = right >> 32;
    let bottom = left_low * right_low;
    let cross = (left_high * right_low).wrapping_add(bottom >> 32);
    let middle = (left_low * right_high).wrapping_add(cross & mask);
    let upper = (left_high * right_high)
        .wrapping_add(cross >> 32)
        .wrapping_add(middle >> 32);
    (u128::from(upper) << 64) | u128::from((middle << 32) | (bottom & mask))
}

// Both products are u64 by u64. The upper product plus the lower carry
// fits u128; its upper limb reports overflow of the original multiplication.
#[allow(clippy::cast_possible_truncation)] // Deliberate selection of the low limb.
fn checked_scale(value: u128, factor: u64) -> Option<u128> {
    let lower = wide_product(value as u64, factor);
    let high = (value >> 64) as u64;
    let upper = if u32::try_from(high | factor).is_ok() {
        // The low-product carry is at most factor - 1, so this sum fits u64.
        u128::from(high.wrapping_mul(factor).wrapping_add((lower >> 64) as u64))
    } else {
        wide_product(high, factor) + (lower >> 64)
    };
    if upper > u128::from(u64::MAX) {
        return None;
    }
    Some((upper << 64) | u128::from(lower as u64))
}

struct PayoutPricing {
    pool: u64,
    unit: u64,
    denominator: u128,
    first_rank_units: Option<u64>,
}

impl PayoutPricing {
    fn new(pool: u64, denominator: u128, unit: u64) -> Result<Self, PayoutError> {
        if unit == 0 {
            return Err(PayoutError::InvalidWholeUnit);
        }
        if denominator == 0 {
            return Err(PayoutError::ZeroWeight);
        }
        let denominator = checked_scale(denominator, unit).ok_or(PayoutError::Overflow)?;
        Ok(Self {
            pool,
            unit,
            denominator,
            first_rank_units: if denominator >= u128::from(u64::MAX) {
                Some(
                    u64::try_from(wide_product(pool, u64::MAX) / denominator)
                        .map_err(|_| PayoutError::Overflow)?,
                )
            } else {
                None
            },
        })
    }

    #[allow(clippy::cast_possible_truncation)] // Selects the denominator's low limb.
    fn for_rank(&self, rank: u32) -> Result<u64, PayoutError> {
        let numerator = wide_product(self.pool, rank_weight(rank)?);
        let units = if let Some(first) = self.first_rank_units {
            let candidate = first / u64::from(rank);
            // D >= M >= pool, where M = u64::MAX. Replacing floor(M/r)
            // by M/r changes the quotient by less than pool/D <= 1.
            // floor(floor(pool*M/D)/r) is therefore exact or one too large.
            // Its product with D fits u128 and decides the correction exactly.
            let product = wide_product(candidate, self.denominator as u64).wrapping_add(
                u128::from(candidate.wrapping_mul((self.denominator >> 64) as u64)) << 64,
            );
            candidate - u64::from(product > numerator)
        } else {
            u64::try_from(numerator / self.denominator).map_err(|_| PayoutError::Overflow)?
        };
        u64::try_from(wide_product(units, self.unit)).map_err(|_| PayoutError::Overflow)
    }
}

/// Sum the retained ranks with one prepared divisor and the same rounding as claims.
pub fn sum_rank_payouts(
    pool: u64,
    denominator: u128,
    count: u32,
    unit: u64,
) -> Result<u64, PayoutError> {
    if count == 0 {
        return Ok(0);
    }
    let pricing = PayoutPricing::new(pool, denominator, unit)?;
    (1..=count).try_fold(0u64, |paid, rank| {
        paid.checked_add(pricing.for_rank(rank)?)
            .ok_or(PayoutError::Overflow)
    })
}

/// Descending metric, then earliest finalization, then owner bytes.
#[must_use]
pub fn compare_board_entries(
    left_metric: u64,
    left_time: i64,
    left_owner: &[u8; 32],
    right_metric: u64,
    right_time: i64,
    right_owner: &[u8; 32],
) -> core::cmp::Ordering {
    right_metric
        .cmp(&left_metric)
        .then_with(|| left_time.cmp(&right_time))
        .then_with(|| left_owner.cmp(right_owner))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_payout_plan_keeps_the_full_width_and_denominator() {
        let pool = 1_000_000_000_000;
        let full = rank_weighted_payouts::<{ crate::ARENA_BOARD_CAPACITY }>(
            pool,
            u32::try_from(crate::ARENA_BOARD_CAPACITY).unwrap(),
            10_000_000,
            1_000_000,
        )
        .unwrap();
        let retained = rank_weighted_payouts::<4>(
            pool,
            u32::try_from(crate::ARENA_BOARD_CAPACITY).unwrap(),
            10_000_000,
            1_000_000,
        )
        .unwrap();
        assert_eq!(retained.width, full.width);
        assert_eq!(retained.winner_count, 4);
        assert_eq!(retained.payouts, full.payouts[..4]);
        assert_eq!(retained.paid, retained.payouts.iter().sum::<u64>());
        assert_eq!(retained.rollover, pool - retained.paid);
        let empty = rank_weighted_payouts::<0>(
            pool,
            u32::try_from(crate::ARENA_BOARD_CAPACITY).unwrap(),
            10_000_000,
            1_000_000,
        )
        .unwrap();
        assert_eq!(empty.width, full.width);
        assert_eq!(empty.winner_count, 0);
        assert_eq!(empty.rollover, pool);
    }

    #[test]
    fn board_order_uses_metric_then_time_then_owner_bytes() {
        use core::cmp::Ordering::{Equal, Greater, Less};
        let a = [0; 32];
        let b = [255; 32];
        assert_eq!(
            compare_board_entries(u64::MAX, i64::MAX, &b, 0, i64::MIN, &a),
            Less
        );
        assert_eq!(
            compare_board_entries(0, i64::MIN, &a, u64::MAX, i64::MAX, &b),
            Greater
        );
        assert_eq!(
            compare_board_entries(10, i64::MIN, &b, 10, i64::MAX, &a),
            Less
        );
        assert_eq!(compare_board_entries(10, 1, &a, 10, 1, &b), Less);
        assert_eq!(compare_board_entries(10, 1, &a, 10, 1, &a), Equal);
    }
    use serde_json::Value;

    fn reference_board_width(
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
                .checked_add(u128::from(reference_rank_weight(rank)?))
                .ok_or(PayoutError::Overflow)?;
        }
        let mut winner_count = minimum;
        for rank in minimum + 1..=qualified_winners {
            let weight = reference_rank_weight(rank)?;
            let candidate_denominator = denominator
                .checked_add(u128::from(weight))
                .ok_or(PayoutError::Overflow)?;
            let payout = reference_payout_for_rank(pool, candidate_denominator, rank, whole_unit)?;
            if payout < entry_price {
                break;
            }
            denominator = candidate_denominator;
            winner_count = rank;
        }

        while winner_count > 0
            && reference_payout_for_rank(pool, denominator, winner_count, whole_unit)? == 0
        {
            winner_count -= 1;
        }

        Ok(BoardWidth {
            winner_count,
            denominator,
        })
    }

    fn reference_rank_weight(rank: u32) -> Result<u64, PayoutError> {
        if rank == 0 {
            return Err(PayoutError::InvalidRank);
        }
        Ok(u64::MAX / u64::from(rank))
    }

    fn reference_payout_for_rank(
        pool: u64,
        denominator: u128,
        rank: u32,
        unit: u64,
    ) -> Result<u64, PayoutError> {
        if unit == 0 {
            return Err(PayoutError::InvalidWholeUnit);
        }
        if denominator == 0 {
            return Err(PayoutError::ZeroWeight);
        }
        let weight = reference_rank_weight(rank)?;
        let divisor = denominator
            .checked_mul(u128::from(unit))
            .ok_or(PayoutError::Overflow)?;
        let units = u128::from(pool) * u128::from(weight) / divisor;
        u64::try_from(units * u128::from(unit)).map_err(|_| PayoutError::Overflow)
    }

    #[test]
    fn optimized_payouts_match_the_original_at_every_supported_width() {
        for qualified in 1..=u32::try_from(crate::ARENA_BOARD_CAPACITY).unwrap() {
            for pool in [
                0,
                999_999,
                10_000_000,
                101_990_000,
                1_000_000_000,
                1_000_000_000_000_000,
                u64::MAX,
            ] {
                for unit in [1, SOL_PAYOUT_UNIT_LAMPORTS] {
                    let original =
                        reference_board_width(pool, qualified, crate::ARENA_ENTRY_LAMPORTS, unit)
                            .unwrap();
                    let current =
                        board_width(pool, qualified, crate::ARENA_ENTRY_LAMPORTS, unit).unwrap();
                    assert_eq!(
                        current, original,
                        "qualified={qualified}, pool={pool}, unit={unit}"
                    );
                    let mut original_paid = 0;
                    let mut current_paid = 0;
                    for rank in 1..=current.winner_count {
                        let before =
                            reference_payout_for_rank(pool, original.denominator, rank, unit)
                                .unwrap();
                        let after = payout_for_rank(pool, current.denominator, rank, unit).unwrap();
                        assert_eq!(
                            after, before,
                            "qualified={qualified}, pool={pool}, rank={rank}, unit={unit}"
                        );
                        assert_eq!(after % unit, 0);
                        original_paid += before;
                        current_paid += after;
                    }
                    assert_eq!(current_paid, original_paid);
                    assert_eq!(
                        sum_rank_payouts(pool, current.denominator, current.winner_count, unit)
                            .unwrap(),
                        original_paid
                    );
                    let plan = rank_weighted_payouts::<{ crate::ARENA_BOARD_CAPACITY }>(
                        pool,
                        qualified,
                        crate::ARENA_ENTRY_LAMPORTS,
                        unit,
                    )
                    .unwrap();
                    assert_eq!(plan.paid, original_paid);
                    assert_eq!(plan.rollover, pool - original_paid);
                    for rank in 1..=current.winner_count {
                        assert_eq!(
                            plan.payouts[rank as usize - 1],
                            reference_payout_for_rank(pool, original.denominator, rank, unit)
                                .unwrap()
                        );
                    }
                    assert_eq!(pool - current_paid, pool - original_paid);
                }
            }
        }
    }

    #[test]
    fn payout_errors_keep_their_original_precedence() {
        for unit in [0, 1, SOL_PAYOUT_UNIT_LAMPORTS, u64::MAX] {
            for denominator in [0, 1, u128::from(u64::MAX), u128::MAX] {
                for rank in [0, 1, 1_536] {
                    assert_eq!(
                        payout_for_rank(u64::MAX, denominator, rank, unit),
                        reference_payout_for_rank(u64::MAX, denominator, rank, unit)
                    );
                }
            }
        }
    }

    #[test]
    fn wide_products_and_checked_scaling_are_exact_at_limb_boundaries() {
        for shift in 0..128 {
            let boundary = 1u128 << shift;
            for value in [
                boundary,
                boundary.saturating_sub(1),
                boundary.saturating_add(1),
                u128::MAX,
            ] {
                for factor in [0, 1, 2, u64::from(u32::MAX), u64::MAX] {
                    assert_eq!(
                        checked_scale(value, factor),
                        value.checked_mul(u128::from(factor))
                    );
                }
            }
        }
        let mut state = 0x7a51_f83c_9b2d_0641_dac3_982f_1567_e0b9u128;
        for _ in 0..100_000 {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            let left = (state >> 64) as u64;
            let right = u64::try_from(state & u128::from(u64::MAX)).unwrap();
            assert_eq!(
                wide_product(left, right),
                u128::from(left) * u128::from(right)
            );
            assert_eq!(
                checked_scale(state, right),
                state.checked_mul(u128::from(right))
            );
        }
    }

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
        let plan =
            rank_weighted_payouts::<50>(1_000_000_000, 50, 10_000_000, SOL_PAYOUT_UNIT_LAMPORTS)
                .unwrap();
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
        let floor = rank_weighted_payouts::<8>(20_000_000, 8, 10_000_000, SOL_PAYOUT_UNIT_LAMPORTS)
            .unwrap();
        assert_eq!(floor.winner_count, 4);

        let fewer =
            rank_weighted_payouts::<8>(100_000_000, 2, 10_000_000, SOL_PAYOUT_UNIT_LAMPORTS)
                .unwrap();
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
            let plan =
                rank_weighted_payouts::<8>(pool, 8, 10_000_000, SOL_PAYOUT_UNIT_LAMPORTS).unwrap();
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
        let plan =
            rank_weighted_payouts::<8>(pool, 8, 10_000_000, SOL_PAYOUT_UNIT_LAMPORTS).unwrap();

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
        let plan = rank_weighted_payouts::<50>(
            payout["poolLamports"].as_u64().unwrap(),
            u32::try_from(payout["qualifiedWinners"].as_u64().unwrap()).unwrap(),
            payout["entryPriceLamports"].as_u64().unwrap(),
            SOL_PAYOUT_UNIT_LAMPORTS,
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
