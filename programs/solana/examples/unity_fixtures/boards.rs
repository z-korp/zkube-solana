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
    with_terms(
        day,
        DailyBoardKind::Score,
        owner(),
        Terms {
            claimed: false,
            sealed: true,
            qualified: 0,
        },
    )
}

pub fn board(day: u32, kind: DailyBoardKind, claimed: bool, sealed: bool, player: Pubkey) -> Value {
    with_terms(
        day,
        kind,
        player,
        Terms {
            claimed,
            sealed,
            qualified: 1,
        },
    )
}

pub struct Terms {
    pub claimed: bool,
    /// A sealed board belongs to a finalized Daily: its paying rows and their
    /// claim bits. Otherwise it is the live board of a running Daily: the
    /// retained rows only, with the payout fields still zero.
    pub sealed: bool,
    pub qualified: u32,
}

pub fn with_terms(day: u32, kind: DailyBoardKind, player: Pubkey, terms: Terms) -> Value {
    let daily = accounts::daily_address(day);
    let (address, bump) = pda(&[ARENA_BOARD_SEED, daily.as_ref(), kind.seed()]);
    let pool = if terms.qualified == 0 { 0 } else { 1_000_000_000 };
    let plan = board_payout_plan(pool, terms.qualified).unwrap();
    let mut board = ArenaBoard {
        version: ACCOUNT_VERSION,
        arena_daily: daily,
        day_id: day,
        kind,
        bump,
        ..ArenaBoard::default()
    };
    if terms.sealed {
        board.qualified_count = terms.qualified;
        board.width_count = plan.width_count;
        board.payout_count = plan.count;
        board.denominator = plan.denominator;
        board.pool_lamports = pool;
        board.paid_lamports = plan.paid_lamports;
        board.rollover_lamports = plan.rollover_lamports;
        board.capacity_limited = plan.capacity_limited;
        board.claimed_count = u32::from(terms.claimed);
        if terms.claimed {
            board.claimed_lamports = board.payout_for_position(0).unwrap();
        }
    }
    let rows = plan.count;
    let space = if terms.sealed {
        ArenaBoard::account_space(rows).unwrap()
    } else {
        ArenaBoard::open_space(rows as usize).unwrap()
    };
    let mut bytes = vec![0; space];
    board.try_serialize(&mut &mut bytes[..]).unwrap();
    for index in 0..rows {
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
        let offset = ArenaBoard::HEADER_SIZE + index as usize * ArenaBoardEntry::INIT_SPACE;
        row.serialize(&mut &mut bytes[offset..offset + ArenaBoardEntry::INIT_SPACE])
            .unwrap();
    }
    if terms.sealed && terms.claimed {
        bytes[ArenaBoard::HEADER_SIZE + rows as usize * ArenaBoardEntry::INIT_SPACE] = 1;
    }
    json!({"address": address.to_string(), "owner": solana::ID.to_string(), "executable": false, "data": encoded(bytes)})
}

/// The Daily a board scenario belongs to. A board carries no clock: it is
/// sealed when its Daily is finalized, and its claims run from that moment.
pub fn daily(day: u32, variant: &str) -> Value {
    match variant {
        "unsealed" => envelope(
            accounts::daily_address(day),
            &accounts::daily(day),
            8 + ArenaDaily::INIT_SPACE,
        ),
        "expired" => economy::finalized_at(
            day,
            NOW - zkube_core::DAILY_REWARD_CLAIM_WINDOW_SECONDS - 1,
        ),
        "deadline" => economy::finalized_at(day, NOW - zkube_core::DAILY_REWARD_CLAIM_WINDOW_SECONDS),
        _ => economy::finalized(day),
    }
}

pub fn scenarios() -> Vec<Value> {
    ["oldest-theme", "second-score", "third-score", "claimed", "expired", "unsealed", "other-owner", "missing", "wrong-program"]
        .into_iter().enumerate().map(|(i, id)| {
            let days = match i { 0 => 3, 1 => 2, 2 => 1, _ => i + 1 };
            let day = DAY - days as u32;
            let kind = if i == 0 { DailyBoardKind::Theme } else { DailyBoardKind::Score };
            let mut envelope = if id == "missing" { Value::Null } else {
                board(day, kind, id == "claimed", id != "unsealed", if id == "other-owner" { validator() } else { owner() })
            };
            if id == "wrong-program" { envelope["owner"] = json!(validator().to_string()); }
            json!({"id": id, "day": day, "kind": if i == 0 { "theme" } else { "score" }, "envelope": envelope,
                "daily": daily(day, id)})
        }).collect()
}
