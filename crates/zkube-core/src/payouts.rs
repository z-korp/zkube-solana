/// Protocol payout granularity: 0.001 SOL expressed in lamports.
pub const SOL_PAYOUT_UNIT_LAMPORTS: u64 = 1_000_000;
pub const DAILY_PRIZE_WEIGHTS: [u16; 5] = [45, 25, 15, 10, 5];
pub const WEEKLY_PRIZE_WEIGHTS: [u16; 3] = [60, 25, 15];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayoutError {
    InvalidWholeUnit,
    InvalidWinnerCount,
    ZeroWeight,
    Overflow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PayoutPlan<const N: usize> {
    pub payouts: [u64; N],
    pub winner_count: u8,
    pub paid: u64,
    pub rollover: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EqualBudgetPlan<const N: usize> {
    pub budgets: [u64; N],
    pub allocated: u64,
    pub rollover: u64,
}

/// Renormalize the first `winner_count` weights, then floor each prize to a
/// whole unit. All unpaid value remains explicit in `rollover`.
pub fn whole_unit_payouts<const N: usize>(
    pool: u64,
    weights: [u16; N],
    winner_count: u8,
    whole_unit: u64,
) -> Result<PayoutPlan<N>, PayoutError> {
    if whole_unit == 0 {
        return Err(PayoutError::InvalidWholeUnit);
    }
    let winner_count_usize = usize::from(winner_count);
    if winner_count_usize > N {
        return Err(PayoutError::InvalidWinnerCount);
    }
    if winner_count == 0 {
        return Ok(PayoutPlan {
            payouts: [0; N],
            winner_count,
            paid: 0,
            rollover: pool,
        });
    }
    let mut denominator = 0u128;
    for weight in &weights[..winner_count_usize] {
        if *weight == 0 {
            return Err(PayoutError::ZeroWeight);
        }
        denominator = denominator
            .checked_add(u128::from(*weight))
            .ok_or(PayoutError::Overflow)?;
    }
    let unit_denominator = denominator
        .checked_mul(u128::from(whole_unit))
        .ok_or(PayoutError::Overflow)?;
    let mut payouts = [0u64; N];
    let mut paid = 0u64;
    for (index, weight) in weights[..winner_count_usize].iter().enumerate() {
        let whole_units = u128::from(pool)
            .checked_mul(u128::from(*weight))
            .ok_or(PayoutError::Overflow)?
            / unit_denominator;
        let amount = whole_units
            .checked_mul(u128::from(whole_unit))
            .and_then(|value| u64::try_from(value).ok())
            .ok_or(PayoutError::Overflow)?;
        payouts[index] = amount;
        paid = paid.checked_add(amount).ok_or(PayoutError::Overflow)?;
    }
    let rollover = pool.checked_sub(paid).ok_or(PayoutError::Overflow)?;
    Ok(PayoutPlan {
        payouts,
        winner_count,
        paid,
        rollover,
    })
}

pub fn sol_unit_payouts<const N: usize>(
    pool: u64,
    weights: [u16; N],
    winner_count: u8,
) -> Result<PayoutPlan<N>, PayoutError> {
    whole_unit_payouts(pool, weights, winner_count, SOL_PAYOUT_UNIT_LAMPORTS)
}

/// Divide a pool into equal whole-unit budgets. Division and rounding residue
/// are retained for the successor period.
pub fn equal_whole_budgets<const N: usize>(
    pool: u64,
    whole_unit: u64,
) -> Result<EqualBudgetPlan<N>, PayoutError> {
    if whole_unit == 0 {
        return Err(PayoutError::InvalidWholeUnit);
    }
    if N == 0 {
        return Err(PayoutError::InvalidWinnerCount);
    }
    let denominator = u128::try_from(N)
        .ok()
        .and_then(|count| count.checked_mul(u128::from(whole_unit)))
        .ok_or(PayoutError::Overflow)?;
    let budget = (u128::from(pool) / denominator)
        .checked_mul(u128::from(whole_unit))
        .and_then(|value| u64::try_from(value).ok())
        .ok_or(PayoutError::Overflow)?;
    let budgets = [budget; N];
    let allocated = budget
        .checked_mul(u64::try_from(N).map_err(|_| PayoutError::Overflow)?)
        .ok_or(PayoutError::Overflow)?;
    let rollover = pool.checked_sub(allocated).ok_or(PayoutError::Overflow)?;
    Ok(EqualBudgetPlan {
        budgets,
        allocated,
        rollover,
    })
}

pub fn equal_sol_unit_budgets<const N: usize>(
    pool: u64,
) -> Result<EqualBudgetPlan<N>, PayoutError> {
    equal_whole_budgets(pool, SOL_PAYOUT_UNIT_LAMPORTS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daily_prizes_round_down_and_keep_all_dust() {
        let plan = sol_unit_payouts(101_990_001, [45, 25, 15, 10, 5], 5).unwrap();
        assert_eq!(
            plan.payouts,
            [45_000_000, 25_000_000, 15_000_000, 10_000_000, 5_000_000]
        );
        assert_eq!(plan.paid, 100_000_000);
        assert_eq!(plan.rollover, 1_990_001);
        assert_eq!(plan.paid + plan.rollover, 101_990_001);
    }

    #[test]
    fn fewer_winners_are_renormalized_before_flooring() {
        let plan = sol_unit_payouts(101_990_001, [45, 25, 15, 10, 5], 2).unwrap();
        assert_eq!(plan.payouts, [65_000_000, 36_000_000, 0, 0, 0]);
        assert_eq!(plan.rollover, 990_001);
    }

    #[test]
    fn weekly_budget_split_retains_division_and_lamport_dust() {
        let split = equal_sol_unit_budgets::<3>(20_500_001).unwrap();
        assert_eq!(split.budgets, [6_000_000; 3]);
        assert_eq!(split.allocated, 18_000_000);
        assert_eq!(split.rollover, 2_500_001);
        let bounty = sol_unit_payouts(6_000_000, [60, 25, 15], 3).unwrap();
        assert_eq!(bounty.payouts, [3_000_000, 1_000_000, 0]);
        assert_eq!(bounty.rollover, 2_000_000);
    }

    #[test]
    fn sub_payout_unit_pool_is_all_rollover() {
        let plan = sol_unit_payouts(999_999, [100], 1).unwrap();
        assert_eq!(plan.payouts, [0]);
        assert_eq!(plan.rollover, 999_999);
    }

    #[test]
    fn competition_without_winners_rolls_the_entire_pool() {
        let plan = sol_unit_payouts(101_990_001, [45, 25, 15, 10, 5], 0).unwrap();
        assert_eq!(plan.payouts, [0; 5]);
        assert_eq!(plan.paid, 0);
        assert_eq!(plan.rollover, 101_990_001);
    }

    #[test]
    fn rejects_invalid_parameters() {
        assert_eq!(
            whole_unit_payouts(100, [1], 1, 0),
            Err(PayoutError::InvalidWholeUnit)
        );
        assert_eq!(
            whole_unit_payouts(100, [1], 2, 1),
            Err(PayoutError::InvalidWinnerCount)
        );
        assert_eq!(
            whole_unit_payouts(100, [0], 1, 1),
            Err(PayoutError::ZeroWeight)
        );
    }
}
