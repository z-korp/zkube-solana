#![forbid(unsafe_code)]

mod art_catalog;
mod native_client;
mod native_fixtures;

use std::{fmt::Write as _, fs, path::PathBuf, process::ExitCode};

use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use zkube_core::{
    ARCADE_ACCOUNT_VERSION, ARCADE_DAILY_RESULT_HASH_DOMAIN, ARENA_ENTRY_LAMPORTS, Bonus,
    CAMPAIGN_TARGET_LADDER, Constraint, ConstraintKind, DAILY_MAX_MOVES, DAILY_PAIR_COUNT,
    DAILY_PAIR_SELECTION_SEED, DAILY_REWARD_CLAIM_WINDOW_SECONDS, DAILY_THEMES,
    ENTRY_DAILY_LAMPORTS, ENTRY_OPERATOR_LAMPORTS, Guardian, PLAYER_STATE_ACCOUNT_VERSION,
    PRESSURE_STEP, PROTOCOL_ACCOUNT_VERSION, RunRules, SECONDS_PER_DAY, SOL_PAYOUT_UNIT_LAMPORTS,
};

const FIXTURE: &str = "fixtures/campaign-v2.json";
// Authored adjacent weight tiers must remain materially distinct.
const CAMPAIGN_MIN_ADJACENT_WEIGHT_TV_PERCENT: u16 = 5;

#[derive(Parser)]
#[command(
    name = "zkube-codegen",
    about = "Validate and generate zKube backend artifacts"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,

    /// Repository root containing the Campaign fixture and this crate.
    #[arg(long, default_value = ".")]
    root: PathBuf,
}

#[derive(Subcommand)]
enum Command {
    /// Validate sources and update generated files.
    Generate,
    /// Validate sources and fail when generated files differ.
    Check,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CampaignCatalog {
    schema_version: u32,
    content_version: u32,
    difficulty_weights: Vec<[u16; 5]>,
    maps: Vec<CampaignMap>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CampaignMap {
    map_id: u8,
    rules: [u16; 4],
    levels: Vec<EncodedLevel>,
}

type EncodedLevel = (u8, [u8; 3], [u8; 3]);

fn main() -> ExitCode {
    match run(&Cli::parse()) {
        Ok(message) => {
            println!("{message}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("zkube-codegen: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: &Cli) -> Result<String, String> {
    let fixture_path = cli.root.join(FIXTURE);
    let source = fs::read_to_string(&fixture_path)
        .map_err(|error| format!("cannot read {}: {error}", fixture_path.display()))?;
    let catalog: CampaignCatalog = serde_json::from_str(&source)
        .map_err(|error| format!("invalid {}: {error}", fixture_path.display()))?;
    validate_catalog(&catalog)?;
    let mut outputs = native_client::outputs(&catalog)?;
    let art_source = fs::read_to_string(cli.root.join("assets/catalog.json"))
        .map_err(|error| error.to_string())?;
    outputs.push((
        "assets/theme-catalog.generated.json",
        art_catalog::render(&catalog, &art_source)?,
    ));
    outputs.extend([
        (
            "crates/zkube-core/src/realm_rules.generated.rs",
            render_realm_rules_rust(&catalog),
        ),
        (
            "crates/zkube-core/src/tier_weights.generated.rs",
            render_tier_weights_rust(&catalog),
        ),
        (
            "services/src/dailyRules.generated.ts",
            render_daily_rules_typescript()?,
        ),
        (
            "services/src/protocolVersions.generated.ts",
            render_protocol_constants(&catalog),
        ),
    ]);
    for (relative, content) in outputs {
        let path = cli.root.join(relative);
        match cli.command {
            Command::Generate => {
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                fs::write(&path, content).map_err(|error| error.to_string())?;
            }
            Command::Check => {
                let actual = fs::read_to_string(&path)
                    .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
                if actual != content {
                    return Err(format!(
                        "{} is stale; run `NO_DNA=1 cargo run -p zkube-codegen -- generate`",
                        path.display()
                    ));
                }
            }
        }
    }
    Ok(
        "Campaign catalog, Daily rules, native fixtures and shared protocol constants are current"
            .into(),
    )
}

fn validate_catalog(catalog: &CampaignCatalog) -> Result<(), String> {
    if catalog.schema_version != 1 || catalog.content_version != zkube_core::CATALOG_VERSION {
        return Err("Campaign v3 must use schemaVersion 1 and contentVersion 3".into());
    }
    if catalog.difficulty_weights.len() != 8 {
        return Err("difficultyWeights must contain exactly eight tiers".into());
    }
    for (index, weights) in catalog.difficulty_weights.iter().enumerate() {
        if weights.iter().map(|value| u32::from(*value)).sum::<u32>() != 100
            || weights.iter().all(|value| *value == 0)
        {
            return Err(format!(
                "difficulty tier {index} must be playable and sum to 100"
            ));
        }
    }
    for (index, pair) in catalog.difficulty_weights.windows(2).enumerate() {
        let total_variation = pair[0]
            .iter()
            .zip(pair[1])
            .map(|(left, right)| left.abs_diff(right))
            .sum::<u16>()
            / 2;
        if total_variation < CAMPAIGN_MIN_ADJACENT_WEIGHT_TV_PERCENT {
            return Err(format!(
                "difficulty tiers {index} and {} must differ by at least {} percentage points",
                index + 1,
                CAMPAIGN_MIN_ADJACENT_WEIGHT_TV_PERCENT
            ));
        }
    }
    if catalog.maps.len() != 10 {
        return Err("Campaign v3 must contain exactly ten maps".into());
    }
    for (map_index, map) in catalog.maps.iter().enumerate() {
        let expected_map = u8::try_from(map_index + 1).map_err(|error| error.to_string())?;
        if map.map_id != expected_map {
            return Err(format!("map IDs must be ordered; expected {expected_map}"));
        }
        if map.levels.len() != 10 {
            return Err(format!(
                "map {} must contain exactly ten levels",
                map.map_id
            ));
        }
        for (level_index, level) in map.levels.iter().enumerate() {
            let level_number = u8::try_from(level_index + 1).map_err(|error| error.to_string())?;
            let rules = campaign_rules(map, level_number, *level, &catalog.difficulty_weights)?;
            if !rules.is_valid() {
                return Err(format!(
                    "map {} level {} has invalid rules",
                    map.map_id,
                    level_index + 1
                ));
            }
            let stars = rules.stars.expect("Campaign rules carry star sources");
            if !stars.primary.is_present() || !stars.secondary.is_present() {
                return Err(format!(
                    "map {} level {} must author both primary and secondary constraints",
                    map.map_id,
                    level_index + 1
                ));
            }
            if level_index > 0 && level.0 < map.levels[level_index - 1].0 {
                return Err(format!(
                    "map {} level {} must preserve difficulty",
                    map.map_id,
                    level_index + 1
                ));
            }
        }
    }
    Ok(())
}

fn render_realm_rules_rust(catalog: &CampaignCatalog) -> String {
    let mut output = String::from(
        "// Generated by zkube-codegen from fixtures/campaign-v2.json. Do not edit.\n\npub const REALM_RULES: [RealmRules; CAMPAIGN_MAP_COUNT] = [\n",
    );
    for map in &catalog.maps {
        let [bonus, trigger, threshold, starting_height] = map.rules;
        let bonus = match bonus {
            1 => "Hammer",
            2 => "Totem",
            3 => "Wave",
            _ => unreachable!("validated guardian"),
        };
        writeln!(output, "    RealmRules {{\n        guardian: Guardian {{\n            bonus: Bonus::{bonus},\n            trigger: {trigger},\n            threshold: {threshold},\n        }},\n        starting_height: {starting_height},\n    }},").unwrap();
    }
    output.push_str("];\n");
    output
}

fn campaign_rules(
    map: &CampaignMap,
    level_number: u8,
    level: EncodedLevel,
    weights: &[[u16; 5]],
) -> Result<RunRules, String> {
    let difficulty = usize::from(level.0);
    if difficulty >= weights.len() {
        return Err(format!(
            "map {} references difficulty {difficulty}",
            map.map_id
        ));
    }
    let bonus = match map.rules[0] {
        1 => Bonus::Hammer,
        2 => Bonus::Totem,
        3 => Bonus::Wave,
        value => return Err(format!("map {} has unknown bonus {value}", map.map_id)),
    };
    RunRules::campaign(
        zkube_core::RealmRules {
            guardian: Guardian {
                bonus,
                trigger: u8::try_from(map.rules[1])
                    .map_err(|_| format!("map {} trigger exceeds u8", map.map_id))?,
                threshold: map.rules[2],
            },
            starting_height: u8::try_from(map.rules[3])
                .map_err(|_| format!("map {} starting rows exceed u8", map.map_id))?,
        },
        level_number,
        level.0,
        constraint(level.1)?,
        constraint(level.2)?,
    )
    .ok_or_else(|| {
        format!(
            "map {} level {level_number} has invalid Campaign rules",
            map.map_id
        )
    })
}

fn constraint(tuple: [u8; 3]) -> Result<Constraint, String> {
    let kind = ConstraintKind::from_tag(tuple[0])
        .ok_or_else(|| format!("unknown Campaign constraint {}", tuple[0]))?;
    Ok(Constraint {
        kind,
        value: tuple[1],
        required_count: tuple[2],
    })
}

fn render_daily_rules_typescript() -> Result<String, String> {
    let mut themes = String::from("[");
    for (index, theme) in DAILY_THEMES.iter().enumerate() {
        if index > 0 {
            themes.push_str(", ");
        }
        write!(
            themes,
            "{{ kind: {}, value: {} }}",
            theme.kind.tag(),
            theme.value
        )
        .map_err(|error| error.to_string())?;
    }
    themes.push(']');
    Ok(format!(
        "// Generated by zkube-codegen. Do not edit.\n\
         export const DAILY_PAIR_COUNT = {DAILY_PAIR_COUNT} as const;\n\
         export const DAILY_PAIR_SELECTION_SEED = {DAILY_PAIR_SELECTION_SEED:?} as const;\n\
         export const DAILY_THEMES = {themes} as const;\n"
    ))
}

fn render_tier_weights_rust(catalog: &CampaignCatalog) -> String {
    let mut rendered = String::from(
        "// Generated by zkube-codegen from fixtures/campaign-v2.json. Do not edit.\n\
         pub const TIER_BLOCK_WEIGHTS: [[u16; 5]; 8] = [\n",
    );
    for weights in &catalog.difficulty_weights {
        writeln!(rendered, "    {weights:?},").expect("writing to a String cannot fail");
    }
    rendered.push_str("];\n");
    rendered
}

fn render_protocol_constants(catalog: &CampaignCatalog) -> String {
    let catalog_version = zkube_core::CATALOG_VERSION;
    let reserved_bytes = zkube_core::PLAYER_STATE_RESERVED_BYTES;
    let tier_block_weights = &catalog.difficulty_weights;
    format!(
        "// Generated by zkube-codegen from zkube-core. Do not edit.\n\
         export const PROTOCOL_ACCOUNT_VERSION = {PROTOCOL_ACCOUNT_VERSION} as const;\n\
         export const PLAYER_STATE_ACCOUNT_VERSION = {PLAYER_STATE_ACCOUNT_VERSION} as const;\n\
         export const PLAYER_STATE_RESERVED_BYTES = {reserved_bytes} as const;\n\
         export const ARCADE_ACCOUNT_VERSION = {ARCADE_ACCOUNT_VERSION} as const;\n\
         export const ARCADE_DAILY_RESULT_HASH_DOMAIN = \"{ARCADE_DAILY_RESULT_HASH_DOMAIN}\" as const;\n\
         export const ARENA_ENTRY_LAMPORTS = {ARENA_ENTRY_LAMPORTS}n;\n\
         export const ENTRY_DAILY_LAMPORTS = {ENTRY_DAILY_LAMPORTS}n;\n\
         export const ENTRY_OPERATOR_LAMPORTS = {ENTRY_OPERATOR_LAMPORTS}n;\n\
         export const SOL_PAYOUT_UNIT_LAMPORTS = {SOL_PAYOUT_UNIT_LAMPORTS}n;\n\
         export const SECONDS_PER_DAY = {SECONDS_PER_DAY} as const;\n\
         export const DAILY_REWARD_CLAIM_WINDOW_SECONDS = {DAILY_REWARD_CLAIM_WINDOW_SECONDS} as const;\n\
         export const DAILY_MAX_MOVES = {DAILY_MAX_MOVES} as const;\n\
         export const PRESSURE_STEP = {PRESSURE_STEP} as const;\n\
         export const CATALOG_VERSION = {catalog_version} as const;\n\
         export const CAMPAIGN_TARGET_LADDER = {CAMPAIGN_TARGET_LADDER:?} as const;\n\
         export const TIER_BLOCK_WEIGHTS = {tier_block_weights:?} as const;\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    type ContainedFactCase = (ConstraintKind, u8, ConstraintKind, u8, u8, u8, u16);

    const CONTAINED_FACT_CASES: [ContainedFactCase; 10] = [
        (
            ConstraintKind::CombosOfExactly,
            4,
            ConstraintKind::ComboOfExactly,
            4,
            1,
            0,
            0,
        ),
        (
            ConstraintKind::CombosOfExactly,
            4,
            ConstraintKind::ComboOfAtLeast,
            3,
            1,
            0,
            0,
        ),
        (
            ConstraintKind::CombosOfAtLeast,
            4,
            ConstraintKind::ComboOfAtLeast,
            3,
            1,
            0,
            0,
        ),
        (
            ConstraintKind::BigMoves,
            20,
            ConstraintKind::BigMove,
            19,
            1,
            0,
            0,
        ),
        (
            ConstraintKind::BonusLines,
            0,
            ConstraintKind::BonusLinesInMove,
            1,
            1,
            0,
            0,
        ),
        (
            ConstraintKind::TriggerFired,
            0,
            ConstraintKind::ComboOfAtLeast,
            2,
            1,
            1,
            2,
        ),
        (
            ConstraintKind::TriggerFired,
            0,
            ConstraintKind::ComboOfExactly,
            3,
            1,
            4,
            3,
        ),
        (
            ConstraintKind::TriggerFired,
            0,
            ConstraintKind::AllWidthsInMove,
            0,
            1,
            6,
            0,
        ),
        (
            ConstraintKind::TriggerFired,
            0,
            ConstraintKind::BreakInMove,
            0,
            6,
            8,
            6,
        ),
        (
            ConstraintKind::TriggerFired,
            0,
            ConstraintKind::Streak,
            1,
            3,
            9,
            3,
        ),
    ];

    #[test]
    fn committed_catalog_validates_and_emits_protocol_constants() {
        let source = include_str!("../../../fixtures/campaign-v2.json");
        let catalog: CampaignCatalog = serde_json::from_str(source).unwrap();
        validate_catalog(&catalog).unwrap();
        let rendered_daily = render_daily_rules_typescript().unwrap();
        assert!(rendered_daily.contains("DAILY_PAIR_COUNT = 160"));
        assert!(rendered_daily.contains("kind: 18"));
        let versions = render_protocol_constants(&catalog);
        assert!(versions.contains(&format!(
            "PROTOCOL_ACCOUNT_VERSION = {}",
            zkube_core::PROTOCOL_ACCOUNT_VERSION
        )));
        assert!(versions.contains("PLAYER_STATE_ACCOUNT_VERSION = 3"));
        assert!(versions.contains(&format!(
            "ARCADE_ACCOUNT_VERSION = {}",
            zkube_core::ARCADE_ACCOUNT_VERSION
        )));
        assert!(versions.contains("CATALOG_VERSION = 3"));
        assert!(versions.contains("PLAYER_STATE_RESERVED_BYTES = 18"));
        assert!(
            versions.contains("ARCADE_DAILY_RESULT_HASH_DOMAIN = \"zkube-arcade-daily-result-v5\"")
        );
        assert!(versions.contains("ARENA_ENTRY_LAMPORTS = 10000000n"));
        assert!(versions.contains("ENTRY_DAILY_LAMPORTS = 9000000n"));
        assert!(versions.contains("PRESSURE_STEP = 15"));
        assert!(!versions.contains("SCORE_MULTIPLIERS"));
        assert!(versions.contains("TIER_BLOCK_WEIGHTS = [[25, 30, 25, 15, 5]"));
    }

    #[test]
    fn campaign_structure_keeps_weight_divergence() {
        let source = include_str!("../../../fixtures/campaign-v2.json");
        let mut catalog: CampaignCatalog = serde_json::from_str(source).unwrap();
        catalog.difficulty_weights[1] = catalog.difficulty_weights[0];
        assert!(
            validate_catalog(&catalog)
                .unwrap_err()
                .contains("must differ by at least")
        );
    }

    #[test]
    fn campaign_catalog_rejects_an_authored_budget() {
        assert!(serde_json::from_str::<EncodedLevel>("[0,[3,0,6],[9,2,1]]").is_ok());
        assert!(serde_json::from_str::<EncodedLevel>("[10,16,0,[3,0,6],[9,2,1]]").is_err());
    }

    #[test]
    fn codegen_requires_both_constraints_on_every_level() {
        let source = include_str!("../../../fixtures/campaign-v2.json");
        let mut catalog: CampaignCatalog = serde_json::from_str(source).unwrap();
        catalog.maps[0].levels[0].1 = [0, 0, 0];
        catalog.maps[0].levels[0].2 = [0, 0, 0];
        assert!(
            validate_catalog(&catalog)
                .unwrap_err()
                .contains("must author both primary and secondary constraints")
        );

        let mut catalog: CampaignCatalog = serde_json::from_str(source).unwrap();
        catalog.maps[0].levels[0].2 = [0, 0, 0];
        assert!(
            validate_catalog(&catalog)
                .unwrap_err()
                .contains("must author both primary and secondary constraints")
        );
    }

    #[test]
    fn codegen_enforces_constraint_class_per_slot() {
        let source = include_str!("../../../fixtures/campaign-v2.json");
        let mut catalog: CampaignCatalog = serde_json::from_str(source).unwrap();
        catalog.maps[0].levels[2].1 = [9, 2, 1];
        assert!(validate_catalog(&catalog).is_err());

        for (kind, value) in [
            (ConstraintKind::CombosOfAtLeast, 2),
            (ConstraintKind::BreakBlocks, 1),
            (ConstraintKind::ClearLines, 0),
            (ConstraintKind::CombosOfExactly, 2),
            (ConstraintKind::BigMoves, 1),
            (ConstraintKind::TriggerFired, 0),
            (ConstraintKind::BonusLines, 0),
            (ConstraintKind::BonusBreaks, 0),
        ] {
            let mut catalog: CampaignCatalog = serde_json::from_str(source).unwrap();
            catalog.maps[0].levels[7].1 = [kind.tag(), value, 1];
            catalog.maps[0].levels[7].2 = [ConstraintKind::PerfectClear.tag(), 0, 1];
            assert!(validate_catalog(&catalog).is_err());

            catalog.maps[0].levels[7].1[2] = 2;
            assert!(validate_catalog(&catalog).is_ok());
        }

        let mut catalog: CampaignCatalog = serde_json::from_str(source).unwrap();
        catalog.maps[0].levels[7].2 = [1, 2, 1];
        assert!(validate_catalog(&catalog).is_err());

        for invalid in [
            [9, 2, 2],
            [10, 2, 2],
            [13, 0, 2],
            [14, 1, 2],
            [15, 1, 2],
            [16, 0, 2],
        ] {
            let mut catalog: CampaignCatalog = serde_json::from_str(source).unwrap();
            catalog.maps[0].levels[7].2 = invalid;
            assert!(validate_catalog(&catalog).is_err());
        }
        for valid in [[11, 1, 2], [12, 0, 2]] {
            let mut catalog: CampaignCatalog = serde_json::from_str(source).unwrap();
            catalog.maps[0].levels[7].2 = valid;
            assert!(validate_catalog(&catalog).is_ok());
        }

        for (
            primary,
            primary_value,
            secondary,
            secondary_value,
            secondary_count,
            trigger,
            threshold,
        ) in CONTAINED_FACT_CASES
        {
            let mut catalog: CampaignCatalog = serde_json::from_str(source).unwrap();
            catalog.maps[0].rules[1] = u16::from(trigger);
            catalog.maps[0].rules[2] = threshold;
            catalog.maps[0].levels[7].1 = [primary.tag(), primary_value, 2];
            catalog.maps[0].levels[7].2 = [secondary.tag(), secondary_value, secondary_count];
            assert!(validate_catalog(&catalog).is_err());
        }
    }
}
