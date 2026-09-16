#![cfg(feature = "sbf-tests")]

use std::io::Cursor;

use anchor_lang::prelude::{AccountDeserialize, AccountSerialize, Pubkey};
use anchor_lang::{AnchorSerialize, InstructionData, Space, ToAccountMetas};
use mollusk_svm::Mollusk;
use session_keys::SessionTokenV2;
use solana_account::Account;

use solana as zkube;
use zkube::state::arcade::*;
use zkube::state::protocol::*;

const PROGRAM_NAME: &str = "solana";
const ACCOUNT_LAMPORTS: u64 = 10_000_000;

fn mollusk() -> Mollusk {
    Mollusk::new(&zkube::ID, PROGRAM_NAME)
}

fn system_account(lamports: u64) -> Account {
    Account::new(lamports, 0, &anchor_lang::system_program::ID)
}

fn system_program_account() -> Account {
    Account {
        lamports: 1,
        data: Vec::new(),
        owner: Pubkey::from_str_const("NativeLoader1111111111111111111111111111111"),
        executable: true,
        rent_epoch: 0,
    }
}

fn executable_program_account(owner: Pubkey) -> Account {
    Account {
        lamports: 1,
        data: Vec::new(),
        owner,
        executable: true,
        rent_epoch: 0,
    }
}

fn serialized_account<T: AccountSerialize>(
    value: &T,
    space: usize,
    owner: Pubkey,
    lamports: u64,
) -> Account {
    let mut data = vec![0; space];
    value
        .try_serialize(&mut Cursor::new(&mut data[..]))
        .expect("serialize account fixture");
    Account {
        lamports,
        data,
        owner,
        executable: false,
        rent_epoch: 0,
    }
}

fn program_account<T: AccountSerialize>(value: &T, space: usize) -> Account {
    serialized_account(value, space, zkube::ID, ACCOUNT_LAMPORTS)
}

fn decode<T: AccountDeserialize>(account: &Account) -> T {
    T::try_deserialize(&mut account.data.as_slice()).expect("decode resulting account")
}

fn daily_map_rule_fixture() -> RealmRuleSnapshot {
    RealmRuleSnapshot {
        guardian: GuardianSnapshot {
            bonus: 1,
            trigger: 1,
            threshold: 10,
        },
        starting_rows: 4,
    }
}

fn resulting_account<'a>(
    result: &'a mollusk_svm::result::InstructionResult,
    key: &Pubkey,
) -> &'a Account {
    &result
        .resulting_accounts
        .iter()
        .find(|(address, _)| address == key)
        .expect("resulting account")
        .1
}

fn protocol_fixture(
    authority: Pubkey,
    team_destination: Pubkey,
    paused: bool,
) -> (Pubkey, ProtocolConfig) {
    let (address, bump) = Pubkey::find_program_address(&[PROTOCOL_CONFIG_SEED], &zkube::ID);
    (
        address,
        ProtocolConfig {
            version: ACCOUNT_VERSION,
            authority,
            team_destination,
            replay_domain: [9; 32],
            paused,
            bump,
        },
    )
}

fn player_fixture(owner: Pubkey) -> (Pubkey, PlayerState) {
    let (address, bump) =
        Pubkey::find_program_address(&[PLAYER_STATE_SEED, owner.as_ref()], &zkube::ID);
    (address, PlayerState::initialize(owner, bump))
}

#[test]
fn record_campaign_stars_is_idempotent_and_touches_no_other_field() {
    for device in [false, true] {
        let owner = Pubkey::new_unique();
        let actor = if device { Pubkey::new_unique() } else { owner };
        let (player, mut state) = player_fixture(owner);
        state.campaign_stars = [0b11_10_01_00; CAMPAIGN_STAR_BYTES];
        state.kredit_balance = 25;
        state.next_run_id = 15;
        state.best_daily_score = 90;
        let before = program_account(&state, 8 + PlayerState::INIT_SPACE);
        let token = device.then(|| session_token_address(owner, actor));
        let mut accounts = vec![
            (player, before.clone()),
            (owner, system_account(ACCOUNT_LAMPORTS)),
            (
                zkube::ID,
                executable_program_account(Pubkey::from_str_const(
                    "BPFLoaderUpgradeab1e11111111111111111111111",
                )),
            ),
        ];
        if let Some(address) = token {
            accounts.push((actor, system_account(ACCOUNT_LAMPORTS)));
            accounts.push((
                address,
                serialized_account(
                    &SessionTokenV2 {
                        authority: owner,
                        target_program: zkube::ID,
                        session_signer: actor,
                        fee_payer: owner,
                        valid_until: 100,
                    },
                    SessionTokenV2::LEN,
                    session_keys::ID,
                    ACCOUNT_LAMPORTS,
                ),
            ));
        }
        let mut instruction = anchor_lang::solana_program::instruction::Instruction {
            program_id: zkube::ID,
            accounts: zkube::accounts::SetFeaturedEmblem {
                player_state: player,
                owner_authority: owner,
                session_token: token,
                actor,
            }
            .to_account_metas(None),
            data: zkube::instruction::RecordCampaignStars {
                stars: [0b00_01_10_11; CAMPAIGN_STAR_BYTES],
            }
            .data(),
        };
        let mut svm = mollusk();
        svm.sysvars.clock.unix_timestamp = 1;
        state.campaign_stars = [0b11_10_10_11; CAMPAIGN_STAR_BYTES];
        let expected = program_account(&state, 8 + PlayerState::INIT_SPACE);
        for _ in 0..2 {
            let result = svm.process_instruction(&instruction, &accounts);
            assert!(result.program_result.is_ok(), "{:?}", result.program_result);
            for (address, original) in &accounts {
                assert_eq!(
                    resulting_account(&result, address),
                    if *address == player {
                        &expected
                    } else {
                        original
                    }
                );
            }
            accounts
                .iter_mut()
                .find(|(address, _)| *address == player)
                .unwrap()
                .1 = expected.clone();
        }
        instruction.data = zkube::instruction::RecordCampaignStars {
            stars: [0; CAMPAIGN_STAR_BYTES],
        }
        .data();
        let result = svm.process_instruction(&instruction, &accounts);
        assert!(result.program_result.is_ok());
        assert_eq!(resulting_account(&result, &player), &expected);
        instruction.data.pop();
        let malformed = svm.process_instruction(&instruction, &accounts);
        assert!(malformed.program_result.is_err());
        assert_eq!(resulting_account(&malformed, &player), &expected);
        instruction.data = zkube::instruction::RecordCampaignStars {
            stars: [u8::MAX; CAMPAIGN_STAR_BYTES],
        }
        .data();
        if device {
            svm.sysvars.clock.unix_timestamp = 100;
        } else {
            instruction
                .accounts
                .iter_mut()
                .filter(|meta| meta.pubkey == owner)
                .for_each(|meta| meta.is_signer = false);
        }
        let unauthorized = svm.process_instruction(&instruction, &accounts);
        assert!(unauthorized.program_result.is_err());
        assert_eq!(resulting_account(&unauthorized, &player), &expected);
    }
}

#[test]
fn a_closed_run_returns_rent_to_its_payer() {
    let owner = Pubkey::new_unique();
    let payer = Pubkey::new_unique();
    let wrong = Pubkey::new_unique();
    let run_id = 1u64;
    let (daily, mut day) = daily_fixture(32, Pubkey::new_unique(), PeriodStatus::Open, false);
    day.entries_paid = 1;
    let (player, mut profile) = player_fixture(owner);
    profile
        .reserve_arcade_run(run_id, daily, day_window(day.day_id).unwrap().1)
        .unwrap();
    let (participant, participant_bump) = Pubkey::find_program_address(
        &[ARENA_PLAYER_SEED, daily.as_ref(), owner.as_ref()],
        &zkube::ID,
    );
    let mut entry = ArenaPlayer::initialize(daily, owner, payer, participant_bump);
    entry.paid_entries = 1;
    entry.active_paid_run_id = run_id;
    let (active, bump) = Pubkey::find_program_address(
        &[
            ACTIVE_RUN_SEED,
            b"active",
            owner.as_ref(),
            &run_id.to_le_bytes(),
        ],
        &zkube::ID,
    );
    let run = ActiveRun {
        version: ACCOUNT_VERSION,
        owner,
        rent_payer: payer,
        run_id,
        daily_challenge: daily,
        lifecycle: RunLifecycle::Finished,
        finished_at: day_window(day.day_id).unwrap().1,
        deadline_at: day_window(day.day_id).unwrap().1,
        bump,
        ..ActiveRun::default()
    };
    let accounts = vec![
        (
            player,
            program_account(&profile, 8 + PlayerState::INIT_SPACE),
        ),
        (daily, program_account(&day, 8 + ArenaDaily::INIT_SPACE)),
        (
            participant,
            program_account(&entry, 8 + ArenaPlayer::INIT_SPACE),
        ),
        (active, program_account(&run, 8 + ActiveRun::INIT_SPACE)),
        (payer, system_account(100)),
        (wrong, system_account(100)),
    ];
    let instruction = |rent_recipient| anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::ConsumeArenaRun {
            player_state: player,
            arena_daily: Some(daily),
            arena_player: Some(participant),
            active_run: active,
            rent_recipient,
        }
        .to_account_metas(None),
        data: zkube::instruction::ConsumeArenaRun {}.data(),
    };
    let rejected = mollusk().process_instruction(&instruction(wrong), &accounts);
    assert!(rejected.program_result.is_err());
    for (key, original) in &accounts {
        assert_eq!(resulting_account(&rejected, key), original);
    }
    let closed = mollusk().process_instruction(&instruction(payer), &accounts);
    assert!(closed.program_result.is_ok(), "{:?}", closed.program_result);
    assert_eq!(
        resulting_account(&closed, &payer).lamports,
        100 + ACCOUNT_LAMPORTS
    );
    assert_eq!(resulting_account(&closed, &active).lamports, 0);
    assert!(resulting_account(&closed, &active).data.is_empty());
    let updated: PlayerState = decode(resulting_account(&closed, &player));
    assert_eq!(updated.active_run_id, 0);
    assert_eq!(updated.next_run_id, run_id + 1);
    assert_eq!(updated.campaign_stars, [0; CAMPAIGN_STAR_BYTES]);
    let updated: ArenaDaily = decode(resulting_account(&closed, &daily));
    assert_eq!(updated.entries_expired, 1);
    assert_eq!(updated.entries_scored, 0);
}

fn session_token_address(owner: Pubkey, actor: Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            SessionTokenV2::SEED_PREFIX.as_bytes(),
            zkube::ID.as_ref(),
            actor.as_ref(),
            owner.as_ref(),
        ],
        &session_keys::ID,
    )
    .0
}

#[test]
fn sbf_finish_run_predicates_are_exact() {
    let owner = Pubkey::new_unique();
    let caller = Pubkey::new_unique();
    let stranger = Pubkey::new_unique();
    let active_run = Pubkey::new_unique();
    let deadline_at = 1_000;
    let daily = ActiveRun {
        version: ACCOUNT_VERSION,
        owner,
        run_id: 1,
        lifecycle: RunLifecycle::Playing,
        rules: daily_map_rule_fixture(),
        deadline_at,
        ..ActiveRun::default()
    };
    let instruction = |actor: Pubkey, reason: RunFinishReason| {
        anchor_lang::solana_program::instruction::Instruction {
            program_id: zkube::ID,
            accounts: zkube::accounts::FinishRun {
                active_run,
                owner_authority: owner,
                session_token: None,
                actor,
            }
            .to_account_metas(None),
            data: zkube::instruction::FinishRun { reason }.data(),
        }
    };
    let process = |state: &ActiveRun, actor: Pubkey, reason, now| {
        let mut runtime = mollusk();
        runtime.sysvars.clock.unix_timestamp = now;
        runtime.process_instruction(
            &instruction(actor, reason),
            &[
                (
                    active_run,
                    program_account(state, 8 + ActiveRun::INIT_SPACE),
                ),
                (owner, system_account(0)),
                (actor, system_account(ACCOUNT_LAMPORTS)),
            ],
        )
    };

    assert!(
        process(&daily, caller, RunFinishReason::Deadline, deadline_at - 1)
            .program_result
            .is_err()
    );
    assert!(
        process(&daily, stranger, RunFinishReason::Abandon, deadline_at - 1)
            .program_result
            .is_err()
    );
    assert!(
        process(&daily, owner, RunFinishReason::Abandon, deadline_at)
            .program_result
            .is_err()
    );

    let first = process(&daily, caller, RunFinishReason::Deadline, deadline_at);
    assert!(first.program_result.is_ok(), "{:?}", first.program_result);
    let finished: ActiveRun = decode(resulting_account(&first, &active_run));
    assert_eq!(finished.finish_reason, Some(RunFinishReason::Deadline));
    let repeated = process(
        &finished,
        caller,
        RunFinishReason::Deadline,
        deadline_at + 1,
    );
    assert!(
        repeated.program_result.is_ok(),
        "{:?}",
        repeated.program_result
    );
}

#[test]
fn sbf_authority_deposit_rejects_zero_finalized_and_noncanonical_periods() {
    let authority = Pubkey::new_unique();
    let (protocol, protocol_state) = protocol_fixture(authority, Pubkey::new_unique(), false);
    let (arcade, arcade_state) = arcade_fixture(protocol);
    let day_id = 32;
    let now = day_window(day_id).unwrap().0 + 1;

    for (candidate_day, status, amount) in [
        (day_id, PeriodStatus::Open, 0),
        (day_id, PeriodStatus::Finalized, 1),
        (day_id + 2, PeriodStatus::Funding, 1),
    ] {
        let (daily, daily_state) = daily_fixture(candidate_day, arcade, status, true);
        let instruction = anchor_lang::solana_program::instruction::Instruction {
            program_id: zkube::ID,
            accounts: zkube::accounts::DepositArenaDaily {
                protocol,
                arcade_config: arcade,
                arena_daily: daily,
                authority,
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
            data: zkube::instruction::DepositArenaDaily { lamports: amount }.data(),
        };
        let mut runtime = mollusk();
        runtime.sysvars.clock.unix_timestamp = now;
        let result = runtime.process_instruction(
            &instruction,
            &[
                (
                    protocol,
                    program_account(&protocol_state, 8 + ProtocolConfig::INIT_SPACE),
                ),
                (
                    arcade,
                    program_account(&arcade_state, 8 + ArcadeConfig::INIT_SPACE),
                ),
                (
                    daily,
                    program_account(&daily_state, 8 + ArenaDaily::INIT_SPACE),
                ),
                (authority, system_account(ACCOUNT_LAMPORTS)),
                (anchor_lang::system_program::ID, system_program_account()),
            ],
        );
        assert!(
            result.program_result.is_err(),
            "unexpectedly accepted day={candidate_day} status={status:?} amount={amount}"
        );
    }
}

fn arcade_fixture(protocol: Pubkey) -> (Pubkey, ArcadeConfig) {
    let (address, bump) = Pubkey::find_program_address(&[ARCADE_CONFIG_SEED], &zkube::ID);
    let mut config = ArcadeConfig::canonical(protocol, bump);

    config.launch_day_id = 32;
    config.last_daily_id = 31;
    (address, config)
}

fn daily_fixture(
    day_id: u32,
    arcade_config: Pubkey,
    status: PeriodStatus,
    predecessor_rollover_applied: bool,
) -> (Pubkey, ArenaDaily) {
    let (address, bump) =
        Pubkey::find_program_address(&[ARENA_DAILY_SEED, &day_id.to_le_bytes()], &zkube::ID);
    (
        address,
        ArenaDaily {
            version: ACCOUNT_VERSION,
            day_id,
            arcade_config,
            status,
            predecessor_rollover_applied,
            rules_hash: [2; 32],
            finalized_at: 0,
            ledger: PoolLedger::default(),
            entries_paid: 0,
            entries_scored: 0,
            entries_expired: 0,
            unique_players: 0,
            score_qualified_players: 0,
            theme_qualified_players: 0,
            claims_expired: false,
            bump,
        },
    )
}

fn board_fixture(
    daily: Pubkey,
    day_id: u32,
    kind: DailyBoardKind,
    qualified_count: u32,
    pool_lamports: u64,
    entries: &[ArenaBoardEntry],
    claimed_positions: &[u32],
) -> (Pubkey, ArenaBoard, Account, BoardPayoutPlan) {
    let (address, bump) =
        Pubkey::find_program_address(&[ARENA_BOARD_SEED, daily.as_ref(), kind.seed()], &zkube::ID);
    let plan = board_payout_plan(pool_lamports, qualified_count).unwrap();
    let payout_count = usize::try_from(plan.count).unwrap();
    assert!(entries.len() >= payout_count);
    let mut board = ArenaBoard {
        version: ACCOUNT_VERSION,
        arena_daily: daily,
        day_id,
        kind,
        qualified_count,
        width_count: plan.width_count,
        payout_count: plan.count,
        denominator: plan.denominator,
        pool_lamports,
        paid_lamports: plan.paid_lamports,
        rollover_lamports: plan.rollover_lamports,
        capacity_limited: plan.capacity_limited,
        cursor: plan.count,

        sealed_at: i64::from(day_id) * zkube_core::SECONDS_PER_DAY
            + zkube_core::DAILY_RUN_CLOSE_OFFSET,
        claimed_lamports: 0,
        claimed_count: u32::try_from(claimed_positions.len()).unwrap(),
        bump,
    };
    board.claimed_lamports = claimed_positions
        .iter()
        .map(|position| board.payout_for_position(*position).unwrap())
        .sum();
    let mut account = program_account(&board, ArenaBoard::account_space(plan.count).unwrap());
    for (position, entry) in entries.iter().take(payout_count).enumerate() {
        let start = ArenaBoard::HEADER_SIZE + position * ArenaBoardEntry::INIT_SPACE;
        entry
            .serialize(&mut Cursor::new(
                &mut account.data[start..start + ArenaBoardEntry::INIT_SPACE],
            ))
            .unwrap();
    }
    let mask_start = ArenaBoard::HEADER_SIZE
        + usize::try_from(plan.count).unwrap() * ArenaBoardEntry::INIT_SPACE;
    for position in claimed_positions {
        let position = usize::try_from(*position).unwrap();
        account.data[mask_start + position / 8] |= 1 << (position % 8);
    }
    (address, board, account, plan)
}

fn credit_vault_fixture(protocol: Pubkey) -> (Pubkey, CreditVault) {
    let (address, bump) = Pubkey::find_program_address(&[CREDIT_VAULT_SEED], &zkube::ID);
    (
        address,
        CreditVault {
            version: ACCOUNT_VERSION,
            protocol,
            available_prize_lamports: zkube_core::ENTRY_DAILY_LAMPORTS,

            bump,
        },
    )
}

#[test]
fn sbf_device_paid_entry_spends_a_kredit_and_resolves_both_paths() {
    let authority = Pubkey::new_unique();
    let team = Pubkey::new_unique();
    let owner = Pubkey::new_unique();
    let actor = Pubkey::new_unique();
    let (protocol, protocol_state) = protocol_fixture(authority, team, false);
    let (arcade, arcade_state) = arcade_fixture(protocol);
    let day_id = 32;
    let (current_daily, current_daily_state) =
        daily_fixture(day_id, arcade, PeriodStatus::Open, false);
    let (following_daily, following_daily_state) =
        daily_fixture(day_id + 1, arcade, PeriodStatus::Funding, false);
    let (credit_vault, credit_vault_state) = credit_vault_fixture(protocol);
    let (player, mut player_state) = player_fixture(owner);
    player_state.record_kredit_purchase(1).unwrap();
    let claim_pool = 101_990_000;
    let claim_entries = (0..5)
        .map(|index| ArenaBoardEntry {
            player: if index == 0 {
                owner
            } else {
                Pubkey::new_unique()
            },
            score: 100 - index,
            ..ArenaBoardEntry::default()
        })
        .collect::<Vec<_>>();
    let (claim_daily, mut claim_daily_state) =
        daily_fixture(day_id - 1, arcade, PeriodStatus::Finalized, true);
    claim_daily_state.score_qualified_players = 5;
    let (claim_board, claim_board_state, claim_board_account, claim_plan) = board_fixture(
        claim_daily,
        day_id - 1,
        DailyBoardKind::Score,
        5,
        claim_pool,
        &claim_entries,
        &[],
    );
    claim_daily_state.ledger = PoolLedger {
        seeded_lamports: claim_pool,
        payout_lamports: claim_plan.paid_lamports,
        rollover_out_lamports: claim_plan.rollover_lamports,
        ..PoolLedger::default()
    };
    let expected_auto_claim = claim_board_state.payout_for_position(0).unwrap();

    let (duplicate_daily, mut duplicate_daily_state) =
        daily_fixture(day_id - 2, arcade, PeriodStatus::Finalized, true);
    duplicate_daily_state.score_qualified_players = 5;
    let (duplicate_board, _, duplicate_board_account, duplicate_plan) = board_fixture(
        duplicate_daily,
        day_id - 2,
        DailyBoardKind::Score,
        5,
        claim_pool,
        &claim_entries,
        &[0],
    );
    duplicate_daily_state.ledger = PoolLedger {
        seeded_lamports: claim_pool,
        payout_lamports: duplicate_plan.paid_lamports,
        rollover_out_lamports: duplicate_plan.rollover_lamports,
        ..PoolLedger::default()
    };
    let session_token = session_token_address(owner, actor);
    let session_state = SessionTokenV2 {
        authority: owner,
        target_program: zkube::ID,
        session_signer: actor,
        fee_payer: owner,
        valid_until: day_window(current_daily_state.day_id).unwrap().1,
    };
    let (arena_player, _) = Pubkey::find_program_address(
        &[ARENA_PLAYER_SEED, current_daily.as_ref(), owner.as_ref()],
        &zkube::ID,
    );
    let run_id = player_state.next_run_id;
    let (active_run, _) = Pubkey::find_program_address(
        &[
            ACTIVE_RUN_SEED,
            b"active",
            owner.as_ref(),
            &run_id.to_le_bytes(),
        ],
        &zkube::ID,
    );
    let mut instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::EnterArena {
            zkube_program: zkube::ID,
            protocol,
            arcade_config: arcade,
            player_state: player,
            current_daily,
            arena_player,
            following_daily,
            credit_vault,
            active_run,
            payer: actor,
            owner_authority: owner,
            session_token: Some(session_token),
            actor,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: zkube::instruction::EnterArena {
            run_id,

            auto_claim_positions: vec![0, 0],
        }
        .data(),
    };
    instruction.accounts.extend([
        anchor_lang::solana_program::instruction::AccountMeta::new(duplicate_daily, false),
        anchor_lang::solana_program::instruction::AccountMeta::new(duplicate_board, false),
        anchor_lang::solana_program::instruction::AccountMeta::new(claim_daily, false),
        anchor_lang::solana_program::instruction::AccountMeta::new(claim_board, false),
    ]);
    let actor_before = 100_000_000;
    let accounts = vec![
        (
            protocol,
            program_account(&protocol_state, 8 + ProtocolConfig::INIT_SPACE),
        ),
        (
            arcade,
            program_account(&arcade_state, 8 + ArcadeConfig::INIT_SPACE),
        ),
        (
            player,
            program_account(&player_state, 8 + PlayerState::INIT_SPACE),
        ),
        (
            current_daily,
            program_account(&current_daily_state, 8 + ArenaDaily::INIT_SPACE),
        ),
        (arena_player, system_account(0)),
        (
            following_daily,
            program_account(&following_daily_state, 8 + ArenaDaily::INIT_SPACE),
        ),
        (
            credit_vault,
            serialized_account(
                &credit_vault_state,
                8 + CreditVault::INIT_SPACE,
                zkube::ID,
                ACCOUNT_LAMPORTS + zkube_core::ENTRY_DAILY_LAMPORTS,
            ),
        ),
        (active_run, system_account(0)),
        (owner, system_account(0)),
        (
            session_token,
            serialized_account(
                &session_state,
                SessionTokenV2::LEN,
                session_keys::ID,
                ACCOUNT_LAMPORTS,
            ),
        ),
        (actor, system_account(actor_before)),
        (anchor_lang::system_program::ID, system_program_account()),
        (
            zkube::ID,
            executable_program_account(Pubkey::from_str_const(
                "BPFLoaderUpgradeab1e11111111111111111111111",
            )),
        ),
        (
            duplicate_daily,
            serialized_account(
                &duplicate_daily_state,
                8 + ArenaDaily::INIT_SPACE,
                zkube::ID,
                ACCOUNT_LAMPORTS + duplicate_plan.paid_lamports - expected_auto_claim,
            ),
        ),
        (duplicate_board, duplicate_board_account),
        (
            claim_daily,
            serialized_account(
                &claim_daily_state,
                8 + ArenaDaily::INIT_SPACE,
                zkube::ID,
                ACCOUNT_LAMPORTS + claim_plan.paid_lamports,
            ),
        ),
        (claim_board, claim_board_account),
    ];
    let suspended_accounts = accounts
        .iter()
        .map(|(address, account)| {
            if *address == current_daily {
                (*address, system_account(0))
            } else {
                (*address, account.clone())
            }
        })
        .collect::<Vec<_>>();
    let mut suspended_runtime = mollusk();
    suspended_runtime.sysvars.clock.unix_timestamp =
        day_window(current_daily_state.day_id).unwrap().0 + 1;
    let refused = suspended_runtime.process_instruction(&instruction, &suspended_accounts);
    assert!(
        refused.program_result.is_err(),
        "a missing suspended Daily must reject entry"
    );

    let mut runtime = mollusk();
    runtime.sysvars.clock.unix_timestamp = day_window(current_daily_state.day_id).unwrap().1 - 1;
    let result = runtime.process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);

    let daily_after: ArenaDaily = decode(resulting_account(&result, &following_daily));
    let credit_vault_after: CreditVault = decode(resulting_account(&result, &credit_vault));
    let current_after: ArenaDaily = decode(resulting_account(&result, &current_daily));
    let player_after: ArenaPlayer = decode(resulting_account(&result, &arena_player));
    let profile_after_entry: PlayerState = decode(resulting_account(&result, &player));
    assert_eq!(
        daily_after.ledger.entry_lamports,
        zkube_core::ENTRY_DAILY_LAMPORTS
    );
    assert_eq!(credit_vault_after.available_prize_lamports, 0);
    assert_eq!(current_after.entries_paid, 1);
    assert_eq!(player_after.paid_entries, 1);
    assert_eq!(player_after.active_paid_run_id, run_id);
    assert_eq!(profile_after_entry.kredit_balance, 0);
    let entered: ActiveRun = decode(resulting_account(&result, &active_run));
    let (realm_id, objective) = zkube_core::daily_pair(current_after.day_id);
    let realm = zkube_core::REALM_RULES[usize::from(realm_id - 1)];
    assert_eq!(entered.map_id, realm_id);
    assert_eq!(entered.rules.guardian.to_core().unwrap(), realm.guardian);
    assert_eq!(entered.rules.starting_rows, realm.starting_height);
    assert_eq!(entered.daily_theme.to_core().unwrap(), objective);
    assert_eq!(entered.rules_hash, current_after.rules_hash);
    assert_eq!(
        entered.deadline_at,
        zkube_core::daily_window(current_after.day_id).1
    );
    assert_eq!(
        resulting_account(&result, &owner).lamports,
        expected_auto_claim,
        "auto-claim pays the owner without making it an entry lamport source"
    );
    assert_eq!(
        resulting_account(&result, &following_daily).lamports,
        ACCOUNT_LAMPORTS + zkube_core::ENTRY_DAILY_LAMPORTS
    );
    assert_eq!(
        resulting_account(&result, &credit_vault).lamports,
        ACCOUNT_LAMPORTS
    );
    assert_eq!(
        resulting_account(&result, &claim_daily).lamports,
        ACCOUNT_LAMPORTS + claim_plan.paid_lamports - expected_auto_claim
    );
    let auto_claimed_board: ArenaBoard = decode(resulting_account(&result, &claim_board));
    assert_eq!(auto_claimed_board.claimed_count, 1);
    assert_eq!(auto_claimed_board.claimed_lamports, expected_auto_claim);
    let arena_player_rent = resulting_account(&result, &arena_player).lamports;
    let active_run_rent = resulting_account(&result, &active_run).lamports;
    let actor_after_entry = resulting_account(&result, &actor).lamports;
    assert_eq!(
        actor_after_entry + arena_player_rent + active_run_rent,
        actor_before,
        "the device signer pays only the two player-account rents"
    );

    // A last-second run with one accepted action scores its partial state.
    let mut partial: ActiveRun = decode(resulting_account(&result, &active_run));
    partial.lifecycle = RunLifecycle::Finished;
    partial.finished_at = day_window(current_daily_state.day_id).unwrap().1;
    partial.pending_vrf_counter = 0;
    partial.action_counter = 1;
    partial.daily_score = 1;
    let partial_account = serialized_account(
        &partial,
        8 + ActiveRun::INIT_SPACE,
        zkube::ID,
        active_run_rent,
    );

    // A terminal zero-action run is consumed permissionlessly. Its ActiveRun
    // rent returns to the original device payer while the daily records one
    // paid expiry and releases the durable reservation.
    let mut terminal: ActiveRun = decode(resulting_account(&result, &active_run));
    terminal.lifecycle = RunLifecycle::Finished;
    terminal.finished_at = day_window(current_daily_state.day_id).unwrap().0 + 1;
    terminal.pending_vrf_counter = 0;
    terminal.action_counter = 0;
    let terminal_account = serialized_account(
        &terminal,
        8 + ActiveRun::INIT_SPACE,
        zkube::ID,
        active_run_rent,
    );
    let consume = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::ConsumeArenaRun {
            player_state: player,
            arena_daily: Some(current_daily),
            arena_player: Some(arena_player),
            active_run,
            rent_recipient: actor,
        }
        .to_account_metas(None),
        data: zkube::instruction::ConsumeArenaRun {}.data(),
    };
    let consume_accounts = vec![
        (player, resulting_account(&result, &player).clone()),
        (
            current_daily,
            resulting_account(&result, &current_daily).clone(),
        ),
        (
            arena_player,
            resulting_account(&result, &arena_player).clone(),
        ),
        (active_run, terminal_account),
        (actor, resulting_account(&result, &actor).clone()),
    ];
    let scored = mollusk().process_instruction(
        &consume,
        &[
            consume_accounts[0].clone(),
            consume_accounts[1].clone(),
            consume_accounts[2].clone(),
            (active_run, partial_account),
            consume_accounts[4].clone(),
        ],
    );
    assert!(scored.program_result.is_ok(), "{:?}", scored.program_result);
    let scored_daily: ArenaDaily = decode(resulting_account(&scored, &current_daily));
    assert_eq!(scored_daily.entries_scored, 1);
    assert_eq!(scored_daily.entries_expired, 0);
    assert_eq!(
        scored_daily.entries_scored + scored_daily.entries_expired,
        1
    );

    let consumed = mollusk().process_instruction(&consume, &consume_accounts);
    assert!(
        consumed.program_result.is_ok(),
        "{:?}",
        consumed.program_result
    );
    assert_eq!(
        resulting_account(&consumed, &actor).lamports,
        actor_after_entry + active_run_rent
    );
    assert_eq!(
        resulting_account(&consumed, &actor).lamports + arena_player_rent,
        actor_before
    );
    let consumed_daily: ArenaDaily = decode(resulting_account(&consumed, &current_daily));
    let consumed_player: PlayerState = decode(resulting_account(&consumed, &player));
    assert_eq!(consumed_daily.entries_expired, 1);
    assert_eq!(
        consumed_daily.entries_scored + consumed_daily.entries_expired,
        1
    );
    assert_eq!(consumed_player.active_run_id, 0);

    // Entry availability is independent from late predecessor settlement, but
    // payout ordering is not: even a fully resolved Daily cannot finalize
    // before its own predecessor rollover has landed.
    let caller = Pubkey::new_unique();
    let (score_board, _) = Pubkey::find_program_address(
        &[
            ARENA_BOARD_SEED,
            current_daily.as_ref(),
            DailyBoardKind::Score.seed(),
        ],
        &zkube::ID,
    );
    let (theme_board, _) = Pubkey::find_program_address(
        &[
            ARENA_BOARD_SEED,
            current_daily.as_ref(),
            DailyBoardKind::Theme.seed(),
        ],
        &zkube::ID,
    );
    let (cadence_funding, _) = Pubkey::find_program_address(&[CADENCE_FUNDING_SEED], &zkube::ID);
    let finalize = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::FinalizeArenaDaily {
            arena_daily: current_daily,
            following_daily,
            score_board,
            theme_board,
            cadence_funding,
            caller,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: zkube::instruction::FinalizeArenaDaily {}.data(),
    };
    let mut late = mollusk();
    late.sysvars.clock.unix_timestamp = day_window(current_daily_state.day_id).unwrap().1;
    assert!(late
        .process_instruction(
            &finalize,
            &[
                (
                    current_daily,
                    resulting_account(&consumed, &current_daily).clone(),
                ),
                (
                    following_daily,
                    resulting_account(&result, &following_daily).clone(),
                ),
                (score_board, system_account(0)),
                (theme_board, system_account(0)),
                (cadence_funding, system_account(500_000_000)),
                (caller, system_account(ACCOUNT_LAMPORTS)),
                (anchor_lang::system_program::ID, system_program_account()),
                (
                    zkube::ID,
                    executable_program_account(Pubkey::from_str_const(
                        "BPFLoaderUpgradeab1e11111111111111111111111",
                    )),
                ),
            ],
        )
        .program_result
        .is_err());
}

#[test]
fn sbf_device_paid_entry_with_two_maximum_boards_stays_below_client_compute_pin() {
    assert_eq!(zkube::instructions::MAX_AUTO_CLAIMS_PER_ENTRY, 2);
    let authority = Pubkey::new_unique();
    let team = Pubkey::new_unique();
    let owner = Pubkey::new_unique();
    let actor = Pubkey::new_unique();
    let (protocol, protocol_state) = protocol_fixture(authority, team, false);
    let (arcade, arcade_state) = arcade_fixture(protocol);
    let day_id = 32;
    let (current_daily, current_daily_state) =
        daily_fixture(day_id, arcade, PeriodStatus::Open, false);
    let (following_daily, following_daily_state) =
        daily_fixture(day_id + 1, arcade, PeriodStatus::Funding, false);
    let (credit_vault, credit_vault_state) = credit_vault_fixture(protocol);
    let (player, mut player_state) = player_fixture(owner);
    player_state.record_kredit_purchase(1).unwrap();

    let qualified_count = u32::try_from(ARENA_BOARD_CAPACITY).unwrap();
    let entries = (0..qualified_count)
        .map(|position| {
            let metric = qualified_count - position;
            ArenaBoardEntry {
                player: if position + 1 == qualified_count {
                    owner
                } else {
                    Pubkey::new_unique()
                },
                score: metric,
                objective_total: u64::from(metric),
                finalized_at: i64::from(position),
                replay_hash: [u8::try_from(position % 251).unwrap(); 32],
            }
        })
        .collect::<Vec<_>>();
    let total_pool = u64::MAX / 2;
    let pools = daily_board_pools(total_pool, qualified_count);
    let (claim_daily, mut claim_daily_state) =
        daily_fixture(day_id - 1, arcade, PeriodStatus::Finalized, true);
    claim_daily_state.score_qualified_players = qualified_count;
    claim_daily_state.theme_qualified_players = qualified_count;
    claim_daily_state.ledger = PoolLedger {
        payout_lamports: total_pool,
        ..PoolLedger::default()
    };
    let (score_board, score_board_state, score_board_account, score_plan) = board_fixture(
        claim_daily,
        day_id - 1,
        DailyBoardKind::Score,
        qualified_count,
        pools.score,
        &entries,
        &[],
    );
    let (theme_board, theme_board_state, theme_board_account, theme_plan) = board_fixture(
        claim_daily,
        day_id - 1,
        DailyBoardKind::Theme,
        qualified_count,
        pools.theme,
        &entries,
        &[],
    );
    assert_eq!(score_plan.count, qualified_count);
    assert_eq!(theme_plan.count, qualified_count);
    let last_position = qualified_count - 1;
    let expected_claims = score_board_state
        .payout_for_position(last_position)
        .unwrap()
        + theme_board_state
            .payout_for_position(last_position)
            .unwrap();

    let session_token = session_token_address(owner, actor);
    let session_state = SessionTokenV2 {
        authority: owner,
        target_program: zkube::ID,
        session_signer: actor,
        fee_payer: owner,
        valid_until: day_window(current_daily_state.day_id).unwrap().1,
    };
    let (arena_player, _) = Pubkey::find_program_address(
        &[ARENA_PLAYER_SEED, current_daily.as_ref(), owner.as_ref()],
        &zkube::ID,
    );
    let run_id = player_state.next_run_id;
    let (active_run, _) = Pubkey::find_program_address(
        &[
            ACTIVE_RUN_SEED,
            b"active",
            owner.as_ref(),
            &run_id.to_le_bytes(),
        ],
        &zkube::ID,
    );
    let mut instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::EnterArena {
            zkube_program: zkube::ID,
            protocol,
            arcade_config: arcade,
            player_state: player,
            current_daily,
            arena_player,
            following_daily,
            credit_vault,
            active_run,
            payer: actor,
            owner_authority: owner,
            session_token: Some(session_token),
            actor,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: zkube::instruction::EnterArena {
            run_id,

            auto_claim_positions: vec![
                last_position;
                zkube::instructions::MAX_AUTO_CLAIMS_PER_ENTRY
            ],
        }
        .data(),
    };
    instruction.accounts.extend([
        anchor_lang::solana_program::instruction::AccountMeta::new(claim_daily, false),
        anchor_lang::solana_program::instruction::AccountMeta::new(score_board, false),
        anchor_lang::solana_program::instruction::AccountMeta::new(claim_daily, false),
        anchor_lang::solana_program::instruction::AccountMeta::new(theme_board, false),
    ]);
    let accounts = vec![
        (
            protocol,
            program_account(&protocol_state, 8 + ProtocolConfig::INIT_SPACE),
        ),
        (
            arcade,
            program_account(&arcade_state, 8 + ArcadeConfig::INIT_SPACE),
        ),
        (
            player,
            program_account(&player_state, 8 + PlayerState::INIT_SPACE),
        ),
        (
            current_daily,
            program_account(&current_daily_state, 8 + ArenaDaily::INIT_SPACE),
        ),
        (arena_player, system_account(0)),
        (
            following_daily,
            program_account(&following_daily_state, 8 + ArenaDaily::INIT_SPACE),
        ),
        (
            credit_vault,
            serialized_account(
                &credit_vault_state,
                8 + CreditVault::INIT_SPACE,
                zkube::ID,
                ACCOUNT_LAMPORTS + zkube_core::ENTRY_DAILY_LAMPORTS,
            ),
        ),
        (active_run, system_account(0)),
        (owner, system_account(0)),
        (
            session_token,
            serialized_account(
                &session_state,
                SessionTokenV2::LEN,
                session_keys::ID,
                ACCOUNT_LAMPORTS,
            ),
        ),
        (actor, system_account(100_000_000)),
        (anchor_lang::system_program::ID, system_program_account()),
        (
            zkube::ID,
            executable_program_account(Pubkey::from_str_const(
                "BPFLoaderUpgradeab1e11111111111111111111111",
            )),
        ),
        (
            claim_daily,
            serialized_account(
                &claim_daily_state,
                8 + ArenaDaily::INIT_SPACE,
                zkube::ID,
                ACCOUNT_LAMPORTS + score_plan.paid_lamports + theme_plan.paid_lamports,
            ),
        ),
        (score_board, score_board_account),
        (theme_board, theme_board_account),
    ];
    let mut runtime = mollusk();
    runtime.sysvars.clock.unix_timestamp = day_window(current_daily_state.day_id).unwrap().1 - 1;
    let wrong_position = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::ClaimDailyPrize {
            arena_daily: claim_daily,
            arena_board: score_board,
            player_state: player,
            owner_authority: owner,
            session_token: Some(session_token),
            actor,
        }
        .to_account_metas(None),
        data: zkube::instruction::ClaimDailyPrize {
            board: DailyBoardKind::Score,
            position: 0,
        }
        .data(),
    };
    let wrong_position_result = runtime.process_instruction(&wrong_position, &accounts);
    let no_prize = 6_000 + zkube::error::ErrorCode::NoPrize as u32;
    assert!(
        format!("{:?}", wrong_position_result.program_result)
            .contains(&format!("Custom({no_prize})")),
        "an attached position must be verified against its owner: {:?}",
        wrong_position_result.program_result
    );
    let result = runtime.process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    eprintln!(
        "SBF_COMPUTE device_entry_two_maximum_boards={}",
        result.compute_units_consumed
    );
    assert!(result.compute_units_consumed < 360_000);
    assert_eq!(resulting_account(&result, &owner).lamports, expected_claims);
    let score_after: ArenaBoard = decode(resulting_account(&result, &score_board));
    let theme_after: ArenaBoard = decode(resulting_account(&result, &theme_board));
    assert_eq!(score_after.claimed_count, 1);
    assert_eq!(theme_after.claimed_count, 1);
}

#[test]
fn a_suspended_day_is_skipped_once_and_its_funding_reaches_the_next_scheduled_day() {
    let caller = Pubkey::new_unique();
    let protocol = Pubkey::new_unique();
    let (arcade, mut arcade_state) = arcade_fixture(protocol);
    let suspended_day_id = arcade_state.launch_day_id + 1;
    let successor_day_id = suspended_day_id + 1;
    arcade_state.suspended_until_day = successor_day_id;
    let (suspended_daily, mut suspended_state) =
        daily_fixture(suspended_day_id, arcade, PeriodStatus::Funding, true);
    let (successor_daily, successor_state) =
        daily_fixture(successor_day_id, arcade, PeriodStatus::Funding, false);
    let funded_lamports = 1_000_000;
    suspended_state.ledger.seeded_lamports = funded_lamports;
    let (cadence_funding, _) = Pubkey::find_program_address(&[CADENCE_FUNDING_SEED], &zkube::ID);
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::SkipSuspendedArenaDaily {
            arcade_config: arcade,
            suspended_daily,
            successor_daily,
            cadence_funding,
            caller,
        }
        .to_account_metas(None),
        data: zkube::instruction::SkipSuspendedArenaDaily {}.data(),
    };
    let accounts = vec![
        (
            arcade,
            program_account(&arcade_state, 8 + ArcadeConfig::INIT_SPACE),
        ),
        (
            suspended_daily,
            program_account(&suspended_state, 8 + ArenaDaily::INIT_SPACE),
        ),
        (
            successor_daily,
            program_account(&successor_state, 8 + ArenaDaily::INIT_SPACE),
        ),
        (cadence_funding, system_account(ACCOUNT_LAMPORTS)),
        (caller, system_account(ACCOUNT_LAMPORTS)),
    ];
    let result = mollusk().process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    let successor_after: ArenaDaily = decode(resulting_account(&result, &successor_daily));
    assert!(successor_after.predecessor_rollover_applied);
    assert_eq!(successor_after.ledger.rollover_in_lamports, funded_lamports);
    assert_eq!(resulting_account(&result, &suspended_daily).lamports, 0);
    assert_eq!(
        resulting_account(&result, &successor_daily).lamports,
        ACCOUNT_LAMPORTS + funded_lamports,
    );

    let repeated_accounts = result.resulting_accounts.clone();
    let repeated = mollusk().process_instruction(&instruction, &repeated_accounts);
    assert!(repeated.program_result.is_err());
}

#[test]
fn sbf_cadence_funding_can_prepare_a_missing_post_launch_daily() {
    let authority = Pubkey::new_unique();
    let caller = Pubkey::new_unique();
    let (protocol, protocol_state) = protocol_fixture(authority, Pubkey::new_unique(), false);
    let (arcade, arcade_state) = arcade_fixture(protocol);
    let missing_day = arcade_state.launch_day_id + 2;
    let content = zkube_core::daily_pair_with::<SolanaSha256>(missing_day);
    let realm_map_id = content.0;
    let (missing, _) =
        Pubkey::find_program_address(&[ARENA_DAILY_SEED, &missing_day.to_le_bytes()], &zkube::ID);
    let (cadence_funding, _) = Pubkey::find_program_address(&[CADENCE_FUNDING_SEED], &zkube::ID);
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::PrepareArenaDaily {
            protocol,
            arcade_config: arcade,
            arena_daily: missing,
            cadence_funding,
            caller,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: zkube::instruction::PrepareArenaDaily {
            day_id: missing_day,
        }
        .data(),
    };
    let funding_before = 500_000_000;
    let accounts = vec![
        (
            protocol,
            program_account(&protocol_state, 8 + ProtocolConfig::INIT_SPACE),
        ),
        (
            arcade,
            program_account(&arcade_state, 8 + ArcadeConfig::INIT_SPACE),
        ),
        (missing, system_account(0)),
        (cadence_funding, system_account(funding_before)),
        (caller, system_account(ACCOUNT_LAMPORTS)),
        (anchor_lang::system_program::ID, system_program_account()),
    ];
    let mut runtime = mollusk();
    runtime.sysvars.clock.unix_timestamp = i64::from(missing_day + 5) * zkube_core::SECONDS_PER_DAY;
    let result = runtime.process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    let after: ArenaDaily = decode(resulting_account(&result, &missing));
    assert_eq!(after.day_id, missing_day);
    assert_eq!(after.status, PeriodStatus::Funding);
    assert!(!after.predecessor_rollover_applied);
    let realm = zkube_core::REALM_RULES[usize::from(realm_map_id - 1)];
    assert_eq!(
        after.rules_hash,
        zkube_core::daily_rules_hash(
            missing_day,
            realm.guardian,
            realm.starting_height,
            zkube_core::daily_pair_with::<SolanaSha256>(missing_day).1
        )
        .0
    );
    assert_eq!(
        resulting_account(&result, &cadence_funding).lamports
            + resulting_account(&result, &missing).lamports,
        funding_before
    );
    let rent = result
        .resulting_accounts
        .iter()
        .find(|(key, _)| *key == missing)
        .unwrap()
        .1
        .lamports;
    for donation in [1, rent + 1] {
        let mut prefunded = accounts.clone();
        prefunded
            .iter_mut()
            .find(|(key, _)| *key == missing)
            .unwrap()
            .1
            .lamports = donation;
        let result = runtime.process_instruction(&instruction, &prefunded);
        assert!(result.program_result.is_ok(), "{:?}", result.program_result);
        assert_eq!(
            resulting_account(&result, &missing).lamports,
            rent.max(donation)
        );
        assert_eq!(
            resulting_account(&result, &cadence_funding).lamports,
            funding_before - rent.saturating_sub(donation)
        );
    }
}

fn submitted(entry: ArenaBoardEntry) -> SubmittedBoardEntry {
    SubmittedBoardEntry {
        score: entry.score,
        objective_total: entry.objective_total,
        finalized_at: entry.finalized_at,
        replay_hash: entry.replay_hash,
    }
}

fn submit_instruction(
    daily: Pubkey,
    board: Pubkey,
    caller: Pubkey,
    kind: DailyBoardKind,
    entries: &[ArenaBoardEntry],
    source_accounts: &[Pubkey],
) -> anchor_lang::solana_program::instruction::Instruction {
    assert_eq!(entries.len(), source_accounts.len());
    let mut accounts = zkube::accounts::SubmitArenaBoardChunk {
        arena_daily: daily,
        arena_board: board,
        caller,
    }
    .to_account_metas(None);
    accounts.extend(source_accounts.iter().map(|source| {
        anchor_lang::solana_program::instruction::AccountMeta::new_readonly(*source, false)
    }));
    anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts,
        data: zkube::instruction::SubmitArenaBoardChunk {
            kind,
            entries: entries.iter().copied().map(submitted).collect(),
        }
        .data(),
    }
}

#[test]
fn ladder_points_are_credited_once_per_claim() {
    let owner = Pubkey::new_unique();
    let outsider = Pubkey::new_unique();
    let arcade = Pubkey::new_unique();
    let day_id = 20_650;
    let (daily, mut daily_state) = daily_fixture(day_id, arcade, PeriodStatus::Finalized, true);
    let mut players = vec![Pubkey::new_unique(), owner];
    players.extend((0..3).map(|_| Pubkey::new_unique()));
    let entries = players
        .iter()
        .enumerate()
        .map(|(index, player)| ArenaBoardEntry {
            player: *player,
            score: 100 - u32::try_from(index).unwrap(),
            ..ArenaBoardEntry::default()
        })
        .collect::<Vec<_>>();
    daily_state.score_qualified_players = 5;
    daily_state.finalized_at = day_window(daily_state.day_id).unwrap().1;
    let pool = 101_990_000;
    let (score_board, score_board_state, score_board_account, plan) =
        board_fixture(daily, day_id, DailyBoardKind::Score, 5, pool, &entries, &[]);
    daily_state.ledger = PoolLedger {
        seeded_lamports: pool,
        payout_lamports: plan.paid_lamports,
        rollover_out_lamports: plan.rollover_lamports,
        ..PoolLedger::default()
    };
    let (player, player_state) = player_fixture(owner);
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::ClaimDailyPrize {
            arena_daily: daily,
            arena_board: score_board,
            player_state: player,
            owner_authority: owner,
            session_token: None,
            actor: owner,
        }
        .to_account_metas(None),
        data: zkube::instruction::ClaimDailyPrize {
            board: DailyBoardKind::Score,
            position: 1,
        }
        .data(),
    };
    let daily_before = 1_000_000_000;
    let owner_before = ACCOUNT_LAMPORTS;
    let accounts = vec![
        (
            daily,
            serialized_account(
                &daily_state,
                8 + ArenaDaily::INIT_SPACE,
                zkube::ID,
                daily_before,
            ),
        ),
        (score_board, score_board_account),
        (
            player,
            program_account(&player_state, 8 + PlayerState::INIT_SPACE),
        ),
        (owner, system_account(owner_before)),
    ];
    let mut runtime = mollusk();
    runtime.sysvars.clock.unix_timestamp = score_board_state.sealed_at + 1;
    let claimed = runtime.process_instruction(&instruction, &accounts);
    assert!(
        claimed.program_result.is_ok(),
        "{:?}",
        claimed.program_result
    );
    let expected = score_board_state.payout_for_position(1).unwrap();
    assert_eq!(
        resulting_account(&claimed, &daily).lamports,
        daily_before - expected
    );
    assert_eq!(
        resulting_account(&claimed, &owner).lamports,
        owner_before + expected
    );
    let claimed_board: ArenaBoard = decode(resulting_account(&claimed, &score_board));
    let claimed_player: PlayerState = decode(resulting_account(&claimed, &player));
    assert_eq!(claimed_board.claimed_count, 1);
    assert_eq!(claimed_board.claimed_lamports, expected);
    assert_eq!(claimed_player.score_record.best_prize_rank, 2);
    assert_eq!(claimed_player.score_record.wins, 0);
    assert_eq!(claimed_player.score_record.rewards_lamports, expected);
    assert_eq!(claimed_player.theme_record, CompetitionRecord::default());
    let expected_points = zkube_core::ladder_points(5, 2).unwrap();
    assert_eq!(claimed_player.ladder_points, u64::from(expected_points));

    let duplicate = runtime.process_instruction(
        &instruction,
        &[
            (daily, resulting_account(&claimed, &daily).clone()),
            (
                score_board,
                resulting_account(&claimed, &score_board).clone(),
            ),
            (player, resulting_account(&claimed, &player).clone()),
            (owner, resulting_account(&claimed, &owner).clone()),
        ],
    );
    assert!(duplicate.program_result.is_err());
    assert_eq!(
        resulting_account(&duplicate, &daily).lamports,
        daily_before - expected
    );
    assert_eq!(
        resulting_account(&duplicate, &owner).lamports,
        owner_before + expected
    );
    let duplicate_player: PlayerState = decode(resulting_account(&duplicate, &player));
    assert_eq!(duplicate_player.ladder_points, u64::from(expected_points));
    assert_eq!(duplicate_player.score_record.rewards_lamports, expected);

    let (outsider_state, outsider_player) = player_fixture(outsider);
    let outsider_instruction = anchor_lang::solana_program::instruction::Instruction {
        accounts: zkube::accounts::ClaimDailyPrize {
            arena_daily: daily,
            arena_board: score_board,
            player_state: outsider_state,
            owner_authority: outsider,
            session_token: None,
            actor: outsider,
        }
        .to_account_metas(None),
        ..instruction.clone()
    };
    let outsider_result = runtime.process_instruction(
        &outsider_instruction,
        &[
            (daily, accounts[0].1.clone()),
            (score_board, accounts[1].1.clone()),
            (
                outsider_state,
                program_account(&outsider_player, 8 + PlayerState::INIT_SPACE),
            ),
            (outsider, system_account(owner_before)),
        ],
    );
    assert!(outsider_result.program_result.is_err());
    assert_eq!(
        resulting_account(&outsider_result, &daily).lamports,
        daily_before
    );
    assert_eq!(
        resulting_account(&outsider_result, &outsider).lamports,
        owner_before
    );

    let mut boundary_runtime = mollusk();
    boundary_runtime.sysvars.clock.unix_timestamp =
        score_board_state.sealed_at + zkube_core::DAILY_REWARD_CLAIM_WINDOW_SECONDS;
    let boundary = boundary_runtime.process_instruction(&instruction, &accounts);
    assert!(
        boundary.program_result.is_ok(),
        "{:?}",
        boundary.program_result
    );

    let mut late_runtime = mollusk();
    late_runtime.sysvars.clock.unix_timestamp = score_board_state.sealed_at
        + zkube_core::DAILY_REWARD_CLAIM_WINDOW_SECONDS
        + zkube_core::SECONDS_PER_DAY;
    let late = late_runtime.process_instruction(&instruction, &accounts);
    assert!(late.program_result.is_err());
    assert_eq!(resulting_account(&late, &daily).lamports, daily_before);
    assert_eq!(resulting_account(&late, &owner).lamports, owner_before);
}

#[test]
fn sbf_first_deposit_funds_and_activates_the_first_daily() {
    let authority = Pubkey::new_unique();
    let team = Pubkey::new_unique();
    let (protocol, protocol_state) = protocol_fixture(authority, team, true);
    let (arcade, arcade_bump) = Pubkey::find_program_address(&[ARCADE_CONFIG_SEED], &zkube::ID);
    let arcade_state = ArcadeConfig::canonical(protocol, arcade_bump);
    let today = 33;
    let (daily, daily_state) = daily_fixture(today, arcade, PeriodStatus::Funding, false);
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::DepositArenaDaily {
            protocol,
            arcade_config: arcade,
            arena_daily: daily,
            authority,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: zkube::instruction::DepositArenaDaily {
            lamports: 10_000_000,
        }
        .data(),
    };
    let accounts = vec![
        (
            protocol,
            program_account(&protocol_state, 8 + ProtocolConfig::INIT_SPACE),
        ),
        (
            arcade,
            program_account(&arcade_state, 8 + ArcadeConfig::INIT_SPACE),
        ),
        (
            daily,
            program_account(&daily_state, 8 + ArenaDaily::INIT_SPACE),
        ),
        (authority, system_account(1_000_000_000)),
        (anchor_lang::system_program::ID, system_program_account()),
    ];
    let mut runtime = mollusk();
    runtime.sysvars.clock.unix_timestamp = i64::from(today) * zkube_core::SECONDS_PER_DAY + 1;
    let result = runtime.process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    let arcade_after: ArcadeConfig = decode(resulting_account(&result, &arcade));
    let daily_after: ArenaDaily = decode(resulting_account(&result, &daily));
    assert!(arcade_after.launch_day_id > 0);
    assert_eq!(arcade_after.launch_day_id, today);
    assert_eq!(daily_after.ledger.seeded_lamports, 10_000_000);
    assert!(daily_after.predecessor_rollover_applied);
}

#[test]
fn sbf_expiry_rolls_exact_unclaimed_prizes_into_the_next_unopened_daily() {
    let caller = Pubkey::new_unique();
    let protocol = Pubkey::new_unique();
    let (arcade, mut arcade_state) = arcade_fixture(protocol);
    let day_id = 20_600;
    let (daily, mut daily_state) = daily_fixture(day_id, arcade, PeriodStatus::Finalized, true);
    let players = (0..5).map(|_| Pubkey::new_unique()).collect::<Vec<_>>();
    let entries = players
        .iter()
        .enumerate()
        .map(|(index, player)| ArenaBoardEntry {
            player: *player,
            score: 100 - u32::try_from(index).unwrap(),
            ..ArenaBoardEntry::default()
        })
        .collect::<Vec<_>>();
    daily_state.score_qualified_players = 5;
    daily_state.finalized_at = day_window(daily_state.day_id).unwrap().1;
    let pool = 101_990_000;
    let (score_board, score_board_state, score_board_account, plan) = board_fixture(
        daily,
        day_id,
        DailyBoardKind::Score,
        5,
        pool,
        &entries,
        &[0],
    );
    let (theme_board, _, theme_board_account, _) =
        board_fixture(daily, day_id, DailyBoardKind::Theme, 0, 0, &[], &[]);
    daily_state.ledger = PoolLedger {
        seeded_lamports: pool,
        payout_lamports: plan.paid_lamports,
        rollover_out_lamports: plan.rollover_lamports,
        ..PoolLedger::default()
    };
    let expiry_at = score_board_state
        .sealed_at
        .max(decode::<ArenaBoard>(&theme_board_account).sealed_at)
        + zkube_core::DAILY_REWARD_CLAIM_WINDOW_SECONDS
        + 1;
    let current_day = u32::try_from(expiry_at / zkube_core::SECONDS_PER_DAY).unwrap();
    let following_day = current_day + 1;
    let (following, following_state) =
        daily_fixture(following_day, arcade, PeriodStatus::Open, true);
    arcade_state.last_daily_id = day_id;
    arcade_state.daily_root = [9; 32];
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::ExpireDailyClaims {
            arcade_config: arcade,
            arena_daily: daily,
            score_board,
            theme_board,
            following_daily: following,
            caller,
        }
        .to_account_metas(None),
        data: zkube::instruction::ExpireDailyClaims {}.data(),
    };
    let daily_before = 1_000_000_000;
    let following_before = ACCOUNT_LAMPORTS;
    let accounts = vec![
        (
            arcade,
            program_account(&arcade_state, 8 + ArcadeConfig::INIT_SPACE),
        ),
        (
            daily,
            serialized_account(
                &daily_state,
                8 + ArenaDaily::INIT_SPACE,
                zkube::ID,
                daily_before,
            ),
        ),
        (score_board, score_board_account),
        (theme_board, theme_board_account),
        (
            following,
            serialized_account(
                &following_state,
                8 + ArenaDaily::INIT_SPACE,
                zkube::ID,
                following_before,
            ),
        ),
        (caller, system_account(ACCOUNT_LAMPORTS)),
    ];
    let mut runtime = mollusk();
    runtime.sysvars.clock.unix_timestamp = expiry_at;
    let result = runtime.process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    let claimed = score_board_state.payout_for_position(0).unwrap();
    let expired = plan.paid_lamports - claimed;
    assert_eq!(
        resulting_account(&result, &daily).lamports,
        daily_before - expired
    );
    assert_eq!(
        resulting_account(&result, &following).lamports,
        following_before + expired
    );
    let daily_after: ArenaDaily = decode(resulting_account(&result, &daily));
    let following_after: ArenaDaily = decode(resulting_account(&result, &following));
    assert!(daily_after.claims_expired);
    assert_eq!(following_after.ledger.rollover_in_lamports, expired);
    assert_eq!(claimed + expired + plan.rollover_lamports, pool);
}

#[test]
fn sbf_daily_archive_and_close_return_only_rent_to_cadence_funding() {
    let caller = Pubkey::new_unique();
    let (arcade, mut archive_state) = arcade_fixture(Pubkey::new_unique());
    let day_id = 20_651;
    let (daily, daily_state) = daily_fixture(day_id, arcade, PeriodStatus::Finalized, true);
    let (score_board, score_board_state, score_board_account, _) =
        board_fixture(daily, day_id, DailyBoardKind::Score, 0, 0, &[], &[]);
    let (theme_board, theme_board_state, theme_board_account, _) =
        board_fixture(daily, day_id, DailyBoardKind::Theme, 0, 0, &[], &[]);
    archive_state.launch_day_id = day_id;
    archive_state.last_daily_id = day_id - 1;
    let archive = arcade;
    let archive_instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::ArchiveArenaDaily {
            arcade_config: archive,
            arena_daily: daily,
            score_board,
            theme_board,
            caller,
        }
        .to_account_metas(None),
        data: zkube::instruction::ArchiveArenaDaily {}.data(),
    };
    let archived = mollusk().process_instruction(
        &archive_instruction,
        &[
            (
                archive,
                program_account(&archive_state, 8 + ArcadeConfig::INIT_SPACE),
            ),
            (
                daily,
                program_account(&daily_state, 8 + ArenaDaily::INIT_SPACE),
            ),
            (score_board, score_board_account),
            (theme_board, theme_board_account),
            (caller, system_account(ACCOUNT_LAMPORTS)),
        ],
    );
    assert!(
        archived.program_result.is_ok(),
        "{:?}",
        archived.program_result
    );
    let archive_after: ArcadeConfig = decode(resulting_account(&archived, &archive));
    assert_eq!(archive_after.last_daily_id, day_id);
    assert_ne!(archive_after.daily_root, [0; 32]);

    let (cadence_funding, _) = Pubkey::find_program_address(&[CADENCE_FUNDING_SEED], &zkube::ID);
    let funding_before = 500_000_000;
    let daily_lamports = resulting_account(&archived, &daily).lamports;
    let score_board_lamports = resulting_account(&archived, &score_board).lamports;
    let theme_board_lamports = resulting_account(&archived, &theme_board).lamports;
    let close_instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::CloseArenaDaily {
            arcade_config: archive,
            arena_daily: daily,
            score_board,
            theme_board,
            cadence_funding,
            caller,
        }
        .to_account_metas(None),
        data: zkube::instruction::CloseArenaDaily {}.data(),
    };
    let mut runtime = mollusk();
    runtime.sysvars.clock.unix_timestamp =
        score_board_state.sealed_at.max(theme_board_state.sealed_at)
            + zkube_core::DAILY_REWARD_CLAIM_WINDOW_SECONDS
            + 1;
    let premature = runtime.process_instruction(
        &close_instruction,
        &[
            (archive, resulting_account(&archived, &archive).clone()),
            (daily, resulting_account(&archived, &daily).clone()),
            (
                score_board,
                resulting_account(&archived, &score_board).clone(),
            ),
            (
                theme_board,
                resulting_account(&archived, &theme_board).clone(),
            ),
            (cadence_funding, system_account(funding_before)),
            (caller, system_account(ACCOUNT_LAMPORTS)),
        ],
    );
    assert!(premature.program_result.is_err());

    let mut expired_daily: ArenaDaily = decode(resulting_account(&archived, &daily));
    expired_daily.claims_expired = true;
    let closed = runtime.process_instruction(
        &close_instruction,
        &[
            (archive, resulting_account(&archived, &archive).clone()),
            (
                daily,
                serialized_account(
                    &expired_daily,
                    8 + ArenaDaily::INIT_SPACE,
                    zkube::ID,
                    daily_lamports,
                ),
            ),
            (
                score_board,
                resulting_account(&archived, &score_board).clone(),
            ),
            (
                theme_board,
                resulting_account(&archived, &theme_board).clone(),
            ),
            (cadence_funding, system_account(funding_before)),
            (caller, system_account(ACCOUNT_LAMPORTS)),
        ],
    );
    assert!(closed.program_result.is_ok(), "{:?}", closed.program_result);
    assert_eq!(
        resulting_account(&closed, &cadence_funding).lamports,
        funding_before + daily_lamports + score_board_lamports + theme_board_lamports
    );
}

#[test]
fn a_closed_arena_player_returns_rent_to_its_payer() {
    let day_id = 20_656u32;
    let player = Pubkey::new_unique();
    let caller = Pubkey::new_unique();
    let (daily, _) =
        Pubkey::find_program_address(&[ARENA_DAILY_SEED, &day_id.to_le_bytes()], &zkube::ID);
    let (arena_player, player_bump) = Pubkey::find_program_address(
        &[ARENA_PLAYER_SEED, daily.as_ref(), player.as_ref()],
        &zkube::ID,
    );
    let rent_recipient = Pubkey::new_unique();
    let player_state = ArenaPlayer::initialize(daily, player, rent_recipient, player_bump);
    let participant_lamports = ACCOUNT_LAMPORTS;
    let funding_before = 1_000_000;
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::CloseArenaPlayer {
            arena_daily: daily,
            arena_player,
            rent_recipient,
            caller,
        }
        .to_account_metas(None),
        data: zkube::instruction::CloseArenaPlayer {}.data(),
    };
    let mut accounts = vec![
        (daily, system_account(0)),
        (
            arena_player,
            serialized_account(
                &player_state,
                8 + ArenaPlayer::INIT_SPACE,
                zkube::ID,
                participant_lamports,
            ),
        ),
        (rent_recipient, system_account(funding_before)),
        (caller, system_account(ACCOUNT_LAMPORTS)),
    ];
    let result = mollusk().process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    assert_eq!(
        resulting_account(&result, &rent_recipient).lamports,
        funding_before + participant_lamports
    );
    // A finalized parent still owns the source rows needed by board construction.
    for status in [
        PeriodStatus::Funding,
        PeriodStatus::Open,
        PeriodStatus::Finalized,
    ] {
        let (_, parent) = daily_fixture(day_id, Pubkey::new_unique(), status, true);
        accounts[0].1 = program_account(&parent, 8 + ArenaDaily::INIT_SPACE);
        let rejected = mollusk().process_instruction(&instruction, &accounts);
        assert!(rejected.program_result.is_err());
        assert_eq!(resulting_account(&rejected, &arena_player), &accounts[1].1);
        assert_eq!(
            resulting_account(&rejected, &rent_recipient).lamports,
            funding_before
        );
    }
}

#[test]
fn purchase_kredits_pays_the_protocol_destination_directly() {
    for count in [1, 10, 25] {
        let owner = Pubkey::new_unique();
        let team = Pubkey::new_unique();
        let (protocol, protocol_state) = protocol_fixture(Pubkey::new_unique(), team, false);
        let (arcade, config) = arcade_fixture(protocol);
        let (player, profile) = player_fixture(owner);
        let (credit, bump) = Pubkey::find_program_address(&[CREDIT_VAULT_SEED], &zkube::ID);
        let vault = CreditVault {
            version: ACCOUNT_VERSION,
            protocol,
            available_prize_lamports: 0,

            bump,
        };
        let instruction = anchor_lang::solana_program::instruction::Instruction {
            program_id: zkube::ID,
            accounts: zkube::accounts::PurchaseKredits {
                protocol,
                arcade_config: arcade,
                player_state: player,
                credit_vault: credit,
                team_destination: team,
                owner,
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
            data: zkube::instruction::PurchaseKredits {
                kredit_count: count,
            }
            .data(),
        };
        let accounts = vec![
            (
                protocol,
                program_account(&protocol_state, 8 + ProtocolConfig::INIT_SPACE),
            ),
            (
                arcade,
                program_account(&config, 8 + ArcadeConfig::INIT_SPACE),
            ),
            (
                player,
                program_account(&profile, 8 + PlayerState::INIT_SPACE),
            ),
            (credit, program_account(&vault, 8 + CreditVault::INIT_SPACE)),
            (team, system_account(1_000_000)),
            (owner, system_account(1_000_000_000)),
            (anchor_lang::system_program::ID, system_program_account()),
        ];
        let result = mollusk().process_instruction(&instruction, &accounts);
        assert!(result.program_result.is_ok(), "{:?}", result.program_result);
        let count = u64::from(count);
        assert_eq!(
            resulting_account(&result, &owner).lamports,
            1_000_000_000 - count * ARENA_ENTRY_LAMPORTS
        );
        assert_eq!(
            resulting_account(&result, &team).lamports,
            1_000_000 + count * zkube_core::ENTRY_OPERATOR_LAMPORTS
        );
        assert_eq!(
            resulting_account(&result, &credit).lamports,
            ACCOUNT_LAMPORTS + count * zkube_core::ENTRY_DAILY_LAMPORTS
        );
        let saved: PlayerState = decode(resulting_account(&result, &player));
        let vault: CreditVault = decode(resulting_account(&result, &credit));
        assert_eq!(saved.kredit_balance, count);
        assert_eq!(
            vault.available_prize_lamports,
            count * zkube_core::ENTRY_DAILY_LAMPORTS
        );

        let mut wrong_destination = instruction.clone();
        let wrong = Pubkey::new_unique();
        wrong_destination
            .accounts
            .iter_mut()
            .find(|meta| meta.pubkey == team)
            .unwrap()
            .pubkey = wrong;
        let mut invalid_accounts = accounts.clone();
        invalid_accounts.push((wrong, system_account(1_000_000)));
        let rejected = mollusk().process_instruction(&wrong_destination, &invalid_accounts);
        assert!(rejected.program_result.is_err());
        for key in [owner, player, credit, team] {
            assert_eq!(
                resulting_account(&rejected, &key),
                &accounts
                    .iter()
                    .find(|(address, _)| *address == key)
                    .unwrap()
                    .1
            );
        }
    }
}

struct FinalizedBoardFixture {
    runtime: Mollusk,
    result: mollusk_svm::result::InstructionResult,
    daily: Pubkey,
    score_board: Pubkey,
    theme_board: Pubkey,
    cadence_funding: Pubkey,
    caller: Pubkey,
}

fn finalize_board_capacity(
    count: u32,
    pool: u64,
    status: PeriodStatus,
    rollover: bool,
    deadline_offset: i64,
) -> FinalizedBoardFixture {
    let day_id = 20_651;
    let (arcade, _) = arcade_fixture(Pubkey::new_unique());
    let (daily, mut state) = daily_fixture(day_id, arcade, status, rollover);
    let (following, successor) = daily_fixture(day_id + 1, arcade, PeriodStatus::Funding, false);
    state.ledger.seeded_lamports = pool;
    state.score_qualified_players = count;
    state.theme_qualified_players = count;
    state.entries_paid = u64::from(count);
    state.entries_scored = u64::from(count);
    state.unique_players = count;
    assert_eq!(board_payout_plan(pool / 2, count).unwrap().count, count);
    let score_board = Pubkey::find_program_address(
        &[
            ARENA_BOARD_SEED,
            daily.as_ref(),
            DailyBoardKind::Score.seed(),
        ],
        &zkube::ID,
    )
    .0;
    let theme_board = Pubkey::find_program_address(
        &[
            ARENA_BOARD_SEED,
            daily.as_ref(),
            DailyBoardKind::Theme.seed(),
        ],
        &zkube::ID,
    )
    .0;
    let cadence_funding = Pubkey::find_program_address(&[CADENCE_FUNDING_SEED], &zkube::ID).0;
    let caller = Pubkey::new_unique();
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::FinalizeArenaDaily {
            arena_daily: daily,
            following_daily: following,
            score_board,
            theme_board,
            cadence_funding,
            caller,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: zkube::instruction::FinalizeArenaDaily {}.data(),
    };
    let accounts = vec![
        (
            daily,
            serialized_account(
                &state,
                8 + ArenaDaily::INIT_SPACE,
                zkube::ID,
                pool + 100_000_000,
            ),
        ),
        (
            following,
            program_account(&successor, 8 + ArenaDaily::INIT_SPACE),
        ),
        (score_board, system_account(0)),
        (theme_board, system_account(0)),
        (cadence_funding, system_account(2_000_000_000)),
        (caller, system_account(ACCOUNT_LAMPORTS)),
        (anchor_lang::system_program::ID, system_program_account()),
        (
            zkube::ID,
            executable_program_account(Pubkey::from_str_const(
                "BPFLoaderUpgradeab1e11111111111111111111111",
            )),
        ),
    ];
    let mut runtime = mollusk();
    runtime.sysvars.clock.unix_timestamp = day_window(day_id).unwrap().1 + deadline_offset;
    let result = runtime.process_instruction(&instruction, &accounts);
    println!(
        "count={count}, bytes={}, CU={}, result={:?}",
        ArenaBoard::account_space(count).unwrap(),
        result.compute_units_consumed,
        result.program_result
    );
    FinalizedBoardFixture {
        runtime,
        result,
        daily,
        score_board,
        theme_board,
        cadence_funding,
        caller,
    }
}

#[test]
fn full_board_finalization_stays_below_one_million_compute_units() {
    for pool in [1_000_000_000_000_000, u64::MAX - 100_000_000] {
        let fixture = finalize_board_capacity(
            ARENA_BOARD_CAPACITY as u32,
            pool,
            PeriodStatus::Open,
            true,
            0,
        );
        assert!(
            fixture.result.program_result.is_ok(),
            "{:?}",
            fixture.result.program_result
        );
        assert!(
            fixture.result.compute_units_consumed < 1_000_000,
            "full-board finalization used {} CU for pool {pool}",
            fixture.result.compute_units_consumed
        );
    }
}

#[test]
fn cadence_funding_creates_exact_boards_through_the_full_capacity() {
    for count in [0, 120, 121, ARENA_BOARD_CAPACITY as u32] {
        let FinalizedBoardFixture {
            runtime,
            result,
            daily,
            score_board,
            theme_board,
            cadence_funding,
            caller,
        } = finalize_board_capacity(
            count,
            if count == 0 { 0 } else { 1_000_000_000_000_000 },
            PeriodStatus::Open,
            true,
            0,
        );
        assert!(result.program_result.is_ok(), "{:?}", result.program_result);
        let rent = anchor_lang::prelude::Rent::default()
            .minimum_balance(ArenaBoard::account_space(count).unwrap());
        assert_eq!(
            resulting_account(&result, &cadence_funding).lamports,
            2_000_000_000 - 2 * rent
        );
        let daily_account = resulting_account(&result, &daily).clone();
        let finalized: ArenaDaily = decode(&daily_account);
        assert_eq!(finalized.status, PeriodStatus::Finalized);
        let rows = (0..count)
            .map(|position| ArenaBoardEntry {
                player: Pubkey::new_unique(),
                score: count - position,
                objective_total: u64::from(count - position),
                finalized_at: i64::from(position + 1),
                replay_hash: [1; 32],
            })
            .collect::<Vec<_>>();
        for (address, kind) in [
            (score_board, DailyBoardKind::Score),
            (theme_board, DailyBoardKind::Theme),
        ] {
            let mut account = resulting_account(&result, &address).clone();
            assert_eq!(account.lamports, rent);
            assert_eq!(
                account.data.len(),
                ArenaBoard::construction_space(count, 0).unwrap()
            );
            let board: ArenaBoard = decode(&account);
            assert_eq!(board.payout_count, count);
            let mut cursor = 0;
            let mut maximum_chunk_cu = 0;
            for chunk in rows.chunks(ARENA_BOARD_CHUNK_CAPACITY) {
                let sources = chunk
                    .iter()
                    .map(|entry| {
                        let (key, bump) = Pubkey::find_program_address(
                            &[ARENA_PLAYER_SEED, daily.as_ref(), entry.player.as_ref()],
                            &zkube::ID,
                        );
                        let mut source =
                            ArenaPlayer::initialize(daily, entry.player, entry.player, bump);
                        source.paid_entries = 1;
                        source.resolved_entries = 1;
                        source.score_best_entry = *entry;
                        source.theme_best_entry = *entry;
                        (key, program_account(&source, 8 + ArenaPlayer::INIT_SPACE))
                    })
                    .collect::<Vec<_>>();
                let keys = sources.iter().map(|(key, _)| *key).collect::<Vec<_>>();
                let next_cursor = cursor + chunk.len() as u32;
                let mut chunk_accounts = vec![
                    (daily, daily_account.clone()),
                    (address, account.clone()),
                    (caller, system_account(ACCOUNT_LAMPORTS)),
                ];
                chunk_accounts.extend(sources);
                let instruction = submit_instruction(daily, address, caller, kind, chunk, &keys);
                if next_cursor == count {
                    for delta in [-1isize, 1, ArenaBoardEntry::INIT_SPACE as isize] {
                        let mut malformed = chunk_accounts.clone();
                        malformed[1]
                            .1
                            .data
                            .resize(account.data.len().checked_add_signed(delta).unwrap(), 0);
                        let rejected = runtime.process_instruction(&instruction, &malformed);
                        assert!(rejected.program_result.is_err());
                        assert_eq!(resulting_account(&rejected, &address), &malformed[1].1);
                    }
                }
                let written = runtime.process_instruction(&instruction, &chunk_accounts);
                assert!(
                    written.program_result.is_ok(),
                    "count={count}, cursor={cursor}: {:?}",
                    written.program_result
                );
                maximum_chunk_cu = maximum_chunk_cu.max(written.compute_units_consumed);
                assert!(
                    written.compute_units_consumed < 200_000,
                    "chunk used {} CU",
                    written.compute_units_consumed
                );
                let updated = resulting_account(&written, &address).clone();
                assert_eq!(
                    updated.data.len() - account.data.len(),
                    chunk.len() * ArenaBoardEntry::INIT_SPACE
                );
                assert_eq!(updated.lamports, rent);
                let state: ArenaBoard = decode(&updated);
                assert_eq!(state.cursor, next_cursor);
                assert_eq!(state.sealed(), next_cursor == count);
                account = updated;
                cursor = next_cursor;
            }
            assert_eq!(
                account.data.len(),
                ArenaBoard::account_space(count).unwrap()
            );
            assert!(decode::<ArenaBoard>(&account).sealed());
            println!(
                "count={count}, kind={kind:?}, sealed_bytes={}, max_chunk_CU={maximum_chunk_cu}",
                account.data.len()
            );
        }
    }
}

#[test]
fn a_missed_funding_day_finalizes_after_its_window_and_rollover() {
    for (rollover, deadline_offset, allowed) in
        [(false, 0, false), (true, -1, false), (true, 0, true)]
    {
        let fixture =
            finalize_board_capacity(0, 0, PeriodStatus::Funding, rollover, deadline_offset);
        assert_eq!(fixture.result.program_result.is_ok(), allowed);
        if allowed {
            let daily: ArenaDaily = decode(resulting_account(&fixture.result, &fixture.daily));
            assert_eq!(daily.status, PeriodStatus::Finalized);
        }
    }
}

#[test]
fn an_expired_orphan_closes_without_period_accounts() {
    let owner = Pubkey::new_unique();
    let payer = Pubkey::new_unique();
    let (player, mut profile) = player_fixture(owner);
    let run_id = profile.next_run_id;
    profile
        .reserve_arcade_run(run_id, Pubkey::new_unique(), 100)
        .unwrap();
    profile.expire_arcade_run(run_id).unwrap();
    let (active, bump) = Pubkey::find_program_address(
        &[
            ACTIVE_RUN_SEED,
            b"active",
            owner.as_ref(),
            &run_id.to_le_bytes(),
        ],
        &zkube::ID,
    );
    let run = ActiveRun {
        version: ACCOUNT_VERSION,
        owner,
        rent_payer: payer,
        run_id,
        bump,
        ..ActiveRun::default()
    };
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::ConsumeArenaRun {
            player_state: player,
            arena_daily: None,
            arena_player: None,
            active_run: active,
            rent_recipient: payer,
        }
        .to_account_metas(None),
        data: zkube::instruction::ConsumeArenaRun {}.data(),
    };
    let accounts = vec![
        (
            player,
            program_account(&profile, 8 + PlayerState::INIT_SPACE),
        ),
        (active, program_account(&run, 8 + ActiveRun::INIT_SPACE)),
        (payer, system_account(100)),
        (
            zkube::ID,
            executable_program_account(Pubkey::from_str_const(
                "BPFLoaderUpgradeab1e11111111111111111111111",
            )),
        ),
    ];
    let result = mollusk().process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    assert_eq!(
        resulting_account(&result, &payer).lamports,
        ACCOUNT_LAMPORTS + 100
    );
    assert!(resulting_account(&result, &active).data.is_empty());
    let updated: PlayerState = decode(resulting_account(&result, &player));
    assert_eq!(updated.orphan_run_id, 0);
    let mut expected = Vec::new();
    profile.release_orphan(run_id).unwrap();
    profile.try_serialize(&mut expected).unwrap();
    assert_eq!(
        &resulting_account(&result, &player).data[..expected.len()],
        expected
    );
}
