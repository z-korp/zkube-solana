// Termine la partie : commit état final + undelegate vers mainnet.
// DOIT être envoyé au RPC ER (devnet-eu.magicblock.app).
//
// Build : anchor build  (une seule version — plus de feature flags)
//
// Permet deux cas :
//   - game_over (game.over == true) : partie terminée normalement
//   - quit      (game.over == false) : le joueur quitte en cours de partie

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;
use crate::state::{GameState, GamePhase};
use crate::error::ErrorCode;

const DELEGATION_PROGRAM_ID: &str = "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh";
const MAGIC_PROGRAM_ID: &str      = "Magic11111111111111111111111111111111111111";
const MAGIC_CONTEXT_ID: &str      = "MagicContext1111111111111111111111111111111";

/// Vérifie que le compte est bien délégué à l'Ephemeral Rollup
fn is_delegated(account: &AccountInfo) -> bool {
    let delegation_program: Pubkey = DELEGATION_PROGRAM_ID.parse().unwrap();
    account.owner == &delegation_program
}

/// Comptes pour fermer la partie (commit + undelegate depuis l'ER).
/// magic_context et magic_program sont requis par commit_and_undelegate_accounts.
#[derive(Accounts)]
pub struct CloseGame<'info> {
    /// Le joueur réel qui ferme sa partie (signe depuis Phantom — 1 popup)
    #[account(mut)]
    pub player: Signer<'info>,

    /// GameState à committer et undelegater.
    /// Seeds sur player.key() — le joueur réel signe toujours close_game.
    #[account(
        mut,
        seeds = [b"game", player.key().as_ref()],
        bump,
        constraint = game_state.player == player.key() @ ErrorCode::NotGameOwner,
    )]
    pub game_state: Account<'info, GameState>,

    /// CHECK: Compte magic_context requis par commit_and_undelegate_accounts
    #[account(mut)]
    pub magic_context: AccountInfo<'info>,

    /// CHECK: Programme MagicBlock ER
    pub magic_program: AccountInfo<'info>,
}

pub fn handler_close_game(ctx: Context<CloseGame>) -> Result<()> {
    // 1. Runtime check : le compte doit être délégué sur l'ER
    require!(
        is_delegated(&ctx.accounts.game_state.to_account_info()),
        ErrorCode::NotDelegated
    );

    // 2. Business check : flag délégué dans l'état
    require!(
        ctx.accounts.game_state.delegated,
        ErrorCode::NotDelegated
    );

    // 3. Phase valide : Delegated (aucun move joué) ou Playing (mid-game ou game over)
    require!(
        ctx.accounts.game_state.phase == GamePhase::Delegated
            || ctx.accounts.game_state.phase == GamePhase::Playing,
        ErrorCode::InvalidState
    );

    // 4. Authority : le joueur qui ferme est bien celui qui a délégué
    require!(
        ctx.accounts.game_state.delegated_authority == ctx.accounts.player.key(),
        ErrorCode::InvalidAuthority
    );

    // 5. Validation des comptes MagicBlock (anti-spoofing CPI)
    let expected_magic_program: Pubkey = MAGIC_PROGRAM_ID.parse().unwrap();
    require!(
        ctx.accounts.magic_program.key() == expected_magic_program,
        ErrorCode::InvalidMagicProgram
    );
    let expected_magic_context: Pubkey = MAGIC_CONTEXT_ID.parse().unwrap();
    require!(
        ctx.accounts.magic_context.key() == expected_magic_context,
        ErrorCode::InvalidMagicContext
    );

    // ── Transitions d'état AVANT le commit ───────────────────────────────────
    // Ces valeurs seront commitées sur mainnet par commit_and_undelegate_accounts.
    ctx.accounts.game_state.phase     = GamePhase::Finished;
    ctx.accounts.game_state.delegated = false;

    msg!(
        "Partie fermée pour {}, score: {}, moves: {}, over: {} — commit + undelegate",
        ctx.accounts.player.key(),
        ctx.accounts.game_state.score,
        ctx.accounts.game_state.move_count,
        ctx.accounts.game_state.over,
    );

    // ── Commit + undelegate depuis l'ER vers mainnet ──────────────────────────
    commit_and_undelegate_accounts(
        &ctx.accounts.player,
        vec![&ctx.accounts.game_state.to_account_info()],
        &ctx.accounts.magic_context,
        &ctx.accounts.magic_program,
    )?;

    Ok(())
}
