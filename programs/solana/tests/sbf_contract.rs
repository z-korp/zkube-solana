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
            launch_day_id: 32,
            last_prepared_day: 32,
            last_daily_id: 31,
            ..ProtocolConfig::default()
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
    let (daily, mut day) = daily_fixture(32, PeriodStatus::Open, false);
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
            score_board: None,
            theme_board: None,
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
    let day_id = 32;
    let now = day_window(day_id).unwrap().0 + 1;

    for (candidate_day, status, amount) in [
        (day_id, PeriodStatus::Open, 0),
        (day_id, PeriodStatus::Finalized, 1),
        (day_id + 2, PeriodStatus::Funding, 1),
    ] {
        let (daily, daily_state) = daily_fixture(candidate_day, status, true);
        let instruction = anchor_lang::solana_program::instruction::Instruction {
            program_id: zkube::ID,
            accounts: zkube::accounts::DepositArenaDaily {
                protocol,
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

/// When the fixtures' finalized Dailies sealed: at their own close.
fn finalized_at(day_id: u32) -> i64 {
    zkube_core::daily_window(day_id).1
}

fn board_address(daily: Pubkey, kind: DailyBoardKind) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[ARENA_BOARD_SEED, daily.as_ref(), kind.seed()], &zkube::ID)
}

/// A board of a running Daily: its header, `rows` sorted best first, and the
/// row rent `entrants` first entries moved into it.
fn open_board(
    daily: Pubkey,
    day_id: u32,
    kind: DailyBoardKind,
    rows: &[ArenaBoardEntry],
    entrants: u32,
) -> (Pubkey, Account) {
    let (address, bump) = board_address(daily, kind);
    let header = ArenaBoard {
        version: ACCOUNT_VERSION,
        arena_daily: daily,
        day_id,
        kind,
        bump,
        ..ArenaBoard::default()
    };
    let mut data = Vec::new();
    header.try_serialize(&mut data).unwrap();
    assert_eq!(data.len(), ArenaBoard::HEADER_SIZE);
    for row in rows {
        row.serialize(&mut data).unwrap();
    }
    (
        address,
        Account {
            lamports: anchor_lang::prelude::Rent::default()
                .minimum_balance(ArenaBoard::funded_space(entrants)),
            data,
            owner: zkube::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
}

fn board_rows(account: &Account, count: usize) -> Vec<ArenaBoardEntry> {
    (0..count)
        .map(|position| {
            let start = ArenaBoard::HEADER_SIZE + position * ArenaBoardEntry::INIT_SPACE;
            <ArenaBoardEntry as anchor_lang::AnchorDeserialize>::try_from_slice(
                &account.data[start..start + ArenaBoardEntry::INIT_SPACE],
            )
            .unwrap()
        })
        .collect()
}

fn daily_fixture(
    day_id: u32,
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
            status,
            predecessor_day: day_id - 1,
            predecessor_rollover_applied,
            rules_hash: [2; 32],
            finalized_at: if status == PeriodStatus::Finalized {
                finalized_at(day_id)
            } else {
                0
            },
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
    let day_id = 32;
    let (current_daily, current_daily_state) = daily_fixture(day_id, PeriodStatus::Open, false);
    let (following_daily, following_daily_state) =
        daily_fixture(day_id + 1, PeriodStatus::Funding, false);
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
        daily_fixture(day_id - 1, PeriodStatus::Finalized, true);
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
        daily_fixture(day_id - 2, PeriodStatus::Finalized, true);
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
    let (score_board, score_board_account) =
        open_board(current_daily, day_id, DailyBoardKind::Score, &[], 0);
    let (theme_board, theme_board_account) =
        open_board(current_daily, day_id, DailyBoardKind::Theme, &[], 0);
    let cadence_funding = Pubkey::find_program_address(&[CADENCE_FUNDING_SEED], &zkube::ID).0;
    let cadence_before = 500_000_000;
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::EnterArena {
            protocol,
            player_state: player,
            current_daily,
            arena_player,
            following_daily,
            score_board,
            theme_board,
            cadence_funding,
            credit_vault,
            active_run,
            payer: actor,
            owner_authority: owner,
            session_token: Some(session_token),
            actor,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: zkube::instruction::EnterArena { run_id }.data(),
    };
    let claim = |daily, board| anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::ClaimDailyPrize {
            arena_daily: daily,
            arena_board: board,
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
    let instructions = [
        claim(duplicate_daily, duplicate_board),
        claim(claim_daily, claim_board),
        instruction.clone(),
    ];
    let actor_before = 100_000_000;
    let accounts = vec![
        (
            protocol,
            program_account(&protocol_state, 8 + ProtocolConfig::INIT_SPACE),
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
        (score_board, score_board_account),
        (theme_board, theme_board_account),
        (cadence_funding, system_account(cadence_before)),
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

    // Suspension stops paid entry at once, even on a Daily that is already
    // Open, and before any Kredit, vault, pot or reservation changes.
    let with_suspension = |until_day: u32| {
        let mut suspended = accounts.clone();
        let mut state = protocol_state.clone();
        state.suspended_until_day = until_day;
        suspended[0].1 = program_account(&state, 8 + ProtocolConfig::INIT_SPACE);
        suspended
    };
    let suspended = with_suspension(day_id + 3);
    let refused = runtime.process_instruction(&instruction, &suspended);
    assert_eq!(
        refused.program_result,
        mollusk_svm::result::ProgramResult::Failure(
            anchor_lang::error::Error::from(zkube::error::ErrorCode::DailyNotScheduled).into()
        )
    );
    for (key, original) in &suspended {
        assert_eq!(resulting_account(&refused, key), original);
    }
    let resumed = runtime.process_instruction(&instruction, &with_suspension(day_id));
    assert!(resumed.program_result.is_ok(), "{:?}", resumed.program_result);

    // Entry backing reaches only the Daily prepared directly after today's.
    let (later_daily, later_daily_state) = daily_fixture(day_id + 2, PeriodStatus::Funding, false);
    let mut skipping = instruction.clone();
    skipping.accounts[4].pubkey = later_daily;
    let mut skipping_accounts = accounts.clone();
    skipping_accounts.push((
        later_daily,
        program_account(&later_daily_state, 8 + ArenaDaily::INIT_SPACE),
    ));
    let refused = runtime.process_instruction(&skipping, &skipping_accounts);
    assert!(refused.program_result.is_err());
    for (key, original) in &skipping_accounts {
        assert_eq!(resulting_account(&refused, key), original);
    }

    let result = runtime.process_instruction_chain(&instructions, &accounts);
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
    // Cadence funding, not the player, paid for one row and its claim bit on
    // each board, before any run could earn it.
    let funded_row = anchor_lang::prelude::Rent::default()
        .minimum_balance(ArenaBoard::funded_space(1))
        - anchor_lang::prelude::Rent::default().minimum_balance(ArenaBoard::funded_space(0));
    assert_eq!(
        funded_row,
        (ARENA_BOARD_FUNDED_ROW_BYTES as u64) * 6_960
    );
    for board in [score_board, theme_board] {
        assert_eq!(
            resulting_account(&result, &board).lamports,
            anchor_lang::prelude::Rent::default().minimum_balance(ArenaBoard::funded_space(1))
        );
        assert_eq!(
            resulting_account(&result, &board).data.len(),
            ArenaBoard::HEADER_SIZE
        );
    }
    assert_eq!(
        resulting_account(&result, &cadence_funding).lamports,
        cadence_before - 2 * funded_row
    );
    // An entry the boards cannot hold rejects before the Kredit is spent.
    let mut unfunded = accounts.clone();
    unfunded
        .iter_mut()
        .find(|(key, _)| *key == cadence_funding)
        .unwrap()
        .1
        .lamports = 2 * funded_row - 1;
    let refused = runtime.process_instruction(&instruction, &unfunded);
    assert!(refused.program_result.is_err());
    for (key, original) in &unfunded {
        assert_eq!(resulting_account(&refused, key), original);
    }
    // The client's device funding is generated from these sizes: the entry
    // really costs what the quote says, and what is left covers delegation.
    let quoted = FirstEntryAccounts::sizes();
    let rent = anchor_lang::prelude::Rent::default();
    assert_eq!(arena_player_rent, quoted.arena_player_rent());
    assert_eq!(active_run_rent, rent.minimum_balance(quoted.active_run));
    assert_eq!(
        quoted.peak_rent() - arena_player_rent - active_run_rent,
        rent.minimum_balance(quoted.delegation_buffer)
            + rent.minimum_balance(quoted.delegation_record)
            + rent.minimum_balance(quoted.delegation_metadata)
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
            score_board: Some(score_board),
            theme_board: Some(theme_board),
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
        (score_board, resulting_account(&result, &score_board).clone()),
        (theme_board, resulting_account(&result, &theme_board).clone()),
    ];
    let scored = mollusk().process_instruction(
        &consume,
        &[
            consume_accounts[0].clone(),
            consume_accounts[1].clone(),
            consume_accounts[2].clone(),
            (active_run, partial_account),
            consume_accounts[4].clone(),
            consume_accounts[5].clone(),
            consume_accounts[6].clone(),
        ],
    );
    assert!(scored.program_result.is_ok(), "{:?}", scored.program_result);
    // The scored run is on the Score board at once; it has no Theme metric.
    let score_after = resulting_account(&scored, &score_board);
    assert_eq!(
        score_after.data.len(),
        ArenaBoard::open_space(1).unwrap()
    );
    let row = board_rows(score_after, 1)[0];
    assert_eq!((row.player, row.score), (owner, 1));
    assert_eq!(
        resulting_account(&scored, &theme_board).data.len(),
        ArenaBoard::HEADER_SIZE
    );
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
    let finalize = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::FinalizeArenaDaily {
            arena_daily: current_daily,
            following_daily,
            score_board,
            theme_board,
            cadence_funding,
            caller,
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
                (score_board, resulting_account(&consumed, &score_board).clone()),
                (theme_board, resulting_account(&consumed, &theme_board).clone()),
                (cadence_funding, system_account(500_000_000)),
                (caller, system_account(ACCOUNT_LAMPORTS)),
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
fn a_suspended_day_is_skipped_once_and_its_funding_reaches_the_next_scheduled_day() {
    let caller = Pubkey::new_unique();
    let (protocol, mut arcade_state) =
        protocol_fixture(Pubkey::new_unique(), Pubkey::new_unique(), false);
    let suspended_day_id = arcade_state.launch_day_id + 1;
    let successor_day_id = suspended_day_id + 1;
    arcade_state.suspended_until_day = successor_day_id;
    let (suspended_daily, mut suspended_state) =
        daily_fixture(suspended_day_id, PeriodStatus::Funding, true);
    let (successor_daily, successor_state) =
        daily_fixture(successor_day_id, PeriodStatus::Funding, false);
    let funded_lamports = 1_000_000;
    suspended_state.ledger.seeded_lamports = funded_lamports;
    let (cadence_funding, _) = Pubkey::find_program_address(&[CADENCE_FUNDING_SEED], &zkube::ID);
    let skipped_score = open_board(
        suspended_daily,
        suspended_day_id,
        DailyBoardKind::Score,
        &[],
        0,
    );
    let skipped_theme = open_board(
        suspended_daily,
        suspended_day_id,
        DailyBoardKind::Theme,
        &[],
        0,
    );
    let board_rent = skipped_score.1.lamports;
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::SkipSuspendedArenaDaily {
            protocol: protocol,
            suspended_daily,
            successor_daily,
            score_board: skipped_score.0,
            theme_board: skipped_theme.0,
            cadence_funding,
            caller,
        }
        .to_account_metas(None),
        data: zkube::instruction::SkipSuspendedArenaDaily {}.data(),
    };
    let accounts = vec![
        (
            protocol,
            program_account(&arcade_state, 8 + ProtocolConfig::INIT_SPACE),
        ),
        (
            suspended_daily,
            program_account(&suspended_state, 8 + ArenaDaily::INIT_SPACE),
        ),
        (
            successor_daily,
            program_account(&successor_state, 8 + ArenaDaily::INIT_SPACE),
        ),
        skipped_score.clone(),
        skipped_theme.clone(),
        (cadence_funding, system_account(ACCOUNT_LAMPORTS)),
        (caller, system_account(ACCOUNT_LAMPORTS)),
    ];
    let result = mollusk().process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    // The skipped day's boards close with it and return all their rent.
    for board in [skipped_score.0, skipped_theme.0] {
        assert_eq!(resulting_account(&result, &board).lamports, 0);
    }
    assert_eq!(
        resulting_account(&result, &cadence_funding).lamports,
        2 * ACCOUNT_LAMPORTS - funded_lamports + 2 * board_rent
    );
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
    let missing_day = protocol_state.launch_day_id + 2;
    let content = zkube_core::daily_pair_with::<SolanaSha256>(missing_day);
    let realm_map_id = content.0;
    let (missing, _) =
        Pubkey::find_program_address(&[ARENA_DAILY_SEED, &missing_day.to_le_bytes()], &zkube::ID);
    let (cadence_funding, _) = Pubkey::find_program_address(&[CADENCE_FUNDING_SEED], &zkube::ID);
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::PrepareArenaDaily {
            protocol,
            arena_daily: missing,
            score_board: board_address(missing, DailyBoardKind::Score).0,
            theme_board: board_address(missing, DailyBoardKind::Theme).0,
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
        (missing, system_account(0)),
        (board_address(missing, DailyBoardKind::Score).0, system_account(0)),
        (board_address(missing, DailyBoardKind::Theme).0, system_account(0)),
        (cadence_funding, system_account(funding_before)),
        (caller, system_account(ACCOUNT_LAMPORTS)),
        (anchor_lang::system_program::ID, system_program_account()),
    ];
    let mut runtime = mollusk();
    runtime.sysvars.clock.unix_timestamp = day_window(missing_day + 5).unwrap().0;
    let result = runtime.process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    let after: ArenaDaily = decode(resulting_account(&result, &missing));
    assert_eq!(after.day_id, missing_day);
    assert_eq!(after.status, PeriodStatus::Funding);
    assert!(!after.predecessor_rollover_applied);
    assert_eq!(after.predecessor_day, protocol_state.launch_day_id);
    let advanced: ProtocolConfig = decode(resulting_account(&result, &protocol));
    assert_eq!(advanced.last_prepared_day, missing_day);
    // Preparation only moves forward: no day at or below the last one.
    let mut stale = accounts.clone();
    stale[0].1 = resulting_account(&result, &protocol).clone();
    assert!(runtime
        .process_instruction(&instruction, &stale)
        .program_result
        .is_err());
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
    // Both boards exist from preparation as empty headers bound to the day.
    let header_rent =
        anchor_lang::prelude::Rent::default().minimum_balance(ArenaBoard::HEADER_SIZE);
    for kind in [DailyBoardKind::Score, DailyBoardKind::Theme] {
        let account = resulting_account(&result, &board_address(missing, kind).0);
        assert_eq!(account.owner, zkube::ID);
        assert_eq!(account.data.len(), ArenaBoard::HEADER_SIZE);
        assert_eq!(account.lamports, header_rent);
        let board: ArenaBoard = decode(account);
        assert!(board.bound_to(missing, kind));
        assert_eq!((board.day_id, board.payout_count), (missing_day, 0));
    }
    assert_eq!(
        resulting_account(&result, &cadence_funding).lamports
            + resulting_account(&result, &missing).lamports
            + 2 * header_rent,
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
            funding_before - rent.saturating_sub(donation) - 2 * header_rent
        );
    }
}

#[test]
fn ladder_points_are_credited_once_per_claim() {
    let owner = Pubkey::new_unique();
    let outsider = Pubkey::new_unique();
    let day_id = 20_650;
    let (daily, mut daily_state) = daily_fixture(day_id, PeriodStatus::Finalized, true);
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
    runtime.sysvars.clock.unix_timestamp = finalized_at(day_id) + 1;
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
    assert!(duplicate.program_result.is_ok());
    for address in [daily, score_board, player, owner] {
        assert_eq!(
            resulting_account(&duplicate, &address),
            resulting_account(&claimed, &address)
        );
    }
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
        finalized_at(day_id) + zkube_core::DAILY_REWARD_CLAIM_WINDOW_SECONDS;
    let boundary = boundary_runtime.process_instruction(&instruction, &accounts);
    assert!(
        boundary.program_result.is_ok(),
        "{:?}",
        boundary.program_result
    );

    let mut late_runtime = mollusk();
    late_runtime.sysvars.clock.unix_timestamp = finalized_at(day_id)
        + zkube_core::DAILY_REWARD_CLAIM_WINDOW_SECONDS
        + zkube_core::SECONDS_PER_DAY;
    let late = late_runtime.process_instruction(&instruction, &accounts);
    assert!(late.program_result.is_ok());
    for (address, account) in &accounts {
        assert_eq!(resulting_account(&late, address), account);
    }

    let mut expired_accounts = accounts.clone();
    daily_state.claims_expired = true;
    daily_state
        .try_serialize(&mut &mut expired_accounts[0].1.data[..])
        .unwrap();
    let expired = late_runtime.process_instruction(&instruction, &expired_accounts);
    assert!(expired.program_result.is_ok());
    for (address, account) in &expired_accounts {
        assert_eq!(resulting_account(&expired, address), account);
    }

    // A board is sealed exactly when its Daily is finalized.
    let mut unsealed_accounts = accounts.clone();
    daily_state.claims_expired = false;
    daily_state.status = PeriodStatus::Open;
    daily_state
        .try_serialize(&mut &mut unsealed_accounts[0].1.data[..])
        .unwrap();
    let unsealed = late_runtime.process_instruction(&instruction, &unsealed_accounts);
    assert!(unsealed.program_result.is_err());
    for (address, account) in &unsealed_accounts {
        assert_eq!(resulting_account(&unsealed, address), account);
    }
}

#[test]
fn sbf_first_deposit_funds_and_activates_the_first_daily() {
    let authority = Pubkey::new_unique();
    let team = Pubkey::new_unique();
    let (protocol, mut protocol_state) = protocol_fixture(authority, team, true);

    protocol_state.launch_day_id = 0;
    protocol_state.last_daily_id = 0;
    let today = 33;
    let (daily, daily_state) = daily_fixture(today, PeriodStatus::Funding, false);
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::DepositArenaDaily {
            protocol,
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
            daily,
            program_account(&daily_state, 8 + ArenaDaily::INIT_SPACE),
        ),
        (authority, system_account(1_000_000_000)),
        (anchor_lang::system_program::ID, system_program_account()),
    ];
    let mut runtime = mollusk();
    runtime.sysvars.clock.unix_timestamp = day_window(today).unwrap().0 + 1;
    let result = runtime.process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    let protocol_after: ProtocolConfig = decode(resulting_account(&result, &protocol));
    let daily_after: ArenaDaily = decode(resulting_account(&result, &daily));
    assert!(protocol_after.launch_day_id > 0);
    assert_eq!(protocol_after.launch_day_id, today);
    assert_eq!(daily_after.ledger.seeded_lamports, 10_000_000);
    assert!(daily_after.predecessor_rollover_applied);
}

#[test]
fn sbf_expiry_rolls_exact_unclaimed_prizes_into_the_next_unopened_daily() {
    let caller = Pubkey::new_unique();
    let (protocol, mut arcade_state) =
        protocol_fixture(Pubkey::new_unique(), Pubkey::new_unique(), false);
    let day_id = 20_600;
    let (daily, mut daily_state) = daily_fixture(day_id, PeriodStatus::Finalized, true);
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
    let expiry_at = finalized_at(day_id) + zkube_core::DAILY_REWARD_CLAIM_WINDOW_SECONDS + 1;
    let current_day = zkube_core::day_id_at(expiry_at).unwrap();
    let following_day = current_day + 1;
    let (following, following_state) = daily_fixture(following_day, PeriodStatus::Open, true);
    arcade_state.last_daily_id = day_id;
    arcade_state.daily_root = [9; 32];
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::ExpireDailyClaims {
            protocol: protocol,
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
            protocol,
            program_account(&arcade_state, 8 + ProtocolConfig::INIT_SPACE),
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
    let (protocol, mut archive_state) =
        protocol_fixture(Pubkey::new_unique(), Pubkey::new_unique(), false);
    let day_id = 20_651;
    let (daily, daily_state) = daily_fixture(day_id, PeriodStatus::Finalized, true);
    let (score_board, _, score_board_account, _) =
        board_fixture(daily, day_id, DailyBoardKind::Score, 0, 0, &[], &[]);
    let (theme_board, _, theme_board_account, _) =
        board_fixture(daily, day_id, DailyBoardKind::Theme, 0, 0, &[], &[]);
    archive_state.launch_day_id = day_id;
    archive_state.last_daily_id = day_id - 1;
    let archive = protocol;
    let archive_instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::ArchiveArenaDaily {
            protocol: archive,
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
                program_account(&archive_state, 8 + ProtocolConfig::INIT_SPACE),
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
    let archive_after: ProtocolConfig = decode(resulting_account(&archived, &archive));
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
            protocol: archive,
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
        finalized_at(day_id) + zkube_core::DAILY_REWARD_CLAIM_WINDOW_SECONDS + 1;
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
    // The boards are complete at finalization and never read this account
    // again, so its rent returns as soon as the Daily is finalized. While the
    // Daily still runs it stays.
    for (status, closes) in [
        (PeriodStatus::Funding, false),
        (PeriodStatus::Open, false),
        (PeriodStatus::Finalized, true),
    ] {
        let (_, parent) = daily_fixture(day_id, status, true);
        accounts[0].1 = program_account(&parent, 8 + ArenaDaily::INIT_SPACE);
        let outcome = mollusk().process_instruction(&instruction, &accounts);
        assert_eq!(outcome.program_result.is_ok(), closes, "{status:?}");
        if closes {
            assert_eq!(
                resulting_account(&outcome, &rent_recipient).lamports,
                funding_before + participant_lamports
            );
        } else {
            assert_eq!(resulting_account(&outcome, &arena_player), &accounts[1].1);
        }
    }
    // Another program's account at the parent address proves nothing.
    let (_, parent) = daily_fixture(day_id, PeriodStatus::Finalized, true);
    accounts[0].1 = serialized_account(
        &parent,
        8 + ArenaDaily::INIT_SPACE,
        Pubkey::new_unique(),
        ACCOUNT_LAMPORTS,
    );
    assert!(mollusk()
        .process_instruction(&instruction, &accounts)
        .program_result
        .is_err());
}

/// An owner-signed entry on `day_id` with every account it reads, for a
/// player whose daily player account does not exist.
fn owner_entry(
    day_id: u32,
    current: Account,
    boards: [(Pubkey, Account); 2],
) -> (
    anchor_lang::solana_program::instruction::Instruction,
    Vec<(Pubkey, Account)>,
) {
    let owner = Pubkey::new_unique();
    let (protocol, mut protocol_state) =
        protocol_fixture(Pubkey::new_unique(), Pubkey::new_unique(), false);
    protocol_state.launch_day_id = day_id - 1;
    let (current_daily, _) = daily_fixture(day_id, PeriodStatus::Open, true);
    let (following_daily, following_state) =
        daily_fixture(day_id + 1, PeriodStatus::Funding, false);
    let (credit_vault, vault_state) = credit_vault_fixture(protocol);
    let (player, mut player_state) = player_fixture(owner);
    player_state.record_kredit_purchase(1).unwrap();
    let arena_player = Pubkey::find_program_address(
        &[ARENA_PLAYER_SEED, current_daily.as_ref(), owner.as_ref()],
        &zkube::ID,
    )
    .0;
    let run_id = player_state.next_run_id;
    let active_run = Pubkey::find_program_address(
        &[
            ACTIVE_RUN_SEED,
            b"active",
            owner.as_ref(),
            &run_id.to_le_bytes(),
        ],
        &zkube::ID,
    )
    .0;
    let cadence_funding = Pubkey::find_program_address(&[CADENCE_FUNDING_SEED], &zkube::ID).0;
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::EnterArena {
            protocol,
            player_state: player,
            current_daily,
            arena_player,
            following_daily,
            score_board: boards[0].0,
            theme_board: boards[1].0,
            cadence_funding,
            credit_vault,
            active_run,
            payer: owner,
            owner_authority: owner,
            session_token: None,
            actor: owner,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: zkube::instruction::EnterArena { run_id }.data(),
    };
    let [score, theme] = boards;
    let accounts = vec![
        (
            protocol,
            program_account(&protocol_state, 8 + ProtocolConfig::INIT_SPACE),
        ),
        (
            player,
            program_account(&player_state, 8 + PlayerState::INIT_SPACE),
        ),
        (current_daily, current),
        (arena_player, system_account(0)),
        (
            following_daily,
            program_account(&following_state, 8 + ArenaDaily::INIT_SPACE),
        ),
        score,
        theme,
        (cadence_funding, system_account(CADENCE_BEFORE)),
        (
            credit_vault,
            serialized_account(
                &vault_state,
                8 + CreditVault::INIT_SPACE,
                zkube::ID,
                ACCOUNT_LAMPORTS + zkube_core::ENTRY_DAILY_LAMPORTS,
            ),
        ),
        (active_run, system_account(0)),
        (owner, system_account(100_000_000)),
        (anchor_lang::system_program::ID, system_program_account()),
        (
            zkube::ID,
            executable_program_account(Pubkey::from_str_const(
                "BPFLoaderUpgradeab1e11111111111111111111111",
            )),
        ),
    ];
    (instruction, accounts)
}

#[test]
fn a_closed_daily_player_cannot_come_back_on_a_finalized_or_archived_day() {
    let day_id = 20_660;
    let (daily, open) = daily_fixture(day_id, PeriodStatus::Open, true);
    let (_, finalized) = daily_fixture(day_id, PeriodStatus::Finalized, true);
    let open_boards = || {
        [
            open_board(daily, day_id, DailyBoardKind::Score, &[], 0),
            open_board(daily, day_id, DailyBoardKind::Theme, &[], 0),
        ]
    };
    let sealed_boards = || {
        [DailyBoardKind::Score, DailyBoardKind::Theme].map(|kind| {
            let (address, _, account, _) = board_fixture(daily, day_id, kind, 0, 0, &[], &[]);
            (address, account)
        })
    };
    let mut runtime = mollusk();
    runtime.sysvars.clock.unix_timestamp = day_window(day_id).unwrap().0 + 60;

    // The same entry succeeds while the Daily runs: the fixture is sound.
    let (enter, accounts) = owner_entry(
        day_id,
        program_account(&open, 8 + ArenaDaily::INIT_SPACE),
        open_boards(),
    );
    let entered = runtime.process_instruction(&enter, &accounts);
    assert!(entered.program_result.is_ok(), "{:?}", entered.program_result);

    // Finalized, with boards sealed or still shaped as open; then archived;
    // then the Daily closed. No entry initializes a daily player again, so
    // neither the qualifying credit nor the streak can repeat for that day.
    let closed = system_account(0);
    for (current, boards, archived) in [
        (
            program_account(&finalized, 8 + ArenaDaily::INIT_SPACE),
            sealed_boards(),
            false,
        ),
        (
            program_account(&finalized, 8 + ArenaDaily::INIT_SPACE),
            open_boards(),
            false,
        ),
        (
            program_account(&finalized, 8 + ArenaDaily::INIT_SPACE),
            sealed_boards(),
            true,
        ),
        (closed.clone(), sealed_boards(), true),
    ] {
        let (enter, mut accounts) = owner_entry(day_id, current, boards);
        if archived {
            let mut protocol: ProtocolConfig = decode(&accounts[0].1);
            protocol.last_daily_id = day_id;
            accounts[0].1 = program_account(&protocol, 8 + ProtocolConfig::INIT_SPACE);
        }
        let refused = runtime.process_instruction(&enter, &accounts);
        assert!(refused.program_result.is_err());
        for (key, original) in &accounts {
            assert_eq!(resulting_account(&refused, key), original);
        }
    }

    // A run of that day that turns up after finalization scores nothing: the
    // consume is refused, so no row and no credit can be added.
    let owner = Pubkey::new_unique();
    let (player, mut profile) = player_fixture(owner);
    let run_id = profile.next_run_id;
    profile
        .reserve_arcade_run(run_id, daily, day_window(day_id).unwrap().1)
        .unwrap();
    let (participant, bump) = Pubkey::find_program_address(
        &[ARENA_PLAYER_SEED, daily.as_ref(), owner.as_ref()],
        &zkube::ID,
    );
    let mut entry = ArenaPlayer::initialize(daily, owner, owner, bump);
    entry.paid_entries = 1;
    entry.active_paid_run_id = run_id;
    let (active, active_bump) = Pubkey::find_program_address(
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
        rent_payer: owner,
        run_id,
        daily_challenge: daily,
        lifecycle: RunLifecycle::Finished,
        finished_at: day_window(day_id).unwrap().0 + 5,
        deadline_at: day_window(day_id).unwrap().1,
        action_counter: 3,
        daily_score: 50,
        objective_total: 50,
        bump: active_bump,
        ..ActiveRun::default()
    };
    let [score, theme] = sealed_boards();
    let mut late = finalized.clone();
    late.entries_paid = 1;
    let consume = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::ConsumeArenaRun {
            player_state: player,
            arena_daily: Some(daily),
            arena_player: Some(participant),
            active_run: active,
            rent_recipient: owner,
            score_board: Some(score.0),
            theme_board: Some(theme.0),
        }
        .to_account_metas(None),
        data: zkube::instruction::ConsumeArenaRun {}.data(),
    };
    let accounts = vec![
        (
            player,
            program_account(&profile, 8 + PlayerState::INIT_SPACE),
        ),
        (daily, program_account(&late, 8 + ArenaDaily::INIT_SPACE)),
        (
            participant,
            program_account(&entry, 8 + ArenaPlayer::INIT_SPACE),
        ),
        (active, program_account(&run, 8 + ActiveRun::INIT_SPACE)),
        (owner, system_account(ACCOUNT_LAMPORTS)),
        score,
        theme,
    ];
    let refused = mollusk().process_instruction(&consume, &accounts);
    assert!(refused.program_result.is_err());
    for (key, original) in &accounts {
        assert_eq!(resulting_account(&refused, key), original);
    }
}

#[test]
fn purchase_kredits_pays_the_protocol_destination_directly() {
    for count in [1, 10, 25] {
        let owner = Pubkey::new_unique();
        let team = Pubkey::new_unique();
        let (protocol, protocol_state) = protocol_fixture(Pubkey::new_unique(), team, false);
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
    result: mollusk_svm::result::InstructionResult,
    daily: Pubkey,
    score_board: Pubkey,
    theme_board: Pubkey,
    cadence_funding: Pubkey,
    /// The rows both boards held when finalization ran.
    rows: Vec<ArenaBoardEntry>,
    plan: BoardPayoutPlan,
}

const CADENCE_BEFORE: u64 = 2_000_000_000;

/// The row at `rank` of a field whose best row has metric `best`.
fn ranked_row(best: u32, rank: u32) -> ArenaBoardEntry {
    let mut player = [7u8; 32];
    player[..4].copy_from_slice(&rank.to_be_bytes());
    ArenaBoardEntry {
        player: Pubkey::new_from_array(player),
        score: best - rank,
        objective_total: u64::from(best - rank),
        finalized_at: i64::from(rank) + 1,
        replay_hash: [1; 32],
    }
}

/// Finalizes a resolved Daily whose `qualified` players all scored on both
/// boards. Each board holds what consuming their runs left there: the best
/// rows up to capacity, and the row rent of every entrant.
fn finalize_board_capacity(
    qualified: u32,
    pool: u64,
    status: PeriodStatus,
    rollover: bool,
    deadline_offset: i64,
) -> FinalizedBoardFixture {
    let day_id = 20_651;
    let (daily, mut state) = daily_fixture(day_id, status, rollover);
    let (following, successor) = daily_fixture(day_id + 1, PeriodStatus::Funding, false);
    state.ledger.seeded_lamports = pool;
    state.score_qualified_players = qualified;
    state.theme_qualified_players = qualified;
    state.entries_paid = u64::from(qualified);
    state.entries_scored = u64::from(qualified);
    state.unique_players = qualified;
    let plan = board_payout_plan(pool / 2, qualified).unwrap();
    let retained = qualified.min(ARENA_BOARD_CAPACITY as u32);
    let rows = (0..retained)
        .map(|rank| ranked_row(qualified, rank))
        .collect::<Vec<_>>();
    let (score_board, score_account) =
        open_board(daily, day_id, DailyBoardKind::Score, &rows, qualified);
    let (theme_board, theme_account) =
        open_board(daily, day_id, DailyBoardKind::Theme, &rows, qualified);
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
        (score_board, score_account),
        (theme_board, theme_account),
        (cadence_funding, system_account(CADENCE_BEFORE)),
        (caller, system_account(ACCOUNT_LAMPORTS)),
    ];
    let mut runtime = mollusk();
    runtime.sysvars.clock.unix_timestamp = day_window(day_id).unwrap().1 + deadline_offset;
    let result = runtime.process_instruction(&instruction, &accounts);
    println!(
        "qualified={qualified}, width={}, paying={}, CU={}, result={:?}",
        plan.width_count, plan.count, result.compute_units_consumed, result.program_result
    );
    FinalizedBoardFixture {
        result,
        daily,
        score_board,
        theme_board,
        cadence_funding,
        rows,
        plan,
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
        assert_eq!(fixture.plan.count as usize, ARENA_BOARD_CAPACITY);
        assert!(
            fixture.result.compute_units_consumed < 1_000_000,
            "full-board finalization used {} CU for pool {pool}",
            fixture.result.compute_units_consumed
        );
    }
}

#[test]
fn finalization_sizes_boards_far_wider_than_they_retain_in_one_transaction() {
    // The payout width and its denominator are never capped: both boards pay
    // across every qualifier while each retains only its capacity.
    for count in [
        zkube_core::PAYOUT_WIDTH_TABLE_RANKS,
        zkube_core::PAYOUT_WIDTH_TABLE_RANKS + 2_000,
    ] {
        let fixture = finalize_board_capacity(count, u64::MAX / 2, PeriodStatus::Open, true, 0);
        assert!(
            fixture.result.program_result.is_ok(),
            "{:?}",
            fixture.result.program_result
        );
        let board: ArenaBoard = decode(resulting_account(&fixture.result, &fixture.score_board));
        assert_eq!(board.width_count, count);
        assert_eq!(board.payout_count as usize, ARENA_BOARD_CAPACITY);
        assert!(board.capacity_limited);
        assert!(
            fixture.result.compute_units_consumed < 1_400_000,
            "width {count} used {} CU",
            fixture.result.compute_units_consumed
        );
    }
}

#[test]
fn finalization_cuts_to_the_paying_rows_and_returns_the_excess_rent() {
    let rent = anchor_lang::prelude::Rent::default();
    let capacity = ARENA_BOARD_CAPACITY as u32;
    // No qualifier; fewer paying places than qualifiers; every qualifier
    // paid; a full board; and more qualifiers than a board retains.
    for (qualified, pool) in [
        (0, 0),
        (9, 200_000_000),
        (120, 1_000_000_000_000_000),
        (capacity, 1_000_000_000_000_000),
        (capacity + 500, 40_000_000_000),
    ] {
        let fixture = finalize_board_capacity(qualified, pool, PeriodStatus::Open, true, 0);
        let FinalizedBoardFixture {
            result,
            daily,
            cadence_funding,
            rows,
            plan,
            ..
        } = &fixture;
        assert!(result.program_result.is_ok(), "{:?}", result.program_result);
        let paying = plan.count as usize;
        assert!(paying <= rows.len());
        let finalized: ArenaDaily = decode(resulting_account(result, daily));
        assert_eq!(finalized.status, PeriodStatus::Finalized);
        let space = ArenaBoard::account_space(plan.count).unwrap();
        for (address, kind) in [
            (fixture.score_board, DailyBoardKind::Score),
            (fixture.theme_board, DailyBoardKind::Theme),
        ] {
            let account = resulting_account(result, &address);
            // Exactly the paying rows, in order, then a clear claim bitmap.
            assert_eq!(account.data.len(), space);
            assert_eq!(account.lamports, rent.minimum_balance(space));
            assert_eq!(board_rows(account, paying), rows[..paying]);
            assert!(account.data[ArenaBoard::open_space(paying).unwrap()..]
                .iter()
                .all(|byte| *byte == 0));
            let board: ArenaBoard = decode(account);
            board.validate(*daily, kind, account.data.len()).unwrap();
            assert_eq!(board.qualified_count, qualified);
            assert_eq!(board.payout_count, plan.count);
            assert_eq!(board.capacity_limited, plan.count < plan.width_count);
            assert_eq!((board.claimed_count, board.claimed_lamports), (0, 0));
        }
        // Everything the boards no longer need is back with cadence funding.
        assert_eq!(
            resulting_account(result, cadence_funding).lamports,
            CADENCE_BEFORE
                + 2 * (rent.minimum_balance(ArenaBoard::funded_space(qualified))
                    - rent.minimum_balance(space))
        );
        // A second finalization, or a caller with its own rows, has no way in.
        let again = Pubkey::new_unique();
        let mut accounts = result.resulting_accounts.clone();
        accounts.push((again, system_account(ACCOUNT_LAMPORTS)));
        let repeated = mollusk().process_instruction(
            &anchor_lang::solana_program::instruction::Instruction {
                program_id: zkube::ID,
                accounts: zkube::accounts::FinalizeArenaDaily {
                    arena_daily: *daily,
                    following_daily: daily_fixture(20_652, PeriodStatus::Funding, false).0,
                    score_board: fixture.score_board,
                    theme_board: fixture.theme_board,
                    cadence_funding: *cadence_funding,
                    caller: again,
                }
                .to_account_metas(None),
                data: zkube::instruction::FinalizeArenaDaily {}.data(),
            },
            &accounts,
        );
        assert!(repeated.program_result.is_err());
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
            score_board: None,
            theme_board: None,
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

fn upgradeable_program_accounts(upgrade_authority: Option<Pubkey>) -> (Pubkey, Account, Account) {
    use solana_loader_v3_interface::state::UpgradeableLoaderState;
    let loader = Pubkey::from_str_const("BPFLoaderUpgradeab1e11111111111111111111111");
    let program_data = Pubkey::find_program_address(&[zkube::ID.as_ref()], &loader).0;
    let mut program = executable_program_account(loader);
    program.data = bincode::serialize(&UpgradeableLoaderState::Program {
        programdata_address: program_data,
    })
    .unwrap();
    let data = Account {
        lamports: ACCOUNT_LAMPORTS,
        data: bincode::serialize(&UpgradeableLoaderState::ProgramData {
            slot: 1,
            upgrade_authority_address: upgrade_authority,
        })
        .unwrap(),
        owner: loader,
        executable: false,
        rent_epoch: 0,
    };
    (program_data, program, data)
}

#[test]
fn an_untrusted_initializer_cannot_claim_the_protocol() {
    let upgrade_authority = Pubkey::new_unique();
    let governance = Pubkey::new_unique();
    let attacker = Pubkey::new_unique();
    let team = Pubkey::new_unique();
    let protocol = Pubkey::find_program_address(&[PROTOCOL_CONFIG_SEED], &zkube::ID).0;
    let vault = Pubkey::find_program_address(&[CREDIT_VAULT_SEED], &zkube::ID).0;
    let (program_data, program, data) = upgradeable_program_accounts(Some(upgrade_authority));
    let instruction = |authority, signer, program_data| {
        anchor_lang::solana_program::instruction::Instruction {
            program_id: zkube::ID,
            accounts: zkube::accounts::InitializeProtocol {
                protocol,
                credit_vault: vault,
                team_destination: team,
                authority,
                upgrade_authority: signer,
                program: zkube::ID,
                program_data,
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
            data: zkube::instruction::InitializeProtocol {
                args: zkube::InitializeProtocolArgs {
                    team_destination: team,
                    replay_domain: [9; 32],
                },
            }
            .data(),
        }
    };
    let accounts = |program_data_key: Pubkey, data: Account| {
        vec![
            (protocol, system_account(0)),
            (vault, system_account(0)),
            (team, system_account(0)),
            (governance, system_account(ACCOUNT_LAMPORTS)),
            (attacker, system_account(ACCOUNT_LAMPORTS)),
            (upgrade_authority, system_account(ACCOUNT_LAMPORTS)),
            (zkube::ID, program.clone()),
            (program_data_key, data),
            (anchor_lang::system_program::ID, system_program_account()),
        ]
    };
    let honest = accounts(program_data, data.clone());
    let reject = |instruction, accounts: &Vec<(Pubkey, Account)>| {
        let rejected = mollusk().process_instruction(&instruction, accounts);
        assert!(rejected.program_result.is_err());
        assert_eq!(resulting_account(&rejected, &protocol), &system_account(0));
        assert_eq!(resulting_account(&rejected, &vault), &system_account(0));
    };

    // Any first signer, with every otherwise-correct account.
    reject(instruction(attacker, attacker, program_data), &honest);
    // The attacker's own ProgramData look-alike naming them as authority.
    let forged = Pubkey::new_unique();
    let (_, _, forged_data) = upgradeable_program_accounts(Some(attacker));
    reject(
        instruction(attacker, attacker, forged),
        &accounts(forged, forged_data.clone()),
    );
    // The canonical address under a foreign owner.
    let mut foreign = forged_data;
    foreign.owner = anchor_lang::system_program::ID;
    reject(
        instruction(attacker, attacker, program_data),
        &accounts(program_data, foreign),
    );
    // A program whose upgrade authority was renounced has no bootstrap signer.
    let (_, _, renounced) = upgradeable_program_accounts(None);
    reject(
        instruction(attacker, attacker, program_data),
        &accounts(program_data, renounced),
    );

    // The upgrade authority authorizes a separately chosen governance signer.
    let initialized = mollusk().process_instruction(
        &instruction(governance, upgrade_authority, program_data),
        &honest,
    );
    assert!(
        initialized.program_result.is_ok(),
        "{:?}",
        initialized.program_result
    );
    let state: ProtocolConfig = decode(resulting_account(&initialized, &protocol));
    assert_eq!(state.authority, governance);
    assert_eq!(state.team_destination, team);
    assert!(state.paused);

    // Initialization happens exactly once.
    let mut again = honest.clone();
    again[0].1 = resulting_account(&initialized, &protocol).clone();
    again[1].1 = resulting_account(&initialized, &vault).clone();
    let repeated = mollusk().process_instruction(
        &instruction(governance, upgrade_authority, program_data),
        &again,
    );
    assert!(repeated.program_result.is_err());
}

#[test]
fn finalization_rejects_skipping_its_funding_successor() {
    for day_id in [20_651, u32::MAX - 2] {
        let (daily, mut state) = daily_fixture(day_id, PeriodStatus::Open, true);
        state.ledger.seeded_lamports = 5_000_000;
        let (next, next_state) = daily_fixture(day_id + 1, PeriodStatus::Funding, false);
        let (later, later_state) = daily_fixture(day_id + 2, PeriodStatus::Funding, false);
        let board = |kind: DailyBoardKind| {
            Pubkey::find_program_address(&[ARENA_BOARD_SEED, daily.as_ref(), kind.seed()], &zkube::ID)
                .0
        };
        let cadence_funding = Pubkey::find_program_address(&[CADENCE_FUNDING_SEED], &zkube::ID).0;
        let caller = Pubkey::new_unique();
        let finalize = |following_daily| anchor_lang::solana_program::instruction::Instruction {
            program_id: zkube::ID,
            accounts: zkube::accounts::FinalizeArenaDaily {
                arena_daily: daily,
                following_daily,
                score_board: board(DailyBoardKind::Score),
                theme_board: board(DailyBoardKind::Theme),
                cadence_funding,
                caller,
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
                    ACCOUNT_LAMPORTS + 5_000_000,
                ),
            ),
            (next, program_account(&next_state, 8 + ArenaDaily::INIT_SPACE)),
            (later, program_account(&later_state, 8 + ArenaDaily::INIT_SPACE)),
            open_board(daily, day_id, DailyBoardKind::Score, &[], 0),
            open_board(daily, day_id, DailyBoardKind::Theme, &[], 0),
            (cadence_funding, system_account(500_000_000)),
            (caller, system_account(ACCOUNT_LAMPORTS)),
        ];
        let mut runtime = mollusk();
        runtime.sysvars.clock.unix_timestamp = day_window(day_id).unwrap().1;

        // A later prepared Daily is not the successor: nothing moves.
        let skipped = runtime.process_instruction(&finalize(later), &accounts);
        assert!(skipped.program_result.is_err());
        for (key, original) in &accounts {
            assert_eq!(resulting_account(&skipped, key), original);
        }

        let settled = runtime.process_instruction(&finalize(next), &accounts);
        assert!(settled.program_result.is_ok(), "{:?}", settled.program_result);
        let successor: ArenaDaily = decode(resulting_account(&settled, &next));
        assert!(successor.predecessor_rollover_applied);
        assert_eq!(successor.ledger.rollover_in_lamports, 5_000_000);
        let untouched: ArenaDaily = decode(resulting_account(&settled, &later));
        assert!(!untouched.predecessor_rollover_applied);
    }
}

#[test]
fn an_early_opened_daily_still_carries_suspended_funding_across_the_gap() {
    let caller = Pubkey::new_unique();
    let (protocol, mut protocol_state) =
        protocol_fixture(Pubkey::new_unique(), Pubkey::new_unique(), false);
    let suspended_day = protocol_state.launch_day_id + 1;
    let resumed_day = suspended_day + 3;
    protocol_state.suspended_until_day = resumed_day;
    let funded = 1_000_000;
    let cadence_funding = Pubkey::find_program_address(&[CADENCE_FUNDING_SEED], &zkube::ID).0;
    // Both ends were activated early, before governance suspended the gap.
    let (source, mut source_state) = daily_fixture(suspended_day, PeriodStatus::Open, true);
    source_state.ledger.entry_lamports = funded;
    let (recipient, mut recipient_state) = daily_fixture(resumed_day, PeriodStatus::Open, false);
    recipient_state.predecessor_day = suspended_day;
    let (unrelated, mut unrelated_state) =
        daily_fixture(resumed_day + 1, PeriodStatus::Funding, false);
    unrelated_state.predecessor_day = resumed_day;
    let source_score = open_board(source, suspended_day, DailyBoardKind::Score, &[], 0);
    let source_theme = open_board(source, suspended_day, DailyBoardKind::Theme, &[], 0);
    let board_rent = source_score.1.lamports;
    let skip = |successor_daily| anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::SkipSuspendedArenaDaily {
            protocol,
            suspended_daily: source,
            successor_daily,
            score_board: source_score.0,
            theme_board: source_theme.0,
            cadence_funding,
            caller,
        }
        .to_account_metas(None),
        data: zkube::instruction::SkipSuspendedArenaDaily {}.data(),
    };
    let accounts = |source_state: &ArenaDaily| {
        vec![
            (
                protocol,
                program_account(&protocol_state, 8 + ProtocolConfig::INIT_SPACE),
            ),
            (
                source,
                serialized_account(
                    source_state,
                    8 + ArenaDaily::INIT_SPACE,
                    zkube::ID,
                    ACCOUNT_LAMPORTS + funded,
                ),
            ),
            (
                recipient,
                program_account(&recipient_state, 8 + ArenaDaily::INIT_SPACE),
            ),
            (
                unrelated,
                program_account(&unrelated_state, 8 + ArenaDaily::INIT_SPACE),
            ),
            source_score.clone(),
            source_theme.clone(),
            (cadence_funding, system_account(ACCOUNT_LAMPORTS)),
            (caller, system_account(ACCOUNT_LAMPORTS)),
        ]
    };
    let reject = |instruction, accounts: Vec<(Pubkey, Account)>| {
        let rejected = mollusk().process_instruction(&instruction, &accounts);
        assert!(rejected.program_result.is_err());
        for (key, original) in &accounts {
            assert_eq!(resulting_account(&rejected, key), original);
        }
    };

    // Not into a later Daily, not while a player's entry is on the day, and
    // not before the day's own predecessor has settled into it.
    reject(skip(unrelated), accounts(&source_state));
    let mut entered = source_state.clone();
    entered.entries_paid = 1;
    reject(skip(recipient), accounts(&entered));
    let mut unsettled = source_state.clone();
    unsettled.predecessor_rollover_applied = false;
    reject(skip(recipient), accounts(&unsettled));

    let moved = mollusk().process_instruction(&skip(recipient), &accounts(&source_state));
    assert!(moved.program_result.is_ok(), "{:?}", moved.program_result);
    let after: ArenaDaily = decode(resulting_account(&moved, &recipient));
    assert!(after.predecessor_rollover_applied);
    // The skipped day leaves the chain the result root archives along.
    assert_eq!(after.predecessor_day, source_state.predecessor_day);
    assert_eq!(after.status, PeriodStatus::Open);
    assert_eq!(after.ledger.rollover_in_lamports, funded);
    assert_eq!(resulting_account(&moved, &source).lamports, 0);
    assert_eq!(
        resulting_account(&moved, &cadence_funding).lamports,
        2 * ACCOUNT_LAMPORTS + 2 * board_rent
    );
    assert_eq!(
        resulting_account(&moved, &unrelated),
        &program_account(&unrelated_state, 8 + ArenaDaily::INIT_SPACE)
    );
    let repeated = mollusk().process_instruction(&skip(recipient), &moved.resulting_accounts);
    assert!(repeated.program_result.is_err());
}

#[test]
fn the_result_root_cannot_pass_over_a_finalized_daily() {
    let caller = Pubkey::new_unique();
    let (protocol, mut root) = protocol_fixture(Pubkey::new_unique(), Pubkey::new_unique(), false);
    let launch = 20_651;
    root.launch_day_id = launch;
    root.last_daily_id = launch;
    root.daily_root = [7; 32];
    // Two ordinary finalized days, then the first day after a skipped gap,
    // which the skip linked to the last day before it.
    let days = [(launch + 1, launch), (launch + 2, launch + 1), (launch + 6, launch + 2)];
    let mut accounts = vec![
        (protocol, program_account(&root, 8 + ProtocolConfig::INIT_SPACE)),
        (caller, system_account(ACCOUNT_LAMPORTS)),
    ];
    let mut archive = Vec::new();
    for (day_id, predecessor_day) in days {
        let (daily, mut state) = daily_fixture(day_id, PeriodStatus::Finalized, true);
        state.predecessor_day = predecessor_day;
        let (score_board, _, score_account, _) =
            board_fixture(daily, day_id, DailyBoardKind::Score, 0, 0, &[], &[]);
        let (theme_board, _, theme_account, _) =
            board_fixture(daily, day_id, DailyBoardKind::Theme, 0, 0, &[], &[]);
        accounts.push((daily, program_account(&state, 8 + ArenaDaily::INIT_SPACE)));
        accounts.push((score_board, score_account));
        accounts.push((theme_board, theme_account));
        archive.push(anchor_lang::solana_program::instruction::Instruction {
            program_id: zkube::ID,
            accounts: zkube::accounts::ArchiveArenaDaily {
                protocol,
                arena_daily: daily,
                score_board,
                theme_board,
                caller,
            }
            .to_account_metas(None),
            data: zkube::instruction::ArchiveArenaDaily {}.data(),
        });
    }
    for out_of_order in [&archive[1], &archive[2]] {
        let rejected = mollusk().process_instruction(out_of_order, &accounts);
        assert!(rejected.program_result.is_err());
        for (key, original) in &accounts {
            assert_eq!(resulting_account(&rejected, key), original);
        }
    }
    let archived = mollusk().process_instruction_chain(&archive, &accounts);
    assert!(archived.program_result.is_ok(), "{:?}", archived.program_result);
    let after: ProtocolConfig = decode(resulting_account(&archived, &protocol));
    assert_eq!(after.last_daily_id, launch + 6);
}

/// A small chain: accounts persist between instructions, as on a cluster.
struct World {
    runtime: Mollusk,
    accounts: std::collections::HashMap<Pubkey, Account>,
    day_id: u32,
    daily: Pubkey,
    following: Pubkey,
    protocol: Pubkey,
    credit_vault: Pubkey,
    cadence_funding: Pubkey,
}

impl World {
    /// One prepared, open Daily with empty boards and its successor.
    fn new(day_id: u32) -> Self {
        let mut accounts = std::collections::HashMap::new();
        let (protocol, mut protocol_state) =
            protocol_fixture(Pubkey::new_unique(), Pubkey::new_unique(), false);
        protocol_state.launch_day_id = day_id - 1;
        let (daily, state) = daily_fixture(day_id, PeriodStatus::Open, true);
        let (following, following_state) = daily_fixture(day_id + 1, PeriodStatus::Funding, false);
        let (credit_vault, mut vault_state) = credit_vault_fixture(protocol);
        vault_state.available_prize_lamports = 1_000 * zkube_core::ENTRY_DAILY_LAMPORTS;
        let cadence_funding = Pubkey::find_program_address(&[CADENCE_FUNDING_SEED], &zkube::ID).0;
        accounts.insert(
            protocol,
            program_account(&protocol_state, 8 + ProtocolConfig::INIT_SPACE),
        );
        accounts.insert(daily, program_account(&state, 8 + ArenaDaily::INIT_SPACE));
        accounts.insert(
            following,
            program_account(&following_state, 8 + ArenaDaily::INIT_SPACE),
        );
        accounts.insert(
            credit_vault,
            serialized_account(
                &vault_state,
                8 + CreditVault::INIT_SPACE,
                zkube::ID,
                ACCOUNT_LAMPORTS + vault_state.available_prize_lamports,
            ),
        );
        for kind in [DailyBoardKind::Score, DailyBoardKind::Theme] {
            let (address, account) = open_board(daily, day_id, kind, &[], 0);
            accounts.insert(address, account);
        }
        accounts.insert(cadence_funding, system_account(CADENCE_BEFORE));
        accounts.insert(anchor_lang::system_program::ID, system_program_account());
        accounts.insert(
            zkube::ID,
            executable_program_account(Pubkey::from_str_const(
                "BPFLoaderUpgradeab1e11111111111111111111111",
            )),
        );
        let mut runtime = mollusk();
        runtime.sysvars.clock.unix_timestamp = day_window(day_id).unwrap().0 + 60;
        Self {
            runtime,
            accounts,
            day_id,
            daily,
            following,
            protocol,
            credit_vault,
            cadence_funding,
        }
    }

    fn run(
        &mut self,
        instruction: &anchor_lang::solana_program::instruction::Instruction,
    ) -> mollusk_svm::result::InstructionResult {
        let mut keys = instruction
            .accounts
            .iter()
            .map(|meta| meta.pubkey)
            .chain([anchor_lang::system_program::ID, zkube::ID])
            .collect::<Vec<_>>();
        keys.sort();
        keys.dedup();
        let accounts = keys
            .into_iter()
            .map(|key| {
                (
                    key,
                    self.accounts
                        .get(&key)
                        .cloned()
                        .unwrap_or_else(|| system_account(0)),
                )
            })
            .collect::<Vec<_>>();
        let result = self.runtime.process_instruction(instruction, &accounts);
        if result.program_result.is_ok() {
            self.accounts
                .extend(result.resulting_accounts.iter().cloned());
        }
        result
    }

    fn board(&self, kind: DailyBoardKind) -> &Account {
        &self.accounts[&board_address(self.daily, kind).0]
    }

    fn player(&mut self, owner: Pubkey) {
        let (address, mut state) = player_fixture(owner);
        state.record_kredit_purchase(100).unwrap();
        self.accounts.insert(
            address,
            program_account(&state, 8 + PlayerState::INIT_SPACE),
        );
        self.accounts.insert(owner, system_account(1_000_000_000));
    }

    fn run_address(&self, owner: Pubkey) -> (Pubkey, u64) {
        let profile: PlayerState = decode(&self.accounts[&player_fixture(owner).0]);
        let run_id = if profile.active_run_id != 0 {
            profile.active_run_id
        } else {
            profile.next_run_id
        };
        (
            Pubkey::find_program_address(
                &[
                    ACTIVE_RUN_SEED,
                    b"active",
                    owner.as_ref(),
                    &run_id.to_le_bytes(),
                ],
                &zkube::ID,
            )
            .0,
            run_id,
        )
    }

    fn arena_player(&self, owner: Pubkey) -> Pubkey {
        Pubkey::find_program_address(
            &[ARENA_PLAYER_SEED, self.daily.as_ref(), owner.as_ref()],
            &zkube::ID,
        )
        .0
    }

    fn enter(&mut self, owner: Pubkey) -> mollusk_svm::result::InstructionResult {
        let (active_run, run_id) = self.run_address(owner);
        let instruction = anchor_lang::solana_program::instruction::Instruction {
            program_id: zkube::ID,
            accounts: zkube::accounts::EnterArena {
                protocol: self.protocol,
                player_state: player_fixture(owner).0,
                current_daily: self.daily,
                arena_player: self.arena_player(owner),
                following_daily: self.following,
                score_board: board_address(self.daily, DailyBoardKind::Score).0,
                theme_board: board_address(self.daily, DailyBoardKind::Theme).0,
                cadence_funding: self.cadence_funding,
                credit_vault: self.credit_vault,
                active_run,
                payer: owner,
                owner_authority: owner,
                session_token: None,
                actor: owner,
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
            data: zkube::instruction::EnterArena { run_id }.data(),
        };
        self.run(&instruction)
    }

    /// The run finishes on the rollup with this result and comes back; then
    /// anyone consumes it. A run with no accepted action expires instead.
    fn consume(
        &mut self,
        owner: Pubkey,
        score: u32,
        objective_total: u64,
        finished_after: i64,
    ) -> mollusk_svm::result::InstructionResult {
        let (active_run, _) = self.run_address(owner);
        let mut run: ActiveRun = decode(&self.accounts[&active_run]);
        run.lifecycle = RunLifecycle::Finished;
        run.finished_at = day_window(self.day_id).unwrap().0 + finished_after;
        run.pending_vrf_counter = 0;
        run.action_counter = u32::from(score > 0 || objective_total > 0);
        run.daily_score = score;
        run.objective_total = objective_total;
        let lamports = self.accounts[&active_run].lamports;
        self.accounts.insert(
            active_run,
            serialized_account(&run, 8 + ActiveRun::INIT_SPACE, zkube::ID, lamports),
        );
        let instruction = anchor_lang::solana_program::instruction::Instruction {
            program_id: zkube::ID,
            accounts: zkube::accounts::ConsumeArenaRun {
                player_state: player_fixture(owner).0,
                arena_daily: Some(self.daily),
                arena_player: Some(self.arena_player(owner)),
                active_run,
                rent_recipient: run.rent_payer,
                score_board: Some(board_address(self.daily, DailyBoardKind::Score).0),
                theme_board: Some(board_address(self.daily, DailyBoardKind::Theme).0),
            }
            .to_account_metas(None),
            data: zkube::instruction::ConsumeArenaRun {}.data(),
        };
        self.run(&instruction)
    }

    fn finalize(&mut self) -> mollusk_svm::result::InstructionResult {
        let caller = Pubkey::new_unique();
        self.accounts
            .insert(caller, system_account(ACCOUNT_LAMPORTS));
        self.runtime.sysvars.clock.unix_timestamp = day_window(self.day_id).unwrap().1;
        let instruction = anchor_lang::solana_program::instruction::Instruction {
            program_id: zkube::ID,
            accounts: zkube::accounts::FinalizeArenaDaily {
                arena_daily: self.daily,
                following_daily: self.following,
                score_board: board_address(self.daily, DailyBoardKind::Score).0,
                theme_board: board_address(self.daily, DailyBoardKind::Theme).0,
                cadence_funding: self.cadence_funding,
                caller,
            }
            .to_account_metas(None),
            data: zkube::instruction::FinalizeArenaDaily {}.data(),
        };
        self.run(&instruction)
    }
}

#[test]
fn no_caller_can_choose_board_rows() {
    // The audit's sketch: five qualifiers, four paying places. Whatever order
    // their runs are consumed in, and whoever consumes them, both boards
    // finalize as the four best. The interface has no instruction that takes
    // a row, so there is nothing else to call.
    let scores = [100u32, 90, 80, 70, 60];
    let orders: [[usize; 5]; 6] = [
        [0, 1, 2, 3, 4],
        [4, 3, 2, 1, 0],
        [4, 0, 3, 1, 2],
        [1, 4, 0, 2, 3],
        [2, 3, 4, 0, 1],
        [3, 1, 4, 2, 0],
    ];
    for order in orders {
        let mut world = World::new(20_700);
        let owners = scores.map(|_| Pubkey::new_unique());
        for owner in owners {
            world.player(owner);
            assert!(world.enter(owner).program_result.is_ok());
        }
        // Seed a pot that pays exactly four places on each board.
        let mut daily: ArenaDaily = decode(&world.accounts[&world.daily]);
        daily.ledger.seeded_lamports = 200_000_000;
        let lamports = world.accounts[&world.daily].lamports + 200_000_000;
        world.accounts.insert(
            world.daily,
            serialized_account(&daily, 8 + ArenaDaily::INIT_SPACE, zkube::ID, lamports),
        );
        assert_eq!(board_payout_plan(100_000_000, 5).unwrap().count, 4);
        for index in order {
            let consumed = world.consume(
                owners[index],
                scores[index],
                u64::from(scores[index]),
                10 + index as i64,
            );
            assert!(consumed.program_result.is_ok(), "{:?}", consumed.program_result);
        }
        let finalized = world.finalize();
        assert!(finalized.program_result.is_ok(), "{:?}", finalized.program_result);
        for kind in [DailyBoardKind::Score, DailyBoardKind::Theme] {
            let account = world.board(kind);
            let board: ArenaBoard = decode(account);
            assert_eq!((board.qualified_count, board.payout_count), (5, 4));
            assert_eq!(
                board_rows(account, 4)
                    .iter()
                    .map(|row| (row.player, row.score))
                    .collect::<Vec<_>>(),
                (0..4).map(|index| (owners[index], scores[index])).collect::<Vec<_>>()
            );
        }
    }
}

#[test]
fn board_rows_never_exceed_the_row_rent_their_entrants_paid() {
    let rent = anchor_lang::prelude::Rent::default();
    // An ordinary Daily and a Classic one, where no run earns a Theme metric.
    for (seed, classic) in [(7u64, false), (11, true), (23, false)] {
        let mut world = World::new(20_710);
        let owners = [(); 7].map(|_| Pubkey::new_unique());
        for owner in owners {
            world.player(owner);
        }
        let mut state = seed;
        let mut next = |modulus: u64| {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            (state >> 33) % modulus
        };
        let mut in_flight = std::collections::HashSet::new();
        let mut entrants = std::collections::HashSet::new();
        for step in 0..120 {
            let owner = owners[next(owners.len() as u64) as usize];
            if in_flight.remove(&owner) {
                // Scored, scored on one board only, or expired with no action.
                let (score, objective) = match next(4) {
                    0 => (0, 0),
                    1 => (1 + next(5) as u32, 0),
                    _ => (1 + next(5) as u32, if classic { 0 } else { next(4) }),
                };
                let consumed = world.consume(owner, score, objective, 10 + step);
                assert!(consumed.program_result.is_ok(), "{:?}", consumed.program_result);
            } else {
                assert!(world.enter(owner).program_result.is_ok());
                in_flight.insert(owner);
                entrants.insert(owner);
            }
            let daily: ArenaDaily = decode(&world.accounts[&world.daily]);
            assert_eq!(daily.unique_players as usize, entrants.len());
            for (kind, qualified) in [
                (DailyBoardKind::Score, daily.score_qualified_players),
                (DailyBoardKind::Theme, daily.theme_qualified_players),
            ] {
                let account = world.board(kind);
                let rows = ArenaBoard::open_rows(account.data.len()).unwrap();
                assert_eq!(rows as u32, qualified);
                assert!(rows <= entrants.len());
                // Each entrant paid for one row and its claim bit, once.
                assert_eq!(
                    account.lamports,
                    rent.minimum_balance(ArenaBoard::funded_space(daily.unique_players))
                );
                assert!(account.lamports >= rent.minimum_balance(account.data.len()));
                let sorted = board_rows(account, rows);
                assert!(sorted
                    .windows(2)
                    .all(|pair| compare_arena_entries(kind, &pair[0], &pair[1]).is_lt()));
            }
            if classic {
                assert_eq!(daily.theme_qualified_players, 0);
            }
        }
        // Settle what is still in flight, then finalize: all the rent the
        // boards no longer need is back, and nothing was created or lost.
        for owner in in_flight {
            assert!(world.consume(owner, 3, 0, 500).program_result.is_ok());
        }
        let finalized = world.finalize();
        assert!(finalized.program_result.is_ok(), "{:?}", finalized.program_result);
        let boards = [DailyBoardKind::Score, DailyBoardKind::Theme]
            .map(|kind| world.board(kind).clone());
        for account in &boards {
            assert_eq!(account.lamports, rent.minimum_balance(account.data.len()));
        }
        assert_eq!(
            world.accounts[&world.cadence_funding].lamports
                + boards.iter().map(|account| account.lamports).sum::<u64>(),
            CADENCE_BEFORE + 2 * rent.minimum_balance(ArenaBoard::HEADER_SIZE)
        );
    }
}

#[test]
fn consume_keeps_both_boards_sorted_at_capacity() {
    let capacity = ARENA_BOARD_CAPACITY as u32;
    let best = 1_000_000;
    let last = ranked_row(best, capacity - 1);
    let dropped = Pubkey::new_unique();
    // (rows before, the consuming wallet, its earlier best row, its new
    // metric, where its row ends up)
    let cases: [(u32, Pubkey, Option<ArenaBoardEntry>, u32, Option<usize>); 6] = [
        (capacity - 1, Pubkey::new_unique(), None, best + 1, Some(0)),
        (capacity, Pubkey::new_unique(), None, best + 1, Some(0)),
        (capacity, Pubkey::new_unique(), None, 1, None),
        (capacity, last.player, Some(last), best + 1, Some(0)),
        (
            capacity,
            dropped,
            Some(ArenaBoardEntry {
                player: dropped,
                score: 1,
                objective_total: 1,
                finalized_at: 2,
                replay_hash: [1; 32],
            }),
            best + 1,
            Some(0),
        ),
        (
            capacity,
            Pubkey::new_unique(),
            None,
            last.score + 1,
            Some(capacity as usize - 1),
        ),
    ];
    let mut most = 0;
    for (rows, owner, previous, metric, lands_at) in cases {
        let mut world = World::new(20_651);
        let before = (0..rows)
            .map(|rank| ranked_row(best, rank))
            .collect::<Vec<_>>();
        for kind in [DailyBoardKind::Score, DailyBoardKind::Theme] {
            let (address, account) = open_board(world.daily, world.day_id, kind, &before, capacity);
            world.accounts.insert(address, account);
        }
        let mut daily: ArenaDaily = decode(&world.accounts[&world.daily]);
        daily.unique_players = capacity;
        daily.score_qualified_players = rows;
        daily.theme_qualified_players = rows;
        daily.entries_paid = 1;
        world.accounts.insert(
            world.daily,
            program_account(&daily, 8 + ArenaDaily::INIT_SPACE),
        );
        world.player(owner);
        let (player, mut profile) = player_fixture(owner);
        profile.record_kredit_purchase(1).unwrap();
        let run_id = profile.next_run_id;
        profile
            .reserve_arcade_run(run_id, world.daily, day_window(world.day_id).unwrap().1)
            .unwrap();
        world.accounts.insert(
            player,
            program_account(&profile, 8 + PlayerState::INIT_SPACE),
        );
        let participant = world.arena_player(owner);
        let mut entry = ArenaPlayer::initialize(world.daily, owner, owner, 0);
        entry.bump = Pubkey::find_program_address(
            &[ARENA_PLAYER_SEED, world.daily.as_ref(), owner.as_ref()],
            &zkube::ID,
        )
        .1;
        entry.paid_entries = 2;
        entry.resolved_entries = 1;
        entry.active_paid_run_id = run_id;
        if let Some(previous) = previous {
            entry.score_best = BestRun::of(&previous);
            entry.theme_best = BestRun::of(&previous);
        }
        world.accounts.insert(
            participant,
            program_account(&entry, 8 + ArenaPlayer::INIT_SPACE),
        );
        let (active_run, bump) = Pubkey::find_program_address(
            &[
                ACTIVE_RUN_SEED,
                b"active",
                owner.as_ref(),
                &run_id.to_le_bytes(),
            ],
            &zkube::ID,
        );
        world.accounts.insert(
            active_run,
            program_account(
                &ActiveRun {
                    version: ACCOUNT_VERSION,
                    owner,
                    rent_payer: owner,
                    run_id,
                    daily_challenge: world.daily,
                    deadline_at: day_window(world.day_id).unwrap().1,
                    replay_hash: [5; 32],
                    bump,
                    ..ActiveRun::default()
                },
                8 + ActiveRun::INIT_SPACE,
            ),
        );
        let consumed = world.consume(owner, metric, u64::from(metric), 5_000);
        assert!(consumed.program_result.is_ok(), "{:?}", consumed.program_result);
        most = most.max(consumed.compute_units_consumed);
        println!(
            "rows={rows}, lands_at={lands_at:?}, CU={}",
            consumed.compute_units_consumed
        );
        for kind in [DailyBoardKind::Score, DailyBoardKind::Theme] {
            let account = world.board(kind);
            let count = ArenaBoard::open_rows(account.data.len()).unwrap();
            assert_eq!(count, ARENA_BOARD_CAPACITY);
            let after = board_rows(account, count);
            assert!(after
                .windows(2)
                .all(|pair| compare_arena_entries(kind, &pair[0], &pair[1]).is_lt()));
            assert_eq!(
                after.iter().position(|row| row.player == owner),
                lands_at
            );
            if lands_at.is_none() {
                assert_eq!(after, before);
            }
        }
    }
    assert!(most < 60_000, "a consume at capacity used {most} CU");
}
