use super::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use solana::state::*;
use solana_message::{legacy, v0, VersionedMessage};

pub fn instruction<T: InstructionData, A: ToAccountMetas>(data: T, accounts: A) -> Instruction {
    Instruction {
        program_id: solana::ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    }
}

pub fn message(id: &str, payer: Pubkey, instructions: Vec<Instruction>, versioned: bool) -> Value {
    let mut instructions = instructions;
    if versioned {
        let program_id = Pubkey::from_str("ComputeBudget111111111111111111111111111111").unwrap();
        let mut limit = vec![2];
        limit.extend(400_000u32.to_le_bytes());
        let mut price = vec![3];
        price.extend(1_000u64.to_le_bytes());
        instructions.splice(
            0..0,
            [
                Instruction {
                    program_id,
                    accounts: vec![],
                    data: limit,
                },
                Instruction {
                    program_id,
                    accounts: vec![],
                    data: price,
                },
            ],
        );
    }
    let message = if versioned {
        VersionedMessage::V0(
            v0::Message::try_compile(&payer, &instructions, &[], blockhash()).unwrap(),
        )
    } else {
        VersionedMessage::Legacy(legacy::Message::new_with_blockhash(
            &instructions,
            Some(&payer),
            &blockhash(),
        ))
    };
    let meta = |index: usize| {
        json!({"address": message.static_account_keys()[index].to_string(),
        "signer": message.is_signer(index), "writable": message.is_maybe_writable(index, None)})
    };
    let decoded_accounts: Vec<_> = (0..message.static_account_keys().len()).map(meta).collect();
    let decoded_instructions: Vec<_> = message.instructions().iter().map(|ix| json!({
        "programId": message.static_account_keys()[usize::from(ix.program_id_index)].to_string(), "data": encoded(&ix.data),
        "accounts": ix.accounts.iter().map(|index| meta(usize::from(*index))).collect::<Vec<_>>() })).collect();
    json!({"id": id, "feePayer": payer.to_string(), "message": encoded(message.serialize()),
        "decodedAccounts": decoded_accounts, "decodedInstructions": decoded_instructions,
        "version": if versioned { "v0" } else { "legacy" },
        "signers": message.static_account_keys()[..usize::from(message.header().num_required_signatures)].iter().map(ToString::to_string).collect::<Vec<_>>(),
        "blockhash": blockhash().to_string(), "instructions": instructions.iter().map(|ix| json!({
            "programId": ix.program_id.to_string(), "data": encoded(&ix.data),
            "accounts": ix.accounts.iter().map(|meta| json!({"address": meta.pubkey.to_string(),
                "signer": meta.is_signer, "writable": meta.is_writable})).collect::<Vec<_>>()
        })).collect::<Vec<_>>()})
}

pub fn scenarios() -> Vec<Value> {
    let mut rows: Vec<_> = [1, 10, 25]
        .into_iter()
        .map(|count| {
            let ix = instruction(
                solana::instruction::PurchaseKredits {
                    kredit_count: count,
                },
                solana::accounts::PurchaseKredits {
                    protocol: accounts::singleton(PROTOCOL_CONFIG_SEED),
                    player_state: accounts::player_address(),
                    credit_vault: accounts::singleton(CREDIT_VAULT_SEED),
                    team_destination: validator(),
                    owner: owner(),
                    system_program: Pubkey::default(),
                },
            );
            let mut row = message(&format!("purchase-{count}"), owner(), vec![ix], true);
            row["instructionName"] = json!("purchase_kredits");
            row["args"] = json!({"kredit_count": count});
            row
        })
        .collect();
    rows.push(message(
        "session-refill-0",
        owner(),
        vec![
            transfer(owner(), device(), 5_000_000),
            transfer(device(), owner(), 0),
        ],
        true,
    ));
    rows.push(message(
        "legacy-transfer",
        device(),
        vec![transfer(device(), owner(), 1)],
        false,
    ));
    rows
}

pub fn closed_player() -> Value {
    let day = DAY - 40;
    let daily = accounts::daily_address(day);
    let address = accounts::participant_address(day);
    let player = ArenaPlayer::initialize(
        daily,
        owner(),
        device(),
        pda(&[ARENA_PLAYER_SEED, daily.as_ref(), owner().as_ref()]).1,
    );
    let mut config = accounts::protocol();
    config.last_daily_id = day;
    config.daily_root = [9; 32];
    let call = instruction(
        solana::instruction::CloseArenaPlayer {},
        solana::accounts::CloseArenaPlayer {
            arena_daily: daily,
            arena_player: address,
            rent_recipient: device(),
            caller: validator(),
        },
    );
    json!({"inputs": inputs(), "day": day,
        "protocol": envelope(accounts::singleton(PROTOCOL_CONFIG_SEED), &config, 8 + ProtocolConfig::INIT_SPACE),
        "player": envelope(address, &player, 8 + ArenaPlayer::INIT_SPACE),
        "transaction": message("close-arena-player", validator(), vec![call], false)})
}

fn transfer(from: Pubkey, to: Pubkey, amount: u64) -> Instruction {
    use anchor_lang::solana_program::instruction::AccountMeta;
    let mut data = 2u32.to_le_bytes().to_vec();
    data.extend(amount.to_le_bytes());
    Instruction {
        program_id: Pubkey::default(),
        accounts: vec![AccountMeta::new(from, true), AccountMeta::new(to, false)],
        data,
    }
}

pub fn consume(payer: Pubkey) -> Value {
    message(
        "consume",
        payer,
        vec![instruction(
            solana::instruction::ConsumeArenaRun {},
            solana::accounts::ConsumeArenaRun {
                player_state: accounts::player_address(),
                arena_daily: Some(accounts::daily_address(DAY)),
                arena_player: Some(accounts::participant_address(DAY)),
                active_run: accounts::run_address(RUN_ID),
                rent_recipient: device(),
            },
        )],
        true,
    )
}

pub fn claim(day: u32, kind: DailyBoardKind) -> Value {
    message(
        "claim",
        device(),
        vec![instruction(
            solana::instruction::ClaimDailyPrize {
                board: kind,
                position: 0,
            },
            solana::accounts::ClaimDailyPrize {
                arena_daily: accounts::daily_address(day),
                arena_board: boards::address(day, kind),
                player_state: accounts::player_address(),
                owner_authority: owner(),
                session_token: Some(accounts::session_address()),
                actor: device(),
            },
        )],
        true,
    )
}
