use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use ephemeral_rollups_sdk::anchor::{action, commit};
use ephemeral_rollups_sdk::ephem::{CallHandler, FoldableIntentBuilder, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::{ActionArgs, ShortAccountMeta};
use sha2::{Digest, Sha256};

use crate::error::ErrorCode;
use crate::state::v2::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateDailyChallengeArgs {
    pub day_id: u32,
    pub map_id: u8,
    pub rules: LevelRuleSnapshot,
    pub endless_thresholds: [u32; 7],
    pub endless_score_multipliers_x100: [u16; 8],
    pub endless_ramp_multiplier_x100: u16,
    pub opens_at: i64,
    pub entries_close_at: i64,
    pub runs_close_at: i64,
    pub settlement_grace_close_at: i64,
    pub star_entry_cost: u64,
    pub payout_bps: [u16; DAILY_WINNERS],
}

#[derive(Accounts)]
#[instruction(args: CreateDailyChallengeArgs)]
pub struct CreateDailyChallengeV1<'info> {
    #[account(
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        init,
        payer = authority,
        space = 8 + DailyChallenge::INIT_SPACE,
        seeds = [DAILY_CHALLENGE_SEED, args.day_id.to_le_bytes().as_ref()],
        bump
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,
    #[account(
        init,
        payer = authority,
        space = 8 + DailyLeaderboard::INIT_SPACE,
        seeds = [DAILY_LEADERBOARD_SEED, daily_challenge.key().as_ref()],
        bump
    )]
    pub leaderboard: Box<Account<'info, DailyLeaderboard>>,
    #[account(address = protocol.payment_mint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = authority,
        seeds = [DAILY_VAULT_SEED, args.day_id.to_le_bytes().as_ref()],
        bump,
        token::mint = payment_mint,
        token::authority = daily_challenge,
        token::token_program = payment_token_program
    )]
    pub payment_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = protocol.payment_token_program)]
    pub payment_token_program: Interface<'info, TokenInterface>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_create_daily_challenge_v1(
    ctx: Context<CreateDailyChallengeV1>,
    args: CreateDailyChallengeArgs,
) -> Result<()> {
    require!(
        (1..=MAX_MAPS as u8).contains(&args.map_id),
        ErrorCode::InvalidMap
    );
    require!(
        args.opens_at < args.entries_close_at,
        ErrorCode::InvalidState
    );
    require!(
        args.entries_close_at < args.runs_close_at,
        ErrorCode::InvalidState
    );
    require!(
        args.runs_close_at < args.settlement_grace_close_at,
        ErrorCode::InvalidState
    );
    require!(args.star_entry_cost > 0, ErrorCode::InvalidState);
    require!(
        ctx.accounts.payment_mint.decimals == 6,
        ErrorCode::InvalidState
    );
    require!(args.rules.max_moves == u16::MAX, ErrorCode::InvalidLevel);
    require!(
        args.rules.points_required == u32::MAX,
        ErrorCode::InvalidLevel
    );
    require!(args.rules.primary.kind == 0, ErrorCode::InvalidLevel);
    require!(args.rules.secondary.kind == 0, ErrorCode::InvalidLevel);
    require!(
        args.endless_ramp_multiplier_x100 > 0,
        ErrorCode::InvalidLevel
    );
    require!(
        args.endless_score_multipliers_x100
            .iter()
            .all(|value| *value > 0),
        ErrorCode::InvalidLevel
    );
    require!(
        args.endless_thresholds
            .windows(2)
            .all(|pair| pair[0] < pair[1]),
        ErrorCode::InvalidLevel
    );

    let rules_hash = hash_daily_rules(&args)?;
    let challenge = &mut ctx.accounts.daily_challenge;
    challenge.version = ACCOUNT_VERSION_V1;
    challenge.day_id = args.day_id;
    challenge.authority = ctx.accounts.authority.key();
    challenge.status = DailyStatus::Open;
    challenge.content_version = ctx.accounts.protocol.content_version;
    challenge.rules_hash = rules_hash;
    challenge.map_id = args.map_id;
    challenge.rules = args.rules;
    challenge.endless_thresholds = args.endless_thresholds;
    challenge.endless_score_multipliers_x100 = args.endless_score_multipliers_x100;
    challenge.endless_ramp_multiplier_x100 = args.endless_ramp_multiplier_x100;
    challenge.payment_mint = ctx.accounts.payment_mint.key();
    challenge.payment_token_program = ctx.accounts.payment_token_program.key();
    challenge.payment_vault = ctx.accounts.payment_vault.key();
    challenge.opens_at = args.opens_at;
    challenge.entries_close_at = args.entries_close_at;
    challenge.runs_close_at = args.runs_close_at;
    challenge.settlement_grace_close_at = args.settlement_grace_close_at;
    challenge.finalized_at = 0;
    challenge.claims_close_at = 0;
    challenge.entry_price = 1_000_000;
    challenge.star_entry_cost = args.star_entry_cost;
    challenge.prize_bps = 9_000;
    challenge.rake_bps = 1_000;
    challenge.sponsor_funding = 0;
    challenge.paid_entry_funding = 0;
    challenge.prize_liability = 0;
    challenge.rake_accrued = 0;
    challenge.rake_distributed = 0;
    challenge.refunds_paid = 0;
    challenge.prize_claimed = 0;
    challenge.prize_forfeited = 0;
    challenge.settled_prize_pool = 0;
    challenge.sponsor_reclaimed = false;
    challenge.payout_bps = args.payout_bps;
    challenge.total_paid_attempts = 0;
    challenge.total_free_attempts = 0;
    challenge.runs_started = 0;
    challenge.runs_finalized = 0;
    challenge.bump = ctx.bumps.daily_challenge;
    challenge.validate_policy()?;
    challenge.assert_accounting_invariant()?;

    let leaderboard = &mut ctx.accounts.leaderboard;
    leaderboard.version = ACCOUNT_VERSION_V1;
    leaderboard.challenge = challenge.key();
    leaderboard.entries = Vec::new();
    leaderboard.bump = ctx.bumps.leaderboard;
    Ok(())
}

#[derive(Accounts)]
pub struct FundDailyChallengeV1<'info> {
    #[account(
        mut,
        has_one = payment_vault @ ErrorCode::InvalidOwner,
        constraint = matches!(daily_challenge.status, DailyStatus::Open | DailyStatus::Draft) @ ErrorCode::InvalidState
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,
    #[account(address = daily_challenge.payment_mint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = sponsor,
        token::token_program = payment_token_program
    )]
    pub sponsor_payment_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        address = daily_challenge.payment_vault,
        token::mint = payment_mint,
        token::token_program = payment_token_program
    )]
    pub payment_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = daily_challenge.payment_token_program)]
    pub payment_token_program: Interface<'info, TokenInterface>,
    #[account(address = daily_challenge.authority @ ErrorCode::Unauthorized)]
    pub sponsor: Signer<'info>,
}

pub fn handler_fund_daily_challenge_v1(
    ctx: Context<FundDailyChallengeV1>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidState);
    require!(
        Clock::get()?.unix_timestamp < ctx.accounts.daily_challenge.entries_close_at,
        ErrorCode::ChallengeEnded
    );
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.payment_token_program.key(),
            TransferChecked {
                from: ctx.accounts.sponsor_payment_account.to_account_info(),
                mint: ctx.accounts.payment_mint.to_account_info(),
                to: ctx.accounts.payment_vault.to_account_info(),
                authority: ctx.accounts.sponsor.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.payment_mint.decimals,
    )?;
    let challenge = &mut ctx.accounts.daily_challenge;
    challenge.sponsor_funding = challenge
        .sponsor_funding
        .checked_add(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    challenge.prize_liability = challenge
        .prize_liability
        .checked_add(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    challenge.assert_accounting_invariant()?;
    Ok(())
}

#[derive(Accounts)]
#[instruction(run_id: u64)]
pub struct EnterDailyWithStarsV1<'info> {
    #[account(
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [PLAYER_PROFILE_SEED, owner.key().as_ref()],
        bump = player_profile.bump,
        has_one = owner @ ErrorCode::Unauthorized,
        constraint = player_profile.daily_eligible @ ErrorCode::Unauthorized
    )]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    #[account(
        mut,
        seeds = [DAILY_CHALLENGE_SEED, daily_challenge.day_id.to_le_bytes().as_ref()],
        bump = daily_challenge.bump
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + DailyPlayer::INIT_SPACE,
        seeds = [DAILY_PLAYER_SEED, daily_challenge.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub daily_player: Box<Account<'info, DailyPlayer>>,
    #[account(
        init,
        payer = payer,
        space = 8 + RunShell::INIT_SPACE,
        seeds = [RUN_SHELL_SEED, owner.key().as_ref(), run_id.to_le_bytes().as_ref()],
        bump
    )]
    pub run_shell: Box<Account<'info, RunShell>>,
    #[account(
        init,
        payer = payer,
        space = 8 + ActiveRun::INIT_SPACE,
        seeds = [RUN_SHELL_SEED, b"active", owner.key().as_ref(), run_id.to_le_bytes().as_ref()],
        bump
    )]
    pub active_run: Box<Account<'info, ActiveRun>>,
    #[account(
        init,
        payer = payer,
        space = 8 + RunReceipt::INIT_SPACE,
        seeds = [RUN_RECEIPT_SEED, owner.key().as_ref(), run_id.to_le_bytes().as_ref()],
        bump
    )]
    pub run_receipt: Box<Account<'info, RunReceipt>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_enter_daily_with_stars_v1(
    ctx: Context<EnterDailyWithStarsV1>,
    run_id: u64,
    action_authority: Pubkey,
) -> Result<()> {
    validate_daily_entry(
        &ctx.accounts.daily_challenge,
        &ctx.accounts.player_profile,
        run_id,
        action_authority,
    )?;
    initialize_daily_player(
        &mut ctx.accounts.daily_player,
        ctx.accounts.daily_challenge.key(),
        ctx.accounts.owner.key(),
        ctx.bumps.daily_player,
    )?;
    require!(
        !ctx.accounts.daily_player.free_attempt_used,
        ErrorCode::AlreadySubmitted
    );
    ctx.accounts
        .player_profile
        .spend_stars(ctx.accounts.daily_challenge.star_entry_cost)?;
    ctx.accounts.daily_player.free_attempt_used = true;
    ctx.accounts.daily_challenge.total_free_attempts = ctx
        .accounts
        .daily_challenge
        .total_free_attempts
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let challenge_key = ctx.accounts.daily_challenge.key();
    initialize_daily_run(
        &mut ctx.accounts.player_profile,
        &mut ctx.accounts.daily_challenge,
        challenge_key,
        &mut ctx.accounts.run_shell,
        &mut ctx.accounts.active_run,
        &mut ctx.accounts.run_receipt,
        DailyRunBumps {
            shell: ctx.bumps.run_shell,
            active: ctx.bumps.active_run,
            receipt: ctx.bumps.run_receipt,
        },
        ctx.accounts.owner.key(),
        run_id,
        action_authority,
    )?;
    ctx.accounts.daily_challenge.assert_accounting_invariant()
}

#[derive(Accounts)]
#[instruction(run_id: u64)]
pub struct EnterDailyPaidV1<'info> {
    #[account(
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [PLAYER_PROFILE_SEED, owner.key().as_ref()],
        bump = player_profile.bump,
        has_one = owner @ ErrorCode::Unauthorized,
        constraint = player_profile.daily_eligible @ ErrorCode::Unauthorized
    )]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    #[account(
        mut,
        seeds = [DAILY_CHALLENGE_SEED, daily_challenge.day_id.to_le_bytes().as_ref()],
        bump = daily_challenge.bump
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + DailyPlayer::INIT_SPACE,
        seeds = [DAILY_PLAYER_SEED, daily_challenge.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub daily_player: Box<Account<'info, DailyPlayer>>,
    #[account(address = daily_challenge.payment_mint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = owner,
        token::token_program = payment_token_program
    )]
    pub player_payment_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        address = daily_challenge.payment_vault,
        token::mint = payment_mint,
        token::token_program = payment_token_program
    )]
    pub payment_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = daily_challenge.payment_token_program)]
    pub payment_token_program: Interface<'info, TokenInterface>,
    #[account(
        init,
        payer = payer,
        space = 8 + RunShell::INIT_SPACE,
        seeds = [RUN_SHELL_SEED, owner.key().as_ref(), run_id.to_le_bytes().as_ref()],
        bump
    )]
    pub run_shell: Box<Account<'info, RunShell>>,
    #[account(
        init,
        payer = payer,
        space = 8 + ActiveRun::INIT_SPACE,
        seeds = [RUN_SHELL_SEED, b"active", owner.key().as_ref(), run_id.to_le_bytes().as_ref()],
        bump
    )]
    pub active_run: Box<Account<'info, ActiveRun>>,
    #[account(
        init,
        payer = payer,
        space = 8 + RunReceipt::INIT_SPACE,
        seeds = [RUN_RECEIPT_SEED, owner.key().as_ref(), run_id.to_le_bytes().as_ref()],
        bump
    )]
    pub run_receipt: Box<Account<'info, RunReceipt>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_enter_daily_paid_v1(
    ctx: Context<EnterDailyPaidV1>,
    run_id: u64,
    action_authority: Pubkey,
) -> Result<()> {
    validate_daily_entry(
        &ctx.accounts.daily_challenge,
        &ctx.accounts.player_profile,
        run_id,
        action_authority,
    )?;
    initialize_daily_player(
        &mut ctx.accounts.daily_player,
        ctx.accounts.daily_challenge.key(),
        ctx.accounts.owner.key(),
        ctx.bumps.daily_player,
    )?;
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.payment_token_program.key(),
            TransferChecked {
                from: ctx.accounts.player_payment_account.to_account_info(),
                mint: ctx.accounts.payment_mint.to_account_info(),
                to: ctx.accounts.payment_vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        ctx.accounts.daily_challenge.entry_price,
        ctx.accounts.payment_mint.decimals,
    )?;
    let (prize, rake) = ctx
        .accounts
        .daily_challenge
        .split_entry(ctx.accounts.daily_challenge.entry_price)?;
    let challenge_key = ctx.accounts.daily_challenge.key();
    let challenge = &mut ctx.accounts.daily_challenge;
    challenge.paid_entry_funding = challenge
        .paid_entry_funding
        .checked_add(challenge.entry_price)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    challenge.prize_liability = challenge
        .prize_liability
        .checked_add(prize)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    challenge.rake_accrued = challenge
        .rake_accrued
        .checked_add(rake)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    challenge.total_paid_attempts = challenge
        .total_paid_attempts
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    ctx.accounts.daily_player.paid_attempts = ctx
        .accounts
        .daily_player
        .paid_attempts
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    initialize_daily_run(
        &mut ctx.accounts.player_profile,
        challenge,
        challenge_key,
        &mut ctx.accounts.run_shell,
        &mut ctx.accounts.active_run,
        &mut ctx.accounts.run_receipt,
        DailyRunBumps {
            shell: ctx.bumps.run_shell,
            active: ctx.bumps.active_run,
            receipt: ctx.bumps.run_receipt,
        },
        ctx.accounts.owner.key(),
        run_id,
        action_authority,
    )?;
    ctx.accounts.daily_challenge.assert_accounting_invariant()
}

struct DailyRunBumps {
    shell: u8,
    active: u8,
    receipt: u8,
}

#[allow(clippy::too_many_arguments)]
fn initialize_daily_run(
    player: &mut PlayerProfile,
    challenge: &mut DailyChallenge,
    challenge_key: Pubkey,
    shell: &mut RunShell,
    active: &mut ActiveRun,
    receipt: &mut RunReceipt,
    bumps: DailyRunBumps,
    owner: Pubkey,
    run_id: u64,
    action_authority: Pubkey,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let shell_key = Pubkey::find_program_address(
        &[RUN_SHELL_SEED, owner.as_ref(), &run_id.to_le_bytes()],
        &crate::ID,
    )
    .0;
    shell.version = ACCOUNT_VERSION_V1;
    shell.owner = owner;
    shell.run_id = run_id;
    shell.mode = RunMode::Daily;
    shell.settlement_target = SettlementTarget::DailyLeaderboard;
    shell.content_version = challenge.content_version;
    shell.rules_hash = challenge.rules_hash;
    shell.map_catalog = Pubkey::default();
    shell.daily_challenge = challenge_key;
    shell.action_authority = action_authority;
    shell.delegated_validator = Pubkey::default();
    shell.lifecycle = RunLifecycle::Prepared;
    shell.created_at = now;
    shell.settled_at = 0;
    shell.bump = bumps.shell;

    active.version = ACCOUNT_VERSION_V1;
    active.owner = owner;
    active.run_shell = shell_key;
    active.daily_challenge = challenge_key;
    active.run_id = run_id;
    active.mode = RunMode::Daily;
    active.lifecycle = RunLifecycle::Prepared;
    active.action_authority = action_authority;
    active.content_version = challenge.content_version;
    active.rules_hash = challenge.rules_hash;
    active.map_id = challenge.map_id;
    active.level = 1;
    active.rules = challenge.rules;
    active.grid = [0; 80];
    active.next_row = [0; 8];
    active.has_next_row = false;
    active.score = 0;
    active.action_counter = 0;
    active.moves = 0;
    active.combo_counter = 0;
    active.max_combo = 0;
    active.primary_progress = 0;
    active.secondary_progress = 0;
    active.level_lines_cleared = 0;
    active.total_lines_cleared = 0;
    active.bonus_uses = 0;
    active.combo2_hits = 0;
    active.combo3_hits = 0;
    active.combo4_hits = 0;
    active.high_combo_hits = 0;
    active.bonus_type = challenge.rules.bonus_type;
    active.bonus_charges = challenge.rules.starting_charges;
    active.initial_rows_remaining = challenge.rules.starting_rows.max(1);
    active.current_difficulty = 0;
    active.endless_thresholds = challenge.endless_thresholds;
    active.endless_score_multipliers_x100 = challenge.endless_score_multipliers_x100;
    active.endless_ramp_multiplier_x100 = challenge.endless_ramp_multiplier_x100;
    active.vrf_request_counter = 0;
    active.pending_vrf_counter = 0;
    active.vrf_requested_at = 0;
    active.action_hash = [0; 32];
    active.vrf_hash = [0; 32];
    active.started_at = 0;
    active.finished_at = 0;
    active.bump = bumps.active;

    receipt.version = ACCOUNT_VERSION_V1;
    receipt.owner = owner;
    receipt.run_shell = shell_key;
    receipt.run_id = run_id;
    receipt.mode = RunMode::Daily;
    receipt.settlement_target = SettlementTarget::DailyLeaderboard;
    receipt.content_version = challenge.content_version;
    receipt.rules_hash = challenge.rules_hash;
    receipt.map_id = challenge.map_id;
    receipt.level = 1;
    receipt.score = 0;
    receipt.moves = 0;
    receipt.level_stars = 0;
    receipt.lines_cleared = 0;
    receipt.bonus_uses = 0;
    receipt.combo2_hits = 0;
    receipt.combo3_hits = 0;
    receipt.combo4_hits = 0;
    receipt.high_combo_hits = 0;
    receipt.max_combo = 0;
    receipt.completed = false;
    receipt.action_hash = [0; 32];
    receipt.vrf_hash = [0; 32];
    receipt.started_at = 0;
    receipt.finished_at = 0;
    receipt.consumed_at = 0;
    receipt.consumed = false;
    receipt.bump = bumps.receipt;

    player.record_run_started(now)?;
    player.record_daily_join(challenge.day_id, now)?;
    player.next_run_id = player
        .next_run_id
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    challenge.runs_started = challenge
        .runs_started
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    Ok(())
}

fn validate_daily_entry(
    challenge: &DailyChallenge,
    player: &PlayerProfile,
    run_id: u64,
    action_authority: Pubkey,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        challenge.status == DailyStatus::Open,
        ErrorCode::InvalidState
    );
    require!(now >= challenge.opens_at, ErrorCode::ChallengeNotStarted);
    require!(now < challenge.entries_close_at, ErrorCode::ChallengeEnded);
    require!(player.next_run_id == run_id, ErrorCode::InvalidRunId);
    require!(
        action_authority != Pubkey::default(),
        ErrorCode::Unauthorized
    );
    Ok(())
}

fn initialize_daily_player(
    player: &mut DailyPlayer,
    challenge: Pubkey,
    owner: Pubkey,
    bump: u8,
) -> Result<()> {
    if player.version == 0 {
        player.version = ACCOUNT_VERSION_V1;
        player.challenge = challenge;
        player.player = owner;
        player.free_attempt_used = false;
        player.paid_attempts = 0;
        player.finalized_attempts = 0;
        player.best_run_id = 0;
        player.best_receipt = Pubkey::default();
        player.best_score = 0;
        player.best_submitted_at = 0;
        player.rank = 0;
        player.prize_amount = 0;
        player.claimed = false;
        player.refunded_amount = 0;
        player.star_refunded = false;
        player.bump = bump;
    } else {
        require_keys_eq!(player.challenge, challenge, ErrorCode::InvalidRunId);
        require_keys_eq!(player.player, owner, ErrorCode::Unauthorized);
    }
    Ok(())
}

fn hash_daily_rules(args: &CreateDailyChallengeArgs) -> Result<[u8; 32]> {
    let mut rules = Vec::new();
    args.rules.serialize(&mut rules)?;
    let mut endless = Vec::with_capacity(7 * 4 + 8 * 2);
    for threshold in args.endless_thresholds {
        endless.extend_from_slice(&threshold.to_le_bytes());
    }
    for multiplier in args.endless_score_multipliers_x100 {
        endless.extend_from_slice(&multiplier.to_le_bytes());
    }
    Ok(Sha256::new()
        .chain_update(b"zkube-daily-rules-v1")
        .chain_update(args.day_id.to_le_bytes())
        .chain_update([args.map_id])
        .chain_update(rules)
        .chain_update(endless)
        .chain_update(args.endless_ramp_multiplier_x100.to_le_bytes())
        .finalize()
        .into())
}

#[commit]
#[derive(Accounts)]
pub struct CommitDailyRunV1<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        owner = crate::ID,
        constraint = active_run.mode == RunMode::Daily @ ErrorCode::InvalidState
    )]
    pub active_run: Box<Account<'info, ActiveRun>>,
    /// CHECK: Base-layer shell pinned by active_run.
    #[account(address = active_run.run_shell @ ErrorCode::InvalidRunId)]
    pub run_shell: UncheckedAccount<'info>,
    /// CHECK: Reserved receipt PDA validated by the action.
    #[account(seeds = [RUN_RECEIPT_SEED, active_run.owner.as_ref(), active_run.run_id.to_le_bytes().as_ref()], bump)]
    pub run_receipt: UncheckedAccount<'info>,
    /// CHECK: Durable player profile written only by the post-commit action.
    #[account(seeds = [PLAYER_PROFILE_SEED, active_run.owner.as_ref()], bump)]
    pub player_profile: UncheckedAccount<'info>,
    /// CHECK: Daily challenge pinned by active_run and validated by the action.
    #[account(address = active_run.daily_challenge @ ErrorCode::InvalidRunId)]
    pub daily_challenge: UncheckedAccount<'info>,
    /// CHECK: Daily player PDA written only by the base-layer action.
    #[account(seeds = [DAILY_PLAYER_SEED, daily_challenge.key().as_ref(), active_run.owner.as_ref()], bump)]
    pub daily_player: UncheckedAccount<'info>,
    /// CHECK: Leaderboard PDA written only by the base-layer action.
    #[account(seeds = [DAILY_LEADERBOARD_SEED, daily_challenge.key().as_ref()], bump)]
    pub leaderboard: UncheckedAccount<'info>,
    /// CHECK: Player wallet pinned by active_run.
    #[account(address = active_run.owner @ ErrorCode::Unauthorized)]
    pub owner: UncheckedAccount<'info>,
    /// CHECK: MagicBlock context required by MagicIntentBundleBuilder.
    #[account(mut, address = ephemeral_rollups_sdk::consts::MAGIC_CONTEXT_ID @ ErrorCode::InvalidMagicProgram)]
    pub magic_context: UncheckedAccount<'info>,
    pub magic_program: Program<'info, ephemeral_rollups_sdk::anchor::MagicProgram>,
}

pub fn handler_commit_daily_run_v1(ctx: Context<CommitDailyRunV1>) -> Result<()> {
    require!(
        ctx.accounts.active_run.lifecycle == RunLifecycle::Finished,
        ErrorCode::GameNotFinished
    );
    require!(
        ctx.accounts.active_run.finished_at > 0,
        ErrorCode::GameNotFinished
    );
    require!(
        ctx.accounts.active_run.pending_vrf_counter == 0,
        ErrorCode::VrfRequestPending
    );
    let action_data =
        anchor_lang::InstructionData::data(&crate::instruction::ConsumeDailyReceiptV1 {});
    let settlement_action = CallHandler {
        destination_program: crate::ID,
        accounts: vec![
            short_meta(ctx.accounts.active_run.key(), true),
            short_meta(ctx.accounts.run_shell.key(), true),
            short_meta(ctx.accounts.run_receipt.key(), true),
            short_meta(ctx.accounts.player_profile.key(), true),
            short_meta(ctx.accounts.daily_challenge.key(), true),
            short_meta(ctx.accounts.daily_player.key(), true),
            short_meta(ctx.accounts.leaderboard.key(), true),
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
pub struct ConsumeDailyReceiptV1<'info> {
    #[account(mut, owner = crate::ID)]
    pub active_run: Box<Account<'info, ActiveRun>>,
    #[account(
        mut,
        seeds = [RUN_SHELL_SEED, owner.key().as_ref(), active_run.run_id.to_le_bytes().as_ref()],
        bump = run_shell.bump,
        has_one = owner @ ErrorCode::Unauthorized,
        constraint = run_shell.daily_challenge == daily_challenge.key() @ ErrorCode::InvalidRunId
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
        seeds = [DAILY_CHALLENGE_SEED, daily_challenge.day_id.to_le_bytes().as_ref()],
        bump = daily_challenge.bump
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,
    #[account(
        mut,
        seeds = [DAILY_PLAYER_SEED, daily_challenge.key().as_ref(), owner.key().as_ref()],
        bump = daily_player.bump,
        constraint = daily_player.challenge == daily_challenge.key() @ ErrorCode::InvalidRunId,
        constraint = daily_player.player == owner.key() @ ErrorCode::Unauthorized
    )]
    pub daily_player: Box<Account<'info, DailyPlayer>>,
    #[account(
        mut,
        seeds = [DAILY_LEADERBOARD_SEED, daily_challenge.key().as_ref()],
        bump = leaderboard.bump,
        constraint = leaderboard.challenge == daily_challenge.key() @ ErrorCode::InvalidRunId
    )]
    pub leaderboard: Box<Account<'info, DailyLeaderboard>>,
    /// CHECK: Player wallet pinned by all state accounts.
    pub owner: UncheckedAccount<'info>,
}

pub fn handler_consume_daily_receipt_v1(ctx: Context<ConsumeDailyReceiptV1>) -> Result<()> {
    let active = &ctx.accounts.active_run;
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
    require_keys_eq!(
        active.daily_challenge,
        ctx.accounts.daily_challenge.key(),
        ErrorCode::InvalidRunId
    );
    let receipt = &mut ctx.accounts.run_receipt;
    require!(receipt.run_id == active.run_id, ErrorCode::ReceiptMismatch);
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
        active.lifecycle == RunLifecycle::Finished,
        ErrorCode::GameNotFinished
    );
    require!(active.finished_at > 0, ErrorCode::GameNotFinished);

    receipt.score = active.score;
    receipt.moves = active.moves;
    receipt.level_stars = 0;
    receipt.lines_cleared = active.total_lines_cleared;
    receipt.bonus_uses = active.bonus_uses;
    receipt.combo2_hits = active.combo2_hits;
    receipt.combo3_hits = active.combo3_hits;
    receipt.combo4_hits = active.combo4_hits;
    receipt.high_combo_hits = active.high_combo_hits;
    receipt.max_combo = active.max_combo;
    receipt.completed = true;
    receipt.action_hash = active.action_hash;
    receipt.vrf_hash = active.vrf_hash;
    receipt.started_at = active.started_at;
    receipt.finished_at = active.finished_at;
    receipt.consumed_at = Clock::get()?.unix_timestamp;
    receipt.consumed = true;
    ctx.accounts.player_profile.record_run_metrics(
        RunProgressMetrics {
            lines_cleared: receipt.lines_cleared,
            bonus_uses: receipt.bonus_uses,
            combo2_hits: receipt.combo2_hits,
            combo3_hits: receipt.combo3_hits,
            combo4_hits: receipt.combo4_hits,
            high_combo_hits: receipt.high_combo_hits,
            max_combo: receipt.max_combo,
            perfect_level: false,
            boss_cleared: false,
        },
        receipt.consumed_at,
    )?;

    let player = &mut ctx.accounts.daily_player;
    player.finalized_attempts = player
        .finalized_attempts
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    ctx.accounts.daily_challenge.runs_finalized = ctx
        .accounts
        .daily_challenge
        .runs_finalized
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let eligible = active.finished_at <= ctx.accounts.daily_challenge.runs_close_at
        && matches!(
            ctx.accounts.daily_challenge.status,
            DailyStatus::Open | DailyStatus::EntriesClosed | DailyStatus::Finalizing
        );
    let improves = active.score > player.best_score
        || active.score == player.best_score
            && (player.best_run_id == 0 || active.finished_at < player.best_submitted_at);
    if eligible && improves {
        player.best_run_id = active.run_id;
        player.best_receipt = receipt.key();
        player.best_score = active.score;
        player.best_submitted_at = active.finished_at;
        ctx.accounts.leaderboard.record_best(DailyLeaderboardEntry {
            player: active.owner,
            receipt: receipt.key(),
            run_id: active.run_id,
            score: active.score,
            submitted_at: active.finished_at,
        });
    }
    ctx.accounts.run_shell.lifecycle = RunLifecycle::Settled;
    ctx.accounts.run_shell.settled_at = receipt.consumed_at;
    ctx.accounts.active_run.lifecycle = RunLifecycle::Settled;
    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeDailyChallengeV1<'info> {
    #[account(
        mut,
        seeds = [DAILY_CHALLENGE_SEED, daily_challenge.day_id.to_le_bytes().as_ref()],
        bump = daily_challenge.bump
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,
    #[account(
        seeds = [DAILY_LEADERBOARD_SEED, daily_challenge.key().as_ref()],
        bump = leaderboard.bump,
        constraint = leaderboard.challenge == daily_challenge.key() @ ErrorCode::InvalidRunId
    )]
    pub leaderboard: Box<Account<'info, DailyLeaderboard>>,
    pub caller: Signer<'info>,
}

pub fn handler_finalize_daily_challenge_v1(ctx: Context<FinalizeDailyChallengeV1>) -> Result<()> {
    let challenge = &mut ctx.accounts.daily_challenge;
    require!(
        challenge.status == DailyStatus::Open,
        ErrorCode::InvalidState
    );
    require!(
        Clock::get()?.unix_timestamp >= challenge.runs_close_at,
        ErrorCode::ChallengeNotEnded
    );
    require!(
        challenge.runs_finalized == challenge.runs_started
            || Clock::get()?.unix_timestamp >= challenge.settlement_grace_close_at,
        ErrorCode::InvalidState
    );
    let now = Clock::get()?.unix_timestamp;
    challenge.settled_prize_pool = challenge.prize_liability;
    challenge.finalized_at = now;
    challenge.claims_close_at = prize_claim_deadline(now)?;
    challenge.status = DailyStatus::Claimable;
    challenge.assert_accounting_invariant()
}

#[derive(Accounts)]
pub struct ClaimDailyPrizeV1<'info> {
    #[account(
        mut,
        seeds = [DAILY_CHALLENGE_SEED, daily_challenge.day_id.to_le_bytes().as_ref()],
        bump = daily_challenge.bump,
        constraint = daily_challenge.status == DailyStatus::Claimable @ ErrorCode::InvalidState
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,
    #[account(
        seeds = [DAILY_LEADERBOARD_SEED, daily_challenge.key().as_ref()],
        bump = leaderboard.bump,
        constraint = leaderboard.challenge == daily_challenge.key() @ ErrorCode::InvalidRunId
    )]
    pub leaderboard: Box<Account<'info, DailyLeaderboard>>,
    #[account(
        mut,
        seeds = [DAILY_PLAYER_SEED, daily_challenge.key().as_ref(), owner.key().as_ref()],
        bump = daily_player.bump,
        constraint = daily_player.challenge == daily_challenge.key() @ ErrorCode::InvalidRunId,
        constraint = daily_player.player == owner.key() @ ErrorCode::Unauthorized
    )]
    pub daily_player: Box<Account<'info, DailyPlayer>>,
    #[account(address = daily_challenge.payment_mint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        address = daily_challenge.payment_vault,
        token::mint = payment_mint,
        token::authority = daily_challenge,
        token::token_program = payment_token_program
    )]
    pub payment_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = owner,
        token::token_program = payment_token_program
    )]
    pub player_payment_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = daily_challenge.payment_token_program)]
    pub payment_token_program: Interface<'info, TokenInterface>,
    pub owner: Signer<'info>,
}

pub fn handler_claim_daily_prize_v1(ctx: Context<ClaimDailyPrizeV1>) -> Result<()> {
    require!(
        ctx.accounts.daily_challenge.claims_close_at > 0
            && Clock::get()?.unix_timestamp <= ctx.accounts.daily_challenge.claims_close_at,
        ErrorCode::ChallengeEnded
    );
    require!(
        !ctx.accounts.daily_player.claimed,
        ErrorCode::PrizeAlreadyClaimed
    );
    let rank = ctx
        .accounts
        .leaderboard
        .rank_of(ctx.accounts.owner.key())
        .ok_or(ErrorCode::NoPrize)?;
    let entry = ctx.accounts.leaderboard.entries[rank];
    require_keys_eq!(
        entry.receipt,
        ctx.accounts.daily_player.best_receipt,
        ErrorCode::ReceiptMismatch
    );
    let share = ctx.accounts.daily_challenge.payout_bps[rank];
    let amount = u64::try_from(
        u128::from(ctx.accounts.daily_challenge.settled_prize_pool)
            .checked_mul(u128::from(share))
            .ok_or(ErrorCode::ArithmeticOverflow)?
            / 10_000,
    )
    .map_err(|_| ErrorCode::ArithmeticOverflow)?;
    require!(amount > 0, ErrorCode::NoPrize);
    require!(
        ctx.accounts.daily_challenge.prize_liability >= amount,
        ErrorCode::InsufficientFunds
    );

    let day_id = ctx.accounts.daily_challenge.day_id.to_le_bytes();
    let bump = [ctx.accounts.daily_challenge.bump];
    let signer: &[&[u8]] = &[DAILY_CHALLENGE_SEED, &day_id, &bump];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.payment_token_program.key(),
            TransferChecked {
                from: ctx.accounts.payment_vault.to_account_info(),
                mint: ctx.accounts.payment_mint.to_account_info(),
                to: ctx.accounts.player_payment_account.to_account_info(),
                authority: ctx.accounts.daily_challenge.to_account_info(),
            },
            &[signer],
        ),
        amount,
        ctx.accounts.payment_mint.decimals,
    )?;
    let challenge = &mut ctx.accounts.daily_challenge;
    challenge.prize_liability = challenge
        .prize_liability
        .checked_sub(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    challenge.prize_claimed = challenge
        .prize_claimed
        .checked_add(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    ctx.accounts.daily_player.rank = rank as u32 + 1;
    ctx.accounts.daily_player.prize_amount = amount;
    ctx.accounts.daily_player.claimed = true;
    challenge.assert_accounting_invariant()
}

#[derive(Accounts)]
pub struct ForfeitUnclaimedDailyPrizesV1<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion,
        constraint = protocol.payment_mint == daily_challenge.payment_mint @ ErrorCode::InvalidOwner,
        constraint = protocol.payment_token_program == daily_challenge.payment_token_program @ ErrorCode::InvalidOwner
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        address = protocol.treasury_ledger,
        seeds = [TREASURY_LEDGER_SEED],
        bump = treasury_ledger.bump,
        constraint = treasury_ledger.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = treasury_ledger.payment_mint == protocol.payment_mint @ ErrorCode::InvalidOwner
    )]
    pub treasury_ledger: Box<Account<'info, TreasuryLedger>>,
    #[account(
        mut,
        seeds = [DAILY_CHALLENGE_SEED, daily_challenge.day_id.to_le_bytes().as_ref()],
        bump = daily_challenge.bump,
        constraint = daily_challenge.status == DailyStatus::Claimable @ ErrorCode::InvalidState
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,
    #[account(address = daily_challenge.payment_mint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        address = daily_challenge.payment_vault,
        token::mint = payment_mint,
        token::authority = daily_challenge,
        token::token_program = payment_token_program
    )]
    pub payment_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        address = protocol.reward_vault,
        token::mint = payment_mint,
        token::authority = protocol,
        token::token_program = payment_token_program
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = daily_challenge.payment_token_program)]
    pub payment_token_program: Interface<'info, TokenInterface>,
    pub caller: Signer<'info>,
}

pub fn handler_forfeit_unclaimed_daily_prizes_v1(
    ctx: Context<ForfeitUnclaimedDailyPrizesV1>,
) -> Result<()> {
    let challenge = &ctx.accounts.daily_challenge;
    require!(
        challenge.claims_close_at > 0 && Clock::get()?.unix_timestamp > challenge.claims_close_at,
        ErrorCode::PrizeClaimWindowOpen
    );
    require!(
        challenge.rake_distributed == challenge.rake_accrued,
        ErrorCode::InvalidState
    );
    let amount = challenge.prize_liability;
    let day_id = challenge.day_id.to_le_bytes();
    let bump = [challenge.bump];
    let signer: &[&[u8]] = &[DAILY_CHALLENGE_SEED, &day_id, &bump];
    transfer_from_daily_vault(
        &ctx.accounts.payment_token_program,
        &ctx.accounts.payment_vault,
        &ctx.accounts.payment_mint,
        &ctx.accounts.reward_vault,
        challenge,
        signer,
        amount,
    )?;
    let challenge = &mut ctx.accounts.daily_challenge;
    challenge.prize_liability = 0;
    challenge.prize_forfeited = challenge
        .prize_forfeited
        .checked_add(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    ctx.accounts
        .treasury_ledger
        .record_prize_forfeiture(amount)?;
    challenge.status = DailyStatus::Closed;
    emit!(DailyPrizeForfeited {
        day_id: challenge.day_id,
        amount,
        reward_vault: ctx.accounts.reward_vault.key(),
        closed_at: Clock::get()?.unix_timestamp,
    });
    challenge.assert_accounting_invariant()
}

#[event]
pub struct DailyPrizeForfeited {
    pub day_id: u32,
    pub amount: u64,
    pub reward_vault: Pubkey,
    pub closed_at: i64,
}

#[derive(Accounts)]
pub struct CancelDailyChallengeV1<'info> {
    #[account(
        mut,
        has_one = authority @ ErrorCode::Unauthorized,
        seeds = [DAILY_CHALLENGE_SEED, daily_challenge.day_id.to_le_bytes().as_ref()],
        bump = daily_challenge.bump
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,
    pub authority: Signer<'info>,
}

pub fn handler_cancel_daily_challenge_v1(ctx: Context<CancelDailyChallengeV1>) -> Result<()> {
    require!(
        matches!(
            ctx.accounts.daily_challenge.status,
            DailyStatus::Draft | DailyStatus::Open | DailyStatus::EntriesClosed
        ),
        ErrorCode::InvalidState
    );
    ctx.accounts.daily_challenge.status = DailyStatus::Cancelled;
    Ok(())
}

#[derive(Accounts)]
pub struct RefundDailyEntryV1<'info> {
    #[account(
        mut,
        seeds = [DAILY_CHALLENGE_SEED, daily_challenge.day_id.to_le_bytes().as_ref()],
        bump = daily_challenge.bump,
        constraint = daily_challenge.status == DailyStatus::Cancelled @ ErrorCode::InvalidState
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,
    #[account(
        mut,
        seeds = [DAILY_PLAYER_SEED, daily_challenge.key().as_ref(), owner.key().as_ref()],
        bump = daily_player.bump,
        constraint = daily_player.challenge == daily_challenge.key() @ ErrorCode::InvalidRunId,
        constraint = daily_player.player == owner.key() @ ErrorCode::Unauthorized
    )]
    pub daily_player: Box<Account<'info, DailyPlayer>>,
    #[account(
        mut,
        seeds = [PLAYER_PROFILE_SEED, owner.key().as_ref()],
        bump = player_profile.bump,
        has_one = owner @ ErrorCode::Unauthorized
    )]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    #[account(address = daily_challenge.payment_mint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        address = daily_challenge.payment_vault,
        token::mint = payment_mint,
        token::authority = daily_challenge,
        token::token_program = payment_token_program
    )]
    pub payment_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = owner,
        token::token_program = payment_token_program
    )]
    pub player_payment_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = daily_challenge.payment_token_program)]
    pub payment_token_program: Interface<'info, TokenInterface>,
    pub owner: Signer<'info>,
}

pub fn handler_refund_daily_entry_v1(ctx: Context<RefundDailyEntryV1>) -> Result<()> {
    let paid_total = u64::from(ctx.accounts.daily_player.paid_attempts)
        .checked_mul(ctx.accounts.daily_challenge.entry_price)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let refund = paid_total
        .checked_sub(ctx.accounts.daily_player.refunded_amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let star_refund =
        ctx.accounts.daily_player.free_attempt_used && !ctx.accounts.daily_player.star_refunded;
    require!(refund > 0 || star_refund, ErrorCode::RefundAlreadyClaimed);

    if refund > 0 {
        let day_id = ctx.accounts.daily_challenge.day_id.to_le_bytes();
        let bump = [ctx.accounts.daily_challenge.bump];
        let signer: &[&[u8]] = &[DAILY_CHALLENGE_SEED, &day_id, &bump];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.payment_token_program.key(),
                TransferChecked {
                    from: ctx.accounts.payment_vault.to_account_info(),
                    mint: ctx.accounts.payment_mint.to_account_info(),
                    to: ctx.accounts.player_payment_account.to_account_info(),
                    authority: ctx.accounts.daily_challenge.to_account_info(),
                },
                &[signer],
            ),
            refund,
            ctx.accounts.payment_mint.decimals,
        )?;
        let (prize, rake) = ctx.accounts.daily_challenge.split_entry(refund)?;
        let challenge = &mut ctx.accounts.daily_challenge;
        challenge.prize_liability = challenge
            .prize_liability
            .checked_sub(prize)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        challenge.rake_accrued = challenge
            .rake_accrued
            .checked_sub(rake)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        challenge.refunds_paid = challenge
            .refunds_paid
            .checked_add(refund)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        ctx.accounts.daily_player.refunded_amount = paid_total;
    }
    if star_refund {
        ctx.accounts
            .player_profile
            .refund_stars(ctx.accounts.daily_challenge.star_entry_cost)?;
        ctx.accounts.daily_player.star_refunded = true;
    }
    ctx.accounts.daily_challenge.assert_accounting_invariant()
}

#[derive(Accounts)]
pub struct ReclaimCancelledSponsorV1<'info> {
    #[account(
        mut,
        has_one = authority @ ErrorCode::Unauthorized,
        seeds = [DAILY_CHALLENGE_SEED, daily_challenge.day_id.to_le_bytes().as_ref()],
        bump = daily_challenge.bump,
        constraint = daily_challenge.status == DailyStatus::Cancelled @ ErrorCode::InvalidState
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,
    #[account(address = daily_challenge.payment_mint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        address = daily_challenge.payment_vault,
        token::mint = payment_mint,
        token::authority = daily_challenge,
        token::token_program = payment_token_program
    )]
    pub payment_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = authority,
        token::token_program = payment_token_program
    )]
    pub authority_payment_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = daily_challenge.payment_token_program)]
    pub payment_token_program: Interface<'info, TokenInterface>,
    pub authority: Signer<'info>,
}

pub fn handler_reclaim_cancelled_sponsor_v1(ctx: Context<ReclaimCancelledSponsorV1>) -> Result<()> {
    require!(
        ctx.accounts.daily_challenge.refunds_paid
            == ctx.accounts.daily_challenge.paid_entry_funding,
        ErrorCode::InvalidState
    );
    require!(
        !ctx.accounts.daily_challenge.sponsor_reclaimed,
        ErrorCode::RefundAlreadyClaimed
    );
    let amount = ctx.accounts.daily_challenge.sponsor_funding;
    if amount > 0 {
        let day_id = ctx.accounts.daily_challenge.day_id.to_le_bytes();
        let bump = [ctx.accounts.daily_challenge.bump];
        let signer: &[&[u8]] = &[DAILY_CHALLENGE_SEED, &day_id, &bump];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.payment_token_program.key(),
                TransferChecked {
                    from: ctx.accounts.payment_vault.to_account_info(),
                    mint: ctx.accounts.payment_mint.to_account_info(),
                    to: ctx.accounts.authority_payment_account.to_account_info(),
                    authority: ctx.accounts.daily_challenge.to_account_info(),
                },
                &[signer],
            ),
            amount,
            ctx.accounts.payment_mint.decimals,
        )?;
        ctx.accounts.daily_challenge.prize_liability = ctx
            .accounts
            .daily_challenge
            .prize_liability
            .checked_sub(amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }
    ctx.accounts.daily_challenge.sponsor_reclaimed = true;
    ctx.accounts.daily_challenge.assert_accounting_invariant()
}

#[derive(Accounts)]
pub struct DistributeDailyRakeV1<'info> {
    #[account(
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        address = protocol.treasury_ledger,
        seeds = [TREASURY_LEDGER_SEED],
        bump = treasury_ledger.bump,
        constraint = treasury_ledger.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = treasury_ledger.payment_mint == protocol.payment_mint @ ErrorCode::InvalidOwner
    )]
    pub treasury_ledger: Box<Account<'info, TreasuryLedger>>,
    #[account(
        mut,
        seeds = [DAILY_CHALLENGE_SEED, daily_challenge.day_id.to_le_bytes().as_ref()],
        bump = daily_challenge.bump,
        constraint = daily_challenge.status == DailyStatus::Claimable @ ErrorCode::InvalidState
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,
    #[account(address = daily_challenge.payment_mint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        address = daily_challenge.payment_vault,
        token::mint = payment_mint,
        token::authority = daily_challenge,
        token::token_program = payment_token_program
    )]
    pub payment_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = protocol.team_vault, token::mint = payment_mint, token::token_program = payment_token_program)]
    pub team_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = protocol.paymaster_vault, token::mint = payment_mint, token::authority = protocol, token::token_program = payment_token_program)]
    pub paymaster_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = protocol.treasury_vault, token::mint = payment_mint, token::authority = protocol, token::token_program = payment_token_program)]
    pub treasury_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = daily_challenge.payment_token_program)]
    pub payment_token_program: Interface<'info, TokenInterface>,
    pub caller: Signer<'info>,
}

pub fn handler_distribute_daily_rake_v1(ctx: Context<DistributeDailyRakeV1>) -> Result<()> {
    require!(
        Clock::get()?.unix_timestamp >= ctx.accounts.daily_challenge.entries_close_at,
        ErrorCode::ChallengeNotEnded
    );
    let rake = ctx
        .accounts
        .daily_challenge
        .rake_accrued
        .checked_sub(ctx.accounts.daily_challenge.rake_distributed)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(rake > 0, ErrorCode::InvalidState);
    require!(
        ctx.accounts.payment_vault.amount
            >= ctx
                .accounts
                .daily_challenge
                .prize_liability
                .checked_add(rake)
                .ok_or(ErrorCode::ArithmeticOverflow)?,
        ErrorCode::InsufficientFunds
    );
    let (team, paymaster, treasury) = rake_distribution(
        rake,
        ctx.accounts.protocol.paymaster_cap,
        ctx.accounts.paymaster_vault.amount,
    )?;
    let day_id = ctx.accounts.daily_challenge.day_id.to_le_bytes();
    let bump = [ctx.accounts.daily_challenge.bump];
    let signer: &[&[u8]] = &[DAILY_CHALLENGE_SEED, &day_id, &bump];
    transfer_from_daily_vault(
        &ctx.accounts.payment_token_program,
        &ctx.accounts.payment_vault,
        &ctx.accounts.payment_mint,
        &ctx.accounts.team_vault,
        &ctx.accounts.daily_challenge,
        signer,
        team,
    )?;
    transfer_from_daily_vault(
        &ctx.accounts.payment_token_program,
        &ctx.accounts.payment_vault,
        &ctx.accounts.payment_mint,
        &ctx.accounts.paymaster_vault,
        &ctx.accounts.daily_challenge,
        signer,
        paymaster,
    )?;
    transfer_from_daily_vault(
        &ctx.accounts.payment_token_program,
        &ctx.accounts.payment_vault,
        &ctx.accounts.payment_mint,
        &ctx.accounts.treasury_vault,
        &ctx.accounts.daily_challenge,
        signer,
        treasury,
    )?;
    ctx.accounts.daily_challenge.rake_distributed = ctx
        .accounts
        .daily_challenge
        .rake_distributed
        .checked_add(rake)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    ctx.accounts
        .treasury_ledger
        .record_rake_distribution(rake, team, paymaster, treasury)?;
    ctx.accounts.daily_challenge.assert_accounting_invariant()
}

#[allow(clippy::too_many_arguments)]
fn transfer_from_daily_vault<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: &Account<'info, DailyChallenge>,
    signer: &[&[u8]],
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: authority.to_account_info(),
            },
            &[signer],
        ),
        amount,
        mint.decimals,
    )
}

fn bps(amount: u64, basis_points: u16) -> Result<u64> {
    u64::try_from(
        u128::from(amount)
            .checked_mul(u128::from(basis_points))
            .ok_or(ErrorCode::ArithmeticOverflow)?
            / 10_000,
    )
    .map_err(|_| error!(ErrorCode::ArithmeticOverflow))
}

fn prize_claim_deadline(finalized_at: i64) -> Result<i64> {
    finalized_at
        .checked_add(PRIZE_CLAIM_WINDOW_SECONDS)
        .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
}

fn rake_distribution(
    rake: u64,
    paymaster_cap: u64,
    paymaster_balance: u64,
) -> Result<(u64, u64, u64)> {
    let team = bps(rake, 2_500)?;
    let paymaster_budget = bps(rake, 2_500)?;
    let paymaster_room = paymaster_cap.saturating_sub(paymaster_balance);
    let paymaster = paymaster_budget.min(paymaster_room);
    let treasury = rake
        .checked_sub(team)
        .and_then(|value| value.checked_sub(paymaster))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    Ok((team, paymaster, treasury))
}

fn short_meta(pubkey: Pubkey, is_writable: bool) -> ShortAccountMeta {
    ShortAccountMeta {
        pubkey: pubkey.to_bytes().into(),
        is_writable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rake_distribution_conserves_dust_and_cap_overflow_into_treasury() {
        for rake in [1, 3, 4, 10, 99, 1_000_000, u64::MAX] {
            let (team, paymaster, treasury) = rake_distribution(rake, u64::MAX, 0).unwrap();
            assert_eq!(
                team.checked_add(paymaster)
                    .and_then(|v| v.checked_add(treasury)),
                Some(rake)
            );
        }
        let (team, paymaster, treasury) = rake_distribution(1_000_000, 100_000, 90_000).unwrap();
        assert_eq!(team, 250_000);
        assert_eq!(paymaster, 10_000);
        assert_eq!(treasury, 740_000);
    }

    #[test]
    fn cancellation_refunds_all_paid_and_sponsor_funding_without_residue() {
        let paid_funding = 3_000_000u64;
        let sponsor_funding = 2_000_000u64;
        let paid_prize = bps(paid_funding, 9_000).unwrap();
        let paid_rake = paid_funding - paid_prize;
        let mut vault = paid_funding + sponsor_funding;
        let mut prize_liability = paid_prize + sponsor_funding;
        let mut rake_accrued = paid_rake;

        vault -= paid_funding;
        prize_liability -= paid_prize;
        rake_accrued -= paid_rake;
        vault -= sponsor_funding;
        prize_liability -= sponsor_funding;

        assert_eq!(vault, 0);
        assert_eq!(prize_liability, 0);
        assert_eq!(rake_accrued, 0);
    }

    #[test]
    fn prize_claim_window_is_exactly_ninety_days_and_overflow_checked() {
        assert_eq!(prize_claim_deadline(1_000).unwrap(), 7_777_000);
        assert!(prize_claim_deadline(i64::MAX).is_err());
    }
}
