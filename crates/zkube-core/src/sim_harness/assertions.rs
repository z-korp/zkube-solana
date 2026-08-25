//! Owner-banded design assertions over pinned holdout populations.
//!
//! The ordinary gate deliberately evaluates only bands whose minimum sample
//! fits eight seeds. A skipped band is reported as `not_evaluated`, never as a
//! pass. The acceptance command uses the same evaluators with the full pinned
//! populations and treats an unresolved conditional as `insufficient_events`.

use super::{
    ApexPredicate, CampaignCatalogLevel, DailyCatalogEntry, OracleResult, PlayerModel, RunRecord,
    SeedPartition, TerminalCause, bands, campaign_catalog, daily_catalog, oracle_campaign,
    run_campaign, run_daily,
};
use crate::{Constraint, ConstraintKind, DailyObjective};
use serde::Serialize;
use serde_json::{Value, json};
use std::{collections::HashMap, format, string::String, vec, vec::Vec};

const HOLDOUT: SeedPartition = SeedPartition::Holdout;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EvaluationMode {
    Gate,
    Acceptance,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AssertionStatus {
    Passed,
    Failed,
    InsufficientEvents,
    NotEvaluated,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannerBudgetReport {
    pub iterations: u16,
    pub tree_depth: u8,
    pub rollout_actions: u16,
    pub action_width: u8,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssertionUnit {
    pub unit: String,
    pub samples: u32,
    pub events: Option<u32>,
    pub measurement: Value,
    pub status: AssertionStatus,
    pub passed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssertionResult {
    pub name: String,
    pub scope: String,
    pub band: String,
    pub minimum_samples: u32,
    pub live: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    pub status: AssertionStatus,
    pub passed: Option<bool>,
    pub units: Vec<AssertionUnit>,
    pub failing_units: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssertionReport {
    pub mode: EvaluationMode,
    pub partition: SeedPartition,
    pub seed_start: u64,
    pub planner_seeds: u32,
    pub naive_seeds: u32,
    pub oracle_seeds: u32,
    pub planner_budget: PlannerBudgetReport,
    pub assertions: Vec<AssertionResult>,
    pub live_failures: Vec<String>,
    pub ignored_failures: Vec<String>,
    pub not_evaluated: Vec<String>,
    /// Acceptance means every live assertion passed. Ignored measurements are
    /// still failures in their own records and never become friendly passes.
    pub passed: bool,
}

#[derive(Clone, Copy)]
struct EvaluationConfig {
    mode: EvaluationMode,
    seed_start: u64,
    planner_seeds: u32,
    naive_seeds: u32,
    oracle_seeds: u32,
    planner_model: PlayerModel,
}

impl EvaluationConfig {
    const fn gate() -> Self {
        Self {
            mode: EvaluationMode::Gate,
            seed_start: bands::ASSERTION_SEED_START,
            planner_seeds: bands::GATE_SEEDS,
            naive_seeds: bands::GATE_SEEDS,
            oracle_seeds: bands::GATE_SEEDS,
            planner_model: PlayerModel::PlannerGate,
        }
    }

    const fn acceptance(planner_seeds: u32, seed_start: u64) -> Self {
        Self {
            mode: EvaluationMode::Acceptance,
            seed_start,
            planner_seeds,
            naive_seeds: bands::ACCEPTANCE_NAIVE_SEEDS,
            oracle_seeds: planner_seeds,
            planner_model: PlayerModel::PlannerStrong,
        }
    }

    const fn budget(self) -> bands::PlannerBudget {
        match self.mode {
            EvaluationMode::Gate => bands::PLANNER_GATE,
            EvaluationMode::Acceptance => bands::PLANNER_STRONG,
        }
    }
}

struct Evaluator {
    config: EvaluationConfig,
    campaign: Vec<CampaignCatalogLevel>,
    daily: Vec<DailyCatalogEntry>,
    campaign_records: HashMap<(u16, u8, u8, u64), RunRecord>,
    daily_records: HashMap<(u8, u8, u64), RunRecord>,
    oracle_records: HashMap<(u16, u64), OracleResult>,
}

impl Evaluator {
    fn new(config: EvaluationConfig) -> Self {
        Self {
            config,
            campaign: campaign_catalog(),
            daily: daily_catalog(),
            campaign_records: HashMap::new(),
            daily_records: HashMap::new(),
            oracle_records: HashMap::new(),
        }
    }

    fn campaign_record(
        &mut self,
        level: CampaignCatalogLevel,
        model: PlayerModel,
        offset: u32,
    ) -> Result<RunRecord, String> {
        let seed = sample_seed(self.config.seed_start, offset)?;
        let key = (
            level.catalog_id,
            level.rules.level_difficulty,
            model.tag(),
            seed,
        );
        if let Some(record) = self.campaign_records.get(&key) {
            return Ok(record.clone());
        }
        let record = run_campaign(level, model, HOLDOUT, seed)
            .map_err(|error| format!("Campaign {} failed: {error:?}", level.catalog_id))?;
        self.campaign_records.insert(key, record.clone());
        Ok(record)
    }

    fn daily_record(
        &mut self,
        entry: DailyCatalogEntry,
        model: PlayerModel,
        offset: u32,
    ) -> Result<RunRecord, String> {
        let seed = sample_seed(self.config.seed_start, offset)?;
        let key = (entry.id, model.tag(), seed);
        if let Some(record) = self.daily_records.get(&key) {
            return Ok(record.clone());
        }
        let record = run_daily(entry, model, HOLDOUT, seed)
            .map_err(|error| format!("Daily {} failed: {error:?}", entry.id))?;
        self.daily_records.insert(key, record.clone());
        Ok(record)
    }

    fn oracle_record(
        &mut self,
        level: CampaignCatalogLevel,
        offset: u32,
    ) -> Result<OracleResult, String> {
        let seed = sample_seed(self.config.seed_start, offset)?;
        let key = (level.catalog_id, seed);
        if let Some(result) = self.oracle_records.get(&key) {
            return Ok(*result);
        }
        let result = oracle_campaign(level, HOLDOUT, seed)
            .map_err(|error| format!("Campaign oracle {} failed: {error:?}", level.catalog_id))?;
        self.oracle_records.insert(key, result);
        Ok(result)
    }

    fn evaluate_all(&mut self) -> Result<Vec<AssertionResult>, String> {
        Ok(vec![
            self.constraint_pursuit_gain()?,
            self.first_star_rate()?,
            self.second_star_rate()?,
            self.star_earn_rate()?,
            self.trigger_liveness()?,
            self.tier_step()?,
            self.passive_relevance()?,
            self.board_divergence()?,
            self.theme_policy_sanity()?,
            self.realm_identity(),
            self.kind_variety(),
            self.zone_monotonicity()?,
            self.apex_reachable()?,
            self.apex_luckable()?,
            self.apex_findable()?,
            self.apex_decisive()?,
            self.apex_optional()?,
            self.apex_set_up()?,
            self.reroll_held()?,
            self.reroll_grant()?,
        ])
    }

    #[cfg(test)]
    fn evaluate_named(&mut self, name: &str) -> Result<AssertionResult, String> {
        match name {
            "constraint-pursuit-gain" => self.constraint_pursuit_gain(),
            "first-star-rate" => self.first_star_rate(),
            "second-star-rate" => self.second_star_rate(),
            "star-earn-rate" => self.star_earn_rate(),
            "trigger-liveness" => self.trigger_liveness(),
            "tier-step" => self.tier_step(),
            "passive-relevance" => self.passive_relevance(),
            "board-divergence" => self.board_divergence(),
            "theme-policy-sanity" => self.theme_policy_sanity(),
            "realm-identity" => Ok(self.realm_identity()),
            "kind-variety" => Ok(self.kind_variety()),
            "zone-monotonicity" => self.zone_monotonicity(),
            "apex-reachable" => self.apex_reachable(),
            "apex-luckable" => self.apex_luckable(),
            "apex-findable" => self.apex_findable(),
            "apex-decisive" => self.apex_decisive(),
            "apex-optional" => self.apex_optional(),
            "apex-set-up" => self.apex_set_up(),
            "reroll-held" => self.reroll_held(),
            "reroll-grant" => self.reroll_grant(),
            _ => Err(format!("unknown design assertion {name:?}")),
        }
    }

    fn constraint_pursuit_gain(&mut self) -> Result<AssertionResult, String> {
        let metadata = Metadata::ignored(
            "constraint-pursuit-gain",
            "per constraint pairing",
            "mean stars gain >= 0.3 or >=2-star-rate gain >= 1000 bps",
            bands::ACCEPTANCE_PLANNER_SEEDS,
            "brief 04",
        );
        if let Some(skipped) = self.skip_for_samples(metadata, self.config.planner_seeds) {
            return Ok(skipped);
        }
        let mut groups = HashMap::<(u8, u8), Vec<CampaignCatalogLevel>>::new();
        for level in self.campaign.clone() {
            let pair = (
                constraint_kind_tag(level.rules.level.primary.kind),
                constraint_kind_tag(level.rules.level.secondary.kind),
            );
            if pair != (0, 0) {
                groups.entry(pair).or_default().push(level);
            }
        }
        let mut units = Vec::new();
        for (pair, levels) in groups {
            let mut planner_stars = 0u32;
            let mut floor_stars = 0u32;
            let mut planner_two = 0u32;
            let mut floor_two = 0u32;
            for level in levels.iter().copied() {
                for offset in 0..self.config.planner_seeds {
                    let planner = self.campaign_record(level, self.config.planner_model, offset)?;
                    let floor = self.campaign_record(level, PlayerModel::LineClearer, offset)?;
                    planner_stars = planner_stars.saturating_add(u32::from(planner.earned_stars));
                    floor_stars = floor_stars.saturating_add(u32::from(floor.earned_stars));
                    planner_two = planner_two.saturating_add(u32::from(planner.earned_stars >= 2));
                    floor_two = floor_two.saturating_add(u32::from(floor.earned_stars >= 2));
                }
            }
            let samples = u32::try_from(levels.len())
                .unwrap_or(u32::MAX)
                .saturating_mul(self.config.planner_seeds);
            let mean_gain_milli = signed_rate(planner_stars, floor_stars, samples, 1_000);
            let two_star_gain_bps = signed_rate(planner_two, floor_two, samples, 10_000);
            let passed = mean_gain_milli >= bands::CONSTRAINT_MEAN_STAR_GAIN_MILLI
                || two_star_gain_bps >= bands::CONSTRAINT_TWO_STAR_GAIN_BPS;
            units.push(unit(
                format!("primary-{}-secondary-{}", pair.0, pair.1),
                samples,
                None,
                json!({
                    "meanStarGainMilli": mean_gain_milli,
                    "twoStarRateGainBps": two_star_gain_bps,
                    "levels": levels.len(),
                }),
                passed,
            ));
        }
        Ok(finish(metadata, units))
    }

    fn first_star_rate(&mut self) -> Result<AssertionResult, String> {
        let metadata = Metadata::ignored(
            "first-star-rate",
            "per level",
            "line-clearer success inside the owner-sloped first-star band",
            bands::ACCEPTANCE_PLANNER_SEEDS,
            "brief 05",
        );
        if let Some(skipped) = self.skip_for_samples(metadata, self.config.planner_seeds) {
            return Ok(skipped);
        }
        let levels = self.campaign.clone();
        let mut units = Vec::with_capacity(levels.len());
        for level in levels {
            let hits = self.campaign_hits(
                level,
                PlayerModel::LineClearer,
                self.config.planner_seeds,
                |record| record.earned_stars >= 1,
            )?;
            let rate = rate_bps(hits, self.config.planner_seeds);
            let (minimum, maximum) = sloped_band(
                level.level_id,
                bands::FIRST_STAR_START_MIN_BPS,
                bands::FIRST_STAR_START_MAX_BPS,
                bands::FIRST_STAR_END_MIN_BPS,
                bands::FIRST_STAR_END_MAX_BPS,
            );
            units.push(rate_unit(
                level_label(level),
                self.config.planner_seeds,
                rate,
                minimum,
                maximum,
            ));
        }
        Ok(finish(metadata, units))
    }

    fn second_star_rate(&mut self) -> Result<AssertionResult, String> {
        self.star_rate(
            Metadata::ignored(
                "second-star-rate",
                "per level",
                "planner >=2-star rate inside the owner-sloped second-star band",
                bands::ACCEPTANCE_PLANNER_SEEDS,
                "brief 05",
            ),
            2,
            (
                bands::SECOND_STAR_START_MIN_BPS,
                bands::SECOND_STAR_START_MAX_BPS,
                bands::SECOND_STAR_END_MIN_BPS,
                bands::SECOND_STAR_END_MAX_BPS,
            ),
        )
    }

    fn star_earn_rate(&mut self) -> Result<AssertionResult, String> {
        self.star_rate(
            Metadata::ignored(
                "star-earn-rate",
                "per level",
                "planner >=3-star rate inside the owner-sloped third-star band",
                bands::ACCEPTANCE_PLANNER_SEEDS,
                "brief 05",
            ),
            3,
            (
                bands::THIRD_STAR_START_MIN_BPS,
                bands::THIRD_STAR_START_MAX_BPS,
                bands::THIRD_STAR_END_MIN_BPS,
                bands::THIRD_STAR_END_MAX_BPS,
            ),
        )
    }

    fn star_rate(
        &mut self,
        metadata: Metadata,
        stars: u8,
        endpoints: (u32, u32, u32, u32),
    ) -> Result<AssertionResult, String> {
        if let Some(skipped) = self.skip_for_samples(metadata, self.config.planner_seeds) {
            return Ok(skipped);
        }
        let levels = self.campaign.clone();
        let mut units = Vec::with_capacity(levels.len());
        for level in levels {
            let hits = self.campaign_hits(
                level,
                self.config.planner_model,
                self.config.planner_seeds,
                |record| record.earned_stars >= stars,
            )?;
            let rate = rate_bps(hits, self.config.planner_seeds);
            let (minimum, maximum) = sloped_band(
                level.level_id,
                endpoints.0,
                endpoints.1,
                endpoints.2,
                endpoints.3,
            );
            units.push(rate_unit(
                level_label(level),
                self.config.planner_seeds,
                rate,
                minimum,
                maximum,
            ));
        }
        Ok(finish(metadata, units))
    }

    fn trigger_liveness(&mut self) -> Result<AssertionResult, String> {
        let metadata = Metadata::ignored(
            "trigger-liveness",
            "per realm, both modes",
            "trigger fires in 3000..=8000 bps of runs",
            bands::GATE_SEEDS,
            "brief 05",
        );
        if let Some(skipped) = self.skip_for_samples(metadata, self.config.planner_seeds) {
            return Ok(skipped);
        }
        let levels = self.campaign.clone();
        let dailies = self.daily.clone();
        let mut units = Vec::with_capacity(20);
        for realm in 1..=10u8 {
            let realm_levels = levels
                .iter()
                .copied()
                .filter(|level| level.map_id == realm)
                .collect::<Vec<_>>();
            let mut fired = 0u32;
            for level in realm_levels.iter().copied() {
                fired = fired.saturating_add(self.campaign_hits(
                    level,
                    self.config.planner_model,
                    self.config.planner_seeds,
                    |record| !record.bonus_charge_earned_events.is_empty(),
                )?);
            }
            let samples = self
                .config
                .planner_seeds
                .saturating_mul(u32::try_from(realm_levels.len()).unwrap_or(u32::MAX));
            units.push(rate_unit(
                format!("campaign-realm-{realm}"),
                samples,
                rate_bps(fired, samples),
                bands::TRIGGER_LIVENESS_MIN_BPS,
                bands::TRIGGER_LIVENESS_MAX_BPS,
            ));
        }
        for entry in dailies {
            let fired = self.daily_hits(
                entry,
                self.config.planner_model,
                self.config.planner_seeds,
                |record| !record.bonus_charge_earned_events.is_empty(),
            )?;
            units.push(rate_unit(
                format!("daily-realm-{}", entry.id),
                self.config.planner_seeds,
                rate_bps(fired, self.config.planner_seeds),
                bands::TRIGGER_LIVENESS_MIN_BPS,
                bands::TRIGGER_LIVENESS_MAX_BPS,
            ));
        }
        Ok(finish(metadata, units))
    }

    fn tier_step(&mut self) -> Result<AssertionResult, String> {
        let metadata = Metadata::ignored(
            "tier-step",
            "per level with tier N < 7",
            "tier N+1 lowers success by 500..=1500 bps",
            bands::ACCEPTANCE_PLANNER_SEEDS,
            "brief 05",
        );
        if let Some(skipped) = self.skip_for_samples(metadata, self.config.planner_seeds) {
            return Ok(skipped);
        }
        let levels = self.campaign.clone();
        let mut units = Vec::new();
        for level in levels
            .into_iter()
            .filter(|level| level.rules.level_difficulty < 7)
        {
            let mut raised = level;
            raised.rules.level_difficulty = raised.rules.level_difficulty.saturating_add(1);
            let base = self.campaign_hits(
                level,
                self.config.planner_model,
                self.config.planner_seeds,
                success,
            )?;
            let harder = self.campaign_hits(
                raised,
                self.config.planner_model,
                self.config.planner_seeds,
                success,
            )?;
            let drop_bps = signed_rate(base, harder, self.config.planner_seeds, 10_000);
            let passed =
                (bands::TIER_STEP_MIN_DROP_BPS..=bands::TIER_STEP_MAX_DROP_BPS).contains(&drop_bps);
            units.push(unit(
                level_label(level),
                self.config.planner_seeds,
                None,
                json!({
                    "baseTier": level.rules.level_difficulty,
                    "raisedTier": raised.rules.level_difficulty,
                    "baseSuccessRateBps": rate_bps(base, self.config.planner_seeds),
                    "raisedSuccessRateBps": rate_bps(harder, self.config.planner_seeds),
                    "dropBps": drop_bps,
                }),
                passed,
            ));
        }
        Ok(finish(metadata, units))
    }

    fn passive_relevance(&mut self) -> Result<AssertionResult, String> {
        let metadata = Metadata::ignored(
            "passive-relevance",
            "per Campaign realm with combo multiplier >= 2",
            "combo-valued planner mean-star gain >= 0.3",
            bands::ACCEPTANCE_PLANNER_SEEDS,
            "brief 05",
        );
        if let Some(skipped) = self.skip_for_samples(metadata, self.config.planner_seeds) {
            return Ok(skipped);
        }
        let levels = self.campaign.clone();
        let mut units = Vec::new();
        for realm in 1..=10u8 {
            let realm_levels = levels
                .iter()
                .copied()
                .filter(|level| {
                    level.map_id == realm && level.rules.mutator.combo_multiplier_x100 >= 200
                })
                .collect::<Vec<_>>();
            if realm_levels.is_empty() {
                continue;
            }
            let mut combo_stars = 0u32;
            let mut plain_stars = 0u32;
            for level in realm_levels.iter().copied() {
                for offset in 0..self.config.planner_seeds {
                    combo_stars = combo_stars.saturating_add(u32::from(
                        self.campaign_record(level, PlayerModel::PlannerStrongCombo, offset)?
                            .earned_stars,
                    ));
                    plain_stars = plain_stars.saturating_add(u32::from(
                        self.campaign_record(level, self.config.planner_model, offset)?
                            .earned_stars,
                    ));
                }
            }
            let samples = self
                .config
                .planner_seeds
                .saturating_mul(u32::try_from(realm_levels.len()).unwrap_or(u32::MAX));
            let gain = signed_rate(combo_stars, plain_stars, samples, 1_000);
            units.push(unit(
                format!("campaign-realm-{realm}"),
                samples,
                None,
                json!({"meanStarGainMilli": gain}),
                gain >= bands::PASSIVE_MEAN_STAR_GAIN_MILLI,
            ));
        }
        Ok(finish(metadata, units))
    }

    fn board_divergence(&mut self) -> Result<AssertionResult, String> {
        let metadata = Metadata::ignored(
            "board-divergence",
            "per non-Classic Daily entry",
            "pooled Score/Theme Spearman rho <= 0.600",
            bands::ACCEPTANCE_PLANNER_SEEDS,
            "brief 05",
        );
        if let Some(skipped) = self.skip_for_samples(metadata, self.config.planner_seeds) {
            return Ok(skipped);
        }
        let entries = self.daily.clone();
        let mut units = Vec::new();
        for entry in entries
            .into_iter()
            .filter(|entry| entry.rules.objective.objective != DailyObjective::Classic)
        {
            let mut score = Vec::new();
            let mut theme = Vec::new();
            for model in [
                self.config.planner_model,
                PlayerModel::PlannerStrongTheme,
                PlayerModel::LineClearer,
            ] {
                for offset in 0..self.config.planner_seeds {
                    let record = self.daily_record(entry, model, offset)?;
                    score.push(u64::from(record.daily_score));
                    theme.push(record.objective_total);
                }
            }
            let rho_milli = spearman_rho_milli(&score, &theme);
            units.push(unit(
                format!("daily-entry-{}", entry.id),
                u32::try_from(score.len()).unwrap_or(u32::MAX),
                None,
                json!({"spearmanRhoMilli": rho_milli}),
                rho_milli <= bands::BOARD_DIVERGENCE_MAX_RHO_MILLI,
            ));
        }
        Ok(finish(metadata, units))
    }

    fn theme_policy_sanity(&mut self) -> Result<AssertionResult, String> {
        let metadata = Metadata::live(
            "theme-policy-sanity",
            "per non-Classic Daily entry",
            "one-ply Theme qualification >= 9000 bps",
            bands::GATE_SEEDS,
        );
        if let Some(skipped) = self.skip_for_samples(metadata, self.config.planner_seeds) {
            return Ok(skipped);
        }
        let entries = self.daily.clone();
        let mut units = Vec::new();
        for entry in entries
            .into_iter()
            .filter(|entry| entry.rules.objective.objective != DailyObjective::Classic)
        {
            let hits = self.daily_hits(
                entry,
                PlayerModel::Theme,
                self.config.planner_seeds,
                |record| record.objective_total > 0,
            )?;
            let rate = rate_bps(hits, self.config.planner_seeds);
            units.push(unit(
                format!("daily-entry-{}", entry.id),
                self.config.planner_seeds,
                None,
                json!({"qualificationRateBps": rate}),
                rate >= bands::THEME_POLICY_MIN_BPS,
            ));
        }
        Ok(finish(metadata, units))
    }

    fn realm_identity(&self) -> AssertionResult {
        let metadata = Metadata::live(
            "realm-identity",
            "catalog",
            "no realm pair shares more than 5 of 9 pre-guardian tuples",
            0,
        );
        let mut units = Vec::new();
        for left in 1..=10u8 {
            for right in left + 1..=10u8 {
                let left_levels = realm_levels(&self.campaign, left);
                let right_levels = realm_levels(&self.campaign, right);
                let shared = left_levels
                    .iter()
                    .zip(right_levels.iter())
                    .take(bands::REALM_IDENTITY_TUPLES)
                    .filter(|(left, right)| level_tuple(left) == level_tuple(right))
                    .count();
                units.push(unit(
                    format!("realms-{left}-{right}"),
                    0,
                    None,
                    json!({"sharedTuples": shared, "comparedTuples": bands::REALM_IDENTITY_TUPLES}),
                    shared
                        <= usize::try_from(bands::REALM_IDENTITY_MAX_SHARED_TUPLES)
                            .unwrap_or(usize::MAX),
                ));
            }
        }
        finish(metadata, units)
    }

    fn kind_variety(&self) -> AssertionResult {
        let metadata = Metadata::ignored(
            "kind-variety",
            "per realm (catalog)",
            ">=4 distinct kinds per slot; max run 2; primary cumulative; secondary moment",
            0,
            "brief 04",
        );
        let mut units = Vec::new();
        for realm in 1..=10u8 {
            let levels = realm_levels(&self.campaign, realm);
            let primary = levels
                .iter()
                .map(|level| level.rules.level.primary)
                .collect::<Vec<_>>();
            let secondary = levels
                .iter()
                .map(|level| level.rules.level.secondary)
                .collect::<Vec<_>>();
            let primary_distinct = distinct_non_none(&primary);
            let secondary_distinct = distinct_non_none(&secondary);
            let primary_run = max_kind_run(&primary);
            let secondary_run = max_kind_run(&secondary);
            let primary_classes = primary
                .iter()
                .all(|constraint| is_none(*constraint) || is_cumulative(constraint.kind));
            let secondary_classes = secondary
                .iter()
                .all(|constraint| is_none(*constraint) || is_moment(constraint.kind));
            let passed = primary_distinct >= bands::KIND_VARIETY_MIN_DISTINCT
                && secondary_distinct >= bands::KIND_VARIETY_MIN_DISTINCT
                && primary_run <= bands::KIND_VARIETY_MAX_CONSECUTIVE
                && secondary_run <= bands::KIND_VARIETY_MAX_CONSECUTIVE
                && primary_classes
                && secondary_classes;
            units.push(unit(
                format!("realm-{realm}"),
                0,
                None,
                json!({
                    "primaryDistinctKinds": primary_distinct,
                    "secondaryDistinctKinds": secondary_distinct,
                    "primaryMaxConsecutive": primary_run,
                    "secondaryMaxConsecutive": secondary_run,
                    "primaryClassValid": primary_classes,
                    "secondaryClassValid": secondary_classes,
                }),
                passed,
            ));
        }
        finish(metadata, units)
    }

    fn zone_monotonicity(&mut self) -> Result<AssertionResult, String> {
        let metadata = Metadata::ignored(
            "zone-monotonicity",
            "per zone",
            "no adjacent planner success-rate rise exceeds 1000 bps",
            bands::ACCEPTANCE_PLANNER_SEEDS,
            "brief 05",
        );
        if let Some(skipped) = self.skip_for_samples(metadata, self.config.planner_seeds) {
            return Ok(skipped);
        }
        let levels = self.campaign.clone();
        let mut units = Vec::new();
        for realm in 1..=10u8 {
            let realm_levels = realm_levels(&levels, realm);
            let mut rates = Vec::with_capacity(10);
            for level in realm_levels.iter().copied() {
                let hits = self.campaign_hits(
                    level,
                    self.config.planner_model,
                    self.config.planner_seeds,
                    success,
                )?;
                rates.push(rate_bps(hits, self.config.planner_seeds));
            }
            let rises = rates
                .windows(2)
                .map(|pair| i64::from(pair[1]) - i64::from(pair[0]))
                .map(|rise| i32::try_from(rise).unwrap_or(i32::MAX))
                .collect::<Vec<_>>();
            let maximum = rises.iter().copied().max().unwrap_or(0);
            units.push(unit(
                format!("zone-{realm}"),
                self.config.planner_seeds,
                None,
                json!({"successRatesBps": rates, "adjacentRisesBps": rises, "maximumRiseBps": maximum}),
                maximum <= bands::ZONE_MONOTONICITY_MAX_RISE_BPS,
            ));
        }
        Ok(finish(metadata, units))
    }

    fn apex_reachable(&mut self) -> Result<AssertionResult, String> {
        let metadata = Metadata::ignored(
            "apex-reachable",
            "per level with a secondary",
            "oracle apex reachability >= 6000 bps",
            bands::ACCEPTANCE_PLANNER_SEEDS,
            "brief 05",
        );
        if let Some(skipped) = self.skip_for_samples(metadata, self.config.oracle_seeds) {
            return Ok(skipped);
        }
        let levels = self.apex_levels();
        let mut units = Vec::with_capacity(levels.len());
        for level in levels {
            let mut reachable = 0u32;
            let mut caps = 0u32;
            for offset in 0..self.config.oracle_seeds {
                let result = self.oracle_record(level, offset)?;
                reachable = reachable.saturating_add(u32::from(result.reachability.apex_reachable));
                caps = caps.saturating_add(u32::from(result.node_cap_hit));
            }
            let rate = rate_bps(reachable, self.config.oracle_seeds);
            units.push(unit(
                level_label(level),
                self.config.oracle_seeds,
                None,
                json!({"reachableRateBps": rate, "nodeCapHits": caps}),
                rate >= bands::APEX_REACHABLE_MIN_BPS,
            ));
        }
        Ok(finish(metadata, units))
    }

    fn apex_luckable(&mut self) -> Result<AssertionResult, String> {
        let metadata = Metadata::ignored(
            "apex-luckable",
            "per level with a secondary",
            "naive apex-hit rate inside the owner-sloped luck band",
            bands::ACCEPTANCE_NAIVE_SEEDS,
            "brief 05",
        );
        if let Some(skipped) = self.skip_for_samples(metadata, self.config.naive_seeds) {
            return Ok(skipped);
        }
        let levels = self.apex_levels();
        let mut units = Vec::with_capacity(levels.len());
        for level in levels {
            let hits = self.campaign_hits(
                level,
                PlayerModel::Naive,
                self.config.naive_seeds,
                |record| record.apex_hit_action.is_some(),
            )?;
            let rate = rate_bps(hits, self.config.naive_seeds);
            let (minimum, maximum) = sloped_band(
                level.level_id,
                bands::APEX_LUCKABLE_START_MIN_BPS,
                bands::APEX_LUCKABLE_START_MAX_BPS,
                bands::APEX_LUCKABLE_END_MIN_BPS,
                bands::APEX_LUCKABLE_END_MAX_BPS,
            );
            units.push(rate_unit(
                level_label(level),
                self.config.naive_seeds,
                rate,
                minimum,
                maximum,
            ));
        }
        Ok(finish(metadata, units))
    }

    fn apex_findable(&mut self) -> Result<AssertionResult, String> {
        let metadata = Metadata::ignored(
            "apex-findable",
            "per level with a secondary",
            "planner apex-hit rate inside the owner-sloped third-star band",
            bands::ACCEPTANCE_PLANNER_SEEDS,
            "brief 05",
        );
        if let Some(skipped) = self.skip_for_samples(metadata, self.config.planner_seeds) {
            return Ok(skipped);
        }
        let levels = self.apex_levels();
        let mut units = Vec::with_capacity(levels.len());
        for level in levels {
            let hits = self.campaign_hits(
                level,
                self.config.planner_model,
                self.config.planner_seeds,
                |record| record.apex_hit_action.is_some(),
            )?;
            let rate = rate_bps(hits, self.config.planner_seeds);
            let (minimum, maximum) = sloped_band(
                level.level_id,
                bands::THIRD_STAR_START_MIN_BPS,
                bands::THIRD_STAR_START_MAX_BPS,
                bands::THIRD_STAR_END_MIN_BPS,
                bands::THIRD_STAR_END_MAX_BPS,
            );
            units.push(rate_unit(
                level_label(level),
                self.config.planner_seeds,
                rate,
                minimum,
                maximum,
            ));
        }
        Ok(finish(metadata, units))
    }

    fn apex_decisive(&mut self) -> Result<AssertionResult, String> {
        let metadata = Metadata::ignored(
            "apex-decisive",
            "per level with a secondary",
            ">=9000 bps of planner apex hits are terminal; >=10 hits",
            bands::ACCEPTANCE_PLANNER_SEEDS,
            "brief 05",
        );
        if let Some(skipped) = self.skip_for_samples(metadata, self.config.planner_seeds) {
            return Ok(skipped);
        }
        let levels = self.apex_levels();
        let mut units = Vec::with_capacity(levels.len());
        for level in levels {
            let records = self.campaign_records_for(
                level,
                self.config.planner_model,
                self.config.planner_seeds,
            )?;
            let hits = records
                .iter()
                .filter(|record| record.apex_hit_action.is_some())
                .count_u32();
            let decisive = records
                .iter()
                .filter(|record| {
                    record.apex_hit_action.is_some()
                        && record.apex_hit_action == record.terminal_action
                })
                .count_u32();
            units.push(conditional_rate_unit(
                level_label(level),
                self.config.planner_seeds,
                decisive,
                hits,
                bands::APEX_HIT_MIN_EVENTS,
                bands::APEX_DECISIVE_MIN_BPS,
                None,
            ));
        }
        Ok(finish(metadata, units))
    }

    fn apex_optional(&mut self) -> Result<AssertionResult, String> {
        let metadata = Metadata::ignored(
            "apex-optional",
            "per level with a secondary",
            "planner success without apex >=5000 bps; >=10 no-hit runs",
            bands::ACCEPTANCE_PLANNER_SEEDS,
            "brief 05",
        );
        if let Some(skipped) = self.skip_for_samples(metadata, self.config.planner_seeds) {
            return Ok(skipped);
        }
        let levels = self.apex_levels();
        let mut units = Vec::with_capacity(levels.len());
        for level in levels {
            let records = self.campaign_records_for(
                level,
                self.config.planner_model,
                self.config.planner_seeds,
            )?;
            let no_hit = records
                .iter()
                .filter(|record| record.apex_hit_action.is_none())
                .count_u32();
            let successes = records
                .iter()
                .filter(|record| record.apex_hit_action.is_none() && success(record))
                .count_u32();
            units.push(conditional_rate_unit(
                level_label(level),
                self.config.planner_seeds,
                successes,
                no_hit,
                bands::APEX_OPTIONAL_MIN_EVENTS,
                bands::APEX_OPTIONAL_MIN_BPS,
                None,
            ));
        }
        Ok(finish(metadata, units))
    }

    fn apex_set_up(&mut self) -> Result<AssertionResult, String> {
        let metadata = Metadata::ignored(
            "apex-set-up",
            "per level with a secondary",
            ">=6000 bps of hits have a guardian charge 0..=5 actions earlier; >=10 hits",
            bands::ACCEPTANCE_PLANNER_SEEDS,
            "brief 05",
        );
        if let Some(skipped) = self.skip_for_samples(metadata, self.config.planner_seeds) {
            return Ok(skipped);
        }
        let levels = self.apex_levels();
        let mut units = Vec::with_capacity(levels.len());
        for level in levels {
            let records = self.campaign_records_for(
                level,
                self.config.planner_model,
                self.config.planner_seeds,
            )?;
            let hits = records
                .iter()
                .filter(|record| record.apex_hit_action.is_some())
                .count_u32();
            let set_up = records
                .iter()
                .filter(|record| {
                    record
                        .apex_hit_action
                        .is_some_and(|hit| apex_hit_has_recent_charge(record, hit))
                })
                .count_u32();
            units.push(conditional_rate_unit(
                level_label(level),
                self.config.planner_seeds,
                set_up,
                hits,
                bands::APEX_HIT_MIN_EVENTS,
                bands::APEX_SETUP_MIN_BPS,
                None,
            ));
        }
        Ok(finish(metadata, units))
    }

    fn reroll_held(&mut self) -> Result<AssertionResult, String> {
        let metadata = Metadata::ignored(
            "reroll-held",
            "both modes",
            "median reroll spend height >=6; >=20 spends",
            bands::ACCEPTANCE_PLANNER_SEEDS,
            "brief 04",
        );
        if let Some(skipped) = self.skip_for_samples(metadata, self.config.planner_seeds) {
            return Ok(skipped);
        }
        let campaign = self.campaign.clone();
        let daily = self.daily.clone();
        let mut units = Vec::new();
        let mut campaign_heights = Vec::new();
        for level in campaign {
            for offset in 0..self.config.planner_seeds {
                let record = self.campaign_record(level, self.config.planner_model, offset)?;
                campaign_heights.extend(record.reroll_spent_events.iter().flat_map(|event| {
                    std::iter::repeat_n(event.board_height, usize::from(event.count))
                }));
            }
        }
        units.push(median_height_unit(
            "campaign",
            self.config.planner_seeds.saturating_mul(100),
            campaign_heights,
        ));
        let mut daily_heights = Vec::new();
        for entry in daily {
            for offset in 0..self.config.planner_seeds {
                let record = self.daily_record(entry, self.config.planner_model, offset)?;
                daily_heights.extend(record.reroll_spent_events.iter().flat_map(|event| {
                    std::iter::repeat_n(event.board_height, usize::from(event.count))
                }));
            }
        }
        units.push(median_height_unit(
            "daily",
            self.config.planner_seeds.saturating_mul(10),
            daily_heights,
        ));
        Ok(finish(metadata, units))
    }

    fn reroll_grant(&mut self) -> Result<AssertionResult, String> {
        let metadata = Metadata::ignored(
            "reroll-grant",
            "per mode",
            "grant in 1000..=4000 bps of runs; discarded share <=1000 bps",
            bands::ACCEPTANCE_PLANNER_SEEDS,
            "brief 04",
        );
        if let Some(skipped) = self.skip_for_samples(metadata, self.config.planner_seeds) {
            return Ok(skipped);
        }
        let campaign = self.campaign.clone();
        let daily = self.daily.clone();
        let mut campaign_records = Vec::new();
        for level in campaign {
            campaign_records.extend(self.campaign_records_for(
                level,
                self.config.planner_model,
                self.config.planner_seeds,
            )?);
        }
        let mut daily_records = Vec::new();
        for entry in daily {
            for offset in 0..self.config.planner_seeds {
                daily_records.push(self.daily_record(entry, self.config.planner_model, offset)?);
            }
        }
        Ok(finish(
            metadata,
            vec![
                reroll_grant_unit("campaign", &campaign_records),
                reroll_grant_unit("daily", &daily_records),
            ],
        ))
    }

    fn campaign_hits(
        &mut self,
        level: CampaignCatalogLevel,
        model: PlayerModel,
        seeds: u32,
        predicate: impl Fn(&RunRecord) -> bool,
    ) -> Result<u32, String> {
        let mut hits = 0u32;
        for offset in 0..seeds {
            hits = hits.saturating_add(u32::from(predicate(
                &self.campaign_record(level, model, offset)?,
            )));
        }
        Ok(hits)
    }

    fn daily_hits(
        &mut self,
        entry: DailyCatalogEntry,
        model: PlayerModel,
        seeds: u32,
        predicate: impl Fn(&RunRecord) -> bool,
    ) -> Result<u32, String> {
        let mut hits = 0u32;
        for offset in 0..seeds {
            hits = hits.saturating_add(u32::from(predicate(
                &self.daily_record(entry, model, offset)?,
            )));
        }
        Ok(hits)
    }

    fn campaign_records_for(
        &mut self,
        level: CampaignCatalogLevel,
        model: PlayerModel,
        seeds: u32,
    ) -> Result<Vec<RunRecord>, String> {
        (0..seeds)
            .map(|offset| self.campaign_record(level, model, offset))
            .collect()
    }

    fn apex_levels(&self) -> Vec<CampaignCatalogLevel> {
        self.campaign
            .iter()
            .copied()
            .filter(|level| !matches!(level.apex, ApexPredicate::None))
            .collect()
    }

    fn skip_for_samples(&self, metadata: Metadata, available: u32) -> Option<AssertionResult> {
        (available < metadata.minimum_samples).then(|| match self.config.mode {
            EvaluationMode::Gate => not_evaluated(metadata, available),
            EvaluationMode::Acceptance => insufficient_samples(metadata, available),
        })
    }
}

#[derive(Clone, Copy)]
struct Metadata {
    name: &'static str,
    scope: &'static str,
    band: &'static str,
    minimum_samples: u32,
    live: bool,
    owner: Option<&'static str>,
}

impl Metadata {
    const fn live(
        name: &'static str,
        scope: &'static str,
        band: &'static str,
        minimum_samples: u32,
    ) -> Self {
        Self {
            name,
            scope,
            band,
            minimum_samples,
            live: true,
            owner: None,
        }
    }

    const fn ignored(
        name: &'static str,
        scope: &'static str,
        band: &'static str,
        minimum_samples: u32,
        owner: &'static str,
    ) -> Self {
        Self {
            name,
            scope,
            band,
            minimum_samples,
            live: false,
            owner: Some(owner),
        }
    }
}

/// Evaluate the fast eight-seed gate population.
///
/// # Errors
///
/// Returns a deterministic simulation or serialization-independent evaluator
/// error. Band failures are data in the returned report.
pub fn gate_report() -> Result<AssertionReport, String> {
    report(EvaluationConfig::gate())
}

/// Evaluate the full holdout population. Planner and oracle use `seeds`; the
/// naive luck population remains pinned to 100 for one-point resolution.
///
/// # Errors
///
/// Returns a deterministic simulation error. Too few requested seeds are
/// reported as `insufficient_events` instead of silently widening a sample.
pub fn acceptance_report(seeds: u32, seed_start: u64) -> Result<AssertionReport, String> {
    report(EvaluationConfig::acceptance(seeds, seed_start))
}

fn report(config: EvaluationConfig) -> Result<AssertionReport, String> {
    let mut evaluator = Evaluator::new(config);
    let assertions = evaluator.evaluate_all()?;
    let live_failures = assertions
        .iter()
        .filter(|assertion| assertion.live && assertion.passed != Some(true))
        .map(|assertion| assertion.name.clone())
        .collect::<Vec<_>>();
    let ignored_failures = assertions
        .iter()
        .filter(|assertion| !assertion.live && assertion.passed == Some(false))
        .map(|assertion| assertion.name.clone())
        .collect::<Vec<_>>();
    let not_evaluated = assertions
        .iter()
        .filter(|assertion| assertion.status == AssertionStatus::NotEvaluated)
        .map(|assertion| assertion.name.clone())
        .collect::<Vec<_>>();
    let budget = config.budget();
    Ok(AssertionReport {
        mode: config.mode,
        partition: HOLDOUT,
        seed_start: config.seed_start,
        planner_seeds: config.planner_seeds,
        naive_seeds: config.naive_seeds,
        oracle_seeds: config.oracle_seeds,
        planner_budget: PlannerBudgetReport {
            iterations: budget.iterations,
            tree_depth: budget.tree_depth,
            rollout_actions: budget.rollout_actions,
            action_width: budget.action_width,
        },
        passed: live_failures.is_empty(),
        assertions,
        live_failures,
        ignored_failures,
        not_evaluated,
    })
}

fn finish(metadata: Metadata, units: Vec<AssertionUnit>) -> AssertionResult {
    let insufficient = units
        .iter()
        .any(|unit| unit.status == AssertionStatus::InsufficientEvents);
    let failed = units
        .iter()
        .any(|unit| unit.status == AssertionStatus::Failed);
    let status = if insufficient {
        AssertionStatus::InsufficientEvents
    } else if failed {
        AssertionStatus::Failed
    } else {
        AssertionStatus::Passed
    };
    let passed = Some(status == AssertionStatus::Passed);
    let failing_units = units
        .iter()
        .filter(|unit| unit.passed != Some(true))
        .map(|unit| unit.unit.clone())
        .collect();
    AssertionResult {
        name: String::from(metadata.name),
        scope: String::from(metadata.scope),
        band: String::from(metadata.band),
        minimum_samples: metadata.minimum_samples,
        live: metadata.live,
        owner: metadata.owner.map(String::from),
        status,
        passed,
        units,
        failing_units,
    }
}

fn not_evaluated(metadata: Metadata, available: u32) -> AssertionResult {
    AssertionResult {
        name: String::from(metadata.name),
        scope: String::from(metadata.scope),
        band: String::from(metadata.band),
        minimum_samples: metadata.minimum_samples,
        live: metadata.live,
        owner: metadata.owner.map(String::from),
        status: AssertionStatus::NotEvaluated,
        passed: None,
        units: vec![AssertionUnit {
            unit: String::from("population"),
            samples: available,
            events: None,
            measurement: json!({"requiredSeeds": metadata.minimum_samples}),
            status: AssertionStatus::NotEvaluated,
            passed: None,
            detail: Some(String::from("not evaluated in gate (min_samples)")),
        }],
        failing_units: Vec::new(),
    }
}

fn insufficient_samples(metadata: Metadata, available: u32) -> AssertionResult {
    finish(
        metadata,
        vec![AssertionUnit {
            unit: String::from("population"),
            samples: available,
            events: None,
            measurement: json!({"requiredSeeds": metadata.minimum_samples}),
            status: AssertionStatus::InsufficientEvents,
            passed: Some(false),
            detail: Some(String::from("insufficient_events (min_samples)")),
        }],
    )
}

fn unit(
    name: String,
    samples: u32,
    events: Option<u32>,
    measurement: Value,
    passed: bool,
) -> AssertionUnit {
    AssertionUnit {
        unit: name,
        samples,
        events,
        measurement,
        status: if passed {
            AssertionStatus::Passed
        } else {
            AssertionStatus::Failed
        },
        passed: Some(passed),
        detail: None,
    }
}

fn rate_unit(name: String, samples: u32, rate: u32, minimum: u32, maximum: u32) -> AssertionUnit {
    unit(
        name,
        samples,
        None,
        json!({"rateBps": rate, "minimumBps": minimum, "maximumBps": maximum}),
        (minimum..=maximum).contains(&rate),
    )
}

fn conditional_rate_unit(
    name: String,
    samples: u32,
    hits: u32,
    events: u32,
    minimum_events: u32,
    minimum_bps: u32,
    maximum_bps: Option<u32>,
) -> AssertionUnit {
    if events < minimum_events {
        return AssertionUnit {
            unit: name,
            samples,
            events: Some(events),
            measurement: json!({"hits": hits, "minimumEvents": minimum_events}),
            status: AssertionStatus::InsufficientEvents,
            passed: Some(false),
            detail: Some(String::from("insufficient_events")),
        };
    }
    let rate = rate_bps(hits, events);
    let passed = rate >= minimum_bps && maximum_bps.is_none_or(|maximum| rate <= maximum);
    unit(
        name,
        samples,
        Some(events),
        json!({"hits": hits, "rateBps": rate, "minimumBps": minimum_bps, "maximumBps": maximum_bps}),
        passed,
    )
}

fn median_height_unit(name: &str, samples: u32, mut heights: Vec<u8>) -> AssertionUnit {
    heights.sort_unstable();
    let events = u32::try_from(heights.len()).unwrap_or(u32::MAX);
    if events < bands::REROLL_HELD_MIN_EVENTS {
        return AssertionUnit {
            unit: String::from(name),
            samples,
            events: Some(events),
            measurement: json!({"minimumEvents": bands::REROLL_HELD_MIN_EVENTS}),
            status: AssertionStatus::InsufficientEvents,
            passed: Some(false),
            detail: Some(String::from("insufficient_events")),
        };
    }
    let median = heights[heights.len() / 2];
    unit(
        String::from(name),
        samples,
        Some(events),
        json!({"medianSpendHeight": median}),
        median >= bands::REROLL_HELD_MIN_HEIGHT,
    )
}

fn reroll_grant_unit(name: &str, records: &[RunRecord]) -> AssertionUnit {
    let stalls = records
        .iter()
        .filter(|record| record.terminal_cause == TerminalCause::EngineStall)
        .count_u32();
    let successful = records.len_u32().saturating_sub(stalls);
    let granted_runs = records
        .iter()
        .filter(|record| {
            record.terminal_cause != TerminalCause::EngineStall
                && !record.reroll_granted_events.is_empty()
        })
        .count_u32();
    let grants = records
        .iter()
        .filter(|record| record.terminal_cause != TerminalCause::EngineStall)
        .flat_map(|record| record.reroll_granted_events.iter())
        .map(|event| u32::from(event.count))
        .sum::<u32>();
    let discarded = records
        .iter()
        .filter(|record| record.terminal_cause != TerminalCause::EngineStall)
        .flat_map(|record| record.reroll_grant_discarded_events.iter())
        .map(|event| u32::from(event.count))
        .sum::<u32>();
    if successful == 0 || grants == 0 {
        return AssertionUnit {
            unit: String::from(name),
            samples: successful,
            events: Some(grants),
            measurement: json!({"engineStalls": stalls, "grantRuns": granted_runs, "grants": grants, "discardedGrants": discarded}),
            status: AssertionStatus::InsufficientEvents,
            passed: Some(false),
            detail: Some(String::from("insufficient_events")),
        };
    }
    let grant_rate = rate_bps(granted_runs, successful);
    let discard_rate = rate_bps(discarded, grants);
    unit(
        String::from(name),
        successful,
        Some(grants),
        json!({
            "engineStalls": stalls,
            "grantRuns": granted_runs,
            "grantRateBps": grant_rate,
            "grants": grants,
            "discardedGrants": discarded,
            "discardRateBps": discard_rate,
        }),
        (bands::REROLL_GRANT_MIN_BPS..=bands::REROLL_GRANT_MAX_BPS).contains(&grant_rate)
            && discard_rate <= bands::REROLL_GRANT_MAX_DISCARD_BPS,
    )
}

fn success(record: &RunRecord) -> bool {
    record.earned_stars > 0
}

fn sample_seed(start: u64, offset: u32) -> Result<u64, String> {
    let index = start
        .checked_add(u64::from(offset))
        .ok_or_else(|| String::from("assertion seed range overflow"))?;
    if index >= 1u64 << 60 {
        return Err(String::from("assertion seed index reaches partition tag"));
    }
    Ok(0x9000_0000_0000_0000 | index)
}

fn rate_bps(hits: u32, samples: u32) -> u32 {
    if samples == 0 {
        return 0;
    }
    u32::try_from(u64::from(hits).saturating_mul(10_000) / u64::from(samples)).unwrap_or(u32::MAX)
}

fn signed_rate(left: u32, right: u32, samples: u32, scale: i64) -> i32 {
    if samples == 0 {
        return 0;
    }
    let delta = i64::from(left) - i64::from(right);
    i32::try_from(delta.saturating_mul(scale) / i64::from(samples)).unwrap_or_else(|_| {
        if delta.is_negative() {
            i32::MIN
        } else {
            i32::MAX
        }
    })
}

fn sloped_band(
    level_id: u8,
    start_minimum: u32,
    start_maximum: u32,
    end_minimum: u32,
    end_maximum: u32,
) -> (u32, u32) {
    let index = u32::from(level_id.saturating_sub(1).min(9));
    (
        interpolate(start_minimum, end_minimum, index, 9),
        interpolate(start_maximum, end_maximum, index, 9),
    )
}

fn interpolate(start: u32, end: u32, index: u32, last: u32) -> u32 {
    let start = i64::from(start);
    let delta = i64::from(end) - start;
    u32::try_from(start + delta * i64::from(index) / i64::from(last)).unwrap_or(0)
}

fn constraint_kind_tag(kind: ConstraintKind) -> u8 {
    match kind {
        ConstraintKind::None => 0,
        ConstraintKind::ComboLines => 1,
        ConstraintKind::BreakBlocks => 2,
        ConstraintKind::ComboMeter => 3,
    }
}

fn is_none(constraint: Constraint) -> bool {
    matches!(constraint.kind, ConstraintKind::None)
}

fn is_cumulative(kind: ConstraintKind) -> bool {
    matches!(
        kind,
        ConstraintKind::ComboLines | ConstraintKind::BreakBlocks | ConstraintKind::ComboMeter
    )
}

fn is_moment(_kind: ConstraintKind) -> bool {
    false
}

fn distinct_non_none(constraints: &[Constraint]) -> usize {
    let mut tags = constraints
        .iter()
        .filter(|constraint| !is_none(**constraint))
        .map(|constraint| constraint_kind_tag(constraint.kind))
        .collect::<Vec<_>>();
    tags.sort_unstable();
    tags.dedup();
    tags.len()
}

fn max_kind_run(constraints: &[Constraint]) -> usize {
    let mut maximum = 0usize;
    let mut current = 0usize;
    let mut previous = 0u8;
    for constraint in constraints {
        let tag = constraint_kind_tag(constraint.kind);
        if tag == 0 {
            current = 0;
            previous = 0;
        } else if tag == previous {
            current = current.saturating_add(1);
        } else {
            current = 1;
            previous = tag;
        }
        maximum = maximum.max(current);
    }
    maximum
}

fn realm_levels(levels: &[CampaignCatalogLevel], realm: u8) -> Vec<CampaignCatalogLevel> {
    levels
        .iter()
        .copied()
        .filter(|level| level.map_id == realm)
        .collect()
}

fn level_tuple(level: &CampaignCatalogLevel) -> (u32, u16, u8, Constraint, Constraint) {
    (
        level.rules.level.points_required,
        level.rules.level.max_moves,
        level.rules.level_difficulty,
        level.rules.level.primary,
        level.rules.level.secondary,
    )
}

fn level_label(level: CampaignCatalogLevel) -> String {
    format!("realm-{}-level-{}", level.map_id, level.level_id)
}

fn apex_hit_has_recent_charge(record: &RunRecord, hit_action: u32) -> bool {
    record
        .bonus_charge_earned_events
        .iter()
        .any(|event| event.action <= hit_action && hit_action.saturating_sub(event.action) <= 5)
}

fn spearman_rho_milli(left: &[u64], right: &[u64]) -> i32 {
    if left.len() != right.len() || left.len() < 2 {
        return 1_000;
    }
    let left_ranks = average_ranks_twice(left);
    let right_ranks = average_ranks_twice(right);
    let count = i128::try_from(left.len()).unwrap_or(i128::MAX);
    let left_sum = left_ranks.iter().sum::<i128>();
    let right_sum = right_ranks.iter().sum::<i128>();
    let mut covariance = 0i128;
    let mut left_variance = 0u128;
    let mut right_variance = 0u128;
    for (left_rank, right_rank) in left_ranks.iter().zip(right_ranks.iter()) {
        let left_centered = left_rank.saturating_mul(count).saturating_sub(left_sum);
        let right_centered = right_rank.saturating_mul(count).saturating_sub(right_sum);
        covariance = covariance.saturating_add(left_centered.saturating_mul(right_centered));
        left_variance = left_variance.saturating_add(left_centered.unsigned_abs().pow(2));
        right_variance = right_variance.saturating_add(right_centered.unsigned_abs().pow(2));
    }
    let denominator = integer_sqrt(left_variance.saturating_mul(right_variance));
    if denominator == 0 {
        return 1_000;
    }
    let scaled = covariance.saturating_mul(1_000);
    i32::try_from(scaled / i128::try_from(denominator).unwrap_or(i128::MAX)).unwrap_or_else(|_| {
        if covariance.is_negative() {
            i32::MIN
        } else {
            i32::MAX
        }
    })
}

fn average_ranks_twice(values: &[u64]) -> Vec<i128> {
    let mut indexes = (0..values.len()).collect::<Vec<_>>();
    indexes.sort_unstable_by_key(|index| values[*index]);
    let mut ranks = vec![0i128; values.len()];
    let mut start = 0usize;
    while start < indexes.len() {
        let mut end = start + 1;
        while end < indexes.len() && values[indexes[end]] == values[indexes[start]] {
            end += 1;
        }
        let rank_twice = i128::try_from(start + 1 + end).unwrap_or(i128::MAX);
        for index in &indexes[start..end] {
            ranks[*index] = rank_twice;
        }
        start = end;
    }
    ranks
}

fn integer_sqrt(value: u128) -> u128 {
    if value < 2 {
        return value;
    }
    let mut estimate = 1u128 << u32::midpoint(value.ilog2(), 2);
    loop {
        let next = u128::midpoint(estimate, value / estimate);
        if next >= estimate {
            return estimate;
        }
        estimate = next;
    }
}

trait CountU32: Iterator {
    fn count_u32(self) -> u32
    where
        Self: Sized,
    {
        u32::try_from(self.count()).unwrap_or(u32::MAX)
    }
}

impl<I: Iterator> CountU32 for I {}

trait LenU32 {
    fn len_u32(&self) -> u32;
}

impl<T> LenU32 for [T] {
    fn len_u32(&self) -> u32 {
        u32::try_from(self.len()).unwrap_or(u32::MAX)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_named(name: &str) {
        let config = if name == "theme-policy-sanity" {
            EvaluationConfig::gate()
        } else {
            EvaluationConfig::acceptance(
                bands::ACCEPTANCE_PLANNER_SEEDS,
                bands::ASSERTION_SEED_START,
            )
        };
        let mut evaluator = Evaluator::new(config);
        let result = evaluator.evaluate_named(name).unwrap();
        assert_eq!(
            result.passed,
            Some(true),
            "{}",
            serde_json::to_string_pretty(&result).unwrap()
        );
    }

    #[test]
    #[ignore = "opens in brief 04: constraint-pursuit-gain"]
    fn constraint_pursuit_gain() {
        assert_named("constraint-pursuit-gain");
    }
    #[test]
    #[ignore = "opens in brief 05: first-star-rate"]
    fn first_star_rate() {
        assert_named("first-star-rate");
    }
    #[test]
    #[ignore = "opens in brief 05: second-star-rate"]
    fn second_star_rate() {
        assert_named("second-star-rate");
    }
    #[test]
    #[ignore = "opens in brief 05: star-earn-rate"]
    fn star_earn_rate() {
        assert_named("star-earn-rate");
    }
    #[test]
    #[ignore = "opens in brief 05: trigger-liveness"]
    fn trigger_liveness() {
        assert_named("trigger-liveness");
    }
    #[test]
    #[ignore = "opens in brief 05: tier-step"]
    fn tier_step() {
        assert_named("tier-step");
    }
    #[test]
    #[ignore = "opens in brief 05: passive-relevance"]
    fn passive_relevance() {
        assert_named("passive-relevance");
    }
    #[test]
    #[ignore = "opens in brief 05: board-divergence"]
    fn board_divergence() {
        assert_named("board-divergence");
    }
    #[test]
    fn theme_policy_sanity() {
        assert_named("theme-policy-sanity");
    }
    #[test]
    fn realm_identity() {
        assert_named("realm-identity");
    }
    #[test]
    #[ignore = "opens in brief 04: kind-variety"]
    fn kind_variety() {
        assert_named("kind-variety");
    }
    #[test]
    #[ignore = "opens in brief 05: zone-monotonicity"]
    fn zone_monotonicity() {
        assert_named("zone-monotonicity");
    }
    #[test]
    #[ignore = "opens in brief 05: apex-reachable"]
    fn apex_reachable() {
        assert_named("apex-reachable");
    }
    #[test]
    #[ignore = "opens in brief 05: apex-luckable"]
    fn apex_luckable() {
        assert_named("apex-luckable");
    }
    #[test]
    #[ignore = "opens in brief 05: apex-findable"]
    fn apex_findable() {
        assert_named("apex-findable");
    }
    #[test]
    #[ignore = "opens in brief 05: apex-decisive"]
    fn apex_decisive() {
        assert_named("apex-decisive");
    }
    #[test]
    #[ignore = "opens in brief 05: apex-optional"]
    fn apex_optional() {
        assert_named("apex-optional");
    }
    #[test]
    #[ignore = "opens in brief 05: apex-set-up"]
    fn apex_set_up() {
        assert_named("apex-set-up");
    }
    #[test]
    #[ignore = "opens in brief 04: reroll-held"]
    fn reroll_held() {
        assert_named("reroll-held");
    }
    #[test]
    #[ignore = "opens in brief 04: reroll-grant"]
    fn reroll_grant() {
        assert_named("reroll-grant");
    }

    #[test]
    fn minimum_sample_shortfall_is_never_reported_as_a_pass() {
        let mut gate = Evaluator::new(EvaluationConfig::gate());
        let skipped = gate.evaluate_named("first-star-rate").unwrap();
        assert_eq!(skipped.status, AssertionStatus::NotEvaluated);
        assert_eq!(skipped.passed, None);
        assert_eq!(
            skipped.units[0].detail.as_deref(),
            Some("not evaluated in gate (min_samples)")
        );

        let mut acceptance = Evaluator::new(EvaluationConfig::acceptance(
            bands::GATE_SEEDS,
            bands::ASSERTION_SEED_START,
        ));
        let insufficient = acceptance.evaluate_named("first-star-rate").unwrap();
        assert_eq!(insufficient.status, AssertionStatus::InsufficientEvents);
        assert_eq!(insufficient.passed, Some(false));
    }

    #[test]
    fn spearman_uses_average_ranks_for_ties() {
        assert_eq!(spearman_rho_milli(&[1, 1, 2, 3], &[4, 4, 2, 1]), -1_000);
        assert_eq!(spearman_rho_milli(&[1, 2, 3], &[1, 2, 3]), 1_000);
    }

    #[test]
    fn sloped_bands_reach_both_owner_endpoints() {
        assert_eq!(sloped_band(1, 8_500, 9_500, 4_500, 6_000), (8_500, 9_500));
        assert_eq!(sloped_band(10, 8_500, 9_500, 4_500, 6_000), (4_500, 6_000));
    }
}
