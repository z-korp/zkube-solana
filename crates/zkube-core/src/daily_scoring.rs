use crate::MoveReport;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DailyObjective {
    Classic,
    Combo { minimum_lines: u8 },
    ExactLines { lines: u8 },
    Blocks { size: u8 },
    Clutch { minimum_height: u8 },
    Clean { maximum_height: u8 },
    Survival,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DailyObjectiveRule {
    pub objective: DailyObjective,
    /// Objective raw points are scaled by this x100 multiplier before pressure.
    pub bonus_multiplier_x100: u16,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DailyObjectiveScore {
    /// Objective points after the rule multiplier, before pressure. This is
    /// added to neutral progress to select the next pressure tier.
    pub weighted_raw_bonus: u32,
    /// Objective points after both the rule and current pressure multipliers.
    pub awarded_bonus: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DailyScoringError {
    InvalidRule,
    Overflow,
}

impl DailyObjectiveRule {
    #[must_use]
    pub const fn is_valid(self) -> bool {
        let objective_valid = match self.objective {
            DailyObjective::Classic | DailyObjective::Survival => true,
            DailyObjective::Combo { minimum_lines } => minimum_lines == 2 || minimum_lines == 3,
            DailyObjective::ExactLines { lines } => lines >= 1 && lines <= 3,
            DailyObjective::Blocks { size } => size >= 1 && size <= 4,
            DailyObjective::Clutch { minimum_height } => minimum_height == 6 || minimum_height == 7,
            DailyObjective::Clean { maximum_height } => maximum_height == 2 || maximum_height == 3,
        };
        let multiplier_valid = match self.objective {
            DailyObjective::Classic => self.bonus_multiplier_x100 == 0,
            _ => self.bonus_multiplier_x100 >= 25 && self.bonus_multiplier_x100 <= 10_000,
        };
        objective_valid && multiplier_valid
    }
}

/// Applies the canonical Daily objective schedule: objective raw points, then
/// rule weighting, then the pressure multiplier active for this action.
///
/// # Errors
///
/// Returns [`DailyScoringError::InvalidRule`] for a rule outside the canonical
/// catalog bounds and [`DailyScoringError::Overflow`] for checked arithmetic
/// failure.
pub fn score_daily_objective(
    rule: DailyObjectiveRule,
    report: &MoveReport,
    pressure_multiplier_x100: u16,
) -> Result<DailyObjectiveScore, DailyScoringError> {
    if !rule.is_valid() || pressure_multiplier_x100 == 0 {
        return Err(DailyScoringError::InvalidRule);
    }
    let lines = report.lines_cleared;
    let raw_points = match rule.objective {
        DailyObjective::Combo { minimum_lines } if lines >= minimum_lines => {
            report.neutral_points_earned
        }
        DailyObjective::ExactLines { lines: exact } if lines == exact => {
            report.neutral_points_earned
        }
        DailyObjective::Blocks { size } => {
            u32::from(report.blocks_destroyed_by_size[usize::from(size - 1)])
        }
        DailyObjective::Clutch { minimum_height }
            if lines > 0 && report.height_before >= minimum_height =>
        {
            report.neutral_points_earned
        }
        DailyObjective::Clean { maximum_height }
            if lines > 0 && report.height_after <= maximum_height =>
        {
            report.neutral_points_earned
        }
        DailyObjective::Survival => 1,
        DailyObjective::Classic
        | DailyObjective::Combo { .. }
        | DailyObjective::ExactLines { .. }
        | DailyObjective::Clutch { .. }
        | DailyObjective::Clean { .. } => 0,
    };
    let weighted_raw_bonus = scale_daily_points(raw_points, rule.bonus_multiplier_x100)?;
    let awarded_bonus = scale_daily_points(weighted_raw_bonus, pressure_multiplier_x100)?;
    Ok(DailyObjectiveScore {
        weighted_raw_bonus,
        awarded_bonus,
    })
}

fn scale_daily_points(points: u32, multiplier_x100: u16) -> Result<u32, DailyScoringError> {
    let scaled = u64::from(points)
        .checked_mul(u64::from(multiplier_x100))
        .and_then(|value| value.checked_div(100))
        .ok_or(DailyScoringError::Overflow)?;
    u32::try_from(scaled).map_err(|_| DailyScoringError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(objective: DailyObjective, bonus_multiplier_x100: u16) -> DailyObjectiveRule {
        DailyObjectiveRule {
            objective,
            bonus_multiplier_x100,
        }
    }

    #[test]
    fn all_seven_objective_families_match_constitution_vectors() {
        let report = MoveReport {
            lines_cleared: 3,
            points_earned: 42,
            neutral_points_earned: 6,
            height_before: 7,
            height_after: 2,
            blocks_destroyed_by_size: [1, 2, 3, 4],
            difficulty_at_action: 4,
            ..MoveReport::default()
        };
        let score = |objective, multiplier| {
            score_daily_objective(rule(objective, multiplier), &report, 140).unwrap()
        };
        assert_eq!(
            score(DailyObjective::Classic, 0),
            DailyObjectiveScore::default()
        );
        assert_eq!(
            score(DailyObjective::Combo { minimum_lines: 2 }, 500),
            DailyObjectiveScore {
                weighted_raw_bonus: 30,
                awarded_bonus: 42,
            }
        );
        assert_eq!(
            score(DailyObjective::ExactLines { lines: 3 }, 100),
            DailyObjectiveScore {
                weighted_raw_bonus: 6,
                awarded_bonus: 8,
            }
        );
        assert_eq!(
            score(DailyObjective::Blocks { size: 2 }, 100),
            DailyObjectiveScore {
                weighted_raw_bonus: 2,
                awarded_bonus: 2,
            }
        );
        assert_eq!(
            score(DailyObjective::Clutch { minimum_height: 7 }, 100),
            DailyObjectiveScore {
                weighted_raw_bonus: 6,
                awarded_bonus: 8,
            }
        );
        assert_eq!(
            score(DailyObjective::Clean { maximum_height: 2 }, 100),
            DailyObjectiveScore {
                weighted_raw_bonus: 6,
                awarded_bonus: 8,
            }
        );
        assert_eq!(
            score(DailyObjective::Survival, 100),
            DailyObjectiveScore {
                weighted_raw_bonus: 1,
                awarded_bonus: 1,
            }
        );
    }

    #[test]
    fn objective_boundaries_do_not_award_near_misses() {
        let report = MoveReport {
            lines_cleared: 2,
            neutral_points_earned: 9,
            height_before: 6,
            height_after: 3,
            ..MoveReport::default()
        };
        for objective in [
            DailyObjective::Combo { minimum_lines: 3 },
            DailyObjective::ExactLines { lines: 1 },
            DailyObjective::Clutch { minimum_height: 7 },
            DailyObjective::Clean { maximum_height: 2 },
        ] {
            assert_eq!(
                score_daily_objective(rule(objective, 100), &report, 250).unwrap(),
                DailyObjectiveScore::default()
            );
        }
    }
}
