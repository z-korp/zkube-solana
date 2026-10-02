pub const SECONDS_PER_DAY: i64 = 86_400;
/// Every day, for both products, runs from 07:00 UTC to 07:00 UTC. That is
/// midnight at UTC-7, the daily reset of Google Play Games leaderboards, so
/// the Arcade Daily and the Realms Daily turn over together with them.
pub const DAY_START_OFFSET: i64 = 7 * 60 * 60;
pub const DAILY_RUN_CLOSE_OFFSET: i64 = 23 * 60 * 60 + 59 * 60;
pub const RUN_RECOVERY_SECONDS: i64 = 6 * 60 * 60;
pub const DAILY_REWARD_CLAIM_WINDOW_SECONDS: i64 = 30 * SECONDS_PER_DAY;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PeriodError {
    BeforeUnixEpoch,
    Overflow,
}

/// The one owner of which day an instant belongs to. Day zero opens at 07:00
/// UTC on 1 January 1970; nothing earlier has a day.
pub fn day_id_at(unix_timestamp: i64) -> Result<u32, PeriodError> {
    let since_first_day = unix_timestamp
        .checked_sub(DAY_START_OFFSET)
        .filter(|seconds| *seconds >= 0)
        .ok_or(PeriodError::BeforeUnixEpoch)?;
    u32::try_from(since_first_day / SECONDS_PER_DAY).map_err(|_| PeriodError::Overflow)
}

/// When a day opens, when its runs close, and when its recovery window ends.
#[must_use]
pub fn daily_window(day_id: u32) -> (i64, i64, i64) {
    let opens = i64::from(day_id) * SECONDS_PER_DAY + DAY_START_OFFSET;
    let closes = opens + DAILY_RUN_CLOSE_OFFSET;
    (opens, closes, closes + RUN_RECOVERY_SECONDS)
}

#[must_use]
pub const fn daily_is_scheduled(day: u32, suspended_until: u32) -> bool {
    day >= suspended_until
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suspension_window_handles_gaps_and_u32_limits() {
        assert!(!daily_is_scheduled(19, 20));
        assert!(daily_is_scheduled(20, 20));
        assert_eq!(
            day_id_at((i64::from(u32::MAX) + 1) * SECONDS_PER_DAY + DAY_START_OFFSET),
            Err(PeriodError::Overflow)
        );
        assert_eq!(
            day_id_at((i64::from(u32::MAX) + 1) * SECONDS_PER_DAY + DAY_START_OFFSET - 1),
            Ok(u32::MAX)
        );
    }

    #[test]
    fn every_day_runs_from_seven_utc_to_seven_utc() {
        assert_eq!(DAY_START_OFFSET, 25_200);
        // 2026-10-02 06:59:59 UTC still belongs to the day that opened on the 1st.
        let second = 1_790_924_400; // 2026-10-02 07:00:00 UTC
        assert_eq!(second % SECONDS_PER_DAY, DAY_START_OFFSET);
        let day = day_id_at(second).unwrap();
        assert_eq!(day_id_at(second - 1), Ok(day - 1));
        assert_eq!(day_id_at(second + SECONDS_PER_DAY - 1), Ok(day));
        assert_eq!(day_id_at(second + SECONDS_PER_DAY), Ok(day + 1));
        for day in [0, 1, day, u32::MAX] {
            let (opens, closes, _) = daily_window(day);
            assert_eq!(opens % SECONDS_PER_DAY, DAY_START_OFFSET);
            assert_eq!(day_id_at(opens), Ok(day));
            assert_eq!(day_id_at(closes), Ok(day));
            // Consecutive days meet with no gap and no overlap.
            if day < u32::MAX {
                assert_eq!(daily_window(day + 1).0 - opens, SECONDS_PER_DAY);
                assert_eq!(day_id_at(opens + SECONDS_PER_DAY - 1), Ok(day));
            }
            if day > 0 {
                assert_eq!(day_id_at(opens - 1), Ok(day - 1));
            }
        }
        // Nothing before the first 07:00 UTC has a day.
        assert_eq!(day_id_at(DAY_START_OFFSET), Ok(0));
        assert_eq!(
            day_id_at(DAY_START_OFFSET - 1),
            Err(PeriodError::BeforeUnixEpoch)
        );
        assert_eq!(day_id_at(0), Err(PeriodError::BeforeUnixEpoch));
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
        assert_eq!(day_id_at(i64::MIN), Err(PeriodError::BeforeUnixEpoch));
        assert_eq!(DAILY_REWARD_CLAIM_WINDOW_SECONDS, 2_592_000);
    }
}
