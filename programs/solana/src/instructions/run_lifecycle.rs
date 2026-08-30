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
use crate::game::{sha256v, Bonus, Constraint, ConstraintKind, Grid, RunEngine, RunPhase};
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

impl<'info> RunVrf<'info> {
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
    run.apply_vrf_with::<SolanaSha256>(rules, request_counter, randomness)
        .map_err(map_transition_error)?;
    write_run(active, &run, 0)?;
    active.pending_vrf_counter = 0;
    Ok(())
}

#[session_auth_or(
    ctx.accounts.active_run.owner == ctx.accounts.actor.key(),
    SessionError::InvalidToken
)]
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
    run.play_move_with::<SolanaSha256>(
        rules,
        expected_action,
        expected_move,
        row,
        start,
        destination,
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
            .invoke_vrf_request(&ctx.accounts.actor.to_account_info(), &ix)?;
    }
    Ok(())
}

#[session_auth_or(
    ctx.accounts.active_run.owner == ctx.accounts.actor.key(),
    SessionError::InvalidToken
)]
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
    run.apply_bonus_with::<SolanaSha256>(rules, expected_action, row, column)
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
            .invoke_vrf_request(&ctx.accounts.actor.to_account_info(), &ix)?;
    }
    Ok(())
}

#[session_auth_or(
    ctx.accounts.active_run.owner == ctx.accounts.actor.key(),
    SessionError::InvalidToken
)]
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
        .invoke_vrf_request(&ctx.accounts.actor.to_account_info(), &ix)?;
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
    if matches!(phase, RunPhase::LevelComplete | RunPhase::Finished) {
        return Ok(Clock::get()?.unix_timestamp);
    }
    Ok(0)
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
            require!(active.mode == RunMode::Daily, ErrorCode::InvalidState);
            require!(
                active.deadline_at > 0 && now >= active.deadline_at,
                ErrorCode::ChallengeNotEnded
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
    run.finish_with::<SolanaSha256>(rules, core_reason)
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
    /// CHECK: Exact original payer persisted on the closing account.
    #[account(
        mut,
        address = active_run.rent_payer @ ErrorCode::InvalidOwner
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

fn run_rules(active: &ActiveRun) -> Result<zkube_core::RunRules> {
    let guardian = active.rules.guardian.to_core()?;
    let (tier, stars, objective) = match active.mode {
        RunMode::Campaign => (
            zkube_core::TierPolicy::Fixed(active.rules.difficulty),
            Some(zkube_core::StarRules {
                points_required: active.rules.points_required,
                primary: constraint(active.rules.primary)?,
                secondary: constraint(active.rules.secondary)?,
            }),
            None,
        ),
        RunMode::Daily => {
            let theme = active.daily_theme.to_core()?;
            let objective = (theme.kind != ConstraintKind::None).then_some(theme);
            (zkube_core::TierPolicy::Pressure, None, objective)
        }
    };
    let rules = zkube_core::RunRules {
        guardian,
        starting_height: active.rules.starting_rows,
        max_moves: active.rules.max_moves,
        tier,
        stars,
        objective,
    };
    require!(rules.is_valid(), ErrorCode::InvalidLevel);
    Ok(rules)
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
        RunLifecycle::Prepared | RunLifecycle::Delegated | RunLifecycle::AwaitingVrf => {
            RunPhase::AwaitingVrf
        }
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
        RunLifecycle::LevelComplete if active.finish_reason.is_none() => {
            Some(zkube_core::RunEndReason::Completed)
        }
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
        current_tier: if active.mode == RunMode::Daily {
            active.current_tier
        } else {
            rules.current_tier(0)
        },
        last_vrf_counter,
        replay: zkube_core::ReplayCommitment(active.replay_hash),
        rules_hash: zkube_core::RulesHash(active.rules_hash),
        rules_snapshot_hash: rules.snapshot_hash_with::<SolanaSha256>(),
        end_reason,
    })
}

fn write_run(active: &mut ActiveRun, run: &zkube_core::Run, terminal_at: i64) -> Result<()> {
    write_engine(active, &run.engine);
    active.action_counter = run.action_counter;
    active.daily_score = run.daily_score;
    active.objective_total = run.objective_total;
    active.pressure_score = run.pressure_score;
    active.current_tier = if active.mode == RunMode::Daily {
        run.current_tier
    } else {
        0
    };
    active.replay_hash = run.replay.to_bytes();
    active.lifecycle = lifecycle_from_phase(run.engine.phase);
    active.finish_reason = match run.end_reason {
        Some(zkube_core::RunEndReason::Abandoned) => Some(RunFinishReason::Abandon),
        Some(zkube_core::RunEndReason::Deadline) => Some(RunFinishReason::Deadline),
        Some(zkube_core::RunEndReason::Completed | zkube_core::RunEndReason::Exhausted) | None => {
            None
        }
    };
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

fn lifecycle_from_phase(phase: RunPhase) -> RunLifecycle {
    match phase {
        RunPhase::AwaitingVrf => RunLifecycle::AwaitingVrf,
        RunPhase::Playing => RunLifecycle::Playing,
        RunPhase::LevelComplete => RunLifecycle::LevelComplete,
        RunPhase::Finished => RunLifecycle::Finished,
    }
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
            error!(ErrorCode::InvalidBlockWeights)
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
            mode: RunMode::Daily,
            lifecycle,
            rules_hash: [7; 32],
            rules: LevelRuleSnapshot {
                level: 1,
                points_required: u32::MAX,
                max_moves: zkube_core::DAILY_MAX_MOVES,
                difficulty: 0,
                primary: ConstraintSnapshot::default(),
                secondary: ConstraintSnapshot::default(),
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
    fn program_and_core_score_one_action_identically() {
        let mut active = daily_active(RunLifecycle::AwaitingVrf);
        active.vrf_request_counter = 1;
        active.pending_vrf_counter = 1;
        let rules = run_rules(&active).unwrap();
        let mut opened = run_from_active(&active, rules).unwrap();
        opened
            .apply_vrf_with::<SolanaSha256>(rules, 1, [19; 32])
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
                    .play_move(rules, 0, 0, *row, *start, *destination)
                    .is_ok()
            })
            .expect("opening has a legal move");

        let mut expected = opened;
        expected
            .play_move(rules, 0, 0, action.0, action.1, action.2)
            .unwrap();
        let mut projected = run_from_active(&active, rules).unwrap();
        projected
            .play_move_with::<SolanaSha256>(rules, 0, 0, action.0, action.1, action.2)
            .unwrap();
        let terminal_at = u64::from(matches!(
            projected.engine.phase,
            RunPhase::LevelComplete | RunPhase::Finished
        )) as i64;
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
            RunLifecycle::LevelComplete
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
        assert!(run_has_terminal_projection(RunLifecycle::LevelComplete, 10,));
    }
}
