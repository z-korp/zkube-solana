pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("8vB8kAAsuxLGejEweuJRdnAAe5wuUFTdt2fRQjeqvC6v");

#[program]
pub mod solana {
    use super::*;

    /// Cree une nouvelle partie et demande un aléatoire au VRF
    pub fn create_game(ctx: Context<CreateGame>) -> Result<()> {
        handler_create_game(ctx)
    }

    /// Callback appel par l'oracle VRF initialise la grille
    pub fn receive_randomness(ctx: Context<ReceiveRandomness>, randomness: [u8; 32]) -> Result<()> {
        handler_receive_randomness(ctx, randomness)
    }

    /// Joue un coup dplace les blocs calcule le score
    pub fn make_move(ctx: Context<MakeMove>, row_index: u8, start_index: u8, final_index: u8) -> Result<()> {
        make_move::handler(ctx, row_index, start_index, final_index)
    }

    /// Ferme la partie 
    pub fn close_game(ctx: Context<CloseGame>) -> Result<()> {
        handler_close_game(ctx)
    }
}
