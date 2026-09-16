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

#[cfg(test)]
mod tests {
    use super::*;

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
