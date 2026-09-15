use super::*;
use solana::state::*;

pub fn address(day: u32, kind: DailyBoardKind) -> Pubkey {
    pda(&[
        ARENA_BOARD_SEED,
        accounts::daily_address(day).as_ref(),
        kind.seed(),
    ])
    .0
}

pub fn empty(day: u32) -> Value {
    let kind = DailyBoardKind::Score;
    let daily = accounts::daily_address(day);
    let (address, bump) = pda(&[ARENA_BOARD_SEED, daily.as_ref(), kind.seed()]);
    let plan = board_payout_plan(0, 0).unwrap();
    let board = ArenaBoard {
        version: ARCADE_ACCOUNT_VERSION,
        arena_daily: daily,
        day_id: day,
        kind,
        qualified_count: 0,
        width_count: plan.width_count,
        payout_count: plan.count,
        denominator: plan.denominator,
        pool_lamports: 0,
        paid_lamports: plan.paid_lamports,
        rollover_lamports: plan.rollover_lamports,
        capacity_limited: plan.capacity_limited,
        cursor: 0,
        sealed: true,
        sealed_at: NOW - 100,
        claimed_lamports: 0,
        claimed_count: 0,
        bump,
    };
    envelope(address, &board, ArenaBoard::account_space(0).unwrap())
}

pub fn board(
    day: u32,
    kind: DailyBoardKind,
    claimed: bool,
    sealed: bool,
    expired: bool,
    player: Pubkey,
) -> Value {
    with_terms(
        day,
        kind,
        player,
        Terms {
            claimed,
            sealed,
            sealed_at: if !sealed {
                0
            } else if expired {
                NOW - 31 * 86_400
            } else {
                NOW - 100
            },
            qualified: 1,
        },
    )
}

pub struct Terms {
    pub claimed: bool,
    pub sealed: bool,
    pub sealed_at: i64,
    pub qualified: u32,
}

pub fn with_terms(day: u32, kind: DailyBoardKind, player: Pubkey, terms: Terms) -> Value {
    let daily = accounts::daily_address(day);
    let (address, bump) = pda(&[ARENA_BOARD_SEED, daily.as_ref(), kind.seed()]);
    let pool = 1_000_000_000;
    let plan = board_payout_plan(pool, terms.qualified).unwrap();
    let mut board = ArenaBoard {
        version: ARCADE_ACCOUNT_VERSION,
        arena_daily: daily,
        day_id: day,
        kind,
        qualified_count: terms.qualified,
        width_count: plan.width_count,
        payout_count: plan.count,
        denominator: plan.denominator,
        pool_lamports: pool,
        paid_lamports: plan.paid_lamports,
        rollover_lamports: plan.rollover_lamports,
        capacity_limited: plan.capacity_limited,
        cursor: if terms.sealed { plan.count } else { 0 },
        sealed: terms.sealed,
        sealed_at: terms.sealed_at,
        claimed_lamports: 0,
        claimed_count: u32::from(terms.claimed),
        bump,
    };
    if terms.claimed {
        board.claimed_lamports = board.payout_for_position(0).unwrap();
    }
    let mut bytes = vec![0; ArenaBoard::account_space(plan.count).unwrap()];
    board.try_serialize(&mut &mut bytes[..]).unwrap();
    for index in 0..plan.count {
        let row = ArenaBoardEntry {
            player: if index == 0 {
                player
            } else {
                Pubkey::new_from_array([index as u8 + 10; 32])
            },
            score: plan.count - index,
            objective_total: u64::from(plan.count - index),
            finalized_at: NOW - 100,
            replay_hash: [7; 32],
        };
        let offset = ArenaBoard::HEADER_SIZE + index as usize * ARENA_BOARD_ENTRY_SIZE;
        row.serialize(&mut &mut bytes[offset..offset + ARENA_BOARD_ENTRY_SIZE])
            .unwrap();
    }
    if terms.claimed {
        bytes[ArenaBoard::HEADER_SIZE + plan.count as usize * ARENA_BOARD_ENTRY_SIZE] = 1;
    }
    json!({"address": address.to_string(), "owner": solana::ID.to_string(), "executable": false, "data": encoded(bytes)})
}

pub fn scenarios() -> Vec<Value> {
    ["oldest-theme", "second-score", "third-score", "claimed", "expired", "unsealed", "other-owner", "missing", "wrong-program"]
        .into_iter().enumerate().map(|(i, id)| {
            let days = match i { 0 => 3, 1 => 2, 2 => 1, _ => i + 1 };
            let day = DAY - days as u32;
            let kind = if i == 0 { DailyBoardKind::Theme } else { DailyBoardKind::Score };
            let mut envelope = if id == "missing" { Value::Null } else {
                board(day, kind, id == "claimed", id != "unsealed", id == "expired", if id == "other-owner" { validator() } else { owner() })
            };
            if id == "wrong-program" { envelope["owner"] = json!(validator().to_string()); }
            json!({"id": id, "day": day, "kind": if i == 0 { "theme" } else { "score" }, "envelope": envelope})
        }).collect()
}
