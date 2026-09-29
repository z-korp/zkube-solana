//! Constraint captions: every goal and Daily objective in plain player words.
//! This is the one owner of goal wording. The catalog carries the rendered
//! caption for every constraint the product uses, with its pictogram, chip and
//! counter from `pictograms`, so clients look goals up instead of formatting
//! them. Captions are sentence case; a display may uppercase them.

use std::collections::BTreeSet;

use serde_json::{Value, json};
use zkube_core::{Constraint, ConstraintKind};

use super::{CampaignCatalog, pictograms};

fn count(n: u8, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}
fn lines_or_more(n: u8) -> String {
    if n == 1 {
        "a line".into()
    } else {
        format!("{n}+ lines")
    }
}
fn size(value: u8) -> String {
    if value == 0 {
        String::new()
    } else {
        format!("size-{value} ")
    }
}

/// The caption for one constraint. `required` is the authored count; it only
/// changes the words for the two one-move goals that keep an in-move count.
/// A Daily objective, which has no count, passes zero.
#[must_use]
pub fn caption(kind: ConstraintKind, value: u8, required: u8) -> String {
    match kind {
        ConstraintKind::None => "Classic".into(),
        // Counted over the run; the count is shown beside the caption.
        ConstraintKind::ClearLines => "Clear lines".into(),
        ConstraintKind::BreakBlocks => format!("Clear {}blocks", size(value)),
        ConstraintKind::CombosOfAtLeast => format!("Moves clearing {}", lines_or_more(value)),
        ConstraintKind::CombosOfExactly => {
            format!("Moves clearing exactly {}", count(value, "line", "lines"))
        }
        ConstraintKind::BigMoves => {
            format!("Moves scoring at least {}", count(value, "point", "points"))
        }
        ConstraintKind::TriggerFired => "Trigger the guardian".into(),
        ConstraintKind::BonusLines => "Clear lines with a bonus".into(),
        ConstraintKind::BonusBreaks => "Clear blocks with a bonus".into(),
        ConstraintKind::ClutchClears => format!(
            "Clears with the stack at least {} high",
            count(value, "row", "rows")
        ),
        ConstraintKind::CleanClears => {
            format!("Clears leaving {} or fewer", count(value, "row", "rows"))
        }
        // One achievement, earned by a single move or bonus.
        ConstraintKind::ComboOfAtLeast => format!("Clear {} in one move", lines_or_more(value)),
        ConstraintKind::ComboOfExactly => format!(
            "Clear exactly {} in one move",
            count(value, "line", "lines")
        ),
        ConstraintKind::Streak => {
            let lines = lines_or_more(value);
            if required <= 1 {
                format!("Clear {lines} on any single move")
            } else {
                format!("Clear {lines} on {required} moves in a row")
            }
        }
        ConstraintKind::BreakInMove => {
            if required <= 1 {
                format!("Clear a {}block in one move", size(value))
            } else {
                format!("Clear {required} {}blocks in one move", size(value))
            }
        }
        ConstraintKind::AllWidthsInMove => "Clear every block size in one move".into(),
        ConstraintKind::BigMove => format!(
            "Score at least {} in one move",
            count(value, "point", "points")
        ),
        ConstraintKind::BonusLinesInMove => {
            format!("Clear {} with one bonus", lines_or_more(value))
        }
        ConstraintKind::PerfectClear => "Empty the board".into(),
    }
}

// What a goal shows that can depend on its count: the caption and the chip.
fn counted_face(kind: ConstraintKind, value: u8, required: u8) -> (String, String) {
    (
        caption(kind, value, required),
        pictograms::chip(kind, value, required),
    )
}

/// Whether a kind's words and chip at this value stay the same at every count
/// it allows.
fn count_free(kind: ConstraintKind, value: u8) -> bool {
    let face = counted_face(kind, value, 0);
    (1..=u8::MAX).all(|required| {
        let constraint = Constraint {
            kind,
            value,
            required_count: required,
        };
        !constraint.has_valid_shape() || counted_face(kind, value, required) == face
    })
}

/// Every goal the product can show: each Campaign goal and Daily objective,
/// with its caption, chip, counter and one pictogram per bonus in tag order.
/// A face that does not change with the count is stored once at count zero,
/// which stands for any count; the rest is stored at each authored count. A
/// client looks up the exact count first, then count zero.
pub fn render(catalog: &CampaignCatalog) -> Result<Vec<Value>, String> {
    let mut used = BTreeSet::new();
    for map in &catalog.maps {
        for (_, primary, secondary) in &map.levels {
            used.insert((primary[0], primary[1], primary[2]));
            used.insert((secondary[0], secondary[1], secondary[2]));
        }
    }
    for theme in zkube_core::DAILY_THEMES {
        used.insert((theme.kind.tag(), theme.value, 0));
    }
    let mut entries = BTreeSet::new();
    for (tag, value, required) in used {
        let kind = ConstraintKind::from_tag(tag)
            .ok_or_else(|| format!("Unknown constraint kind {tag}"))?;
        let stored = if count_free(kind, value) { 0 } else { required };
        entries.insert((tag, value, stored));
    }
    Ok(entries
        .into_iter()
        .map(|(tag, value, required)| {
            let kind = ConstraintKind::from_tag(tag).expect("validated above");
            let (text, chip) = counted_face(kind, value, required);
            let pictograms: Vec<String> = pictograms::BONUSES
                .iter()
                .filter_map(|bonus| pictograms::pictogram(kind, value, *bonus))
                .collect();
            json!({"kind": tag, "value": value, "count": required, "text": text, "chip": chip,
                "counter": pictograms::counter(kind), "pictograms": pictograms})
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    // Every kind at the lowest, second and highest value and count its rules
    // allow, plus the Daily form without a count.
    fn samples(kind: ConstraintKind) -> Vec<(u8, u8)> {
        let valid = |value: u8, required: u8| {
            Constraint {
                kind,
                value,
                required_count: required,
            }
            .has_valid_shape()
        };
        let pick = |all: Vec<u8>| -> Vec<u8> {
            let mut picked = vec![all[0], *all.last().unwrap()];
            if all.len() > 1 {
                picked.push(all[1]);
            }
            picked.sort_unstable();
            picked.dedup();
            picked
        };
        let values = pick(
            (0..=u8::MAX)
                .filter(|&v| (0..=u8::MAX).any(|c| valid(v, c)))
                .collect(),
        );
        let mut out = vec![];
        for value in values {
            let counts: Vec<u8> = (0..=u8::MAX).filter(|&c| valid(value, c)).collect();
            for required in pick(counts) {
                out.push((value, required));
            }
            out.push((value, 0));
        }
        out
    }
    fn kinds() -> Vec<ConstraintKind> {
        (0..=u8::MAX).filter_map(ConstraintKind::from_tag).collect()
    }

    #[test]
    fn every_constraint_caption_is_plain_sentence_case_english_at_every_count() {
        // A number agrees with the noun after it: "1 line", "2 lines", "3+ lines".
        let plural_agrees = |text: &str| {
            let words: Vec<&str> = text.split(' ').collect();
            words.windows(2).all(|pair| {
                let Ok(n) = pair[0].trim_end_matches('+').parse::<u32>() else {
                    return true;
                };
                let noun = pair[1].trim_start_matches("size-");
                let singular = ["line", "block", "move", "point", "row"].contains(&noun);
                let plural = ["lines", "blocks", "moves", "points", "rows"].contains(&noun);
                !(n == 1 && plural || n != 1 && singular)
            })
        };
        for kind in kinds() {
            for (value, required) in samples(kind) {
                let text = caption(kind, value, required);
                let at = format!("{kind:?} value {value} count {required}: {text:?}");
                assert!(
                    !text.contains('{') && !text.contains('}'),
                    "{at} has a bare placeholder"
                );
                assert!(plural_agrees(&text), "{at} has a wrong plural");
                assert!(
                    text.chars().next().unwrap().is_uppercase(),
                    "{at} starts in sentence case"
                );
                assert_ne!(
                    text,
                    text.to_uppercase(),
                    "{at} is sentence case, not capitals"
                );
                for internal in ["Shape", "Blow", "Theme", "Break size", "Clutch", "Clean"] {
                    assert!(
                        !text.contains(internal),
                        "{at} uses the internal term {internal}"
                    );
                }
            }
        }
    }

    #[test]
    fn no_two_kinds_share_a_caption() {
        let mut owner: BTreeMap<String, ConstraintKind> = BTreeMap::new();
        for kind in kinds() {
            for (value, required) in samples(kind) {
                let text = caption(kind, value, required);
                if let Some(other) = owner.insert(text.clone(), kind) {
                    assert_eq!(other, kind, "{text:?} names both {other:?} and {kind:?}");
                }
            }
        }
        assert_ne!(
            caption(ConstraintKind::CombosOfAtLeast, 3, 5),
            caption(ConstraintKind::ComboOfAtLeast, 3, 1)
        );
    }
}
