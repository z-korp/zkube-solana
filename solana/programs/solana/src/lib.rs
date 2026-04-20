pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("CUXMJcSVjhFDKACZj6sPQesvhncpW2UKrS3YYnrSnbiQ");

#[program]
pub mod solana {
    use super::*;

    /// Crée une nouvelle partie + demande un aléatoire au VRF
    pub fn create_game(ctx: Context<CreateGame>) -> Result<()> {
        handler_create_game(ctx)
    }

    /// Callback appelé par l'oracle VRF — initialise la grille
    pub fn receive_randomness(ctx: Context<ReceiveRandomness>, randomness: [u8; 32]) -> Result<()> {
        handler_receive_randomness(ctx, randomness)
    }
}
