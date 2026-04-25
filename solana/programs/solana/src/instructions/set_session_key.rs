// Permet au joueur de mettre à jour la session_key de sa partie.
//
// Cas d'usage principal : reconnexion en cours de partie.
// Si le joueur ferme l'onglet, la session_key éphémère est perdue (mémoire).
// Il génère un nouveau keypair côté client et appelle set_session_key (1 popup)
// pour ré-autoriser le nouveau keypair — le jeu peut alors reprendre sans popup.
//
// Cette instruction est envoyée au RPC ER (le compte est délégué).

use anchor_lang::prelude::*;
use crate::state::{GameState, GamePhase};
use crate::error::ErrorCode;

#[derive(Accounts)]
pub struct SetSessionKey<'info> {
    /// Le joueur réel — seul lui peut modifier la session_key.
    pub player: Signer<'info>,

    /// Le GameState du joueur sur l'ER.
    /// PDA dérivée de game_state.player (même pattern que make_move).
    #[account(
        mut,
        seeds = [b"game", game_state.player.as_ref()],
        bump,
        constraint = game_state.player == player.key() @ ErrorCode::NotGameOwner,
        constraint = game_state.delegated @ ErrorCode::NotDelegated,
        constraint = (game_state.phase == GamePhase::Delegated
            || game_state.phase == GamePhase::Playing) @ ErrorCode::InvalidState,
    )]
    pub game_state: Account<'info, GameState>,
}

/// Remplace la session_key autorisée pour make_move.
/// @param new_session_key : pubkey du nouveau keypair éphémère généré côté client.
pub fn handler_set_session_key(ctx: Context<SetSessionKey>, new_session_key: Pubkey) -> Result<()> {
    ctx.accounts.game_state.session_key = new_session_key;
    msg!(
        "session_key mise à jour pour {} → {}",
        ctx.accounts.player.key(),
        new_session_key,
    );
    Ok(())
}
