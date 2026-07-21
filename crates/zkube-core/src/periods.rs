pub const SECONDS_PER_DAY: i64 = 86_400;
pub const MONDAY_EPOCH_DAY_ID: u32 = 4;
pub const WEEK_DAYS: u32 = 7;
pub const SEASON_DAYS: u32 = 28;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PeriodError {
    BeforeUnixEpoch,
    BeforeMondayEpoch,
    Overflow,
}

/// Entry qualification and forward-funding destinations for one UTC day.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FundingPeriods {
    pub qualification_day_id: u32,
    pub qualification_week_id: u32,
    pub qualification_season_id: u32,
    pub daily_funding_day_id: u32,
    pub weekly_funding_week_id: u32,
    pub season_funding_season_id: u32,
}

pub fn day_id_at(unix_timestamp: i64) -> Result<u32, PeriodError> {
    if unix_timestamp < 0 {
        return Err(PeriodError::BeforeUnixEpoch);
    }
    u32::try_from(unix_timestamp / SECONDS_PER_DAY).map_err(|_| PeriodError::Overflow)
}

pub fn week_id_at(unix_timestamp: i64) -> Result<u32, PeriodError> {
    week_id_for_day(day_id_at(unix_timestamp)?)
}

pub fn season_id_at(unix_timestamp: i64) -> Result<u32, PeriodError> {
    season_id_for_day(day_id_at(unix_timestamp)?)
}

pub fn week_id_for_day(day_id: u32) -> Result<u32, PeriodError> {
    period_id_for_day(day_id, WEEK_DAYS)
}

pub fn season_id_for_day(day_id: u32) -> Result<u32, PeriodError> {
    period_id_for_day(day_id, SEASON_DAYS)
}

pub fn week_start_day(week_id: u32) -> Result<u32, PeriodError> {
    period_start_day(week_id, WEEK_DAYS)
}

pub fn season_start_day(season_id: u32) -> Result<u32, PeriodError> {
    period_start_day(season_id, SEASON_DAYS)
}

pub fn funding_periods_for_day(day_id: u32) -> Result<FundingPeriods, PeriodError> {
    let current_week = week_id_for_day(day_id)?;
    let current_season = season_id_for_day(day_id)?;
    Ok(FundingPeriods {
        qualification_day_id: day_id,
        qualification_week_id: current_week,
        qualification_season_id: current_season,
        daily_funding_day_id: day_id.checked_add(1).ok_or(PeriodError::Overflow)?,
        weekly_funding_week_id: current_week.checked_add(1).ok_or(PeriodError::Overflow)?,
        season_funding_season_id: current_season.checked_add(1).ok_or(PeriodError::Overflow)?,
    })
}

fn period_id_for_day(day_id: u32, period_days: u32) -> Result<u32, PeriodError> {
    day_id
        .checked_sub(MONDAY_EPOCH_DAY_ID)
        .map(|relative| relative / period_days)
        .ok_or(PeriodError::BeforeMondayEpoch)
}

fn period_start_day(period_id: u32, period_days: u32) -> Result<u32, PeriodError> {
    period_id
        .checked_mul(period_days)
        .and_then(|relative| relative.checked_add(MONDAY_EPOCH_DAY_ID))
        .ok_or(PeriodError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn periods_are_monday_aligned_from_1970_01_05() {
        assert_eq!(week_id_for_day(4), Ok(0));
        assert_eq!(week_id_for_day(10), Ok(0));
        assert_eq!(week_id_for_day(11), Ok(1));
        assert_eq!(week_start_day(1), Ok(11));
        assert_eq!(season_id_for_day(4), Ok(0));
        assert_eq!(season_id_for_day(31), Ok(0));
        assert_eq!(season_id_for_day(32), Ok(1));
        assert_eq!(season_start_day(1), Ok(32));
    }

    #[test]
    fn every_entry_funds_next_day_next_week_and_next_season() {
        // Day 31 is the final Sunday of season zero.
        assert_eq!(
            funding_periods_for_day(31),
            Ok(FundingPeriods {
                qualification_day_id: 31,
                qualification_week_id: 3,
                qualification_season_id: 0,
                daily_funding_day_id: 32,
                weekly_funding_week_id: 4,
                season_funding_season_id: 1,
            })
        );
        // Monday starts both the next week and next season; no special case is
        // needed at either boundary.
        assert_eq!(
            funding_periods_for_day(32),
            Ok(FundingPeriods {
                qualification_day_id: 32,
                qualification_week_id: 4,
                qualification_season_id: 1,
                daily_funding_day_id: 33,
                weekly_funding_week_id: 5,
                season_funding_season_id: 2,
            })
        );
    }

    #[test]
    fn rejects_unsupported_pre_epoch_dates_and_overflow() {
        assert_eq!(day_id_at(-1), Err(PeriodError::BeforeUnixEpoch));
        assert_eq!(week_id_for_day(3), Err(PeriodError::BeforeMondayEpoch));
        assert_eq!(
            funding_periods_for_day(u32::MAX),
            Err(PeriodError::Overflow)
        );
    }
}
