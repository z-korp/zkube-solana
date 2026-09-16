use super::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::{InstructionData, ToAccountMetas};

pub fn token_address(signer: Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            session_keys::SessionTokenV2::SEED_PREFIX.as_bytes(),
            solana::ID.as_ref(),
            signer.as_ref(),
            owner().as_ref(),
        ],
        &session_keys::ID,
    )
    .0
}
pub fn token(signer: Pubkey, valid_until: i64) -> Value {
    let token = session_keys::SessionTokenV2 {
        authority: owner(),
        target_program: solana::ID,
        session_signer: signer,
        fee_payer: owner(),
        valid_until,
    };
    let mut row = envelope(
        token_address(signer),
        &token,
        session_keys::SessionTokenV2::LEN,
    );
    row["owner"] = json!(session_keys::ID.to_string());
    row["validUntil"] = json!(valid_until);
    row
}
fn renew(remaining: i64, balance: u64) -> Value {
    let mut ix = Vec::new();
    {
        let mut revoke = Instruction {
            program_id: session_keys::ID,
            data: session_keys::instruction::RevokeSessionV2 {}.data(),
            accounts: session_keys::accounts::RevokeSessionTokenV2 {
                session_token: token_address(device()),
                fee_payer: owner(),
                authority: owner(),
                system_program: Pubkey::default(),
            }
            .to_account_metas(None),
        };
        revoke.accounts[2].is_signer = true;
        ix.push(revoke);
    }
    if balance > 0 {
        let mut data = 2u32.to_le_bytes().to_vec();
        data.extend(balance.to_le_bytes());
        ix.push(Instruction {
            program_id: Pubkey::default(),
            accounts: vec![
                AccountMeta::new(device(), true),
                AccountMeta::new(owner(), false),
            ],
            data,
        });
    }
    ix.push(transactions::instruction(
        solana::instruction::InitializePlayer {},
        solana::accounts::InitializePlayer {
            player_state: accounts::player_address(),
            payer: owner(),
            owner_authority: owner(),
            session_token: None,
            actor: owner(),
            system_program: Pubkey::default(),
        },
    ));
    ix.push(Instruction {
        program_id: session_keys::ID,
        data: session_keys::instruction::CreateSessionV2 {
            top_up: Some(true),
            valid_until: Some(NOW + 604_500),
            lamports: Some(5_000_000),
        }
        .data(),
        accounts: session_keys::accounts::CreateSessionTokenV2 {
            session_token: token_address(device()),
            session_signer: device(),
            fee_payer: owner(),
            authority: owner(),
            target_program: solana::ID,
            system_program: Pubkey::default(),
        }
        .to_account_metas(None),
    });
    let mut row = transactions::message("renew", owner(), ix, true);
    row["remaining"] = json!(remaining);
    row["balance"] = json!(balance);
    row["oldToken"] = token(device(), NOW + remaining);
    row
}
pub fn scenarios() -> Value {
    let inputs = inputs();
    let cases = [-1, 0, 59, 60, 61]
        .into_iter()
        .flat_map(|remaining| [0, 1_000_000].map(|balance| renew(remaining, balance)))
        .collect::<Vec<_>>();
    json!({"inputs": inputs, "renewedToken": token(device(), NOW + 604_500),
        "cases": cases})
}
