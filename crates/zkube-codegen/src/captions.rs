//! Constraint captions: every goal and Daily objective in plain player words.
//! This is the one owner of goal wording. The catalog carries the rendered
//! caption for every constraint the product uses, with its pictogram, chip and
//! counter from `pictograms`, so clients look goals up instead of formatting
//! them. Captions are sentence case; a display may uppercase them.

use std::collections::BTreeSet;

use serde_json::{Value, json};
use zkube_core::{Constraint, ConstraintKind};

use super::{
    CampaignCatalog, pictograms,
    words::{Language, Words},
};

/// The caption for one constraint, in one language's own words. `required` is
/// the authored count; it only changes the words for the two one-move goals
/// that keep an in-move count. A Daily objective, which has no count, passes
/// zero. Each form is a whole phrase the language wrote (`caption.*` in its
/// words), chosen by what the goal counts, never built from parts.
#[must_use]
pub fn caption(words: &Language, kind: ConstraintKind, value: u8, required: u8) -> String {
    let n = u64::from(value);
    let sized = |key: &str| {
        if value == 0 {
            words.fill(key, 0, &[("count", required.to_string())])
        } else {
            words.fill(
                &format!("{key}.sized"),
                0,
                &[("size", value.to_string()), ("count", required.to_string())],
            )
        }
    };
    match kind {
        ConstraintKind::None => words.plain("caption.classic"),
        // Counted over the run; the count is shown beside the caption.
        ConstraintKind::ClearLines => words.plain("caption.clear_lines"),
        ConstraintKind::BreakBlocks => sized("caption.break_blocks"),
        ConstraintKind::CombosOfAtLeast => words.fill("caption.combos_at_least", n, &[]),
        ConstraintKind::CombosOfExactly => words.fill("caption.combos_exactly", n, &[]),
        ConstraintKind::BigMoves => words.fill("caption.big_moves", n, &[]),
        ConstraintKind::TriggerFired => words.plain("caption.trigger_fired"),
        ConstraintKind::BonusLines => words.plain("caption.bonus_lines"),
        ConstraintKind::BonusBreaks => words.plain("caption.bonus_breaks"),
        ConstraintKind::ClutchClears => words.fill("caption.clutch_clears", n, &[]),
        ConstraintKind::CleanClears => words.fill("caption.clean_clears", n, &[]),
        // One achievement, earned by a single move or bonus.
        ConstraintKind::ComboOfAtLeast => words.fill("caption.combo_at_least", n, &[]),
        ConstraintKind::ComboOfExactly => words.fill("caption.combo_exactly", n, &[]),
        ConstraintKind::Streak => {
            if required <= 1 {
                words.fill("caption.streak_once", n, &[])
            } else {
                words.fill("caption.streak", n, &[("moves", required.to_string())])
            }
        }
        ConstraintKind::BreakInMove => {
            if required <= 1 {
                sized("caption.break_one_in_move")
            } else {
                sized("caption.break_in_move")
            }
        }
        ConstraintKind::AllWidthsInMove => words.plain("caption.all_widths"),
        ConstraintKind::BigMove => words.fill("caption.big_move", n, &[]),
        ConstraintKind::BonusLinesInMove => words.fill("caption.bonus_lines_in_move", n, &[]),
        ConstraintKind::PerfectClear => words.plain("caption.perfect_clear"),
    }
}

// What a goal shows that can depend on its count: the caption and the chip.
fn counted_face(
    words: &Language,
    kind: ConstraintKind,
    value: u8,
    required: u8,
) -> (String, String) {
    (
        caption(words, kind, value, required),
        pictograms::chip(kind, value, required),
    )
}

/// Whether a kind's words and chip at this value stay the same at every count
/// it allows, in every language.
fn count_free(words: &Words, kind: ConstraintKind, value: u8) -> bool {
    words.languages.iter().all(|language| {
        let face = counted_face(language, kind, value, 0);
        (1..=u8::MAX).all(|required| {
            let constraint = Constraint {
                kind,
                value,
                required_count: required,
            };
            !constraint.has_valid_shape()
                || counted_face(language, kind, value, required) == face
        })
    })
}

/// Every goal the product can show: each Campaign goal and Daily objective,
/// with the row of its caption in the words table, its chip, counter and one
/// pictogram per bonus in tag order.
/// A face that does not change with the count is stored once at count zero,
/// which stands for any count; the rest is stored at each authored count. A
/// client looks up the exact count first, then count zero.
pub fn render(catalog: &CampaignCatalog, words: &mut Words) -> Result<Vec<Value>, String> {
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
        let stored = if count_free(words, kind, value) {
            0
        } else {
            required
        };
        entries.insert((tag, value, stored));
    }
    Ok(entries
        .into_iter()
        .map(|(tag, value, required)| {
            let kind = ConstraintKind::from_tag(tag).expect("validated above");
            let chip = pictograms::chip(kind, value, required);
            let text = words.each(|language| caption(language, kind, value, required));
            let row = words.add(text);
            let pictograms: Vec<String> = pictograms::BONUSES
                .iter()
                .filter_map(|bonus| pictograms::pictogram(kind, value, *bonus))
                .collect();
            json!({"kind": tag, "value": value, "count": required, "words": row, "chip": chip,
                "counter": pictograms::counter(kind), "pictograms": pictograms})
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn committed() -> Words {
        Words::load(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap()
    }

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
        let words = committed();
        let english = &words.languages[0];
        for kind in kinds() {
            for (value, required) in samples(kind) {
                let text = caption(english, kind, value, required);
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
    fn no_two_kinds_share_a_caption_in_any_language() {
        let words = committed();
        for language in &words.languages {
            let mut owner: BTreeMap<String, ConstraintKind> = BTreeMap::new();
            for kind in kinds() {
                for (value, required) in samples(kind) {
                    let text = caption(language, kind, value, required);
                    if let Some(other) = owner.insert(text.clone(), kind) {
                        assert_eq!(
                            other, kind,
                            "{}: {text:?} names both {other:?} and {kind:?}",
                            language.code
                        );
                    }
                }
            }
            assert_ne!(
                caption(language, ConstraintKind::CombosOfAtLeast, 3, 5),
                caption(language, ConstraintKind::ComboOfAtLeast, 3, 1)
            );
        }
    }
}
