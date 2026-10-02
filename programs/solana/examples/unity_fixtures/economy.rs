use super::*;
use solana::state::*;

pub fn finalized(day: u32) -> Value {
    finalized_at(day, NOW - 100)
}

pub fn finalized_at(day: u32, at: i64) -> Value {
    let mut daily = accounts::daily(day);
    daily.status = PeriodStatus::Finalized;
    daily.finalized_at = at;
    daily.score_qualified_players = 1;
    daily.theme_qualified_players = 1;
    let plan = board_payout_plan(1_000_000_000, 1).unwrap();
    daily.ledger.seeded_lamports = 2_000_000_000;
    daily.ledger.payout_lamports = 2 * plan.paid_lamports;
    daily.ledger.rollover_out_lamports = 2 * plan.rollover_lamports;
    envelope(
        accounts::daily_address(day),
        &daily,
        8 + ArenaDaily::INIT_SPACE,
    )
}
pub fn scenarios() -> Value {
    let day = DAY - 4;
    let old = DAY - 200;
    json!({"team": {"address": validator().to_string(), "owner": Pubkey::default().to_string(),
        "executable": false, "data": ""},
        "claimDaily": finalized(day), "claimedBoard": boards::board(day, DailyBoardKind::Score, true, true, owner()),
        "claim": transactions::claim(day, DailyBoardKind::Score), "oldDay": old, "oldDaily": finalized(old),
        "oldDailyExpired": finalized_at(old, NOW - zkube_core::DAILY_REWARD_CLAIM_WINDOW_SECONDS - 1),
        "oldScore": boards::board(old, DailyBoardKind::Score, false, true, owner()),
        "oldScoreClaimed": boards::board(old, DailyBoardKind::Score, true, true, owner()),
        "oldTheme": boards::board(old, DailyBoardKind::Theme, false, true, owner()),
        "oldScoreTransaction": transactions::claim(old, DailyBoardKind::Score)})
}
