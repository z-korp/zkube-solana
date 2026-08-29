#![forbid(unsafe_code)]

use std::{fmt::Write as _, fs, path::PathBuf, process::ExitCode};

use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use zkube_core::{
    ARCADE_ACCOUNT_VERSION, ARCADE_DAILY_RESULT_HASH_DOMAIN, ARENA_ENTRY_LAMPORTS, Bonus,
    CampaignRules, Constraint, ConstraintKind, DAILY_MAX_MOVES, DAILY_PAIR_COUNT,
    DAILY_PAIR_SELECTION_SEED, DAILY_REWARD_CLAIM_WINDOW_SECONDS, DAILY_THEMES, DailyPressureRules,
    ENTRY_DAILY_LAMPORTS, ENTRY_OPERATOR_LAMPORTS, LevelRules, MutatorRules,
    PLAYER_LABEL_ACCOUNT_VERSION, PLAYER_STATE_ACCOUNT_VERSION, PRESSURE_STEP,
    PROTOCOL_ACCOUNT_VERSION, SECONDS_PER_DAY, SOL_PAYOUT_UNIT_LAMPORTS, Sha256Provider,
    SoftwareSha256,
};

const FIXTURE: &str = "fixtures/campaign-v2.json";
const GENERATED_TS: &str = "client/src/chain/campaignCatalog.generated.ts";
const GENERATED_TIER_WEIGHTS_RS: &str = "crates/zkube-core/src/tier_weights.generated.rs";
const GENERATED_DAILY_RULES_TS: [&str; 2] = [
    "client/src/chain/dailyRules.generated.ts",
    "services/src/dailyRules.generated.ts",
];
const GENERATED_PROTOCOL_TS: [&str; 2] = [
    "client/src/chain/protocolVersions.generated.ts",
    "services/src/protocolVersions.generated.ts",
];

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
    rules: [u16; 6],
    levels: Vec<EncodedLevel>,
}

type EncodedLevel = (u32, u16, u8, [u8; 3], [u8; 3]);

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
    let generated = render_typescript(&catalog)?;
    let generated_tier_weights = render_tier_weights_rust(&catalog);
    let generated_daily_rules = render_daily_rules_typescript()?;
    let generated_protocol = render_protocol_constants(&catalog);
    let output = cli.root.join(GENERATED_TS);
    match &cli.command {
        Command::Generate => {
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
            }
            fs::write(&output, generated)
                .map_err(|error| format!("cannot write {}: {error}", output.display()))?;
            let tier_output = cli.root.join(GENERATED_TIER_WEIGHTS_RS);
            fs::write(&tier_output, &generated_tier_weights)
                .map_err(|error| format!("cannot write {}: {error}", tier_output.display()))?;
            for relative in GENERATED_DAILY_RULES_TS {
                let daily_output = cli.root.join(relative);
                if let Some(parent) = daily_output.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
                }
                fs::write(&daily_output, &generated_daily_rules)
                    .map_err(|error| format!("cannot write {}: {error}", daily_output.display()))?;
            }
            for relative in GENERATED_PROTOCOL_TS {
                let protocol_output = cli.root.join(relative);
                if let Some(parent) = protocol_output.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
                }
                fs::write(&protocol_output, &generated_protocol).map_err(|error| {
                    format!("cannot write {}: {error}", protocol_output.display())
                })?;
            }
            Ok("generated Campaign catalog, Daily rules, and shared protocol constants".into())
        }
        Command::Check => {
            let actual = fs::read_to_string(&output)
                .map_err(|error| format!("cannot read {}: {error}", output.display()))?;
            if actual != generated {
                return Err(format!(
                    "{} is stale; run `NO_DNA=1 cargo run -p zkube-codegen -- generate`",
                    output.display()
                ));
            }
            let tier_output = cli.root.join(GENERATED_TIER_WEIGHTS_RS);
            let actual_tiers = fs::read_to_string(&tier_output)
                .map_err(|error| format!("cannot read {}: {error}", tier_output.display()))?;
            if actual_tiers != generated_tier_weights {
                return Err(format!(
                    "{} is stale; run `NO_DNA=1 cargo run -p zkube-codegen -- generate`",
                    tier_output.display()
                ));
            }
            for relative in GENERATED_DAILY_RULES_TS {
                let daily_output = cli.root.join(relative);
                let actual_daily = fs::read_to_string(&daily_output)
                    .map_err(|error| format!("cannot read {}: {error}", daily_output.display()))?;
                if actual_daily != generated_daily_rules {
                    return Err(format!(
                        "{} is stale; run `NO_DNA=1 cargo run -p zkube-codegen -- generate`",
                        daily_output.display()
                    ));
                }
            }
            for relative in GENERATED_PROTOCOL_TS {
                let protocol_output = cli.root.join(relative);
                let actual = fs::read_to_string(&protocol_output).map_err(|error| {
                    format!("cannot read {}: {error}", protocol_output.display())
                })?;
                if actual != generated_protocol {
                    return Err(format!(
                        "{} is stale; run `NO_DNA=1 cargo run -p zkube-codegen -- generate`",
                        protocol_output.display()
                    ));
                }
            }
            Ok("checked Campaign catalog, Daily rules, and shared protocol constants".into())
        }
    }
}

fn validate_catalog(catalog: &CampaignCatalog) -> Result<(), String> {
    if catalog.schema_version != 1 || catalog.content_version != 2 {
        return Err("Campaign v2 must use schemaVersion 1 and contentVersion 2".into());
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
        return Err("Campaign v2 must contain exactly ten maps".into());
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
            // This curve is a bot-calibrated baseline until the three-realm playtest.
            let rules = campaign_rules(map, level, &catalog.difficulty_weights)?;
            if !rules.is_valid() {
                return Err(format!(
                    "map {} level {} has invalid rules",
                    map.map_id,
                    level_index + 1
                ));
            }
            if !rules.level.primary.is_present() || !rules.level.secondary.is_present() {
                return Err(format!(
                    "map {} level {} must author both primary and secondary constraints",
                    map.map_id,
                    level_index + 1
                ));
            }
            if level_index > 0 {
                let previous = map.levels[level_index - 1];
                if level.0 <= previous.0 || level.2 < previous.2 {
                    return Err(format!(
                        "map {} level {} must raise score and preserve difficulty",
                        map.map_id,
                        level_index + 1
                    ));
                }
            }
        }
    }
    Ok(())
}

fn campaign_rules(
    map: &CampaignMap,
    level: &(u32, u16, u8, [u8; 3], [u8; 3]),
    weights: &[[u16; 5]],
) -> Result<CampaignRules, String> {
    let difficulty = usize::from(level.2);
    if difficulty >= weights.len() {
        return Err(format!(
            "map {} references difficulty {difficulty}",
            map.map_id
        ));
    }
    let bonus = match map.rules[2] {
        0 => None,
        1 => Some(Bonus::Hammer),
        2 => Some(Bonus::Totem),
        3 => Some(Bonus::Wave),
        value => return Err(format!("map {} has unknown bonus {value}", map.map_id)),
    };
    Ok(CampaignRules {
        level: LevelRules {
            points_required: level.0,
            max_moves: level.1,
            primary: constraint(level.3)?,
            secondary: constraint(level.4)?,
        },
        mutator: MutatorRules {
            line_clear_bonus: map.rules[0],
            perfect_clear_bonus: map.rules[1],
            bonus_trigger_type: u8::try_from(map.rules[3])
                .map_err(|_| format!("map {} trigger exceeds u8", map.map_id))?,
            bonus_threshold: map.rules[4],
        },
        bonus,
        starting_height: u8::try_from(map.rules[5])
            .map_err(|_| format!("map {} starting rows exceed u8", map.map_id))?,
        level_difficulty: level.2,
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

fn render_typescript(catalog: &CampaignCatalog) -> Result<String, String> {
    let canonical = serde_json::to_vec(catalog)
        .map_err(|error| format!("cannot canonicalize Campaign catalog: {error}"))?;
    let digest = SoftwareSha256::hashv(&[b"zkube-campaign-content-v2", &canonical]);
    let mut hash_hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut hash_hex, "{byte:02x}").expect("writing to a String cannot fail");
    }
    let json = serde_json::to_string_pretty(catalog)
        .map_err(|error| format!("cannot render Campaign catalog: {error}"))?;
    Ok(format!(
        "// Generated by zkube-codegen. Do not edit.\n\
         export const CAMPAIGN_CONTENT_HASH_HEX = \"{hash_hex}\" as const;\n\
         export const CAMPAIGN_CONTENT_HASH = new Uint8Array([{}]);\n\
         export const CAMPAIGN_CATALOG = {json} as const;\n",
        digest
            .iter()
            .map(u8::to_string)
            .collect::<Vec<_>>()
            .join(", ")
    ))
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
    let pressure = DailyPressureRules::canonical();
    let score_multipliers_x100 = pressure.score_multipliers_x100;
    let tier_block_weights = &catalog.difficulty_weights;
    format!(
        "// Generated by zkube-codegen from zkube-core. Do not edit.\n\
         export const PROTOCOL_ACCOUNT_VERSION = {PROTOCOL_ACCOUNT_VERSION} as const;\n\
         export const PLAYER_STATE_ACCOUNT_VERSION = {PLAYER_STATE_ACCOUNT_VERSION} as const;\n\
         export const ARCADE_ACCOUNT_VERSION = {ARCADE_ACCOUNT_VERSION} as const;\n\
         export const PLAYER_LABEL_ACCOUNT_VERSION = {PLAYER_LABEL_ACCOUNT_VERSION} as const;\n\
         export const ARCADE_DAILY_RESULT_HASH_DOMAIN = \"{ARCADE_DAILY_RESULT_HASH_DOMAIN}\" as const;\n\
         export const ARENA_ENTRY_LAMPORTS = {ARENA_ENTRY_LAMPORTS}n;\n\
         export const ENTRY_DAILY_LAMPORTS = {ENTRY_DAILY_LAMPORTS}n;\n\
         export const ENTRY_OPERATOR_LAMPORTS = {ENTRY_OPERATOR_LAMPORTS}n;\n\
         export const SOL_PAYOUT_UNIT_LAMPORTS = {SOL_PAYOUT_UNIT_LAMPORTS}n;\n\
         export const SECONDS_PER_DAY = {SECONDS_PER_DAY} as const;\n\
         export const DAILY_REWARD_CLAIM_WINDOW_SECONDS = {DAILY_REWARD_CLAIM_WINDOW_SECONDS} as const;\n\
         export const DAILY_MAX_MOVES = {DAILY_MAX_MOVES} as const;\n\
         export const PRESSURE_STEP = {PRESSURE_STEP} as const;\n\
         export const DAILY_PRESSURE_SCORE_MULTIPLIERS_X100 = {score_multipliers_x100:?} as const;\n\
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
    fn committed_catalog_validates_and_hashes_stably() {
        let source = include_str!("../../../fixtures/campaign-v2.json");
        let catalog: CampaignCatalog = serde_json::from_str(source).unwrap();
        validate_catalog(&catalog).unwrap();
        let first = render_typescript(&catalog).unwrap();
        let second = render_typescript(&catalog).unwrap();
        assert_eq!(first, second);
        let rendered_daily = render_daily_rules_typescript().unwrap();
        assert!(rendered_daily.contains("DAILY_PAIR_COUNT = 160"));
        assert!(rendered_daily.contains("kind: 18"));
        assert!(first.contains("CAMPAIGN_CONTENT_HASH_HEX"));
        let versions = render_protocol_constants(&catalog);
        assert!(versions.contains("PROTOCOL_ACCOUNT_VERSION = 1"));
        assert!(versions.contains("PLAYER_STATE_ACCOUNT_VERSION = 1"));
        assert!(versions.contains("ARCADE_ACCOUNT_VERSION = 1"));
        assert!(
            versions.contains("ARCADE_DAILY_RESULT_HASH_DOMAIN = \"zkube-arcade-daily-result-v5\"")
        );
        assert!(versions.contains("ARENA_ENTRY_LAMPORTS = 10000000n"));
        assert!(versions.contains("ENTRY_DAILY_LAMPORTS = 9000000n"));
        assert!(versions.contains("PRESSURE_STEP = 20"));
        assert!(versions.contains("TIER_BLOCK_WEIGHTS = [[25, 30, 25, 15, 5]"));
    }

    #[test]
    fn campaign_structure_keeps_weight_divergence_without_a_move_trajectory() {
        let source = include_str!("../../../fixtures/campaign-v2.json");
        let mut catalog: CampaignCatalog = serde_json::from_str(source).unwrap();
        catalog.difficulty_weights[1] = catalog.difficulty_weights[0];
        assert!(
            validate_catalog(&catalog)
                .unwrap_err()
                .contains("must differ by at least")
        );

        let mut catalog: CampaignCatalog = serde_json::from_str(source).unwrap();
        catalog.maps[0].levels[1].1 = catalog.maps[0].levels[0].1;
        validate_catalog(&catalog).unwrap();
    }

    #[test]
    fn codegen_requires_both_constraints_on_every_level() {
        let source = include_str!("../../../fixtures/campaign-v2.json");
        let mut catalog: CampaignCatalog = serde_json::from_str(source).unwrap();
        catalog.maps[0].levels[0].3 = [0, 0, 0];
        catalog.maps[0].levels[0].4 = [0, 0, 0];
        assert!(
            validate_catalog(&catalog)
                .unwrap_err()
                .contains("must author both primary and secondary constraints")
        );

        let mut catalog: CampaignCatalog = serde_json::from_str(source).unwrap();
        catalog.maps[0].levels[0].4 = [0, 0, 0];
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
        catalog.maps[0].levels[2].3 = [9, 2, 1];
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
            catalog.maps[0].levels[7].3 = [kind.tag(), value, 1];
            catalog.maps[0].levels[7].4 = [ConstraintKind::PerfectClear.tag(), 0, 1];
            assert!(validate_catalog(&catalog).is_err());

            catalog.maps[0].levels[7].3[2] = 2;
            assert!(validate_catalog(&catalog).is_ok());
        }

        let mut catalog: CampaignCatalog = serde_json::from_str(source).unwrap();
        catalog.maps[0].levels[7].4 = [1, 2, 1];
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
            catalog.maps[0].levels[7].4 = invalid;
            assert!(validate_catalog(&catalog).is_err());
        }
        for valid in [[11, 1, 2], [12, 0, 2]] {
            let mut catalog: CampaignCatalog = serde_json::from_str(source).unwrap();
            catalog.maps[0].levels[7].4 = valid;
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
            catalog.maps[0].rules[3] = u16::from(trigger);
            catalog.maps[0].rules[4] = threshold;
            catalog.maps[0].levels[7].3 = [primary.tag(), primary_value, 2];
            catalog.maps[0].levels[7].4 = [secondary.tag(), secondary_value, secondary_count];
            assert!(validate_catalog(&catalog).is_err());
        }
    }
}
