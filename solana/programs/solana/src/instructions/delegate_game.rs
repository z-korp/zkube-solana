// Délègue le GameState PDA à l'Ephemeral Rollup MagicBlock.
// À appeler depuis mainnet APRÈS que le VRF ait rempli la grille.
//

use anchor_lang::prelude::*;
use anchor_lang::{AccountDeserialize, AccountSerialize};
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use crate::state::{GameState, GamePhase};
use crate::error::ErrorCode;

// ER_VALIDATOR vient de crate::constants — modifier dans solana/.env et constants.rs

/// Comptes pour la délégation du PDA à l'ER.
/// Le client ne passe que player, validator (optionnel), pda.
/// #[delegate] gère le reste en interne.
#[delegate]
#[derive(Accounts)]
pub struct DelegateGame<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    pub validator: Option<AccountInfo<'info>>,

    /// CHECK: vérifications manuelles dans le handler (owner, phase, player)
    #[account(
        mut,
        del,
    )]
    pub pda: AccountInfo<'info>,
}

pub fn handler_delegate_game(ctx: Context<DelegateGame>) -> Result<()> {
    let player_key = ctx.accounts.player.key();
    let pda_info   = ctx.accounts.pda.to_account_info();

    // Le compte doit appartenir à notre programme (pas encore délégué).
    require!(
        pda_info.owner == ctx.program_id,
        ErrorCode::InvalidOwner
    );

    // Désérialiser manuellement (pda est AccountInfo, pas Account<GameState>)
    let mut data = pda_info.try_borrow_mut_data()?;
    let mut data_slice: &[u8] = &data;
    let mut game_state = GameState::try_deserialize(&mut data_slice)?;

    require!(game_state.player == player_key, ErrorCode::NotGameOwner);
    require!(game_state.phase == GamePhase::Created, ErrorCode::InvalidState);

    // Mise à jour AVANT delegate_pda — après, l'owner change vers delegation_program
    game_state.delegated           = true;
    game_state.delegated_authority = player_key;
    game_state.phase               = GamePhase::Delegated;

    let mut cursor = std::io::Cursor::new(&mut data[..]);
    game_state.try_serialize(&mut cursor)?;
    drop(data);

    let validator: Pubkey = crate::ER_VALIDATOR.parse().unwrap();

    // Propager l'erreur directement — Solana revert tout si la tx échoue
    ctx.accounts.delegate_pda(
        &ctx.accounts.player,
        &[b"game", player_key.as_ref(), game_state.session_key.as_ref()],
        DelegateConfig {
            validator: Some(validator),
            ..Default::default()
        },
    )?;

    msg!(
        "GameState {} délégué au validator ER: {}",
        player_key,
        validator
    );
    Ok(())
}
