use crate::{
    BlockWeights, Bonus, DailyTheme, Guardian, RandomnessError, ReplayCommitment, ReplayEvent,
    RulesHash, RunEngine, RunError, RunPhase, Sha256Provider, SoftwareSha256, StarRules,
    bonus_trigger_threshold_is_valid, continuation_from_vrf_with, opening_from_vrf_with,
    reroll_row_from_vrf_with, row_from_vrf_with,
};

const DAILY_RULES_HASH_DOMAIN: &[u8] = b"zkube-daily-rules-v1";
const DAILY_CHALLENGE_RULES_HASH_DOMAIN: &[u8] = b"zkube-arena-rules-v3";
pub const RULES_VERSION: u32 = 5;
pub const CANONICAL_RUN_RULES_LEN: usize = 23;
pub const DAILY_MAX_MOVES: u16 = 100;
pub const PRESSURE_STEP: u32 = 15;

/// Exactly one tier policy drives a run. Campaign fixes a tier; Daily derives
/// it from neutral pressure score.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TierPolicy {
    Fixed(u8),
    Pressure,
}

/// One mode-agnostic rules value consumed by every run transition.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RunRules {
    pub guardian: Guardian,
    pub starting_height: u8,
    pub max_moves: u16,
    pub tier: TierPolicy,
    pub stars: Option<StarRules>,
    /// `None` is Classic for a pressure run and no objective for Campaign.
    pub objective: Option<DailyTheme>,
}

impl RunRules {
    /// Compose an authored Campaign level from the core's realm, target and budget rules.
    #[must_use]
    pub fn campaign(
        realm: crate::RealmRules,
        level: u8,
        tier: u8,
        primary: crate::Constraint,
        secondary: crate::Constraint,
    ) -> Option<Self> {
        let max_moves = crate::campaign_move_budget(level, tier)?;
        let rules = Self {
            guardian: realm.guardian,
            starting_height: realm.starting_height,
            max_moves,
            tier: TierPolicy::Fixed(tier),
            stars: Some(StarRules {
                points_required: u32::from(crate::CAMPAIGN_TARGET_LADDER[usize::from(level - 1)]),
                primary,
                secondary,
            }),
            objective: None,
        };
        rules.is_valid().then_some(rules)
    }

    #[must_use]
    pub fn is_valid(self) -> bool {
        let common = self.max_moves > 0
            && bonus_trigger_threshold_is_valid(self.guardian.trigger, self.guardian.threshold)
            && (crate::MIN_OPENING_HEIGHT..=crate::MAX_OPENING_HEIGHT)
                .contains(&self.starting_height);
        if !common {
            return false;
        }
        match (self.tier, self.stars) {
            (TierPolicy::Fixed(tier), Some(stars)) => {
                tier <= 7
                    && self.objective.is_none()
                    && stars.points_required > 0
                    && stars.primary.is_valid_primary()
                    && stars.secondary.is_valid_secondary()
                    && stars.has_valid_constraint_classes()
                    && stars.has_distinct_constraint_facts(
                        self.guardian.trigger,
                        self.guardian.threshold,
                    )
            }
            (TierPolicy::Pressure, None) => self
                .objective
                .is_none_or(|objective| crate::DAILY_THEMES.contains(&objective)),
            _ => false,
        }
    }

    #[must_use]
    pub const fn is_pressure(self) -> bool {
        matches!(self.tier, TierPolicy::Pressure)
    }

    #[must_use]
    pub fn current_tier(self, pressure_score: u32) -> u8 {
        match self.tier {
            TierPolicy::Fixed(tier) => tier.min(7),
            TierPolicy::Pressure => u8::try_from(pressure_score / PRESSURE_STEP).unwrap_or(u8::MAX),
        }
    }

    #[must_use]
    pub fn weights(self, tier: u8) -> BlockWeights {
        BlockWeights {
            values: crate::TIER_BLOCK_WEIGHTS[usize::from(tier.min(7))],
        }
    }

    fn action_score_multiplier(self, tier: u8) -> u16 {
        if self.is_pressure() {
            100u16.saturating_add(u16::from(tier).saturating_mul(50))
        } else {
            100
        }
    }

    #[must_use]
    pub fn canonical_bytes(self) -> CanonicalRunRulesBytes {
        let mut encoded = CanonicalRunRulesBytes::default();
        encoded.push(&self.max_moves.to_le_bytes());
        encoded.push(&[bonus_tag(Some(self.guardian.bonus)), self.guardian.trigger]);
        encoded.push(&self.guardian.threshold.to_le_bytes());
        encoded.push(&[self.starting_height]);
        encoded.push(&match self.tier {
            TierPolicy::Fixed(tier) => [0, tier],
            TierPolicy::Pressure => [1, 0],
        });
        if let Some(stars) = self.stars {
            encoded.push(&[1]);
            encoded.push(&stars.points_required.to_le_bytes());
            encode_constraint(&mut encoded, stars.primary);
            encode_constraint(&mut encoded, stars.secondary);
        } else {
            encoded.push(&[0; 11]);
        }
        if let Some(objective) = self.objective {
            encoded.push(&[1, objective.kind.tag(), objective.value]);
        } else {
            encoded.push(&[0; 3]);
        }
        debug_assert_eq!(encoded.as_slice().len(), CANONICAL_RUN_RULES_LEN);
        encoded
    }

    #[must_use]
    pub fn snapshot_hash(self) -> RulesHash {
        self.snapshot_hash_with::<SoftwareSha256>()
    }

    #[must_use]
    pub fn snapshot_hash_with<H: Sha256Provider>(self) -> RulesHash {
        let encoded = self.canonical_bytes();
        RulesHash(H::hashv(&[
            DAILY_RULES_HASH_DOMAIN,
            &RULES_VERSION.to_le_bytes(),
            encoded.as_slice(),
        ]))
    }
}

/// Fixed-allocation canonical bytes for the single rules value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CanonicalRunRulesBytes {
    bytes: [u8; CANONICAL_RUN_RULES_LEN],
    len: u8,
}

impl Default for CanonicalRunRulesBytes {
    fn default() -> Self {
        Self {
            bytes: [0; CANONICAL_RUN_RULES_LEN],
            len: 0,
        }
    }
}

impl CanonicalRunRulesBytes {
    fn push(&mut self, value: &[u8]) {
        let start = usize::from(self.len);
        let end = start + value.len();
        self.bytes[start..end].copy_from_slice(value);
        self.len = u8::try_from(end).expect("canonical Run rules fit in one byte");
    }

    #[must_use]
    pub fn as_slice(&self) -> &[u8] {
        &self.bytes[..usize::from(self.len)]
    }
}

fn encode_constraint(encoded: &mut CanonicalRunRulesBytes, constraint: crate::Constraint) {
    encoded.push(&[
        constraint.kind.tag(),
        constraint.value,
        constraint.required_count,
    ]);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RunConfig {
    pub rules_hash: RulesHash,
    pub rules: RunRules,
    pub initial_replay: ReplayCommitment,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunEndReason {
    Completed,
    Exhausted,
    Abandoned,
    Deadline,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Run {
    pub engine: RunEngine,
    pub action_counter: u32,
    pub daily_score: u32,
    pub objective_total: u64,
    pub pressure_score: u32,
    pub current_tier: u8,
    pub last_vrf_counter: u32,
    pub replay: ReplayCommitment,
    pub rules_hash: RulesHash,
    pub rules_snapshot_hash: RulesHash,
    pub end_reason: Option<RunEndReason>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunTransitionError {
    InvalidRules,
    InvalidActionOrder,
    InvalidVrfOrder,
    InvalidPhase,
    Overflow,
    Engine(RunError),
    Randomness(RandomnessError),
}

impl From<RunError> for RunTransitionError {
    fn from(error: RunError) -> Self {
        Self::Engine(error)
    }
}

impl From<RandomnessError> for RunTransitionError {
    fn from(error: RandomnessError) -> Self {
        Self::Randomness(error)
    }
}

impl Run {
    /// Build the one shared driver before its opening VRF result arrives.
    ///
    /// # Errors
    ///
    /// Returns [`RunTransitionError::InvalidRules`] when the supplied rules do
    /// not describe a supported Campaign or Daily run.
    pub fn new(config: RunConfig) -> Result<Self, RunTransitionError> {
        if !config.rules.is_valid() {
            return Err(RunTransitionError::InvalidRules);
        }
        Ok(Self {
            engine: RunEngine {
                phase: RunPhase::AwaitingVrf,
                bonus: Some(config.rules.guardian.bonus),
                bonus_charges: 0,
                ..RunEngine::default()
            },
            action_counter: 0,
            daily_score: 0,
            objective_total: 0,
            pressure_score: 0,
            current_tier: config.rules.current_tier(0),
            last_vrf_counter: 0,
            replay: config.initial_replay,
            rules_hash: config.rules_hash,
            rules_snapshot_hash: config.rules.snapshot_hash(),
            end_reason: None,
        })
    }

    #[must_use]
    pub const fn is_score_eligible(&self) -> bool {
        self.action_counter > 0
    }

    /// Apply verified randomness and observe its accepted board and preview changes.
    ///
    /// # Errors
    ///
    /// Rejects stale rules, an unexpected phase or counter, and invalid row generation.
    pub fn apply_vrf_observed_with<H: Sha256Provider, O: crate::PresentationObserver>(
        &mut self,
        rules: RunRules,
        request_counter: u32,
        output: [u8; 32],
        observer: &mut O,
    ) -> Result<(), RunTransitionError> {
        self.require_rules_with::<H>(rules)?;
        if self.engine.phase != RunPhase::AwaitingVrf {
            return Err(RunTransitionError::InvalidPhase);
        }
        if self.last_vrf_counter.checked_add(1) != Some(request_counter) {
            return Err(RunTransitionError::InvalidVrfOrder);
        }
        let mut next = *self;
        let weights = rules.weights(next.current_tier);
        if request_counter == 1 {
            let opening = opening_from_vrf_with::<H>(
                output,
                request_counter,
                next.rules_hash.to_bytes(),
                rules.starting_height,
                weights,
            )?;
            next.engine.grid = opening.grid;
            next.engine.next_row = Some(opening.preview);
            next.engine.phase = RunPhase::Playing;
        } else if next.engine.reroll_pending() {
            let row = reroll_row_from_vrf_with::<H>(
                output,
                request_counter,
                next.rules_hash.to_bytes(),
                weights,
            )?;
            next.engine.provide_reroll_row(row)?;
        } else if next.engine.grid.is_empty() {
            let continuation = continuation_from_vrf_with::<H>(
                output,
                request_counter,
                next.rules_hash.to_bytes(),
                weights,
            )?;
            next.engine.grid = continuation.grid;
            next.engine.next_row = Some(continuation.preview);
            next.engine.phase = RunPhase::Playing;
        } else {
            let row = row_from_vrf_with::<H>(output, request_counter, weights)?;
            next.engine.provide_vrf_row(row)?;
        }
        next.fold_event_with::<H>(ReplayEvent::Vrf {
            request_counter,
            output,
        });
        next.last_vrf_counter = request_counter;
        let before = *self;
        *self = next;
        if before.engine.grid != self.engine.grid {
            observer.observe(crate::PresentationEvent::BoardReplaced {
                cells: *self.engine.grid.cells(),
            });
        }
        self.observe_outcome(&before, observer);
        Ok(())
    }

    /// Observe the same atomic move used by untraced callers. Discard collected
    /// events if this returns an error; events are not independently accepted.
    ///
    /// # Errors
    /// Rejects stale rules, action-order drift, or an invalid engine move.
    #[allow(clippy::too_many_arguments)]
    pub fn play_move_observed_with<H: Sha256Provider, O: crate::PresentationObserver>(
        &mut self,
        rules: RunRules,
        action: u32,
        expected_move: u16,
        row: u8,
        start: u8,
        destination: u8,
        observer: &mut O,
    ) -> Result<crate::MoveReport, RunTransitionError> {
        self.require_action_with::<H>(rules, action)?;
        let mut next = *self;
        let trigger_events_before = next.engine.charges_earned;
        let report = next.engine.play_run_move_observed(
            expected_move,
            row,
            start,
            destination,
            rules.max_moves,
            rules.stars,
            rules.guardian,
            rules.action_score_multiplier(next.current_tier),
            observer,
        )?;
        let trigger_events = next
            .engine
            .charges_earned
            .saturating_sub(trigger_events_before);
        next.record_action(rules, report, trigger_events)?;
        next.fold_event_with::<H>(ReplayEvent::Move {
            action,
            expected_move,
            row,
            start,
            destination,
        });
        next.observe_perfect_clear(self, report, observer);
        next.observe_outcome(self, observer);
        *self = next;
        Ok(report)
    }

    /// Observe the shared bonus transition; discard events on rejection.
    ///
    /// # Errors
    /// Rejects stale rules, action-order drift, or an invalid guardian action.
    pub fn apply_bonus_observed_with<H: Sha256Provider, O: crate::PresentationObserver>(
        &mut self,
        rules: RunRules,
        action: u32,
        row: u8,
        column: u8,
        observer: &mut O,
    ) -> Result<crate::MoveReport, RunTransitionError> {
        self.require_action_with::<H>(rules, action)?;
        let mut next = *self;
        let trigger_events_before = next.engine.charges_earned;
        let report = next.engine.apply_run_bonus_observed(
            row,
            column,
            rules.max_moves,
            rules.stars,
            rules.guardian,
            rules.action_score_multiplier(next.current_tier),
            observer,
        )?;
        let trigger_events = next
            .engine
            .charges_earned
            .saturating_sub(trigger_events_before);
        next.record_action(rules, report, trigger_events)?;
        next.fold_event_with::<H>(ReplayEvent::Bonus {
            action,
            row,
            column,
        });
        next.observe_perfect_clear(self, report, observer);
        next.observe_outcome(self, observer);
        *self = next;
        Ok(report)
    }

    fn observe_perfect_clear<O: crate::PresentationObserver>(
        &self,
        before: &Self,
        report: crate::MoveReport,
        observer: &mut O,
    ) {
        if report.perfect_clear {
            observer.observe(crate::PresentationEvent::PerfectClear {
                reroll_granted: self.engine.reroll_charges > before.engine.reroll_charges,
            });
        }
    }

    fn observe_outcome<O: crate::PresentationObserver>(&self, before: &Self, observer: &mut O) {
        if self.engine.next_row != before.engine.next_row {
            observer.observe(crate::PresentationEvent::PreviewChanged {
                row: self.engine.next_row,
            });
        }
        if self.end_reason != before.end_reason
            && let Some(reason) = self.end_reason
        {
            observer.observe(crate::PresentationEvent::Terminal { reason });
        }
    }

    /// Spend one held reroll as an ordered action.
    ///
    /// # Errors
    ///
    /// Rejects stale rules, action-order drift, or an unavailable reroll.
    pub fn request_reroll(
        &mut self,
        rules: RunRules,
        action: u32,
    ) -> Result<(), RunTransitionError> {
        self.request_reroll_with::<SoftwareSha256>(rules, action)
    }

    /// Hash-provider-adaptable form of [`Run::request_reroll`].
    ///
    /// # Errors
    ///
    /// Returns the same transition errors as [`Run::request_reroll`].
    pub fn request_reroll_with<H: Sha256Provider>(
        &mut self,
        rules: RunRules,
        action: u32,
    ) -> Result<(), RunTransitionError> {
        self.require_action_with::<H>(rules, action)?;
        let mut next = *self;
        next.engine.request_reroll()?;
        next.action_counter = next
            .action_counter
            .checked_add(1)
            .ok_or(RunTransitionError::Overflow)?;
        next.fold_event_with::<H>(ReplayEvent::Reroll { action });
        *self = next;
        Ok(())
    }

    /// Finish an active run for an authorized terminal reason and observe the outcome.
    ///
    /// # Errors
    ///
    /// Rejects stale rules, an automatic-only reason, or a terminal run.
    pub fn finish_observed_with<H: Sha256Provider, O: crate::PresentationObserver>(
        &mut self,
        rules: RunRules,
        reason: RunEndReason,
        observer: &mut O,
    ) -> Result<(), RunTransitionError> {
        self.require_rules_with::<H>(rules)?;
        if !matches!(reason, RunEndReason::Abandoned | RunEndReason::Deadline)
            || !matches!(self.engine.phase, RunPhase::Playing | RunPhase::AwaitingVrf)
        {
            return Err(RunTransitionError::InvalidPhase);
        }
        let mut next = *self;
        next.engine.phase = RunPhase::Finished;
        next.engine.next_row = None;
        let event = match reason {
            RunEndReason::Abandoned => {
                next.engine.latched_star_sources = 0;
                ReplayEvent::PlayerAbandon {
                    action: next.action_counter,
                }
            }
            RunEndReason::Deadline => ReplayEvent::DailyDeadline {
                action: next.action_counter,
            },
            RunEndReason::Completed | RunEndReason::Exhausted => {
                return Err(RunTransitionError::InvalidPhase);
            }
        };
        next.fold_event_with::<H>(event);
        next.end_reason = Some(reason);
        let before = *self;
        *self = next;
        self.observe_outcome(&before, observer);
        Ok(())
    }

    fn require_rules_with<H: Sha256Provider>(
        &self,
        rules: RunRules,
    ) -> Result<(), RunTransitionError> {
        if !rules.is_valid() || rules.snapshot_hash_with::<H>() != self.rules_snapshot_hash {
            return Err(RunTransitionError::InvalidRules);
        }
        Ok(())
    }

    fn require_action_with<H: Sha256Provider>(
        &self,
        rules: RunRules,
        action: u32,
    ) -> Result<(), RunTransitionError> {
        self.require_rules_with::<H>(rules)?;
        if action != self.action_counter {
            return Err(RunTransitionError::InvalidActionOrder);
        }
        Ok(())
    }

    fn record_action(
        &mut self,
        rules: RunRules,
        report: crate::MoveReport,
        trigger_events: u8,
    ) -> Result<(), RunTransitionError> {
        if rules.is_pressure() {
            let objective_increment = rules.objective.map_or(0, |objective| {
                objective.action_increment_with_trigger(&report, trigger_events)
            });
            self.daily_score = self
                .daily_score
                .checked_add(report.points_earned)
                .ok_or(RunTransitionError::Overflow)?;
            self.objective_total = self
                .objective_total
                .checked_add(u64::from(objective_increment))
                .ok_or(RunTransitionError::Overflow)?;
            self.pressure_score = self
                .pressure_score
                .checked_add(report.neutral_points_earned)
                .ok_or(RunTransitionError::Overflow)?;
            self.current_tier = rules.current_tier(self.pressure_score);
        }
        self.action_counter = self
            .action_counter
            .checked_add(1)
            .ok_or(RunTransitionError::Overflow)?;
        self.end_reason = match self.engine.phase {
            RunPhase::LevelComplete => Some(RunEndReason::Completed),
            RunPhase::Finished => Some(RunEndReason::Exhausted),
            _ => None,
        };
        Ok(())
    }

    fn fold_event_with<H: Sha256Provider>(&mut self, event: ReplayEvent) {
        self.replay = self.replay.fold_with::<H>(event);
    }
}

/// Reproduce the Daily rules identity stored by the Solana program.
#[must_use]
pub fn daily_rules_hash(
    day_id: u32,
    guardian: Guardian,
    starting_height: u8,
    objective: DailyTheme,
) -> RulesHash {
    daily_rules_hash_with::<SoftwareSha256>(day_id, guardian, starting_height, objective)
}

#[must_use]
pub fn daily_rules_hash_with<H: Sha256Provider>(
    day_id: u32,
    guardian: Guardian,
    starting_height: u8,
    objective: DailyTheme,
) -> RulesHash {
    daily_rules_hash_components_with::<H>(
        day_id,
        crate::CATALOG_VERSION,
        guardian,
        starting_height,
        objective,
        RULES_VERSION,
    )
}

pub(crate) fn daily_rules_hash_components_with<H: Sha256Provider>(
    day_id: u32,
    content_version: u32,
    guardian: Guardian,
    starting_height: u8,
    objective: DailyTheme,
    rules_version: u32,
) -> RulesHash {
    RulesHash(H::hashv(&[
        DAILY_CHALLENGE_RULES_HASH_DOMAIN,
        &day_id.to_le_bytes(),
        &content_version.to_le_bytes(),
        &[bonus_tag(Some(guardian.bonus)), guardian.trigger],
        &guardian.threshold.to_le_bytes(),
        &[starting_height, objective.kind.tag(), objective.value],
        &rules_version.to_le_bytes(),
    ]))
}

const fn bonus_tag(bonus: Option<Bonus>) -> u8 {
    match bonus {
        None => 0,
        Some(Bonus::Hammer) => 1,
        Some(Bonus::Totem) => 2,
        Some(Bonus::Wave) => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules() -> RunRules {
        RunRules {
            guardian: Guardian {
                bonus: Bonus::Wave,
                ..Guardian::default()
            },
            starting_height: 4,
            max_moves: 100,
            tier: TierPolicy::Pressure,
            stars: None,
            objective: Some(crate::DAILY_THEMES[1]),
        }
    }

    fn config() -> RunConfig {
        RunConfig {
            rules_hash: RulesHash([5; 32]),
            rules: rules(),
            initial_replay: ReplayCommitment([6; 32]),
        }
    }

    #[test]
    #[allow(clippy::too_many_lines)] // Keep each observer case beside its matching untraced state.
    fn perfect_clear_observation_preserves_move_bonus_and_capped_state() {
        use std::{vec, vec::Vec};
        #[derive(Default)]
        struct Events(Vec<crate::PresentationEvent>);
        impl crate::PresentationObserver for Events {
            fn observe(&mut self, event: crate::PresentationEvent) {
                self.0.push(event);
            }
        }
        for bonus in [false, true] {
            for charges in [1, crate::BONUS_CHARGE_CAP] {
                let cfg = config();
                let mut initial = Run::new(cfg).unwrap();
                let mut cells = [0; 80];
                cells[0] = 1;
                if !bonus {
                    cells[2..8].fill(1);
                    cells[8] = 1;
                }
                initial.engine.grid = crate::Grid::try_from_cells(cells).unwrap();
                initial.engine.next_row = Some([1; 8]);
                initial.engine.phase = RunPhase::Playing;
                initial.engine.bonus_charges = 1;
                initial.engine.charges_earned = 1;
                initial.engine.reroll_charges = charges;
                initial.last_vrf_counter = 1;
                let mut traced = initial;
                let mut plain = initial;
                let mut events = Events::default();
                let report = if bonus {
                    plain
                        .apply_bonus_observed_with::<crate::SoftwareSha256, _>(
                            cfg.rules,
                            0,
                            0,
                            0,
                            &mut crate::NoPresentation,
                        )
                        .unwrap();
                    traced
                        .apply_bonus_observed_with::<SoftwareSha256, _>(
                            cfg.rules,
                            0,
                            0,
                            0,
                            &mut events,
                        )
                        .unwrap()
                } else {
                    plain
                        .play_move_observed_with::<crate::SoftwareSha256, _>(
                            cfg.rules,
                            0,
                            0,
                            1,
                            0,
                            1,
                            &mut crate::NoPresentation,
                        )
                        .unwrap();
                    traced
                        .play_move_observed_with::<SoftwareSha256, _>(
                            cfg.rules,
                            0,
                            0,
                            1,
                            0,
                            1,
                            &mut events,
                        )
                        .unwrap()
                };
                assert!(report.perfect_clear);
                assert_eq!(
                    traced, plain,
                    "observation cannot alter any accepted field or commitment"
                );
                assert_eq!(
                    events
                        .0
                        .iter()
                        .filter(|event| matches!(
                            event,
                            crate::PresentationEvent::PerfectClear { .. }
                        ))
                        .copied()
                        .collect::<Vec<_>>(),
                    vec![crate::PresentationEvent::PerfectClear {
                        reroll_granted: charges < crate::BONUS_CHARGE_CAP
                    }]
                );
                let mut rejected = Events::default();
                assert!(
                    initial
                        .apply_bonus_observed_with::<SoftwareSha256, _>(
                            cfg.rules,
                            1,
                            0,
                            0,
                            &mut rejected
                        )
                        .is_err()
                );
                assert!(rejected.0.is_empty());
            }
        }
    }

    #[test]
    fn one_run_drives_campaign_and_daily() {
        let daily_rules = rules();
        let campaign_level = crate::StarRules::default();
        let campaign_rules = RunRules {
            guardian: daily_rules.guardian,
            starting_height: daily_rules.starting_height,
            max_moves: 20,
            tier: TierPolicy::Fixed(0),
            stars: Some(campaign_level),
            objective: None,
        };
        let build = |rules| {
            Run::new(RunConfig {
                rules_hash: RulesHash([5; 32]),
                rules,
                initial_replay: ReplayCommitment([6; 32]),
            })
            .unwrap()
        };
        let mut daily = build(daily_rules);
        let mut campaign = build(campaign_rules);

        daily
            .apply_vrf_observed_with::<crate::SoftwareSha256, _>(
                daily_rules,
                1,
                [9; 32],
                &mut crate::NoPresentation,
            )
            .unwrap();
        campaign
            .apply_vrf_observed_with::<crate::SoftwareSha256, _>(
                campaign_rules,
                1,
                [9; 32],
                &mut crate::NoPresentation,
            )
            .unwrap();

        assert_eq!(daily.engine.phase, RunPhase::Playing);
        assert_eq!(campaign.engine.phase, RunPhase::Playing);
        assert_eq!(daily.engine.grid, campaign.engine.grid);
        assert_eq!(daily.engine.next_row, campaign.engine.next_row);
    }

    #[test]
    fn simulation_enforces_vrf_and_action_order_atomically() {
        let mut simulation = Run::new(config()).unwrap();
        let untouched = simulation;
        assert_eq!(
            simulation.apply_vrf_observed_with::<crate::SoftwareSha256, _>(
                rules(),
                2,
                [9; 32],
                &mut crate::NoPresentation
            ),
            Err(RunTransitionError::InvalidVrfOrder)
        );
        assert_eq!(simulation, untouched);
        simulation
            .apply_vrf_observed_with::<crate::SoftwareSha256, _>(
                rules(),
                1,
                [9; 32],
                &mut crate::NoPresentation,
            )
            .unwrap();
        let opened = simulation;
        assert_eq!(
            simulation.play_move_observed_with::<crate::SoftwareSha256, _>(
                rules(),
                1,
                0,
                0,
                0,
                0,
                &mut crate::NoPresentation
            ),
            Err(RunTransitionError::InvalidActionOrder)
        );
        assert_eq!(simulation, opened);
    }

    #[test]
    fn one_vrf_recovers_an_empty_post_clear_board_and_preview() {
        let mut simulation = Run::new(config()).unwrap();
        simulation
            .apply_vrf_observed_with::<crate::SoftwareSha256, _>(
                rules(),
                1,
                [9; 32],
                &mut crate::NoPresentation,
            )
            .unwrap();
        simulation.engine.grid = crate::Grid::EMPTY;
        simulation.engine.next_row = None;
        simulation.engine.phase = RunPhase::AwaitingVrf;

        simulation
            .apply_vrf_observed_with::<crate::SoftwareSha256, _>(
                rules(),
                2,
                [10; 32],
                &mut crate::NoPresentation,
            )
            .unwrap();

        assert_eq!(simulation.engine.phase, RunPhase::Playing);
        assert_eq!(simulation.engine.grid.occupied_height(), 1);
        assert!(simulation.engine.next_row.is_some());
        assert_eq!(simulation.last_vrf_counter, 2);
    }

    #[test]
    fn canonical_rules_are_fixed_and_hash_every_field() {
        let baseline = rules();
        assert_eq!(
            baseline.canonical_bytes().as_slice().len(),
            CANONICAL_RUN_RULES_LEN
        );
        let mut changed = baseline;
        changed.tier = TierPolicy::Fixed(7);
        assert_ne!(baseline.snapshot_hash(), changed.snapshot_hash());
        assert!(!changed.is_valid());
        changed = baseline;
        changed.objective = Some(crate::DAILY_THEMES[2]);
        assert_ne!(baseline.snapshot_hash(), changed.snapshot_hash());
        changed = baseline;
        changed.starting_height += 1;
        assert_ne!(baseline.snapshot_hash(), changed.snapshot_hash());
        changed.starting_height = crate::MIN_OPENING_HEIGHT - 1;
        assert!(!changed.is_valid());
        changed.starting_height = crate::MAX_OPENING_HEIGHT + 1;
        assert!(!changed.is_valid());
    }

    #[test]
    fn daily_rules_hash_binds_day_realm_objective_and_protocol_constants() {
        let rules = rules();
        let objective = rules.objective.unwrap();
        let baseline = daily_rules_hash(32_000, rules.guardian, rules.starting_height, objective);
        let changed = |day, version, guardian, height, theme, rules_version| {
            daily_rules_hash_components_with::<SoftwareSha256>(
                day,
                version,
                guardian,
                height,
                theme,
                rules_version,
            )
        };
        assert_eq!(
            baseline,
            changed(
                32_000,
                crate::CATALOG_VERSION,
                rules.guardian,
                rules.starting_height,
                objective,
                RULES_VERSION
            )
        );
        for (day, version, rules_version) in [
            (32_160, crate::CATALOG_VERSION, RULES_VERSION),
            (32_000, crate::CATALOG_VERSION + 1, RULES_VERSION),
            (32_000, crate::CATALOG_VERSION, RULES_VERSION + 1),
        ] {
            assert_ne!(
                baseline,
                changed(
                    day,
                    version,
                    rules.guardian,
                    rules.starting_height,
                    objective,
                    rules_version
                )
            );
        }
        let mut guardian = rules.guardian;
        guardian.threshold += 1;
        assert_ne!(
            baseline,
            daily_rules_hash(32_000, guardian, rules.starting_height, objective)
        );
        guardian = rules.guardian;
        guardian.bonus = Bonus::Hammer;
        assert_ne!(
            baseline,
            daily_rules_hash(32_000, guardian, rules.starting_height, objective)
        );
        guardian = rules.guardian;
        guardian.trigger = 2;
        assert_ne!(
            baseline,
            daily_rules_hash(32_000, guardian, rules.starting_height, objective)
        );
        assert_ne!(
            baseline,
            daily_rules_hash(32_000, rules.guardian, rules.starting_height + 1, objective)
        );
        assert_ne!(
            baseline,
            daily_rules_hash(
                32_000,
                rules.guardian,
                rules.starting_height,
                crate::DAILY_THEMES[2]
            )
        );
    }

    #[test]
    fn daily_runs_start_without_guardian_charges() {
        let simulation = Run::new(config()).unwrap();
        assert_eq!(simulation.engine.bonus_charges, 0);
    }

    #[test]
    fn theme_total_is_not_added_to_score() {
        for objective in crate::DAILY_THEMES {
            for prior_total in [0, 10_000] {
                for pressure in [0, PRESSURE_STEP - 1, 12 * PRESSURE_STEP] {
                    for bonus in [false, true] {
                        let make_run = |objective, total| {
                            let mut cfg = config();
                            cfg.rules.objective = Some(objective);
                            let mut run = Run::new(cfg).unwrap();
                            let mut cells = [0; 80];
                            cells[0] = 1;
                            if !bonus {
                                cells[2..8].fill(1);
                                cells[8] = 1;
                            }
                            run.engine.grid = crate::Grid::try_from_cells(cells).unwrap();
                            run.engine.next_row = Some([1; 8]);
                            run.engine.phase = RunPhase::Playing;
                            run.engine.bonus_charges = 1;
                            run.engine.charges_earned = 1;
                            run.last_vrf_counter = 1;
                            run.objective_total = total;
                            run.pressure_score = pressure;
                            run.current_tier = cfg.rules.current_tier(pressure);
                            (cfg.rules, run)
                        };
                        let (classic_rules, mut classic) = make_run(crate::DAILY_THEMES[0], 0);
                        let (theme_rules, mut theme) = make_run(objective, prior_total);
                        let act = |run: &mut Run, rules| {
                            if bonus {
                                run.apply_bonus_observed_with::<crate::SoftwareSha256, _>(
                                    rules,
                                    0,
                                    0,
                                    0,
                                    &mut crate::NoPresentation,
                                )
                                .unwrap()
                            } else {
                                run.play_move_observed_with::<crate::SoftwareSha256, _>(
                                    rules,
                                    0,
                                    0,
                                    1,
                                    0,
                                    1,
                                    &mut crate::NoPresentation,
                                )
                                .unwrap()
                            }
                        };
                        let report = act(&mut theme, theme_rules);
                        assert_eq!(report, act(&mut classic, classic_rules));
                        if !bonus {
                            assert!(theme.daily_score > 0);
                        }
                        assert_eq!(theme.daily_score, classic.daily_score);
                        assert_eq!(theme.pressure_score, classic.pressure_score);
                        assert_eq!(theme.current_tier, classic.current_tier);
                        assert_eq!(theme.engine, classic.engine);
                        assert_eq!(classic.objective_total, 0);
                        if objective == crate::DAILY_THEMES[5] {
                            assert!(theme.objective_total > prior_total);
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn pressure_multiplier_is_uncapped_and_the_draw_clamps_at_the_top_row() {
        let rules = rules();
        let pressure_score = 12 * PRESSURE_STEP;
        let tier = rules.current_tier(pressure_score);
        assert_eq!(tier, 12);
        assert_eq!(rules.action_score_multiplier(tier), 700);
        assert_eq!(rules.weights(tier).values, crate::TIER_BLOCK_WEIGHTS[7]);
        assert_eq!(rules.current_tier(u32::MAX), u8::MAX);
    }

    #[test]
    fn deadline_freezes_zero_action_run_without_making_it_score_eligible() {
        let mut simulation = Run::new(config()).unwrap();
        let replay_before = simulation.replay;
        simulation
            .finish_observed_with::<crate::SoftwareSha256, _>(
                rules(),
                RunEndReason::Deadline,
                &mut crate::NoPresentation,
            )
            .unwrap();
        assert_eq!(simulation.engine.phase, RunPhase::Finished);
        assert_eq!(simulation.end_reason, Some(RunEndReason::Deadline));
        assert!(!simulation.is_score_eligible());
        assert_ne!(simulation.replay, replay_before);
    }

    #[test]
    fn reroll_replaces_only_the_preview_after_a_distinct_vrf_request() {
        let reroll_rules = rules();
        let mut reroll_config = config();
        reroll_config.rules = reroll_rules;
        let mut simulation = Run::new(reroll_config).unwrap();
        simulation
            .apply_vrf_observed_with::<crate::SoftwareSha256, _>(
                reroll_rules,
                1,
                [9; 32],
                &mut crate::NoPresentation,
            )
            .unwrap();
        let grid = simulation.engine.grid;
        let preview = simulation.engine.next_row.unwrap();
        let replay_before = simulation.replay;

        simulation.request_reroll(reroll_rules, 0).unwrap();
        assert_eq!(simulation.engine.phase, RunPhase::AwaitingVrf);
        assert_eq!(simulation.engine.grid, grid);
        assert_eq!(simulation.engine.next_row, Some(preview));
        assert_eq!(simulation.engine.moves, 0);
        assert_eq!(simulation.action_counter, 1);
        assert_eq!(simulation.engine.reroll_charges, 0);
        assert_ne!(simulation.replay, replay_before);

        let replay_after_request = simulation.replay;
        simulation
            .apply_vrf_observed_with::<crate::SoftwareSha256, _>(
                reroll_rules,
                2,
                [10; 32],
                &mut crate::NoPresentation,
            )
            .unwrap();
        assert_eq!(simulation.engine.phase, RunPhase::Playing);
        assert_eq!(simulation.engine.grid, grid);
        assert_ne!(simulation.engine.next_row, Some(preview));
        assert_eq!(simulation.engine.moves, 0);
        assert_eq!(simulation.daily_score, 0);
        assert_eq!(simulation.objective_total, 0);
        assert_eq!(simulation.last_vrf_counter, 2);
        assert_ne!(simulation.replay, replay_after_request);
    }

    #[test]
    fn pending_reroll_is_an_accepted_action_at_deadline() {
        let reroll_rules = rules();
        let mut reroll_config = config();
        reroll_config.rules = reroll_rules;
        let mut simulation = Run::new(reroll_config).unwrap();
        simulation
            .apply_vrf_observed_with::<crate::SoftwareSha256, _>(
                reroll_rules,
                1,
                [9; 32],
                &mut crate::NoPresentation,
            )
            .unwrap();
        simulation.request_reroll(reroll_rules, 0).unwrap();

        simulation
            .finish_observed_with::<crate::SoftwareSha256, _>(
                reroll_rules,
                RunEndReason::Deadline,
                &mut crate::NoPresentation,
            )
            .unwrap();

        assert!(simulation.is_score_eligible());
        assert_eq!(simulation.end_reason, Some(RunEndReason::Deadline));
        assert_eq!(simulation.engine.next_row, None);
    }
}
