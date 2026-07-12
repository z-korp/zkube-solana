use anchor_lang::{prelude::*, Discriminator, InstructionData};
use ephemeral_rollups_sdk::anchor::{action, commit, delegate};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{CallHandler, FoldableIntentBuilder, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::{ActionArgs, ShortAccountMeta};
use ephemeral_vrf_sdk::anchor::{vrf, vrf_callback};
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};
use sha2::{Digest, Sha256};

use crate::error::ErrorCode;
use crate::game::{
    calculate_level_stars, row_from_vrf, BlockWeights, Bonus, Constraint, ConstraintKind,
    EndlessRules, Grid, LevelRules, MutatorRules, RunEngine, RunError, RunPhase,
};
use crate::state::v2::*;

#[delegate]
#[derive(Accounts)]
pub struct DelegateActiveRunV1<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [RUN_SHELL_SEED, owner.key().as_ref(), run_shell.run_id.to_le_bytes().as_ref()],
        bump = run_shell.bump,
        has_one = owner @ ErrorCode::Unauthorized
    )]
    pub run_shell: Account<'info, RunShell>,
    /// CHECK: Deserialized and matched to the owner, shell, run id, and PDA in the handler.
    #[account(mut, owner = crate::ID, del)]
    pub pda: UncheckedAccount<'info>,
}

pub fn handler_delegate_active_run_v1(ctx: Context<DelegateActiveRunV1>) -> Result<()> {
    let owner = ctx.accounts.owner.key();
    let run_id = ctx.accounts.run_shell.run_id;
    let expected = Pubkey::find_program_address(
        &[
            RUN_SHELL_SEED,
            b"active",
            owner.as_ref(),
            &run_id.to_le_bytes(),
        ],
        &crate::ID,
    )
    .0;
    require_keys_eq!(ctx.accounts.pda.key(), expected, ErrorCode::InvalidRunId);

    let validator = ctx
        .remaining_accounts
        .first()
        .map(|account| account.key())
        .unwrap_or_default();
    {
        let mut data = ctx.accounts.pda.try_borrow_mut_data()?;
        let mut active = ActiveRun::try_deserialize(&mut data.as_ref())?;
        require_keys_eq!(active.owner, owner, ErrorCode::Unauthorized);
        require_keys_eq!(
            active.run_shell,
            ctx.accounts.run_shell.key(),
            ErrorCode::InvalidRunId
        );
        require!(active.run_id == run_id, ErrorCode::InvalidRunId);
        require!(
            active.lifecycle == RunLifecycle::Prepared,
            ErrorCode::InvalidState
        );
        active.lifecycle = RunLifecycle::Delegated;
        let mut writer = std::io::Cursor::new(&mut data[..]);
        active.try_serialize(&mut writer)?;
    }

    let shell = &mut ctx.accounts.run_shell;
    require!(
        shell.lifecycle == RunLifecycle::Prepared,
        ErrorCode::InvalidState
    );
    shell.lifecycle = RunLifecycle::Delegated;
    shell.delegated_validator = validator;

    ctx.accounts.delegate_pda(
        &ctx.accounts.payer,
        &[
            RUN_SHELL_SEED,
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
pub struct RequestRowVrfV1<'info> {
    #[account(mut, owner = crate::ID)]
    pub active_run: Box<Account<'info, ActiveRun>>,
    /// CHECK: Logical wallet authority, bound to the active run.
    #[account(address = active_run.owner @ ErrorCode::Unauthorized)]
    pub owner_authority: UncheckedAccount<'info>,
    #[session(signer = actor, authority = owner_authority.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    #[account(mut)]
    pub actor: Signer<'info>,
    /// CHECK: Address-constrained to MagicBlock's devnet ER queue.
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
    /// CHECK: Address/owner constrained; the handler validates the SDK record before use.
    #[account(
        address = ephemeral_rollups_sdk::pda::delegation_record_pda_from_delegated_account(&active_run.key().to_bytes().into()).to_bytes().into(),
        owner = Pubkey::new_from_array(ephemeral_rollups_sdk::id().to_bytes()) @ ErrorCode::InvalidMagicProgram
    )]
    pub delegation_record_active: UncheckedAccount<'info>,
}

impl<'info> RequestRowVrfV1<'info> {
    pub(crate) fn invoke_vrf_request<'a>(
        &self,
        payer: &'a AccountInfo<'info>,
        ix: &ephemeral_vrf_sdk::compat::Instruction,
    ) -> std::result::Result<(), anchor_lang::solana_program::program_error::ProgramError> {
        self.invoke_signed_vrf(payer, ix)
    }
}

#[session_auth_or(
    ctx.accounts.active_run.owner == ctx.accounts.actor.key(),
    SessionError::InvalidToken
)]
pub fn handler_request_row_vrf_v1(
    ctx: Context<RequestRowVrfV1>,
    client_seed: [u8; 32],
) -> Result<()> {
    use ephemeral_rollups_sdk::consts::{MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID};
    use ephemeral_vrf_sdk::instructions::{
        create_request_high_priority_scoped_randomness_ix, RequestRandomnessParams,
    };
    use ephemeral_vrf_sdk::types::SerializableAccountMeta;

    require_run_actor(&ctx.accounts.active_run, ctx.accounts.actor.key())?;
    let active = &mut ctx.accounts.active_run;
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
    active.vrf_requested_at = Clock::get()?.unix_timestamp;
    active.lifecycle = RunLifecycle::AwaitingVrf;

    let validator =
        delegation_record_validator(&ctx.accounts.delegation_record_active.try_borrow_data()?)?;
    let (magic_fee_vault, _) = Pubkey::find_program_address(
        &[b"magic-fee-vault", validator.as_ref()],
        &Pubkey::new_from_array(ephemeral_rollups_sdk::id().to_bytes()),
    );
    let active_key = active.key();
    let caller_seed: [u8; 32] = Sha256::new()
        .chain_update(b"zkube-row-vrf-v1")
        .chain_update(client_seed)
        .chain_update(active.run_id.to_le_bytes())
        .chain_update(request_counter.to_le_bytes())
        .chain_update(active.rules_hash)
        .finalize()
        .into();

    let ix = create_request_high_priority_scoped_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.actor.key().to_bytes().into(),
        oracle_queue: ctx.accounts.oracle_queue.key().to_bytes().into(),
        callback_program_id: crate::ID.to_bytes().into(),
        callback_discriminator: crate::instruction::FulfillRowVrfV1::DISCRIMINATOR.to_vec(),
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
        ..Default::default()
    });
    ctx.accounts
        .invoke_vrf_request(&ctx.accounts.actor.to_account_info(), &ix)?;
    Ok(())
}

#[vrf_callback]
#[derive(Accounts)]
pub struct FulfillRowVrfV1<'info> {
    #[account(mut, owner = crate::ID)]
    pub active_run: Account<'info, ActiveRun>,
    /// CHECK: Callback fee vault supplied by and charged through MagicBlock.
    #[account(mut)]
    pub magic_fee_vault: UncheckedAccount<'info>,
}

pub fn handler_fulfill_row_vrf_v1(
    ctx: Context<FulfillRowVrfV1>,
    randomness: [u8; 32],
) -> Result<()> {
    let active = &mut ctx.accounts.active_run;
    require!(
        vrf_fulfillment_lifecycle_is_allowed(active.lifecycle),
        ErrorCode::InvalidState
    );
    require!(
        active.pending_vrf_counter > 0,
        ErrorCode::NoVrfRequestPending
    );
    let request_counter = active.pending_vrf_counter;
    let row = row_from_vrf(
        randomness,
        request_counter,
        BlockWeights {
            values: active.rules.block_weights,
        },
    )
    .map_err(|_| error!(ErrorCode::InvalidBlockWeights))?;

    let mut engine = engine_from_active(active)?;
    engine.phase = RunPhase::AwaitingVrf;
    engine.provide_vrf_row(row).map_err(map_run_error)?;
    write_engine(active, &engine);
    active.pending_vrf_counter = 0;
    active.vrf_hash = Sha256::new()
        .chain_update(b"zkube-vrf-chain-v1")
        .chain_update(active.vrf_hash)
        .chain_update(request_counter.to_le_bytes())
        .chain_update(randomness)
        .chain_update(row)
        .finalize()
        .into();
    if active.started_at == 0 && engine.phase == RunPhase::Playing {
        active.started_at = Clock::get()?.unix_timestamp;
    }
    active.lifecycle = lifecycle_from_phase(engine.phase);
    Ok(())
}

#[derive(Accounts, Session)]
pub struct PlayMoveV1<'info> {
    #[account(mut, owner = crate::ID)]
    pub active_run: Account<'info, ActiveRun>,
    /// CHECK: Logical wallet authority, bound to the active run.
    #[account(address = active_run.owner @ ErrorCode::Unauthorized)]
    pub owner_authority: UncheckedAccount<'info>,
    #[session(signer = actor, authority = owner_authority.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
}

#[session_auth_or(
    ctx.accounts.active_run.owner == ctx.accounts.actor.key(),
    SessionError::InvalidToken
)]
pub fn handler_play_move_v1(
    ctx: Context<PlayMoveV1>,
    expected_action: u32,
    expected_move: u16,
    row: u8,
    start: u8,
    destination: u8,
) -> Result<()> {
    require_run_actor(&ctx.accounts.active_run, ctx.accounts.actor.key())?;
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
    let mut mutator = mutator_rules(&active.rules);
    if active.mode == RunMode::Daily {
        let endless = endless_rules(active);
        active.current_difficulty = endless.difficulty_for_score(active.score);
        mutator.score_multiplier_x100 = (u32::from(mutator.score_multiplier_x100).saturating_mul(
            u32::from(endless.score_multiplier(active.current_difficulty)),
        ) / 100)
            .min(u32::from(u16::MAX)) as u16;
    }
    let combo_before = active.combo_counter;
    let mut engine = engine_from_active(active)?;
    let report = engine
        .play_move(expected_move, row, start, destination, level, mutator)
        .map_err(map_run_error)?;
    write_engine(active, &engine);
    active.total_lines_cleared = active
        .total_lines_cleared
        .checked_add(u16::from(report.lines_cleared))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
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
    if active.mode == RunMode::Daily {
        active.current_difficulty = endless_rules(active).difficulty_for_score(active.score);
    }
    active.action_counter = active
        .action_counter
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    active.lifecycle = lifecycle_from_phase(engine.phase);
    active.action_hash = Sha256::new()
        .chain_update(b"zkube-action-chain-v1")
        .chain_update(active.action_hash)
        .chain_update(expected_action.to_le_bytes())
        .chain_update(expected_move.to_le_bytes())
        .chain_update([row, start, destination])
        .chain_update(active.score.to_le_bytes())
        .chain_update(active.moves.to_le_bytes())
        .chain_update([active.lifecycle as u8])
        .finalize()
        .into();
    Ok(())
}

#[derive(Accounts, Session)]
pub struct ApplyBonusV1<'info> {
    #[account(mut, owner = crate::ID)]
    pub active_run: Account<'info, ActiveRun>,
    /// CHECK: Logical wallet authority, bound to the active run.
    #[account(address = active_run.owner @ ErrorCode::Unauthorized)]
    pub owner_authority: UncheckedAccount<'info>,
    #[session(signer = actor, authority = owner_authority.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
}

#[session_auth_or(
    ctx.accounts.active_run.owner == ctx.accounts.actor.key(),
    SessionError::InvalidToken
)]
pub fn handler_apply_bonus_v1(
    ctx: Context<ApplyBonusV1>,
    expected_action: u32,
    row: u8,
    column: u8,
) -> Result<()> {
    require_run_actor(&ctx.accounts.active_run, ctx.accounts.actor.key())?;
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
    let mut engine = engine_from_active(active)?;
    let report = engine
        .apply_bonus(row, column, level, mutator_rules(&active.rules))
        .map_err(map_run_error)?;
    write_engine(active, &engine);
    active.total_lines_cleared = active
        .total_lines_cleared
        .checked_add(u16::from(report.lines_cleared))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    active.bonus_uses = active
        .bonus_uses
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    active.action_counter = active
        .action_counter
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    active.lifecycle = lifecycle_from_phase(engine.phase);
    active.action_hash = Sha256::new()
        .chain_update(b"zkube-action-chain-v1")
        .chain_update(active.action_hash)
        .chain_update(expected_action.to_le_bytes())
        .chain_update([0xff, row, column])
        .chain_update(active.score.to_le_bytes())
        .chain_update(active.moves.to_le_bytes())
        .chain_update([active.lifecycle as u8])
        .finalize()
        .into();
    Ok(())
}

#[derive(Accounts, Session)]
pub struct SealRunV1<'info> {
    #[account(mut, owner = crate::ID)]
    pub active_run: Account<'info, ActiveRun>,
    /// CHECK: Logical wallet authority, bound to the active run.
    #[account(address = active_run.owner @ ErrorCode::Unauthorized)]
    pub owner_authority: UncheckedAccount<'info>,
    #[session(signer = actor, authority = owner_authority.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
}

#[session_auth_or(
    ctx.accounts.active_run.owner == ctx.accounts.actor.key(),
    SessionError::InvalidToken
)]
pub fn handler_seal_run_v1(ctx: Context<SealRunV1>) -> Result<()> {
    require_run_actor(&ctx.accounts.active_run, ctx.accounts.actor.key())?;
    require!(
        matches!(
            ctx.accounts.active_run.lifecycle,
            RunLifecycle::LevelComplete | RunLifecycle::Finished
        ),
        ErrorCode::GameNotFinished
    );
    require!(
        ctx.accounts.active_run.pending_vrf_counter == 0,
        ErrorCode::VrfRequestPending
    );
    if ctx.accounts.active_run.finished_at == 0 {
        ctx.accounts.active_run.finished_at = Clock::get()?.unix_timestamp;
    }
    Ok(())
}

#[derive(Accounts, Session)]
pub struct AbandonRunV1<'info> {
    #[account(mut, owner = crate::ID)]
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
pub fn handler_abandon_run_v1(ctx: Context<AbandonRunV1>) -> Result<()> {
    require_run_actor(&ctx.accounts.active_run, ctx.accounts.actor.key())?;
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

#[derive(Accounts)]
pub struct RotateActiveRunAuthorityV1<'info> {
    #[account(
        mut,
        owner = crate::ID,
        has_one = owner @ ErrorCode::Unauthorized
    )]
    pub active_run: Box<Account<'info, ActiveRun>>,
    pub owner: Signer<'info>,
}

pub fn handler_rotate_active_run_authority_v1(
    ctx: Context<RotateActiveRunAuthorityV1>,
    new_action_authority: Pubkey,
) -> Result<()> {
    require!(
        active_session_rotation_is_allowed(
            ctx.accounts.active_run.lifecycle,
            ctx.accounts.active_run.pending_vrf_counter,
            new_action_authority,
        ),
        ErrorCode::InvalidState
    );
    ctx.accounts.active_run.action_authority = new_action_authority;
    Ok(())
}

fn active_session_rotation_is_allowed(
    lifecycle: RunLifecycle,
    pending_vrf_counter: u32,
    new_authority: Pubkey,
) -> bool {
    new_authority != Pubkey::default()
        && pending_vrf_counter == 0
        && matches!(
            lifecycle,
            RunLifecycle::Delegated
                | RunLifecycle::Playing
                | RunLifecycle::LevelComplete
                | RunLifecycle::Finished
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

fn run_has_terminal_projection(lifecycle: RunLifecycle, finished_at: i64) -> bool {
    matches!(
        lifecycle,
        RunLifecycle::LevelComplete | RunLifecycle::Finished
    ) && finished_at > 0
}

#[commit]
#[derive(Accounts)]
pub struct CommitRunV1<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, owner = crate::ID)]
    pub active_run: Account<'info, ActiveRun>,
    /// CHECK: Base-layer shell; address is pinned by active_run.
    #[account(address = active_run.run_shell @ ErrorCode::InvalidRunId)]
    pub run_shell: UncheckedAccount<'info>,
    /// CHECK: Reserved receipt PDA; its contents are validated by the action.
    #[account(seeds = [RUN_RECEIPT_SEED, active_run.owner.as_ref(), active_run.run_id.to_le_bytes().as_ref()], bump)]
    pub run_receipt: UncheckedAccount<'info>,
    /// CHECK: Durable profile PDA, written only by the post-commit action.
    #[account(seeds = [PLAYER_PROFILE_SEED, active_run.owner.as_ref()], bump)]
    pub player_profile: UncheckedAccount<'info>,
    /// CHECK: Durable campaign PDA, written only by the post-commit action.
    #[account(seeds = [CAMPAIGN_PROGRESS_SEED, active_run.owner.as_ref()], bump)]
    pub campaign_progress: UncheckedAccount<'info>,
    /// CHECK: Player wallet whose address is pinned by active_run.
    #[account(address = active_run.owner @ ErrorCode::Unauthorized)]
    pub owner: UncheckedAccount<'info>,
    /// CHECK: MagicBlock context required by MagicIntentBundleBuilder.
    #[account(mut, address = ephemeral_rollups_sdk::consts::MAGIC_CONTEXT_ID @ ErrorCode::InvalidMagicProgram)]
    pub magic_context: UncheckedAccount<'info>,
    pub magic_program: Program<'info, ephemeral_rollups_sdk::anchor::MagicProgram>,
}

pub fn handler_commit_run_v1(ctx: Context<CommitRunV1>) -> Result<()> {
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

    let action_data = InstructionData::data(&crate::instruction::ConsumeRunReceiptV1 {});
    let settlement_action = CallHandler {
        destination_program: crate::ID,
        accounts: vec![
            short_meta(ctx.accounts.active_run.key(), true),
            short_meta(ctx.accounts.run_shell.key(), true),
            short_meta(ctx.accounts.run_receipt.key(), true),
            short_meta(ctx.accounts.player_profile.key(), true),
            short_meta(ctx.accounts.campaign_progress.key(), true),
            short_meta(ctx.accounts.owner.key(), false),
        ],
        args: ActionArgs::new(action_data),
        escrow_authority: ctx.accounts.payer.to_account_info(),
        compute_units: 250_000,
    };

    ctx.accounts.active_run.exit(&crate::ID)?;
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.active_run.to_account_info()])
    .add_post_commit_actions([settlement_action])
    .build_and_invoke()?;
    Ok(())
}

#[action]
#[derive(Accounts)]
pub struct ConsumeRunReceiptV1<'info> {
    #[account(mut, owner = crate::ID)]
    pub active_run: Box<Account<'info, ActiveRun>>,
    #[account(
        mut,
        seeds = [RUN_SHELL_SEED, owner.key().as_ref(), active_run.run_id.to_le_bytes().as_ref()],
        bump = run_shell.bump,
        has_one = owner @ ErrorCode::Unauthorized
    )]
    pub run_shell: Box<Account<'info, RunShell>>,
    #[account(
        mut,
        seeds = [RUN_RECEIPT_SEED, owner.key().as_ref(), active_run.run_id.to_le_bytes().as_ref()],
        bump = run_receipt.bump,
        has_one = owner @ ErrorCode::Unauthorized
    )]
    pub run_receipt: Box<Account<'info, RunReceipt>>,
    #[account(
        mut,
        seeds = [PLAYER_PROFILE_SEED, owner.key().as_ref()],
        bump = player_profile.bump,
        has_one = owner @ ErrorCode::Unauthorized
    )]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    #[account(
        mut,
        seeds = [CAMPAIGN_PROGRESS_SEED, owner.key().as_ref()],
        bump = campaign_progress.bump,
        has_one = owner @ ErrorCode::Unauthorized
    )]
    pub campaign_progress: Box<Account<'info, CampaignProgress>>,
    /// CHECK: Player wallet pinned by every durable account and active_run.
    pub owner: UncheckedAccount<'info>,
}

pub fn handler_consume_run_receipt_v1(ctx: Context<ConsumeRunReceiptV1>) -> Result<()> {
    let active = &ctx.accounts.active_run;
    require!(active.mode == RunMode::Campaign, ErrorCode::InvalidState);
    require_keys_eq!(
        active.owner,
        ctx.accounts.owner.key(),
        ErrorCode::Unauthorized
    );
    require_keys_eq!(
        active.run_shell,
        ctx.accounts.run_shell.key(),
        ErrorCode::InvalidRunId
    );
    require!(
        active.run_id == ctx.accounts.run_shell.run_id,
        ErrorCode::InvalidRunId
    );
    let receipt = &mut ctx.accounts.run_receipt;
    require!(receipt.run_id == active.run_id, ErrorCode::ReceiptMismatch);
    require_keys_eq!(
        receipt.run_shell,
        active.run_shell,
        ErrorCode::ReceiptMismatch
    );
    require!(
        receipt.rules_hash == active.rules_hash,
        ErrorCode::ReceiptMismatch
    );
    if receipt.consumed {
        require!(
            active.lifecycle == RunLifecycle::Settled,
            ErrorCode::ReceiptMismatch
        );
        require!(
            receipt.action_hash == active.action_hash && receipt.vrf_hash == active.vrf_hash,
            ErrorCode::ReceiptMismatch
        );
        return Ok(());
    }
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
    receipt.score = active.score;
    receipt.moves = active.moves;
    receipt.level_stars = stars;
    receipt.lines_cleared = active.total_lines_cleared;
    receipt.bonus_uses = active.bonus_uses;
    receipt.combo2_hits = active.combo2_hits;
    receipt.combo3_hits = active.combo3_hits;
    receipt.combo4_hits = active.combo4_hits;
    receipt.high_combo_hits = active.high_combo_hits;
    receipt.max_combo = active.max_combo;
    receipt.completed = completed;
    receipt.action_hash = active.action_hash;
    receipt.vrf_hash = active.vrf_hash;
    receipt.started_at = active.started_at;
    receipt.finished_at = active.finished_at;
    receipt.consumed_at = Clock::get()?.unix_timestamp;
    receipt.consumed = true;

    let newly_perfect = completed
        && stars == 3
        && ctx
            .accounts
            .campaign_progress
            .best_stars(receipt.map_id, receipt.level)?
            < 3;
    ctx.accounts.player_profile.record_run_metrics(
        RunProgressMetrics {
            lines_cleared: receipt.lines_cleared,
            bonus_uses: receipt.bonus_uses,
            combo2_hits: receipt.combo2_hits,
            combo3_hits: receipt.combo3_hits,
            combo4_hits: receipt.combo4_hits,
            high_combo_hits: receipt.high_combo_hits,
            max_combo: receipt.max_combo,
            perfect_level: newly_perfect,
            boss_cleared: completed && receipt.level == LEVELS_PER_MAP as u8,
        },
        receipt.consumed_at,
    )?;

    if receipt.settlement_target == SettlementTarget::CampaignProgress {
        let newly_earned = ctx.accounts.campaign_progress.record_level_stars(
            receipt.map_id,
            receipt.level,
            stars,
        )?;
        ctx.accounts
            .player_profile
            .credit_stars(u64::from(newly_earned))?;
        update_campaign_unlocks(
            &mut ctx.accounts.campaign_progress,
            &mut ctx.accounts.player_profile,
            receipt.map_id,
            receipt.level,
            completed,
        )?;
    }
    ctx.accounts.campaign_progress.last_consumed_run_id = ctx
        .accounts
        .campaign_progress
        .last_consumed_run_id
        .max(active.run_id);
    ctx.accounts.run_shell.lifecycle = RunLifecycle::Settled;
    ctx.accounts.run_shell.settled_at = receipt.consumed_at;
    ctx.accounts.active_run.lifecycle = RunLifecycle::Settled;
    Ok(())
}

#[derive(Accounts)]
#[instruction(run_id: u64)]
pub struct CloseSettledActiveRunV1<'info> {
    /// The player still consents to cleanup: closing erases the on-chain
    /// receipt, so a third party must not be able to grief-close a run.
    pub owner: Signer<'info>,
    // No pause check on purpose: rent recovery must never be blockable.
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    /// CHECK: Rent destination pinned to the protocol paymaster — the
    /// identity that fronted every run rent at prepare gets it back.
    #[account(mut, address = protocol.paymaster @ ErrorCode::Unauthorized)]
    pub rent_recipient: UncheckedAccount<'info>,
    #[account(
        mut,
        close = rent_recipient,
        seeds = [RUN_SHELL_SEED, owner.key().as_ref(), run_id.to_le_bytes().as_ref()],
        bump = run_shell.bump,
        has_one = owner @ ErrorCode::Unauthorized
    )]
    pub run_shell: Box<Account<'info, RunShell>>,
    #[account(
        mut,
        close = rent_recipient,
        seeds = [RUN_RECEIPT_SEED, owner.key().as_ref(), run_id.to_le_bytes().as_ref()],
        bump = run_receipt.bump,
        has_one = owner @ ErrorCode::Unauthorized
    )]
    pub run_receipt: Box<Account<'info, RunReceipt>>,
    #[account(
        mut,
        close = rent_recipient,
        seeds = [RUN_SHELL_SEED, b"active", owner.key().as_ref(), run_id.to_le_bytes().as_ref()],
        bump = active_run.bump,
        has_one = owner @ ErrorCode::Unauthorized,
        constraint = active_run.run_shell == run_shell.key() @ ErrorCode::ReceiptMismatch
    )]
    pub active_run: Box<Account<'info, ActiveRun>>,
}

pub fn handler_close_settled_active_run_v1(
    ctx: Context<CloseSettledActiveRunV1>,
    run_id: u64,
) -> Result<()> {
    let active = &ctx.accounts.active_run;
    let shell = &ctx.accounts.run_shell;
    let receipt = &ctx.accounts.run_receipt;
    require!(active.run_id == run_id, ErrorCode::InvalidRunId);
    require!(shell.run_id == run_id, ErrorCode::InvalidRunId);
    require!(receipt.run_id == run_id, ErrorCode::ReceiptMismatch);
    require!(
        cleanup_is_allowed(
            active.lifecycle,
            shell.lifecycle,
            receipt.consumed,
            active.action_hash == receipt.action_hash,
            active.vrf_hash == receipt.vrf_hash,
        ),
        ErrorCode::InvalidState
    );
    require_keys_eq!(receipt.run_shell, shell.key(), ErrorCode::ReceiptMismatch);
    Ok(())
}

fn cleanup_is_allowed(
    active_lifecycle: RunLifecycle,
    shell_lifecycle: RunLifecycle,
    receipt_consumed: bool,
    action_hash_matches: bool,
    vrf_hash_matches: bool,
) -> bool {
    active_lifecycle == RunLifecycle::Settled
        && shell_lifecycle == RunLifecycle::Settled
        && receipt_consumed
        && action_hash_matches
        && vrf_hash_matches
}

fn update_campaign_unlocks(
    campaign: &mut CampaignProgress,
    player: &mut PlayerProfile,
    map_id: u8,
    level: u8,
    completed: bool,
) -> Result<()> {
    if !completed || level != LEVELS_PER_MAP as u8 {
        return Ok(());
    }
    let bit = 1u16 << (map_id - 1);
    campaign.cleared_maps |= bit;
    if map_id == 1 {
        player.daily_eligible = true;
    }
    let perfected = (1..=LEVELS_PER_MAP as u8)
        .all(|candidate| campaign.best_stars(map_id, candidate).ok() == Some(3));
    if perfected {
        campaign.perfected_maps |= bit;
        if map_id < MAX_MAPS as u8 {
            campaign.unlock_map(map_id + 1, false)?;
        }
    }
    Ok(())
}

fn short_meta(pubkey: Pubkey, is_writable: bool) -> ShortAccountMeta {
    ShortAccountMeta {
        pubkey: pubkey.to_bytes().into(),
        is_writable,
    }
}

fn require_run_actor(active: &ActiveRun, actor: Pubkey) -> Result<()> {
    require!(
        run_actor_is_allowed(active.owner, active.action_authority, actor),
        ErrorCode::Unauthorized
    );
    Ok(())
}

fn run_actor_is_allowed(owner: Pubkey, action_authority: Pubkey, actor: Pubkey) -> bool {
    actor == owner || actor == action_authority
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
        3 => ConstraintKind::ComboStreak,
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

fn endless_rules(active: &ActiveRun) -> EndlessRules {
    EndlessRules {
        thresholds: active.endless_thresholds,
        score_multipliers_x100: active.endless_score_multipliers_x100,
        ramp_multiplier_x100: active.endless_ramp_multiplier_x100,
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
        RunLifecycle::Finished | RunLifecycle::Committing | RunLifecycle::Settled => {
            RunPhase::Finished
        }
        RunLifecycle::Cancelled => return err!(ErrorCode::InvalidState),
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
        initial_rows_remaining: active.initial_rows_remaining,
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
    active.initial_rows_remaining = engine.initial_rows_remaining;
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
    fn constraint_snapshot_mapping_rejects_unknown_kinds() {
        assert!(constraint(ConstraintSnapshot {
            kind: 4,
            value: 0,
            required_count: 0,
        })
        .is_err());
    }

    #[test]
    fn perfect_boss_clear_unlocks_the_next_map() {
        let owner = Pubkey::new_unique();
        let mut campaign = CampaignProgress::initialize(owner, 1);
        for level in 1..=LEVELS_PER_MAP as u8 {
            campaign.record_level_stars(1, level, 3).unwrap();
        }
        let mut player = PlayerProfile::initialize(owner, 1);
        player.next_run_id = 2;
        update_campaign_unlocks(&mut campaign, &mut player, 1, 10, true).unwrap();
        assert!(player.daily_eligible);
        assert!(campaign.is_map_unlocked(2));
        assert_eq!(campaign.cleared_maps, 1);
        assert_eq!(campaign.perfected_maps, 1);
    }

    #[test]
    fn ordinary_boss_clear_enables_daily_without_unlocking_the_next_map() {
        let owner = Pubkey::new_unique();
        let mut campaign = CampaignProgress::initialize(owner, 1);
        for level in 1..=LEVELS_PER_MAP as u8 {
            campaign.record_level_stars(1, level, 2).unwrap();
        }
        let mut player = PlayerProfile::initialize(owner, 1);
        update_campaign_unlocks(&mut campaign, &mut player, 1, 10, true).unwrap();
        assert!(player.daily_eligible);
        assert!(!campaign.is_map_unlocked(2));
        assert_eq!(campaign.cleared_maps, 1);
        assert_eq!(campaign.perfected_maps, 0);
    }

    #[test]
    fn cleanup_requires_a_fully_consumed_matching_settlement() {
        assert!(cleanup_is_allowed(
            RunLifecycle::Settled,
            RunLifecycle::Settled,
            true,
            true,
            true,
        ));
        assert!(!cleanup_is_allowed(
            RunLifecycle::Finished,
            RunLifecycle::Settled,
            true,
            true,
            true,
        ));
        assert!(!cleanup_is_allowed(
            RunLifecycle::Settled,
            RunLifecycle::Settled,
            false,
            true,
            true,
        ));
        assert!(!cleanup_is_allowed(
            RunLifecycle::Settled,
            RunLifecycle::Settled,
            true,
            false,
            true,
        ));
        assert!(!cleanup_is_allowed(
            RunLifecycle::Settled,
            RunLifecycle::Settled,
            true,
            true,
            false,
        ));
    }

    #[test]
    fn abandon_accepts_only_nonterminal_lifecycles() {
        assert!(abandon_lifecycle_is_allowed(RunLifecycle::Prepared));
        assert!(abandon_lifecycle_is_allowed(RunLifecycle::Delegated));
        assert!(abandon_lifecycle_is_allowed(RunLifecycle::AwaitingVrf));
        assert!(abandon_lifecycle_is_allowed(RunLifecycle::Playing));
        assert!(!abandon_lifecycle_is_allowed(RunLifecycle::LevelComplete));
        assert!(!abandon_lifecycle_is_allowed(RunLifecycle::Finished));
        assert!(!abandon_lifecycle_is_allowed(RunLifecycle::Committing));
        assert!(!abandon_lifecycle_is_allowed(RunLifecycle::Settled));
        assert!(!abandon_lifecycle_is_allowed(RunLifecycle::Cancelled));
    }

    #[test]
    fn active_session_rotation_requires_a_stable_nonterminal_run() {
        let authority = Pubkey::new_unique();
        assert!(active_session_rotation_is_allowed(
            RunLifecycle::Playing,
            0,
            authority,
        ));
        assert!(!active_session_rotation_is_allowed(
            RunLifecycle::AwaitingVrf,
            1,
            authority,
        ));
        assert!(!active_session_rotation_is_allowed(
            RunLifecycle::Settled,
            0,
            authority,
        ));
        assert!(!active_session_rotation_is_allowed(
            RunLifecycle::Playing,
            0,
            Pubkey::default(),
        ));
    }

    #[test]
    fn actor_boundary_accepts_only_the_owner_or_bound_session_authority() {
        let owner = Pubkey::new_unique();
        let action_authority = Pubkey::new_unique();
        let attacker = Pubkey::new_unique();
        assert!(run_actor_is_allowed(owner, action_authority, owner));
        assert!(run_actor_is_allowed(
            owner,
            action_authority,
            action_authority,
        ));
        assert!(!run_actor_is_allowed(owner, action_authority, attacker));
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
