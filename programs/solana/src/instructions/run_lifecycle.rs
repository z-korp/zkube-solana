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
    calculate_level_stars, opening_from_vrf, row_from_vrf, sha256v, BlockWeights, Bonus,
    Constraint, ConstraintKind, Grid, LevelRules, MoveReport, MutatorRules, RunEngine, RunError,
    RunPhase,
};
use crate::instructions::player_authorization::{
    require_player_authorization, require_player_rent_payer,
};
use crate::state::economy::{
    DailyScoringRule, CAMPAIGN_LEVEL_XP_PER_STAR, DAILY_SCORE_BLOCKS, DAILY_SCORE_CLASSIC,
    DAILY_SCORE_CLEAN, DAILY_SCORE_CLUTCH, DAILY_SCORE_COMBO, DAILY_SCORE_EXACT_LINES,
    DAILY_SCORE_SURVIVAL, PERFECT_MAP_STARS, PERFECT_MAP_XP,
};
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
    require!(
        vrf_fulfillment_lifecycle_is_allowed(active.lifecycle),
        ErrorCode::InvalidState
    );
    let request_counter = active.pending_vrf_counter;
    require_matching_vrf_callback(request_counter, expected_request_counter)?;
    let row_weights = if active.mode == RunMode::Daily {
        active.daily_pressure.block_weights[usize::from(active.current_difficulty.min(7))]
    } else {
        active.rules.block_weights
    };
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
    write_engine(active, &engine);
    active.pending_vrf_counter = 0;
    active.lifecycle = lifecycle_from_phase(engine.phase);
    Ok(())
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
        .play_move(expected_move, row, start, destination, level, mutator)
        .map_err(map_run_error)?;
    report.difficulty_at_action = difficulty_at_action;
    let terminal_at = terminal_action_timestamp(engine.phase)?;
    record_action_accounting(
        active,
        &engine,
        &report,
        combo_before,
        ActionKind::Move,
        pressure_multiplier_x100,
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
        .apply_bonus(row, column, level, mutator)
        .map_err(map_run_error)?;
    report.difficulty_at_action = difficulty_at_action;
    let terminal_at = terminal_action_timestamp(engine.phase)?;
    record_action_accounting(
        active,
        &engine,
        &report,
        combo_before,
        ActionKind::Bonus,
        pressure_multiplier_x100,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ActionKind {
    Move,
    Bonus,
}

fn action_mutator(active: &ActiveRun) -> Result<(MutatorRules, u16)> {
    let mut mutator = mutator_rules(&active.rules);
    if active.mode != RunMode::Daily {
        return Ok((mutator, 100));
    }
    let pressure_multiplier_x100 =
        active.daily_pressure.score_multipliers_x100[usize::from(active.current_difficulty.min(7))];
    let scaled = u32::from(mutator.score_multiplier_x100)
        .checked_mul(u32::from(pressure_multiplier_x100))
        .and_then(|value| value.checked_div(100))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    mutator.score_multiplier_x100 =
        u16::try_from(scaled).map_err(|_| error!(ErrorCode::ArithmeticOverflow))?;
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
    pressure_multiplier_x100: u16,
    terminal_at: i64,
) -> Result<()> {
    require!(active.version == ACCOUNT_VERSION, ErrorCode::InvalidVersion);
    write_engine(active, engine);
    active.total_lines_cleared = active
        .total_lines_cleared
        .checked_add(u16::from(report.lines_cleared))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    record_destroyed_blocks(active, report.blocks_destroyed_by_size)?;
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
        let (weighted_raw_bonus, awarded_bonus) =
            daily_challenge_bonus(active.daily_scoring_rule, report, pressure_multiplier_x100)?;
        active.pressure_score = active
            .pressure_score
            .checked_add(
                report
                    .neutral_points_earned
                    .checked_add(weighted_raw_bonus)
                    .ok_or(ErrorCode::ArithmeticOverflow)?,
            )
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        active.daily_score = active
            .daily_score
            .checked_add(
                report
                    .points_earned
                    .checked_add(awarded_bonus)
                    .ok_or(ErrorCode::ArithmeticOverflow)?,
            )
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        if awarded_bonus > 0 {
            active.daily_bonus_triggers = active
                .daily_bonus_triggers
                .checked_add(1)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
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
    if active.finished_at == 0 {
        active.finished_at = Clock::get()?.unix_timestamp;
    }
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
        ctx.accounts.active_run.mode == RunMode::Campaign,
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
        constraint = player_state.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
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
        ctx.accounts.player_state.active_run_id == active.run_id,
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
    let completed = active.lifecycle == RunLifecycle::LevelComplete;
    let stars = if completed {
        calculate_level_stars(
            active.rules.max_moves,
            active.moves,
            active.rules.star_threshold_modifier,
        )
    } else {
        0
    };
    let consumed_at = Clock::get()?.unix_timestamp;

    let newly_perfect = completed
        && stars == 3
        && ctx
            .accounts
            .player_state
            .best_stars(active.map_id, active.level)?
            < 3;
    ctx.accounts.player_state.record_run_metrics(
        RunProgressMetrics {
            lines_cleared: active.total_lines_cleared,
            bonus_uses: active.bonus_uses,
            combo2_hits: active.combo2_hits,
            combo3_hits: active.combo3_hits,
            combo4_hits: active.combo4_hits,
            high_combo_hits: active.high_combo_hits,
            blocks_destroyed_by_size: active.blocks_destroyed_by_size,
            max_combo: active.max_combo,
            campaign_level_completed: completed,
            new_perfect_level: newly_perfect,
            boss_cleared: completed && active.level == LEVELS_PER_MAP as u8,
        },
        consumed_at,
    )?;

    let reward = award_campaign_level_progression(
        &mut ctx.accounts.player_state,
        active.map_id,
        active.level,
        stars,
    )?;
    emit!(CampaignLevelRewarded {
        owner: active.owner,
        run_id: active.run_id,
        map_id: active.map_id,
        level: active.level,
        achieved_stars: stars,
        newly_earned_stars: reward.stars,
        xp: reward.xp,
    });
    update_campaign_unlocks(
        &mut ctx.accounts.player_state,
        active.map_id,
        active.level,
        completed,
    )?;
    award_map_perfection(&mut ctx.accounts.player_state, active.map_id)?;
    ctx.accounts.player_state.release_run(active.run_id)?;
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CampaignLevelReward {
    stars: u8,
    xp: u32,
}

/// Applies the lifetime-best reward delta for one campaign map-level. Keeping
/// the progress mutation and both credits behind one helper makes replay
/// idempotence explicit: equal or worse results return a zero reward.
fn award_campaign_level_progression(
    player: &mut PlayerState,
    map_id: u8,
    level: u8,
    achieved_stars: u8,
) -> Result<CampaignLevelReward> {
    let stars = player.record_level_stars(map_id, level, achieved_stars)?;
    let xp = u32::from(stars)
        .checked_mul(CAMPAIGN_LEVEL_XP_PER_STAR)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    player.credit_progression_rewards(u64::from(stars), xp)?;
    Ok(CampaignLevelReward { stars, xp })
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

fn update_campaign_unlocks(
    player: &mut PlayerState,
    map_id: u8,
    level: u8,
    completed: bool,
) -> Result<()> {
    if !completed || level != LEVELS_PER_MAP as u8 {
        return Ok(());
    }
    let bit = 1u32 << (map_id - 1);
    player.cleared_maps |= bit;
    if map_id == 1 {
        player.daily_eligible = true;
    }
    Ok(())
}

fn award_map_perfection(player: &mut PlayerState, map_id: u8) -> Result<bool> {
    let perfected = (1..=LEVELS_PER_MAP as u8)
        .all(|candidate| player.best_stars(map_id, candidate).ok() == Some(3));
    if !perfected {
        return Ok(false);
    }
    let bit = 1u32
        .checked_shl(u32::from(map_id.saturating_sub(1)))
        .ok_or(ErrorCode::InvalidMap)?;
    if player.perfected_maps & bit != 0 {
        return Ok(false);
    }
    player.perfected_maps |= bit;
    player.credit_progression_rewards(PERFECT_MAP_STARS, PERFECT_MAP_XP)?;
    emit!(MapPerfected {
        owner: player.owner,
        map_id,
        stars: PERFECT_MAP_STARS,
        xp: PERFECT_MAP_XP,
    });
    Ok(true)
}

#[event]
pub struct CampaignLevelRewarded {
    pub owner: Pubkey,
    pub run_id: u64,
    pub map_id: u8,
    pub level: u8,
    pub achieved_stars: u8,
    pub newly_earned_stars: u8,
    pub xp: u32,
}

#[event]
pub struct MapPerfected {
    pub owner: Pubkey,
    pub map_id: u8,
    pub stars: u64,
    pub xp: u32,
}

fn delegation_record_validator(data: &[u8]) -> Result<Pubkey> {
    use ephemeral_rollups_sdk::dlp_api::state::DelegationRecord;

    let record = DelegationRecord::try_from_bytes_with_discriminator(data)
        .map_err(|_| error!(ErrorCode::InvalidMagicProgram))?;
    Ok(Pubkey::new_from_array(record.authority.to_bytes()))
}

fn constraint(snapshot: ConstraintSnapshot) -> Result<Constraint> {
    let kind = match snapshot.kind {
        0 => ConstraintKind::None,
        1 => ConstraintKind::ComboLines,
        2 => ConstraintKind::BreakBlocks,
        3 => ConstraintKind::ComboMeter,
        _ => return err!(ErrorCode::InvalidLevel),
    };
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
        score_multiplier_x100: snapshot.score_multiplier_x100,
        combo_multiplier_x100: snapshot.combo_multiplier_x100,
        line_clear_bonus: snapshot.line_clear_bonus,
        perfect_clear_bonus: snapshot.perfect_clear_bonus,
        star_threshold_modifier: snapshot.star_threshold_modifier,
        bonus_trigger_type: snapshot.bonus_trigger_type,
        bonus_threshold: snapshot.bonus_threshold,
    }
}

fn daily_challenge_bonus(
    rule: DailyScoringRule,
    report: &MoveReport,
    pressure_multiplier_x100: u16,
) -> Result<(u32, u32)> {
    rule.validate()?;
    let lines = report.lines_cleared;
    let raw_points = match rule.kind {
        DAILY_SCORE_CLASSIC => 0,
        DAILY_SCORE_COMBO if lines >= rule.parameter => report.neutral_points_earned,
        DAILY_SCORE_COMBO => 0,
        DAILY_SCORE_EXACT_LINES if lines == rule.parameter => report.neutral_points_earned,
        DAILY_SCORE_EXACT_LINES => 0,
        DAILY_SCORE_BLOCKS => u32::from(
            report.blocks_destroyed_by_size[usize::from(rule.parameter.saturating_sub(1))],
        ),
        DAILY_SCORE_CLUTCH if lines > 0 && report.height_before >= rule.parameter => {
            report.neutral_points_earned
        }
        DAILY_SCORE_CLUTCH => 0,
        DAILY_SCORE_CLEAN if lines > 0 && report.height_after <= rule.parameter => {
            report.neutral_points_earned
        }
        DAILY_SCORE_CLEAN => 0,
        DAILY_SCORE_SURVIVAL => 1,
        _ => return err!(ErrorCode::InvalidLevel),
    };
    let weighted_raw = scale_daily_points(raw_points, rule.bonus_multiplier_x100)?;
    let awarded = scale_daily_points(weighted_raw, pressure_multiplier_x100)?;
    Ok((weighted_raw, awarded))
}

fn scale_daily_points(points: u32, multiplier_x100: u16) -> Result<u32> {
    let scaled = u64::from(points)
        .checked_mul(u64::from(multiplier_x100))
        .and_then(|value| value.checked_div(100))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    u32::try_from(scaled).map_err(|_| error!(ErrorCode::ArithmeticOverflow))
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
        level_lines_cleared: active.level_lines_cleared,
        bonus,
        bonus_charges: active.bonus_charges,
        perfect_trigger_available: active.perfect_trigger_available,
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
    active.level_lines_cleared = engine.level_lines_cleared;
    active.bonus_type = match engine.bonus {
        None => 0,
        Some(Bonus::Hammer) => 1,
        Some(Bonus::Totem) => 2,
        Some(Bonus::Wave) => 3,
    };
    active.bonus_charges = engine.bonus_charges;
    active.perfect_trigger_available = engine.perfect_trigger_available;
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
        | RunError::NoBonusCharge => error!(ErrorCode::InvalidState),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::economy::{
        canonical_daily_scoring_rules, DailyPressureProfile, DAILY_MAX_MOVES,
    };
    use anchor_lang::{InstructionData, ToAccountMetas};

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
            kind: 4,
            value: 0,
            required_count: 0,
        })
        .is_err());
    }

    #[test]
    fn daily_challenge_bonus_uses_objective_weight_then_pressure() {
        let report = MoveReport {
            lines_cleared: 3,
            points_earned: 42,
            neutral_points_earned: 6,
            height_before: 7,
            height_after: 2,
            blocks_destroyed_by_size: [1, 2, 3, 4],
            difficulty_at_action: 4,
            ..MoveReport::default()
        };
        let rule = |kind, parameter, bonus_multiplier_x100| DailyScoringRule {
            id: 1,
            family: match kind {
                DAILY_SCORE_CLASSIC => 0,
                DAILY_SCORE_COMBO => 1,
                DAILY_SCORE_EXACT_LINES => 2,
                DAILY_SCORE_BLOCKS => 3,
                DAILY_SCORE_CLUTCH => 4,
                DAILY_SCORE_CLEAN => 5,
                _ => 6,
            },
            kind,
            parameter,
            bonus_multiplier_x100,
        };
        assert_eq!(
            daily_challenge_bonus(rule(DAILY_SCORE_CLASSIC, 0, 0), &report, 140).unwrap(),
            (0, 0)
        );
        assert_eq!(
            daily_challenge_bonus(rule(DAILY_SCORE_COMBO, 2, 500), &report, 140).unwrap(),
            (30, 42)
        );
        assert_eq!(
            daily_challenge_bonus(rule(DAILY_SCORE_EXACT_LINES, 1, 100), &report, 140).unwrap(),
            (0, 0)
        );
        assert_eq!(
            daily_challenge_bonus(rule(DAILY_SCORE_EXACT_LINES, 3, 100), &report, 140).unwrap(),
            (6, 8)
        );
        assert_eq!(
            daily_challenge_bonus(rule(DAILY_SCORE_BLOCKS, 2, 100), &report, 140).unwrap(),
            (2, 2)
        );
        assert_eq!(
            daily_challenge_bonus(rule(DAILY_SCORE_CLUTCH, 7, 100), &report, 140).unwrap(),
            (6, 8)
        );
        assert_eq!(
            daily_challenge_bonus(rule(DAILY_SCORE_CLEAN, 2, 100), &report, 140).unwrap(),
            (6, 8)
        );
        assert_eq!(
            daily_challenge_bonus(rule(DAILY_SCORE_SURVIVAL, 0, 100), &report, 140).unwrap(),
            (1, 1)
        );
    }

    fn accounting_fixture(rule: DailyScoringRule) -> (ActiveRun, RunEngine, MoveReport) {
        let active = ActiveRun {
            version: ACCOUNT_VERSION,
            mode: RunMode::Daily,
            lifecycle: RunLifecycle::Playing,
            daily_scoring_rule: rule,
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
    fn moves_and_bonuses_share_checked_daily_action_accounting() {
        let rule = DailyScoringRule {
            id: 4,
            family: 2,
            kind: DAILY_SCORE_EXACT_LINES,
            parameter: 2,
            bonus_multiplier_x100: 100,
        };
        let (mut move_run, engine, report) = accounting_fixture(rule);
        let (mut bonus_run, _, _) = accounting_fixture(rule);
        record_action_accounting(
            &mut move_run,
            &engine,
            &report,
            9,
            ActionKind::Move,
            100,
            123,
        )
        .unwrap();
        record_action_accounting(
            &mut bonus_run,
            &engine,
            &report,
            9,
            ActionKind::Bonus,
            100,
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
        assert_eq!(move_run.daily_score, 35);
        assert_eq!(move_run.pressure_score, 20);
        assert_eq!(move_run.daily_bonus_triggers, 1);
        assert_eq!(
            move_run.daily_bonus_triggers,
            bonus_run.daily_bonus_triggers
        );
        assert_eq!(move_run.finished_at, 123);
        assert_eq!(move_run.lifecycle, RunLifecycle::LevelComplete);
        assert_eq!((move_run.bonus_uses, bonus_run.bonus_uses), (0, 1));
    }

    #[test]
    fn classic_daily_actions_never_increment_bonus_triggers() {
        let rule = DailyScoringRule {
            id: 1,
            family: 0,
            kind: DAILY_SCORE_CLASSIC,
            parameter: 0,
            bonus_multiplier_x100: 0,
        };
        let (mut active, engine, report) = accounting_fixture(rule);
        record_action_accounting(&mut active, &engine, &report, 9, ActionKind::Move, 100, 456)
            .unwrap();
        assert_eq!(active.daily_score, report.points_earned);
        assert_eq!(active.daily_bonus_triggers, 0);
        assert_eq!(active.finished_at, 456);
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

    /// Offline balancing harness, deliberately excluded from the fast gate.
    /// Run with:
    /// `cargo test -p solana daily_catalog_simulation -- --ignored --nocapture`
    #[test]
    #[ignore = "offline Daily balance simulation"]
    fn daily_catalog_simulation() {
        let pressure = DailyPressureProfile::canonical();
        let seed_count = std::env::var("DAILY_SIMULATION_SEEDS")
            .ok()
            .and_then(|value| value.parse::<u32>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(64);
        println!(
            "seeds={seed_count}\nrule_id,family,kind,parameter,weight,min_moves,mean_moves,max_moves,mean_engine,mean_bonus,bonus_share,mean_daily,tier7_by_50,stuck"
        );
        for rule in canonical_daily_scoring_rules().into_iter().take(15) {
            let attempts = (0..seed_count)
                .map(|seed| simulate_daily_attempt(rule, pressure, seed))
                .collect::<Vec<_>>();
            assert!(attempts
                .iter()
                .all(|attempt| attempt.moves <= DAILY_MAX_MOVES));
            assert!(attempts.iter().all(|attempt| {
                attempt.daily_score == attempt.engine_score.saturating_add(attempt.challenge_bonus)
            }));
            if rule.kind != DAILY_SCORE_CLASSIC {
                assert!(attempts.iter().any(|attempt| attempt.challenge_bonus > 0));
            }
            let min_moves = attempts
                .iter()
                .map(|attempt| attempt.moves)
                .min()
                .unwrap_or(0);
            let max_moves = attempts
                .iter()
                .map(|attempt| attempt.moves)
                .max()
                .unwrap_or(0);
            let total_moves = attempts
                .iter()
                .map(|attempt| u64::from(attempt.moves))
                .sum::<u64>();
            let total_engine = attempts
                .iter()
                .map(|attempt| u64::from(attempt.engine_score))
                .sum::<u64>();
            let total_bonus = attempts
                .iter()
                .map(|attempt| u64::from(attempt.challenge_bonus))
                .sum::<u64>();
            let total_daily = attempts
                .iter()
                .map(|attempt| u64::from(attempt.daily_score))
                .sum::<u64>();
            let tier7_by_50 = attempts
                .iter()
                .filter(|attempt| {
                    attempt
                        .tier7_move
                        .is_some_and(|move_number| move_number <= 50)
                })
                .count();
            let stuck = attempts.iter().filter(|attempt| attempt.stuck).count();
            println!(
                "{},{},{},{},{},{},{:.1},{},{:.1},{:.1},{:.1}%,{:.1},{:.1}%,{}",
                rule.id,
                rule.family,
                rule.kind,
                rule.parameter,
                rule.bonus_multiplier_x100,
                min_moves,
                total_moves as f64 / attempts.len() as f64,
                max_moves,
                total_engine as f64 / attempts.len() as f64,
                total_bonus as f64 / attempts.len() as f64,
                if total_daily == 0 {
                    0.0
                } else {
                    total_bonus as f64 * 100.0 / total_daily as f64
                },
                total_daily as f64 / attempts.len() as f64,
                tier7_by_50 as f64 * 100.0 / attempts.len() as f64,
                stuck,
            );
        }
    }

    #[derive(Clone, Copy)]
    struct SimulatedDailyAttempt {
        moves: u16,
        engine_score: u32,
        daily_score: u32,
        challenge_bonus: u32,
        tier7_move: Option<u16>,
        stuck: bool,
    }

    struct SimulatedMoveCandidate {
        engine: RunEngine,
        report: MoveReport,
        weighted_raw_bonus: u32,
        awarded_bonus: u32,
        quality: (u32, u32, u8, u8),
    }

    fn simulate_daily_attempt(
        rule: DailyScoringRule,
        pressure: DailyPressureProfile,
        seed: u32,
    ) -> SimulatedDailyAttempt {
        let level = LevelRules {
            points_required: u32::MAX,
            max_moves: pressure.max_moves,
            primary: Constraint::default(),
            secondary: Constraint::default(),
        };
        let mut engine = RunEngine {
            phase: RunPhase::AwaitingVrf,
            starting_height_target: pressure.starting_height,
            ..RunEngine::default()
        };
        let mut row_counter = 0u32;
        while engine.next_row.is_none() {
            let row = simulated_vrf_row(seed, row_counter, pressure.block_weights[0]);
            engine.provide_vrf_row(row).unwrap();
            row_counter += 1;
            assert!(
                row_counter < 64,
                "seed stack failed to reach its target height"
            );
        }

        let mut daily_score = 0u32;
        let mut challenge_bonus = 0u32;
        let mut pressure_score = 0u32;
        let mut tier7_move = None;
        let mut stuck = false;
        while engine.phase == RunPhase::Playing && engine.moves < pressure.max_moves {
            let tier = pressure.difficulty_for_score(pressure_score);
            let mut best: Option<SimulatedMoveCandidate> = None;
            for row in 0..10 {
                for start in 0..8 {
                    for destination in 0..8 {
                        let mut candidate = engine;
                        let mutator = MutatorRules {
                            score_multiplier_x100: pressure.score_multipliers_x100
                                [usize::from(tier)],
                            ..MutatorRules::default()
                        };
                        let Ok(mut report) = candidate.play_move(
                            engine.moves,
                            row,
                            start,
                            destination,
                            level,
                            mutator,
                        ) else {
                            continue;
                        };
                        report.difficulty_at_action = tier;
                        let multiplier = pressure.score_multipliers_x100[usize::from(tier)];
                        let (weighted_raw_bonus, awarded_bonus) =
                            daily_challenge_bonus(rule, &report, multiplier).unwrap();
                        let quality = (
                            awarded_bonus,
                            report.neutral_points_earned,
                            report.lines_cleared,
                            u8::MAX - report.height_after,
                        );
                        if best.as_ref().is_none_or(|best| quality > best.quality) {
                            best = Some(SimulatedMoveCandidate {
                                engine: candidate,
                                report,
                                weighted_raw_bonus,
                                awarded_bonus,
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
            daily_score = daily_score
                .saturating_add(best.report.points_earned)
                .saturating_add(best.awarded_bonus);
            challenge_bonus = challenge_bonus.saturating_add(best.awarded_bonus);
            pressure_score = pressure_score
                .saturating_add(best.report.neutral_points_earned)
                .saturating_add(best.weighted_raw_bonus);
            if tier7_move.is_none() && pressure.difficulty_for_score(pressure_score) == 7 {
                tier7_move = Some(engine.moves);
            }
            if engine.phase == RunPhase::AwaitingVrf {
                let next_tier = pressure.difficulty_for_score(pressure_score);
                let row = simulated_vrf_row(
                    seed,
                    row_counter,
                    pressure.block_weights[usize::from(next_tier)],
                );
                engine.provide_vrf_row(row).unwrap();
                row_counter += 1;
            }
        }
        SimulatedDailyAttempt {
            moves: engine.moves,
            engine_score: engine.score,
            daily_score,
            challenge_bonus,
            tier7_move,
            stuck,
        }
    }

    fn simulated_vrf_row(seed: u32, counter: u32, weights: [u16; 5]) -> [u8; 8] {
        let seed = seed.to_le_bytes();
        let counter_bytes = counter.to_le_bytes();
        let randomness = sha256v(&[b"zkube-daily-simulation-v1", &seed, &counter_bytes]);
        crate::game::row_from_vrf(randomness, counter, BlockWeights { values: weights }).unwrap()
    }

    #[test]
    fn final_non_boss_rating_awards_map_perfection_once_without_unlocking_next_map() {
        let owner = Pubkey::new_unique();
        let mut player = PlayerState::initialize(owner, 1);
        for level in 1..=LEVELS_PER_MAP as u8 {
            player
                .record_level_stars(1, level, if level == 4 { 2 } else { 3 })
                .unwrap();
        }
        player.next_run_id = 2;
        update_campaign_unlocks(&mut player, 1, 10, true).unwrap();
        assert!(!award_map_perfection(&mut player, 1).unwrap());
        player.record_level_stars(1, 4, 3).unwrap();
        assert!(award_map_perfection(&mut player, 1).unwrap());
        assert!(player.daily_eligible);
        assert!(!player.is_map_unlocked(2));
        assert_eq!(player.cleared_maps, 1);
        assert_eq!(player.perfected_maps, 1);
        assert_eq!(player.stars_balance, PERFECT_MAP_STARS);
        assert_eq!(player.lifetime_xp, u64::from(PERFECT_MAP_XP));
        assert!(!award_map_perfection(&mut player, 1).unwrap());
        assert_eq!(player.stars_balance, PERFECT_MAP_STARS);
        assert_eq!(player.lifetime_xp, u64::from(PERFECT_MAP_XP));
    }

    #[test]
    fn campaign_level_xp_tracks_only_lifetime_star_improvements() {
        let owner = Pubkey::new_unique();
        let mut player = PlayerState::initialize(owner, 1);

        let one_star = award_campaign_level_progression(&mut player, 1, 1, 1).unwrap();
        assert_eq!(one_star, CampaignLevelReward { stars: 1, xp: 10 });

        let equal_replay = award_campaign_level_progression(&mut player, 1, 1, 1).unwrap();
        let worse_replay = award_campaign_level_progression(&mut player, 1, 1, 0).unwrap();
        assert_eq!(equal_replay, CampaignLevelReward { stars: 0, xp: 0 });
        assert_eq!(worse_replay, CampaignLevelReward { stars: 0, xp: 0 });

        let improved_to_three = award_campaign_level_progression(&mut player, 1, 1, 3).unwrap();
        assert_eq!(improved_to_three, CampaignLevelReward { stars: 2, xp: 20 });

        let fresh_two_star = award_campaign_level_progression(&mut player, 1, 2, 2).unwrap();
        let fresh_three_star = award_campaign_level_progression(&mut player, 1, 3, 3).unwrap();
        assert_eq!(fresh_two_star, CampaignLevelReward { stars: 2, xp: 20 });
        assert_eq!(fresh_three_star, CampaignLevelReward { stars: 3, xp: 30 });
        assert_eq!(player.best_stars(1, 1).unwrap(), 3);
        assert_eq!(player.stars_balance, 8);
        assert_eq!(player.lifetime_stars_earned, 8);
        assert_eq!(player.lifetime_xp, 80);
    }

    #[test]
    fn ordinary_boss_clear_enables_daily_without_unlocking_the_next_map() {
        let owner = Pubkey::new_unique();
        let mut player = PlayerState::initialize(owner, 1);
        for level in 1..=LEVELS_PER_MAP as u8 {
            player.record_level_stars(1, level, 2).unwrap();
        }
        update_campaign_unlocks(&mut player, 1, 10, true).unwrap();
        assert!(player.daily_eligible);
        assert!(!player.is_map_unlocked(2));
        assert_eq!(player.cleared_maps, 1);
        assert_eq!(player.perfected_maps, 0);
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
