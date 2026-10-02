use super::*;
use solana::state::*;

pub fn finalized(day: u32) -> Value {
    finalized_at(day, NOW - 100)
}

pub fn finalized_at(day: u32, at: i64) -> Value {
    let mut daily = accounts::daily(day);
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
// Yesterday's played Daily and today's, the moment before and the moment
// after the program finalizes yesterday into today, and the protocol on a
// quiet day when today's Daily does not exist yet.
fn cadence() -> Value {
    let row = |daily: &ArenaDaily| {
        envelope(
            accounts::daily_address(daily.day_id),
            daily,
            8 + ArenaDaily::INIT_SPACE,
        )
    };
    let mut yesterday = accounts::daily(DAY - 1);
    yesterday.ledger.seeded_lamports = 2_000_000_000;
    yesterday.ledger.rollover_in_lamports = 123_456_789;
    yesterday.entries_paid = 7;
    yesterday.entries_scored = 6;
    yesterday.unique_players = 5;
    yesterday.score_qualified_players = 5;
    yesterday.theme_qualified_players = 3;
    yesterday.ledger.next_pot_lamports = 7 * zkube_core::ENTRY_DAILY_LAMPORTS;
    let mut today = accounts::daily(DAY);
    today.predecessor_rollover_applied = false;
    today.ledger.seeded_lamports = 50_000_000;
    today.entries_paid = 2;
    today.ledger.next_pot_lamports = 2 * zkube_core::ENTRY_DAILY_LAMPORTS;
    let (mut finalized, mut received) = (yesterday.clone(), today.clone());
    let settlement = finalized.settle_into(&mut received, NOW).unwrap();
    assert!(
        settlement.score.paid_lamports > 0
            && settlement.forwarded_lamports > yesterday.ledger.next_pot_lamports
    );
    let root = |last_finalized: u32, last_prepared: u32| {
        let mut protocol = accounts::protocol();
        protocol.last_daily_id = last_finalized;
        protocol.last_prepared_day = last_prepared;
        envelope(
            accounts::singleton(PROTOCOL_CONFIG_SEED),
            &protocol,
            8 + ProtocolConfig::INIT_SPACE,
        )
    };
    // A backlog with no keeper: nine empty Dailies on scattered days, none
    // finalized, the newest three days old. The root is shown at the start
    // and after the oldest two, and all but the newest, have finalized.
    let days = [39, 20, 19, 8, 7, 6, 5, 4, 3].map(|ago| DAY - ago);
    let backlog: Vec<_> = days
        .iter()
        .enumerate()
        .map(|(index, day)| {
            let mut daily = accounts::daily(*day);
            daily.predecessor_day = if index == 0 { DAY - 40 } else { days[index - 1] };
            daily.predecessor_rollover_applied = index == 0;
            row(&daily)
        })
        .collect();
    json!({"yesterday": row(&yesterday), "today": row(&today),
        "yesterdayFinalized": row(&finalized), "todayReceived": row(&received),
        "forwarded": settlement.forwarded_lamports.to_string(),
        "protocol": root(DAY - 2, DAY), "quietProtocol": root(DAY - 2, DAY - 1),
        "backlog": {"days": days, "dailies": backlog, "start": root(DAY - 40, DAY - 3),
            "advanced": root(DAY - 20, DAY - 3), "last": root(DAY - 4, DAY - 3)}})
}

pub fn scenarios() -> Value {
    let day = DAY - 4;
    let old = DAY - 200;
    json!({"team": {"address": validator().to_string(), "owner": Pubkey::default().to_string(),
        "executable": false, "data": ""},
        "cadence": cadence(), "claimDaily": finalized(day), "claimedBoard": boards::board(day, DailyBoardKind::Score, true, true, owner()),
        "claim": transactions::claim(day, DailyBoardKind::Score), "oldDay": old, "oldDaily": finalized(old),
        "oldDailyExpired": finalized_at(old, NOW - zkube_core::DAILY_REWARD_CLAIM_WINDOW_SECONDS - 1),
        "oldScore": boards::board(old, DailyBoardKind::Score, false, true, owner()),
        "oldScoreClaimed": boards::board(old, DailyBoardKind::Score, true, true, owner()),
        "oldTheme": boards::board(old, DailyBoardKind::Theme, false, true, owner()),
        "oldScoreTransaction": transactions::claim(old, DailyBoardKind::Score)})
}
