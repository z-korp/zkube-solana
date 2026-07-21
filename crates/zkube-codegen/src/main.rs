#![forbid(unsafe_code)]

use std::{fmt::Write as _, fs, path::PathBuf, process::ExitCode};

use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use zkube_core::{
    Bonus, CampaignRules, Constraint, ConstraintKind, EndlessRules, LevelRules, MutatorRules,
    Sha256Provider, SoftwareSha256,
};

const FIXTURE: &str = "fixtures/campaign-v2.json";
const GENERATED_TS: &str = "crates/zkube-codegen/generated/catalog.generated.ts";

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
    rules: [u16; 10],
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
    let output = cli.root.join(GENERATED_TS);
    match &cli.command {
        Command::Generate => {
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
            }
            fs::write(&output, generated)
                .map_err(|error| format!("cannot write {}: {error}", output.display()))?;
            Ok(format!("generated {}", output.display()))
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
            Ok(format!("checked {}", output.display()))
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
            let rules = campaign_rules(map, level, &catalog.difficulty_weights)?;
            if !rules.is_valid() {
                return Err(format!(
                    "map {} level {} has invalid rules",
                    map.map_id,
                    level_index + 1
                ));
            }
            if level_index > 0 {
                let previous = map.levels[level_index - 1];
                if level.0 <= previous.0 || level.1 < previous.1 {
                    return Err(format!(
                        "map {} level {} must not reduce its score or move curve",
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
    let mut all_weights = [[0; 5]; 8];
    all_weights.copy_from_slice(weights);
    let bonus = match map.rules[5] {
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
            score_multiplier_x100: map.rules[0],
            combo_multiplier_x100: map.rules[1],
            line_clear_bonus: map.rules[2],
            perfect_clear_bonus: map.rules[3],
            star_threshold_modifier: u8::try_from(map.rules[4])
                .map_err(|_| format!("map {} star modifier exceeds u8", map.map_id))?,
            bonus_trigger_type: u8::try_from(map.rules[6])
                .map_err(|_| format!("map {} trigger exceeds u8", map.map_id))?,
            bonus_threshold: map.rules[7],
        },
        bonus,
        starting_bonus_charges: u8::try_from(map.rules[8])
            .map_err(|_| format!("map {} charges exceed u8", map.map_id))?,
        starting_height: u8::try_from(map.rules[9])
            .map_err(|_| format!("map {} starting rows exceed u8", map.map_id))?,
        level_difficulty: level.2,
        block_weights: all_weights,
        endless: EndlessRules::default(),
    })
}

fn constraint(tuple: [u8; 3]) -> Result<Constraint, String> {
    let kind = match tuple[0] {
        0 => ConstraintKind::None,
        1 => ConstraintKind::ComboLines,
        2 => ConstraintKind::BreakBlocks,
        3 => ConstraintKind::ComboMeter,
        value => return Err(format!("unknown Campaign constraint {value}")),
    };
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn committed_catalog_validates_and_hashes_stably() {
        let source = include_str!("../../../fixtures/campaign-v2.json");
        let catalog: CampaignCatalog = serde_json::from_str(source).unwrap();
        validate_catalog(&catalog).unwrap();
        let first = render_typescript(&catalog).unwrap();
        let second = render_typescript(&catalog).unwrap();
        assert_eq!(first, second);
        assert!(first.contains("CAMPAIGN_CONTENT_HASH_HEX"));
    }
}
