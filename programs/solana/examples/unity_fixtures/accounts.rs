use super::*;
use solana::state::*;

pub fn singleton(seed: &[u8]) -> Pubkey {
    pda(&[seed]).0
}
pub fn player_address() -> Pubkey {
    pda(&[PLAYER_STATE_SEED, owner().as_ref()]).0
}
pub fn run_address(id: u64) -> Pubkey {
    pda(&[
        ACTIVE_RUN_SEED,
        b"active",
        owner().as_ref(),
        &id.to_le_bytes(),
    ])
    .0
}
pub fn daily_address(day: u32) -> Pubkey {
    pda(&[ARENA_DAILY_SEED, &day.to_le_bytes()]).0
}
pub fn participant_address(day: u32) -> Pubkey {
    pda(&[
        ARENA_PLAYER_SEED,
        daily_address(day).as_ref(),
        owner().as_ref(),
    ])
    .0
}
pub fn session_address() -> Pubkey {
    Pubkey::find_program_address(
        &[
            session_keys::SessionTokenV2::SEED_PREFIX.as_bytes(),
            solana::ID.as_ref(),
            device().as_ref(),
            owner().as_ref(),
        ],
        &session_keys::ID,
    )
    .0
}

pub fn player(active: u64, next: u64) -> PlayerState {
    let mut state = PlayerState::initialize(owner(), pda(&[PLAYER_STATE_SEED, owner().as_ref()]).1);
    state.next_run_id = next;
    state.active_run_id = active;
    state.active_run_daily = if active == 0 {
        Pubkey::default()
    } else {
        daily_address(DAY)
    };
    state.active_run_deadline_at = if active == 0 {
        0
    } else {
        NOW + ARENA_RUNS_CLOSE_OFFSET
    };
    state.kredit_balance = 25;
    state.ladder_points = RUN_ID;
    state.highest_ladder_tier = zkube_core::ladder_tier_for_points(state.ladder_points);
    state.featured_frame_tier = 2;
    state.entry_streak_days = 42;
    state.last_entry_day_id = DAY;
    state.campaign_stars[0] = 255;
    assert!(state.schema_valid());
    state
}

pub fn daily(day: u32) -> ArenaDaily {
    let selection = daily_content_for_day(day);
    let realm = zkube_core::REALM_RULES[usize::from(selection.realm_map_id - 1)];
    ArenaDaily {
        version: ARCADE_ACCOUNT_VERSION,
        day_id: day,
        arcade_config: singleton(ARCADE_CONFIG_SEED),
        status: PeriodStatus::Open,
        predecessor_rollover_applied: true,
        rules_hash: zkube_core::daily_rules_hash(
            day,
            realm.guardian,
            realm.starting_height,
            selection.objective.to_core().unwrap(),
        )
        .0,
        finalized_at: 0,
        ledger: PoolLedger::default(),
        entries_paid: 0,
        entries_scored: 0,
        entries_expired: 0,
        unique_players: 0,
        score_qualified_players: 0,
        theme_qualified_players: 0,
        claims_expired: false,
        bump: pda(&[ARENA_DAILY_SEED, &day.to_le_bytes()]).1,
    }
}

pub fn session(valid_until: i64) -> Value {
    let value = session_keys::SessionTokenV2 {
        authority: owner(),
        target_program: solana::ID,
        session_signer: device(),
        fee_payer: owner(),
        valid_until,
    };
    let mut result = envelope(session_address(), &value, session_keys::SessionTokenV2::LEN);
    result["owner"] = json!(session_keys::ID.to_string());
    result
}

pub fn scenarios() -> Value {
    let protocol = ProtocolConfig {
        version: ACCOUNT_VERSION,
        authority: owner(),
        pending_authority: Pubkey::default(),
        team_destination: validator(),
        replay_domain: [9; 32],
        paused: false,
        bump: pda(&[PROTOCOL_CONFIG_SEED]).1,
    };
    let mut arcade = ArcadeConfig::canonical(
        singleton(PROTOCOL_CONFIG_SEED),
        pda(&[ARCADE_CONFIG_SEED]).1,
    );
    arcade.launch_seeded = true;
    arcade.launch_day_id = DAY - 100;
    let credit = CreditVault {
        version: ARCADE_ACCOUNT_VERSION,
        protocol: singleton(PROTOCOL_CONFIG_SEED),
        purchased_prize_lamports: 225_000_000,
        spent_prize_lamports: 0,
        bump: pda(&[CREDIT_VAULT_SEED]).1,
    };
    json!({
        "protocol": envelope(singleton(PROTOCOL_CONFIG_SEED), &protocol, 8 + ProtocolConfig::INIT_SPACE),
        "arcade": envelope(singleton(ARCADE_CONFIG_SEED), &arcade, 8 + ArcadeConfig::INIT_SPACE),
        "credit": envelope(singleton(CREDIT_VAULT_SEED), &credit, 8 + CreditVault::INIT_SPACE),
        "daily": envelope(daily_address(DAY), &daily(DAY), 8 + ArenaDaily::INIT_SPACE),
        "following": envelope(daily_address(DAY + 1), &daily(DAY + 1), 8 + ArenaDaily::INIT_SPACE),
        "player": envelope(player_address(), &player(0, RUN_ID), 8 + PlayerState::INIT_SPACE),
        "session": session(NOW + 604_800), "expiredSession": session(NOW - 1),
    })
}
