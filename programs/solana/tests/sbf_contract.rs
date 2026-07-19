#![cfg(feature = "sbf-tests")]

use std::{fs, io::Cursor, path::PathBuf};

use anchor_lang::prelude::{AccountDeserialize, AccountSerialize, Pubkey};
use anchor_lang::{InstructionData, Space, ToAccountMetas};
use mollusk_svm::Mollusk;
use session_keys::SessionTokenV2;
use solana_account::Account;

use solana as zkube;
use zkube::game::{row_from_vrf, BlockWeights, Grid};
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
            pricing_operator: authority,
            team_destination,
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
fn sbf_player_label_update_preserves_player_progression_and_rejects_wrong_actor() {
    let authority = Pubkey::new_unique();
    let owner = Pubkey::new_unique();
    let actor = Pubkey::new_unique();
    let wrong_actor = Pubkey::new_unique();
    let (protocol, protocol_state) = protocol_fixture(authority, Pubkey::new_unique(), false);
    let (player, mut player_state) = player_fixture(owner);
    player_state.credit_xp(150).unwrap();
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
    assert_eq!(player_after.lifetime_xp, 150);

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
    assert_eq!(updated.lifetime_lines_cleared, 4);
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
