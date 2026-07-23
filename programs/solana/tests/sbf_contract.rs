#![cfg(feature = "sbf-tests")]

use std::{fs, io::Cursor, path::PathBuf};

use anchor_lang::prelude::{AccountDeserialize, AccountSerialize, Pubkey};
use anchor_lang::{InstructionData, Space, ToAccountMetas};
use mollusk_svm::Mollusk;
use session_keys::SessionTokenV2;
use solana_account::Account;

use solana as zkube;
use zkube::game::{row_from_vrf, BlockWeights, Grid};
use zkube::state::arcade::*;
use zkube::state::arena_rules::*;
use zkube::state::player_label::*;
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

fn noop_sbf_elf() -> Vec<u8> {
    // Mollusk's exact, directly-pinned loader dependency ships this minimal
    // return-Ok SBF fixture. Registering it under the VRF program id lets the
    // real zKube ELF exercise its nonterminal CPI boundary without pretending
    // to implement the VRF service itself.
    let cargo_home = std::env::var_os("CARGO_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".cargo")))
        .expect("Cargo home for the pinned SBF fixture");
    let registry_sources = cargo_home.join("registry/src");
    for registry in fs::read_dir(&registry_sources).expect("read Cargo registry sources") {
        let candidate = registry
            .expect("read Cargo registry source entry")
            .path()
            .join("solana-bpf-loader-program-3.0.14/test_elfs/out/noop_aligned.so");
        if candidate.is_file() {
            return fs::read(candidate).expect("read pinned no-op SBF fixture");
        }
    }
    panic!("pinned solana-bpf-loader-program no-op SBF fixture is unavailable");
}

fn process_play_move(
    active_state: ActiveRun,
    row: u8,
    start: u8,
    destination: u8,
    unix_timestamp: i64,
    stub_vrf: bool,
) -> (Pubkey, mollusk_svm::result::InstructionResult) {
    let owner = active_state.owner;
    let (active_run, expected_bump) = Pubkey::find_program_address(
        &[
            ACTIVE_RUN_SEED,
            b"active",
            owner.as_ref(),
            &active_state.run_id.to_le_bytes(),
        ],
        &zkube::ID,
    );
    assert_eq!(active_state.bump, expected_bump);
    let oracle_queue: Pubkey = ephemeral_rollups_sdk::vrf::consts::DEFAULT_EPHEMERAL_QUEUE
        .to_bytes()
        .into();
    let delegation_record: Pubkey =
        ephemeral_rollups_sdk::pda::delegation_record_pda_from_delegated_account(
            &active_run.to_bytes().into(),
        )
        .to_bytes()
        .into();
    let delegation_owner: Pubkey = ephemeral_rollups_sdk::id().to_bytes().into();
    let validator = Pubkey::new_unique();
    let mut delegation_data =
        vec![0; ephemeral_rollups_sdk::dlp_api::state::DelegationRecord::size_with_discriminator()];
    delegation_data[..8].copy_from_slice(&100u64.to_le_bytes());
    delegation_data[8..40].copy_from_slice(validator.as_ref());
    let program_identity = Pubkey::find_program_address(&[b"identity"], &zkube::ID).0;
    let vrf_program: Pubkey = ephemeral_rollups_sdk::vrf::consts::VRF_PROGRAM_ID
        .to_bytes()
        .into();
    let slot_hashes = Pubkey::from_str_const("SysvarS1otHashes111111111111111111111111111");
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::PlayMove {
            active_run,
            owner_authority: owner,
            session_token: None,
            actor: owner,
            oracle_queue,
            delegation_record_active: delegation_record,
            program_identity,
            vrf_program,
            slot_hashes,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: zkube::instruction::PlayMove {
            expected_action: active_state.action_counter,
            expected_move: active_state.moves,
            row,
            start,
            destination,
            client_seed: [0; 32],
        }
        .data(),
    };
    let mut runtime = mollusk();
    if stub_vrf {
        runtime.program_cache.add_program(
            &vrf_program,
            &mollusk_svm::program::loader_keys::LOADER_V3,
            &noop_sbf_elf(),
        );
    }
    runtime.sysvars.clock.unix_timestamp = unix_timestamp;
    let (_, slot_hashes_account) = runtime.sysvars.keyed_account_for_slot_hashes_sysvar();
    let accounts = vec![
        (
            active_run,
            program_account(&active_state, 8 + ActiveRun::INIT_SPACE),
        ),
        (owner, system_account(ACCOUNT_LAMPORTS)),
        (oracle_queue, system_account(0)),
        (
            delegation_record,
            Account {
                lamports: 1,
                data: delegation_data,
                owner: delegation_owner,
                executable: false,
                rent_epoch: 0,
            },
        ),
        (program_identity, system_account(0)),
        (
            vrf_program,
            executable_program_account(Pubkey::from_str_const(
                "BPFLoaderUpgradeab1e11111111111111111111111",
            )),
        ),
        (slot_hashes, slot_hashes_account),
        (anchor_lang::system_program::ID, system_program_account()),
    ];
    (
        active_run,
        runtime.process_instruction(&instruction, &accounts),
    )
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
            pending_authority: Pubkey::default(),
            team_destination,
            replay_domain: [9; 32],
            content_version: 1,
            daily_rules_version: 1,
            player_funding_target_lamports: PLAYER_FUNDING_TARGET_LAMPORTS,
            campaign_map_count: 1,
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
fn sbf_funded_player_label_creation_is_session_scoped_and_duplicate_friendly() {
    let authority = Pubkey::new_unique();
    let owner = Pubkey::new_unique();
    let actor = Pubkey::new_unique();
    let (protocol, protocol_state) = protocol_fixture(authority, Pubkey::new_unique(), false);
    let (player, player_state) = player_fixture(owner);
    let (player_label, _) =
        Pubkey::find_program_address(&[PLAYER_LABEL_SEED, owner.as_ref()], &zkube::ID);
    let (player_funding, _) =
        Pubkey::find_program_address(&[PLAYER_FUNDING_SEED, owner.as_ref()], &zkube::ID);
    let session_token = session_token_address(owner, actor);
    let session_state = SessionTokenV2 {
        authority: owner,
        target_program: zkube::ID,
        session_signer: actor,
        fee_payer: owner,
        valid_until: 100,
    };
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::FundedCreatePlayerLabel {
            protocol,
            player_state: player,
            player_label,
            player_funding,
            owner_authority: owner,
            session_token,
            actor,
            system_program: anchor_lang::system_program::ID,
            zkube_program: zkube::ID,
        }
        .to_account_metas(None),
        data: zkube::instruction::FundedCreatePlayerLabel {
            args: zkube::PlayerLabelArgs {
                display: "Wave_Rider7".to_string(),
            },
        }
        .data(),
    };
    let funding_before = PLAYER_FUNDING_TARGET_LAMPORTS;
    let accounts = vec![
        (
            protocol,
            program_account(&protocol_state, 8 + ProtocolConfig::INIT_SPACE),
        ),
        (
            player,
            program_account(&player_state, 8 + PlayerState::INIT_SPACE),
        ),
        (player_label, system_account(0)),
        (player_funding, system_account(funding_before)),
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
        (actor, system_account(ACCOUNT_LAMPORTS)),
        (anchor_lang::system_program::ID, system_program_account()),
        (
            zkube::ID,
            executable_program_account(Pubkey::from_str_const(
                "BPFLoaderUpgradeab1e11111111111111111111111",
            )),
        ),
    ];
    let result = mollusk().process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    eprintln!(
        "SBF_COMPUTE funded_create_player_label={}",
        result.compute_units_consumed
    );
    let label: PlayerLabel = decode(resulting_account(&result, &player_label));
    assert_eq!(label.owner, owner);
    assert_eq!(label.display_name(), Some(b"Wave_Rider7".as_slice()));
    assert_eq!(
        resulting_account(&result, &player_funding).lamports
            + resulting_account(&result, &player_label).lamports,
        funding_before
    );

    // The label value is not a global key: a second wallet may use the same display text.
    let second_owner = Pubkey::new_unique();
    let (second_player, second_player_state) = player_fixture(second_owner);
    let (second_label, _) =
        Pubkey::find_program_address(&[PLAYER_LABEL_SEED, second_owner.as_ref()], &zkube::ID);
    let duplicate = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::CreatePlayerLabel {
            protocol,
            player_state: second_player,
            player_label: second_label,
            payer: second_owner,
            owner_authority: second_owner,
            session_token: None,
            actor: second_owner,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: zkube::instruction::CreatePlayerLabel {
            args: zkube::PlayerLabelArgs {
                display: "Wave_Rider7".to_string(),
            },
        }
        .data(),
    };
    let duplicate_accounts = vec![
        (
            protocol,
            program_account(&protocol_state, 8 + ProtocolConfig::INIT_SPACE),
        ),
        (
            second_player,
            program_account(&second_player_state, 8 + PlayerState::INIT_SPACE),
        ),
        (second_label, system_account(0)),
        (second_owner, system_account(100_000_000)),
        (anchor_lang::system_program::ID, system_program_account()),
    ];
    assert!(mollusk()
        .process_instruction(&duplicate, &duplicate_accounts)
        .program_result
        .is_ok());
}

#[test]
fn sbf_player_label_update_preserves_competition_profile_and_rejects_wrong_actor() {
    let authority = Pubkey::new_unique();
    let owner = Pubkey::new_unique();
    let actor = Pubkey::new_unique();
    let wrong_actor = Pubkey::new_unique();
    let (protocol, protocol_state) = protocol_fixture(authority, Pubkey::new_unique(), false);
    let (player, mut player_state) = player_fixture(owner);
    player_state.lifetime_paid_entries = 150;
    let (player_label, bump) =
        Pubkey::find_program_address(&[PLAYER_LABEL_SEED, owner.as_ref()], &zkube::ID);
    let mut display_name = [0u8; PLAYER_LABEL_MAX_LEN];
    display_name[..11].copy_from_slice(b"Wave_Rider7");
    let label_state = PlayerLabel {
        version: PLAYER_LABEL_ACCOUNT_VERSION,
        owner,
        display_name,
        name_len: 11,
        bump,
    };
    let session_token = session_token_address(owner, actor);
    let session_state = SessionTokenV2 {
        authority: owner,
        target_program: zkube::ID,
        session_signer: actor,
        fee_payer: owner,
        valid_until: 100,
    };
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::SetPlayerLabel {
            protocol,
            player_state: player,
            player_label,
            owner_authority: owner,
            session_token: Some(session_token),
            actor,
        }
        .to_account_metas(None),
        data: zkube::instruction::SetPlayerLabel {
            args: zkube::PlayerLabelArgs {
                display: "Ocean_Tiki".to_string(),
            },
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
            program_account(&player_state, 8 + PlayerState::INIT_SPACE),
        ),
        (
            player_label,
            program_account(&label_state, 8 + PlayerLabel::INIT_SPACE),
        ),
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
        (actor, system_account(ACCOUNT_LAMPORTS)),
    ];
    let result = mollusk().process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    let updated: PlayerLabel = decode(resulting_account(&result, &player_label));
    assert_eq!(updated.display_name(), Some(b"Ocean_Tiki".as_slice()));
    let player_after: PlayerState = decode(resulting_account(&result, &player));
    assert_eq!(player_after.lifetime_paid_entries, 150);

    let wrong = anchor_lang::solana_program::instruction::Instruction {
        accounts: zkube::accounts::SetPlayerLabel {
            actor: wrong_actor,
            ..zkube::accounts::SetPlayerLabel {
                protocol,
                player_state: player,
                player_label,
                owner_authority: owner,
                session_token: Some(session_token),
                actor,
            }
        }
        .to_account_metas(None),
        ..instruction
    };
    let mut wrong_accounts = accounts;
    wrong_accounts.push((wrong_actor, system_account(ACCOUNT_LAMPORTS)));
    assert!(mollusk()
        .process_instruction(&wrong, &wrong_accounts)
        .program_result
        .is_err());
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

fn fulfill_row_instruction(
    vrf_program_identity: Pubkey,
    active_run: Pubkey,
    magic_fee_vault: Pubkey,
    randomness: [u8; 32],
    expected_request_counter: u32,
) -> anchor_lang::solana_program::instruction::Instruction {
    anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::FulfillRowVrf {
            vrf_program_identity,
            active_run,
            magic_fee_vault,
        }
        .to_account_metas(None),
        data: zkube::instruction::FulfillRowVrf {
            randomness,
            expected_request_counter,
        }
        .data(),
    }
}

#[test]
fn sbf_vrf_callback_builds_complete_opening_and_uses_live_daily_weights() {
    let vrf_program_identity: Pubkey =
        ephemeral_rollups_sdk::vrf::consts::scoped_vrf_identity(&zkube::ID)
            .to_bytes()
            .into();
    let magic_fee_vault = Pubkey::new_unique();
    let opening_run = Pubkey::new_unique();
    let opening_randomness = [37; 32];
    let opening_state = ActiveRun {
        version: ACCOUNT_VERSION,
        lifecycle: RunLifecycle::AwaitingVrf,
        rules_hash: [19; 32],
        rules: LevelRuleSnapshot {
            block_weights: [15, 30, 30, 15, 10],
            ..LevelRuleSnapshot::default()
        },
        starting_height_target: 8,
        vrf_request_counter: 1,
        pending_vrf_counter: 1,
        ..ActiveRun::default()
    };
    let callback_accounts = vec![
        (vrf_program_identity, system_account(0)),
        (
            opening_run,
            program_account(&opening_state, 8 + ActiveRun::INIT_SPACE),
        ),
        (magic_fee_vault, system_account(ACCOUNT_LAMPORTS)),
    ];
    let opening_instruction = fulfill_row_instruction(
        vrf_program_identity,
        opening_run,
        magic_fee_vault,
        opening_randomness,
        1,
    );
    let opening_result = mollusk().process_instruction(&opening_instruction, &callback_accounts);
    assert!(
        opening_result.program_result.is_ok(),
        "{:?}",
        opening_result.program_result
    );
    eprintln!(
        "SBF_COMPUTE fulfill_opening={}",
        opening_result.compute_units_consumed
    );
    assert!(opening_result.compute_units_consumed < 200_000);
    let opened: ActiveRun = decode(resulting_account(&opening_result, &opening_run));
    let opening_grid = Grid::try_from_cells(opened.grid).unwrap();
    let mut settled = opening_grid;
    settled.apply_gravity();
    assert_eq!(settled, opening_grid);
    assert_eq!(opening_grid.occupied_height(), 8);
    assert!(opened.has_next_row);
    assert_eq!(opened.lifecycle, RunLifecycle::Playing);
    assert_eq!(opened.starting_height_target, 0);
    assert_eq!(opened.pending_vrf_counter, 0);

    let pathological_run = Pubkey::new_unique();
    let pathological_state = ActiveRun {
        version: ACCOUNT_VERSION,
        lifecycle: RunLifecycle::AwaitingVrf,
        rules: LevelRuleSnapshot {
            block_weights: [99, 1, 0, 0, 0],
            ..LevelRuleSnapshot::default()
        },
        starting_height_target: 8,
        vrf_request_counter: 1,
        pending_vrf_counter: 1,
        ..ActiveRun::default()
    };
    let pathological_accounts = vec![
        (vrf_program_identity, system_account(0)),
        (
            pathological_run,
            program_account(&pathological_state, 8 + ActiveRun::INIT_SPACE),
        ),
        (magic_fee_vault, system_account(ACCOUNT_LAMPORTS)),
    ];
    let pathological_instruction = fulfill_row_instruction(
        vrf_program_identity,
        pathological_run,
        magic_fee_vault,
        [0; 32],
        1,
    );
    let pathological_result =
        mollusk().process_instruction(&pathological_instruction, &pathological_accounts);
    assert!(
        pathological_result.program_result.is_ok(),
        "{:?}",
        pathological_result.program_result
    );
    eprintln!(
        "SBF_COMPUTE fulfill_pathological_opening={}",
        pathological_result.compute_units_consumed
    );
    assert!(pathological_result.compute_units_consumed < 200_000);
    let pathological: ActiveRun =
        decode(resulting_account(&pathological_result, &pathological_run));
    let pathological_grid = Grid::try_from_cells(pathological.grid).unwrap();
    let mut pathological_settled = pathological_grid;
    pathological_settled.apply_gravity();
    assert_eq!(pathological_settled, pathological_grid);
    assert_eq!(pathological_grid.occupied_height(), 8);
    assert!(pathological.has_next_row);

    let daily_run = Pubkey::new_unique();
    let daily_randomness = [91; 32];
    let pressure = DailyPressureProfile::canonical();
    let mut daily_grid = [0; 80];
    daily_grid[0] = 1;
    let daily_state = ActiveRun {
        version: ACCOUNT_VERSION,
        mode: RunMode::Daily,
        lifecycle: RunLifecycle::AwaitingVrf,
        grid: daily_grid,
        daily_pressure: pressure,
        current_difficulty: 7,
        vrf_request_counter: 2,
        pending_vrf_counter: 2,
        deadline_at: i64::MAX,
        ..ActiveRun::default()
    };
    let daily_accounts = vec![
        (vrf_program_identity, system_account(0)),
        (
            daily_run,
            program_account(&daily_state, 8 + ActiveRun::INIT_SPACE),
        ),
        (magic_fee_vault, system_account(ACCOUNT_LAMPORTS)),
    ];
    let daily_instruction = fulfill_row_instruction(
        vrf_program_identity,
        daily_run,
        magic_fee_vault,
        daily_randomness,
        2,
    );
    let daily_result = mollusk().process_instruction(&daily_instruction, &daily_accounts);
    assert!(
        daily_result.program_result.is_ok(),
        "{:?}",
        daily_result.program_result
    );
    eprintln!(
        "SBF_COMPUTE fulfill_next_row={}",
        daily_result.compute_units_consumed
    );
    assert!(daily_result.compute_units_consumed < 50_000);
    let daily: ActiveRun = decode(resulting_account(&daily_result, &daily_run));
    assert_eq!(daily.lifecycle, RunLifecycle::Playing);
    assert_eq!(daily.pending_vrf_counter, 0);
    assert_eq!(
        daily.next_row,
        row_from_vrf(
            daily_randomness,
            2,
            BlockWeights {
                values: pressure.block_weights[7],
            },
        )
        .unwrap()
    );

    let stale_instruction = fulfill_row_instruction(
        vrf_program_identity,
        daily_run,
        magic_fee_vault,
        daily_randomness,
        1,
    );
    assert!(mollusk()
        .process_instruction(&stale_instruction, &daily_accounts)
        .program_result
        .is_err());
}

#[test]
fn sbf_funded_self_cpi_creates_only_the_canonical_active_run() {
    let authority = Pubkey::new_unique();
    let owner = Pubkey::new_unique();
    let actor = Pubkey::new_unique();
    let team = Pubkey::new_unique();
    let (protocol, protocol_state) = protocol_fixture(authority, team, false);
    let (player, player_state) = player_fixture(owner);
    let content_version = 1u32;
    let map_id = 1u8;
    let (map_catalog, map_bump) = Pubkey::find_program_address(
        &[MAP_CATALOG_SEED, &content_version.to_le_bytes(), &[map_id]],
        &zkube::ID,
    );
    let levels = std::array::from_fn(|index| CampaignLevelSnapshot {
        level: index as u8 + 1,
        points_required: 10,
        max_moves: 20,
        block_weights: [20; 5],
        ..CampaignLevelSnapshot::default()
    });
    let map_state = MapCatalog {
        version: ACCOUNT_VERSION,
        content_version,
        map_id,
        theme_id: 1,
        enabled: true,
        map_rules: CampaignMapRuleSnapshot {
            score_multiplier_x100: 100,
            combo_multiplier_x100: 100,
            starting_rows: 3,
            ..CampaignMapRuleSnapshot::default()
        },
        levels,
        bump: map_bump,
    };
    let run_id = 1u64;
    let (active_run, _) = Pubkey::find_program_address(
        &[
            ACTIVE_RUN_SEED,
            b"active",
            owner.as_ref(),
            &run_id.to_le_bytes(),
        ],
        &zkube::ID,
    );
    let (player_funding, _) =
        Pubkey::find_program_address(&[PLAYER_FUNDING_SEED, owner.as_ref()], &zkube::ID);
    let session_token = session_token_address(owner, actor);
    let session_state = SessionTokenV2 {
        authority: owner,
        target_program: zkube::ID,
        session_signer: actor,
        fee_payer: owner,
        valid_until: 100,
    };
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::FundedPrepareCampaignRun {
            protocol,
            player_state: player,
            map_catalog,
            active_run,
            player_funding,
            owner_authority: owner,
            session_token,
            actor,
            system_program: anchor_lang::system_program::ID,
            zkube_program: zkube::ID,
        }
        .to_account_metas(None),
        data: zkube::instruction::FundedPrepareCampaignRun {
            run_id,
            map_id,
            level: 1,
        }
        .data(),
    };
    let funding_before = PLAYER_FUNDING_TARGET_LAMPORTS;
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
            map_catalog,
            program_account(&map_state, 8 + MapCatalog::INIT_SPACE),
        ),
        (active_run, system_account(0)),
        (player_funding, system_account(funding_before)),
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
        (actor, system_account(ACCOUNT_LAMPORTS)),
        (anchor_lang::system_program::ID, system_program_account()),
        (
            zkube::ID,
            executable_program_account(Pubkey::from_str_const(
                "BPFLoaderUpgradeab1e11111111111111111111111",
            )),
        ),
    ];
    let result = mollusk().process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    eprintln!(
        "SBF_COMPUTE funded_prepare={}",
        result.compute_units_consumed
    );
    let created = resulting_account(&result, &active_run);
    assert_eq!(created.owner, zkube::ID);
    assert_eq!(created.data.len(), 8 + ActiveRun::INIT_SPACE);
    let active: ActiveRun = decode(created);
    assert_eq!(active.owner, owner);
    assert_eq!(active.run_id, run_id);
    let player_after: PlayerState = decode(resulting_account(&result, &player));
    assert_eq!(player_after.active_run_id, run_id);
    assert_eq!(player_after.next_run_id, run_id + 1);
    assert_eq!(
        resulting_account(&result, &player_funding).lamports + created.lamports,
        funding_before
    );

    let unrelated_payer = Pubkey::new_unique();
    let direct = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::PrepareCampaignRun {
            protocol,
            player_state: player,
            map_catalog,
            active_run,
            payer: unrelated_payer,
            owner_authority: owner,
            session_token: Some(session_token),
            actor,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: zkube::instruction::PrepareCampaignRun {
            run_id,
            map_id,
            level: 1,
        }
        .data(),
    };
    let mut wrong_payer_accounts = accounts;
    wrong_payer_accounts.push((unrelated_payer, system_account(ACCOUNT_LAMPORTS)));
    assert!(mollusk()
        .process_instruction(&direct, &wrong_payer_accounts)
        .program_result
        .is_err());
}

#[test]
fn sbf_terminal_x4_move_scores_ten_and_writes_timestamp_without_sealing() {
    let owner = Pubkey::new_unique();
    let run_id = 9u64;
    let (_, bump) = Pubkey::find_program_address(
        &[
            ACTIVE_RUN_SEED,
            b"active",
            owner.as_ref(),
            &run_id.to_le_bytes(),
        ],
        &zkube::ID,
    );
    let mut grid = [0u8; 80];
    for row in 0..4 {
        grid[row * 8..(row + 1) * 8].copy_from_slice(&[1; 8]);
    }
    grid[32..40].copy_from_slice(&[1, 0, 0, 0, 0, 0, 0, 0]);
    let active_state = ActiveRun {
        version: ACCOUNT_VERSION,
        owner,
        run_id,
        mode: RunMode::Campaign,
        lifecycle: RunLifecycle::Playing,
        map_id: 1,
        level: 1,
        rules: LevelRuleSnapshot {
            max_moves: 20,
            score_multiplier_x100: 100,
            combo_multiplier_x100: 100,
            ..LevelRuleSnapshot::default()
        },
        grid,
        next_row: [0, 0, 0, 0, 0, 0, 0, 1],
        has_next_row: true,
        perfect_trigger_available: true,
        bump,
        ..ActiveRun::default()
    };
    let (active_run, result) = process_play_move(active_state, 4, 0, 1, 123, false);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    eprintln!(
        "SBF_COMPUTE terminal_play_move={}",
        result.compute_units_consumed
    );
    let active: ActiveRun = decode(resulting_account(&result, &active_run));
    assert_eq!(active.lifecycle, RunLifecycle::LevelComplete);
    assert_eq!(active.finished_at, 123);
    assert_eq!(active.action_counter, 1);
    assert_eq!(active.moves, 1);
    assert_eq!(active.score, 10);
    assert_eq!(active.level_lines_cleared, 4);
    assert_eq!(active.total_lines_cleared, 4);
    assert_eq!(active.combo_counter, 4);
    assert_eq!(active.max_combo, 4);
}

#[test]
fn sbf_tenth_row_is_playable_and_requests_the_next_vrf_row() {
    let owner = Pubkey::new_unique();
    let run_id = 10u64;
    let (_, bump) = Pubkey::find_program_address(
        &[
            ACTIVE_RUN_SEED,
            b"active",
            owner.as_ref(),
            &run_id.to_le_bytes(),
        ],
        &zkube::ID,
    );
    let mut grid = [0u8; 80];
    for row in 0..9 {
        grid[row * 8] = 1;
    }
    let active_state = ActiveRun {
        version: ACCOUNT_VERSION,
        owner,
        run_id,
        mode: RunMode::Campaign,
        lifecycle: RunLifecycle::Playing,
        map_id: 1,
        level: 1,
        rules: LevelRuleSnapshot {
            points_required: u32::MAX,
            max_moves: 20,
            score_multiplier_x100: 100,
            combo_multiplier_x100: 100,
            ..LevelRuleSnapshot::default()
        },
        grid,
        next_row: [1, 0, 0, 0, 0, 0, 0, 0],
        has_next_row: true,
        perfect_trigger_available: true,
        bump,
        ..ActiveRun::default()
    };

    let (active_run, result) = process_play_move(active_state, 0, 0, 0, 234, true);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    eprintln!(
        "SBF_COMPUTE tenth_row_play_move={}",
        result.compute_units_consumed
    );
    let active: ActiveRun = decode(resulting_account(&result, &active_run));
    assert_eq!(active.lifecycle, RunLifecycle::AwaitingVrf);
    assert_eq!(active.finished_at, 0);
    assert_eq!(active.action_counter, 1);
    assert_eq!(active.moves, 1);
    assert_eq!(active.grid[72], 1, "row ten must remain occupied");
    assert!(!active.has_next_row);
    assert_eq!(active.vrf_request_counter, 1);
    assert_eq!(active.pending_vrf_counter, 1);
}

#[test]
fn sbf_blocked_eleventh_row_finishes_timestamps_and_skips_vrf() {
    let owner = Pubkey::new_unique();
    let run_id = 11u64;
    let (_, bump) = Pubkey::find_program_address(
        &[
            ACTIVE_RUN_SEED,
            b"active",
            owner.as_ref(),
            &run_id.to_le_bytes(),
        ],
        &zkube::ID,
    );
    let mut grid = [0u8; 80];
    for row in 0..10 {
        grid[row * 8] = 1;
    }
    let active_state = ActiveRun {
        version: ACCOUNT_VERSION,
        owner,
        run_id,
        mode: RunMode::Campaign,
        lifecycle: RunLifecycle::Playing,
        map_id: 1,
        level: 1,
        rules: LevelRuleSnapshot {
            points_required: u32::MAX,
            max_moves: 20,
            score_multiplier_x100: 100,
            combo_multiplier_x100: 100,
            ..LevelRuleSnapshot::default()
        },
        grid,
        next_row: [1, 0, 0, 0, 0, 0, 0, 0],
        has_next_row: true,
        vrf_request_counter: 7,
        perfect_trigger_available: true,
        bump,
        ..ActiveRun::default()
    };

    let (active_run, result) = process_play_move(active_state, 0, 0, 0, 345, false);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    eprintln!(
        "SBF_COMPUTE blocked_eleventh_row_play_move={}",
        result.compute_units_consumed
    );
    let active: ActiveRun = decode(resulting_account(&result, &active_run));
    assert_eq!(active.lifecycle, RunLifecycle::Finished);
    assert_eq!(active.finished_at, 345);
    assert_eq!(active.action_counter, 1);
    assert_eq!(active.moves, 1);
    assert_eq!(active.grid, grid, "blocked insertion must not drop row ten");
    assert_eq!(active.blocks_destroyed_by_size, [0; 4]);
    assert!(!active.has_next_row);
    assert_eq!(active.vrf_request_counter, 7);
    assert_eq!(active.pending_vrf_counter, 0);
}

#[test]
fn sbf_campaign_consume_is_permissionless_atomic_and_recycles_run_rent() {
    let owner = Pubkey::new_unique();
    let run_id = 1u64;
    let (player, mut player_state) = player_fixture(owner);
    player_state.active_run_id = run_id;
    player_state.next_run_id = run_id + 1;
    let (active_run, active_bump) = Pubkey::find_program_address(
        &[
            ACTIVE_RUN_SEED,
            b"active",
            owner.as_ref(),
            &run_id.to_le_bytes(),
        ],
        &zkube::ID,
    );
    let active_state = ActiveRun {
        version: ACCOUNT_VERSION,
        owner,
        run_id,
        mode: RunMode::Campaign,
        lifecycle: RunLifecycle::Finished,
        map_id: 1,
        level: 1,
        total_lines_cleared: 4,
        finished_at: 1,
        bump: active_bump,
        ..ActiveRun::default()
    };
    let (rent_recipient, _) =
        Pubkey::find_program_address(&[PLAYER_FUNDING_SEED, owner.as_ref()], &zkube::ID);
    let active_lamports = 4_000_000;
    let funding_lamports = PLAYER_FUNDING_TARGET_LAMPORTS;
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::ConsumeCampaignRun {
            active_run,
            player_state: player,
            owner,
            rent_recipient,
        }
        .to_account_metas(None),
        data: zkube::instruction::ConsumeCampaignRun {}.data(),
    };
    let accounts = vec![
        (
            active_run,
            serialized_account(
                &active_state,
                8 + ActiveRun::INIT_SPACE,
                zkube::ID,
                active_lamports,
            ),
        ),
        (
            player,
            program_account(&player_state, 8 + PlayerState::INIT_SPACE),
        ),
        (owner, system_account(0)),
        (rent_recipient, system_account(funding_lamports)),
    ];
    let result = mollusk().process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    let closed = resulting_account(&result, &active_run);
    assert_eq!(closed.lamports, 0);
    assert!(closed.data.is_empty());
    assert_eq!(
        resulting_account(&result, &rent_recipient).lamports,
        funding_lamports + active_lamports
    );
    let updated: PlayerState = decode(resulting_account(&result, &player));
    eprintln!(
        "SBF_COMPUTE consume_campaign={}",
        result.compute_units_consumed
    );
    assert_eq!(updated.active_run_id, 0);
    assert_eq!(updated.total_campaign_stars(), 0);
}

#[test]
fn sbf_content_activation_switches_versions_only_for_exact_staged_maps() {
    let authority = Pubkey::new_unique();
    let team = Pubkey::new_unique();
    let (protocol, protocol_state) = protocol_fixture(authority, team, true);
    let next_content = 2u32;
    let next_rules = 2u32;
    let (daily_rules, rules_bump) = Pubkey::find_program_address(
        &[DAILY_RULES_CATALOG_SEED, &next_rules.to_le_bytes()],
        &zkube::ID,
    );
    let rules_state = DailyRulesCatalog {
        version: RULES_ACCOUNT_VERSION,
        rules_version: next_rules,
        protocol,
        content_version: next_content,
        catalog_hash: [7; 32],
        rotation_id: 1,
        starts_day: 0,
        rotation_seed: [9; 32],
        scoring_rule_count: 15,
        scoring_rules: canonical_daily_scoring_rules(),
        pressure: DailyPressureProfile::canonical(),
        bump: rules_bump,
    };
    let maps: Vec<(Pubkey, Account)> = (1..=MAX_MAPS as u8)
        .map(|map_id| {
            let (address, bump) = Pubkey::find_program_address(
                &[MAP_CATALOG_SEED, &next_content.to_le_bytes(), &[map_id]],
                &zkube::ID,
            );
            let state = MapCatalog {
                version: ACCOUNT_VERSION,
                content_version: next_content,
                map_id,
                theme_id: map_id,
                enabled: true,
                map_rules: CampaignMapRuleSnapshot::default(),
                levels: [CampaignLevelSnapshot::default(); LEVELS_PER_MAP],
                bump,
            };
            (address, program_account(&state, 8 + MapCatalog::INIT_SPACE))
        })
        .collect();
    let mut metas = zkube::accounts::ActivateContentRelease {
        protocol,
        daily_rules_catalog: daily_rules,
        authority,
    }
    .to_account_metas(None);
    metas.extend(maps.iter().map(|(address, _)| {
        anchor_lang::solana_program::instruction::AccountMeta::new_readonly(*address, false)
    }));
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: metas,
        data: zkube::instruction::ActivateContentRelease {
            content_version: next_content,
            daily_rules_version: next_rules,
            campaign_map_count: MAX_MAPS as u8,
        }
        .data(),
    };
    let mut accounts = vec![
        (
            protocol,
            program_account(&protocol_state, 8 + ProtocolConfig::INIT_SPACE),
        ),
        (
            daily_rules,
            program_account(&rules_state, 8 + DailyRulesCatalog::INIT_SPACE),
        ),
        (authority, system_account(ACCOUNT_LAMPORTS)),
    ];
    accounts.extend(maps);
    let result = mollusk().process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    let protocol_after: ProtocolConfig = decode(resulting_account(&result, &protocol));
    eprintln!(
        "SBF_COMPUTE activate_content_release={}",
        result.compute_units_consumed
    );
    assert_eq!(protocol_after.content_version, next_content);
    assert_eq!(protocol_after.campaign_map_count, MAX_MAPS as u8);
    assert_eq!(protocol_after.daily_rules_version, next_rules);

    let mut missing_map = instruction;
    missing_map.accounts.pop();
    assert!(mollusk()
        .process_instruction(&missing_map, &accounts)
        .program_result
        .is_err());
}

fn arcade_fixture(protocol: Pubkey) -> (Pubkey, ArcadeConfig) {
    let rules = Pubkey::new_unique();
    let (address, bump) = Pubkey::find_program_address(&[ARCADE_CONFIG_SEED], &zkube::ID);
    let mut config = ArcadeConfig::canonical(protocol, rules, bump);
    config.launch_seeded = true;
    config.launch_day_id = 32;
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
    let (opens_at, entries_close_at, runs_close_at, recovery_deadline_at) =
        day_window(day_id).unwrap();
    (
        address,
        ArenaDaily {
            version: ARCADE_ACCOUNT_VERSION,
            day_id,
            week_id: week_id_for_day(day_id).unwrap(),
            season_id: season_id_for_day(day_id).unwrap(),
            arcade_config,
            rules_version: 1,
            status,
            predecessor_rollover_applied,
            content_version: 1,
            catalog_hash: [1; 32],
            rules_hash: [2; 32],
            map_id: 1,
            scoring_rule: canonical_daily_scoring_rules()[0],
            rules: LevelRuleSnapshot::default(),
            pressure: DailyPressureProfile::canonical(),
            opens_at,
            entries_close_at,
            runs_close_at,
            recovery_deadline_at,
            finalized_at: 0,
            ledger: PoolLedger::default(),
            entries_paid: 0,
            entries_scored: 0,
            entries_expired: 0,
            unique_players: 0,
            season_eligible_players: 0,
            season_rollups: 0,
            season_rollup_sealed: false,
            entries: Vec::new(),
            profile_sync_mask: 0,
            bump,
        },
    )
}

fn weekly_fixture(
    week_id: u32,
    arcade_config: Pubkey,
    status: PeriodStatus,
    predecessor_rollover_applied: bool,
) -> (Pubkey, WeeklyJackpot) {
    let (address, bump) =
        Pubkey::find_program_address(&[WEEKLY_JACKPOT_SEED, &week_id.to_le_bytes()], &zkube::ID);
    let (opens_at, closes_at) = week_window(week_id).unwrap();
    (
        address,
        WeeklyJackpot {
            version: ARCADE_ACCOUNT_VERSION,
            week_id,
            qualification_start_day: week_start_day(week_id).unwrap(),
            arcade_config,
            status,
            predecessor_rollover_applied,
            metrics: weekly_metric_selection(week_id, [3; 32]),
            rules_hash: [3; 32],
            opens_at,
            closes_at,
            finalized_at: 0,
            ledger: PoolLedger::default(),
            combo_entries: Vec::new(),
            action_entries: Vec::new(),
            run_entries: Vec::new(),
            profile_sync_mask: 0,
            bump,
        },
    )
}

fn season_fixture(
    season_id: u32,
    arcade_config: Pubkey,
    status: PeriodStatus,
    predecessor_rollover_applied: bool,
) -> (Pubkey, Season) {
    let (address, bump) =
        Pubkey::find_program_address(&[SEASON_SEED, &season_id.to_le_bytes()], &zkube::ID);
    let (opens_at, closes_at) = season_window(season_id).unwrap();
    (
        address,
        Season {
            version: ARCADE_ACCOUNT_VERSION,
            season_id,
            qualification_start_day: season_start_day(season_id).unwrap(),
            arcade_config,
            status,
            predecessor_rollover_applied,
            opens_at,
            closes_at,
            finalized_at: 0,
            ledger: PoolLedger::default(),
            sealed_dailies: 0,
            entries: Vec::new(),
            profile_sync_mask: 0,
            bump,
        },
    )
}

fn operator_fixture(protocol: Pubkey) -> (Pubkey, OperatorRevenueVault) {
    let (address, bump) = Pubkey::find_program_address(&[OPERATOR_REVENUE_VAULT_SEED], &zkube::ID);
    (
        address,
        OperatorRevenueVault {
            version: ARCADE_ACCOUNT_VERSION,
            protocol,
            gross_operator_share: 0,
            withdrawn: 0,
            bump,
        },
    )
}

#[test]
fn sbf_funded_entry_keeps_owner_payment_and_rent_boundaries_exact() {
    let authority = Pubkey::new_unique();
    let team = Pubkey::new_unique();
    let owner = Pubkey::new_unique();
    let (protocol, protocol_state) = protocol_fixture(authority, team, false);
    let (arcade, arcade_state) = arcade_fixture(protocol);
    let day_id = 32;
    let week_id = week_id_for_day(day_id).unwrap();
    let season_id = season_id_for_day(day_id).unwrap();
    let (current_daily, current_daily_state) =
        daily_fixture(day_id, arcade, PeriodStatus::Open, false);
    let (following_daily, following_daily_state) =
        daily_fixture(day_id + 1, arcade, PeriodStatus::Funding, false);
    let (current_weekly, current_weekly_state) =
        weekly_fixture(week_id, arcade, PeriodStatus::Open, false);
    let (following_weekly, following_weekly_state) =
        weekly_fixture(week_id + 1, arcade, PeriodStatus::Funding, false);
    let (current_season, current_season_state) =
        season_fixture(season_id, arcade, PeriodStatus::Open, false);
    let (following_season, following_season_state) =
        season_fixture(season_id + 1, arcade, PeriodStatus::Funding, false);
    let (operator, operator_state) = operator_fixture(protocol);
    let (player, player_state) = player_fixture(owner);
    let (arena_player, _) = Pubkey::find_program_address(
        &[ARENA_PLAYER_SEED, current_daily.as_ref(), owner.as_ref()],
        &zkube::ID,
    );
    let run_id = INITIAL_RUN_ID;
    let (active_run, _) = Pubkey::find_program_address(
        &[
            ACTIVE_RUN_SEED,
            b"active",
            owner.as_ref(),
            &run_id.to_le_bytes(),
        ],
        &zkube::ID,
    );
    let (player_funding, _) =
        Pubkey::find_program_address(&[PLAYER_FUNDING_SEED, owner.as_ref()], &zkube::ID);
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::FundedEnterArena {
            protocol,
            arcade_config: arcade,
            player_state: player,
            current_daily,
            arena_player,
            current_weekly,
            current_season,
            following_daily,
            following_weekly,
            following_season,
            operator_revenue_vault: operator,
            active_run,
            player_funding,
            owner,
            system_program: anchor_lang::system_program::ID,
            zkube_program: zkube::ID,
        }
        .to_account_metas(None),
        data: zkube::instruction::FundedEnterArena {
            run_id,
            expected_entry_lamports: ARENA_ENTRY_LAMPORTS,
        }
        .data(),
    };
    let owner_before = 2_000_000_000;
    let funding_before = PLAYER_FUNDING_TARGET_LAMPORTS;
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
            current_weekly,
            program_account(&current_weekly_state, 8 + WeeklyJackpot::INIT_SPACE),
        ),
        (
            current_season,
            program_account(&current_season_state, 8 + Season::INIT_SPACE),
        ),
        (
            following_daily,
            program_account(&following_daily_state, 8 + ArenaDaily::INIT_SPACE),
        ),
        (
            following_weekly,
            program_account(&following_weekly_state, 8 + WeeklyJackpot::INIT_SPACE),
        ),
        (
            following_season,
            program_account(&following_season_state, 8 + Season::INIT_SPACE),
        ),
        (
            operator,
            program_account(&operator_state, 8 + OperatorRevenueVault::INIT_SPACE),
        ),
        (active_run, system_account(0)),
        (player_funding, system_account(funding_before)),
        (owner, system_account(owner_before)),
        (anchor_lang::system_program::ID, system_program_account()),
        (
            zkube::ID,
            executable_program_account(Pubkey::from_str_const(
                "BPFLoaderUpgradeab1e11111111111111111111111",
            )),
        ),
    ];
    let mut runtime = mollusk();
    runtime.sysvars.clock.unix_timestamp = current_daily_state.opens_at + 1;
    let result = runtime.process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);

    let daily_after: ArenaDaily = decode(resulting_account(&result, &following_daily));
    let weekly_after: WeeklyJackpot = decode(resulting_account(&result, &following_weekly));
    let season_after: Season = decode(resulting_account(&result, &following_season));
    let operator_after: OperatorRevenueVault = decode(resulting_account(&result, &operator));
    let current_after: ArenaDaily = decode(resulting_account(&result, &current_daily));
    let player_after: ArenaPlayer = decode(resulting_account(&result, &arena_player));
    let profile_after_entry: PlayerState = decode(resulting_account(&result, &player));
    assert_eq!(daily_after.ledger.entry_lamports, ENTRY_DAILY_LAMPORTS);
    assert_eq!(weekly_after.ledger.entry_lamports, ENTRY_WEEKLY_LAMPORTS);
    assert_eq!(season_after.ledger.entry_lamports, ENTRY_SEASON_LAMPORTS);
    assert_eq!(operator_after.gross_operator_share, ENTRY_OPERATOR_LAMPORTS);
    assert_eq!(current_after.entries_paid, 1);
    assert_eq!(player_after.paid_entries, 1);
    assert_eq!(player_after.active_paid_run_id, run_id);
    assert_eq!(profile_after_entry.lifetime_paid_entries, 1);
    assert_eq!(
        resulting_account(&result, &owner).lamports,
        owner_before - ARENA_ENTRY_LAMPORTS,
        "the connected owner pays exactly the ranked entry"
    );
    assert_eq!(
        resulting_account(&result, &following_daily).lamports,
        ACCOUNT_LAMPORTS + ENTRY_DAILY_LAMPORTS
    );
    assert_eq!(
        resulting_account(&result, &following_weekly).lamports,
        ACCOUNT_LAMPORTS + ENTRY_WEEKLY_LAMPORTS
    );
    assert_eq!(
        resulting_account(&result, &following_season).lamports,
        ACCOUNT_LAMPORTS + ENTRY_SEASON_LAMPORTS
    );
    assert_eq!(
        resulting_account(&result, &operator).lamports,
        ACCOUNT_LAMPORTS + ENTRY_OPERATOR_LAMPORTS
    );
    let arena_player_rent = resulting_account(&result, &arena_player).lamports;
    let active_run_rent = resulting_account(&result, &active_run).lamports;
    let funding_after_entry = resulting_account(&result, &player_funding).lamports;
    assert_eq!(
        funding_after_entry + arena_player_rent + active_run_rent,
        funding_before,
        "the funding PDA pays rent only; no entry share leaves it"
    );

    // A bare System transfer cannot treat the PDA as a signer. The only code
    // that supplies its seeds is the fixed zKube self-CPI rent wrapper.
    let arbitrary_destination = Pubkey::new_unique();
    let mut arbitrary_transfer = anchor_lang::solana_program::system_instruction::transfer(
        &player_funding,
        &arbitrary_destination,
        1,
    );
    arbitrary_transfer.accounts[0].is_signer = false;
    assert!(mollusk()
        .process_instruction(
            &arbitrary_transfer,
            &[
                (player_funding, system_account(funding_before)),
                (arbitrary_destination, system_account(0)),
            ],
        )
        .program_result
        .is_err());

    // A terminal zero-action run is consumed permissionlessly. Its ActiveRun
    // rent returns to the canonical funding PDA while the daily records one
    // paid expiry and releases the durable reservation.
    let mut terminal: ActiveRun = decode(resulting_account(&result, &active_run));
    terminal.lifecycle = RunLifecycle::Finished;
    terminal.finished_at = current_daily_state.opens_at + 1;
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
            arena_daily: current_daily,
            arena_player,
            weekly_jackpot: current_weekly,
            active_run,
            rent_recipient: player_funding,
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
        (
            current_weekly,
            resulting_account(&result, &current_weekly).clone(),
        ),
        (active_run, terminal_account),
        (
            player_funding,
            resulting_account(&result, &player_funding).clone(),
        ),
    ];
    let consumed = mollusk().process_instruction(&consume, &consume_accounts);
    assert!(
        consumed.program_result.is_ok(),
        "{:?}",
        consumed.program_result
    );
    assert_eq!(
        resulting_account(&consumed, &player_funding).lamports,
        funding_after_entry + active_run_rent
    );
    assert_eq!(
        resulting_account(&consumed, &player_funding).lamports + arena_player_rent,
        funding_before
    );
    let consumed_daily: ArenaDaily = decode(resulting_account(&consumed, &current_daily));
    let consumed_player: PlayerState = decode(resulting_account(&consumed, &player));
    assert_eq!(consumed_daily.entries_expired, 1);
    assert_eq!(consumed_player.active_run_id, 0);
    assert_eq!(consumed_player.lifetime_paid_entries, 1);

    // Entry availability is independent from late predecessor settlement, but
    // payout ordering is not: even a fully resolved Daily cannot finalize
    // before its own predecessor rollover has landed.
    let caller = Pubkey::new_unique();
    let finalize = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::FinalizeArenaDaily {
            arena_daily: current_daily,
            following_daily,
            caller,
        }
        .to_account_metas(None),
        data: zkube::instruction::FinalizeArenaDaily {}.data(),
    };
    let mut late = mollusk();
    late.sysvars.clock.unix_timestamp = current_daily_state.runs_close_at;
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
                (caller, system_account(ACCOUNT_LAMPORTS)),
            ],
        )
        .program_result
        .is_err());
}

#[test]
fn sbf_practice_uses_today_deadline_for_play_cutoff_and_recovery() {
    let authority = Pubkey::new_unique();
    let owner = Pubkey::new_unique();
    let caller = Pubkey::new_unique();
    let (protocol, protocol_state) = protocol_fixture(authority, Pubkey::new_unique(), false);
    let (arcade, _) = arcade_fixture(protocol);
    let challenge_day = 32;
    let today = challenge_day + 1;
    let (yesterday, yesterday_state) =
        daily_fixture(challenge_day, arcade, PeriodStatus::Finalized, true);
    let (today_opens, _, today_runs_close, _) = day_window(today).unwrap();
    let (_, _, yesterday_runs_close, _) = day_window(challenge_day).unwrap();
    let (player, player_state) = player_fixture(owner);
    let run_id = INITIAL_RUN_ID;
    let (active_run, _) = Pubkey::find_program_address(
        &[
            ACTIVE_RUN_SEED,
            b"active",
            owner.as_ref(),
            &run_id.to_le_bytes(),
        ],
        &zkube::ID,
    );
    let prepare = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::PreparePracticeRun {
            protocol,
            player_state: player,
            arena_daily: yesterday,
            active_run,
            payer: owner,
            owner_authority: owner,
            session_token: None,
            actor: owner,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: zkube::instruction::PreparePracticeRun { run_id }.data(),
    };
    let prepare_accounts = vec![
        (
            protocol,
            program_account(&protocol_state, 8 + ProtocolConfig::INIT_SPACE),
        ),
        (
            player,
            program_account(&player_state, 8 + PlayerState::INIT_SPACE),
        ),
        (
            yesterday,
            program_account(&yesterday_state, 8 + ArenaDaily::INIT_SPACE),
        ),
        (active_run, system_account(0)),
        (owner, system_account(100_000_000)),
        (anchor_lang::system_program::ID, system_program_account()),
    ];
    let mut runtime = mollusk();
    runtime.sysvars.clock.unix_timestamp = today_opens + 1;
    let prepared = runtime.process_instruction(&prepare, &prepare_accounts);
    assert!(
        prepared.program_result.is_ok(),
        "{:?}",
        prepared.program_result
    );
    let prepared_run: ActiveRun = decode(resulting_account(&prepared, &active_run));
    let prepared_player: PlayerState = decode(resulting_account(&prepared, &player));
    assert_eq!(prepared_run.mode, RunMode::Practice);
    assert_eq!(prepared_run.daily_challenge, yesterday);
    assert_eq!(prepared_run.rules_hash, yesterday_state.rules_hash);
    assert_eq!(prepared_run.deadline_at, today_runs_close);
    assert!(prepared_run.deadline_at > yesterday_runs_close);
    assert_eq!(prepared_player.active_run_deadline_at, today_runs_close);
    assert_eq!(prepared_run.vrf_request_counter, 0);
    assert_eq!(prepared_run.pending_vrf_counter, 0);

    // Project the prepared run into a valid playing state. One accepted move
    // immediately before today's cutoff succeeds and requests fresh VRF.
    let mut playing: ActiveRun = decode(resulting_account(&prepared, &active_run));
    playing.lifecycle = RunLifecycle::Playing;
    playing.rules.points_required = u32::MAX;
    playing.rules.max_moves = 20;
    playing.rules.score_multiplier_x100 = 100;
    playing.rules.combo_multiplier_x100 = 100;
    playing.daily_pressure = DailyPressureProfile::canonical();
    for row in 0..9 {
        playing.grid[row * 8] = 1;
    }
    playing.next_row = [1, 0, 0, 0, 0, 0, 0, 0];
    playing.has_next_row = true;
    let (_, moved) = process_play_move(playing, 0, 0, 0, today_runs_close - 1, true);
    assert!(moved.program_result.is_ok(), "{:?}", moved.program_result);
    let partial: ActiveRun = decode(resulting_account(&moved, &active_run));
    assert_eq!(partial.action_counter, 1);
    assert_eq!(partial.lifecycle, RunLifecycle::AwaitingVrf);
    assert_eq!(partial.pending_vrf_counter, 1);
    assert_eq!(partial.deadline_at, today_runs_close);

    let force = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::ForceFinishDeadline { active_run, caller }
            .to_account_metas(None),
        data: zkube::instruction::ForceFinishDeadline {}.data(),
    };
    let force_accounts = vec![
        (active_run, resulting_account(&moved, &active_run).clone()),
        (caller, system_account(ACCOUNT_LAMPORTS)),
    ];
    let mut early_force = mollusk();
    early_force.sysvars.clock.unix_timestamp = today_runs_close - 1;
    assert!(early_force
        .process_instruction(&force, &force_accounts)
        .program_result
        .is_err());
    let mut at_close = mollusk();
    at_close.sysvars.clock.unix_timestamp = today_runs_close;
    let forced = at_close.process_instruction(&force, &force_accounts);
    assert!(forced.program_result.is_ok(), "{:?}", forced.program_result);
    let forced_partial: ActiveRun = decode(resulting_account(&forced, &active_run));
    assert_eq!(forced_partial.lifecycle, RunLifecycle::Finished);
    assert_eq!(forced_partial.action_counter, 1);
    assert_eq!(forced_partial.finished_at, today_runs_close);
    assert_eq!(forced_partial.pending_vrf_counter, 0);

    // Practice consumption remains valid after its source Daily has been
    // archived and closed. The two legacy ABI positions are present but
    // intentionally untyped and unread.
    let (rent_recipient, _) =
        Pubkey::find_program_address(&[PLAYER_FUNDING_SEED, owner.as_ref()], &zkube::ID);
    let consume = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::ConsumePracticeRun {
            player_state: player,
            arena_daily: yesterday,
            arena_player: None,
            active_run,
            rent_recipient,
        }
        .to_account_metas(None),
        data: zkube::instruction::ConsumePracticeRun {}.data(),
    };
    let consumed = mollusk().process_instruction(
        &consume,
        &[
            (player, resulting_account(&prepared, &player).clone()),
            (yesterday, system_account(0)),
            (
                zkube::ID,
                executable_program_account(Pubkey::from_str_const(
                    "BPFLoaderUpgradeab1e11111111111111111111111",
                )),
            ),
            (active_run, resulting_account(&forced, &active_run).clone()),
            (rent_recipient, system_account(1_000_000)),
        ],
    );
    assert!(
        consumed.program_result.is_ok(),
        "{:?}",
        consumed.program_result
    );
    let consumed_player: PlayerState = decode(resulting_account(&consumed, &player));
    assert_eq!(consumed_player.active_run_id, 0);

    let mut zero_action: ActiveRun = decode(resulting_account(&prepared, &active_run));
    zero_action.lifecycle = RunLifecycle::Delegated;
    let zero_accounts = vec![
        (
            active_run,
            program_account(&zero_action, 8 + ActiveRun::INIT_SPACE),
        ),
        (caller, system_account(ACCOUNT_LAMPORTS)),
    ];
    let mut zero_close = mollusk();
    zero_close.sysvars.clock.unix_timestamp = today_runs_close;
    let forced_zero = zero_close.process_instruction(&force, &zero_accounts);
    assert!(
        forced_zero.program_result.is_ok(),
        "{:?}",
        forced_zero.program_result
    );
    let forced_zero: ActiveRun = decode(resulting_account(&forced_zero, &active_run));
    assert_eq!(forced_zero.lifecycle, RunLifecycle::Finished);
    assert_eq!(forced_zero.action_counter, 0);
    assert_eq!(forced_zero.daily_score, 0);
    assert_eq!(forced_zero.finished_at, today_runs_close);

    // If the ER copy remains unavailable, durable recovery is likewise based
    // on today's deadline and never yesterday's already-past challenge time.
    let expire = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::ExpireUnresolvedPracticeRun {
            player_state: player,
            owner,
            caller,
        }
        .to_account_metas(None),
        data: zkube::instruction::ExpireUnresolvedPracticeRun { run_id }.data(),
    };
    let expire_accounts = vec![
        (player, resulting_account(&prepared, &player).clone()),
        (owner, resulting_account(&prepared, &owner).clone()),
        (caller, system_account(ACCOUNT_LAMPORTS)),
    ];
    let recovery_at = today_runs_close + STUCK_RUN_RECOVERY_SECONDS;
    let mut early_recovery = mollusk();
    early_recovery.sysvars.clock.unix_timestamp = recovery_at - 1;
    assert!(early_recovery
        .process_instruction(&expire, &expire_accounts)
        .program_result
        .is_err());
    let mut recover = mollusk();
    recover.sysvars.clock.unix_timestamp = recovery_at;
    let expired = recover.process_instruction(&expire, &expire_accounts);
    assert!(
        expired.program_result.is_ok(),
        "{:?}",
        expired.program_result
    );
    let recovered_player: PlayerState = decode(resulting_account(&expired, &player));
    assert_eq!(recovered_player.active_run_id, 0);
    assert_eq!(recovered_player.orphan_run_id, run_id);
}

#[test]
fn sbf_missed_daily_recovery_activation_requires_rollover_and_deadline() {
    let authority = Pubkey::new_unique();
    let caller = Pubkey::new_unique();
    let (protocol, protocol_state) = protocol_fixture(authority, Pubkey::new_unique(), false);
    let (arcade, _) = arcade_fixture(protocol);
    let (_, mut missing_state) = daily_fixture(32, arcade, PeriodStatus::Funding, true);
    let missing = Pubkey::find_program_address(
        &[ARENA_DAILY_SEED, &missing_state.day_id.to_le_bytes()],
        &zkube::ID,
    )
    .0;
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::ActivateArenaDaily {
            protocol,
            arena_daily: missing,
            caller,
        }
        .to_account_metas(None),
        data: zkube::instruction::ActivateArenaDaily {}.data(),
    };
    let accounts = |state: &ArenaDaily| {
        vec![
            (
                protocol,
                program_account(&protocol_state, 8 + ProtocolConfig::INIT_SPACE),
            ),
            (missing, program_account(state, 8 + ArenaDaily::INIT_SPACE)),
            (caller, system_account(ACCOUNT_LAMPORTS)),
        ]
    };

    // A normally scheduled period opens on time even though its predecessor
    // cannot be finalized until the run-recovery window ends. Requiring the
    // rollover here would create a daily 5.5-hour outage.
    missing_state.predecessor_rollover_applied = false;
    let mut on_time = mollusk();
    on_time.sysvars.clock.unix_timestamp = missing_state.opens_at + 1;
    let result = on_time.process_instruction(&instruction, &accounts(&missing_state));
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);

    let mut early = mollusk();
    early.sysvars.clock.unix_timestamp = missing_state.recovery_deadline_at - 1;
    assert!(early
        .process_instruction(&instruction, &accounts(&missing_state))
        .program_result
        .is_err());

    missing_state.predecessor_rollover_applied = false;
    let mut no_rollover = mollusk();
    no_rollover.sysvars.clock.unix_timestamp = missing_state.recovery_deadline_at;
    assert!(no_rollover
        .process_instruction(&instruction, &accounts(&missing_state))
        .program_result
        .is_err());

    missing_state.predecessor_rollover_applied = true;
    let mut recovered = mollusk();
    recovered.sysvars.clock.unix_timestamp = missing_state.recovery_deadline_at;
    let result = recovered.process_instruction(&instruction, &accounts(&missing_state));
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    let after: ArenaDaily = decode(resulting_account(&result, &missing));
    assert_eq!(after.status, PeriodStatus::Open);
}

#[test]
fn sbf_cadence_funding_can_prepare_a_missing_post_launch_daily() {
    let authority = Pubkey::new_unique();
    let caller = Pubkey::new_unique();
    let (protocol, protocol_state) = protocol_fixture(authority, Pubkey::new_unique(), false);
    let (arcade, arcade_state) = arcade_fixture(protocol);
    let rules = arcade_state.rules_catalog;
    let rules_state = DailyRulesCatalog {
        version: RULES_ACCOUNT_VERSION,
        rules_version: 1,
        protocol,
        content_version: protocol_state.content_version,
        catalog_hash: [7; 32],
        rotation_id: 1,
        starts_day: arcade_state.launch_day_id + 4,
        rotation_seed: [9; 32],
        scoring_rule_count: 15,
        scoring_rules: canonical_daily_scoring_rules(),
        pressure: DailyPressureProfile::canonical(),
        bump: 1,
    };
    let missing_day = arcade_state.launch_day_id + 2;
    let (missing, _) =
        Pubkey::find_program_address(&[ARENA_DAILY_SEED, &missing_day.to_le_bytes()], &zkube::ID);
    let (arcade_archive, archive_bump) =
        Pubkey::find_program_address(&[ARCADE_ARCHIVE_SEED], &zkube::ID);
    let archive_state =
        ArcadeArchive::initialize(arcade, arcade_state.launch_day_id, archive_bump).unwrap();
    let (cadence_funding, _) = Pubkey::find_program_address(&[CADENCE_FUNDING_SEED], &zkube::ID);
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::FundedPrepareArenaDaily {
            protocol,
            arcade_config: arcade,
            arcade_archive,
            daily_rules_catalog: rules,
            arena_daily: missing,
            cadence_funding,
            caller,
            system_program: anchor_lang::system_program::ID,
            zkube_program: zkube::ID,
        }
        .to_account_metas(None),
        data: zkube::instruction::FundedPrepareArenaDaily {
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
        (
            arcade_archive,
            program_account(&archive_state, 8 + ArcadeArchive::INIT_SPACE),
        ),
        (
            rules,
            program_account(&rules_state, 8 + DailyRulesCatalog::INIT_SPACE),
        ),
        (missing, system_account(0)),
        (cadence_funding, system_account(funding_before)),
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
    runtime.sysvars.clock.unix_timestamp = i64::from(missing_day + 5) * ARCADE_SECONDS_PER_DAY;
    let result = runtime.process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    let after: ArenaDaily = decode(resulting_account(&result, &missing));
    assert_eq!(after.day_id, missing_day);
    assert_eq!(after.status, PeriodStatus::Funding);
    assert!(!after.predecessor_rollover_applied);
    assert_eq!(
        resulting_account(&result, &cadence_funding).lamports
            + resulting_account(&result, &missing).lamports,
        funding_before
    );
}

#[test]
fn sbf_featured_emblem_accepts_owner_and_only_unlocked_campaign_badges() {
    let owner = Pubkey::new_unique();
    let (player, mut player_state) = player_fixture(owner);
    for level in 1..=LEVELS_PER_MAP as u8 {
        player_state.record_level_stars(1, level, 1).unwrap();
    }
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::SetFeaturedEmblem {
            player_state: player,
            owner_authority: owner,
            session_token: None,
            actor: owner,
        }
        .to_account_metas(None),
        data: zkube::instruction::SetFeaturedEmblem { emblem_id: 1 }.data(),
    };
    let accounts = vec![
        (
            player,
            program_account(&player_state, 8 + PlayerState::INIT_SPACE),
        ),
        (owner, system_account(ACCOUNT_LAMPORTS)),
    ];
    let result = mollusk().process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    let updated: PlayerState = decode(resulting_account(&result, &player));
    assert_eq!(updated.featured_emblem, 1);

    let locked = anchor_lang::solana_program::instruction::Instruction {
        data: zkube::instruction::SetFeaturedEmblem { emblem_id: 2 }.data(),
        ..instruction
    };
    assert!(mollusk()
        .process_instruction(
            &locked,
            &[
                (player, resulting_account(&result, &player).clone()),
                (owner, system_account(ACCOUNT_LAMPORTS)),
            ],
        )
        .program_result
        .is_err());
}

#[test]
fn sbf_daily_profile_sync_is_permissionless_idempotent_and_moves_no_sol() {
    let owner = Pubkey::new_unique();
    let caller = Pubkey::new_unique();
    let arcade = Pubkey::new_unique();
    let (daily, mut daily_state) = daily_fixture(32, arcade, PeriodStatus::Finalized, true);
    let mut players = vec![owner];
    players.extend((0..4).map(|_| Pubkey::new_unique()));
    daily_state.entries = players
        .iter()
        .enumerate()
        .map(|(index, player)| ArenaBoardEntry {
            player: *player,
            score: 100 - index as u32,
            ..ArenaBoardEntry::default()
        })
        .collect();
    let pool = 101_990_000;
    let plan = rounded_payouts(pool, &DAILY_PRIZE_WEIGHTS, 5).unwrap();
    daily_state.ledger = PoolLedger {
        seeded_lamports: pool,
        payout_lamports: plan.paid_lamports,
        rollover_out_lamports: plan.rollover_lamports,
        ..PoolLedger::default()
    };
    let (player, player_state) = player_fixture(owner);
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::SyncDailyProfile {
            caller,
            arena_daily: daily,
            player_state: player,
        }
        .to_account_metas(None),
        data: zkube::instruction::SyncDailyProfile {}.data(),
    };
    let accounts = vec![
        (caller, system_account(ACCOUNT_LAMPORTS)),
        (
            daily,
            program_account(&daily_state, 8 + ArenaDaily::INIT_SPACE),
        ),
        (
            player,
            program_account(&player_state, 8 + PlayerState::INIT_SPACE),
        ),
    ];
    let result = mollusk().process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    let daily_after: ArenaDaily = decode(resulting_account(&result, &daily));
    let player_after: PlayerState = decode(resulting_account(&result, &player));
    assert_eq!(daily_after.profile_sync_mask, 1);
    assert_eq!(player_after.daily_record.best_prize_rank, 1);
    assert_eq!(player_after.daily_record.podiums, 1);
    assert_eq!(player_after.daily_record.wins, 1);
    assert_eq!(player_after.daily_record.rewards_lamports, 45_000_000);
    assert_eq!(
        resulting_account(&result, &daily).lamports,
        ACCOUNT_LAMPORTS
    );
    assert_eq!(
        resulting_account(&result, &player).lamports,
        ACCOUNT_LAMPORTS
    );

    assert!(mollusk()
        .process_instruction(
            &instruction,
            &[
                (caller, system_account(ACCOUNT_LAMPORTS)),
                (daily, resulting_account(&result, &daily).clone()),
                (player, resulting_account(&result, &player).clone()),
            ],
        )
        .program_result
        .is_err());
}

#[test]
fn sbf_launch_seeding_accepts_mid_period_and_sets_qualification_boundaries() {
    let authority = Pubkey::new_unique();
    let team = Pubkey::new_unique();
    let (protocol, protocol_state) = protocol_fixture(authority, team, true);
    let rules = Pubkey::new_unique();
    let (arcade, arcade_bump) = Pubkey::find_program_address(&[ARCADE_CONFIG_SEED], &zkube::ID);
    let arcade_state = ArcadeConfig::canonical(protocol, rules, arcade_bump);
    let today = 33;
    let week_id = week_id_for_day(today).unwrap();
    let season_id = season_id_for_day(today).unwrap();
    assert_ne!(week_start_day(week_id).unwrap(), today);
    assert_ne!(season_start_day(season_id).unwrap(), today);
    let (daily, daily_state) = daily_fixture(today, arcade, PeriodStatus::Funding, false);
    let (weekly, weekly_state) = weekly_fixture(week_id, arcade, PeriodStatus::Funding, false);
    let (season, season_state) = season_fixture(season_id, arcade, PeriodStatus::Funding, false);
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::SeedLaunchPools {
            protocol,
            arcade_config: arcade,
            arena_daily: daily,
            weekly_jackpot: weekly,
            season,
            authority,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: zkube::instruction::SeedLaunchPools {
            daily_lamports: 10_000_000,
            weekly_lamports: 20_000_000,
            season_lamports: 30_000_000,
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
        (
            weekly,
            program_account(&weekly_state, 8 + WeeklyJackpot::INIT_SPACE),
        ),
        (
            season,
            program_account(&season_state, 8 + Season::INIT_SPACE),
        ),
        (authority, system_account(1_000_000_000)),
        (anchor_lang::system_program::ID, system_program_account()),
    ];
    let mut runtime = mollusk();
    runtime.sysvars.clock.unix_timestamp = i64::from(today) * ARCADE_SECONDS_PER_DAY + 1;
    let result = runtime.process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    let arcade_after: ArcadeConfig = decode(resulting_account(&result, &arcade));
    let weekly_after: WeeklyJackpot = decode(resulting_account(&result, &weekly));
    let season_after: Season = decode(resulting_account(&result, &season));
    assert!(arcade_after.launch_seeded);
    assert_eq!(arcade_after.launch_day_id, today);
    assert_eq!(weekly_after.qualification_start_day, today);
    assert_eq!(weekly_after.qualified_day_count().unwrap(), 6);
    assert_eq!(season_after.qualification_start_day, today);
    assert_eq!(season_after.qualified_day_count().unwrap(), 27);
}

#[test]
fn sbf_season_seal_rejects_prequalification_daily() {
    let caller = Pubkey::new_unique();
    let arcade = Pubkey::new_unique();
    let season_id = 3;
    let natural_start = season_start_day(season_id).unwrap();
    let (season, mut season_state) = season_fixture(season_id, arcade, PeriodStatus::Open, true);
    season_state.qualification_start_day = natural_start + 1;
    let (prequalification_daily, prequalification_state) =
        daily_fixture(natural_start, arcade, PeriodStatus::Finalized, true);
    let prequalification_instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::SealArenaSeasonRollups {
            arena_daily: prequalification_daily,
            season,
            caller,
        }
        .to_account_metas(None),
        data: zkube::instruction::SealArenaSeasonRollups {}.data(),
    };
    assert!(mollusk()
        .process_instruction(
            &prequalification_instruction,
            &[
                (
                    prequalification_daily,
                    program_account(&prequalification_state, 8 + ArenaDaily::INIT_SPACE),
                ),
                (
                    season,
                    program_account(&season_state, 8 + Season::INIT_SPACE),
                ),
                (caller, system_account(ACCOUNT_LAMPORTS)),
            ],
        )
        .program_result
        .is_err());

    let (qualified_daily, qualified_state) =
        daily_fixture(natural_start + 1, arcade, PeriodStatus::Finalized, true);
    let qualified_instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::SealArenaSeasonRollups {
            arena_daily: qualified_daily,
            season,
            caller,
        }
        .to_account_metas(None),
        data: zkube::instruction::SealArenaSeasonRollups {}.data(),
    };
    let qualified_result = mollusk().process_instruction(
        &qualified_instruction,
        &[
            (
                qualified_daily,
                program_account(&qualified_state, 8 + ArenaDaily::INIT_SPACE),
            ),
            (
                season,
                program_account(&season_state, 8 + Season::INIT_SPACE),
            ),
            (caller, system_account(ACCOUNT_LAMPORTS)),
        ],
    );
    assert!(
        qualified_result.program_result.is_ok(),
        "{:?}",
        qualified_result.program_result
    );
    let daily_after: ArenaDaily = decode(resulting_account(&qualified_result, &qualified_daily));
    let season_after: Season = decode(resulting_account(&qualified_result, &season));
    assert!(daily_after.season_rollup_sealed);
    assert_eq!(season_after.sealed_dailies, 1);
}

#[test]
fn sbf_weekly_finalize_requires_sequential_daily_archive_checkpoint() {
    let caller = Pubkey::new_unique();
    let arcade = Pubkey::new_unique();
    let week_id = 5;
    let week_start = week_start_day(week_id).unwrap();
    let qualification_start = week_start + 5;
    let (weekly, mut weekly_state) = weekly_fixture(week_id, arcade, PeriodStatus::Open, true);
    weekly_state.qualification_start_day = qualification_start;
    let pool = 90_000_000;
    weekly_state.ledger.seeded_lamports = pool;
    let (following, following_state) =
        weekly_fixture(week_id + 1, arcade, PeriodStatus::Funding, false);
    let (arcade_archive, archive_bump) =
        Pubkey::find_program_address(&[ARCADE_ARCHIVE_SEED], &zkube::ID);
    let mut archive_state =
        ArcadeArchive::initialize(arcade, qualification_start, archive_bump).unwrap();
    archive_state.last_daily_id = qualification_start + 1;

    let metas = zkube::accounts::FinalizeWeeklyJackpot {
        weekly_jackpot: weekly,
        following_weekly: following,
        arcade_archive,
        caller,
    }
    .to_account_metas(None);
    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: metas,
        data: zkube::instruction::FinalizeWeeklyJackpot {}.data(),
    };
    let accounts = vec![
        (
            weekly,
            serialized_account(
                &weekly_state,
                8 + WeeklyJackpot::INIT_SPACE,
                zkube::ID,
                ACCOUNT_LAMPORTS + pool + 100_000_000,
            ),
        ),
        (
            following,
            program_account(&following_state, 8 + WeeklyJackpot::INIT_SPACE),
        ),
        (
            arcade_archive,
            program_account(&archive_state, 8 + ArcadeArchive::INIT_SPACE),
        ),
        (caller, system_account(ACCOUNT_LAMPORTS)),
    ];
    let mut runtime = mollusk();
    runtime.sysvars.clock.unix_timestamp = weekly_state.closes_at + PERIOD_SETTLEMENT_DELAY_SECONDS;

    let mut incomplete_archive = archive_state.clone();
    incomplete_archive.last_daily_id = qualification_start;
    let incomplete_accounts = vec![
        accounts[0].clone(),
        accounts[1].clone(),
        (
            arcade_archive,
            program_account(&incomplete_archive, 8 + ArcadeArchive::INIT_SPACE),
        ),
        accounts[3].clone(),
    ];
    assert!(runtime
        .process_instruction(&instruction, &incomplete_accounts)
        .program_result
        .is_err());

    let result = runtime.process_instruction(&instruction, &accounts);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    let weekly_after: WeeklyJackpot = decode(resulting_account(&result, &weekly));
    let following_after: WeeklyJackpot = decode(resulting_account(&result, &following));
    assert_eq!(weekly_after.status, PeriodStatus::Finalized);
    assert_eq!(weekly_after.ledger.rollover_out_lamports, pool);
    assert!(following_after.predecessor_rollover_applied);
    assert_eq!(following_after.ledger.rollover_in_lamports, pool);
}

#[test]
fn sbf_daily_archive_and_close_return_only_rent_to_cadence_funding() {
    let caller = Pubkey::new_unique();
    let arcade = Pubkey::new_unique();
    let day_id = 20_656;
    let (daily, mut daily_state) = daily_fixture(day_id, arcade, PeriodStatus::Finalized, true);
    daily_state.season_rollup_sealed = true;
    let (archive, archive_bump) = Pubkey::find_program_address(&[ARCADE_ARCHIVE_SEED], &zkube::ID);
    let archive_state = ArcadeArchive::initialize(arcade, day_id, archive_bump).unwrap();
    let archive_instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::ArchiveArenaDaily {
            arcade_archive: archive,
            arena_daily: daily,
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
                program_account(&archive_state, 8 + ArcadeArchive::INIT_SPACE),
            ),
            (
                daily,
                program_account(&daily_state, 8 + ArenaDaily::INIT_SPACE),
            ),
            (caller, system_account(ACCOUNT_LAMPORTS)),
        ],
    );
    assert!(
        archived.program_result.is_ok(),
        "{:?}",
        archived.program_result
    );
    let archive_after: ArcadeArchive = decode(resulting_account(&archived, &archive));
    assert_eq!(archive_after.last_daily_id, day_id);
    assert_ne!(archive_after.daily_root, [0; 32]);

    let (cadence_funding, _) = Pubkey::find_program_address(&[CADENCE_FUNDING_SEED], &zkube::ID);
    let funding_before = 500_000_000;
    let daily_lamports = resulting_account(&archived, &daily).lamports;
    let close_instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: zkube::ID,
        accounts: zkube::accounts::CloseArenaDaily {
            arcade_archive: archive,
            arena_daily: daily,
            cadence_funding,
            caller,
        }
        .to_account_metas(None),
        data: zkube::instruction::CloseArenaDaily {}.data(),
    };
    let mut runtime = mollusk();
    runtime.sysvars.clock.unix_timestamp = day_window(day_id + 1).unwrap().1;
    let closed = runtime.process_instruction(
        &close_instruction,
        &[
            (archive, resulting_account(&archived, &archive).clone()),
            (daily, resulting_account(&archived, &daily).clone()),
            (cadence_funding, system_account(funding_before)),
            (caller, system_account(ACCOUNT_LAMPORTS)),
        ],
    );
    assert!(closed.program_result.is_ok(), "{:?}", closed.program_result);
    assert_eq!(
        resulting_account(&closed, &cadence_funding).lamports,
        funding_before + daily_lamports
    );
}

#[test]
fn sbf_participant_rent_can_be_recycled_after_parent_daily_is_closed() {
    let day_id = 20_656u32;
    let player = Pubkey::new_unique();
    let caller = Pubkey::new_unique();
    let (daily, _) =
        Pubkey::find_program_address(&[ARENA_DAILY_SEED, &day_id.to_le_bytes()], &zkube::ID);
    let (arena_player, player_bump) = Pubkey::find_program_address(
        &[ARENA_PLAYER_SEED, daily.as_ref(), player.as_ref()],
        &zkube::ID,
    );
    let player_state = ArenaPlayer::initialize(daily, player, player_bump);
    let (rent_recipient, _) =
        Pubkey::find_program_address(&[PLAYER_FUNDING_SEED, player.as_ref()], &zkube::ID);
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
    let result = mollusk().process_instruction(
        &instruction,
        &[
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
        ],
    );
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    assert_eq!(
        resulting_account(&result, &rent_recipient).lamports,
        funding_before + participant_lamports
    );
}
