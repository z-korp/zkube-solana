use std::{env, process::ExitCode};

use zkube_core::sim_harness::assertions::{
    acceptance_report_with_threads, default_harness_thread_count, gate_report_with_threads,
};
use zkube_core::sim_harness::bands::ACCEPTANCE_PLANNER_SEEDS;
use zkube_core::sim_harness::{
    FieldAssumptions, PlayerModel, SeedPartition, campaign_catalog, daily_catalog, draw_summary,
    golden_smoke_with_threads, run_campaign, run_daily, simulate_field,
};

const HARNESS_THREADS_ENV: &str = "ZKUBE_SIM_THREADS";

fn main() -> ExitCode {
    match run() {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<String, String> {
    let args = env::args().collect::<Vec<_>>();
    match args.get(1).map(String::as_str) {
        None | Some("smoke") => {
            serde_json::to_string_pretty(&golden_smoke_with_threads(parse_thread_count()?))
                .map_err(|error| error.to_string())
        }
        Some("daily") => {
            let seeds = parse_seeds(args.get(2))?;
            let seed_start = parse_seed_start(args.get(3), seeds)?;
            let mut records = Vec::new();
            for entry in daily_catalog() {
                for model in [
                    PlayerModel::Naive,
                    PlayerModel::LineClearer,
                    PlayerModel::Theme,
                    PlayerModel::PlannerStrong,
                    PlayerModel::PlannerCasual,
                    PlayerModel::PlannerStrongTheme,
                ] {
                    for partition in [SeedPartition::Tuning, SeedPartition::Holdout] {
                        for seed_index in 0..seeds {
                            let seed = partition_seed(partition, seed_start + seed_index);
                            records.push(
                                run_daily(entry, model, partition, seed)
                                    .map_err(|error| format!("Daily run failed: {error:?}"))?,
                            );
                        }
                    }
                }
            }
            serde_json::to_string(&records).map_err(|error| error.to_string())
        }
        Some("campaign") => {
            let seeds = parse_seeds(args.get(2))?;
            let seed_start = parse_seed_start(args.get(3), seeds)?;
            let mut records = Vec::new();
            for level in campaign_catalog() {
                for model in [
                    PlayerModel::Naive,
                    PlayerModel::LineClearer,
                    PlayerModel::PlannerStrong,
                    PlayerModel::PlannerCasual,
                    PlayerModel::PlannerStrongCombo,
                ] {
                    for partition in [SeedPartition::Tuning, SeedPartition::Holdout] {
                        for seed_index in 0..seeds {
                            let seed = partition_seed(partition, seed_start + seed_index);
                            records.push(
                                run_campaign(level, model, partition, seed)
                                    .map_err(|error| format!("Campaign run failed: {error:?}"))?,
                            );
                        }
                    }
                }
            }
            serde_json::to_string(&records).map_err(|error| error.to_string())
        }
        Some("draw") => {
            let summaries = [1, 5, 10, 20, 40, 64]
                .into_iter()
                .map(|count| draw_summary(count, 365))
                .collect::<Result<Vec<_>, _>>()?;
            serde_json::to_string_pretty(&summaries).map_err(|error| error.to_string())
        }
        Some("field") => {
            let mut summaries = Vec::new();
            for assumptions in [
                FieldAssumptions::low_retention(),
                FieldAssumptions::base(),
                FieldAssumptions::streak_sensitive(),
                FieldAssumptions::daily_regular(),
            ] {
                summaries.push(simulate_field(assumptions, &[1, 10, 25])?);
            }
            serde_json::to_string_pretty(&summaries).map_err(|error| error.to_string())
        }
        Some("gate") => {
            let report = gate_report_with_threads(parse_thread_count()?)?;
            let json = serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?;
            if report.result_payload.passed {
                Ok(json)
            } else {
                Err(json)
            }
        }
        Some("assert") => {
            let seeds = parse_assertion_seeds(args.get(2))?;
            let seed_start = parse_seed_start(args.get(3), u64::from(seeds))?;
            let report = acceptance_report_with_threads(seeds, seed_start, parse_thread_count()?)?;
            let json = serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?;
            if report.result_payload.passed {
                Ok(json)
            } else {
                Err(json)
            }
        }
        Some(command) => Err(format!(
            "unknown command {command:?}; use smoke, daily [seeds] [seed-start], campaign [seeds] [seed-start], draw, field, gate, or assert [seeds] [seed-start]; {HARNESS_THREADS_ENV} selects harness workers"
        )),
    }
}

fn parse_thread_count() -> Result<usize, String> {
    env::var(HARNESS_THREADS_ENV).map_or_else(
        |_| Ok(default_harness_thread_count()),
        |raw| {
            raw.parse::<usize>()
                .map_err(|error| format!("invalid {HARNESS_THREADS_ENV}: {error}"))
                .and_then(|threads| {
                    if threads == 0 {
                        Err(format!("{HARNESS_THREADS_ENV} must be positive"))
                    } else {
                        Ok(threads)
                    }
                })
        },
    )
}

fn parse_assertion_seeds(value: Option<&String>) -> Result<u32, String> {
    value.map_or(Ok(ACCEPTANCE_PLANNER_SEEDS), |raw| {
        raw.parse::<u32>()
            .map_err(|error| format!("invalid assertion seed count: {error}"))
            .and_then(|value| {
                if value == 0 {
                    Err(String::from("assertion seed count must be positive"))
                } else {
                    Ok(value)
                }
            })
    })
}

fn parse_seeds(value: Option<&String>) -> Result<u64, String> {
    value.map_or(Ok(16), |raw| {
        raw.parse::<u64>()
            .map_err(|error| format!("invalid seed count: {error}"))
            .and_then(|value| {
                if value == 0 {
                    Err(String::from("seed count must be positive"))
                } else {
                    Ok(value)
                }
            })
    })
}

fn parse_seed_start(value: Option<&String>, seeds: u64) -> Result<u64, String> {
    let start = value.map_or(Ok(0), |raw| {
        raw.parse::<u64>()
            .map_err(|error| format!("invalid seed start: {error}"))
    })?;
    let end = start
        .checked_add(seeds)
        .ok_or_else(|| String::from("seed range overflows"))?;
    if end > (1_u64 << 60) {
        Err(String::from("seed range must fit below the partition tag"))
    } else {
        Ok(start)
    }
}

const fn partition_seed(partition: SeedPartition, index: u64) -> u64 {
    match partition {
        SeedPartition::Tuning => 0x1000_0000_0000_0000 | index,
        SeedPartition::Holdout => 0x9000_0000_0000_0000 | index,
    }
}
