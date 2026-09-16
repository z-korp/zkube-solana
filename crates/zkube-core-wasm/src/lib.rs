#![forbid(unsafe_code)]

pub mod native;
mod run;

pub use run::{
    RUN_CONFIG_LEN, RUN_STATE_LEN, build_run_config, decode_run_config, decode_run_state,
    encode_run_config, encode_run_state, initialize_run, reconcile_run_state, run_apply_bonus,
    run_apply_vrf, run_end_reason, run_finish, run_latched_star_sources, run_play_move,
    run_request_reroll, run_score_eligible,
};

use zkube_core::{
    BlockWeights, ChainDomain, ChallengeId, DailyBoardPools, PayoutError, ReplayCommitment,
    RulesHash, continuation_from_vrf, derive_player_id, ladder_points as core_ladder_points,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BoundaryError {
    InvalidLength,
    InvalidMode,
    InvalidEncoding,
    Run(zkube_core::RunTransitionError),
    Randomness(zkube_core::RandomnessError),
    Ladder(zkube_core::LadderError),
    Payout(PayoutError),
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

impl From<PayoutError> for BoundaryError {
    fn from(error: PayoutError) -> Self {
        Self::Payout(error)
    }
}

fn array_32(bytes: &[u8]) -> Result<[u8; 32], BoundaryError> {
    bytes.try_into().map_err(|_| BoundaryError::InvalidLength)
}

/// Merge two complete packed cosmetic records through the shared core rule.
///
/// # Errors
/// Rejects records whose encoded length differs from the packed star array.
pub fn merge_campaign_stars(stored: &[u8], incoming: &[u8]) -> Result<Vec<u8>, BoundaryError> {
    let mut stars = zkube_core::CampaignStars::from_packed(
        stored
            .try_into()
            .map_err(|_| BoundaryError::InvalidEncoding)?,
    );
    stars.merge(zkube_core::CampaignStars::from_packed(
        incoming
            .try_into()
            .map_err(|_| BoundaryError::InvalidEncoding)?,
    ));
    Ok(stars.packed().to_vec())
}

/// Host-compilable wallet-to-player-ID boundary.
///
/// # Errors
///
/// Rejects inputs other than 32 bytes.
pub fn qualified_player_id(
    chain_domain: &[u8],
    raw_account: &[u8],
) -> Result<[u8; 32], BoundaryError> {
    Ok(derive_player_id(ChainDomain(array_32(chain_domain)?), array_32(raw_account)?).to_bytes())
}

/// Host-compilable replay initialization used by generated JS glue.
///
/// # Errors
///
/// Rejects malformed identities or an unknown replay mode.
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
    if mode_tag != 0 {
        return Err(BoundaryError::InvalidMode);
    }
    Ok(ReplayCommitment::initial(
        domain,
        ChallengeId(array_32(challenge_id)?),
        RulesHash(array_32(rules_hash)?),
        player_id,
        run_id,
    )
    .to_bytes())
}

/// Return the post-perfect-clear seed row followed by its visible preview.
///
/// # Errors
///
/// Rejects malformed identities, weight arrays, or unplayable weights.
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

/// # Errors
///
/// Rejects an invalid ladder rank or qualified count.
pub fn ladder_points(qualified_entrants: u32, rank: u32) -> Result<u32, BoundaryError> {
    core_ladder_points(qualified_entrants, rank).map_err(Into::into)
}

#[must_use]
pub fn ladder_tier(points: u64) -> u8 {
    zkube_core::ladder_tier_for_points(points)
}

#[must_use]
pub fn ladder_tier_floor(tier: u8) -> u64 {
    zkube_core::ladder_tier_floor(tier)
}

#[must_use]
pub fn ladder_tier_count() -> u8 {
    zkube_core::LADDER_TIER_COUNT
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProtocolBoardWidth {
    pub winner_count: u32,
    pub denominator: u128,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProtocolPayoutPlan {
    pub payouts: Vec<u64>,
    pub winner_count: u32,
    pub width_winner_count: u32,
    pub denominator: u128,
    pub capacity_limited: bool,
    pub paid_lamports: u64,
    pub rollover_lamports: u64,
}

#[must_use]
#[allow(clippy::cast_possible_truncation)]
pub fn daily_pair_index(day_id: u32) -> u32 {
    zkube_core::daily_pair_index(day_id) as u32
}

#[must_use]
pub const fn daily_board_pools(pool: u64, theme_qualified: u32) -> DailyBoardPools {
    zkube_core::daily_board_pools(pool, theme_qualified)
}

/// # Errors
///
/// Returns the core payout error for invalid or overflowing inputs.
pub fn board_width(
    pool: u64,
    qualified_winners: u32,
    entry_price: u64,
    whole_unit: u64,
) -> Result<ProtocolBoardWidth, BoundaryError> {
    let width = zkube_core::board_width(pool, qualified_winners, entry_price, whole_unit)?;
    Ok(ProtocolBoardWidth {
        winner_count: width.winner_count,
        denominator: width.denominator,
    })
}

/// # Errors
///
/// Returns the core payout error or an overflow while summing the bounded plan.
pub fn payout_plan(
    pool: u64,
    qualified_winners: u32,
    capacity: u32,
    entry_price: u64,
    whole_unit: u64,
) -> Result<ProtocolPayoutPlan, BoundaryError> {
    let width = board_width(pool, qualified_winners, entry_price, whole_unit)?;
    let winner_count = width.winner_count.min(capacity);
    let mut payouts = Vec::with_capacity(
        usize::try_from(winner_count).map_err(|_| BoundaryError::Payout(PayoutError::Overflow))?,
    );
    let mut paid_lamports = 0u64;
    for rank in 1..=winner_count {
        let payout = payout_for_rank(pool, width.denominator, rank, whole_unit)?;
        paid_lamports = paid_lamports
            .checked_add(payout)
            .ok_or(BoundaryError::Payout(PayoutError::Overflow))?;
        payouts.push(payout);
    }
    Ok(ProtocolPayoutPlan {
        payouts,
        winner_count,
        width_winner_count: width.winner_count,
        denominator: width.denominator,
        capacity_limited: winner_count < width.winner_count,
        paid_lamports,
        rollover_lamports: pool
            .checked_sub(paid_lamports)
            .ok_or(BoundaryError::Payout(PayoutError::Overflow))?,
    })
}

/// # Errors
///
/// Returns the core payout error for invalid or overflowing inputs.
pub fn payout_for_rank(
    pool: u64,
    denominator: u128,
    rank: u32,
    whole_unit: u64,
) -> Result<u64, BoundaryError> {
    zkube_core::payout_for_rank(pool, denominator, rank, whole_unit).map_err(Into::into)
}

#[must_use]
pub fn encode_board_pools(pools: DailyBoardPools) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(16);
    bytes.extend_from_slice(&pools.score.to_le_bytes());
    bytes.extend_from_slice(&pools.theme.to_le_bytes());
    bytes
}

#[must_use]
pub fn encode_board_width(width: ProtocolBoardWidth) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(20);
    bytes.extend_from_slice(&width.winner_count.to_le_bytes());
    bytes.extend_from_slice(&width.denominator.to_le_bytes());
    bytes
}

#[must_use]
pub fn encode_payout_plan(plan: &ProtocolPayoutPlan) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(41 + plan.payouts.len() * 8);
    bytes.extend_from_slice(&plan.winner_count.to_le_bytes());
    bytes.extend_from_slice(&plan.width_winner_count.to_le_bytes());
    bytes.extend_from_slice(&plan.denominator.to_le_bytes());
    bytes.push(u8::from(plan.capacity_limited));
    bytes.extend_from_slice(&plan.paid_lamports.to_le_bytes());
    bytes.extend_from_slice(&plan.rollover_lamports.to_le_bytes());
    for payout in &plan.payouts {
        bytes.extend_from_slice(&payout.to_le_bytes());
    }
    bytes
}

#[cfg(all(feature = "wasm-bindgen", target_arch = "wasm32"))]
fn decode_u128(bytes: &[u8]) -> Result<u128, BoundaryError> {
    Ok(u128::from_le_bytes(
        bytes.try_into().map_err(|_| BoundaryError::InvalidLength)?,
    ))
}

#[cfg(all(feature = "wasm-bindgen", target_arch = "wasm32"))]
mod wasm {
    use super::*;
    use wasm_bindgen::prelude::*;

    fn js_error(error: BoundaryError) -> JsError {
        let message = match error {
            BoundaryError::InvalidLength => "invalid byte length",
            BoundaryError::InvalidMode => "replay mode must be 0 (ranked)",
            BoundaryError::InvalidEncoding => "invalid run encoding",
            BoundaryError::Run(_) => "run transition rejected",
            BoundaryError::Randomness(_) => "randomness transition rejected",
            BoundaryError::Ladder(_) => "ladder rank is invalid",
            BoundaryError::Payout(_) => "payout input is invalid",
        };
        JsError::new(message)
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
    pub fn js_ladder_tier(points: u64) -> u8 {
        ladder_tier(points)
    }

    #[wasm_bindgen(js_name = ladderTierFloor)]
    pub fn js_ladder_tier_floor(tier: u8) -> u64 {
        ladder_tier_floor(tier)
    }

    #[wasm_bindgen(js_name = ladderTierCount)]
    pub fn js_ladder_tier_count() -> u8 {
        ladder_tier_count()
    }

    #[wasm_bindgen(js_name = campaignMoveBudget)]
    pub fn js_campaign_move_budget(level: u8, tier: u8) -> Result<u16, JsError> {
        zkube_core::campaign_move_budget(level, tier)
            .ok_or_else(|| JsError::new("Campaign level or tier is invalid"))
    }

    #[wasm_bindgen(js_name = mergeCampaignStars)]
    pub fn js_merge_campaign_stars(stored: &[u8], incoming: &[u8]) -> Result<Vec<u8>, JsError> {
        merge_campaign_stars(stored, incoming).map_err(js_error)
    }

    #[wasm_bindgen(js_name = initializeRun)]
    pub fn js_initialize_run(config: &[u8]) -> Result<Vec<u8>, JsError> {
        initialize_run(config).map_err(js_error)
    }

    #[wasm_bindgen(js_name = buildRunConfig)]
    #[allow(clippy::too_many_arguments)]
    pub fn js_build_run_config(
        rules_hash: &[u8],
        initial_replay: &[u8],
        max_moves: u16,
        bonus: u8,
        trigger: u8,
        trigger_threshold: u16,
        starting_height: u8,
        tier_policy: u8,
        fixed_tier: u8,
        points_required: u32,
        primary_kind: u8,
        primary_value: u8,
        primary_count: u8,
        secondary_kind: u8,
        secondary_value: u8,
        secondary_count: u8,
        objective_kind: u8,
        objective_value: u8,
    ) -> Result<Vec<u8>, JsError> {
        build_run_config(
            rules_hash,
            initial_replay,
            max_moves,
            bonus,
            trigger,
            trigger_threshold,
            starting_height,
            tier_policy,
            fixed_tier,
            points_required,
            primary_kind,
            primary_value,
            primary_count,
            secondary_kind,
            secondary_value,
            secondary_count,
            objective_kind,
            objective_value,
        )
        .map_err(js_error)
    }

    #[wasm_bindgen(js_name = reconcileRunState)]
    #[allow(clippy::too_many_arguments)]
    pub fn js_reconcile_run_state(
        config: &[u8],
        phase: u8,
        end_reason: u8,
        bonus: u8,
        bonus_charges: u8,
        reroll_charges: u8,
        combo_counter: u8,
        max_combo: u8,
        primary_progress: u8,
        secondary_progress: u8,
        latched_star_sources: u8,
        streak: u8,
        charges_earned: u8,
        current_tier: u8,
        level_lines_cleared: u16,
        moves: u16,
        action_counter: u32,
        vrf_request_counter: u32,
        pending_vrf_counter: u32,
        score: u32,
        daily_score: u32,
        objective_total: u64,
        pressure_score: u32,
        grid: &[u8],
        next_row: &[u8],
        replay: &[u8],
    ) -> Result<Vec<u8>, JsError> {
        reconcile_run_state(
            config,
            phase,
            end_reason,
            bonus,
            bonus_charges,
            reroll_charges,
            combo_counter,
            max_combo,
            primary_progress,
            secondary_progress,
            latched_star_sources,
            streak,
            charges_earned,
            current_tier,
            level_lines_cleared,
            moves,
            action_counter,
            vrf_request_counter,
            pending_vrf_counter,
            score,
            daily_score,
            objective_total,
            pressure_score,
            grid,
            next_row,
            replay,
        )
        .map_err(js_error)
    }

    #[wasm_bindgen(js_name = applyRunVrf)]
    pub fn js_run_apply_vrf(
        config: &[u8],
        state: &[u8],
        request_counter: u32,
        vrf_output: &[u8],
    ) -> Result<Vec<u8>, JsError> {
        run_apply_vrf(config, state, request_counter, vrf_output).map_err(js_error)
    }

    #[wasm_bindgen(js_name = playRunMove)]
    #[allow(clippy::too_many_arguments)]
    pub fn js_run_play_move(
        config: &[u8],
        state: &[u8],
        action: u32,
        expected_move: u16,
        row: u8,
        start: u8,
        destination: u8,
    ) -> Result<Vec<u8>, JsError> {
        run_play_move(
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

    #[wasm_bindgen(js_name = applyRunBonus)]
    pub fn js_run_apply_bonus(
        config: &[u8],
        state: &[u8],
        action: u32,
        row: u8,
        column: u8,
    ) -> Result<Vec<u8>, JsError> {
        run_apply_bonus(config, state, action, row, column).map_err(js_error)
    }

    #[wasm_bindgen(js_name = requestRunReroll)]
    pub fn js_run_request_reroll(
        config: &[u8],
        state: &[u8],
        action: u32,
    ) -> Result<Vec<u8>, JsError> {
        run_request_reroll(config, state, action).map_err(js_error)
    }

    #[wasm_bindgen(js_name = finishRun)]
    pub fn js_run_finish(config: &[u8], state: &[u8], reason_tag: u8) -> Result<Vec<u8>, JsError> {
        run_finish(config, state, reason_tag).map_err(js_error)
    }

    #[wasm_bindgen(js_name = runScoreEligible)]
    pub fn js_run_score_eligible(state: &[u8]) -> Result<bool, JsError> {
        run_score_eligible(state).map_err(js_error)
    }

    #[wasm_bindgen(js_name = runLatchedStarSources)]
    pub fn js_run_latched_star_sources(state: &[u8]) -> Result<u8, JsError> {
        run_latched_star_sources(state).map_err(js_error)
    }

    #[wasm_bindgen(js_name = runEndReason)]
    pub fn js_run_end_reason(state: &[u8]) -> Result<u8, JsError> {
        run_end_reason(state).map_err(js_error)
    }

    #[wasm_bindgen(js_name = dailyPairIndex)]
    pub fn js_daily_pair_index(day_id: u32) -> u32 {
        daily_pair_index(day_id)
    }

    #[wasm_bindgen(js_name = dailyBoardPools)]
    pub fn js_daily_board_pools(pool: u64, theme_qualified: u32) -> Vec<u8> {
        encode_board_pools(daily_board_pools(pool, theme_qualified))
    }

    #[wasm_bindgen(js_name = boardWidth)]
    pub fn js_board_width(
        pool: u64,
        qualified_winners: u32,
        entry_price: u64,
        whole_unit: u64,
    ) -> Result<Vec<u8>, JsError> {
        board_width(pool, qualified_winners, entry_price, whole_unit)
            .map(encode_board_width)
            .map_err(js_error)
    }

    #[wasm_bindgen(js_name = payoutPlan)]
    pub fn js_payout_plan(
        pool: u64,
        qualified_winners: u32,
        capacity: u32,
        entry_price: u64,
        whole_unit: u64,
    ) -> Result<Vec<u8>, JsError> {
        payout_plan(pool, qualified_winners, capacity, entry_price, whole_unit)
            .map(|plan| encode_payout_plan(&plan))
            .map_err(js_error)
    }

    #[wasm_bindgen(js_name = payoutForRank)]
    pub fn js_payout_for_rank(
        pool: u64,
        denominator: &[u8],
        rank: u32,
        whole_unit: u64,
    ) -> Result<u64, JsError> {
        payout_for_rank(
            pool,
            decode_u128(denominator).map_err(js_error)?,
            rank,
            whole_unit,
        )
        .map_err(js_error)
    }
}

#[cfg(test)]
mod tests {
    mod golden_rules {
        use zkube_core::*;
        include!("../../zkube-core/src/golden_rules.rs");
    }
    use super::*;
    use serde_json::Value;
    use zkube_core::{Run, RunConfig, RunEndReason};

    fn decode_32(value: &str) -> [u8; 32] {
        let mut output = [0u8; 32];
        for (index, byte) in output.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).unwrap();
        }
        output
    }

    #[test]
    fn validates_lengths_and_modes_at_the_boundary() {
        for length in [0, 24, 26] {
            assert_eq!(
                merge_campaign_stars(&vec![0; length], &[0; 25]),
                Err(BoundaryError::InvalidEncoding)
            );
            assert_eq!(
                merge_campaign_stars(&[0; 25], &vec![0; length]),
                Err(BoundaryError::InvalidEncoding)
            );
        }
        assert_eq!(
            merge_campaign_stars(&[0x55; 25], &[0xaa; 25]).unwrap(),
            vec![0xaa; 25]
        );
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
    fn perfect_clear_boundary_returns_seed_and_preview() {
        let rows = empty_continuation_rows(29, &[7; 32], &[8; 32], &[16, 20, 22, 24, 18]).unwrap();
        assert!(rows[..8].contains(&0));
        assert!(rows[..8].iter().any(|cell| *cell != 0));
        assert!(rows[8..].contains(&0));
        assert!(rows[8..].iter().any(|cell| *cell != 0));
    }

    #[test]
    fn wasm_protocol_matches_native_golden_vectors() {
        let fixture: Value =
            serde_json::from_str(include_str!("../../../fixtures/game-parity.json")).unwrap();
        let draw = &fixture["phase1Core"]["dailyPairDraw"];
        let start = u32::try_from(draw["startsDay"].as_u64().unwrap()).unwrap();
        for (offset, expected) in draw["pairIndicesByDay"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
        {
            let day = start + u32::try_from(offset).unwrap();
            assert_eq!(
                daily_pair_index(day),
                u32::try_from(expected.as_u64().unwrap()).unwrap()
            );
        }

        let split = &fixture["phase1Core"]["dailyBoardSplit"];
        let pools = daily_board_pools(
            split["poolLamports"].as_u64().unwrap(),
            u32::try_from(split["themeQualifiedWinners"].as_u64().unwrap()).unwrap(),
        );
        assert_eq!(pools.score, split["scoreLamports"].as_u64().unwrap());
        assert_eq!(pools.theme, split["themeLamports"].as_u64().unwrap());
        assert_eq!(encode_board_pools(pools).len(), 16);

        let payout = &fixture["phase1Core"]["rankPayout"];
        let pool = payout["poolLamports"].as_u64().unwrap();
        let qualified = u32::try_from(payout["qualifiedWinners"].as_u64().unwrap()).unwrap();
        let entry = payout["entryPriceLamports"].as_u64().unwrap();
        let plan = payout_plan(
            pool,
            qualified,
            qualified,
            entry,
            zkube_core::SOL_PAYOUT_UNIT_LAMPORTS,
        )
        .unwrap();
        let width =
            board_width(pool, qualified, entry, zkube_core::SOL_PAYOUT_UNIT_LAMPORTS).unwrap();
        assert_eq!(width.winner_count, plan.width_winner_count);
        assert_eq!(width.denominator, plan.denominator);
        assert_eq!(encode_board_width(width).len(), 20);
        assert_eq!(
            plan.winner_count,
            u32::try_from(payout["winnerCount"].as_u64().unwrap()).unwrap()
        );
        assert_eq!(plan.paid_lamports, payout["paidLamports"].as_u64().unwrap());
        assert_eq!(
            plan.rollover_lamports,
            payout["rolloverLamports"].as_u64().unwrap()
        );
        for (index, expected) in payout["payoutsLamports"]
            .as_array()
            .unwrap()
            .iter()
            .take(plan.payouts.len())
            .enumerate()
        {
            let rank = u32::try_from(index + 1).unwrap();
            let amount = payout_for_rank(
                pool,
                width.denominator,
                rank,
                zkube_core::SOL_PAYOUT_UNIT_LAMPORTS,
            )
            .unwrap();
            assert_eq!(amount, expected.as_u64().unwrap());
            assert_eq!(plan.payouts[index], amount);
        }
        assert_eq!(encode_payout_plan(&plan).len(), 41 + plan.payouts.len() * 8);
    }

    #[test]
    fn wasm_run_matches_native_golden_vectors() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../fixtures/replays/golden-daily-run-v1.json"
        ))
        .unwrap();
        let rules =
            golden_rules::fixture_rules(&serde_json::from_value(fixture["rules"].clone()).unwrap());
        let config = RunConfig {
            rules_hash: RulesHash(decode_32(fixture["rules_hash_hex"].as_str().unwrap())),
            rules,
            initial_replay: ReplayCommitment(decode_32(
                fixture["initial_replay_hash_hex"].as_str().unwrap(),
            )),
        };
        let config_bytes = encode_run_config(config);
        let mut native = Run::new(config).unwrap();
        let mut state = initialize_run(&config_bytes).unwrap();
        assert_eq!(decode_run_state(&state).unwrap(), native);

        native.apply_vrf(rules, 1, [0x11; 32]).unwrap();
        state = run_apply_vrf(&config_bytes, &state, 1, &[0x11; 32]).unwrap();
        assert_eq!(decode_run_state(&state).unwrap(), native);
        let movement = &fixture["events"][1];
        let row = u8::try_from(movement["row"].as_u64().unwrap()).unwrap();
        let start = u8::try_from(movement["start"].as_u64().unwrap()).unwrap();
        let destination = u8::try_from(movement["destination"].as_u64().unwrap()).unwrap();
        native
            .play_move(rules, 0, 0, row, start, destination)
            .unwrap();
        state = run_play_move(&config_bytes, &state, 0, 0, row, start, destination).unwrap();
        assert_eq!(decode_run_state(&state).unwrap(), native);
        native.apply_vrf(rules, 2, [0x22; 32]).unwrap();
        state = run_apply_vrf(&config_bytes, &state, 2, &[0x22; 32]).unwrap();
        native.finish(rules, RunEndReason::Deadline).unwrap();
        state = run_finish(&config_bytes, &state, 4).unwrap();

        let boundary = decode_run_state(&state).unwrap();
        assert_eq!(boundary, native);
        assert_eq!(run_end_reason(&state).unwrap(), 4);
        assert!(run_score_eligible(&state).unwrap());
        assert_eq!(
            boundary.replay.to_bytes(),
            decode_32(
                fixture["expected"]["final_replay_hash_hex"]
                    .as_str()
                    .unwrap()
            )
        );
    }
}
