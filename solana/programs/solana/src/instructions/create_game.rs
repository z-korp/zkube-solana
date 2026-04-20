// logique de creation d'une partie avec Ephemeral VRF MagicBlock

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use sha2::{Sha256, Digest}; /// pour calculer le discriminator ( id du callback)
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::consts::DEFAULT_QUEUE; // l@ de l'oracle magicblock sur devnet TODO: a completer 
use crate::state::GameState;
use crate::error::ErrorCode;


/// Les comptes nécessaires pour créer une partie
/// Équivalent du create_run dans game_system Cairo
#[derive(Accounts)]
pub struct CreateGame<'info> {
    /// Le joueur qui crée la partie: il signe et paie
    #[account(mut)]
    pub player: Signer<'info>,

    /// Le compte GameState créé sur la blockchain
    /// PDA = adresse dérivée du mot "game" + clé publique du joueur
    /// Garantit qu'un joueur ne peut avoir qu'une seule partie à la fois
    #[account(
        init,
        payer = player,
        space = GameState::SIZE,
        seeds = [b"game", player.key().as_ref()],
        bump
    )]
    pub game_state: Account<'info, GameState>, // le compte creer sur la blockchain 

    /// La file d'attente des oracles VRF MagicBlock
    ///CHECK: adresse vérifiée via la constante DEFAULT_QUEUE du SDK
    #[account(mut)]
    pub oracle_queue: AccountInfo<'info>,

    /// Le programme VRF MagicBlock
    ///CHECK: adresse vérifiée via la constante VRF_PROGRAM_ID du SDK
    pub vrf_program: AccountInfo<'info>,

    /// Programme système Solana requis pour créer un compte
    pub system_program: Program<'info, System>,
}

/// THE MOST IMPORTANT PART
/// Handler: la logique de création de partie
pub fn handler_create_game(ctx: Context<CreateGame>) -> Result<()> {
  
    let game = &mut ctx.accounts.game_state;

    // Vérifie que l'oracle_queue est bien celui de MagicBlock
    require!(
        ctx.accounts.oracle_queue.key() == DEFAULT_QUEUE,
        ErrorCode::InvalidOracleQueue
    );

    let clock = Clock::get()?;

    // Initialise les champs du GameState
    // La grille reste vide (blocks = 0) jusqu'à la réponse du VRF
    game.player = ctx.accounts.player.key();
    game.over = false;
    game.score = 0;
    game.combo_counter = 0;
    game.max_combo = 0;
    game.move_count = 0;
    game.blocks = [0u8; 80]; // grille vide sera rempli par receive randomness
    game.next_row = [0u8; 8];
    game.seed = 0; // sera remplacé par le vrai aléatoire VRF

    // Seed unique pour cette requête VRF
    // Combinaison de la clé du joueur + slot actuel = toujours unique
    let caller_seed: [u8; 32] = {
        let mut seed = [0u8; 32];
        let player_bytes = ctx.accounts.player.key().to_bytes();
        seed[..32].copy_from_slice(&player_bytes);
        // XOR avec le slot pour garantir l'unicité même si le joueur rejou
        seed[0] ^= (clock.slot & 0xFF) as u8;
        seed
    };

    // Discriminator de receive_randomness
    // = premiers 8 octets de SHA256("global:receive_randomness")
    // C'est ainsi qu'Anchor identifie quelle instruction appeler en callback
    let mut hasher = Sha256::new();
    hasher.update(b"global:receive_randomness");
    let callback_discriminator = hasher.finalize()[..8].to_vec();

    // Demande le vrai aléatoire au programme VRF MagicBlock
    // Quand l'oracle répond, il appellera automatiquement receive_randomness
    let ix = create_request_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.player.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID, // notre programme 
        callback_discriminator,
        caller_seed,
        accounts_metas: None,
        callback_args: None,
    });

    invoke(
        &ix,
        &[
            ctx.accounts.player.to_account_info(),
            ctx.accounts.oracle_queue.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.vrf_program.to_account_info(),
        ],
    )?;

    msg!("Partie créée, aléatoire VRF demandé pour: {}", game.player);
    Ok(())
}
