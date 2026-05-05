pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;
pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("7zdLjmcar3hQZoosNpgZ4JBmvbHzm8bxTBiBZCWrY2nN");

#[ephemeral]
#[program]
pub mod solana {
    use super::*;

    /// Cree une nouvelle partie et demande un aléatoire au VRF
    pub fn create_game(ctx: Context<CreateGame>, session_key: Pubkey) -> Result<()> {
        handler_create_game(ctx, session_key)
    }

    /// Callback appel par l'oracle VRF — initialise la grille
    pub fn receive_randomness(ctx: Context<ReceiveRandomness>, randomness: [u8; 32]) -> Result<()> {
        handler_receive_randomness(ctx, randomness)
    }

    /// Joue un coup — expected_move : verrou d'ordre anti-replay
    pub fn make_move(ctx: Context<MakeMove>, row_index: u8, start_index: u8, final_index: u8, expected_move: u32) -> Result<()> {
        make_move::handler(ctx, row_index, start_index, final_index, expected_move)
    }

    /// Délègue le GameState à l'ER MagicBlock
    pub fn delegate_game(ctx: Context<DelegateGame>) -> Result<()> {
        handler_delegate_game(ctx)
    }

    /// Termine la partie : commit + undelegate vers mainnet
    pub fn close_game(ctx: Context<CloseGame>) -> Result<()> {
        handler_close_game(ctx)
    }

    /// Initialise la treasury z-korp (one-time)
    pub fn initialize_treasury(ctx: Context<InitializeTreasury>, fee_per_game: u64) -> Result<()> {
        handler_initialize_treasury(ctx, fee_per_game)
    }

    /// Retire des fonds de la treasury
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        handler_withdraw(ctx, amount)
    }

    /// Met à jour la session_key autorisée à signer make_move
    pub fn set_session_key(ctx: Context<SetSessionKey>, new_session_key: Pubkey) -> Result<()> {
        handler_set_session_key(ctx, new_session_key)
    }

    /// Ferme et réinitialise le compte game_state (migration / compte corrompu)
    pub fn reset_game(ctx: Context<ResetGame>) -> Result<()> {
        handler_reset_game(ctx)
    }

    // ── Tournoi ───────────────────────────────────────────────────────────────

    /// Crée un nouveau tournoi — réservé à l'authority zKorp
    pub fn create_tournament(ctx: Context<CreateTournament>, tournament_id: u32) -> Result<()> {
        handler_create_tournament(ctx, tournament_id)
    }

    /// Première inscription au tournoi — paie l'entry fee (0.1 SOL)
    pub fn join_tournament(ctx: Context<JoinTournament>, tournament_id: u32) -> Result<()> {
        handler_join_tournament(ctx, tournament_id)
    }

    /// Replay — paie à nouveau l'entry fee pour une nouvelle tentative
    pub fn rejoin_tournament(ctx: Context<RejoinTournament>, tournament_id: u32) -> Result<()> {
        handler_rejoin_tournament(ctx, tournament_id)
    }

    /// Soumet le score de la partie terminée (garde le meilleur score)
    pub fn submit_tournament_score(ctx: Context<SubmitTournamentScore>, tournament_id: u32) -> Result<()> {
        handler_submit_tournament_score(ctx, tournament_id)
    }

    /// Calcule le top 3 et stocke les résultats — permissionless après end_time
    pub fn settle_tournament(ctx: Context<SettleTournament>, tournament_id: u32) -> Result<()> {
        handler_settle_tournament(ctx, tournament_id)
    }

    /// Le joueur gagnant réclame son prize — il signe lui-même
    pub fn claim_prize(ctx: Context<ClaimPrize>, tournament_id: u32) -> Result<()> {
        handler_claim_prize(ctx, tournament_id)
    }
}
