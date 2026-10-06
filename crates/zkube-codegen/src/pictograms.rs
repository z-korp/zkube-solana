//! Goal pictograms: the picture, value chip and counter each goal shows. This
//! is the one owner of how a constraint is drawn; its slots are skin slots, so
//! a skin must paint every picture a goal can ask for. The client draws the
//! chip's text and the counter; no number is painted into a picture.

use std::collections::BTreeSet;

use zkube_core::{Bonus, Constraint, ConstraintClass, ConstraintKind};

/// The bonuses in tag order; a goal that shows the realm's bonus has one
/// picture per bonus.
pub const BONUSES: [Bonus; 3] = [Bonus::Hammer, Bonus::Totem, Bonus::Wave];

fn bonus_name(bonus: Bonus) -> &'static str {
    match bonus {
        Bonus::Hammer => "hammer",
        Bonus::Totem => "totem",
        Bonus::Wave => "wave",
    }
}

// Blocks are drawn at their size; size zero means any size.
fn block(value: u8) -> String {
    if value == 0 {
        "any".into()
    } else {
        value.to_string()
    }
}

/// The picture for a goal in a realm with this bonus. Lines are drawn up to
/// three; the chip carries the exact number. Classic (no objective) has none.
#[must_use]
pub fn pictogram(kind: ConstraintKind, value: u8, bonus: Bonus) -> Option<String> {
    let bonus = bonus_name(bonus);
    Some(match kind {
        ConstraintKind::None => return None,
        ConstraintKind::ClearLines => "goal-lines".into(),
        ConstraintKind::CombosOfAtLeast
        | ConstraintKind::CombosOfExactly
        | ConstraintKind::ComboOfAtLeast
        | ConstraintKind::ComboOfExactly => format!("goal-burst-lines-{}", value.min(3)),
        ConstraintKind::BigMoves | ConstraintKind::BigMove => "goal-burst-spark".into(),
        ConstraintKind::BreakBlocks => format!("goal-break-{}", block(value)),
        ConstraintKind::BreakInMove => format!("goal-burst-break-{}", block(value)),
        ConstraintKind::TriggerFired => format!("goal-bonus-{bonus}"),
        ConstraintKind::BonusLines => format!("goal-bonus-lines-{bonus}"),
        ConstraintKind::BonusBreaks => format!("goal-bonus-breaks-{bonus}"),
        ConstraintKind::BonusLinesInMove => format!("goal-burst-bonus-lines-{bonus}"),
        ConstraintKind::Streak => "goal-streak".into(),
        ConstraintKind::AllWidthsInMove => "goal-all-widths".into(),
        ConstraintKind::PerfectClear => "goal-perfect-clear".into(),
        ConstraintKind::ClutchClears => "goal-stack-high".into(),
        ConstraintKind::CleanClears => "goal-stack-low".into(),
    })
}

/// The signs and numbers on the picture's chip, or empty for none. `required`
/// is the authored count; a Daily objective, which has none, passes zero.
#[must_use]
pub fn chip(kind: ConstraintKind, value: u8, required: u8) -> String {
    match kind {
        ConstraintKind::CombosOfAtLeast
        | ConstraintKind::ComboOfAtLeast
        | ConstraintKind::BigMoves
        | ConstraintKind::BigMove => format!("{value}+"),
        ConstraintKind::BonusLinesInMove if value > 1 => format!("{value}+"),
        ConstraintKind::CombosOfExactly | ConstraintKind::ComboOfExactly => format!("={value}"),
        ConstraintKind::TriggerFired => "+1".into(),
        ConstraintKind::BreakInMove if required > 1 => format!("×{required}"),
        ConstraintKind::Streak => {
            let lines = (value > 1).then(|| format!("{value}+"));
            let moves = (required > 1).then(|| format!("×{required}"));
            lines.into_iter().chain(moves).collect::<Vec<_>>().join(" ")
        }
        ConstraintKind::ClutchClears => format!("↑{value}"),
        ConstraintKind::CleanClears => format!("↓{value}"),
        _ => String::new(),
    }
}

/// How a goal's progress is counted on its plate: a fill bar over the run, a
/// ring for one move, or a bar that fills and resets for moves in a row. Classic has no row.
#[must_use]
pub fn counter(kind: ConstraintKind) -> &'static str {
    match kind.class() {
        None => "none",
        Some(ConstraintClass::Cumulative) => "fill",
        Some(ConstraintClass::Moment) if kind == ConstraintKind::Streak => "bar",
        Some(ConstraintClass::Moment) => "ring",
    }
}

/// The goal a guardian trigger is drawn as on the Earn panel: its one-move
/// triggers are the one-move goals the core treats as the trigger itself, and
/// the every-N triggers are drawn as the fact they count.
#[must_use]
pub fn trigger_goal(trigger: u8, threshold: u16) -> Option<Constraint> {
    let threshold = u8::try_from(threshold).ok()?;
    let (kind, value, required_count) = match trigger {
        1 => (ConstraintKind::ComboOfAtLeast, threshold, 1),
        2 => (ConstraintKind::ClearLines, 0, threshold),
        4 => (ConstraintKind::ComboOfExactly, threshold, 1),
        6 => (ConstraintKind::AllWidthsInMove, 0, 1),
        7 => (ConstraintKind::CombosOfAtLeast, 2, threshold),
        8 => (ConstraintKind::BreakInMove, 0, threshold),
        9 => (ConstraintKind::Streak, 1, threshold),
        _ => return None,
    };
    let goal = Constraint {
        kind,
        value,
        required_count,
    };
    goal.has_valid_shape().then_some(goal)
}

/// Every picture a valid goal can ask for, in a stable order.
pub fn slots() -> Vec<String> {
    let mut slots = BTreeSet::new();
    for kind in (0..=u8::MAX).filter_map(ConstraintKind::from_tag) {
        for value in 0..=u8::MAX {
            let valid = (0..=u8::MAX).any(|required_count| {
                Constraint {
                    kind,
                    value,
                    required_count,
                }
                .has_valid_shape()
            });
            if valid {
                slots.extend(BONUSES.iter().filter_map(|b| pictogram(kind, value, *b)));
            }
        }
    }
    slots.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::CampaignCatalog;

    fn kinds() -> impl Iterator<Item = ConstraintKind> {
        (0..=u8::MAX).filter_map(ConstraintKind::from_tag)
    }

    #[test]
    fn every_valid_goal_has_a_pictogram_slot_and_a_counter() {
        let slots = slots();
        for kind in kinds() {
            for value in 0..=u8::MAX {
                for required_count in 0..=u8::MAX {
                    let goal = Constraint {
                        kind,
                        value,
                        required_count,
                    };
                    if !goal.has_valid_shape() {
                        continue;
                    }
                    for bonus in BONUSES {
                        match pictogram(kind, value, bonus) {
                            Some(slot) => assert!(slots.contains(&slot), "{goal:?} {slot}"),
                            None => assert_eq!(kind, ConstraintKind::None),
                        }
                    }
                    assert_eq!(
                        counter(kind) == "none",
                        kind == ConstraintKind::None,
                        "{goal:?}"
                    );
                    let text = chip(kind, value, required_count);
                    assert!(
                        text.chars()
                            .all(|c| c.is_ascii_digit() || "+=×↑↓ ".contains(c)),
                        "{goal:?} chip {text:?} is numbers and signs only"
                    );
                }
            }
        }
    }

    #[test]
    fn every_realm_trigger_is_drawn_as_the_goal_the_core_counts_as_it() {
        let source = include_str!("../../../fixtures/campaign-catalog.json");
        let catalog: CampaignCatalog = serde_json::from_str(source).unwrap();
        for map in &catalog.maps {
            let [_, trigger, threshold, _] = map.rules;
            let trigger = u8::try_from(trigger).unwrap();
            let goal = trigger_goal(trigger, threshold).unwrap();
            assert!(
                pictogram(goal.kind, goal.value, Bonus::Wave).is_some(),
                "trigger {trigger}"
            );
            // A one-move trigger is the very fact the core refuses as a second
            // goal beside Trigger the guardian.
            if goal.kind.class() == Some(ConstraintClass::Moment) {
                let beside = zkube_core::StarRules {
                    points_required: 1,
                    primary: Constraint {
                        kind: ConstraintKind::TriggerFired,
                        value: 0,
                        required_count: 2,
                    },
                    secondary: goal,
                };
                assert!(
                    !beside.has_distinct_constraint_facts(trigger, threshold),
                    "trigger {trigger} {threshold} is drawn as {goal:?}"
                );
            }
        }
        assert_eq!(trigger_goal(3, 1), None);
    }

    #[test]
    fn only_bonus_goals_change_with_the_realm_bonus() {
        for kind in kinds() {
            let pictures: BTreeSet<_> = BONUSES.iter().map(|b| pictogram(kind, 2, *b)).collect();
            let bonus_goal = matches!(
                kind,
                ConstraintKind::TriggerFired
                    | ConstraintKind::BonusLines
                    | ConstraintKind::BonusBreaks
                    | ConstraintKind::BonusLinesInMove
            );
            assert_eq!(pictures.len(), if bonus_goal { 3 } else { 1 }, "{kind:?}");
        }
    }

    #[test]
    fn counters_follow_the_goal_class() {
        for kind in kinds() {
            let expected = match kind.class() {
                None => "none",
                Some(ConstraintClass::Cumulative) => "fill",
                Some(ConstraintClass::Moment) => {
                    if kind == ConstraintKind::Streak {
                        "bar"
                    } else {
                        "ring"
                    }
                }
            };
            assert_eq!(counter(kind), expected, "{kind:?}");
        }
        assert_eq!(chip(ConstraintKind::Streak, 1, 3), "×3");
        assert_eq!(chip(ConstraintKind::Streak, 2, 2), "2+ ×2");
        assert_eq!(chip(ConstraintKind::BreakInMove, 1, 1), "");
        assert_eq!(chip(ConstraintKind::CleanClears, 3, 10), "↓3");
    }

    #[test]
    fn every_catalog_goal_kind_has_a_pictogram_a_counter_and_a_caption() {
        let source = include_str!("../../../fixtures/campaign-catalog.json");
        let catalog: CampaignCatalog = serde_json::from_str(source).unwrap();
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let mut words = crate::words::Words::load(&root).unwrap();
        let entries = crate::captions::render(&catalog, &mut words).unwrap();
        let slots = slots();
        // The client's rule: the exact count, else the count-free entry, then
        // the realm's bonus picks the picture.
        let check = |tag: u8, value: u8, required: u8, bonus: Bonus| {
            let find = |stored: u8| {
                entries.iter().find(|entry| {
                    entry["kind"] == tag && entry["value"] == value && entry["count"] == stored
                })
            };
            let entry = find(required).or_else(|| find(0)).unwrap();
            let kind = ConstraintKind::from_tag(tag).unwrap();
            let at = format!("{kind:?} {value} {required}");
            let row = usize::try_from(entry["words"].as_u64().unwrap()).unwrap();
            assert_eq!(
                words.texts(row),
                words.each(|language| crate::captions::caption(language, kind, value, required)),
                "{at}"
            );
            assert_eq!(entry["chip"], chip(kind, value, required), "{at}");
            assert_eq!(entry["counter"], counter(kind), "{at}");
            let pictures = entry["pictograms"].as_array().unwrap();
            if kind == ConstraintKind::None {
                assert!(pictures.is_empty(), "{at}");
                return;
            }
            assert_ne!(counter(kind), "none", "{at}");
            let slot = pictures[usize::from(bonus.tag() - 1)].as_str().unwrap();
            assert_eq!(Some(slot.to_owned()), pictogram(kind, value, bonus), "{at}");
            assert!(slots.iter().any(|known| known == slot), "{at} {slot}");
        };
        for map in &catalog.maps {
            let bonus = Bonus::from_tag(u8::try_from(map.rules[0]).unwrap()).unwrap();
            for (_, primary, secondary) in &map.levels {
                check(primary[0], primary[1], primary[2], bonus);
                check(secondary[0], secondary[1], secondary[2], bonus);
            }
        }
        for theme in zkube_core::DAILY_THEMES {
            for bonus in BONUSES {
                check(theme.kind.tag(), theme.value, 0, bonus);
            }
        }
    }
}
