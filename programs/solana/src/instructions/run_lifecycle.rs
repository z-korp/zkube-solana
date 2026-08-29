//! MagicBlock run delegation, VRF, play, copyback, and durable cleanup.
//!
//! `ActiveRun` is authoritative on the Router-resolved ER only while delegated.
//! Terminal state is timestamped by the action that reaches it, then committed
//! and copied back before a Solana-base
//! consumer may update durable progression. That same instruction closes the
//! single transient account and returns rent only to the owner's canonical
//! System-owned funding PDA.

use anchor_lang::{prelude::*, Discriminator};
use ephemeral_rollups_sdk::anchor::{commit, delegate};
use ephemeral_rollups_sdk::anchor::{vrf, vrf_callback};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};

use crate::error::ErrorCode;
use crate::game::{
    opening_from_vrf, reroll_row_from_vrf, row_from_vrf, sha256v, BlockWeights, Bonus, Constraint,
    ConstraintKind, Grid, LevelRules, MoveReport, MutatorRules, RunEngine, RunError, RunPhase,
};
use crate::instructions::player_authorization::{
    require_player_authorization, require_player_rent_payer,
};
use crate::state::arcade::SolanaSha256;
use crate::state::protocol::*;

#[delegate]
#[derive(Accounts)]
pub struct DelegateActiveRun<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Immutable durable player identity, constrained by ActiveRun.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
    /// CHECK: Deserialized and matched to the owner, run id, and PDA in the handler.
    #[account(mut, owner = crate::ID, del)]
    pub pda: UncheckedAccount<'info>,
}

pub fn handler_delegate_active_run(ctx: Context<DelegateActiveRun>) -> Result<()> {
    let owner = ctx.accounts.owner_authority.key();
    require_player_authorization(
        owner,
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    require_player_rent_payer(owner, ctx.accounts.actor.key(), ctx.accounts.payer.key())?;
    let run_id = {
        let mut data = ctx.accounts.pda.try_borrow_mut_data()?;
        require!(
            data.len() == 8 + ActiveRun::INIT_SPACE,
            ErrorCode::InvalidVersion
        );
        let mut active = ActiveRun::try_deserialize(&mut data.as_ref())?;
        require!(active.version == ACCOUNT_VERSION, ErrorCode::InvalidVersion);
        require_keys_eq!(active.owner, owner, ErrorCode::Unauthorized);
        require!(
            active.lifecycle == RunLifecycle::Prepared,
            ErrorCode::InvalidState
        );
        let run_id = active.run_id;
        let expected = Pubkey::find_program_address(
            &[
                ACTIVE_RUN_SEED,
                b"active",
                owner.as_ref(),
                &run_id.to_le_bytes(),
            ],
            &crate::ID,
        )
        .0;
        require_keys_eq!(ctx.accounts.pda.key(), expected, ErrorCode::InvalidRunId);
        active.lifecycle = RunLifecycle::Delegated;
        let mut writer = std::io::Cursor::new(&mut data[..]);
        active.try_serialize(&mut writer)?;
        run_id
    };

    ctx.accounts.delegate_pda(
        &ctx.accounts.payer,
        &[
            ACTIVE_RUN_SEED,
            b"active",
            owner.as_ref(),
            &run_id.to_le_bytes(),
        ],
        DelegateConfig {
            validator: ctx.remaining_accounts.first().map(|account| account.key()),
            ..Default::default()
        },
    )?;
    Ok(())
}

#[vrf]
#[derive(Accounts, Session)]
pub struct RequestRowVrf<'info> {
    #[account(
        mut,
        owner = crate::ID,
        constraint = active_run.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub active_run: Box<Account<'info, ActiveRun>>,
    /// CHECK: Logical wallet authority, bound to the active run.
    #[account(address = active_run.owner @ ErrorCode::Unauthorized)]
    pub owner_authority: UncheckedAccount<'info>,
    #[session(signer = actor, authority = owner_authority.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    #[account(mut)]
    pub actor: Signer<'info>,
    /// CHECK: Address-constrained to MagicBlock's devnet ER queue.
    #[account(mut, address = ephemeral_rollups_sdk::vrf::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
    /// CHECK: Address/owner constrained; the handler validates the SDK record before use.
    #[account(
        address = ephemeral_rollups_sdk::pda::delegation_record_pda_from_delegated_account(&active_run.key().to_bytes().into()).to_bytes().into(),
        owner = Pubkey::new_from_array(ephemeral_rollups_sdk::id().to_bytes()) @ ErrorCode::InvalidMagicProgram
    )]
    pub delegation_record_active: UncheckedAccount<'info>,
}

impl<'info> RequestRowVrf<'info> {
    pub(crate) fn invoke_vrf_request<'a>(
        &self,
        payer: &'a AccountInfo<'info>,
        ix: &ephemeral_rollups_sdk::vrf::compat::Instruction,
    ) -> std::result::Result<(), anchor_lang::solana_program::program_error::ProgramError> {
        self.invoke_signed_vrf(payer, ix)
    }
}

fn prepare_row_vrf_request(
    active: &mut ActiveRun,
    active_key: Pubkey,
    actor: Pubkey,
    oracle_queue: Pubkey,
    validator: Pubkey,
    client_seed: [u8; 32],
) -> Result<ephemeral_rollups_sdk::vrf::compat::Instruction> {
    use ephemeral_rollups_sdk::consts::{MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID};
    use ephemeral_rollups_sdk::vrf::instructions::{
        create_request_high_priority_scoped_randomness_ix, RequestRandomnessParams,
    };
    use ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta;

    require!(
        vrf_request_lifecycle_is_allowed(active.lifecycle),
        ErrorCode::InvalidState
    );
    require!(
        active.pending_vrf_counter == 0,
        ErrorCode::VrfRequestPending
    );

    let request_counter = active
        .vrf_request_counter
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    active.vrf_request_counter = request_counter;
    active.pending_vrf_counter = request_counter;
    active.lifecycle = RunLifecycle::AwaitingVrf;

    let (magic_fee_vault, _) = Pubkey::find_program_address(
        &[b"magic-fee-vault", validator.as_ref()],
        &Pubkey::new_from_array(ephemeral_rollups_sdk::id().to_bytes()),
    );
    let run_id = active.run_id.to_le_bytes();
    let request = request_counter.to_le_bytes();
    let caller_seed = sha256v(&[
        b"zkube-row-vrf-v2",
        &client_seed,
        &run_id,
        &request,
        &active.rules_hash,
    ]);

    Ok(create_request_high_priority_scoped_randomness_ix(
        RequestRandomnessParams {
            payer: actor.to_bytes().into(),
            oracle_queue: oracle_queue.to_bytes().into(),
            callback_program_id: crate::ID.to_bytes().into(),
            callback_discriminator: crate::instruction::FulfillRowVrf::DISCRIMINATOR.to_vec(),
            caller_seed,
            accounts_metas: Some(vec![
                SerializableAccountMeta {
                    pubkey: active_key.to_bytes().into(),
                    is_signer: false,
                    is_writable: true,
                },
                SerializableAccountMeta {
                    pubkey: magic_fee_vault.to_bytes().into(),
                    is_signer: false,
                    is_writable: true,
                },
                SerializableAccountMeta {
                    pubkey: MAGIC_PROGRAM_ID,
                    is_signer: false,
                    is_writable: false,
                },
                SerializableAccountMeta {
                    pubkey: MAGIC_CONTEXT_ID,
                    is_signer: false,
                    is_writable: true,
                },
            ]),
            // Bind the asynchronous callback to the exact pending request. A
            // delayed result from an older request must never fulfill a newer
            // row transition on the same ActiveRun.
            callback_args: Some(request_counter.to_le_bytes().to_vec()),
        },
    ))
}

#[session_auth_or(
    ctx.accounts.active_run.owner == ctx.accounts.actor.key(),
    SessionError::InvalidToken
)]
pub fn handler_request_row_vrf(ctx: Context<RequestRowVrf>, client_seed: [u8; 32]) -> Result<()> {
    require_player_authorization(
        ctx.accounts.active_run.owner,
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    require_before_arcade_deadline(&ctx.accounts.active_run, Clock::get()?.unix_timestamp)?;
    let validator =
        delegation_record_validator(&ctx.accounts.delegation_record_active.try_borrow_data()?)?;
    let active_key = ctx.accounts.active_run.key();
    let ix = prepare_row_vrf_request(
        &mut ctx.accounts.active_run,
        active_key,
        ctx.accounts.actor.key(),
        ctx.accounts.oracle_queue.key(),
        validator,
        client_seed,
    )?;
    ctx.accounts
        .invoke_vrf_request(&ctx.accounts.actor.to_account_info(), &ix)?;
    Ok(())
}

#[vrf_callback]
#[derive(Accounts)]
pub struct FulfillRowVrf<'info> {
    #[account(
        mut,
        owner = crate::ID,
        constraint = active_run.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub active_run: Account<'info, ActiveRun>,
    /// CHECK: MagicBlock's validator-scoped ER callback fee vault. This is
    /// protocol infrastructure for gasless ER VRF and is unrelated to the
    /// owner's base-layer player funding PDA.
    #[account(mut)]
    pub magic_fee_vault: UncheckedAccount<'info>,
}

pub fn handler_fulfill_row_vrf(
    ctx: Context<FulfillRowVrf>,
    randomness: [u8; 32],
    expected_request_counter: u32,
) -> Result<()> {
    let active = &mut ctx.accounts.active_run;
    require_before_arcade_deadline(active, Clock::get()?.unix_timestamp)?;
    require!(
        vrf_fulfillment_lifecycle_is_allowed(active.lifecycle),
        ErrorCode::InvalidState
    );
    let request_counter = active.pending_vrf_counter;
    require_matching_vrf_callback(request_counter, expected_request_counter)?;
    let row_weights = generation_weights(active);
    let mut engine = engine_from_active(active)?;
    engine.phase = RunPhase::AwaitingVrf;
    let opening = request_counter == 1;
    provide_verified_vrf_rows(
        &mut engine,
        randomness,
        request_counter,
        active.rules_hash,
        BlockWeights {
            values: row_weights,
        },
        opening,
    )?;
    fold_replay_event(
        active,
        zkube_core::ReplayEvent::Vrf {
            request_counter,
            output: randomness,
        },
    );
    write_engine(active, &engine);
    active.pending_vrf_counter = 0;
    active.lifecycle = lifecycle_from_phase(engine.phase);
    Ok(())
}

/// Select the weights for the row being fulfilled now. Daily accounting
/// advances `current_difficulty` before it enqueues the next VRF request, so a
/// threshold-crossing action immediately affects the next unseen row. Campaign
/// runs keep their authored level snapshot for their full lifetime.
fn generation_weights(active: &ActiveRun) -> [u16; 5] {
    let tier = if active.mode == RunMode::Daily {
        active.current_difficulty
    } else {
        active.rules.difficulty
    };
    zkube_core::TIER_BLOCK_WEIGHTS[usize::from(tier.min(7))]
}

fn provide_verified_vrf_rows(
    engine: &mut RunEngine,
    randomness: [u8; 32],
    request_counter: u32,
    rules_hash: [u8; 32],
    weights: BlockWeights,
    opening: bool,
) -> Result<u8> {
    if opening {
        let height = engine.starting_height_target;
        let layout = opening_from_vrf(randomness, request_counter, rules_hash, height, weights)
            .map_err(|_| error!(ErrorCode::InvalidBlockWeights))?;
        engine.grid = layout.grid;
        engine.next_row = Some(layout.preview);
        engine.starting_height_target = 0;
        engine.phase = RunPhase::Playing;
        return Ok(height.saturating_add(1));
    }

    // A pending reroll is the one fulfillment that arrives while a preview is
    // still visible — every other request follows a consumed preview — and it
    // draws from its own committed domain, never the ordinary row stream.
    if engine.reroll_pending() {
        let row = reroll_row_from_vrf(randomness, request_counter, rules_hash, weights)
            .map_err(|_| error!(ErrorCode::InvalidBlockWeights))?;
        engine.provide_reroll_row(row).map_err(map_run_error)?;
        return Ok(1);
    }

    // Clearing the board consumes the old preview as the action's inserted
    // row. One subsequent VRF must therefore provide both a new seed row and
    // an independent visible preview, or the run would remain AwaitingVrf
    // with no pending request. The shared core fixes the derivation schedule.
    if engine.grid == Grid::EMPTY {
        let layout = zkube_core::continuation_from_vrf_with::<SolanaSha256>(
            randomness,
            request_counter,
            rules_hash,
            weights,
        )
        .map_err(|_| error!(ErrorCode::InvalidBlockWeights))?;
        engine.grid = layout.grid;
        engine.next_row = Some(layout.preview);
        engine.phase = RunPhase::Playing;
        return Ok(2);
    }

    let row = row_from_vrf(randomness, request_counter, weights)
        .map_err(|_| error!(ErrorCode::InvalidBlockWeights))?;
    engine.provide_vrf_row(row).map_err(map_run_error)?;
    Ok(1)
}

#[vrf]
#[derive(Accounts, Session)]
pub struct PlayMove<'info> {
    #[account(
        mut,
        owner = crate::ID,
        constraint = active_run.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub active_run: Box<Account<'info, ActiveRun>>,
    /// CHECK: Logical wallet authority, bound to the active run.
    #[account(address = active_run.owner @ ErrorCode::Unauthorized)]
    pub owner_authority: UncheckedAccount<'info>,
    #[session(signer = actor, authority = owner_authority.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    #[account(mut)]
    pub actor: Signer<'info>,
    /// CHECK: Address-constrained to MagicBlock's delegated ER queue.
    #[account(mut, address = ephemeral_rollups_sdk::vrf::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
    /// CHECK: Address/owner constrained and SDK-decoded before requesting VRF.
    #[account(
        address = ephemeral_rollups_sdk::pda::delegation_record_pda_from_delegated_account(&active_run.key().to_bytes().into()).to_bytes().into(),
        owner = Pubkey::new_from_array(ephemeral_rollups_sdk::id().to_bytes()) @ ErrorCode::InvalidMagicProgram
    )]
    pub delegation_record_active: UncheckedAccount<'info>,
}

impl<'info> PlayMove<'info> {
    fn invoke_vrf_request<'a>(
        &self,
        payer: &'a AccountInfo<'info>,
        ix: &ephemeral_rollups_sdk::vrf::compat::Instruction,
    ) -> std::result::Result<(), anchor_lang::solana_program::program_error::ProgramError> {
        self.invoke_signed_vrf(payer, ix)
    }
}

#[session_auth_or(
    ctx.accounts.active_run.owner == ctx.accounts.actor.key(),
    SessionError::InvalidToken
)]
pub fn handler_play_move(
    ctx: Context<PlayMove>,
    expected_action: u32,
    expected_move: u16,
    row: u8,
    start: u8,
    destination: u8,
    client_seed: [u8; 32],
) -> Result<()> {
    require_player_authorization(
        ctx.accounts.active_run.owner,
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    require!(
        ctx.accounts.active_run.lifecycle == RunLifecycle::Playing,
        ErrorCode::InvalidState
    );
    let active = &mut ctx.accounts.active_run;
    require_before_arcade_deadline(active, Clock::get()?.unix_timestamp)?;
    require!(
        active.action_counter == expected_action,
        ErrorCode::InvalidMoveOrder
    );
    let level = level_rules(&active.rules)?;
    let difficulty_at_action = active.current_difficulty;
    let (mutator, pressure_multiplier_x100) = action_mutator(active)?;
    let combo_before = active.combo_counter;
    let mut engine = engine_from_active(active)?;
    let mut report = engine
        .play_move(
            expected_move,
            row,
            start,
            destination,
            level,
            mutator,
            pressure_multiplier_x100,
        )
        .map_err(map_run_error)?;
    fold_replay_event(
        active,
        zkube_core::ReplayEvent::Move {
            action: expected_action,
            expected_move,
            row,
            start,
            destination,
        },
    );
    report.difficulty_at_action = difficulty_at_action;
    let terminal_at = terminal_action_timestamp(engine.phase)?;
    record_action_accounting(
        active,
        &engine,
        &report,
        combo_before,
        ActionKind::Move,
        terminal_at,
    )?;
    if action_needs_row_vrf(active.lifecycle) {
        let validator =
            delegation_record_validator(&ctx.accounts.delegation_record_active.try_borrow_data()?)?;
        let active_key = active.key();
        let ix = prepare_row_vrf_request(
            active,
            active_key,
            ctx.accounts.actor.key(),
            ctx.accounts.oracle_queue.key(),
            validator,
            client_seed,
        )?;
        ctx.accounts
            .invoke_vrf_request(&ctx.accounts.actor.to_account_info(), &ix)?;
    }
    Ok(())
}

#[vrf]
#[derive(Accounts, Session)]
pub struct ApplyBonus<'info> {
    #[account(
        mut,
        owner = crate::ID,
        constraint = active_run.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub active_run: Box<Account<'info, ActiveRun>>,
    /// CHECK: Logical wallet authority, bound to the active run.
    #[account(address = active_run.owner @ ErrorCode::Unauthorized)]
    pub owner_authority: UncheckedAccount<'info>,
    #[session(signer = actor, authority = owner_authority.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    #[account(mut)]
    pub actor: Signer<'info>,
    /// CHECK: Address-constrained to MagicBlock's delegated ER queue.
    #[account(mut, address = ephemeral_rollups_sdk::vrf::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
    /// CHECK: Address/owner constrained and SDK-decoded before requesting VRF.
    #[account(
        address = ephemeral_rollups_sdk::pda::delegation_record_pda_from_delegated_account(&active_run.key().to_bytes().into()).to_bytes().into(),
        owner = Pubkey::new_from_array(ephemeral_rollups_sdk::id().to_bytes()) @ ErrorCode::InvalidMagicProgram
    )]
    pub delegation_record_active: UncheckedAccount<'info>,
}

impl<'info> ApplyBonus<'info> {
    fn invoke_vrf_request<'a>(
        &self,
        payer: &'a AccountInfo<'info>,
        ix: &ephemeral_rollups_sdk::vrf::compat::Instruction,
    ) -> std::result::Result<(), anchor_lang::solana_program::program_error::ProgramError> {
        self.invoke_signed_vrf(payer, ix)
    }
}

#[session_auth_or(
    ctx.accounts.active_run.owner == ctx.accounts.actor.key(),
    SessionError::InvalidToken
)]
pub fn handler_apply_bonus(
    ctx: Context<ApplyBonus>,
    expected_action: u32,
    row: u8,
    column: u8,
    client_seed: [u8; 32],
) -> Result<()> {
    require_player_authorization(
        ctx.accounts.active_run.owner,
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    require!(
        ctx.accounts.active_run.lifecycle == RunLifecycle::Playing,
        ErrorCode::InvalidState
    );
    let active = &mut ctx.accounts.active_run;
    require_before_arcade_deadline(active, Clock::get()?.unix_timestamp)?;
    require!(
        active.action_counter == expected_action,
        ErrorCode::InvalidMoveOrder
    );
    let level = level_rules(&active.rules)?;
    let difficulty_at_action = active.current_difficulty;
    let (mutator, pressure_multiplier_x100) = action_mutator(active)?;
    let combo_before = active.combo_counter;
    let mut engine = engine_from_active(active)?;
    let mut report = engine
        .apply_bonus(row, column, level, mutator, pressure_multiplier_x100)
        .map_err(map_run_error)?;
    fold_replay_event(
        active,
        zkube_core::ReplayEvent::Bonus {
            action: expected_action,
            row,
            column,
        },
    );
    report.difficulty_at_action = difficulty_at_action;
    let terminal_at = terminal_action_timestamp(engine.phase)?;
    record_action_accounting(
        active,
        &engine,
        &report,
        combo_before,
        ActionKind::Bonus,
        terminal_at,
    )?;
    if action_needs_row_vrf(active.lifecycle) {
        let validator =
            delegation_record_validator(&ctx.accounts.delegation_record_active.try_borrow_data()?)?;
        let active_key = active.key();
        let ix = prepare_row_vrf_request(
            active,
            active_key,
            ctx.accounts.actor.key(),
            ctx.accounts.oracle_queue.key(),
            validator,
            client_seed,
        )?;
        ctx.accounts
            .invoke_vrf_request(&ctx.accounts.actor.to_account_info(), &ix)?;
    }
    Ok(())
}

#[session_auth_or(
    ctx.accounts.active_run.owner == ctx.accounts.actor.key(),
    SessionError::InvalidToken
)]
pub fn handler_request_reroll(
    ctx: Context<ApplyBonus>,
    expected_action: u32,
    client_seed: [u8; 32],
) -> Result<()> {
    require_player_authorization(
        ctx.accounts.active_run.owner,
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    require!(
        ctx.accounts.active_run.lifecycle == RunLifecycle::Playing,
        ErrorCode::InvalidState
    );
    let active = &mut ctx.accounts.active_run;
    require_before_arcade_deadline(active, Clock::get()?.unix_timestamp)?;
    require!(
        active.action_counter == expected_action,
        ErrorCode::InvalidMoveOrder
    );
    apply_reroll_request(active, expected_action)?;
    let validator =
        delegation_record_validator(&ctx.accounts.delegation_record_active.try_borrow_data()?)?;
    let active_key = active.key();
    let ix = prepare_row_vrf_request(
        active,
        active_key,
        ctx.accounts.actor.key(),
        ctx.accounts.oracle_queue.key(),
        validator,
        client_seed,
    )?;
    ctx.accounts
        .invoke_vrf_request(&ctx.accounts.actor.to_account_info(), &ix)?;
    Ok(())
}

/// A reroll is an accepted action. It folds its own replay event and leaves
/// the run awaiting the domain-separated replacement preview, so a pending
/// reroll with no move still scores at the deadline. The old preview remains
/// visible until the callback lands.
fn apply_reroll_request(active: &mut ActiveRun, expected_action: u32) -> Result<()> {
    let mut engine = engine_from_active(active)?;
    engine.request_reroll().map_err(map_run_error)?;
    fold_replay_event(
        active,
        zkube_core::ReplayEvent::Reroll {
            action: expected_action,
        },
    );
    write_engine(active, &engine);
    active.action_counter = active
        .action_counter
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    active.lifecycle = lifecycle_from_phase(engine.phase);
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ActionKind {
    Move,
    Bonus,
}

fn action_mutator(active: &ActiveRun) -> Result<(MutatorRules, u16)> {
    let mutator = mutator_rules(&active.rules);
    if active.mode != RunMode::Daily {
        return Ok((mutator, 100));
    }
    let pressure_multiplier_x100 =
        active.daily_pressure.score_multipliers_x100[usize::from(active.current_difficulty.min(7))];
    Ok((mutator, pressure_multiplier_x100))
}

fn terminal_action_timestamp(phase: RunPhase) -> Result<i64> {
    if matches!(phase, RunPhase::LevelComplete | RunPhase::Finished) {
        return Ok(Clock::get()?.unix_timestamp);
    }
    Ok(0)
}

#[allow(clippy::too_many_arguments)]
fn record_action_accounting(
    active: &mut ActiveRun,
    engine: &RunEngine,
    report: &MoveReport,
    combo_before: u8,
    kind: ActionKind,
    terminal_at: i64,
) -> Result<()> {
    require!(active.version == ACCOUNT_VERSION, ErrorCode::InvalidVersion);
    write_engine(active, engine);
    active.total_lines_cleared = active
        .total_lines_cleared
        .checked_add(u16::from(report.lines_cleared))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    record_destroyed_blocks(active, report.blocks_destroyed_by_size)?;
    let blocks_destroyed =
        report
            .blocks_destroyed_by_size
            .into_iter()
            .try_fold(0u32, |sum, amount| {
                sum.checked_add(u32::from(amount))
                    .ok_or(ErrorCode::ArithmeticOverflow)
            })?;
    let combo_derived_score = if report.combo_counter > combo_before {
        u64::from(report.points_earned)
    } else {
        0
    };
    let mut canonical = zkube_core::RunMetrics {
        maximum_combo: active.arcade_metrics.max_combo,
        combo_scoring_actions: active.arcade_metrics.combo_scoring_actions,
        total_combo_derived_score: active.arcade_metrics.combo_derived_score,
        highest_action_score: active.arcade_metrics.highest_action_score,
        most_lines_in_action: active.arcade_metrics.most_lines_single_action,
        most_blocks_destroyed_in_action: active.arcade_metrics.most_blocks_single_action,
        total_lines: active.arcade_metrics.total_lines,
        total_blocks_destroyed: active.arcade_metrics.total_blocks,
        perfect_clears: active.arcade_metrics.perfect_clears,
    };
    canonical
        .record_action(zkube_core::ActionMetrics {
            score: u64::from(report.points_earned),
            lines: u32::from(report.lines_cleared),
            blocks_destroyed,
            combo: if report.combo_counter > combo_before {
                u32::from(report.lines_cleared)
            } else {
                0
            },
            combo_derived_score,
            perfect_clear: report.perfect_clear,
        })
        .map_err(|_| error!(ErrorCode::ArithmeticOverflow))?;
    active.arcade_metrics = crate::state::arcade::RunMetrics {
        max_combo: canonical.maximum_combo,
        combo_scoring_actions: canonical.combo_scoring_actions,
        combo_derived_score: canonical.total_combo_derived_score,
        highest_action_score: canonical.highest_action_score,
        most_lines_single_action: canonical.most_lines_in_action,
        most_blocks_single_action: canonical.most_blocks_destroyed_in_action,
        total_lines: canonical.total_lines,
        total_blocks: canonical.total_blocks_destroyed,
        perfect_clears: canonical.perfect_clears,
    };
    if report.lines_cleared >= 2 {
        active.combo2_hits = active
            .combo2_hits
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }
    if report.lines_cleared >= 3 {
        active.combo3_hits = active
            .combo3_hits
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }
    if report.lines_cleared >= 4 {
        active.combo4_hits = active
            .combo4_hits
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }
    if report.perfect_clear {
        active.perfect_clears = active
            .perfect_clears
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }
    if combo_before < 10 && report.combo_counter >= 10 {
        active.high_combo_hits = active
            .high_combo_hits
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }
    if kind == ActionKind::Bonus {
        active.bonus_uses = active
            .bonus_uses
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }
    if active.mode == RunMode::Daily {
        let objective_increment = active.daily_theme.to_core()?.action_increment(report);
        active.pressure_score = active
            .pressure_score
            .checked_add(report.neutral_points_earned)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        active.daily_score = active
            .daily_score
            .checked_add(report.points_earned)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        active.objective_total = active
            .objective_total
            .checked_add(u64::from(objective_increment))
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        active.current_difficulty = active
            .daily_pressure
            .difficulty_for_score(active.pressure_score);
    }
    active.action_counter = active
        .action_counter
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    active.lifecycle = lifecycle_from_phase(engine.phase);
    if matches!(
        active.lifecycle,
        RunLifecycle::LevelComplete | RunLifecycle::Finished
    ) && active.finished_at == 0
    {
        require!(terminal_at > 0, ErrorCode::InvalidState);
        active.finished_at = terminal_at;
    }
    Ok(())
}

fn fold_replay_event(active: &mut ActiveRun, event: zkube_core::ReplayEvent) {
    if active.mode == RunMode::Daily {
        active.replay_hash = zkube_core::ReplayCommitment(active.replay_hash)
            .fold_with::<SolanaSha256>(event)
            .to_bytes();
    } else {
        let encoded = event.canonical_bytes();
        active.replay_hash = sha256v(&[
            b"zkube-campaign-replay-fold-v1",
            &active.replay_hash,
            encoded.as_slice(),
        ]);
    }
}

fn require_before_arcade_deadline(active: &ActiveRun, now: i64) -> Result<()> {
    if active.mode == RunMode::Daily {
        require!(
            active.deadline_at > 0 && now < active.deadline_at,
            ErrorCode::ChallengeEnded
        );
    }
    Ok(())
}

#[derive(Accounts, Session)]
pub struct AbandonRun<'info> {
    #[account(
        mut,
        owner = crate::ID,
        constraint = active_run.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub active_run: Account<'info, ActiveRun>,
    /// CHECK: Logical wallet authority, bound to the active run.
    #[account(address = active_run.owner @ ErrorCode::Unauthorized)]
    pub owner_authority: UncheckedAccount<'info>,
    #[session(signer = actor, authority = owner_authority.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
}

/// Give up a run that has not reached a terminal projection. The run is
/// forced into `Finished` (kept score, `completed == false`, zero stars), so
/// the unchanged commit/consume/close pipeline settles it and reclaims the
/// ActiveRun rent. Works identically on the ER clone and on a stuck
/// undelegated base account.
#[session_auth_or(
    ctx.accounts.active_run.owner == ctx.accounts.actor.key(),
    SessionError::InvalidToken
)]
pub fn handler_abandon_run(ctx: Context<AbandonRun>) -> Result<()> {
    require_player_authorization(
        ctx.accounts.active_run.owner,
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    let active = &mut ctx.accounts.active_run;
    require!(
        abandon_lifecycle_is_allowed(active.lifecycle),
        ErrorCode::InvalidState
    );
    // A pending VRF request dies with the run: fulfillment is lifecycle-gated
    // to AwaitingVrf, so a late oracle callback can no longer land.
    active.pending_vrf_counter = 0;
    active.lifecycle = RunLifecycle::Finished;
    active.latched_star_sources = 0;
    if active.finished_at == 0 {
        active.finished_at = Clock::get()?.unix_timestamp;
    }
    let action = active.action_counter;
    fold_replay_event(active, zkube_core::ReplayEvent::PlayerAbandon { action });
    Ok(())
}

#[derive(Accounts)]
pub struct ForceFinishDeadline<'info> {
    #[account(
        mut,
        owner = crate::ID,
        constraint = active_run.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub active_run: Account<'info, ActiveRun>,
    pub caller: Signer<'info>,
}

/// Permissionless ER-side cutoff. It freezes the last fully accepted state,
/// clears any pending VRF request, and makes the normal commit/consume path the
/// only possible resolution. Zero-action ranked runs are expired by consume.
pub fn handler_force_finish_deadline(ctx: Context<ForceFinishDeadline>) -> Result<()> {
    let active = &mut ctx.accounts.active_run;
    require!(active.mode == RunMode::Daily, ErrorCode::InvalidState);
    require!(
        Clock::get()?.unix_timestamp >= active.deadline_at,
        ErrorCode::ChallengeNotEnded
    );
    if active.lifecycle == RunLifecycle::Finished
        && active.finished_at == active.deadline_at
        && active.pending_vrf_counter == 0
        && !active.has_next_row
    {
        return Ok(());
    }
    require!(
        matches!(
            active.lifecycle,
            RunLifecycle::Delegated | RunLifecycle::AwaitingVrf | RunLifecycle::Playing
        ),
        ErrorCode::InvalidState
    );
    active.pending_vrf_counter = 0;
    active.has_next_row = false;
    active.lifecycle = RunLifecycle::Finished;
    active.finished_at = active.deadline_at;
    let action = active.action_counter;
    fold_replay_event(active, zkube_core::ReplayEvent::DailyDeadline { action });
    Ok(())
}

fn abandon_lifecycle_is_allowed(lifecycle: RunLifecycle) -> bool {
    matches!(
        lifecycle,
        RunLifecycle::Prepared
            | RunLifecycle::Delegated
            | RunLifecycle::AwaitingVrf
            | RunLifecycle::Playing
    )
}

fn vrf_request_lifecycle_is_allowed(lifecycle: RunLifecycle) -> bool {
    matches!(
        lifecycle,
        RunLifecycle::Delegated | RunLifecycle::AwaitingVrf
    )
}

fn vrf_fulfillment_lifecycle_is_allowed(lifecycle: RunLifecycle) -> bool {
    lifecycle == RunLifecycle::AwaitingVrf
}

fn require_matching_vrf_callback(pending: u32, expected: u32) -> Result<()> {
    require!(pending > 0, ErrorCode::NoVrfRequestPending);
    require!(pending == expected, ErrorCode::VrfRequestMismatch);
    Ok(())
}

fn action_needs_row_vrf(lifecycle: RunLifecycle) -> bool {
    lifecycle == RunLifecycle::AwaitingVrf
}

fn run_has_terminal_projection(lifecycle: RunLifecycle, finished_at: i64) -> bool {
    matches!(
        lifecycle,
        RunLifecycle::LevelComplete | RunLifecycle::Finished
    ) && finished_at > 0
}

#[commit]
#[derive(Accounts)]
pub struct CommitRun<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        owner = crate::ID,
        constraint = active_run.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub active_run: Account<'info, ActiveRun>,
    /// CHECK: MagicBlock context required by MagicIntentBundleBuilder.
    #[account(mut, address = ephemeral_rollups_sdk::consts::MAGIC_CONTEXT_ID @ ErrorCode::InvalidMagicProgram)]
    pub magic_context: UncheckedAccount<'info>,
    pub magic_program: Program<'info, ephemeral_rollups_sdk::anchor::MagicProgram>,
}

pub fn handler_commit_run(ctx: Context<CommitRun>) -> Result<()> {
    require!(
        matches!(
            ctx.accounts.active_run.mode,
            RunMode::Campaign | RunMode::Daily
        ),
        ErrorCode::InvalidState
    );
    require!(
        run_has_terminal_projection(
            ctx.accounts.active_run.lifecycle,
            ctx.accounts.active_run.finished_at,
        ),
        ErrorCode::GameNotFinished
    );
    require!(
        ctx.accounts.active_run.pending_vrf_counter == 0,
        ErrorCode::VrfRequestPending
    );

    ctx.accounts.active_run.exit(&crate::ID)?;
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.active_run.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}

#[derive(Accounts)]
pub struct ConsumeCampaignRun<'info> {
    #[account(
        mut,
        close = rent_recipient,
        owner = crate::ID,
        seeds = [ACTIVE_RUN_SEED, b"active", owner.key().as_ref(), active_run.run_id.to_le_bytes().as_ref()],
        bump = active_run.bump,
        has_one = owner @ ErrorCode::Unauthorized,
        constraint = active_run.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub active_run: Box<Account<'info, ActiveRun>>,
    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, owner.key().as_ref()],
        bump = player_state.bump,
        has_one = owner @ ErrorCode::Unauthorized,
        constraint = player_state.schema_valid() @ ErrorCode::InvalidVersion
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
    /// CHECK: Player wallet pinned by every durable account and active_run.
    pub owner: UncheckedAccount<'info>,
    /// CHECK: Canonical zero-data System PDA receives recycled ActiveRun rent.
    #[account(
        mut,
        seeds = [PLAYER_FUNDING_SEED, owner.key().as_ref()],
        bump,
        owner = system_program::ID @ ErrorCode::InvalidOwner,
        constraint = rent_recipient.data_is_empty() @ ErrorCode::InvalidOwner
    )]
    pub rent_recipient: UncheckedAccount<'info>,
}

pub fn handler_consume_campaign_run(ctx: Context<ConsumeCampaignRun>) -> Result<()> {
    let active = &ctx.accounts.active_run;
    require!(active.mode == RunMode::Campaign, ErrorCode::InvalidState);
    require!(
        ctx.accounts
            .player_state
            .campaign_reservation_matches(active.run_id),
        ErrorCode::InvalidRunId
    );
    require!(
        matches!(
            active.lifecycle,
            RunLifecycle::LevelComplete | RunLifecycle::Finished
        ),
        ErrorCode::GameNotFinished
    );
    require!(active.finished_at > 0, ErrorCode::GameNotFinished);
    let stars = active.latched_star_sources.count_ones() as u8;
    let newly_earned_stars =
        ctx.accounts
            .player_state
            .record_level_stars(active.map_id, active.level, stars)?;
    emit!(CampaignLevelRewarded {
        owner: active.owner,
        run_id: active.run_id,
        map_id: active.map_id,
        level: active.level,
        achieved_stars: stars,
        newly_earned_stars,
    });
    ctx.accounts
        .player_state
        .release_campaign_run(active.run_id)?;
    Ok(())
}

#[inline(never)]
fn record_destroyed_blocks(active: &mut ActiveRun, destroyed: [u8; 4]) -> Result<()> {
    for (total, amount) in active.blocks_destroyed_by_size.iter_mut().zip(destroyed) {
        *total = total
            .checked_add(u16::from(amount))
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }
    Ok(())
}

#[event]
pub struct CampaignLevelRewarded {
    pub owner: Pubkey,
    pub run_id: u64,
    pub map_id: u8,
    pub level: u8,
    pub achieved_stars: u8,
    pub newly_earned_stars: u8,
}

fn delegation_record_validator(data: &[u8]) -> Result<Pubkey> {
    use ephemeral_rollups_sdk::dlp_api::state::DelegationRecord;

    let record = DelegationRecord::try_from_bytes_with_discriminator(data)
        .map_err(|_| error!(ErrorCode::InvalidMagicProgram))?;
    Ok(Pubkey::new_from_array(record.authority.to_bytes()))
}

fn constraint(snapshot: ConstraintSnapshot) -> Result<Constraint> {
    let kind = ConstraintKind::from_tag(snapshot.kind).ok_or(error!(ErrorCode::InvalidLevel))?;
    Ok(Constraint {
        kind,
        value: snapshot.value,
        required_count: snapshot.required_count,
    })
}

fn level_rules(snapshot: &LevelRuleSnapshot) -> Result<LevelRules> {
    Ok(LevelRules {
        points_required: snapshot.points_required,
        max_moves: snapshot.max_moves,
        primary: constraint(snapshot.primary)?,
        secondary: constraint(snapshot.secondary)?,
    })
}

fn mutator_rules(snapshot: &LevelRuleSnapshot) -> MutatorRules {
    MutatorRules {
        line_clear_bonus: snapshot.line_clear_bonus,
        perfect_clear_bonus: snapshot.perfect_clear_bonus,
        bonus_trigger_type: snapshot.bonus_trigger_type,
        bonus_threshold: snapshot.bonus_threshold,
    }
}

fn engine_from_active(active: &ActiveRun) -> Result<RunEngine> {
    let bonus = match active.bonus_type {
        0 => None,
        1 => Some(Bonus::Hammer),
        2 => Some(Bonus::Totem),
        3 => Some(Bonus::Wave),
        _ => return err!(ErrorCode::InvalidState),
    };
    let phase = match active.lifecycle {
        RunLifecycle::Prepared | RunLifecycle::Delegated => RunPhase::Ready,
        RunLifecycle::AwaitingVrf => RunPhase::AwaitingVrf,
        RunLifecycle::Playing => RunPhase::Playing,
        RunLifecycle::LevelComplete => RunPhase::LevelComplete,
        RunLifecycle::Finished => RunPhase::Finished,
    };
    Ok(RunEngine {
        grid: Grid::try_from_cells(active.grid).map_err(|_| error!(ErrorCode::InvalidState))?,
        next_row: active.has_next_row.then_some(active.next_row),
        phase,
        score: active.score,
        moves: active.moves,
        combo_counter: active.combo_counter,
        max_combo: active.max_combo,
        primary_progress: active.primary_progress,
        secondary_progress: active.secondary_progress,
        latched_star_sources: active.latched_star_sources,
        streak: active.streak,
        charges_earned: active.charges_earned,
        level_lines_cleared: active.level_lines_cleared,
        bonus,
        bonus_charges: active.bonus_charges,
        reroll_charges: active.reroll_charges,
        starting_height_target: active.starting_height_target,
    })
}

fn write_engine(active: &mut ActiveRun, engine: &RunEngine) {
    active.grid = *engine.grid.cells();
    active.next_row = engine.next_row.unwrap_or_default();
    active.has_next_row = engine.next_row.is_some();
    active.score = engine.score;
    active.moves = engine.moves;
    active.combo_counter = engine.combo_counter;
    active.max_combo = engine.max_combo;
    active.primary_progress = engine.primary_progress;
    active.secondary_progress = engine.secondary_progress;
    active.latched_star_sources = engine.latched_star_sources;
    active.streak = engine.streak;
    active.charges_earned = engine.charges_earned;
    active.level_lines_cleared = engine.level_lines_cleared;
    active.bonus_type = match engine.bonus {
        None => 0,
        Some(Bonus::Hammer) => 1,
        Some(Bonus::Totem) => 2,
        Some(Bonus::Wave) => 3,
    };
    active.bonus_charges = engine.bonus_charges;
    active.reroll_charges = engine.reroll_charges;
    active.starting_height_target = engine.starting_height_target;
}

fn lifecycle_from_phase(phase: RunPhase) -> RunLifecycle {
    match phase {
        RunPhase::Ready => RunLifecycle::Delegated,
        RunPhase::AwaitingVrf => RunLifecycle::AwaitingVrf,
        RunPhase::Playing => RunLifecycle::Playing,
        RunPhase::LevelComplete => RunLifecycle::LevelComplete,
        RunPhase::Finished => RunLifecycle::Finished,
    }
}

fn map_run_error(error: RunError) -> anchor_lang::error::Error {
    match error {
        RunError::InvalidExpectedMove => error!(ErrorCode::InvalidMoveOrder),
        RunError::Grid(_) => error!(ErrorCode::InvalidMove),
        RunError::MoveLimitReached => error!(ErrorCode::GameOver),
        RunError::InvalidPhase
        | RunError::MissingNextRow
        | RunError::RowAlreadyAvailable
        | RunError::NoBonusCharge
        | RunError::NoRerollAvailable
        | RunError::RerollRequiresVrf => error!(ErrorCode::InvalidState),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::arena_rules::{DailyPressureProfile, DailyThemeSnapshot};
    use anchor_lang::{InstructionData, ToAccountMetas};
    use serde_json::Value;

    fn delegation_record_bytes(validator: Pubkey) -> Vec<u8> {
        use ephemeral_rollups_sdk::dlp_api::state::DelegationRecord;

        let mut data = vec![0; DelegationRecord::size_with_discriminator()];
        data[..8].copy_from_slice(&100u64.to_le_bytes());
        data[8..40].copy_from_slice(validator.as_ref());
        data
    }

    #[test]
    fn delegation_record_validator_requires_the_sdk_layout_and_discriminator() {
        let validator = Pubkey::new_unique();
        let valid = delegation_record_bytes(validator);
        assert_eq!(delegation_record_validator(&valid).unwrap(), validator);

        let mut wrong_discriminator = valid.clone();
        wrong_discriminator[..8].copy_from_slice(&101u64.to_le_bytes());
        assert!(delegation_record_validator(&wrong_discriminator).is_err());
        assert!(delegation_record_validator(&valid[..39]).is_err());
    }

    #[test]
    fn campaign_consumer_is_permissionless_and_has_no_action_escrow() {
        let owner = Pubkey::new_unique();
        let metas = crate::accounts::ConsumeCampaignRun {
            active_run: Pubkey::new_unique(),
            player_state: Pubkey::new_unique(),
            owner,
            rent_recipient: Pubkey::new_unique(),
        }
        .to_account_metas(None);

        assert_eq!(metas.len(), 4);
        assert_eq!(metas[2].pubkey, owner);
        assert!(metas.iter().all(|meta| !meta.is_signer));
    }

    #[test]
    fn action_accounts_keep_the_scoped_vrf_boundary_in_exact_positions() {
        let active_run = Pubkey::new_unique();
        let owner = Pubkey::new_unique();
        let session_token = Pubkey::new_unique();
        let actor = Pubkey::new_unique();
        let oracle_queue = Pubkey::new_unique();
        let delegation_record = Pubkey::new_unique();
        let program_identity = Pubkey::new_unique();
        let vrf_program = Pubkey::new_unique();
        let slot_hashes = Pubkey::new_unique();
        let system_program = Pubkey::new_unique();
        let metas = crate::accounts::PlayMove {
            active_run,
            owner_authority: owner,
            session_token: Some(session_token),
            actor,
            oracle_queue,
            delegation_record_active: delegation_record,
            program_identity,
            vrf_program,
            slot_hashes,
            system_program,
        }
        .to_account_metas(None);

        assert_eq!(metas.len(), 10);
        assert_eq!(metas[0].pubkey, active_run);
        assert_eq!(metas[3].pubkey, actor);
        assert!(metas[3].is_signer && metas[3].is_writable);
        assert_eq!(metas[4].pubkey, oracle_queue);
        assert_eq!(metas[5].pubkey, delegation_record);
    }

    #[test]
    fn callback_abi_carries_and_validates_the_exact_request_counter() {
        let data = crate::instruction::FulfillRowVrf {
            randomness: [9; 32],
            expected_request_counter: 42,
        }
        .data();
        assert_eq!(&data[data.len() - 4..], &42u32.to_le_bytes());
        assert!(require_matching_vrf_callback(42, 42).is_ok());
        assert!(require_matching_vrf_callback(0, 0).is_err());
        assert!(require_matching_vrf_callback(41, 42).is_err());
    }

    #[test]
    fn only_actions_that_consumed_the_preview_enqueue_randomness() {
        assert!(action_needs_row_vrf(RunLifecycle::AwaitingVrf));
        assert!(!action_needs_row_vrf(RunLifecycle::Playing));
        assert!(!action_needs_row_vrf(RunLifecycle::LevelComplete));
        assert!(!action_needs_row_vrf(RunLifecycle::Finished));
    }

    #[test]
    fn constraint_snapshot_mapping_rejects_unknown_kinds() {
        assert!(constraint(ConstraintSnapshot {
            kind: 19,
            value: 0,
            required_count: 0,
        })
        .is_err());
    }

    #[test]
    fn core_constraint_state_round_trips_through_active_run() {
        let engine = RunEngine {
            phase: RunPhase::Playing,
            latched_star_sources: 0b110,
            streak: 3,
            charges_earned: 4,
            ..RunEngine::default()
        };
        let mut active = ActiveRun {
            lifecycle: RunLifecycle::Playing,
            ..ActiveRun::default()
        };

        write_engine(&mut active, &engine);

        assert_eq!(active.latched_star_sources, 0b110);
        assert_eq!(active.streak, 3);
        assert_eq!(active.charges_earned, 4);
        let restored = engine_from_active(&active).unwrap();
        assert_eq!(restored.latched_star_sources, 0b110);
        assert_eq!(restored.streak, 3);
        assert_eq!(restored.charges_earned, 4);
    }

    fn accounting_fixture() -> (ActiveRun, RunEngine, MoveReport) {
        let active = ActiveRun {
            version: ACCOUNT_VERSION,
            mode: RunMode::Daily,
            lifecycle: RunLifecycle::Playing,
            daily_theme: DailyThemeSnapshot::from_core(zkube_core::DailyTheme {
                kind: ConstraintKind::CombosOfExactly,
                value: 2,
            }),
            daily_pressure: DailyPressureProfile::canonical(),
            ..ActiveRun::default()
        };
        let engine = RunEngine {
            phase: RunPhase::LevelComplete,
            score: 25,
            combo_counter: 10,
            max_combo: 10,
            ..RunEngine::default()
        };
        let report = MoveReport {
            lines_cleared: 2,
            points_earned: 25,
            combo_counter: 10,
            blocks_destroyed_by_size: [1, 2, 3, 4],
            neutral_points_earned: 10,
            ..MoveReport::default()
        };
        (active, engine, report)
    }

    #[test]
    fn theme_total_is_not_added_to_score() {
        let (mut move_run, engine, report) = accounting_fixture();
        let (mut bonus_run, _, mut bonus_report) = accounting_fixture();
        bonus_report.action_was_bonus = true;
        record_action_accounting(&mut move_run, &engine, &report, 9, ActionKind::Move, 123)
            .unwrap();
        record_action_accounting(
            &mut bonus_run,
            &engine,
            &bonus_report,
            9,
            ActionKind::Bonus,
            123,
        )
        .unwrap();

        assert_eq!(move_run.total_lines_cleared, bonus_run.total_lines_cleared);
        assert_eq!(move_run.blocks_destroyed_by_size, [1, 2, 3, 4]);
        assert_eq!(
            move_run.blocks_destroyed_by_size,
            bonus_run.blocks_destroyed_by_size
        );
        assert_eq!((move_run.combo2_hits, move_run.high_combo_hits), (1, 1));
        assert_eq!(move_run.daily_score, 25);
        assert_eq!(move_run.objective_total, 1);
        assert_eq!(bonus_run.objective_total, 0);
        assert_eq!(move_run.pressure_score, 10);
        assert_eq!(
            move_run.current_difficulty,
            zkube_core::DailyPressureRules::canonical()
                .difficulty_for_score(move_run.pressure_score)
        );
        assert_eq!(move_run.current_difficulty, bonus_run.current_difficulty);
        assert_eq!(move_run.finished_at, 123);
        assert_eq!(move_run.lifecycle, RunLifecycle::LevelComplete);
        assert_eq!((move_run.bonus_uses, bonus_run.bonus_uses), (0, 1));
    }

    #[test]
    fn campaign_and_daily_draw_from_one_tier_table() {
        for tier in 0..8u8 {
            let campaign = ActiveRun {
                mode: RunMode::Campaign,
                rules: LevelRuleSnapshot {
                    difficulty: tier,
                    ..LevelRuleSnapshot::default()
                },
                ..ActiveRun::default()
            };
            let daily = ActiveRun {
                mode: RunMode::Daily,
                current_difficulty: tier,
                daily_pressure: DailyPressureProfile::canonical(),
                ..ActiveRun::default()
            };
            assert_eq!(
                generation_weights(&campaign),
                zkube_core::TIER_BLOCK_WEIGHTS[usize::from(tier)]
            );
            assert_eq!(generation_weights(&daily), generation_weights(&campaign));
        }
    }

    #[test]
    fn threshold_crossing_bonus_keeps_preview_and_advances_future_row_weights() {
        let pressure = DailyPressureProfile::canonical();
        let preview = [2, 2, 0, 3, 3, 3, 0, 0];
        let mut active = ActiveRun {
            version: ACCOUNT_VERSION,
            mode: RunMode::Daily,
            lifecycle: RunLifecycle::Playing,
            daily_pressure: pressure,
            next_row: preview,
            has_next_row: true,
            ..ActiveRun::default()
        };
        let engine = RunEngine {
            phase: RunPhase::Playing,
            next_row: Some(preview),
            ..RunEngine::default()
        };
        let report = MoveReport {
            neutral_points_earned: zkube_core::PRESSURE_STEP,
            ..MoveReport::default()
        };

        record_action_accounting(&mut active, &engine, &report, 0, ActionKind::Bonus, 0).unwrap();

        assert_eq!(active.current_difficulty, 1);
        assert_eq!(active.next_row, preview);
        assert!(active.has_next_row);
        assert_eq!(
            generation_weights(&active),
            zkube_core::TIER_BLOCK_WEIGHTS[1]
        );
    }

    #[test]
    fn one_verified_result_builds_the_visible_opening_layout() {
        let mut engine = RunEngine {
            phase: RunPhase::AwaitingVrf,
            starting_height_target: 5,
            ..RunEngine::default()
        };
        let rows = provide_verified_vrf_rows(
            &mut engine,
            [17u8; 32],
            1,
            [4; 32],
            BlockWeights::default(),
            true,
        )
        .unwrap();

        assert_eq!(rows, 6);
        assert_eq!(engine.phase, RunPhase::Playing);
        assert_eq!(engine.grid.occupied_height(), 5);
        assert!(engine.next_row.is_some());
    }

    #[test]
    fn opening_expansion_is_reproducible_and_domain_separated() {
        let opening = || RunEngine {
            phase: RunPhase::AwaitingVrf,
            starting_height_target: 4,
            ..RunEngine::default()
        };
        let mut first = opening();
        let mut replay = opening();
        let mut different = opening();
        let first_result = provide_verified_vrf_rows(
            &mut first,
            [29u8; 32],
            4,
            [5; 32],
            BlockWeights::default(),
            true,
        )
        .unwrap();
        let replay_result = provide_verified_vrf_rows(
            &mut replay,
            [29u8; 32],
            4,
            [5; 32],
            BlockWeights::default(),
            true,
        )
        .unwrap();
        let different_result = provide_verified_vrf_rows(
            &mut different,
            [30u8; 32],
            4,
            [5; 32],
            BlockWeights::default(),
            true,
        )
        .unwrap();

        assert_eq!(first, replay);
        assert_eq!(first_result, replay_result);
        assert_eq!(different_result, first_result);
        assert_ne!(first.grid, different.grid);
    }

    #[test]
    fn one_callback_reaches_the_maximum_canonical_opening_height() {
        for seed in 0..=u8::MAX {
            let mut engine = RunEngine {
                phase: RunPhase::AwaitingVrf,
                starting_height_target: 8,
                ..RunEngine::default()
            };
            let rows = provide_verified_vrf_rows(
                &mut engine,
                [seed; 32],
                1,
                [6; 32],
                BlockWeights::default(),
                true,
            )
            .unwrap();

            assert_eq!(engine.phase, RunPhase::Playing, "seed {seed}");
            assert_eq!(rows, 9);
            assert_eq!(engine.grid.occupied_height(), 8);
            assert!(engine.next_row.is_some());
        }
    }

    #[test]
    fn ordinary_callback_consumes_exactly_one_fresh_row() {
        let mut engine = RunEngine {
            phase: RunPhase::AwaitingVrf,
            grid: Grid::try_from_cells({
                let mut cells = [0; 80];
                cells[0] = 1;
                cells
            })
            .unwrap(),
            ..RunEngine::default()
        };
        let rows = provide_verified_vrf_rows(
            &mut engine,
            [41u8; 32],
            9,
            [7; 32],
            BlockWeights::default(),
            false,
        )
        .unwrap();

        assert_eq!(rows, 1);
        assert_eq!(engine.phase, RunPhase::Playing);
        assert!(engine.next_row.is_some());
    }

    #[test]
    fn every_core_replay_event_has_an_on_chain_producer() {
        // Wildcard-free on purpose: when zkube-core grows a replay event,
        // this match stops compiling until the program names the instruction
        // that folds it — the gap that let reroll ship core-side only.
        fn producer(event: &zkube_core::ReplayEvent) -> &'static str {
            match event {
                zkube_core::ReplayEvent::Vrf { .. } => "fulfill_row_vrf",
                zkube_core::ReplayEvent::Move { .. } => "play_move",
                zkube_core::ReplayEvent::Bonus { .. } => "apply_bonus",
                zkube_core::ReplayEvent::Reroll { .. } => "request_reroll",
                zkube_core::ReplayEvent::PlayerAbandon { .. } => "abandon_run",
                zkube_core::ReplayEvent::DailyDeadline { .. } => "force_finish_deadline",
            }
        }
        assert_eq!(
            producer(&zkube_core::ReplayEvent::Reroll { action: 0 }),
            "request_reroll"
        );
    }

    #[test]
    fn reroll_request_is_an_accepted_action_that_awaits_its_own_vrf() {
        let mut active = ActiveRun {
            version: ACCOUNT_VERSION,
            mode: RunMode::Daily,
            lifecycle: RunLifecycle::Playing,
            bonus_type: 1,
            bonus_charges: 2,
            reroll_charges: 1,
            has_next_row: true,
            next_row: {
                let mut row = [0u8; 8];
                row[0] = 1;
                row
            },
            ..ActiveRun::default()
        };
        let replay_before = active.replay_hash;
        apply_reroll_request(&mut active, 0).unwrap();

        assert_eq!(active.action_counter, 1);
        assert_eq!(active.lifecycle, RunLifecycle::AwaitingVrf);
        assert_eq!(active.bonus_charges, 2);
        assert_eq!(active.bonus_uses, 0);
        assert_eq!(active.reroll_charges, 0);
        // The old preview stays visible while the replacement is pending.
        assert!(active.has_next_row);
        assert_eq!(
            active.replay_hash,
            zkube_core::ReplayCommitment(replay_before)
                .fold_with::<SolanaSha256>(zkube_core::ReplayEvent::Reroll { action: 0 })
                .to_bytes()
        );
        // Awaiting the callback, and the run's reroll is spent: no second request.
        assert!(apply_reroll_request(&mut active, 1).is_err());
    }

    #[test]
    fn reroll_callback_replaces_only_the_preview_with_the_committed_row() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../fixtures/replays/golden-reroll-v1.json"
        ))
        .unwrap();
        let bytes32 = |field: &str| -> [u8; 32] {
            let value = fixture[field].as_str().unwrap();
            assert_eq!(value.len(), 64);
            std::array::from_fn(|index| {
                u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).unwrap()
            })
        };
        let randomness = bytes32("vrf_output_hex");
        let rules_hash = bytes32("rules_hash_hex");
        let request_counter = fixture["request_counter"].as_u64().unwrap() as u32;
        let weights = BlockWeights {
            values: std::array::from_fn(|index| fixture["weights"][index].as_u64().unwrap() as u16),
        };
        let rerolled: [u8; 8] =
            std::array::from_fn(|index| fixture["rerolled_row"][index].as_u64().unwrap() as u8);
        let ordinary: [u8; 8] = std::array::from_fn(|index| {
            fixture["ordinary_next_row"][index].as_u64().unwrap() as u8
        });

        let mut cells = [0u8; 80];
        cells[0] = 1;
        let mut engine = RunEngine {
            phase: RunPhase::AwaitingVrf,
            bonus: Some(Bonus::Hammer),
            bonus_charges: 2,
            reroll_charges: 0,
            next_row: Some({
                let mut row = [0u8; 8];
                row[0] = 1;
                row
            }),
            grid: Grid::try_from_cells(cells).unwrap(),
            ..RunEngine::default()
        };
        let rows = provide_verified_vrf_rows(
            &mut engine,
            randomness,
            request_counter,
            rules_hash,
            weights,
            false,
        )
        .unwrap();

        assert_eq!(rows, 1);
        assert_eq!(engine.phase, RunPhase::Playing);
        // The board is untouched; only the preview moved, and it came from
        // the committed reroll domain rather than the ordinary row stream.
        assert_eq!(engine.grid.cells(), &cells);
        assert_eq!(engine.next_row, Some(rerolled));
        assert_ne!(engine.next_row, Some(ordinary));
    }

    #[test]
    fn perfect_clear_callback_reseeds_board_and_preview_from_one_vrf() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../fixtures/replays/golden-perfect-clear-continuation-v1.json"
        ))
        .unwrap();
        let bytes32 = |field: &str| {
            let value = fixture[field].as_str().unwrap();
            assert_eq!(value.len(), 64);
            std::array::from_fn(|index| {
                u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).unwrap()
            })
        };
        let randomness = bytes32("vrf_output_hex");
        let rules_hash = bytes32("rules_hash_hex");
        let request_counter = fixture["request_counter"].as_u64().unwrap() as u32;
        let weights = BlockWeights {
            values: std::array::from_fn(|index| fixture["weights"][index].as_u64().unwrap() as u16),
        };
        let seed_row: [u8; 8] =
            std::array::from_fn(|index| fixture["seed_row"][index].as_u64().unwrap() as u8);
        let preview_row: [u8; 8] =
            std::array::from_fn(|index| fixture["preview_row"][index].as_u64().unwrap() as u8);
        let mut engine = RunEngine {
            phase: RunPhase::AwaitingVrf,
            grid: Grid::EMPTY,
            ..RunEngine::default()
        };
        let expected = zkube_core::continuation_from_vrf_with::<SolanaSha256>(
            randomness,
            request_counter,
            rules_hash,
            weights,
        )
        .unwrap();

        let rows = provide_verified_vrf_rows(
            &mut engine,
            randomness,
            request_counter,
            rules_hash,
            weights,
            false,
        )
        .unwrap();

        assert_eq!(rows, 2);
        assert_eq!(engine.phase, RunPhase::Playing);
        assert_eq!(engine.grid, expected.grid);
        assert_eq!(engine.next_row, Some(expected.preview));
        assert_eq!(&engine.grid.cells()[..8], seed_row);
        assert_eq!(engine.next_row, Some(preview_row));
    }

    fn campaign_v2_fixture() -> Value {
        serde_json::from_str(include_str!("../../../../fixtures/campaign-v2.json")).unwrap()
    }

    fn campaign_constraint(value: &Value) -> Constraint {
        let tuple = value.as_array().unwrap();
        Constraint {
            kind: ConstraintKind::from_tag(tuple[0].as_u64().unwrap() as u8)
                .expect("known Campaign constraint kind"),
            value: tuple[1].as_u64().unwrap() as u8,
            required_count: tuple[2].as_u64().unwrap() as u8,
        }
    }

    fn campaign_level(value: &Value) -> LevelRules {
        let tuple = value.as_array().unwrap();
        LevelRules {
            points_required: tuple[0].as_u64().unwrap() as u32,
            max_moves: tuple[1].as_u64().unwrap() as u16,
            primary: campaign_constraint(&tuple[3]),
            secondary: campaign_constraint(&tuple[4]),
        }
    }

    fn campaign_mutator(value: &Value) -> MutatorRules {
        let rules = value.as_array().unwrap();
        MutatorRules {
            line_clear_bonus: rules[0].as_u64().unwrap() as u16,
            perfect_clear_bonus: rules[1].as_u64().unwrap() as u16,
            bonus_trigger_type: rules[3].as_u64().unwrap() as u8,
            bonus_threshold: rules[4].as_u64().unwrap() as u16,
        }
    }

    #[test]
    fn campaign_v2_fixture_has_valid_weighted_objectives() {
        let fixture = campaign_v2_fixture();
        let weights = fixture["difficultyWeights"].as_array().unwrap();
        let maps = fixture["maps"].as_array().unwrap();
        assert_eq!(maps.len(), 10);
        assert_eq!(weights.len(), 8);
        for tier in weights {
            assert_eq!(
                tier.as_array()
                    .unwrap()
                    .iter()
                    .map(|value| value.as_u64().unwrap())
                    .sum::<u64>(),
                100
            );
        }
        for (map_index, map) in maps.iter().enumerate() {
            assert_eq!(map["mapId"].as_u64().unwrap() as usize, map_index + 1);
            let rules = map["rules"].as_array().unwrap();
            assert!(
                (crate::game::MIN_OPENING_HEIGHT..=crate::game::MAX_OPENING_HEIGHT)
                    .contains(&(rules[5].as_u64().unwrap() as u8))
            );
            let levels = map["levels"].as_array().unwrap();
            assert_eq!(levels.len(), 10);
            for level in levels {
                let tuple = level.as_array().unwrap();
                let difficulty = tuple[2].as_u64().unwrap() as usize;
                let tier = weights[difficulty].as_array().unwrap();
                let primary = campaign_constraint(&tuple[3]);
                let secondary = campaign_constraint(&tuple[4]);
                assert!(primary.is_valid_primary());
                assert!(secondary.is_valid_secondary());
                for constraint in [primary, secondary] {
                    if matches!(
                        constraint.kind,
                        ConstraintKind::BreakBlocks | ConstraintKind::BreakInMove
                    ) && constraint.value > 0
                    {
                        assert!(tier[usize::from(constraint.value)].as_u64().unwrap() > 0);
                    }
                }
            }
        }
    }

    /// Deterministic, constraint-aware Campaign balance harness. The greedy
    /// player is a regression guardrail—not a substitute for skilled play.
    /// Run with:
    /// `cargo test -p solana campaign_v2_simulation -- --ignored --nocapture`
    #[test]
    #[ignore = "offline Campaign balance simulation"]
    fn campaign_v2_simulation() {
        let fixture = campaign_v2_fixture();
        let seed_count = std::env::var("CAMPAIGN_SIMULATION_SEEDS")
            .ok()
            .and_then(|value| value.parse::<u32>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(64);
        println!(
            "seeds={seed_count}\nmap,level,completed,completion_pct,mean_moves,mean_score,max_score,mean_charges,stuck"
        );
        for map in fixture["maps"].as_array().unwrap() {
            let map_id = map["mapId"].as_u64().unwrap() as u8;
            for (level_index, level) in map["levels"].as_array().unwrap().iter().enumerate() {
                let attempts = (0..seed_count)
                    .map(|seed| simulate_campaign_attempt(&fixture, map, level, seed))
                    .collect::<Vec<_>>();
                let completed = attempts.iter().filter(|attempt| attempt.completed).count();
                let stuck = attempts.iter().filter(|attempt| attempt.stuck).count();
                let total_moves = attempts
                    .iter()
                    .map(|attempt| u64::from(attempt.moves))
                    .sum::<u64>();
                let total_score = attempts
                    .iter()
                    .map(|attempt| u64::from(attempt.score))
                    .sum::<u64>();
                let max_score = attempts
                    .iter()
                    .map(|attempt| attempt.score)
                    .max()
                    .unwrap_or(0);
                let total_charges = attempts
                    .iter()
                    .map(|attempt| u64::from(attempt.bonus_charges))
                    .sum::<u64>();
                assert!(attempts
                    .iter()
                    .all(|attempt| attempt.moves <= campaign_level(level).max_moves));
                println!(
                    "{map_id},{},{completed},{:.1},{:.1},{:.1},{max_score},{:.1},{stuck}",
                    level_index + 1,
                    completed as f64 * 100.0 / attempts.len() as f64,
                    total_moves as f64 / attempts.len() as f64,
                    total_score as f64 / attempts.len() as f64,
                    total_charges as f64 / attempts.len() as f64,
                );
            }
        }
    }

    #[derive(Clone, Copy)]
    struct SimulatedCampaignAttempt {
        completed: bool,
        moves: u16,
        score: u32,
        bonus_charges: u8,
        stuck: bool,
    }

    struct CampaignMoveCandidate {
        engine: RunEngine,
        quality: (bool, bool, u8, u16, u8, u32),
    }

    fn campaign_constraint_signal(level: LevelRules, engine: &RunEngine) -> u16 {
        fn signal(constraint: Constraint, progress: u8) -> u16 {
            if constraint.kind == ConstraintKind::None {
                0
            } else {
                u16::from(progress) * 16
            }
        }
        signal(level.primary, engine.primary_progress)
            + signal(level.secondary, engine.secondary_progress)
    }

    fn simulate_campaign_attempt(
        fixture: &Value,
        map: &Value,
        level_value: &Value,
        seed: u32,
    ) -> SimulatedCampaignAttempt {
        let level = campaign_level(level_value);
        let level_tuple = level_value.as_array().unwrap();
        let difficulty = level_tuple[2].as_u64().unwrap() as usize;
        let weight_values = fixture["difficultyWeights"][difficulty].as_array().unwrap();
        let weights = std::array::from_fn(|index| weight_values[index].as_u64().unwrap() as u16);
        let rules = map["rules"].as_array().unwrap();
        let mutator = campaign_mutator(&map["rules"]);
        let bonus = match rules[2].as_u64().unwrap() {
            1 => Some(Bonus::Hammer),
            2 => Some(Bonus::Totem),
            3 => Some(Bonus::Wave),
            kind => panic!("unknown Campaign bonus kind {kind}"),
        };
        let mut engine = RunEngine {
            phase: RunPhase::AwaitingVrf,
            bonus,
            bonus_charges: rules[5].as_u64().unwrap() as u8,
            starting_height_target: rules[6].as_u64().unwrap() as u8,
            ..RunEngine::default()
        };
        let mut row_counter = 0u32;
        while engine.next_row.is_none() {
            let row = simulated_campaign_vrf_row(seed, row_counter, weights);
            engine.provide_vrf_row(row).unwrap();
            row_counter += 1;
            assert!(
                row_counter < 96,
                "Campaign seed stack failed to reach its target height"
            );
        }

        let mut stuck = false;
        let mut bonus_used_since_move = false;
        while engine.phase == RunPhase::Playing && engine.moves < level.max_moves {
            if !bonus_used_since_move && engine.bonus_charges > 0 {
                let signal_before = campaign_constraint_signal(level, &engine);
                let mut best_bonus: Option<CampaignMoveCandidate> = None;
                for row in 0..10 {
                    for column in 0..8 {
                        let mut candidate = engine;
                        let Ok(report) = candidate.apply_bonus(row, column, level, mutator, 100)
                        else {
                            continue;
                        };
                        let signal_after = campaign_constraint_signal(level, &candidate);
                        if signal_after == signal_before
                            && report.points_earned == 0
                            && !candidate.level_satisfied(level)
                        {
                            continue;
                        }
                        let quality = (
                            candidate.level_satisfied(level),
                            candidate.phase != RunPhase::Finished,
                            u8::MAX - report.height_after,
                            signal_after,
                            report.lines_cleared,
                            report.points_earned,
                        );
                        if best_bonus
                            .as_ref()
                            .is_none_or(|best| quality > best.quality)
                        {
                            best_bonus = Some(CampaignMoveCandidate {
                                engine: candidate,
                                quality,
                            });
                        }
                    }
                }
                if let Some(best) = best_bonus {
                    engine = best.engine;
                    bonus_used_since_move = true;
                    if engine.phase == RunPhase::AwaitingVrf {
                        let row = simulated_campaign_vrf_row(seed, row_counter, weights);
                        engine.provide_vrf_row(row).unwrap();
                        row_counter += 1;
                    }
                    if engine.phase != RunPhase::Playing {
                        continue;
                    }
                }
            }
            let mut best: Option<CampaignMoveCandidate> = None;
            for row in 0..10 {
                for start in 0..8 {
                    for destination in 0..8 {
                        let mut candidate = engine;
                        let Ok(report) = candidate.play_move(
                            engine.moves,
                            row,
                            start,
                            destination,
                            level,
                            mutator,
                            100,
                        ) else {
                            continue;
                        };
                        let quality = (
                            candidate.level_satisfied(level),
                            candidate.phase != RunPhase::Finished,
                            u8::MAX - report.height_after,
                            campaign_constraint_signal(level, &candidate),
                            report.lines_cleared,
                            report.points_earned,
                        );
                        if best.as_ref().is_none_or(|best| quality > best.quality) {
                            best = Some(CampaignMoveCandidate {
                                engine: candidate,
                                quality,
                            });
                        }
                    }
                }
            }
            let Some(best) = best else {
                stuck = true;
                break;
            };
            engine = best.engine;
            bonus_used_since_move = false;
            if engine.phase == RunPhase::AwaitingVrf {
                let row = simulated_campaign_vrf_row(seed, row_counter, weights);
                engine.provide_vrf_row(row).unwrap();
                row_counter += 1;
            }
        }
        SimulatedCampaignAttempt {
            completed: engine.phase == RunPhase::LevelComplete,
            moves: engine.moves,
            score: engine.score,
            bonus_charges: engine.bonus_charges,
            stuck,
        }
    }

    fn simulated_campaign_vrf_row(seed: u32, counter: u32, weights: [u16; 5]) -> [u8; 8] {
        let seed = seed.to_le_bytes();
        let counter_bytes = counter.to_le_bytes();
        let randomness = sha256v(&[b"zkube-campaign-v2-simulation", &seed, &counter_bytes]);
        crate::game::row_from_vrf(randomness, counter, BlockWeights { values: weights }).unwrap()
    }

    #[test]
    fn campaign_perfection_and_guardian_unlock_are_derived_from_stars() {
        let owner = Pubkey::new_unique();
        let mut player = PlayerState::initialize(owner, 1);
        for level in 1..=LEVELS_PER_MAP as u8 {
            player
                .record_level_stars(1, level, if level == 4 { 2 } else { 3 })
                .unwrap();
        }
        assert!(player.zone_cleared(1).unwrap());
        assert!(!player.zone_perfected(1).unwrap());
        assert!(player.campaign_level_unlocked(2, 1).unwrap());
        player.record_level_stars(1, 4, 3).unwrap();
        assert!(player.zone_perfected(1).unwrap());
    }

    #[test]
    fn campaign_levels_track_only_monotonic_stars() {
        let owner = Pubkey::new_unique();
        let mut player = PlayerState::initialize(owner, 1);

        let one_star = player.record_level_stars(1, 1, 1).unwrap();
        assert_eq!(one_star, 1);

        let equal_replay = player.record_level_stars(1, 1, 1).unwrap();
        let worse_replay = player.record_level_stars(1, 1, 0).unwrap();
        assert_eq!(equal_replay, 0);
        assert_eq!(worse_replay, 0);

        let improved_to_three = player.record_level_stars(1, 1, 3).unwrap();
        assert_eq!(improved_to_three, 2);

        let fresh_two_star = player.record_level_stars(1, 2, 2).unwrap();
        let fresh_three_star = player.record_level_stars(1, 3, 3).unwrap();
        assert_eq!(fresh_two_star, 2);
        assert_eq!(fresh_three_star, 3);
        assert_eq!(player.best_stars(1, 1).unwrap(), 3);
    }

    #[test]
    fn ordinary_guardian_clear_unlocks_the_next_zone_without_extra_state() {
        let owner = Pubkey::new_unique();
        let mut player = PlayerState::initialize(owner, 1);
        for level in 1..=LEVELS_PER_MAP as u8 {
            player.record_level_stars(1, level, 2).unwrap();
        }
        assert!(player.zone_cleared(1).unwrap());
        assert!(player.campaign_level_unlocked(2, 1).unwrap());
        assert!(!player.zone_perfected(1).unwrap());
    }

    #[test]
    fn abandon_accepts_only_nonterminal_lifecycles() {
        assert!(abandon_lifecycle_is_allowed(RunLifecycle::Prepared));
        assert!(abandon_lifecycle_is_allowed(RunLifecycle::Delegated));
        assert!(abandon_lifecycle_is_allowed(RunLifecycle::AwaitingVrf));
        assert!(abandon_lifecycle_is_allowed(RunLifecycle::Playing));
        assert!(!abandon_lifecycle_is_allowed(RunLifecycle::LevelComplete));
        assert!(!abandon_lifecycle_is_allowed(RunLifecycle::Finished));
    }

    #[test]
    fn vrf_and_commit_order_rejects_duplicate_callbacks_and_early_results() {
        assert!(vrf_request_lifecycle_is_allowed(RunLifecycle::Delegated));
        assert!(vrf_request_lifecycle_is_allowed(RunLifecycle::AwaitingVrf));
        assert!(!vrf_request_lifecycle_is_allowed(RunLifecycle::Playing));
        assert!(vrf_fulfillment_lifecycle_is_allowed(
            RunLifecycle::AwaitingVrf
        ));
        assert!(!vrf_fulfillment_lifecycle_is_allowed(RunLifecycle::Playing));

        assert!(!run_has_terminal_projection(RunLifecycle::Playing, 10));
        assert!(!run_has_terminal_projection(RunLifecycle::Finished, 0));
        assert!(run_has_terminal_projection(RunLifecycle::Finished, 10));
        assert!(run_has_terminal_projection(RunLifecycle::LevelComplete, 10,));
    }
}
