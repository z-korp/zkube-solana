use super::*;
use solana::state::*;

fn player_row(player: &PlayerState) -> Value {
    assert!(player.schema_valid());
    envelope(
        accounts::player_address(),
        player,
        8 + PlayerState::INIT_SPACE,
    )
}

pub fn scenarios() -> Value {
    let mut player = accounts::player(0, RUN_ID);
    player.ladder_points = 200;
    player.highest_ladder_tier = 4;
    player.featured_frame_tier = 0;
    player.campaign_stars = [255; zkube_core::CAMPAIGN_STAR_BYTES];
    let mut fresh = PlayerState::initialize(owner(), player.bump);
    fresh.next_run_id = RUN_ID;
    fresh.kredit_balance = 25;
    let purchases: Vec<_> = [1, 10, 25]
        .map(|count| {
            let mut after = accounts::player(0, RUN_ID);
            after.record_kredit_purchase(count).unwrap();
            json!({"pack": count, "player": player_row(&after)})
        })
        .into();
    let profiles: Vec<_> = [(8, 3), (0, 0), (0, 3), (12, 0), (10, 4)]
        .map(|(emblem, border)| {
            let mut after = player.clone();
            assert!(after.emblem_unlocked(emblem));
            assert!(border <= after.highest_ladder_tier);
            after.featured_emblem = emblem;
            after.featured_frame_tier = border;
            let instruction = transactions::instruction(
                solana::instruction::SetFeaturedEmblem { emblem_id: emblem, frame_tier: border },
                solana::accounts::SetFeaturedEmblem { player_state: accounts::player_address(),
                    owner_authority: owner(), session_token: Some(accounts::session_address()), actor: device() },
            );
            json!({"emblem": emblem, "border": border, "player": player_row(&after),
                "transaction": transactions::message("featured", device(), vec![instruction], true)})
        })
        .into();
    let day = DAY - 4;
    let mut claims = Vec::new();
    for (kind, qualified) in [(DailyBoardKind::Score, 30), (DailyBoardKind::Theme, 15)] {
        for variant in ["sealed", "deadline", "expired", "unsealed", "claimed"] {
            let at = match variant {
                "deadline" => NOW - zkube_core::DAILY_REWARD_CLAIM_WINDOW_SECONDS,
                "expired" => NOW - zkube_core::DAILY_REWARD_CLAIM_WINDOW_SECONDS - 1,
                "unsealed" => 0,
                _ => NOW - 100,
            };
            let row = |claimed| {
                boards::with_terms(
                    day,
                    kind,
                    owner(),
                    boards::Terms {
                        qualified,
                        claimed,
                        sealed: variant != "unsealed",
                        sealed_at: at,
                    },
                )
            };
            let points = zkube_core::ladder_points(qualified, 1).unwrap();
            let mut after = player.clone();
            after.record_ladder_points(points).unwrap();
            let plan = board_payout_plan(1_000_000_000, qualified).unwrap();
            let amount = zkube_core::payout_for_rank(
                1_000_000_000,
                plan.denominator,
                1,
                zkube_core::SOL_PAYOUT_UNIT_LAMPORTS,
            )
            .unwrap();
            claims.push(
                json!({"kind": if kind == DailyBoardKind::Score { "score" } else { "theme" },
                "variant": variant, "before": row(variant == "claimed"), "after": row(true),
                "playerAfter": player_row(&after), "points": points, "amountLamports": amount,
                "transaction": transactions::claim(day, kind)}),
            );
        }
    }
    let mut entered = accounts::player(RUN_ID, RUN_ID + 1);
    entered.kredit_balance = 24;
    let mut consumed = accounts::player(0, RUN_ID + 1);
    consumed.kredit_balance = 24;
    let mut daily = accounts::daily(day);
    daily.status = PeriodStatus::Finalized;
    daily.score_qualified_players = 30;
    daily.theme_qualified_players = 15;
    daily.ledger.seeded_lamports = 2_000_000_000;
    for qualified in [30, 15] {
        let plan = board_payout_plan(1_000_000_000, qualified).unwrap();
        daily.ledger.payout_lamports += plan.paid_lamports;
        daily.ledger.rollover_out_lamports += plan.rollover_lamports;
    }
    json!({"enteredPlayer": player_row(&entered), "consumedPlayer": player_row(&consumed),
        "profile": player_row(&player), "fresh": player_row(&fresh), "purchases": purchases,
        "profiles": profiles, "claims": claims, "claimDay": day,
        "claimDaily": envelope(accounts::daily_address(day), &daily, 8 + ArenaDaily::INIT_SPACE),
        "currentToken": device::token(device(), NOW + 3_600),
        "renewedToken": device::token(device::candidate(), NOW + 604_500)})
}
