pub const SECONDS_PER_DAY: i64 = 86_400;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsupported_pre_epoch_dates_and_records_the_claim_window() {
        assert_eq!(day_id_at(-1), Err(PeriodError::BeforeUnixEpoch));
        assert_eq!(DAILY_REWARD_CLAIM_WINDOW_SECONDS, 2_592_000);
    }
}
