// logique de creation d'une partie avec Ephemeral VRF MagicBlock

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use crate::state::GamePhase;
use sha2::{Sha256, Digest};
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::consts::IDENTITY;
use ephemeral_vrf_sdk::types::SerializableAccountMeta;
use crate::state::{GameState, Treasury};
use crate::error::ErrorCode;

// ORACLE_QUEUE vient de crate::constants — modifier dans solana/.env et constants.rs

/// Les comptes nécessaires pour créer une partie
/// Après create_game, appeler delegate_game pour déléguer le GameState à l'ER
#[derive(Accounts)]
#[instruction(session_key: Pubkey)]
pub struct CreateGame<'info> {
    /// Le joueur qui crée la partie: il signe et paie
    #[account(mut)]
    pub player: Signer<'info>,

    /// Le compte GameState créé (ou réinitialisé) sur la blockchain
    /// PDA = adresse dérivée du mot "game" + clé publique du joueur + session_key
    #[account(
        init_if_needed,
        payer = player,
        space = GameState::SIZE,
        seeds = [b"game", player.key().as_ref(), session_key.as_ref()],
        bump
    )]
    pub game_state: Account<'info, GameState>,

    /// CHECK: La file d'attente des oracles VRF MagicBlock
    #[account(mut)]
    pub oracle_queue: AccountInfo<'info>,

    /// CHECK: Identity PDA de notre programme signé via invoke_signed
    #[account(
        seeds = [IDENTITY],
        bump
    )]
    pub identity: AccountInfo<'info>,

    /// CHECK: Le programme VRF MagicBlock
    pub vrf_program: AccountInfo<'info>,

    /// CHECK: Sysvar slot_hashes — requis par le VRF
    pub slot_hashes: AccountInfo<'info>,

    /// La treasury z-korp — reçoit le fee de création de partie
    #[account(
        mut,
        seeds = [b"treasury"],
        bump
    )]
    pub treasury: Account<'info, Treasury>,

    /// Programme système Solana requis pour créer un compte
    pub system_program: Program<'info, System>,
}

/// la logique de création de partie
/// session_key : keypair éphémère généré côté client — autorisé à signer make_move sans popup
pub fn handler_create_game(ctx: Context<CreateGame>, session_key: Pubkey) -> Result<()> {

    let game = &mut ctx.accounts.game_state;

    // Vérifie que l'oracle_queue est bien notre queue (définie dans constants.rs)
    let expected_queue: Pubkey = crate::ORACLE_QUEUE.parse().unwrap();
    require!(
        ctx.accounts.oracle_queue.key() == expected_queue,
        ErrorCode::InvalidOracleQueue
    );

    // Transfère le fee de création vers la treasury z-korp
    let fee = ctx.accounts.treasury.fee_per_game;
    if fee > 0 {
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.player.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            ),
            fee,
        )?;
        ctx.accounts.treasury.total_collected = ctx.accounts.treasury.total_collected.saturating_add(fee);
        msg!("Fee de {} lamports transféré à la treasury", fee);
    }

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
    // Champs ER — pas encore délégué au départ
    game.delegated = false;
    game.delegated_authority = Pubkey::default();
    game.phase = GamePhase::Created;
    // Session key : autorise le client à signer make_move sans popup
    game.session_key = session_key;

    // Seed de requête VRF = clé publique du joueur XOR slot actuel
    let clock = Clock::get()?;
    let caller_seed: [u8; 32] = {
        let mut seed = ctx.accounts.player.key().to_bytes();
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

    // PDA du game_state
    let (game_state_pda, _) = Pubkey::find_program_address(
        &[b"game", ctx.accounts.player.key().as_ref(), session_key.as_ref()],
        &crate::ID,
    );

    // Crée l'instruction VRF
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

    let identity_bump = ctx.bumps.identity;

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

    msg!("Partie créée, VRF demandé pour: {}", game.player);
    msg!("Appeler delegate_game ensuite pour déléguer à l'ER MagicBlock");
    Ok(())
}
