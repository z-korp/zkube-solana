//! MagicBlock run delegation, VRF, play, copyback, and durable cleanup.
//!
//! `ActiveRun` is authoritative on the Router-resolved ER only while delegated.
//! Terminal state is timestamped by the action that reaches it, then committed
//! and copied back before a Solana-base
//! consumer may update durable progression. That same instruction closes the
//! single transient account and returns rent to its
//! stored rent payer.

use anchor_lang::{prelude::*, Discriminator};
use ephemeral_rollups_sdk::anchor::{commit, delegate};
use ephemeral_rollups_sdk::anchor::{vrf, vrf_callback};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};
use session_keys::SessionTokenV2;

use crate::error::ErrorCode;
use crate::instructions::player_authorization::require_player_authorization;
use crate::state::arcade::SolanaSha256;
use crate::state::protocol::*;
use zkube_core::{Bonus, ConstraintKind, Grid, RunEngine, RunPhase};

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
#[derive(Accounts)]
pub struct RunVrf<'info> {
    #[account(
        mut,
        owner = crate::ID,
        constraint = active_run.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub active_run: Box<Account<'info, ActiveRun>>,
    /// CHECK: Logical wallet authority, bound to the active run.
    #[account(address = active_run.owner @ ErrorCode::Unauthorized)]
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    #[account(mut)]
    pub actor: Signer<'info>,
    /// CHECK: Address-constrained to MagicBlock's devnet ER queue.
    #[account(mut, address = ephemeral_rollups_sdk::vrf::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
    /// CHECK: Address/owner constrained; the handler validates the SDK record before use.
    #[account(
        address = ephemeral_rollups_sdk::pda::delegation_record_pda_from_delegated_account(&active_run.key().to_bytes().into()).to_bytes().into(),
        owner = Pubkey::new_from_array(ephemeral_rollups_sdk::id().to_bytes()) @ ErrorCode::InvalidOwner
    )]
    pub delegation_record_active: UncheckedAccount<'info>,
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
    let caller_seed = zkube_core::sha256v_with::<SolanaSha256>(&[
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

pub fn handler_request_vrf(ctx: Context<RunVrf>, client_seed: [u8; 32]) -> Result<()> {
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
        .invoke_signed_vrf(&ctx.accounts.actor.to_account_info(), &ix)?;
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
    /// owner's base-layer device-rent flow.
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
    let rules = run_rules(active)?;
    let mut run = run_from_active(active, rules)?;
    run.apply_vrf_observed_with::<SolanaSha256, _>(
        rules,
        request_counter,
        randomness,
        &mut zkube_core::NoPresentation,
    )
    .map_err(map_transition_error)?;
    write_run(active, &run, 0)?;
    active.pending_vrf_counter = 0;
    Ok(())
}

pub fn handler_play_move(
    ctx: Context<RunVrf>,
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
    let rules = run_rules(active)?;
    let mut run = run_from_active(active, rules)?;
    run.play_move_observed_with::<SolanaSha256, _>(
        rules,
        expected_action,
        expected_move,
        row,
        start,
        destination,
        &mut zkube_core::NoPresentation,
    )
    .map_err(map_transition_error)?;
    let terminal_at = terminal_action_timestamp(run.engine.phase)?;
    write_run(active, &run, terminal_at)?;
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
            .invoke_signed_vrf(&ctx.accounts.actor.to_account_info(), &ix)?;
    }
    Ok(())
}

pub fn handler_apply_bonus(
    ctx: Context<RunVrf>,
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
    let rules = run_rules(active)?;
    let mut run = run_from_active(active, rules)?;
    run.apply_bonus_observed_with::<SolanaSha256, _>(
        rules,
        expected_action,
        row,
        column,
        &mut zkube_core::NoPresentation,
    )
    .map_err(map_transition_error)?;
    let terminal_at = terminal_action_timestamp(run.engine.phase)?;
    write_run(active, &run, terminal_at)?;
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
            .invoke_signed_vrf(&ctx.accounts.actor.to_account_info(), &ix)?;
    }
    Ok(())
}

pub fn handler_request_reroll(
    ctx: Context<RunVrf>,
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
        .invoke_signed_vrf(&ctx.accounts.actor.to_account_info(), &ix)?;
    Ok(())
}

/// A reroll is an accepted action. It folds its own replay event and leaves
/// the run awaiting the domain-separated replacement preview, so a pending
/// reroll with no move still scores at the deadline. The old preview remains
/// visible until the callback lands.
fn apply_reroll_request(active: &mut ActiveRun, expected_action: u32) -> Result<()> {
    let rules = run_rules(active)?;
    let mut run = run_from_active(active, rules)?;
    run.request_reroll_with::<SolanaSha256>(rules, expected_action)
        .map_err(map_transition_error)?;
    write_run(active, &run, 0)?;
    Ok(())
}

fn terminal_action_timestamp(phase: RunPhase) -> Result<i64> {
    if phase == RunPhase::Finished {
        return Ok(Clock::get()?.unix_timestamp);
    }
    Ok(0)
}

fn require_before_arcade_deadline(active: &ActiveRun, now: i64) -> Result<()> {
    require!(
        active.deadline_at > 0 && now < active.deadline_at,
        ErrorCode::InvalidPeriod
    );
    Ok(())
}

#[derive(Accounts)]
pub struct FinishRun<'info> {
    #[account(
        mut,
        owner = crate::ID,
        constraint = active_run.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub active_run: Account<'info, ActiveRun>,
    /// CHECK: Logical wallet authority, bound to the active run.
    #[account(address = active_run.owner @ ErrorCode::Unauthorized)]
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
}

/// Resolve a run through one exact terminal predicate table. Abandon is
/// owner/session-authorized before the cutoff; deadline resolution is
/// permissionless at or after a Daily cutoff.
pub fn handler_finish_run(ctx: Context<FinishRun>, reason: RunFinishReason) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let active = &mut ctx.accounts.active_run;
    match reason {
        RunFinishReason::Abandon => {
            require_player_authorization(
                active.owner,
                ctx.accounts.actor.key(),
                ctx.accounts.session_token.as_ref(),
            )?;
            if active.lifecycle == RunLifecycle::Finished
                && active.finish_reason == Some(RunFinishReason::Abandon)
            {
                return Ok(());
            }
            require_before_arcade_deadline(active, now)?;
        }
        RunFinishReason::Deadline => {
            require!(
                active.deadline_at > 0 && now >= active.deadline_at,
                ErrorCode::InvalidPeriod
            );
            if active.lifecycle == RunLifecycle::Finished
                && active.finish_reason == Some(RunFinishReason::Deadline)
            {
                return Ok(());
            }
        }
    }
    require!(
        finish_lifecycle_is_allowed(reason, active.lifecycle),
        ErrorCode::InvalidState
    );
    let rules = run_rules(active)?;
    let mut run = run_from_active(active, rules)?;
    let core_reason = match reason {
        RunFinishReason::Abandon => zkube_core::RunEndReason::Abandoned,
        RunFinishReason::Deadline => zkube_core::RunEndReason::Deadline,
    };
    run.finish_observed_with::<SolanaSha256, _>(
        rules,
        core_reason,
        &mut zkube_core::NoPresentation,
    )
    .map_err(map_transition_error)?;
    let terminal_at = match reason {
        RunFinishReason::Abandon => now,
        RunFinishReason::Deadline => active.deadline_at,
    };
    write_run(active, &run, terminal_at)?;
    active.pending_vrf_counter = 0;
    Ok(())
}

fn finish_lifecycle_is_allowed(reason: RunFinishReason, lifecycle: RunLifecycle) -> bool {
    match reason {
        RunFinishReason::Abandon => matches!(
            lifecycle,
            RunLifecycle::Prepared
                | RunLifecycle::Delegated
                | RunLifecycle::AwaitingVrf
                | RunLifecycle::Playing
        ),
        RunFinishReason::Deadline => matches!(
            lifecycle,
            RunLifecycle::Delegated | RunLifecycle::AwaitingVrf | RunLifecycle::Playing
        ),
    }
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
    require!(pending > 0, ErrorCode::InvalidState);
    require!(pending == expected, ErrorCode::VrfRequestMismatch);
    Ok(())
}

fn action_needs_row_vrf(lifecycle: RunLifecycle) -> bool {
    lifecycle == RunLifecycle::AwaitingVrf
}

fn run_has_terminal_projection(lifecycle: RunLifecycle, finished_at: i64) -> bool {
    matches!(lifecycle, RunLifecycle::Finished) && finished_at > 0
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
    #[account(mut, address = ephemeral_rollups_sdk::consts::MAGIC_CONTEXT_ID @ ErrorCode::InvalidOwner)]
    pub magic_context: UncheckedAccount<'info>,
    pub magic_program: Program<'info, ephemeral_rollups_sdk::anchor::MagicProgram>,
}

pub fn handler_commit_run(ctx: Context<CommitRun>) -> Result<()> {
    require!(
        run_has_terminal_projection(
            ctx.accounts.active_run.lifecycle,
            ctx.accounts.active_run.finished_at,
        ),
        ErrorCode::InvalidState
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

fn delegation_record_validator(data: &[u8]) -> Result<Pubkey> {
    use ephemeral_rollups_sdk::dlp_api::state::DelegationRecord;

    let record = DelegationRecord::try_from_bytes_with_discriminator(data)
        .map_err(|_| error!(ErrorCode::InvalidOwner))?;
    Ok(Pubkey::new_from_array(record.authority.to_bytes()))
}

fn run_rules(active: &ActiveRun) -> Result<zkube_core::RunRules> {
    let guardian = active.rules.guardian.to_core()?;
    let theme = active.daily_theme.to_core()?;
    let objective = (theme.kind != ConstraintKind::None).then_some(theme);
    let max_moves = zkube_core::DAILY_MAX_MOVES;
    let tier = zkube_core::TierPolicy::Pressure;
    let stars = None;
    let rules = zkube_core::RunRules {
        guardian,
        starting_height: active.rules.starting_rows,
        max_moves,
        tier,
        stars,
        objective,
    };
    require!(rules.is_valid(), ErrorCode::InvalidState);
    Ok(rules)
}

fn engine_from_active(active: &ActiveRun) -> Result<RunEngine> {
    let bonus = match active.bonus_type {
        0 => None,
        tag => Some(Bonus::from_tag(tag).ok_or(ErrorCode::InvalidState)?),
    };
    let phase = match active.lifecycle {
        RunLifecycle::Prepared | RunLifecycle::Delegated | RunLifecycle::AwaitingVrf => {
            RunPhase::AwaitingVrf
        }
        RunLifecycle::Playing => RunPhase::Playing,
        RunLifecycle::Finished => RunPhase::Finished,
    };
    Ok(RunEngine::daily(
        Grid::try_from_cells(active.grid).map_err(|_| error!(ErrorCode::InvalidState))?,
        active.has_next_row.then_some(active.next_row),
        phase,
        active.score,
        active.moves,
        active.combo_counter,
        active.max_combo,
        active.streak,
        active.charges_earned,
        active.level_lines_cleared,
        bonus,
        active.bonus_charges,
        active.reroll_charges,
    ))
}

fn write_engine(active: &mut ActiveRun, engine: &RunEngine) {
    active.grid = *engine.grid.cells();
    active.next_row = engine.next_row.unwrap_or_default();
    active.has_next_row = engine.next_row.is_some();
    active.score = engine.score;
    active.moves = engine.moves;
    active.combo_counter = engine.combo_counter;
    active.max_combo = engine.max_combo;
    active.streak = engine.streak;
    active.charges_earned = engine.charges_earned;
    active.level_lines_cleared = engine.level_lines_cleared;
    active.bonus_type = match engine.bonus {
        None => 0,
        Some(bonus) => bonus.tag(),
    };
    active.bonus_charges = engine.bonus_charges;
    active.reroll_charges = engine.reroll_charges;
}

fn run_from_active(active: &ActiveRun, rules: zkube_core::RunRules) -> Result<zkube_core::Run> {
    let last_vrf_counter = if active.pending_vrf_counter > 0 {
        active
            .vrf_request_counter
            .checked_sub(1)
            .ok_or(ErrorCode::InvalidState)?
    } else {
        active.vrf_request_counter
    };
    let end_reason = match active.lifecycle {
        RunLifecycle::Finished => Some(match active.finish_reason {
            None => zkube_core::RunEndReason::Exhausted,
            Some(RunFinishReason::Abandon) => zkube_core::RunEndReason::Abandoned,
            Some(RunFinishReason::Deadline) => zkube_core::RunEndReason::Deadline,
        }),
        _ if active.finish_reason.is_some() => return err!(ErrorCode::InvalidState),
        _ => None,
    };
    Ok(zkube_core::Run {
        engine: engine_from_active(active)?,
        action_counter: active.action_counter,
        daily_score: active.daily_score,
        objective_total: active.objective_total,
        pressure_score: active.pressure_score,
        current_tier: rules.current_tier(active.pressure_score),
        last_vrf_counter,
        replay: zkube_core::ReplayCommitment(active.replay_hash),
        rules_hash: zkube_core::RulesHash(active.rules_hash),
        rules_snapshot_hash: rules.snapshot_hash_with::<SolanaSha256>(),
        end_reason,
    })
}

/// Project core state into the account layout, including offline fixture output.
pub fn write_run(active: &mut ActiveRun, run: &zkube_core::Run, terminal_at: i64) -> Result<()> {
    let lifecycle = lifecycle_from_phase(run.engine.phase)?;
    let finish_reason = match run.end_reason {
        Some(zkube_core::RunEndReason::Abandoned) => Some(RunFinishReason::Abandon),
        Some(zkube_core::RunEndReason::Deadline) => Some(RunFinishReason::Deadline),
        Some(zkube_core::RunEndReason::Exhausted) | None => None,
        _ => return err!(ErrorCode::InvalidState),
    };
    write_engine(active, &run.engine);
    active.action_counter = run.action_counter;
    active.daily_score = run.daily_score;
    active.objective_total = run.objective_total;
    active.pressure_score = run.pressure_score;
    active.replay_hash = run.replay.to_bytes();
    active.lifecycle = lifecycle;
    active.finish_reason = finish_reason;
    if matches!(active.lifecycle, RunLifecycle::Finished) && active.finished_at == 0 {
        require!(terminal_at > 0, ErrorCode::InvalidState);
        active.finished_at = terminal_at;
    }
    Ok(())
}

fn lifecycle_from_phase(phase: RunPhase) -> Result<RunLifecycle> {
    Ok(match phase {
        RunPhase::AwaitingVrf => RunLifecycle::AwaitingVrf,
        RunPhase::Playing => RunLifecycle::Playing,
        RunPhase::Finished => RunLifecycle::Finished,
        _ => return err!(ErrorCode::InvalidState),
    })
}

fn map_run_error(error: zkube_core::RunError) -> anchor_lang::error::Error {
    match error {
        zkube_core::RunError::InvalidExpectedMove => error!(ErrorCode::InvalidMoveOrder),
        zkube_core::RunError::Grid(_) => error!(ErrorCode::InvalidMove),
        zkube_core::RunError::MoveLimitReached => error!(ErrorCode::GameOver),
        zkube_core::RunError::InvalidPhase
        | zkube_core::RunError::MissingNextRow
        | zkube_core::RunError::RowAlreadyAvailable
        | zkube_core::RunError::NoBonusCharge
        | zkube_core::RunError::NoRerollAvailable
        | zkube_core::RunError::RerollRequiresVrf => error!(ErrorCode::InvalidState),
    }
}

fn map_transition_error(error: zkube_core::RunTransitionError) -> anchor_lang::error::Error {
    match error {
        zkube_core::RunTransitionError::Engine(error) => map_run_error(error),
        zkube_core::RunTransitionError::InvalidActionOrder => {
            error!(ErrorCode::InvalidMoveOrder)
        }
        zkube_core::RunTransitionError::InvalidVrfOrder => {
            error!(ErrorCode::VrfRequestMismatch)
        }
        zkube_core::RunTransitionError::Randomness(_) => {
            error!(ErrorCode::InvalidState)
        }
        zkube_core::RunTransitionError::Overflow => error!(ErrorCode::ArithmeticOverflow),
        zkube_core::RunTransitionError::InvalidRules
        | zkube_core::RunTransitionError::InvalidPhase => error!(ErrorCode::InvalidState),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::arena_rules::DailyThemeSnapshot;
    use anchor_lang::{InstructionData, ToAccountMetas};

    fn daily_active(lifecycle: RunLifecycle) -> ActiveRun {
        ActiveRun {
            version: ACCOUNT_VERSION,
            lifecycle,
            rules_hash: [7; 32],
            rules: RealmRuleSnapshot {
                guardian: GuardianSnapshot {
                    bonus: 1,
                    trigger: 1,
                    threshold: 2,
                },
                starting_rows: 4,
            },
            daily_theme: DailyThemeSnapshot::from_core(zkube_core::DailyTheme {
                kind: ConstraintKind::None,
                value: 0,
            }),
            bonus_type: 1,
            reroll_charges: 1,
            ..ActiveRun::default()
        }
    }

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
        let metas = crate::accounts::RunVrf {
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
        assert!(!action_needs_row_vrf(RunLifecycle::Finished));
    }

    #[test]
    fn program_and_core_score_one_action_identically() {
        let mut active = daily_active(RunLifecycle::AwaitingVrf);
        active.vrf_request_counter = 1;
        active.pending_vrf_counter = 1;
        let rules = run_rules(&active).unwrap();
        let mut opened = run_from_active(&active, rules).unwrap();
        opened
            .apply_vrf_observed_with::<SolanaSha256, _>(
                rules,
                1,
                [19; 32],
                &mut zkube_core::NoPresentation,
            )
            .unwrap();
        write_run(&mut active, &opened, 0).unwrap();
        active.pending_vrf_counter = 0;

        let action = (0..zkube_core::GRID_HEIGHT as u8)
            .flat_map(|row| {
                (0..zkube_core::GRID_WIDTH as u8).flat_map(move |start| {
                    (0..zkube_core::GRID_WIDTH as u8)
                        .filter(move |destination| *destination != start)
                        .map(move |destination| (row, start, destination))
                })
            })
            .find(|(row, start, destination)| {
                let mut candidate = opened;
                candidate
                    .play_move_observed_with::<zkube_core::SoftwareSha256, _>(
                        rules,
                        0,
                        0,
                        *row,
                        *start,
                        *destination,
                        &mut zkube_core::NoPresentation,
                    )
                    .is_ok()
            })
            .expect("opening has a legal move");

        let mut expected = opened;
        expected
            .play_move_observed_with::<zkube_core::SoftwareSha256, _>(
                rules,
                0,
                0,
                action.0,
                action.1,
                action.2,
                &mut zkube_core::NoPresentation,
            )
            .unwrap();
        let mut projected = run_from_active(&active, rules).unwrap();
        projected
            .play_move_observed_with::<SolanaSha256, _>(
                rules,
                0,
                0,
                action.0,
                action.1,
                action.2,
                &mut zkube_core::NoPresentation,
            )
            .unwrap();
        let terminal_at = u64::from(matches!(projected.engine.phase, RunPhase::Finished)) as i64;
        write_run(&mut active, &projected, terminal_at).unwrap();

        assert_eq!(projected, expected);
        assert_eq!(run_from_active(&active, rules).unwrap(), expected);
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
                zkube_core::ReplayEvent::PlayerAbandon { .. }
                | zkube_core::ReplayEvent::DailyDeadline { .. } => "finish_run",
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
            lifecycle: RunLifecycle::Playing,
            bonus_charges: 2,
            has_next_row: true,
            next_row: {
                let mut row = [0u8; 8];
                row[0] = 1;
                row
            },
            ..daily_active(RunLifecycle::Playing)
        };
        let replay_before = active.replay_hash;
        apply_reroll_request(&mut active, 0).unwrap();

        assert_eq!(active.action_counter, 1);
        assert_eq!(active.lifecycle, RunLifecycle::AwaitingVrf);
        assert_eq!(active.bonus_charges, 2);
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
    fn finish_run_predicates_are_exact() {
        assert!(finish_lifecycle_is_allowed(
            RunFinishReason::Abandon,
            RunLifecycle::Prepared
        ));
        assert!(finish_lifecycle_is_allowed(
            RunFinishReason::Abandon,
            RunLifecycle::Playing
        ));
        assert!(!finish_lifecycle_is_allowed(
            RunFinishReason::Abandon,
            RunLifecycle::Finished
        ));
        assert!(finish_lifecycle_is_allowed(
            RunFinishReason::Deadline,
            RunLifecycle::Delegated
        ));
        assert!(finish_lifecycle_is_allowed(
            RunFinishReason::Deadline,
            RunLifecycle::AwaitingVrf
        ));
        assert!(!finish_lifecycle_is_allowed(
            RunFinishReason::Deadline,
            RunLifecycle::Prepared
        ));
        assert!(!finish_lifecycle_is_allowed(
            RunFinishReason::Deadline,
            RunLifecycle::Finished
        ));
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
    }
    fn projected_move(
        mut active: ActiveRun,
        row: u8,
        start: u8,
        destination: u8,
        now: i64,
    ) -> ActiveRun {
        let rules = run_rules(&active).unwrap();
        let mut run = run_from_active(&active, rules).unwrap();
        run.play_move_observed_with::<SolanaSha256, _>(
            rules,
            active.action_counter,
            active.moves,
            row,
            start,
            destination,
            &mut zkube_core::NoPresentation,
        )
        .unwrap();
        write_run(&mut active, &run, now).unwrap();
        if action_needs_row_vrf(active.lifecycle) {
            prepare_row_vrf_request(
                &mut active,
                Pubkey::new_unique(),
                Pubkey::new_unique(),
                Pubkey::new_unique(),
                Pubkey::new_unique(),
                [0; 32],
            )
            .unwrap();
        }
        active
    }

    #[test]
    fn sbf_terminal_x4_move_scores_ten_and_writes_timestamp_without_sealing() {
        let owner = Pubkey::new_unique();
        let run_id = 9u64;
        let (_, bump) = Pubkey::find_program_address(
            &[
                ACTIVE_RUN_SEED,
                b"active",
                owner.as_ref(),
                &run_id.to_le_bytes(),
            ],
            &crate::ID,
        );
        let mut grid = [0u8; 80];
        for row in 0..4 {
            grid[row * 8..(row + 1) * 8].copy_from_slice(&[1; 8]);
        }
        grid[32..40].copy_from_slice(&[1, 0, 0, 0, 0, 0, 0, 0]);
        let active_state = ActiveRun {
            version: ACCOUNT_VERSION,
            owner,
            run_id,
            deadline_at: i64::MAX,
            lifecycle: RunLifecycle::Playing,
            map_id: 1,

            rules: RealmRuleSnapshot {
                ..daily_active(RunLifecycle::Playing).rules
            },
            moves: zkube_core::DAILY_MAX_MOVES - 1,
            grid,
            next_row: [0, 0, 0, 0, 0, 0, 0, 1],
            has_next_row: true,
            bump,
            ..ActiveRun::default()
        };
        let active = projected_move(active_state, 4, 0, 1, 123);
        assert_eq!(active.lifecycle, RunLifecycle::Finished);
        assert_eq!(active.finished_at, 123);
        assert_eq!(active.action_counter, 1);
        assert_eq!(active.moves, zkube_core::DAILY_MAX_MOVES);
        assert_eq!(active.score, 10);
        assert_eq!(active.level_lines_cleared, 4);
        assert_eq!(active.combo_counter, 1);
        assert_eq!(active.max_combo, 4);
    }
    #[test]
    fn sbf_daily_perfect_clear_grants_or_discards_at_the_inventory_cap() {
        let run = |owner: Pubkey, run_id: u64, reroll_charges: u8| {
            let (_, bump) = Pubkey::find_program_address(
                &[
                    ACTIVE_RUN_SEED,
                    b"active",
                    owner.as_ref(),
                    &run_id.to_le_bytes(),
                ],
                &crate::ID,
            );
            let mut grid = [0u8; 80];
            grid[..8].copy_from_slice(&[1; 8]);
            ActiveRun {
                version: ACCOUNT_VERSION,
                owner,
                run_id,
                lifecycle: RunLifecycle::Playing,
                deadline_at: 1_000,
                rules: RealmRuleSnapshot {
                    ..daily_active(RunLifecycle::Playing).rules
                },
                daily_theme: DailyThemeSnapshot::from_core(zkube_core::DAILY_THEMES[0]),
                grid,
                next_row: [0; 8],
                has_next_row: true,
                reroll_charges,
                bump,
                ..ActiveRun::default()
            }
        };

        let owner = Pubkey::new_unique();
        let after_grant = projected_move(run(owner, 91, 1), 0, 0, 0, 123);
        assert_eq!(after_grant.reroll_charges, 2);

        let capped_owner = Pubkey::new_unique();
        let after_discard = projected_move(run(capped_owner, 92, 3), 0, 0, 0, 123);
        assert_eq!(after_discard.reroll_charges, 3);
    }
    #[test]
    fn sbf_tenth_row_is_playable_and_requests_the_next_vrf_row() {
        let owner = Pubkey::new_unique();
        let run_id = 10u64;
        let (_, bump) = Pubkey::find_program_address(
            &[
                ACTIVE_RUN_SEED,
                b"active",
                owner.as_ref(),
                &run_id.to_le_bytes(),
            ],
            &crate::ID,
        );
        let mut grid = [0u8; 80];
        for row in 0..9 {
            grid[row * 8] = 1;
        }
        let active_state = ActiveRun {
            version: ACCOUNT_VERSION,
            owner,
            run_id,
            deadline_at: i64::MAX,
            lifecycle: RunLifecycle::Playing,
            map_id: 1,

            rules: RealmRuleSnapshot {
                ..daily_active(RunLifecycle::Playing).rules
            },
            grid,
            next_row: [1, 0, 0, 0, 0, 0, 0, 0],
            has_next_row: true,
            bump,
            ..ActiveRun::default()
        };

        let active = projected_move(active_state, 0, 0, 0, 234);
        assert_eq!(active.lifecycle, RunLifecycle::AwaitingVrf);
        assert_eq!(active.finished_at, 0);
        assert_eq!(active.action_counter, 1);
        assert_eq!(active.moves, 1);
        assert_eq!(active.grid[72], 1, "row ten must remain occupied");
        assert!(!active.has_next_row);
        assert_eq!(active.vrf_request_counter, 1);
        assert_eq!(active.pending_vrf_counter, 1);
    }
    #[test]
    fn sbf_blocked_eleventh_row_finishes_the_last_accepted_daily_state() {
        let owner = Pubkey::new_unique();
        let rent_payer = Pubkey::new_unique();
        let run_id = 11u64;
        let (_, bump) = Pubkey::find_program_address(
            &[
                ACTIVE_RUN_SEED,
                b"active",
                owner.as_ref(),
                &run_id.to_le_bytes(),
            ],
            &crate::ID,
        );
        let mut grid = [0u8; 80];
        for row in 0..10 {
            grid[row * 8] = 1;
        }
        let active_state = ActiveRun {
            version: ACCOUNT_VERSION,
            owner,
            rent_payer,
            run_id,
            deadline_at: i64::MAX,
            lifecycle: RunLifecycle::Playing,
            map_id: 1,

            rules: RealmRuleSnapshot {
                ..daily_active(RunLifecycle::Playing).rules
            },
            score: 1,
            grid,
            next_row: [1, 0, 0, 0, 0, 0, 0, 0],
            has_next_row: true,
            vrf_request_counter: 7,
            bump,
            ..ActiveRun::default()
        };

        let active = projected_move(active_state, 0, 0, 0, 345);
        assert_eq!(active.lifecycle, RunLifecycle::Finished);
        assert_eq!(active.finished_at, 345);
        assert_eq!(active.action_counter, 1);
        assert_eq!(active.moves, 1);
        assert_eq!(active.grid, grid, "blocked insertion must not drop row ten");
        assert!(!active.has_next_row);
        assert_eq!(active.vrf_request_counter, 7);
        assert_eq!(active.pending_vrf_counter, 0);
    }
    #[test]
    fn sbf_vrf_callback_builds_complete_opening_and_uses_shared_tier_weights() {
        let mut active = daily_active(RunLifecycle::AwaitingVrf);
        active.rules.starting_rows = 8;
        active.vrf_request_counter = 1;
        active.pending_vrf_counter = 1;
        let rules = run_rules(&active).unwrap();
        let mut run = run_from_active(&active, rules).unwrap();
        run.apply_vrf_observed_with::<SolanaSha256, _>(
            rules,
            1,
            [37; 32],
            &mut zkube_core::NoPresentation,
        )
        .unwrap();
        write_run(&mut active, &run, 0).unwrap();
        active.pending_vrf_counter = 0;
        let expected = zkube_core::opening_from_vrf(
            [37; 32],
            1,
            active.rules_hash,
            8,
            zkube_core::BlockWeights {
                values: zkube_core::TIER_BLOCK_WEIGHTS[0],
            },
        )
        .unwrap();
        assert_eq!(active.grid, *expected.grid.cells());
        assert_eq!(active.next_row, expected.preview);
        assert_eq!(active.lifecycle, RunLifecycle::Playing);
        assert_eq!(run_from_active(&active, rules).unwrap(), run);
        active.lifecycle = RunLifecycle::AwaitingVrf;
        active.has_next_row = false;
        active.pressure_score = zkube_core::PRESSURE_STEP * 7;
        active.vrf_request_counter = 2;
        active.pending_vrf_counter = 2;
        let mut run = run_from_active(&active, rules).unwrap();
        run.apply_vrf_observed_with::<SolanaSha256, _>(
            rules,
            2,
            [91; 32],
            &mut zkube_core::NoPresentation,
        )
        .unwrap();
        assert_eq!(
            run.engine.next_row.unwrap(),
            zkube_core::row_from_vrf(
                [91; 32],
                2,
                zkube_core::BlockWeights {
                    values: zkube_core::TIER_BLOCK_WEIGHTS[7]
                }
            )
            .unwrap()
        );
        assert!(require_matching_vrf_callback(2, 1).is_err());
    }

    #[test]
    fn sbf_reroll_request_callback_and_deadline_resolution_match_the_golden_vector() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../fixtures/replays/golden-reroll-v1.json"
        ))
        .unwrap();
        let bytes = |field: &str| -> [u8; 32] {
            let value = fixture[field].as_str().unwrap();
            core::array::from_fn(|index| {
                u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).unwrap()
            })
        };
        let counter = fixture["request_counter"].as_u64().unwrap() as u32;
        let action = fixture["reroll_event"]["action"].as_u64().unwrap() as u32;
        let mut active = daily_active(RunLifecycle::Playing);
        active.rules_hash = bytes("rules_hash_hex");
        active.grid[0] = 1;
        active.has_next_row = true;
        active.next_row[0] = 1;
        active.bonus_charges = 2;
        active.reroll_charges = 2;
        active.action_counter = action;
        active.vrf_request_counter = counter - 1;
        active.replay_hash = [7; 32];
        apply_reroll_request(&mut active, action).unwrap();
        assert_eq!(active.action_counter, action + 1);
        assert_eq!(active.bonus_charges, 2);
        assert_eq!(active.reroll_charges, 1);
        assert_eq!(
            active.replay_hash,
            zkube_core::ReplayCommitment([7; 32])
                .fold_with::<SolanaSha256>(zkube_core::ReplayEvent::Reroll { action })
                .to_bytes()
        );
        active.vrf_request_counter = counter;
        active.pending_vrf_counter = counter;
        let rules = run_rules(&active).unwrap();
        let pending = run_from_active(&active, rules).unwrap();
        let mut fulfilled = pending;
        fulfilled
            .apply_vrf_observed_with::<SolanaSha256, _>(
                rules,
                counter,
                bytes("vrf_output_hex"),
                &mut zkube_core::NoPresentation,
            )
            .unwrap();
        let expected: [u8; 8] =
            core::array::from_fn(|i| fixture["rerolled_row"][i].as_u64().unwrap() as u8);
        assert_eq!(fulfilled.engine.next_row, Some(expected));
        let mut deadline = pending;
        deadline
            .finish_observed_with::<SolanaSha256, _>(
                rules,
                zkube_core::RunEndReason::Deadline,
                &mut zkube_core::NoPresentation,
            )
            .unwrap();
        write_run(&mut active, &deadline, 100).unwrap();
        active.pending_vrf_counter = 0;
        assert_eq!(active.lifecycle, RunLifecycle::Finished);
        assert_eq!(active.finished_at, 100);
        assert_eq!(active.action_counter, action + 1);
        assert!(deadline.is_score_eligible());
        assert!(deadline
            .apply_vrf_observed_with::<SolanaSha256, _>(
                rules,
                counter,
                bytes("vrf_output_hex"),
                &mut zkube_core::NoPresentation
            )
            .is_err());
    }
}
