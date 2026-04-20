// Ferme le compte GameState et rembourse le loyer au joueur
// Utile pour: réinitialiser une partie, récupérer le SOL bloqué

use anchor_lang::prelude::*;
use crate::state::GameState;
use crate::error::ErrorCode;

#[derive(Accounts)]
pub struct CloseGame<'info> {
    /// Le joueur doit être le propriétaire de la partie
    #[account(mut)]
    pub player: Signer<'info>,

    /// Le compte GameState à fermer
    /// `close = player` transfère les lamports au joueur et ferme le compte
    #[account(
        mut,
        close = player,
        seeds = [b"game", player.key().as_ref()],
        bump,
        constraint = game_state.player == player.key() @ ErrorCode::NotGameOwner,
    )]
    pub game_state: Account<'info, GameState>,
}

pub fn handler_close_game(ctx: Context<CloseGame>) -> Result<()> {
    msg!("Partie fermée pour: {}", ctx.accounts.player.key());
    Ok(())
}
