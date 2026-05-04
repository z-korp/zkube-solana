// Ferme et réinitialise le compte game_state d'un joueur.
// Utilisé quand le compte existe avec un ancien layout (migration de struct).
// Le joueur récupère ses lamports et peut relancer create_game sur un compte vierge.

use anchor_lang::prelude::*;
use anchor_lang::AccountDeserialize;
use crate::state::GameState;
use crate::error::ErrorCode;

#[derive(Accounts)]
pub struct ResetGame<'info> {
    /// Le joueur — doit signer pour autoriser la fermeture de son propre compte
    #[account(mut)]
    pub player: Signer<'info>,

    /// CHECK: game_state du joueur — vérification manuelle.
    #[account(mut)]
    pub game_state: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler_reset_game(ctx: Context<ResetGame>) -> Result<()> {
    let game_state_info = ctx.accounts.game_state.to_account_info();
    let player_info     = ctx.accounts.player.to_account_info();

    if game_state_info.data_len() >= GameState::SIZE {
        let data = game_state_info.try_borrow_data()?;
        let mut slice: &[u8] = &data;
        if let Ok(game) = GameState::try_deserialize(&mut slice) {
            require!(game.player == ctx.accounts.player.key(), ErrorCode::NotGameOwner);
        }
    }

    // Rapatrier les lamports vers le joueur
    let lamports = game_state_info.lamports();
    **game_state_info.try_borrow_mut_lamports()? = 0;
    **player_info.try_borrow_mut_lamports()?    += lamports;

    // Mettre le data à zéro (marque le compte comme fermé pour le runtime)
    game_state_info.try_borrow_mut_data()?.fill(0);

    msg!(
        "game_state réinitialisé pour {} ({} lamports retournés)",
        ctx.accounts.player.key(),
        lamports,
    );
    Ok(())
}
