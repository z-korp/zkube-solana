#![forbid(unsafe_code)]

mod campaign;
mod simulation;

pub use campaign::{
    CAMPAIGN_SIMULATION_CONFIG_LEN, CAMPAIGN_SIMULATION_STATE_LEN, campaign_simulation_abandon,
    campaign_simulation_apply_bonus, campaign_simulation_end_reason,
    campaign_simulation_latched_star_sources, campaign_simulation_play_move,
    campaign_simulation_request_reroll, decode_campaign_simulation_config,
    decode_campaign_simulation_state, encode_campaign_simulation_config,
    encode_campaign_simulation_state, initialize_campaign_simulation,
};
pub use simulation::{
    DAILY_SIMULATION_CONFIG_LEN, DAILY_SIMULATION_STATE_LEN, decode_daily_simulation_config,
    decode_daily_simulation_state, encode_daily_simulation_config, encode_daily_simulation_state,
    initialize_daily_simulation, simulation_apply_bonus, simulation_apply_vrf,
    simulation_finish_deadline, simulation_play_move, simulation_request_reroll,
    simulation_score_eligible,
};

use zkube_core::{
    BlockWeights, ChainDomain, ChallengeId, ReplayCommitment, ReplayMode, RulesHash,
    continuation_from_vrf, derive_player_id, ladder_points as core_ladder_points,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BoundaryError {
    InvalidLength,
    InvalidMode,
    InvalidEncoding,
    Run(zkube_core::RunTransitionError),
    Randomness(zkube_core::RandomnessError),
    Ladder(zkube_core::LadderError),
}

impl From<zkube_core::RunTransitionError> for BoundaryError {
    fn from(error: zkube_core::RunTransitionError) -> Self {
        Self::Run(error)
    }
}

impl From<zkube_core::RandomnessError> for BoundaryError {
    fn from(error: zkube_core::RandomnessError) -> Self {
        Self::Randomness(error)
    }
}

impl From<zkube_core::LadderError> for BoundaryError {
    fn from(error: zkube_core::LadderError) -> Self {
        Self::Ladder(error)
    }
}

fn array_32(bytes: &[u8]) -> Result<[u8; 32], BoundaryError> {
    bytes.try_into().map_err(|_| BoundaryError::InvalidLength)
}

/// Host-compilable form of the wallet-to-player-ID boundary.
///
/// # Errors
///
/// Returns [`BoundaryError::InvalidLength`] unless both inputs are 32 bytes.
pub fn qualified_player_id(
    chain_domain: &[u8],
    raw_account: &[u8],
) -> Result<[u8; 32], BoundaryError> {
    Ok(derive_player_id(ChainDomain(array_32(chain_domain)?), array_32(raw_account)?).to_bytes())
}

/// Host-compilable form of replay initialization used by generated JS glue.
///
/// # Errors
///
/// Returns [`BoundaryError::InvalidLength`] unless every byte identity is 32
/// bytes, or [`BoundaryError::InvalidMode`] for an unknown mode tag.
#[allow(clippy::too_many_arguments)]
pub fn initial_replay_commitment(
    chain_domain: &[u8],
    challenge_id: &[u8],
    rules_hash: &[u8],
    raw_account: &[u8],
    run_id: u64,
    mode_tag: u8,
) -> Result<[u8; 32], BoundaryError> {
    let domain = ChainDomain(array_32(chain_domain)?);
    let player_id = derive_player_id(domain, array_32(raw_account)?);
    let mode = match mode_tag {
        0 => ReplayMode::Ranked,
        _ => return Err(BoundaryError::InvalidMode),
    };
    Ok(ReplayCommitment::initial(
        domain,
        ChallengeId(array_32(challenge_id)?),
        RulesHash(array_32(rules_hash)?),
        player_id,
        run_id,
        mode,
    )
    .to_bytes())
}

/// Return the post-perfect-clear seed row followed by its visible preview.
///
/// # Errors
///
/// Rejects non-32-byte VRF/rules inputs, a weight slice other than five
/// values, or unplayable weights.
pub fn empty_continuation_rows(
    request_counter: u32,
    vrf_output: &[u8],
    rules_hash: &[u8],
    weights: &[u16],
) -> Result<[u8; 16], BoundaryError> {
    let weights: [u16; 5] = weights
        .try_into()
        .map_err(|_| BoundaryError::InvalidLength)?;
    let layout = continuation_from_vrf(
        array_32(vrf_output)?,
        request_counter,
        array_32(rules_hash)?,
        BlockWeights { values: weights },
    )?;
    let mut rows = [0u8; 16];
    rows[..8].copy_from_slice(layout.grid.row(0).ok_or(BoundaryError::InvalidEncoding)?);
    rows[8..].copy_from_slice(&layout.preview);
    Ok(rows)
}

/// Host-compilable form of the deterministic ladder boundary.
///
/// # Errors
///
/// Rejects rank zero, an empty qualified field, or a rank beyond the field.
pub fn ladder_points(qualified_entrants: u32, rank: u32) -> Result<u32, BoundaryError> {
    core_ladder_points(qualified_entrants, rank).map_err(Into::into)
}

/// Host-compilable form of the tier boundary.
///
/// The program stores a tier and the client draws one, so both read it here
/// rather than each carrying its own copy of the thresholds.
#[must_use]
pub fn ladder_tier(points: u64) -> u8 {
    zkube_core::ladder_tier_for_points(points)
}

/// Cumulative-point floor of `tier`, saturating at the highest tier.
#[must_use]
pub fn ladder_tier_floor(tier: u8) -> u64 {
    zkube_core::ladder_tier_floor(tier)
}

/// Number of named tiers.
#[must_use]
pub fn ladder_tier_count() -> u8 {
    zkube_core::LADDER_TIER_COUNT
}

#[cfg(all(feature = "wasm-bindgen", target_arch = "wasm32"))]
mod wasm {
    use super::{
        BoundaryError, campaign_simulation_abandon, campaign_simulation_apply_bonus,
        campaign_simulation_end_reason, campaign_simulation_latched_star_sources,
        campaign_simulation_play_move, campaign_simulation_request_reroll, empty_continuation_rows,
        initial_replay_commitment, initialize_campaign_simulation, initialize_daily_simulation,
        ladder_points, ladder_tier, ladder_tier_count, ladder_tier_floor, qualified_player_id,
        simulation_apply_bonus, simulation_apply_vrf, simulation_finish_deadline,
        simulation_play_move, simulation_request_reroll, simulation_score_eligible,
    };
    use wasm_bindgen::prelude::*;

    fn js_error(error: BoundaryError) -> JsError {
        match error {
            BoundaryError::InvalidLength => JsError::new("invalid byte length"),
            BoundaryError::InvalidMode => JsError::new("replay mode must be 0 (ranked)"),
            BoundaryError::InvalidEncoding => JsError::new("invalid simulation encoding"),
            BoundaryError::Run(_) => JsError::new("run transition rejected"),
            BoundaryError::Randomness(_) => JsError::new("randomness transition rejected"),
            BoundaryError::Ladder(_) => JsError::new("ladder rank is invalid"),
        }
    }

    #[wasm_bindgen(js_name = qualifiedPlayerId)]
    pub fn js_qualified_player_id(
        chain_domain: &[u8],
        raw_account: &[u8],
    ) -> Result<Vec<u8>, JsError> {
        qualified_player_id(chain_domain, raw_account)
            .map(|bytes| bytes.to_vec())
            .map_err(js_error)
    }

    #[wasm_bindgen(js_name = initialReplayCommitment)]
    #[allow(clippy::too_many_arguments)]
    pub fn js_initial_replay_commitment(
        chain_domain: &[u8],
        challenge_id: &[u8],
        rules_hash: &[u8],
        raw_account: &[u8],
        run_id: u64,
        mode_tag: u8,
    ) -> Result<Vec<u8>, JsError> {
        initial_replay_commitment(
            chain_domain,
            challenge_id,
            rules_hash,
            raw_account,
            run_id,
            mode_tag,
        )
        .map(|bytes| bytes.to_vec())
        .map_err(js_error)
    }

    #[wasm_bindgen(js_name = emptyContinuationRows)]
    pub fn js_empty_continuation_rows(
        request_counter: u32,
        vrf_output: &[u8],
        rules_hash: &[u8],
        weights: &[u16],
    ) -> Result<Vec<u8>, JsError> {
        empty_continuation_rows(request_counter, vrf_output, rules_hash, weights)
            .map(|rows| rows.to_vec())
            .map_err(js_error)
    }

    #[wasm_bindgen(js_name = ladderPoints)]
    pub fn js_ladder_points(qualified_entrants: u32, rank: u32) -> Result<u32, JsError> {
        ladder_points(qualified_entrants, rank).map_err(js_error)
    }

    #[wasm_bindgen(js_name = ladderTier)]
    #[must_use]
    pub fn js_ladder_tier(points: u64) -> u8 {
        ladder_tier(points)
    }

    #[wasm_bindgen(js_name = ladderTierFloor)]
    #[must_use]
    pub fn js_ladder_tier_floor(tier: u8) -> u64 {
        ladder_tier_floor(tier)
    }

    #[wasm_bindgen(js_name = ladderTierCount)]
    #[must_use]
    pub fn js_ladder_tier_count() -> u8 {
        ladder_tier_count()
    }

    #[wasm_bindgen(js_name = initializeDailySimulation)]
    pub fn js_initialize_daily_simulation(
        config: &[u8],
        request_counter: u32,
        vrf_output: &[u8],
    ) -> Result<Vec<u8>, JsError> {
        initialize_daily_simulation(config, request_counter, vrf_output).map_err(js_error)
    }

    #[wasm_bindgen(js_name = applyDailySimulationVrf)]
    pub fn js_simulation_apply_vrf(
        config: &[u8],
        state: &[u8],
        request_counter: u32,
        vrf_output: &[u8],
    ) -> Result<Vec<u8>, JsError> {
        simulation_apply_vrf(config, state, request_counter, vrf_output).map_err(js_error)
    }

    #[wasm_bindgen(js_name = playDailySimulationMove)]
    #[allow(clippy::too_many_arguments)]
    pub fn js_simulation_play_move(
        config: &[u8],
        state: &[u8],
        action: u32,
        expected_move: u16,
        row: u8,
        start: u8,
        destination: u8,
    ) -> Result<Vec<u8>, JsError> {
        simulation_play_move(
            config,
            state,
            action,
            expected_move,
            row,
            start,
            destination,
        )
        .map_err(js_error)
    }

    #[wasm_bindgen(js_name = applyDailySimulationBonus)]
    pub fn js_simulation_apply_bonus(
        config: &[u8],
        state: &[u8],
        action: u32,
        row: u8,
        column: u8,
    ) -> Result<Vec<u8>, JsError> {
        simulation_apply_bonus(config, state, action, row, column).map_err(js_error)
    }

    #[wasm_bindgen(js_name = requestDailySimulationReroll)]
    pub fn js_simulation_request_reroll(
        config: &[u8],
        state: &[u8],
        action: u32,
    ) -> Result<Vec<u8>, JsError> {
        simulation_request_reroll(config, state, action).map_err(js_error)
    }

    #[wasm_bindgen(js_name = requestCampaignSimulationReroll)]
    pub fn js_campaign_simulation_request_reroll(
        config: &[u8],
        state: &[u8],
    ) -> Result<Vec<u8>, JsError> {
        campaign_simulation_request_reroll(config, state).map_err(js_error)
    }

    #[wasm_bindgen(js_name = finishDailySimulationAtDeadline)]
    pub fn js_simulation_finish_deadline(config: &[u8], state: &[u8]) -> Result<Vec<u8>, JsError> {
        simulation_finish_deadline(config, state).map_err(js_error)
    }

    #[wasm_bindgen(js_name = dailySimulationScoreEligible)]
    pub fn js_simulation_score_eligible(state: &[u8]) -> Result<bool, JsError> {
        simulation_score_eligible(state).map_err(js_error)
    }

    #[wasm_bindgen(js_name = initializeCampaignSimulation)]
    pub fn js_initialize_campaign_simulation(config: &[u8]) -> Result<Vec<u8>, JsError> {
        initialize_campaign_simulation(config).map_err(js_error)
    }

    #[wasm_bindgen(js_name = playCampaignMove)]
    pub fn js_campaign_simulation_play_move(
        config: &[u8],
        state: &[u8],
        expected_move: u16,
        row: u8,
        start: u8,
        destination: u8,
    ) -> Result<Vec<u8>, JsError> {
        campaign_simulation_play_move(config, state, expected_move, row, start, destination)
            .map_err(js_error)
    }

    #[wasm_bindgen(js_name = applyCampaignBonus)]
    pub fn js_campaign_simulation_apply_bonus(
        config: &[u8],
        state: &[u8],
        row: u8,
        column: u8,
    ) -> Result<Vec<u8>, JsError> {
        campaign_simulation_apply_bonus(config, state, row, column).map_err(js_error)
    }

    #[wasm_bindgen(js_name = abandonCampaignRun)]
    pub fn js_campaign_simulation_abandon(config: &[u8], state: &[u8]) -> Result<Vec<u8>, JsError> {
        campaign_simulation_abandon(config, state).map_err(js_error)
    }

    #[wasm_bindgen(js_name = campaignRunLatchedStarSources)]
    pub fn js_campaign_simulation_latched_star_sources(state: &[u8]) -> Result<u8, JsError> {
        campaign_simulation_latched_star_sources(state).map_err(js_error)
    }

    #[wasm_bindgen(js_name = campaignRunEndReason)]
    pub fn js_campaign_simulation_end_reason(state: &[u8]) -> Result<u8, JsError> {
        campaign_simulation_end_reason(state).map_err(js_error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_lengths_and_modes_at_the_boundary() {
        assert_eq!(
            qualified_player_id(&[0; 31], &[0; 32]),
            Err(BoundaryError::InvalidLength)
        );
        assert_eq!(
            initial_replay_commitment(&[0; 32], &[0; 32], &[0; 32], &[0; 32], 1, 2),
            Err(BoundaryError::InvalidMode)
        );
    }

    #[test]
    fn host_boundary_matches_core() {
        let domain = [1; 32];
        let account = [2; 32];
        assert_eq!(
            qualified_player_id(&domain, &account).unwrap(),
            derive_player_id(ChainDomain(domain), account).to_bytes()
        );
        assert_eq!(ladder_points(30, 1).unwrap(), 170);
    }

    #[test]
    fn perfect_clear_boundary_returns_seed_and_preview() {
        let rows = empty_continuation_rows(29, &[7; 32], &[8; 32], &[16, 20, 22, 24, 18]).unwrap();
        assert!(rows[..8].contains(&0));
        assert!(rows[..8].iter().any(|cell| *cell != 0));
        assert!(rows[8..].contains(&0));
        assert!(rows[8..].iter().any(|cell| *cell != 0));
    }
}
