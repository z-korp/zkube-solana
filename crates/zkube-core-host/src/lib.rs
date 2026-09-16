#![forbid(unsafe_code)]

pub mod native;
mod run;

pub use run::{
    RUN_CONFIG_LEN, RUN_STATE_LEN, build_run_config, decode_run_config, decode_run_state,
    encode_run_config, encode_run_state, initialize_run, reconcile_run_state, run_apply_bonus,
    run_apply_vrf, run_end_reason, run_finish, run_play_move, run_request_reroll,
    run_score_eligible,
};

use zkube_core::{DailyBoardPools, PayoutError, ladder_points as core_ladder_points};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BoundaryError {
    InvalidLength,
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
    entry_price: u64,
    whole_unit: u64,
) -> Result<ProtocolPayoutPlan, BoundaryError> {
    let plan = zkube_core::rank_weighted_payouts::<{ zkube_core::ARENA_BOARD_CAPACITY }>(
        pool,
        qualified_winners,
        entry_price,
        whole_unit,
    )?;
    Ok(ProtocolPayoutPlan {
        payouts: plan.payouts
            [..usize::try_from(plan.winner_count).map_err(|_| BoundaryError::InvalidEncoding)?]
            .to_vec(),
        winner_count: plan.winner_count,
        width_winner_count: plan.width.winner_count,
        denominator: plan.width.denominator,
        capacity_limited: plan.winner_count < plan.width.winner_count,
        paid_lamports: plan.paid,
        rollover_lamports: plan.rollover,
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
mod wasm {
    use super::*;
    use wasm_bindgen::prelude::*;

    fn js_error(error: BoundaryError) -> JsError {
        let message = match error {
            BoundaryError::InvalidLength => "invalid byte length",
            BoundaryError::InvalidEncoding => "invalid run encoding",
            BoundaryError::Run(_) => "run transition rejected",
            BoundaryError::Randomness(_) => "randomness transition rejected",
            BoundaryError::Ladder(_) => "ladder rank is invalid",
            BoundaryError::Payout(_) => "payout input is invalid",
        };
        JsError::new(message)
    }

    #[wasm_bindgen(js_name = dayIdAt)]
    pub fn js_day_id_at(timestamp: i64) -> Result<u32, JsError> {
        zkube_core::day_id_at(timestamp)
            .map_err(|_| JsError::new("timestamp is outside supported days"))
    }
    #[wasm_bindgen(js_name = dailyWindow)]
    pub fn js_daily_window(day: u32) -> Vec<i64> {
        let (opens, closes, recovery) = zkube_core::daily_window(day);
        vec![opens, closes, recovery]
    }
    #[wasm_bindgen(js_name = scheduledDailyWindow)]
    pub fn js_scheduled_daily_window(day: u32, suspended: u32) -> Result<Vec<u32>, JsError> {
        let (first, following) = zkube_core::scheduled_daily_window(day, suspended)
            .map_err(|_| JsError::new("scheduled day overflows u32"))?;
        Ok(vec![first, following])
    }
    #[wasm_bindgen(js_name = nextScheduledDaily)]
    pub fn js_next_scheduled_daily(day: u32, suspended: u32) -> Result<u32, JsError> {
        zkube_core::next_scheduled_daily(day, suspended)
            .map_err(|_| JsError::new("scheduled day overflows u32"))
    }
    #[wasm_bindgen(js_name = compareBoardEntries)]
    pub fn js_compare_board_entries(
        left_metric: u64,
        left_time: i64,
        left_owner: &[u8],
        right_metric: u64,
        right_time: i64,
        right_owner: &[u8],
    ) -> Result<i32, JsError> {
        Ok(
            match zkube_core::compare_board_entries(
                left_metric,
                left_time,
                &array_32(left_owner).map_err(js_error)?,
                right_metric,
                right_time,
                &array_32(right_owner).map_err(js_error)?,
            ) {
                std::cmp::Ordering::Less => -1,
                std::cmp::Ordering::Equal => 0,
                std::cmp::Ordering::Greater => 1,
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

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
        let plan =
            payout_plan(pool, qualified, entry, zkube_core::SOL_PAYOUT_UNIT_LAMPORTS).unwrap();
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
}
