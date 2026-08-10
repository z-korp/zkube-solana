/// Number of fractional bits used by the deterministic natural-logarithm
/// implementation.
const LN_FRACTION_BITS: u32 = 64;
/// `floor(ln(2) * 2^64)`.
const LN_2_Q64: u128 = 0xb172_17f7_d1cf_79ab;

/// Flat ladder credit for qualifying on a board, awarded once per player, per
/// board, per day.
///
/// A board materializes only payout-bearing rows, so [`ladder_points`] alone
/// reaches a share of the field that shrinks as the game grows — under six
/// percent per board at twenty thousand entries. The flat credit is what keeps
/// the ladder reachable without widening a board to carry non-paying rows.
///
/// It is deliberately independent of field size, rank and pot: everyone
/// receives the same amount on any day, so no day is worth farming.
///
/// The magnitude is not arbitrary. It has to be large enough that a streak
/// percentage survives integer division — at ten, a six-day streak added
/// `floor(10 * 6 / 100)` = nothing, so the bonus was invisible to exactly the
/// players the flat credit exists to reach. At a hundred, every streak day
/// moves it, and placing still pays several times more: rank one of a
/// thirty-player board is 170 and of a five-thousand-player board is 425.
pub const LADDER_QUALIFY_POINTS: u32 = 100;

/// The flat credit exists so the ladder reaches players a board never
/// materializes. A zero would put them back where they started, so the balance
/// pass may retune this number but may not remove it.
const _: () = assert!(LADDER_QUALIFY_POINTS > 0);

/// Longest consecutive-entry streak the ladder bonus counts, in days.
///
/// The bonus is one percent per day, so the cap is also the maximum bonus: a
/// hundred-day streak doubles a day's ladder award and a longer one does not
/// grow further. The cap exists because an uncapped attendance multiplier
/// eventually dwarfs the play itself — at two hundred days a mediocre run would
/// outscore a stranger's win, which inverts what the ladder measures.
pub const LADDER_STREAK_BONUS_CAP_DAYS: u32 = 100;

/// Ladder bonus percentage earned by a consecutive-entry streak.
#[must_use]
pub fn ladder_streak_bonus_pct(streak_days: u32) -> u32 {
    streak_days.min(LADDER_STREAK_BONUS_CAP_DAYS)
}

/// Apply a streak's bonus percentage to one ladder award, rounding down.
///
/// Every award the ladder actually grants is at least
/// [`LADDER_QUALIFY_POINTS`], so a single streak day always moves the total.
/// The rounding only bites on awards under a hundred points, which the
/// placement half alone can produce at the very bottom of a small board — a
/// rank whose award is already a handful of points.
#[must_use]
pub fn apply_ladder_streak_bonus(base_points: u32, streak_days: u32) -> u32 {
    let bonus = u64::from(base_points) * u64::from(ladder_streak_bonus_pct(streak_days)) / 100;
    base_points.saturating_add(u32::try_from(bonus).unwrap_or(u32::MAX))
}

/// Cumulative-point floor of each named tier, ascending.
///
/// Spaced against what the ladder actually pays. A player who qualifies on
/// both boards every day and never places earns
/// `sum(200 * (1 + min(day, 100)/100))`, which reaches roughly 1,450 in a
/// week, 6,900 in a month, 26,000 in three months and 75,000 in seven — so
/// the boundaries below read as about a week, a month, a quarter and most of
/// a year of showing up. Anyone who also places arrives sooner.
///
/// Still balance rather than systems: the contract is one monotonic total and
/// a permanent highest tier. They live here rather than in the program because
/// the program stores a tier and the client displays one, and the two may
/// never disagree.
pub const LADDER_TIER_POINT_THRESHOLDS: [u64; 5] = [0, 1_500, 7_000, 25_000, 75_000];

/// Number of named tiers.
pub const LADDER_TIER_COUNT: u8 = {
    let count = LADDER_TIER_POINT_THRESHOLDS.len();
    assert!(count <= u8::MAX as usize, "tier count must fit a byte");
    #[allow(clippy::cast_possible_truncation)]
    {
        count as u8
    }
};

/// The tier index a cumulative total has reached.
#[must_use]
pub fn ladder_tier_for_points(points: u64) -> u8 {
    LADDER_TIER_POINT_THRESHOLDS
        .iter()
        .rposition(|threshold| points >= *threshold)
        .and_then(|index| u8::try_from(index).ok())
        .unwrap_or(0)
}

/// Cumulative-point floor of `tier`, saturating at the highest tier.
#[must_use]
pub fn ladder_tier_floor(tier: u8) -> u64 {
    let index = usize::from(tier).min(LADDER_TIER_POINT_THRESHOLDS.len() - 1);
    LADDER_TIER_POINT_THRESHOLDS[index]
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LadderError {
    InvalidRank,
}

/// Returns `floor(50 * ln(qualified_entrants / rank))` using integer-only
/// Q64 arithmetic.
///
/// `rank` is one-based and may not exceed the board's qualified field.
///
/// # Errors
///
/// Returns [`LadderError::InvalidRank`] for an empty field, rank zero, or a
/// rank beyond the qualified field.
pub fn ladder_points(qualified_entrants: u32, rank: u32) -> Result<u32, LadderError> {
    if qualified_entrants == 0 || rank == 0 || rank > qualified_entrants {
        return Err(LadderError::InvalidRank);
    }
    let log_ratio = fixed_ln_q64(qualified_entrants) - fixed_ln_q64(rank);
    u32::try_from((log_ratio * 50) >> LN_FRACTION_BITS).map_err(|_| LadderError::InvalidRank)
}

/// Integer natural logarithm in Q64. The mantissa uses
/// `ln(m) = 2 * (z + z^3/3 + z^5/5 + ...)`, where
/// `z = (m - 1) / (m + 1)` and `1 <= m < 2`, so `z <= 1/3`.
fn fixed_ln_q64(value: u32) -> u128 {
    debug_assert!(value > 0);
    let exponent = u128::from(31 - value.leading_zeros());
    let power = 1u128 << u32::try_from(exponent).expect("u32 exponent");
    let value = u128::from(value);
    let z = ((value - power) << LN_FRACTION_BITS) / (value + power);
    let z_squared = (z * z) >> LN_FRACTION_BITS;
    let mut term = z;
    let mut series = z;
    for divisor in (3u128..=49).step_by(2) {
        term = (term * z_squared) >> LN_FRACTION_BITS;
        series += term / divisor;
    }
    exponent * LN_2_Q64 + 2 * series
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn committed_ladder_vectors_match_integer_ln() {
        let fixture: Value =
            serde_json::from_str(include_str!("../../../fixtures/ladder-points.json")).unwrap();
        assert_eq!(fixture["schemaVersion"], 1);
        assert_eq!(fixture["coreVersion"], crate::CORE_VERSION);
        for vector in fixture["vectors"].as_array().unwrap() {
            let qualified = u32::try_from(vector["qualifiedEntrants"].as_u64().unwrap()).unwrap();
            let rank = u32::try_from(vector["rank"].as_u64().unwrap()).unwrap();
            let expected = u32::try_from(vector["points"].as_u64().unwrap()).unwrap();
            assert_eq!(ladder_points(qualified, rank), Ok(expected));
        }
    }

    #[test]
    fn the_log_rank_half_still_reaches_far_less_of_a_large_field() {
        // Why the flat half exists: at twenty thousand entries a board pays
        // 1,176 places, so log-rank alone reaches under six percent of them.
        let qualified = 20_000;
        let paid = 1_176;
        assert!(ladder_points(qualified, paid).unwrap() > 0);
        assert!(ladder_points(qualified, paid + 1).is_ok());
        assert!(f64::from(paid) / f64::from(qualified) < 0.06);
    }

    #[test]
    fn a_streak_adds_one_percent_a_day_and_stops_doubling() {
        // The shape the product states: six days is +6%, a hundred days is
        // +100%, and nothing beyond a hundred moves.
        assert_eq!(apply_ladder_streak_bonus(1_000, 0), 1_000);
        assert_eq!(apply_ladder_streak_bonus(1_000, 6), 1_060);
        assert_eq!(apply_ladder_streak_bonus(1_000, 100), 2_000);
        assert_eq!(apply_ladder_streak_bonus(1_000, 5_000), 2_000);
        assert_eq!(
            ladder_streak_bonus_pct(u32::MAX),
            LADDER_STREAK_BONUS_CAP_DAYS
        );
    }

    #[test]
    fn every_streak_day_moves_the_qualifying_half() {
        // Why the credit is a hundred rather than ten: at ten this whole
        // range floored to zero, so the bonus reached only players who placed.
        for days in 1..=20 {
            assert_eq!(
                apply_ladder_streak_bonus(LADDER_QUALIFY_POINTS, days),
                LADDER_QUALIFY_POINTS + days,
                "streak of {days} days"
            );
        }
    }

    #[test]
    fn the_streak_bonus_rounds_down_and_never_overflows() {
        // Rounding still bites below a hundred points, which only the very
        // bottom of a small board can produce.
        assert_eq!(apply_ladder_streak_bonus(9, 10), 9);
        assert_eq!(apply_ladder_streak_bonus(10, 10), 11);
        assert_eq!(apply_ladder_streak_bonus(u32::MAX, 100), u32::MAX);
    }

    #[test]
    fn the_tiers_are_spaced_against_what_a_daily_player_actually_earns() {
        // Both boards qualified every day, never placing, streak compounding.
        let total_after = |days: u64| -> u64 {
            (1..=days)
                .map(|day| {
                    u64::from(apply_ladder_streak_bonus(
                        LADDER_QUALIFY_POINTS * 2,
                        u32::try_from(day).unwrap(),
                    ))
                })
                .sum()
        };
        assert_eq!(ladder_tier_for_points(total_after(7)), 0);
        assert_eq!(ladder_tier_for_points(total_after(8)), 1);
        assert_eq!(ladder_tier_for_points(total_after(31)), 2);
        assert_eq!(ladder_tier_for_points(total_after(88)), 3);
        assert_eq!(ladder_tier_for_points(total_after(213)), 4);
    }

    #[test]
    fn rank_boundaries_are_checked() {
        assert_eq!(ladder_points(0, 0), Err(LadderError::InvalidRank));
        assert_eq!(ladder_points(30, 0), Err(LadderError::InvalidRank));
        assert_eq!(ladder_points(30, 31), Err(LadderError::InvalidRank));
        assert_eq!(ladder_points(30, 30), Ok(0));
    }

    #[test]
    #[allow(clippy::cast_precision_loss)]
    fn fixed_point_log_tracks_real_log_across_the_u32_domain() {
        const SCALE: f64 = 18_446_744_073_709_551_616.0;
        let samples = [
            1,
            2,
            3,
            7,
            30,
            255,
            1_536,
            5_000,
            65_535,
            1_000_000,
            u32::MAX,
        ];
        for value in samples {
            let actual = fixed_ln_q64(value) as f64 / SCALE;
            let expected = f64::from(value).ln();
            assert!((actual - expected).abs() <= 4.0e-15, "value={value}");
        }
    }
}
