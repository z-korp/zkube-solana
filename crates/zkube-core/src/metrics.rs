#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ActionMetrics {
    pub score: u64,
    pub lines: u32,
    pub blocks_destroyed: u32,
    pub combo: u32,
    /// The part of this action's score attributable to its combo.
    pub combo_derived_score: u64,
    pub perfect_clear: bool,
}

/// Canonical counters used by the three weekly metric categories.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RunMetrics {
    pub maximum_combo: u32,
    pub combo_scoring_actions: u32,
    pub total_combo_derived_score: u64,
    pub highest_action_score: u64,
    pub most_lines_in_action: u32,
    pub most_blocks_destroyed_in_action: u32,
    pub total_lines: u64,
    pub total_blocks_destroyed: u64,
    pub perfect_clears: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MetricsError {
    Overflow,
}

impl RunMetrics {
    /// Add one accepted move or bonus action to the canonical counters.
    ///
    /// # Errors
    ///
    /// Returns [`MetricsError::Overflow`] rather than wrapping any cumulative
    /// counter.
    pub fn record_action(&mut self, action: ActionMetrics) -> Result<(), MetricsError> {
        let mut next = *self;
        next.maximum_combo = next.maximum_combo.max(action.combo);
        next.highest_action_score = next.highest_action_score.max(action.score);
        next.most_lines_in_action = next.most_lines_in_action.max(action.lines);
        next.most_blocks_destroyed_in_action = next
            .most_blocks_destroyed_in_action
            .max(action.blocks_destroyed);
        if action.combo_derived_score > 0 {
            next.combo_scoring_actions = next
                .combo_scoring_actions
                .checked_add(1)
                .ok_or(MetricsError::Overflow)?;
        }
        next.total_combo_derived_score = next
            .total_combo_derived_score
            .checked_add(action.combo_derived_score)
            .ok_or(MetricsError::Overflow)?;
        next.total_lines = next
            .total_lines
            .checked_add(u64::from(action.lines))
            .ok_or(MetricsError::Overflow)?;
        next.total_blocks_destroyed = next
            .total_blocks_destroyed
            .checked_add(u64::from(action.blocks_destroyed))
            .ok_or(MetricsError::Overflow)?;
        if action.perfect_clear {
            next.perfect_clears = next
                .perfect_clears
                .checked_add(1)
                .ok_or(MetricsError::Overflow)?;
        }
        *self = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_all_nine_weekly_metrics() {
        let mut metrics = RunMetrics::default();
        metrics
            .record_action(ActionMetrics {
                score: 80,
                lines: 2,
                blocks_destroyed: 7,
                combo: 3,
                combo_derived_score: 30,
                perfect_clear: false,
            })
            .unwrap();
        metrics
            .record_action(ActionMetrics {
                score: 120,
                lines: 1,
                blocks_destroyed: 4,
                combo: 2,
                combo_derived_score: 0,
                perfect_clear: true,
            })
            .unwrap();
        assert_eq!(
            metrics,
            RunMetrics {
                maximum_combo: 3,
                combo_scoring_actions: 1,
                total_combo_derived_score: 30,
                highest_action_score: 120,
                most_lines_in_action: 2,
                most_blocks_destroyed_in_action: 7,
                total_lines: 3,
                total_blocks_destroyed: 11,
                perfect_clears: 1,
            }
        );
    }

    #[test]
    fn reports_overflow_without_wrapping() {
        let mut metrics = RunMetrics {
            total_lines: u64::MAX,
            ..RunMetrics::default()
        };
        let before = metrics;
        assert_eq!(
            metrics.record_action(ActionMetrics {
                lines: 1,
                ..ActionMetrics::default()
            }),
            Err(MetricsError::Overflow)
        );
        assert_eq!(metrics, before);
    }
}
