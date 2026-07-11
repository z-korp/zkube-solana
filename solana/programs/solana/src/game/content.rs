//! Canonical campaign content derived from zkube's ten Cairo zone settings.
//!
//! Cairo generated each run from a Poseidon seed. The Solana reboot freezes
//! that variability into a versioned catalog: the same map/level snapshot is
//! reviewed once, hashed during run preparation, and cannot change mid-run.

use sha2::{Digest, Sha256};

use super::{Constraint, ConstraintKind};

pub const CAMPAIGN_MAPS: usize = 10;
pub const CAMPAIGN_LEVELS: usize = 10;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CampaignLevelRules {
    pub level: u8,
    pub points_required: u32,
    pub max_moves: u16,
    pub difficulty: u8,
    pub primary: Constraint,
    pub secondary: Constraint,
    pub active_mutator_id: u8,
    pub passive_mutator_id: u8,
    pub boss_id: u8,
    pub block_weights: [u16; 5],
    pub score_multiplier_x100: u16,
    pub combo_multiplier_x100: u16,
    pub line_clear_bonus: u16,
    pub perfect_clear_bonus: u16,
    pub star_threshold_modifier: u8,
    pub bonus_type: u8,
    pub bonus_trigger_type: u8,
    pub bonus_threshold: u16,
    pub starting_charges: u8,
    pub starting_rows: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CampaignMapRules {
    pub map_id: u8,
    pub theme_id: u8,
    pub star_unlock_cost: u64,
    pub usdc_unlock_cost: u64,
    pub levels: [CampaignLevelRules; CAMPAIGN_LEVELS],
}

#[derive(Clone, Copy)]
struct ZoneSpec {
    map_id: u8,
    theme_id: u8,
    base_moves: u16,
    max_moves: u16,
    base_ratio_x100: u16,
    max_ratio_x100: u16,
    thresholds: [u8; 7],
    constraint_start_level: u8,
    active_mutator_id: u8,
    passive_mutator_id: u8,
    boss_id: u8,
    star_unlock_cost: u64,
    usdc_unlock_cost: u64,
    active: ActiveMutator,
    passive: PassiveMutator,
}

#[derive(Clone, Copy)]
struct ActiveMutator {
    bonus_type: u8,
    combo_threshold: u16,
    lines_threshold: u16,
    score_threshold: u16,
    starting_charges: u8,
}

#[derive(Clone, Copy)]
struct PassiveMutator {
    score_multiplier_x100: u16,
    combo_multiplier_x100: u16,
    line_clear_bonus: u16,
    perfect_clear_bonus: u16,
    star_threshold_modifier: u8,
    starting_rows: u8,
}

const fn active(
    bonus_type: u8,
    combo_threshold: u16,
    lines_threshold: u16,
    score_threshold: u16,
    starting_charges: u8,
) -> ActiveMutator {
    ActiveMutator {
        bonus_type,
        combo_threshold,
        lines_threshold,
        score_threshold,
        starting_charges,
    }
}

const fn passive(
    score: u16,
    combo: u16,
    line: u16,
    perfect: u16,
    stars: u8,
    rows: u8,
) -> PassiveMutator {
    PassiveMutator {
        score_multiplier_x100: score,
        combo_multiplier_x100: combo,
        line_clear_bonus: line,
        perfect_clear_bonus: perfect,
        star_threshold_modifier: stars,
        starting_rows: rows,
    }
}

const ZONES: [ZoneSpec; CAMPAIGN_MAPS] = [
    ZoneSpec {
        map_id: 1,
        theme_id: 1,
        base_moves: 16,
        max_moves: 48,
        base_ratio_x100: 64,
        max_ratio_x100: 144,
        thresholds: [5, 8, 10, 11, 12, 13, 14],
        constraint_start_level: 5,
        active_mutator_id: 1,
        passive_mutator_id: 2,
        boss_id: 1,
        star_unlock_cost: 0,
        usdc_unlock_cost: 0,
        active: active(3, 3, 10, 30, 1),
        passive: passive(100, 100, 1, 0, 127, 4),
    },
    ZoneSpec {
        map_id: 2,
        theme_id: 2,
        base_moves: 20,
        max_moves: 55,
        base_ratio_x100: 80,
        max_ratio_x100: 165,
        thresholds: [4, 7, 9, 11, 12, 13, 14],
        constraint_start_level: 3,
        active_mutator_id: 3,
        passive_mutator_id: 4,
        boss_id: 2,
        star_unlock_cost: 40,
        usdc_unlock_cost: 2_000_000,
        active: active(1, 4, 20, 0, 1),
        passive: passive(200, 100, 0, 20, 128, 5),
    },
    ZoneSpec {
        map_id: 3,
        theme_id: 3,
        base_moves: 18,
        max_moves: 50,
        base_ratio_x100: 70,
        max_ratio_x100: 155,
        thresholds: [3, 6, 8, 10, 11, 12, 13],
        constraint_start_level: 4,
        active_mutator_id: 5,
        passive_mutator_id: 6,
        boss_id: 3,
        star_unlock_cost: 40,
        usdc_unlock_cost: 2_000_000,
        active: active(2, 4, 0, 30, 1),
        passive: passive(100, 150, 3, 0, 128, 4),
    },
    ZoneSpec {
        map_id: 4,
        theme_id: 4,
        base_moves: 14,
        max_moves: 44,
        base_ratio_x100: 60,
        max_ratio_x100: 140,
        thresholds: [4, 7, 9, 11, 12, 13, 14],
        constraint_start_level: 3,
        active_mutator_id: 7,
        passive_mutator_id: 8,
        boss_id: 4,
        star_unlock_cost: 40,
        usdc_unlock_cost: 2_000_000,
        active: active(1, 4, 0, 30, 1),
        passive: passive(250, 100, 0, 15, 130, 5),
    },
    ZoneSpec {
        map_id: 5,
        theme_id: 6,
        base_moves: 18,
        max_moves: 52,
        base_ratio_x100: 75,
        max_ratio_x100: 160,
        thresholds: [3, 5, 7, 9, 11, 12, 13],
        constraint_start_level: 4,
        active_mutator_id: 9,
        passive_mutator_id: 10,
        boss_id: 6,
        star_unlock_cost: 100,
        usdc_unlock_cost: 5_000_000,
        active: active(3, 0, 20, 30, 1),
        passive: passive(100, 100, 4, 0, 128, 6),
    },
    ZoneSpec {
        map_id: 6,
        theme_id: 7,
        base_moves: 16,
        max_moves: 48,
        base_ratio_x100: 70,
        max_ratio_x100: 150,
        thresholds: [3, 6, 8, 10, 11, 12, 13],
        constraint_start_level: 3,
        active_mutator_id: 11,
        passive_mutator_id: 12,
        boss_id: 7,
        star_unlock_cost: 100,
        usdc_unlock_cost: 5_000_000,
        active: active(2, 0, 20, 30, 1),
        passive: passive(100, 200, 1, 10, 129, 5),
    },
    ZoneSpec {
        map_id: 7,
        theme_id: 5,
        base_moves: 12,
        max_moves: 38,
        base_ratio_x100: 55,
        max_ratio_x100: 125,
        thresholds: [3, 5, 7, 9, 11, 12, 13],
        constraint_start_level: 3,
        active_mutator_id: 13,
        passive_mutator_id: 14,
        boss_id: 5,
        star_unlock_cost: 100,
        usdc_unlock_cost: 5_000_000,
        active: active(1, 4, 20, 0, 1),
        passive: passive(300, 100, 0, 10, 131, 5),
    },
    ZoneSpec {
        map_id: 8,
        theme_id: 8,
        base_moves: 16,
        max_moves: 46,
        base_ratio_x100: 75,
        max_ratio_x100: 160,
        thresholds: [3, 5, 7, 9, 11, 12, 13],
        constraint_start_level: 3,
        active_mutator_id: 15,
        passive_mutator_id: 16,
        boss_id: 8,
        star_unlock_cost: 200,
        usdc_unlock_cost: 10_000_000,
        active: active(3, 5, 30, 50, 2),
        passive: passive(100, 200, 0, 0, 130, 6),
    },
    ZoneSpec {
        map_id: 9,
        theme_id: 9,
        base_moves: 15,
        max_moves: 45,
        base_ratio_x100: 70,
        max_ratio_x100: 155,
        thresholds: [2, 4, 6, 8, 10, 11, 12],
        constraint_start_level: 3,
        active_mutator_id: 17,
        passive_mutator_id: 18,
        boss_id: 9,
        star_unlock_cost: 200,
        usdc_unlock_cost: 10_000_000,
        active: active(2, 4, 0, 50, 1),
        passive: passive(100, 200, 2, 0, 130, 6),
    },
    ZoneSpec {
        map_id: 10,
        theme_id: 10,
        base_moves: 14,
        max_moves: 42,
        base_ratio_x100: 80,
        max_ratio_x100: 170,
        thresholds: [2, 4, 6, 8, 9, 10, 11],
        constraint_start_level: 2,
        active_mutator_id: 19,
        passive_mutator_id: 20,
        boss_id: 10,
        star_unlock_cost: 200,
        usdc_unlock_cost: 10_000_000,
        active: active(1, 5, 30, 0, 1),
        passive: passive(300, 250, 0, 30, 132, 7),
    },
];

pub fn campaign_map(content_version: u32, map_id: u8) -> Option<CampaignMapRules> {
    let spec = *ZONES.get(map_id.checked_sub(1)? as usize)?;
    let levels =
        std::array::from_fn(|index| generate_level(content_version, spec, index as u8 + 1));
    Some(CampaignMapRules {
        map_id,
        theme_id: spec.theme_id,
        star_unlock_cost: spec.star_unlock_cost,
        usdc_unlock_cost: spec.usdc_unlock_cost,
        levels,
    })
}

fn generate_level(content_version: u32, zone: ZoneSpec, level: u8) -> CampaignLevelRules {
    let seed = content_seed(content_version, zone.map_id, level, 0);
    let difficulty = difficulty(level, zone.thresholds);
    let moves = interpolate(zone.base_moves, zone.max_moves, level);
    let ratio = interpolate(zone.base_ratio_x100, zone.max_ratio_x100, level);
    let variance = 95 + seed[0] as u16 % 11;
    let max_moves = scale(moves, variance);
    let points_required = u32::from(scale(
        (u32::from(moves) * u32::from(ratio) / 100) as u16,
        variance,
    ));
    let (primary, secondary) = if level == 10 {
        let (first, second) = boss_types(zone.boss_id);
        (
            generate_constraint(first, budget_max(difficulty), seed_number(seed, 1)),
            generate_constraint(second, budget_max(difficulty), seed_number(seed, 2)),
        )
    } else if level < zone.constraint_start_level {
        (Constraint::default(), Constraint::default())
    } else {
        generate_regular_constraints(difficulty, seed)
    };
    let (bonus_trigger_type, bonus_threshold) = bonus_trigger(zone.active, seed[7]);

    CampaignLevelRules {
        level,
        points_required,
        max_moves,
        difficulty,
        primary,
        secondary,
        active_mutator_id: zone.active_mutator_id,
        passive_mutator_id: zone.passive_mutator_id,
        boss_id: if level == 10 { zone.boss_id } else { 0 },
        block_weights: block_weights(difficulty),
        score_multiplier_x100: zone.passive.score_multiplier_x100,
        combo_multiplier_x100: zone.passive.combo_multiplier_x100,
        line_clear_bonus: zone.passive.line_clear_bonus,
        perfect_clear_bonus: zone.passive.perfect_clear_bonus,
        star_threshold_modifier: zone.passive.star_threshold_modifier,
        bonus_type: zone.active.bonus_type,
        bonus_trigger_type,
        bonus_threshold,
        starting_charges: zone.active.starting_charges,
        starting_rows: zone.passive.starting_rows,
    }
}

fn content_seed(content_version: u32, map_id: u8, level: u8, index: u8) -> [u8; 32] {
    Sha256::new()
        .chain_update(b"zkube-campaign-content-v1")
        .chain_update(content_version.to_le_bytes())
        .chain_update([map_id, level, index])
        .finalize()
        .into()
}

fn seed_number(seed: [u8; 32], index: u8) -> u64 {
    let mixed = content_seed(
        u32::from_le_bytes(seed[..4].try_into().unwrap()),
        seed[4],
        seed[5],
        index,
    );
    u64::from_le_bytes(mixed[..8].try_into().unwrap())
}

fn interpolate(start: u16, end: u16, level: u8) -> u16 {
    start + (u32::from(level - 1) * u32::from(end - start) / 9) as u16
}

fn scale(value: u16, factor_x100: u16) -> u16 {
    (u32::from(value) * u32::from(factor_x100) / 100) as u16
}

fn difficulty(level: u8, thresholds: [u8; 7]) -> u8 {
    thresholds
        .iter()
        .take_while(|threshold| level >= **threshold)
        .count() as u8
}

fn budget_max(difficulty: u8) -> u8 {
    (u16::from(difficulty.min(7)) * 80 / 7) as u8
}

fn generate_regular_constraints(difficulty: u8, seed: [u8; 32]) -> (Constraint, Constraint) {
    let max = budget_max(difficulty);
    let min = (u16::from(max) * 70).div_ceil(100) as u8;
    let average = (u16::from(min) + u16::from(max)) / 2;
    let count = match average {
        0..=3 => 0,
        4..=8 => 1,
        9..=16 => 1 + seed[1] % 2,
        _ => 2,
    };
    if count == 0 {
        return (Constraint::default(), Constraint::default());
    }
    let budget_range = max.saturating_sub(min).saturating_add(1).max(1);
    let first_budget = min + seed[2] % budget_range;
    let first_type = regular_type(seed[3]);
    let first = generate_constraint(first_type, first_budget, seed_number(seed, 3));
    if count == 1 {
        return (first, Constraint::default());
    }
    let second_budget = min + seed[4] % budget_range;
    let second_type = next_type(first_type);
    (
        first,
        generate_constraint(second_type, second_budget, seed_number(seed, 4)),
    )
}

fn regular_type(seed: u8) -> ConstraintKind {
    match seed % 3 {
        0 => ConstraintKind::ComboLines,
        1 => ConstraintKind::BreakBlocks,
        _ => ConstraintKind::ComboStreak,
    }
}

fn next_type(kind: ConstraintKind) -> ConstraintKind {
    match kind {
        ConstraintKind::ComboLines => ConstraintKind::BreakBlocks,
        ConstraintKind::BreakBlocks => ConstraintKind::ComboStreak,
        _ => ConstraintKind::ComboLines,
    }
}

fn generate_constraint(kind: ConstraintKind, budget: u8, seed: u64) -> Constraint {
    match kind {
        ConstraintKind::None => Constraint::default(),
        ConstraintKind::ComboStreak => Constraint {
            kind,
            value: (budget / 2).max(1),
            required_count: 1,
        },
        ConstraintKind::ComboLines => {
            let candidates: Vec<(u8, u8)> = (2..=8)
                .flat_map(|lines| {
                    let cost = line_cost(lines);
                    let minimum = (u16::from(budget) * 70).div_ceil(100) as u8;
                    (1..=5).filter_map(move |times| {
                        let spend = cost.saturating_mul(times);
                        (spend >= minimum && spend <= budget).then_some((lines, times))
                    })
                })
                .collect();
            let (value, required_count) = candidates
                .get(seed as usize % candidates.len().max(1))
                .copied()
                .unwrap_or((2, 1));
            Constraint {
                kind,
                value,
                required_count,
            }
        }
        ConstraintKind::BreakBlocks => {
            let max_size = if budget < 10 {
                2
            } else if budget < 20 {
                3
            } else {
                4
            };
            let size = 1 + seed as u8 % max_size;
            let scale = if size <= 2 { 6 } else { 4 };
            let cost = 3 + size;
            let required_count =
                ((u16::from(budget) * scale) / u16::from(cost)).clamp(1, 120) as u8;
            Constraint {
                kind,
                value: size,
                required_count,
            }
        }
    }
}

fn line_cost(lines: u8) -> u8 {
    match lines {
        0 | 1 => 1,
        2 => 3,
        3 => 10,
        4 => 20,
        5 => 30,
        6 => 40,
        7 => 60,
        _ => 80,
    }
}

fn boss_types(boss_id: u8) -> (ConstraintKind, ConstraintKind) {
    use ConstraintKind::{BreakBlocks, ComboLines, ComboStreak};
    match boss_id {
        1 | 4 => (ComboLines, ComboStreak),
        2 => (BreakBlocks, ComboLines),
        3 => (ComboStreak, ComboLines),
        5 | 8 => (BreakBlocks, ComboStreak),
        6 | 10 => (ComboLines, BreakBlocks),
        7 | 9 => (ComboStreak, BreakBlocks),
        _ => (ComboLines, ComboStreak),
    }
}

fn block_weights(difficulty: u8) -> [u16; 5] {
    match difficulty {
        0 => [15, 30, 30, 15, 10],
        1 => [15, 25, 30, 20, 10],
        2 => [15, 25, 25, 20, 15],
        3 => [10, 20, 25, 25, 20],
        4 => [10, 20, 20, 25, 25],
        5 => [5, 15, 20, 30, 30],
        6 => [0, 15, 15, 35, 35],
        _ => [0, 5, 10, 50, 35],
    }
}

fn bonus_trigger(active: ActiveMutator, roll: u8) -> (u8, u16) {
    let mut candidates = [(0, 0); 3];
    let mut count = 0usize;
    for candidate in [
        (1, active.combo_threshold),
        (2, active.lines_threshold),
        (3, active.score_threshold),
    ] {
        if candidate.1 > 0 {
            candidates[count] = candidate;
            count += 1;
        }
    }
    if count == 0 {
        (0, 0)
    } else {
        candidates[roll as usize % count]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_ten_maps_have_complete_bounded_catalogs() {
        for map_id in 1..=10 {
            let map = campaign_map(1, map_id).unwrap();
            assert_eq!(map.map_id, map_id);
            for (index, level) in map.levels.iter().enumerate() {
                assert_eq!(level.level, index as u8 + 1);
                assert!(level.max_moves > 0);
                assert!(level.starting_rows <= 9);
                assert_eq!(level.block_weights.iter().sum::<u16>(), 100);
                assert!(level.bonus_type <= 3);
                assert!(level.bonus_trigger_type <= 3);
            }
        }
        assert!(campaign_map(1, 0).is_none());
        assert!(campaign_map(1, 11).is_none());
    }

    #[test]
    fn cairo_zone_economics_and_boss_identities_are_preserved() {
        let first = campaign_map(1, 1).unwrap();
        assert_eq!((first.star_unlock_cost, first.usdc_unlock_cost), (0, 0));
        let last = campaign_map(1, 10).unwrap();
        assert_eq!(
            (last.star_unlock_cost, last.usdc_unlock_cost),
            (200, 10_000_000)
        );
        assert_eq!(first.levels[9].boss_id, 1);
        assert_eq!(last.levels[9].boss_id, 10);
        assert_eq!(last.levels[9].primary.kind, ConstraintKind::ComboLines);
        assert_eq!(last.levels[9].secondary.kind, ConstraintKind::BreakBlocks);
    }

    #[test]
    fn shared_golden_map_catalog_matches_rust_content() {
        let fixtures: serde_json::Value =
            serde_json::from_str(include_str!("../../../../../fixtures/game-parity.json")).unwrap();
        for fixture in fixtures["mapCatalog"].as_array().unwrap() {
            let map_id = fixture["mapId"].as_u64().unwrap() as u8;
            let map = campaign_map(1, map_id).unwrap();
            assert_eq!(map.theme_id, fixture["themeId"].as_u64().unwrap() as u8);
            assert_eq!(map.star_unlock_cost, fixture["starCost"].as_u64().unwrap());
            assert_eq!(map.usdc_unlock_cost, fixture["usdcCost"].as_u64().unwrap());
            assert_eq!(
                map.levels[CAMPAIGN_LEVELS - 1].boss_id,
                fixture["bossId"].as_u64().unwrap() as u8
            );
        }
    }

    #[test]
    fn content_version_domains_every_level_snapshot() {
        assert_ne!(campaign_map(1, 4), campaign_map(2, 4));
        assert_eq!(campaign_map(1, 4), campaign_map(1, 4));
    }
}
