// logique de creation d'une partie avec Ephemeral VRF MagicBlock

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use sha2::{Sha256, Digest};
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::consts::IDENTITY;

/// Adresse de notre oracle queue déployée sur devnet (ephemeral-vrf fork)
const OUR_ORACLE_QUEUE: &str = "EZnAzWj1XgeQT5QdYQWXCF61k4JJajDnEMnGEZEd91MH";
use ephemeral_vrf_sdk::types::SerializableAccountMeta;
use crate::state::GameState;
use crate::error::ErrorCode;


/// Les comptes nécessaires pour créer une partie
#[derive(Accounts)]
pub struct CreateGame<'info> {
    /// Le joueur qui crée la partie: il signe et paie
    #[account(mut)]
    pub player: Signer<'info>,

    /// Le compte GameState créé (ou réinitialisé) sur la blockchain
    /// PDA = adresse dérivée du mot "game" + clé publique du joueur
    /// init_if_needed : crée le compte s'il n'existe pas, le réutilise s'il existe
    #[account(
        init_if_needed,
        payer = player,
        space = GameState::SIZE,
        seeds = [b"game", player.key().as_ref()],
        bump
    )]
    pub game_state: Account<'info, GameState>,

    /// CHECK: La file d'attente des oracles VRF MagicBlock
    #[account(mut)]
    pub oracle_queue: AccountInfo<'info>,

    /// CHECK: Identity PDA de notre programme signé via invoke_signed
    /// Dérivé de [b"identity"] et notre program ID
    /// Le programme VRF exige cette signature pour identifier le callback
    #[account(
        seeds = [IDENTITY],
        bump
    )]
    pub identity: AccountInfo<'info>,

    /// CHECK: Le programme VRF MagicBlock
    pub vrf_program: AccountInfo<'info>,

    /// CHECK: Sysvar slot_hashes — requis par le VRF pour générer l'aléatoire
    pub slot_hashes: AccountInfo<'info>,

    /// Programme système Solana requis pour créer un compte
    pub system_program: Program<'info, System>,
}

///la logique de création de partie
pub fn handler_create_game(ctx: Context<CreateGame>) -> Result<()> {

    let game = &mut ctx.accounts.game_state;

    // Vérifie que l'oracle_queue est bien notre queue déployée
    let expected_queue: Pubkey = OUR_ORACLE_QUEUE.parse().unwrap();
    require!(
        ctx.accounts.oracle_queue.key() == expected_queue,
        ErrorCode::InvalidOracleQueue
    );

    // Initialise les champs du GameState (grille vide en attendant le VRF)
    game.player = ctx.accounts.player.key();
    game.over = false;
    game.score = 0;
    game.combo_counter = 0;
    game.max_combo = 0;
    game.move_count = 0;
    game.blocks = [0u8; 80];
    game.next_row = [0u8; 8];
    game.seed = 0;

    // Seed de requête VRF = clé publique du joueur XOR slot actuel.
    // Le slot garantit l'unicité de chaque requête (l'oracle déduplique par caller_seed).
    // Sans nonce, deux parties consécutives du même joueur auraient le même caller_seed
    // et l'oracle ignorerait la seconde requête → grille vide.
    let clock = Clock::get()?;
    let caller_seed: [u8; 32] = {
        let mut seed = ctx.accounts.player.key().to_bytes();
        // XOR des 8 premiers octets avec le slot pour unicité
        let slot_bytes = clock.slot.to_le_bytes();
        for i in 0..8 {
            seed[i] ^= slot_bytes[i];
        }
        seed
    };

    // Discriminator du callback receive_randomness
    let mut hasher = Sha256::new();
    hasher.update(b"global:receive_randomness");
    let callback_discriminator = hasher.finalize()[..8].to_vec();

    // PDA du game_state remarque : l'oracle doit l'inclure quand il appelle receive_randomness
    let (game_state_pda, _) = Pubkey::find_program_address(
        &[b"game", ctx.accounts.player.key().as_ref()],
        &crate::ID,
    );

    // Crée l'instruction VRF
    // accounts_metas = comptes supplémentaires que l'oracle passera au callback
    // Sans ça l'oracle ne sait pas qu'il doit inclure game_state dans receive_randomness
    let ix = create_request_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.player.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator,
        caller_seed,
        accounts_metas: Some(vec![SerializableAccountMeta {
            pubkey: game_state_pda,
            is_writable: true,
            is_signer: false,
        }]),
        callback_args: None,
    });

    // Récupère le bump de l'identity PDA pour signer
    let identity_bump = ctx.bumps.identity;

    // invoke_signed car l'identity PDA (PDA de notre programme) doit signer
    // Ordre des comptes = ordre dans l'instruction VRF (instructions.rs du SDK):
    // 1. payer, 2. identity PDA, 3. oracle_queue, 4. system_program, 5. slot_hashes
    invoke_signed(
        &ix,
        &[
            ctx.accounts.player.to_account_info(),
            ctx.accounts.identity.to_account_info(),
            ctx.accounts.oracle_queue.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.slot_hashes.to_account_info(),
        ],
        &[&[IDENTITY, &[identity_bump]]],
    )?;

    msg!("Partie créée, aléatoire VRF demandé pour: {}", game.player);
    Ok(())
}
