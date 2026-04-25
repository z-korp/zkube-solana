pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("7zdLjmcar3hQZoosNpgZ4JBmvbHzm8bxTBiBZCWrY2nN");

#[program]
pub mod solana {
    use super::*;

    /// Cree une nouvelle partie et demande un aléatoire au VRF
    /// session_key : keypair éphémère généré côté client, autorisé à signer make_move sans popup
    pub fn create_game(ctx: Context<CreateGame>, session_key: Pubkey) -> Result<()> {
        handler_create_game(ctx, session_key)
    }

    /// Callback appel par l'oracle VRF initialise la grille
    pub fn receive_randomness(ctx: Context<ReceiveRandomness>, randomness: [u8; 32]) -> Result<()> {
        handler_receive_randomness(ctx, randomness)
    }

    /// Joue un coup dplace les blocs calcule le score
    /// expected_move : verrou d'ordre (doit etre egal a game_state.move_count)
    pub fn make_move(ctx: Context<MakeMove>, row_index: u8, start_index: u8, final_index: u8, expected_move: u32) -> Result<()> {
        make_move::handler(ctx, row_index, start_index, final_index, expected_move)
    }

    /// Délègue le GameState à l'ER MagicBlock (après create_game + VRF)
    /// Mainnet → ensuite make_move va sur le RPC ER (gratuit, ~50ms)
    pub fn delegate_game(ctx: Context<DelegateGame>) -> Result<()> {
        handler_delegate_game(ctx)
    }

    /// Termine la partie : commit état final + undelegate vers mainnet
    /// Envoyé au RPC ER (devnet-eu.magicblock.app)
    pub fn close_game(ctx: Context<CloseGame>) -> Result<()> {
        handler_close_game(ctx)
    }

    /// Initialise la treasury z-korp (one-time, à appeler au déploiement)
    pub fn initialize_treasury(ctx: Context<InitializeTreasury>, fee_per_game: u64) -> Result<()> {
        handler_initialize_treasury(ctx, fee_per_game)
    }

    /// Retire des fonds de la treasury vers un wallet destinataire
    /// Seule l'authority peut appeler cette instruction
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        handler_withdraw(ctx, amount)
    }

    /// Met à jour la session_key autorisée à signer make_move.
    /// Envoyé au RPC ER — utile pour la reconnexion mid-game (nouvelle session_key).
    pub fn set_session_key(ctx: Context<SetSessionKey>, new_session_key: Pubkey) -> Result<()> {
        handler_set_session_key(ctx, new_session_key)
    }

    /// Ferme et réinitialise le compte game_state (migration / compte corrompu).
    /// Le joueur récupère ses lamports et peut relancer create_game.
    pub fn reset_game(ctx: Context<ResetGame>) -> Result<()> {
        handler_reset_game(ctx)
    }
}
