// Termine la partie : commit état final + undelegate vers mainnet.
// DOIT être envoyé au RPC ER (devnet-eu.magicblock.app).
//

use anchor_lang::prelude::*;
use anchor_lang::AccountDeserialize;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};
use crate::state::{GameState, GamePhase};
use crate::error::ErrorCode;

/// #[commit] injecte magic_context et magic_program automatiquement.
#[commit]
#[derive(Accounts)]
pub struct CloseGame<'info> {
    /// Le joueur réel (signe depuis Phantom 1 popup)
    #[account(mut)]
    pub player: Signer<'info>,

    /// CHECK: AccountInfo raw — vérifications manuelles dans le handler.
    #[account(
        mut,
        seeds = [b"game", player.key().as_ref()],
        bump,
    )]
    pub pda: AccountInfo<'info>,
    // magic_context et magic_program injectés par #[commit]
}

pub fn handler_close_game(ctx: Context<CloseGame>) -> Result<()> {
    let player_key = ctx.accounts.player.key();

    // ── Lecture + validation 
    let game = {
        let data = ctx.accounts.pda.try_borrow_data()?;
        let mut slice: &[u8] = &data;
        GameState::try_deserialize(&mut slice)?
    };

    require!(game.player == player_key, ErrorCode::NotGameOwner);
    require!(
        game.phase == GamePhase::Delegated
            || game.phase == GamePhase::Playing
            || game.phase == GamePhase::Finished,
        ErrorCode::InvalidState
    );
    require!(
        game.delegated_authority == player_key,
        ErrorCode::InvalidAuthority
    );

    msg!(
        "close_game pour {}: score={}, moves={}, over={} — MagicIntentBundleBuilder commit_and_undelegate",
        player_key,
        game.score,
        game.move_count,
        game.over,
    );

    // SDK 0.10 : MagicIntentBundleBuilder écrit uniquement dans magic_context
    // → aucun ExternalAccountDataModified
    MagicIntentBundleBuilder::new(
        ctx.accounts.player.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.pda.to_account_info()])
    .build_and_invoke()?;

    Ok(())
}
