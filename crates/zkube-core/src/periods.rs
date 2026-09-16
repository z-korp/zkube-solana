pub const SECONDS_PER_DAY: i64 = 86_400;
pub const DAILY_RUN_CLOSE_OFFSET: i64 = 23 * 60 * 60 + 59 * 60;
pub const RUN_RECOVERY_SECONDS: i64 = 6 * 60 * 60;
pub const DAILY_REWARD_CLAIM_WINDOW_SECONDS: i64 = 30 * SECONDS_PER_DAY;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PeriodError {
    BeforeUnixEpoch,
    Overflow,
}

pub fn day_id_at(unix_timestamp: i64) -> Result<u32, PeriodError> {
    if unix_timestamp < 0 {
        return Err(PeriodError::BeforeUnixEpoch);
    }
    u32::try_from(unix_timestamp / SECONDS_PER_DAY).map_err(|_| PeriodError::Overflow)
}

#[must_use]
pub fn daily_window(day_id: u32) -> (i64, i64, i64) {
    let opens = i64::from(day_id) * SECONDS_PER_DAY;
    let closes = opens + DAILY_RUN_CLOSE_OFFSET;
    (opens, closes, closes + RUN_RECOVERY_SECONDS)
}

#[must_use]
pub const fn daily_is_scheduled(day: u32, suspended_until: u32) -> bool {
    day >= suspended_until
}

pub fn scheduled_daily_window(day: u32, suspended_until: u32) -> Result<(u32, u32), PeriodError> {
    let first = day.max(suspended_until);
    Ok((first, first.checked_add(1).ok_or(PeriodError::Overflow)?))
}

pub fn next_scheduled_daily(day: u32, suspended_until: u32) -> Result<u32, PeriodError> {
    let (first, following) = scheduled_daily_window(day, suspended_until)?;
    Ok(if first > day { first } else { following })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suspension_window_handles_gaps_and_u32_limits() {
        assert_eq!(scheduled_daily_window(10, 0), Ok((10, 11)));
        assert_eq!(scheduled_daily_window(10, 20), Ok((20, 21)));
        assert_eq!(next_scheduled_daily(10, 20), Ok(20));
        assert_eq!(next_scheduled_daily(20, 20), Ok(21));
        assert!(!daily_is_scheduled(19, 20));
        assert!(daily_is_scheduled(20, 20));
        assert_eq!(
            scheduled_daily_window(u32::MAX, 0),
            Err(PeriodError::Overflow)
        );
        assert_eq!(
            scheduled_daily_window(0, u32::MAX),
            Err(PeriodError::Overflow)
        );
        assert_eq!(
            day_id_at((i64::from(u32::MAX) + 1) * SECONDS_PER_DAY),
            Err(PeriodError::Overflow)
        );
    }

    #[test]
    fn daily_window_is_derived_at_epoch_and_u32_day_bounds() {
        for day in [0, 1, 20_000, u32::MAX] {
            let (opens, closes, recovery) = daily_window(day);
            assert_eq!(day_id_at(opens), Ok(day));
            assert_eq!(closes - opens, 86_340);
            assert_eq!(recovery - closes, 21_600);
        }
    }

    #[test]
    fn rejects_unsupported_pre_epoch_dates_and_records_the_claim_window() {
        assert_eq!(day_id_at(-1), Err(PeriodError::BeforeUnixEpoch));
        assert_eq!(DAILY_REWARD_CLAIM_WINDOW_SECONDS, 2_592_000);
    }
}
