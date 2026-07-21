use crate::{RulesHash, RunMetrics, Sha256Provider, SoftwareSha256};

const WEEKLY_SELECTION_DOMAIN: &[u8] = b"zkube-weekly-bounty-v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum WeeklyMetric {
    MaximumCombo = 0,
    ComboScoringActions = 1,
    TotalComboDerivedScore = 2,
    HighestActionScore = 3,
    MostLinesInAction = 4,
    MostBlocksDestroyedInAction = 5,
    TotalLines = 6,
    TotalBlocksDestroyed = 7,
    PerfectClears = 8,
}

impl WeeklyMetric {
    #[must_use]
    pub const fn tag(self) -> u8 {
        self as u8
    }

    #[must_use]
    pub const fn value(self, metrics: &RunMetrics) -> u64 {
        match self {
            Self::MaximumCombo => metrics.maximum_combo as u64,
            Self::ComboScoringActions => metrics.combo_scoring_actions as u64,
            Self::TotalComboDerivedScore => metrics.total_combo_derived_score,
            Self::HighestActionScore => metrics.highest_action_score,
            Self::MostLinesInAction => metrics.most_lines_in_action as u64,
            Self::MostBlocksDestroyedInAction => metrics.most_blocks_destroyed_in_action as u64,
            Self::TotalLines => metrics.total_lines,
            Self::TotalBlocksDestroyed => metrics.total_blocks_destroyed,
            Self::PerfectClears => metrics.perfect_clears as u64,
        }
    }
}

const CATEGORIES: [[WeeklyMetric; 3]; 3] = [
    [
        WeeklyMetric::MaximumCombo,
        WeeklyMetric::ComboScoringActions,
        WeeklyMetric::TotalComboDerivedScore,
    ],
    [
        WeeklyMetric::HighestActionScore,
        WeeklyMetric::MostLinesInAction,
        WeeklyMetric::MostBlocksDestroyedInAction,
    ],
    [
        WeeklyMetric::TotalLines,
        WeeklyMetric::TotalBlocksDestroyed,
        WeeklyMetric::PerfectClears,
    ],
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WeeklyMetricSelection {
    pub digest: [u8; 32],
    pub metrics: [WeeklyMetric; 3],
}

#[must_use]
pub fn select_weekly_metrics(week_id: u32, rules_hash: RulesHash) -> WeeklyMetricSelection {
    select_weekly_metrics_with::<SoftwareSha256>(week_id, rules_hash)
}

#[must_use]
pub fn select_weekly_metrics_with<H: Sha256Provider>(
    week_id: u32,
    rules_hash: RulesHash,
) -> WeeklyMetricSelection {
    let digest = H::hashv(&[
        WEEKLY_SELECTION_DOMAIN,
        &week_id.to_le_bytes(),
        rules_hash.as_bytes(),
    ]);
    let metrics = core::array::from_fn(|category| {
        let start = category * 8;
        let mut chunk = [0u8; 8];
        chunk.copy_from_slice(&digest[start..start + 8]);
        let index = match u64::from_le_bytes(chunk) % 3 {
            0 => 0,
            1 => 1,
            _ => 2,
        };
        CATEGORIES[category][index]
    });
    WeeklyMetricSelection { digest, metrics }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode_32(value: &str) -> [u8; 32] {
        let mut result = [0u8; 32];
        for (index, byte) in result.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).unwrap();
        }
        result
    }

    #[test]
    fn selection_schedule_has_a_golden_vector() {
        let mut rules_hash = [0u8; 32];
        for (index, byte) in rules_hash.iter_mut().enumerate() {
            *byte = u8::try_from(0x40 + index).unwrap();
        }
        let selection = select_weekly_metrics(42, RulesHash(rules_hash));
        assert_eq!(
            selection.digest,
            decode_32("9686b97745ae1aad856c7ff0b4309514836fccf559817cf11024900dcab6c79a")
        );
        assert_eq!(
            selection.metrics,
            [
                WeeklyMetric::ComboScoringActions,
                WeeklyMetric::HighestActionScore,
                WeeklyMetric::PerfectClears,
            ]
        );
    }

    #[test]
    fn selects_exactly_one_metric_from_each_category() {
        for week_id in 0..100 {
            let selection =
                select_weekly_metrics(week_id, RulesHash([u8::try_from(week_id).unwrap(); 32]));
            assert!(selection.metrics[0].tag() <= 2);
            assert!((3..=5).contains(&selection.metrics[1].tag()));
            assert!((6..=8).contains(&selection.metrics[2].tag()));
        }
    }

    #[test]
    fn metric_values_are_canonical() {
        let metrics = RunMetrics {
            maximum_combo: 1,
            combo_scoring_actions: 2,
            total_combo_derived_score: 3,
            highest_action_score: 4,
            most_lines_in_action: 5,
            most_blocks_destroyed_in_action: 6,
            total_lines: 7,
            total_blocks_destroyed: 8,
            perfect_clears: 9,
        };
        let all = [
            WeeklyMetric::MaximumCombo,
            WeeklyMetric::ComboScoringActions,
            WeeklyMetric::TotalComboDerivedScore,
            WeeklyMetric::HighestActionScore,
            WeeklyMetric::MostLinesInAction,
            WeeklyMetric::MostBlocksDestroyedInAction,
            WeeklyMetric::TotalLines,
            WeeklyMetric::TotalBlocksDestroyed,
            WeeklyMetric::PerfectClears,
        ];
        assert_eq!(
            all.map(|metric| metric.value(&metrics)),
            [1, 2, 3, 4, 5, 6, 7, 8, 9]
        );
    }
}
