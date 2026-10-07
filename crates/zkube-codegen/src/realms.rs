//! What makes ten realms ten. A catalogue can be valid level by level and still
//! be one template filled ten times, its realms differing by a tier and a
//! number. These rules are about the table as a whole, in the terms a player
//! sees: a goal's face is the picture on its plate, and its fact is that
//! picture without its block size or its bonus.

use std::collections::BTreeMap;

use zkube_core::{Bonus, ConstraintKind};

use super::{CampaignCatalog, CampaignMap, pictograms};

// A move scores 1, 3, 6, 10... points for 1, 2, 3, 4... lines and nothing else
// scores, so a points goal is the lines goal it equals, in other words.
fn lines_for(points: u8) -> u8 {
    let mut lines = 1u16;
    while lines * (lines + 1) / 2 < u16::from(points) {
        lines += 1;
    }
    u8::try_from(lines).unwrap_or(u8::MAX)
}

fn face(goal: [u8; 3], bonus: Bonus) -> String {
    let kind = ConstraintKind::from_tag(goal[0]).unwrap_or_default();
    let (kind, value) = match kind {
        ConstraintKind::BigMoves => (ConstraintKind::CombosOfAtLeast, lines_for(goal[1])),
        ConstraintKind::BigMove => (ConstraintKind::ComboOfAtLeast, lines_for(goal[1])),
        _ => (kind, goal[1]),
    };
    pictograms::pictogram(kind, value, bonus).unwrap_or_default()
}

fn fact(goal: [u8; 3], bonus: Bonus) -> String {
    let face = face(goal, bonus);
    let face = ["-hammer", "-totem", "-wave"]
        .iter()
        .fold(face, |face, bonus| face.replace(bonus, ""));
    if face.starts_with("goal-burst-break-") {
        "goal-burst-break".into()
    } else if face.starts_with("goal-break-") && face != "goal-break-any" {
        "goal-break-sized".into()
    } else {
        face
    }
}

fn bonus(map: &CampaignMap) -> Bonus {
    u8::try_from(map.rules[0])
        .ok()
        .and_then(Bonus::from_tag)
        .unwrap_or(Bonus::Hammer)
}

/// Every way the level table fails to give each realm goals of its own; empty
/// for a table that does.
pub fn failures(catalog: &CampaignCatalog) -> Vec<String> {
    let mut failures = Vec::new();
    let pair = |map: &CampaignMap, level: usize| {
        let (_, primary, secondary) = map.levels[level];
        (face(primary, bonus(map)), face(secondary, bonus(map)))
    };
    // A first-goal fact opens at most three realms; any two of them are at
    // least three realms apart and ask for different second goals.
    let mut opening: BTreeMap<String, Vec<&CampaignMap>> = BTreeMap::new();
    for map in &catalog.maps {
        opening
            .entry(fact(map.levels[0].1, bonus(map)))
            .or_default()
            .push(map);
    }
    for (first, maps) in &opening {
        let ids: Vec<u8> = maps.iter().map(|map| map.map_id).collect();
        let second = |map: &CampaignMap| fact(map.levels[0].2, bonus(map));
        let alike = maps.iter().enumerate().any(|(index, earlier)| {
            maps[index + 1..].iter().any(|later| {
                later.map_id - earlier.map_id < 3 || second(earlier) == second(later)
            })
        });
        if maps.len() > 3 || alike {
            failures.push(format!(
                "level 1: realms {ids:?} open on the same goal ({first}); a goal opens at most three realms, three or more apart, with different second goals"
            ));
        }
    }
    // On a level number no two realms show the same pair of goals.
    for level in 0..10 {
        let mut shown: BTreeMap<(String, String), Vec<u8>> = BTreeMap::new();
        for map in &catalog.maps {
            shown.entry(pair(map, level)).or_default().push(map.map_id);
        }
        for (pair, realms) in shown.into_iter().filter(|(_, realms)| realms.len() > 1) {
            failures.push(format!(
                "level {}: realms {realms:?} share the same pair of goals {pair:?}",
                level + 1
            ));
        }
    }
    for map in &catalog.maps {
        // Within a realm no pair of goals repeats.
        let mut shown: BTreeMap<(String, String), Vec<usize>> = BTreeMap::new();
        for level in 0..10 {
            shown.entry(pair(map, level)).or_default().push(level + 1);
        }
        for (pair, levels) in shown.into_iter().filter(|(_, levels)| levels.len() > 1) {
            failures.push(format!(
                "realm {}: levels {levels:?} repeat the same pair of goals {pair:?}",
                map.map_id
            ));
        }
        // What opens a realm is what it is about: it comes back as a first goal.
        let first = fact(map.levels[0].1, bonus(map));
        let returns = map
            .levels
            .iter()
            .filter(|level| fact(level.1, bonus(map)) == first)
            .count();
        if returns < 3 {
            failures.push(format!(
                "realm {}: the goal that opens it ({first}) is a first goal on {returns} levels; a realm comes back to it on at least three",
                map.map_id
            ));
        }
        // A second goal is never the guardian's own trigger, on any level.
        let trigger = u8::try_from(map.rules[1])
            .ok()
            .and_then(|trigger| pictograms::trigger_goal(trigger, map.rules[2]));
        for (index, level) in map.levels.iter().enumerate() {
            if trigger.is_some_and(|goal| {
                [goal.kind.tag(), goal.value, goal.required_count] == level.2
            }) {
                failures.push(format!(
                    "realm {} level {}: the second goal is the guardian's own trigger",
                    map.map_id,
                    index + 1
                ));
            }
        }
    }
    // A goal asks for something the score does not already reward. Every clear
    // takes lines and blocks, so a plain count of either is the score in other
    // words: no goal is Clear lines, and no first goal is Clear blocks of any
    // size. Lines taken a particular way and blocks of one size are goals.
    for map in &catalog.maps {
        for (index, (_, primary, secondary)) in map.levels.iter().enumerate() {
            let lines = ConstraintKind::ClearLines.tag();
            let blocks = primary[0] == ConstraintKind::BreakBlocks.tag() && primary[1] == 0;
            if primary[0] == lines || secondary[0] == lines || blocks {
                failures.push(format!(
                    "realm {} level {}: a goal counts lines or blocks, which the score already rewards",
                    map.map_id,
                    index + 1
                ));
            }
        }
    }
    // Every other goal kind the game has is asked somewhere.
    for kind in (1..=u8::MAX)
        .filter_map(ConstraintKind::from_tag)
        .filter(|kind| *kind != ConstraintKind::ClearLines)
    {
        let asked = catalog.maps.iter().any(|map| {
            map.levels
                .iter()
                .any(|level| level.1[0] == kind.tag() || level.2[0] == kind.tag())
        });
        if !asked {
            failures.push(format!("{kind:?} is never asked"));
        }
    }
    failures
}

// The earn rules' own class: every realm earns its bonus its own way. Two
// trigger kinds that read "N lines in one move" are one way to a player.
// The committed rows are held to this once the earn rules change; until then
// it is the written rule, checked against the rows proposed for it.
#[cfg(test)]
fn earn_failures(rules: &[[u16; 4]]) -> Vec<String> {
    let family = |trigger: u16| if trigger == 4 { 1 } else { trigger };
    let mut failures = Vec::new();
    let mut ways: BTreeMap<(u16, u16), Vec<usize>> = BTreeMap::new();
    let mut families: BTreeMap<u16, Vec<usize>> = BTreeMap::new();
    for (index, rule) in rules.iter().enumerate() {
        ways.entry((rule[0], family(rule[1]))).or_default().push(index + 1);
        families.entry(family(rule[1])).or_default().push(index + 1);
    }
    for (way, realms) in ways.into_iter().filter(|(_, realms)| realms.len() > 1) {
        failures.push(format!("realms {realms:?} earn the same bonus the same way {way:?}"));
    }
    for (family, realms) in families {
        if realms.len() > 2 || (realms.len() == 2 && realms[1] - realms[0] < 3) {
            failures.push(format!(
                "trigger family {family} serves realms {realms:?}; a family serves at most two, three or more apart"
            ));
        }
    }
    failures
}

#[cfg(test)]
mod tests {
    use super::*;

    fn committed() -> CampaignCatalog {
        serde_json::from_str(include_str!("../../../fixtures/campaign-catalog.json")).unwrap()
    }
    fn fails(catalog: &CampaignCatalog, words: &str) -> bool {
        failures(catalog).iter().any(|failure| failure.contains(words))
    }

    #[test]
    fn every_realm_asks_for_goals_of_its_own() {
        let catalog = committed();
        assert_eq!(failures(&catalog), Vec::<String>::new());
        assert!(crate::validate_catalog(&catalog).is_ok());

        // One level copied into the next realm: the same pair on that level, and a neighbour on that opening.
        let mut copied = committed();
        copied.maps[1].levels[0] = copied.maps[0].levels[0];
        assert!(fails(&copied, "level 1: realms [1, 2, 4, 7] open on the same goal"));
        assert!(fails(&copied, "level 1: realms [1, 2] share the same pair"));
        assert!(crate::validate_catalog(&copied).is_err());
        // Realms may share an opening, never neighbours: Egypt's opening given to Norse.
        let mut neighbours = committed();
        neighbours.maps[2].levels[0].1 = neighbours.maps[1].levels[0].1;
        assert!(fails(&neighbours, "level 1: realms [2, 3, 8] open on the same goal"));
        // Never a fourth realm, however far apart: Inca opening as Tiki, Greece and Japan do.
        let mut fourth = committed();
        fourth.maps[9].levels[0] = (fourth.maps[9].levels[0].0, fourth.maps[3].levels[0].1, [13, 0, 1]);
        assert!(fails(&fourth, "level 1: realms [1, 4, 7, 10] open on the same goal"));
        // Never with the same second goal: Japan's level 1 asking for Tiki's.
        let mut second = committed();
        second.maps[6].levels[0].2 = [11, 1, 3];
        assert!(fails(&second, "level 1: realms [1, 4, 7] open on the same goal"));
        // The same pair twice in one realm, with other numbers.
        let mut repeated = committed();
        let (_, mut primary, secondary) = repeated.maps[0].levels[0];
        primary[2] += 9;
        repeated.maps[0].levels[3] = (repeated.maps[0].levels[3].0, primary, secondary);
        assert!(fails(&repeated, "realm 1: levels [1, 4] repeat the same pair"));
        // A points goal is the lines goal it equals: it is not another goal.
        assert_eq!(face([5, 3, 4], Bonus::Wave), face([1, 2, 4], Bonus::Wave));
        assert_eq!(face([14, 10, 1], Bonus::Wave), face([9, 4, 1], Bonus::Wave));
        // A realm that opens on a goal and leaves it.
        let mut left = committed();
        for level in [3, 6] {
            left.maps[0].levels[level].1 = [1, 2, left.maps[0].levels[level].1[2]];
        }
        assert!(fails(&left, "realm 1: the goal that opens it (goal-stack-low) is a first goal on 1 levels"));
        // The guardian's own trigger as a second goal, on any level.
        let mut own = committed();
        own.maps[3].levels[4].2 = [11, 1, 3];
        assert!(fails(&own, "realm 4 level 5: the second goal is the guardian's own trigger"));
        let mut tiki = committed();
        tiki.maps[0].levels[0].2 = [9, 2, 1];
        assert!(fails(&tiki, "realm 1 level 1: the second goal is the guardian's own trigger"));
        // A plain count of lines, anywhere, or of blocks of any size as a first goal. Blocks of one size are a goal.
        let mut lines = committed();
        lines.maps[0].levels[0].1 = [3, 0, 6];
        assert!(fails(&lines, "realm 1 level 1: a goal counts lines or blocks"));
        let mut blocks = committed();
        assert_eq!(blocks.maps[2].levels[0].1[..2], [2, 2]);
        blocks.maps[2].levels[0].1[1] = 0;
        assert!(fails(&blocks, "realm 3 level 1: a goal counts lines or blocks"));
        assert!(!fails(&committed(), "ClearLines is never asked"));
        // A kind nobody asks for any more.
        let mut dropped = committed();
        for map in &mut dropped.maps {
            for level in &mut map.levels {
                if level.2[0] == ConstraintKind::PerfectClear.tag() {
                    level.2 = [13, 0, 1];
                }
            }
        }
        assert!(fails(&dropped, "PerfectClear is never asked"));
    }

    #[test]
    fn every_realm_earns_its_bonus_its_own_way() {
        // The rows proposed for the earn rules (2026-10-06) keep the rule.
        let proposed = [
            [3, 1, 2, 4], [1, 2, 6, 6], [2, 8, 10, 4], [1, 9, 3, 6], [3, 7, 2, 5],
            [2, 6, 0, 4], [1, 8, 8, 4], [3, 9, 4, 6], [2, 2, 8, 4], [1, 7, 3, 4],
        ];
        assert_eq!(earn_failures(&proposed), Vec::<String>::new());
        // "N+ lines" and "exactly N lines" in one move are one way; three realms on it are one too many.
        let mut alike = proposed;
        alike[1] = [1, 4, 2, 6];
        alike[6] = [1, 1, 3, 4];
        let failures = earn_failures(&alike);
        assert!(failures.iter().any(|f| f.contains("realms [2, 7] earn the same bonus the same way")));
        assert!(failures.iter().any(|f| f.contains("trigger family 1 serves realms [1, 2, 7]")));
        // Two realms of one family side by side.
        let mut close = proposed;
        close[3] = [1, 8, 9, 6];
        assert!(earn_failures(&close).iter().any(|f| f.contains("trigger family 8 serves realms [3, 4, 7]")));
    }
}
