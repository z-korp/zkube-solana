use super::*;
use solana::state::*;

pub fn finalized(day: u32) -> Value {
    let mut daily = accounts::daily(day);
    daily.status = PeriodStatus::Finalized;
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
        "claimDaily": finalized(day), "claimedBoard": boards::board(day, DailyBoardKind::Score, true, true, false, owner()),
        "claim": transactions::claim(day, DailyBoardKind::Score), "oldDay": old, "oldDaily": finalized(old),
        "oldScore": boards::board(old, DailyBoardKind::Score, false, true, false, owner()),
        "oldScoreClaimed": boards::board(old, DailyBoardKind::Score, true, true, false, owner()),
        "oldExpiredTheme": boards::board(old, DailyBoardKind::Theme, false, true, true, owner()),
        "oldScoreTransaction": transactions::claim(old, DailyBoardKind::Score)})
}
