use serde::Deserialize;
use std::string::String;

#[derive(Deserialize)]
struct GoldenGuardian {
    bonus: String,
    trigger: u8,
    threshold: u16,
}

#[derive(Deserialize)]
struct GoldenObjective {
    kind: String,
    parameter: u8,
}

#[derive(Deserialize)]
pub(crate) struct GoldenRules {
    max_moves: u16,
    guardian: GoldenGuardian,
    starting_height: u8,
    objective: GoldenObjective,
}

pub(crate) fn bonus(value: &str) -> Option<Bonus> {
    match value {
        "none" => None,
        "hammer" => Some(Bonus::Hammer),
        "totem" => Some(Bonus::Totem),
        "wave" => Some(Bonus::Wave),
        _ => panic!("unknown bonus"),
    }
}

pub(crate) fn fixture_rules(value: &GoldenRules) -> RunRules {
    let kind = match value.objective.kind.as_str() {
        "classic" => ConstraintKind::None,
        "combos_of_at_least" => ConstraintKind::CombosOfAtLeast,
        "combos_of_exactly" => ConstraintKind::CombosOfExactly,
        "break_blocks" => ConstraintKind::BreakBlocks,
        "trigger_fired" => ConstraintKind::TriggerFired,
        "bonus_lines" => ConstraintKind::BonusLines,
        "bonus_breaks" => ConstraintKind::BonusBreaks,
        "clutch_clears" => ConstraintKind::ClutchClears,
        "clean_clears" => ConstraintKind::CleanClears,
        _ => panic!("unknown objective"),
    };
    RunRules {
        guardian: Guardian {
            bonus: bonus(&value.guardian.bonus).unwrap(),
            trigger: value.guardian.trigger,
            threshold: value.guardian.threshold,
        },
        starting_height: value.starting_height,
        max_moves: value.max_moves,
        tier: TierPolicy::Pressure,
        stars: None,
        objective: (kind != ConstraintKind::None).then_some(DailyTheme {
            kind,
            value: value.objective.parameter,
        }),
    }
}
