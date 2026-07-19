//! Paid Arena entry, free Practice, stuck-run recovery, and push settlement.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction, system_program};
use session_keys::SessionTokenV2;

use crate::error::ErrorCode;
use crate::game::sha256v;
use crate::instructions::player_authorization::{
    require_player_authorization, require_player_rent_payer,
};
use crate::state::*;

#[derive(Accounts)]
pub struct InitializeArcade<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        constraint = daily_rules_catalog.version == RULES_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = daily_rules_catalog.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = daily_rules_catalog.content_version == protocol.content_version @ ErrorCode::ContentVersionMismatch,
        constraint = protocol.daily_rules_version == 0 || daily_rules_catalog.rules_version == protocol.daily_rules_version @ ErrorCode::InvalidVersion
    )]
    pub daily_rules_catalog: Box<Account<'info, DailyRulesCatalog>>,
    #[account(init, payer = authority, space = 8 + ArcadeConfig::INIT_SPACE, seeds = [ARCADE_CONFIG_SEED], bump)]
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    #[account(init, payer = authority, space = 8 + OperatorRevenueVault::INIT_SPACE, seeds = [OPERATOR_REVENUE_VAULT_SEED], bump)]
    pub operator_revenue_vault: Box<Account<'info, OperatorRevenueVault>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PublishArenaRulesArgs {
    pub content_version: u32,
    pub rules_version: u32,
    pub rotation_id: u32,
    pub starts_day: u32,
    pub rotation_seed: [u8; 32],
    pub scoring_rule_count: u8,
    pub scoring_rules: [DailyScoringRule; DAILY_SCORE_RULE_CAPACITY],
    pub pressure: DailyPressureProfile,
}

#[derive(Accounts)]
#[instruction(args: PublishArenaRulesArgs)]
pub struct PublishArenaRules<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(init, payer = authority, space = 8 + DailyRulesCatalog::INIT_SPACE,
        seeds = [DAILY_RULES_CATALOG_SEED, args.rules_version.to_le_bytes().as_ref()], bump)]
    pub daily_rules_catalog: Box<Account<'info, DailyRulesCatalog>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_publish_arena_rules(
    ctx: Context<PublishArenaRules>,
    args: PublishArenaRulesArgs,
) -> Result<()> {
    require!(
        args.content_version == ctx.accounts.protocol.content_version,
        ErrorCode::ContentVersionMismatch
    );
    let mut serialized = Vec::new();
    args.serialize(&mut serialized)?;
    let catalog_hash = sha256v(&[b"zkube-arena-catalog-v1", &serialized]);
    let catalog = DailyRulesCatalog {
        version: RULES_ACCOUNT_VERSION,
        rules_version: args.rules_version,
        protocol: ctx.accounts.protocol.key(),
        content_version: args.content_version,
        catalog_hash,
        rotation_id: args.rotation_id,
        starts_day: args.starts_day,
        rotation_seed: args.rotation_seed,
        scoring_rule_count: args.scoring_rule_count,
        scoring_rules: args.scoring_rules,
        pressure: args.pressure,
        bump: ctx.bumps.daily_rules_catalog,
    };
    catalog.validate()?;
    ctx.accounts.daily_rules_catalog.set_inner(catalog);
    Ok(())
}

#[derive(Accounts)]
pub struct ActivateArenaRules<'info> {
    #[account(mut, seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.paused @ ErrorCode::ProtocolPaused)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [ARCADE_CONFIG_SEED], bump = arcade_config.bump,
        constraint = arcade_config.protocol == protocol.key() @ ErrorCode::InvalidOwner)]
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    #[account(
        constraint = daily_rules_catalog.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = daily_rules_catalog.content_version == protocol.content_version @ ErrorCode::ContentVersionMismatch)]
    pub daily_rules_catalog: Box<Account<'info, DailyRulesCatalog>>,
    pub authority: Signer<'info>,
}

pub fn handler_activate_arena_rules(ctx: Context<ActivateArenaRules>) -> Result<()> {
    ctx.accounts.daily_rules_catalog.validate()?;
    require!(
        ctx.accounts.daily_rules_catalog.rules_version > ctx.accounts.protocol.daily_rules_version,
        ErrorCode::InvalidVersion
    );
    ctx.accounts.protocol.daily_rules_version = ctx.accounts.daily_rules_catalog.rules_version;
    ctx.accounts.arcade_config.rules_catalog = ctx.accounts.daily_rules_catalog.key();
    Ok(())
}

pub fn handler_initialize_arcade(ctx: Context<InitializeArcade>) -> Result<()> {
    ctx.accounts.daily_rules_catalog.validate()?;
    ctx.accounts
        .arcade_config
        .set_inner(ArcadeConfig::canonical(
            ctx.accounts.protocol.key(),
            ctx.accounts.daily_rules_catalog.key(),
            ctx.bumps.arcade_config,
        ));
    ctx.accounts
        .operator_revenue_vault
        .set_inner(OperatorRevenueVault {
            version: ARCADE_ACCOUNT_VERSION,
            protocol: ctx.accounts.protocol.key(),
            gross_operator_share: 0,
            stuck_run_refunds: 0,
            outstanding_refund_liability_lamports: 0,
            withdrawn: 0,
            bump: ctx.bumps.operator_revenue_vault,
        });
    transfer_from_owner(
        &ctx.accounts.authority,
        &ctx.accounts.operator_revenue_vault.to_account_info(),
        &ctx.accounts.system_program,
        OPERATOR_WITHDRAW_RESERVE_LAMPORTS,
    )?;
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct ScheduleArcadeTermsArgs {
    pub entry_lamports: u64,
    pub entry_activates_day: u32,
    pub daily_pot_bps: u16,
    pub operator_bps: u16,
    pub weekly_jackpot_bps: u16,
    pub split_activates_week: u32,
}

#[derive(Accounts)]
pub struct ScheduleArcadeTerms<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        constraint = protocol.pricing_operator == pricing_operator.key() @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [ARCADE_CONFIG_SEED], bump = arcade_config.bump,
        constraint = arcade_config.protocol == protocol.key() @ ErrorCode::InvalidOwner)]
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    pub pricing_operator: Signer<'info>,
}

pub fn handler_schedule_arcade_terms(
    ctx: Context<ScheduleArcadeTerms>,
    args: ScheduleArcadeTermsArgs,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let today = cadence_day(now);
    let this_week = week_id_for_day(today);
    require!(
        args.entry_lamports > 0 && args.entry_activates_day > today,
        ErrorCode::InvalidState
    );
    require!(
        args.split_activates_week > this_week,
        ErrorCode::InvalidState
    );
    validate_split(
        args.daily_pot_bps,
        args.operator_bps,
        args.weekly_jackpot_bps,
    )?;
    let config = &mut ctx.accounts.arcade_config;
    // Promote already-active pending terms before replacing the schedule. This
    // prevents a second governance update from reverting to launch defaults.
    let effective = config.terms_for(today, this_week)?;
    config.entry_lamports = effective.entry_lamports;
    config.daily_pot_bps = effective.daily_pot_bps;
    config.operator_bps = effective.operator_bps;
    config.weekly_jackpot_bps = effective.weekly_jackpot_bps;
    config.pending_entry_lamports = args.entry_lamports;
    config.entry_activates_day = args.entry_activates_day;
    config.pending_daily_pot_bps = args.daily_pot_bps;
    config.pending_operator_bps = args.operator_bps;
    config.pending_weekly_jackpot_bps = args.weekly_jackpot_bps;
    config.split_activates_week = args.split_activates_week;
    Ok(())
}

#[derive(Accounts)]
#[instruction(week_id: u32)]
pub struct OpenWeeklyJackpot<'info> {
    #[account(seeds = [ARCADE_CONFIG_SEED], bump = arcade_config.bump,
        constraint = arcade_config.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion)]
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    #[account(init, payer = payer, space = 8 + WeeklyJackpot::INIT_SPACE,
        seeds = [WEEKLY_JACKPOT_SEED, week_id.to_le_bytes().as_ref()], bump)]
    pub weekly_jackpot: Box<Account<'info, WeeklyJackpot>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_open_weekly_jackpot(ctx: Context<OpenWeeklyJackpot>, week_id: u32) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        week_id_for_day(cadence_day(now)) == week_id,
        ErrorCode::ChallengeNotStarted
    );
    let (opens_at, closes_at) = week_window(week_id)?;
    require!(
        now >= opens_at && now < closes_at,
        ErrorCode::ChallengeEnded
    );
    ctx.accounts.weekly_jackpot.set_inner(WeeklyJackpot {
        version: ARCADE_ACCOUNT_VERSION,
        week_id,
        arcade_config: ctx.accounts.arcade_config.key(),
        status: WeeklyStatus::Open,
        opens_at,
        closes_at,
        finalized_at: 0,
        pot_lamports: 0,
        participants: 0,
        entries: Vec::new(),
        bump: ctx.bumps.weekly_jackpot,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(day_id: u32)]
pub struct OpenArenaDaily<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(seeds = [ARCADE_CONFIG_SEED], bump = arcade_config.bump,
        constraint = arcade_config.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arcade_config.protocol == protocol.key() @ ErrorCode::InvalidOwner)]
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    #[account(address = arcade_config.rules_catalog)]
    pub daily_rules_catalog: Box<Account<'info, DailyRulesCatalog>>,
    #[account(init, payer = payer, space = 8 + ArenaDaily::INIT_SPACE,
        seeds = [ARENA_DAILY_SEED, day_id.to_le_bytes().as_ref()], bump)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_open_arena_daily(ctx: Context<OpenArenaDaily>, day_id: u32) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(cadence_day(now) == day_id, ErrorCode::ChallengeNotStarted);
    let opens_at = i64::from(day_id)
        .checked_mul(ARCADE_SECONDS_PER_DAY)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let entries_close_at = opens_at
        .checked_add(ARENA_ENTRIES_CLOSE_OFFSET)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let runs_close_at = opens_at
        .checked_add(ARENA_RUNS_CLOSE_OFFSET)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(now < entries_close_at, ErrorCode::ChallengeEnded);
    let catalog = &ctx.accounts.daily_rules_catalog;
    catalog.validate()?;
    let scoring_rule = catalog.scoring_rule_for_day(day_id)?;
    let map_id = catalog.map_for_day(day_id);
    let rules = neutral_arena_rules(catalog.pressure);
    let rules_hash = sha256v(&[
        b"zkube-arena-rules-v1",
        &day_id.to_le_bytes(),
        &catalog.catalog_hash,
        &catalog.rules_version.to_le_bytes(),
        &[map_id, scoring_rule.id],
    ]);
    let week_id = week_id_for_day(day_id);
    let terms = ctx.accounts.arcade_config.terms_for(day_id, week_id)?;
    ctx.accounts.arena_daily.set_inner(ArenaDaily {
        version: ARCADE_ACCOUNT_VERSION,
        day_id,
        week_id,
        arcade_config: ctx.accounts.arcade_config.key(),
        rules_version: catalog.rules_version,
        status: ArenaDailyStatus::Open,
        content_version: catalog.content_version,
        catalog_hash: catalog.catalog_hash,
        rules_hash,
        map_id,
        scoring_rule,
        rules,
        pressure: catalog.pressure,
        opens_at,
        entries_close_at,
        runs_close_at,
        recovery_deadline_at: runs_close_at
            .checked_add(STUCK_RUN_RECOVERY_SECONDS)
            .ok_or(ErrorCode::ArithmeticOverflow)?,
        finalized_at: 0,
        terms,
        pot_lamports: 0,
        entries_paid: 0,
        runs_finalized: 0,
        entries_refunded: 0,
        entries_expired: 0,
        incident_declared: false,
        incident_max_refunds: 0,
        unique_players: 0,
        weekly_eligible_players: 0,
        weekly_rollups: 0,
        entries: Vec::new(),
        bump: ctx.bumps.arena_daily,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(run_id: u64, expected_entry_lamports: u64)]
pub struct EnterArenaV1<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(seeds = [ARCADE_CONFIG_SEED], bump = arcade_config.bump,
        constraint = arcade_config.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arcade_config.protocol == protocol.key() @ ErrorCode::InvalidOwner)]
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    #[account(mut, seeds = [PLAYER_STATE_SEED, owner.key().as_ref()], bump = player_state.bump,
        constraint = player_state.owner == owner.key() @ ErrorCode::Unauthorized,
        constraint = player_state.daily_eligible @ ErrorCode::MapLocked)]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump,
        constraint = arena_daily.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.arcade_config == arcade_config.key() @ ErrorCode::InvalidOwner)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(init_if_needed, payer = payer, space = 8 + ArenaPlayer::INIT_SPACE,
        seeds = [ARENA_PLAYER_SEED, arena_daily.key().as_ref(), owner.key().as_ref()], bump)]
    pub arena_player: Box<Account<'info, ArenaPlayer>>,
    #[account(mut, seeds = [WEEKLY_JACKPOT_SEED, arena_daily.week_id.to_le_bytes().as_ref()], bump = weekly_jackpot.bump,
        constraint = weekly_jackpot.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = weekly_jackpot.arcade_config == arcade_config.key() @ ErrorCode::InvalidOwner,
        constraint = weekly_jackpot.status == WeeklyStatus::Open @ ErrorCode::InvalidState)]
    pub weekly_jackpot: Box<Account<'info, WeeklyJackpot>>,
    #[account(mut, seeds = [OPERATOR_REVENUE_VAULT_SEED], bump = operator_revenue_vault.bump,
        constraint = operator_revenue_vault.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = operator_revenue_vault.protocol == protocol.key() @ ErrorCode::InvalidOwner)]
    pub operator_revenue_vault: Box<Account<'info, OperatorRevenueVault>>,
    #[account(init, payer = payer, space = 8 + ActiveRun::INIT_SPACE,
        seeds = [ACTIVE_RUN_SEED, b"active", owner.key().as_ref(), run_id.to_le_bytes().as_ref()], bump)]
    pub active_run: Box<Account<'info, ActiveRun>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_enter_arena_v1(
    ctx: Context<EnterArenaV1>,
    run_id: u64,
    expected_entry_lamports: u64,
) -> Result<()> {
    require_player_rent_payer(
        ctx.accounts.owner.key(),
        ctx.accounts.owner.key(),
        ctx.accounts.payer.key(),
    )?;
    let now = Clock::get()?.unix_timestamp;
    let daily = &mut ctx.accounts.arena_daily;
    require!(
        daily.status == ArenaDailyStatus::Open
            && now >= daily.opens_at
            && now < daily.entries_close_at,
        ErrorCode::ChallengeEnded
    );
    require!(
        expected_entry_lamports == daily.terms.entry_lamports,
        ErrorCode::PriceChanged
    );
    require!(
        ctx.accounts.player_state.active_run_id == 0,
        ErrorCode::ActiveRunExists
    );
    let player = &mut ctx.accounts.arena_player;
    if player.version == 0 {
        player.set_inner(ArenaPlayer {
            version: ARCADE_ACCOUNT_VERSION,
            challenge: daily.key(),
            player: ctx.accounts.owner.key(),
            paid_entries: 0,
            finalized_entries: 0,
            refunded_entries: 0,
            expired_entries: 0,
            active_paid_run_id: 0,
            best_run_id: 0,
            best_score: 0,
            best_bonus_triggers: 0,
            best_engine_score: 0,
            best_moves: 0,
            best_submitted_at: 0,
            best_replay_hash: [0; 32],
            weekly_rolled_up: false,
            bump: ctx.bumps.arena_player,
        });
        daily.unique_players = checked_add_u32(daily.unique_players, 1)?;
    }
    require_keys_eq!(player.challenge, daily.key(), ErrorCode::InvalidOwner);
    require!(
        player.version == ARCADE_ACCOUNT_VERSION,
        ErrorCode::InvalidVersion
    );
    require_keys_eq!(
        player.player,
        ctx.accounts.owner.key(),
        ErrorCode::Unauthorized
    );
    require!(player.active_paid_run_id == 0, ErrorCode::ActiveRunExists);
    let (daily_share, operator_share, weekly_share) = daily.terms.split()?;
    let new_liability = checked_add_u64(
        ctx.accounts
            .operator_revenue_vault
            .outstanding_refund_liability_lamports,
        daily.terms.entry_lamports,
    )?;
    let available_after_entry = checked_add_u64(
        spendable_lamports(&ctx.accounts.operator_revenue_vault.to_account_info())?,
        operator_share,
    )?;
    require!(
        available_after_entry >= new_liability,
        ErrorCode::InsufficientFunds
    );
    transfer_from_owner(
        &ctx.accounts.owner,
        &daily.to_account_info(),
        &ctx.accounts.system_program,
        daily_share,
    )?;
    transfer_from_owner(
        &ctx.accounts.owner,
        &ctx.accounts.operator_revenue_vault.to_account_info(),
        &ctx.accounts.system_program,
        operator_share,
    )?;
    transfer_from_owner(
        &ctx.accounts.owner,
        &ctx.accounts.weekly_jackpot.to_account_info(),
        &ctx.accounts.system_program,
        weekly_share,
    )?;
    daily.pot_lamports = checked_add_u64(daily.pot_lamports, daily_share)?;
    daily.entries_paid = checked_add_u64(daily.entries_paid, 1)?;
    ctx.accounts.weekly_jackpot.pot_lamports =
        checked_add_u64(ctx.accounts.weekly_jackpot.pot_lamports, weekly_share)?;
    ctx.accounts.operator_revenue_vault.gross_operator_share = checked_add_u64(
        ctx.accounts.operator_revenue_vault.gross_operator_share,
        operator_share,
    )?;
    ctx.accounts
        .operator_revenue_vault
        .outstanding_refund_liability_lamports = new_liability;
    player.paid_entries = checked_add_u32(player.paid_entries, 1)?;
    player.active_paid_run_id = run_id;
    let daily_key = daily.key();
    initialize_arena_run(
        &mut ctx.accounts.player_state,
        daily,
        daily_key,
        &mut ctx.accounts.active_run,
        ctx.bumps.active_run,
        ctx.accounts.owner.key(),
        run_id,
        RunMode::Daily,
        now,
    )?;
    Ok(())
}

#[derive(Accounts)]
#[instruction(run_id: u64)]
pub struct PreparePracticeRunV1<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [PLAYER_STATE_SEED, owner_authority.key().as_ref()], bump = player_state.bump,
        constraint = player_state.owner == owner_authority.key() @ ErrorCode::Unauthorized,
        constraint = player_state.daily_eligible @ ErrorCode::MapLocked)]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(init, payer = payer, space = 8 + ActiveRun::INIT_SPACE,
        seeds = [ACTIVE_RUN_SEED, b"active", owner_authority.key().as_ref(), run_id.to_le_bytes().as_ref()], bump)]
    pub active_run: Box<Account<'info, ActiveRun>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Durable wallet identity.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_prepare_practice_run_v1(
    ctx: Context<PreparePracticeRunV1>,
    run_id: u64,
) -> Result<()> {
    require_player_authorization(
        ctx.accounts.owner_authority.key(),
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    require_player_rent_payer(
        ctx.accounts.owner_authority.key(),
        ctx.accounts.actor.key(),
        ctx.accounts.payer.key(),
    )?;
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.arena_daily.day_id.checked_add(1) == Some(cadence_day(now)),
        ErrorCode::InvalidState
    );
    let daily_key = ctx.accounts.arena_daily.key();
    initialize_arena_run(
        &mut ctx.accounts.player_state,
        &ctx.accounts.arena_daily,
        daily_key,
        &mut ctx.accounts.active_run,
        ctx.bumps.active_run,
        ctx.accounts.owner_authority.key(),
        run_id,
        RunMode::Practice,
        now,
    )
}

#[allow(clippy::too_many_arguments)]
fn initialize_arena_run(
    player: &mut PlayerState,
    daily: &ArenaDaily,
    daily_key: Pubkey,
    active: &mut ActiveRun,
    bump: u8,
    owner: Pubkey,
    run_id: u64,
    mode: RunMode,
    now: i64,
) -> Result<()> {
    player.reserve_run(run_id)?;
    player.record_run_started(now)?;
    if mode == RunMode::Daily {
        player.record_daily_join(daily.day_id, now)?;
    }
    *active = ActiveRun::default();
    active.version = ACCOUNT_VERSION;
    active.owner = owner;
    active.daily_challenge = daily_key;
    active.run_id = run_id;
    active.mode = mode;
    active.lifecycle = RunLifecycle::Prepared;
    active.rules_hash = daily.rules_hash;
    active.map_id = daily.map_id;
    active.level = 1;
    active.rules = daily.rules;
    active.daily_scoring_rule = daily.scoring_rule;
    active.daily_pressure = daily.pressure;
    active.perfect_trigger_available = true;
    active.starting_height_target = daily.pressure.starting_height;
    active.replay_hash = sha256v(&[
        b"zkube-replay-init-v1",
        daily_key.as_ref(),
        &daily.day_id.to_le_bytes(),
        &daily.rules_version.to_le_bytes(),
        owner.as_ref(),
        &run_id.to_le_bytes(),
        &[mode as u8],
    ]);
    active.bump = bump;
    Ok(())
}

#[derive(Accounts)]
pub struct ConsumeArenaRun<'info> {
    #[account(mut, seeds = [PLAYER_STATE_SEED, active_run.owner.as_ref()], bump = player_state.bump,
        constraint = player_state.owner == active_run.owner @ ErrorCode::Unauthorized)]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump,
        constraint = arena_daily.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.key() == active_run.daily_challenge @ ErrorCode::InvalidOwner)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [ARENA_PLAYER_SEED, arena_daily.key().as_ref(), active_run.owner.as_ref()], bump = arena_player.bump,
        constraint = arena_player.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_player.challenge == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = arena_player.player == active_run.owner @ ErrorCode::Unauthorized)]
    pub arena_player: Box<Account<'info, ArenaPlayer>>,
    #[account(mut, seeds = [OPERATOR_REVENUE_VAULT_SEED], bump = operator_revenue_vault.bump,
        constraint = operator_revenue_vault.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion)]
    pub operator_revenue_vault: Box<Account<'info, OperatorRevenueVault>>,
    #[account(mut, close = rent_recipient, seeds = [ACTIVE_RUN_SEED, b"active", active_run.owner.as_ref(), active_run.run_id.to_le_bytes().as_ref()], bump = active_run.bump)]
    pub active_run: Box<Account<'info, ActiveRun>>,
    /// CHECK: Canonical zero-data player funding PDA.
    #[account(mut, seeds = [PLAYER_FUNDING_SEED, active_run.owner.as_ref()], bump,
        owner = system_program::ID @ ErrorCode::InvalidOwner,
        constraint = rent_recipient.data_is_empty() @ ErrorCode::InvalidOwner)]
    pub rent_recipient: UncheckedAccount<'info>,
}

pub fn handler_consume_arena_run(ctx: Context<ConsumeArenaRun>) -> Result<()> {
    let active = &ctx.accounts.active_run;
    require!(
        active.mode == RunMode::Daily
            && active.lifecycle == RunLifecycle::Finished
            && active.finished_at > 0,
        ErrorCode::GameNotFinished
    );
    require!(
        ctx.accounts.player_state.active_run_id == active.run_id,
        ErrorCode::InvalidRunId
    );
    require!(
        ctx.accounts.arena_player.active_paid_run_id == active.run_id,
        ErrorCode::InvalidRunId
    );
    ctx.accounts
        .player_state
        .record_run_metrics(run_metrics(active), Clock::get()?.unix_timestamp)?;
    let player = &mut ctx.accounts.arena_player;
    player.finalized_entries = checked_add_u32(player.finalized_entries, 1)?;
    player.active_paid_run_id = 0;
    ctx.accounts.arena_daily.runs_finalized =
        checked_add_u64(ctx.accounts.arena_daily.runs_finalized, 1)?;
    ctx.accounts
        .operator_revenue_vault
        .outstanding_refund_liability_lamports = ctx
        .accounts
        .operator_revenue_vault
        .outstanding_refund_liability_lamports
        .checked_sub(ctx.accounts.arena_daily.terms.entry_lamports)
        .ok_or(ErrorCode::AccountingInvariant)?;
    let candidate = ArenaBoardEntry {
        player: active.owner,
        run_id: active.run_id,
        score: active.daily_score,
        bonus_triggers: active.daily_bonus_triggers,
        engine_score: active.score,
        moves: active.moves,
        attempts: player.paid_entries,
        submitted_at: active.finished_at,
        replay_hash: active.replay_hash,
    };
    let eligible = active.finished_at <= ctx.accounts.arena_daily.runs_close_at;
    if eligible && (player.best_run_id == 0 || arena_entry_better(&candidate, player)) {
        if player.best_run_id == 0 {
            ctx.accounts.arena_daily.weekly_eligible_players =
                checked_add_u32(ctx.accounts.arena_daily.weekly_eligible_players, 1)?;
        }
        player.best_run_id = candidate.run_id;
        player.best_score = candidate.score;
        player.best_bonus_triggers = candidate.bonus_triggers;
        player.best_engine_score = candidate.engine_score;
        player.best_moves = candidate.moves;
        player.best_submitted_at = candidate.submitted_at;
        player.best_replay_hash = candidate.replay_hash;
    }
    if eligible {
        ctx.accounts.arena_daily.record_best(ArenaBoardEntry {
            player: active.owner,
            run_id: player.best_run_id,
            score: player.best_score,
            bonus_triggers: player.best_bonus_triggers,
            engine_score: player.best_engine_score,
            moves: player.best_moves,
            attempts: player.paid_entries,
            submitted_at: player.best_submitted_at,
            replay_hash: player.best_replay_hash,
        });
    }
    ctx.accounts.player_state.release_run(active.run_id)
}

#[derive(Accounts)]
pub struct ConsumePracticeRun<'info> {
    #[account(mut, seeds = [PLAYER_STATE_SEED, active_run.owner.as_ref()], bump = player_state.bump)]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(address = active_run.daily_challenge @ ErrorCode::InvalidOwner)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(
        seeds = [ARENA_PLAYER_SEED, arena_daily.key().as_ref(), active_run.owner.as_ref()],
        bump = arena_player.bump,
        constraint = arena_player.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_player.challenge == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = arena_player.player == active_run.owner @ ErrorCode::Unauthorized
    )]
    pub arena_player: Option<Box<Account<'info, ArenaPlayer>>>,
    #[account(mut, close = rent_recipient, seeds = [ACTIVE_RUN_SEED, b"active", active_run.owner.as_ref(), active_run.run_id.to_le_bytes().as_ref()], bump = active_run.bump)]
    pub active_run: Box<Account<'info, ActiveRun>>,
    /// CHECK: Canonical zero-data player funding PDA.
    #[account(mut, seeds = [PLAYER_FUNDING_SEED, active_run.owner.as_ref()], bump,
        owner = system_program::ID @ ErrorCode::InvalidOwner,
        constraint = rent_recipient.data_is_empty() @ ErrorCode::InvalidOwner)]
    pub rent_recipient: UncheckedAccount<'info>,
}

pub fn handler_consume_practice_run(ctx: Context<ConsumePracticeRun>) -> Result<()> {
    let active = &ctx.accounts.active_run;
    require!(
        active.mode == RunMode::Practice && active.lifecycle == RunLifecycle::Finished,
        ErrorCode::GameNotFinished
    );
    require!(
        ctx.accounts.player_state.active_run_id == active.run_id,
        ErrorCode::InvalidRunId
    );
    let mut metrics = run_metrics(active);
    metrics.beat_yesterday_score =
        ctx.accounts.arena_daily.status == ArenaDailyStatus::Finalized
            && ctx.accounts.arena_player.as_ref().is_some_and(|player| {
                player.best_run_id > 0 && active.daily_score > player.best_score
            });
    let practice_entry = ArenaBoardEntry {
        player: active.owner,
        run_id: active.run_id,
        score: active.daily_score,
        bonus_triggers: active.daily_bonus_triggers,
        engine_score: active.score,
        moves: active.moves,
        attempts: 0,
        submitted_at: active.finished_at,
        replay_hash: active.replay_hash,
    };
    metrics.practice_top_25 = ctx.accounts.arena_daily.status == ArenaDailyStatus::Finalized
        && !ctx.accounts.arena_daily.entries.is_empty()
        && ctx.accounts.arena_daily.hypothetical_rank(&practice_entry) <= 25;
    ctx.accounts
        .player_state
        .record_run_metrics(metrics, Clock::get()?.unix_timestamp)?;
    ctx.accounts.player_state.release_run(active.run_id)
}

#[derive(Accounts)]
pub struct RefundStuckArenaEntry<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump, has_one = authority @ ErrorCode::Unauthorized)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [OPERATOR_REVENUE_VAULT_SEED], bump = operator_revenue_vault.bump,
        constraint = operator_revenue_vault.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = operator_revenue_vault.protocol == protocol.key() @ ErrorCode::InvalidOwner)]
    pub operator_revenue_vault: Box<Account<'info, OperatorRevenueVault>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump,
        constraint = arena_daily.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [ARENA_PLAYER_SEED, arena_daily.key().as_ref(), owner.key().as_ref()], bump = arena_player.bump,
        constraint = arena_player.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_player.challenge == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = arena_player.player == owner.key() @ ErrorCode::Unauthorized)]
    pub arena_player: Box<Account<'info, ArenaPlayer>>,
    #[account(mut, seeds = [PLAYER_STATE_SEED, owner.key().as_ref()], bump = player_state.bump)]
    pub player_state: Box<Account<'info, PlayerState>>,
    /// CHECK: Exact entry owner pinned by the player PDAs. Any account may receive
    /// lamports directly, so a later owner reassignment cannot strand a refund.
    #[account(mut)]
    pub owner: UncheckedAccount<'info>,
    /// CHECK: PDA identity only; it may still be delegated and is deliberately not closed here.
    pub active_run: UncheckedAccount<'info>,
    #[account(init, payer = authority, space = 8 + RunResolutionReceipt::INIT_SPACE,
        seeds = [RUN_RESOLUTION_SEED, arena_daily.key().as_ref(), owner.key().as_ref(), arena_player.active_paid_run_id.to_le_bytes().as_ref()], bump)]
    pub resolution_receipt: Box<Account<'info, RunResolutionReceipt>>,
    pub system_program: Program<'info, System>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

pub fn handler_refund_stuck_arena_entry(ctx: Context<RefundStuckArenaEntry>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.arena_daily.incident_declared
            && now >= ctx.accounts.arena_daily.recovery_deadline_at
            && ctx.accounts.arena_daily.entries_refunded
                < ctx.accounts.arena_daily.incident_max_refunds,
        ErrorCode::ChallengeNotEnded
    );
    let run_id = ctx.accounts.arena_player.active_paid_run_id;
    require!(
        run_id > 0 && ctx.accounts.player_state.active_run_id == run_id,
        ErrorCode::InvalidRunId
    );
    let expected = Pubkey::find_program_address(
        &[
            ACTIVE_RUN_SEED,
            b"active",
            ctx.accounts.owner.key().as_ref(),
            &run_id.to_le_bytes(),
        ],
        &crate::ID,
    )
    .0;
    require_keys_eq!(
        ctx.accounts.active_run.key(),
        expected,
        ErrorCode::InvalidRunId
    );
    let amount = ctx.accounts.arena_daily.terms.entry_lamports;
    require!(
        spendable_lamports(&ctx.accounts.operator_revenue_vault.to_account_info())? >= amount,
        ErrorCode::InsufficientFunds
    );
    move_program_lamports(
        &ctx.accounts.operator_revenue_vault.to_account_info(),
        &ctx.accounts.owner.to_account_info(),
        amount,
    )?;
    ctx.accounts.operator_revenue_vault.stuck_run_refunds = checked_add_u64(
        ctx.accounts.operator_revenue_vault.stuck_run_refunds,
        amount,
    )?;
    ctx.accounts
        .operator_revenue_vault
        .outstanding_refund_liability_lamports = ctx
        .accounts
        .operator_revenue_vault
        .outstanding_refund_liability_lamports
        .checked_sub(amount)
        .ok_or(ErrorCode::AccountingInvariant)?;
    ctx.accounts.arena_player.refunded_entries =
        checked_add_u32(ctx.accounts.arena_player.refunded_entries, 1)?;
    ctx.accounts.arena_player.active_paid_run_id = 0;
    ctx.accounts.arena_daily.entries_refunded =
        checked_add_u64(ctx.accounts.arena_daily.entries_refunded, 1)?;
    ctx.accounts.player_state.active_run_id = 0;
    ctx.accounts
        .resolution_receipt
        .set_inner(RunResolutionReceipt {
            version: ARCADE_ACCOUNT_VERSION,
            daily: ctx.accounts.arena_daily.key(),
            player: ctx.accounts.owner.key(),
            run_id,
            refunded: true,
            rent_recipient: ctx.accounts.authority.key(),
            bump: ctx.bumps.resolution_receipt,
        });
    Ok(())
}

#[derive(Accounts)]
pub struct DeclareArenaIncident<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump, has_one = authority @ ErrorCode::Unauthorized)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump,
        constraint = arena_daily.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    pub authority: Signer<'info>,
}

pub fn handler_declare_arena_incident(ctx: Context<DeclareArenaIncident>) -> Result<()> {
    let daily = &mut ctx.accounts.arena_daily;
    let now = Clock::get()?.unix_timestamp;
    require!(
        daily.status == ArenaDailyStatus::Open
            && now >= daily.recovery_deadline_at
            && now < daily.recovery_deadline_at + INCIDENT_DECLARATION_GRACE_SECONDS
            && !daily.incident_declared,
        ErrorCode::InvalidState
    );
    let resolved = daily
        .runs_finalized
        .checked_add(daily.entries_refunded)
        .and_then(|value| value.checked_add(daily.entries_expired))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let unresolved = daily
        .entries_paid
        .checked_sub(resolved)
        .ok_or(ErrorCode::AccountingInvariant)?;
    require!(unresolved > 0, ErrorCode::InvalidState);
    daily.incident_declared = true;
    daily.incident_max_refunds = unresolved;
    Ok(())
}

#[derive(Accounts)]
pub struct ExpireStuckArenaEntry<'info> {
    #[account(mut, seeds = [OPERATOR_REVENUE_VAULT_SEED], bump = operator_revenue_vault.bump,
        constraint = operator_revenue_vault.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion)]
    pub operator_revenue_vault: Box<Account<'info, OperatorRevenueVault>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump,
        constraint = arena_daily.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [ARENA_PLAYER_SEED, arena_daily.key().as_ref(), owner.key().as_ref()], bump = arena_player.bump,
        constraint = arena_player.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_player.challenge == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = arena_player.player == owner.key() @ ErrorCode::Unauthorized)]
    pub arena_player: Box<Account<'info, ArenaPlayer>>,
    #[account(mut, seeds = [PLAYER_STATE_SEED, owner.key().as_ref()], bump = player_state.bump)]
    pub player_state: Box<Account<'info, PlayerState>>,
    /// CHECK: Player identity pinned by both state accounts.
    pub owner: UncheckedAccount<'info>,
    #[account(init, payer = caller, space = 8 + RunResolutionReceipt::INIT_SPACE,
        seeds = [RUN_RESOLUTION_SEED, arena_daily.key().as_ref(), owner.key().as_ref(), arena_player.active_paid_run_id.to_le_bytes().as_ref()], bump)]
    pub resolution_receipt: Box<Account<'info, RunResolutionReceipt>>,
    pub system_program: Program<'info, System>,
    #[account(mut)]
    pub caller: Signer<'info>,
}

pub fn handler_expire_stuck_arena_entry(ctx: Context<ExpireStuckArenaEntry>) -> Result<()> {
    let daily = &mut ctx.accounts.arena_daily;
    let now = Clock::get()?.unix_timestamp;
    require!(
        !daily.incident_declared
            && now >= daily.recovery_deadline_at + INCIDENT_DECLARATION_GRACE_SECONDS,
        ErrorCode::ChallengeNotEnded
    );
    let run_id = ctx.accounts.arena_player.active_paid_run_id;
    require!(
        run_id > 0 && ctx.accounts.player_state.active_run_id == run_id,
        ErrorCode::InvalidRunId
    );
    let amount = daily.terms.entry_lamports;
    ctx.accounts
        .operator_revenue_vault
        .outstanding_refund_liability_lamports = ctx
        .accounts
        .operator_revenue_vault
        .outstanding_refund_liability_lamports
        .checked_sub(amount)
        .ok_or(ErrorCode::AccountingInvariant)?;
    ctx.accounts.arena_player.expired_entries =
        checked_add_u32(ctx.accounts.arena_player.expired_entries, 1)?;
    ctx.accounts.arena_player.active_paid_run_id = 0;
    daily.entries_expired = checked_add_u64(daily.entries_expired, 1)?;
    ctx.accounts.player_state.active_run_id = 0;
    ctx.accounts
        .resolution_receipt
        .set_inner(RunResolutionReceipt {
            version: ARCADE_ACCOUNT_VERSION,
            daily: daily.key(),
            player: ctx.accounts.owner.key(),
            run_id,
            refunded: false,
            rent_recipient: ctx.accounts.caller.key(),
            bump: ctx.bumps.resolution_receipt,
        });
    Ok(())
}

#[derive(Accounts)]
pub struct CleanupResolvedRun<'info> {
    #[account(mut, close = rent_recipient,
        seeds = [ACTIVE_RUN_SEED, b"active", resolution_receipt.player.as_ref(), resolution_receipt.run_id.to_le_bytes().as_ref()], bump = active_run.bump,
        constraint = active_run.owner == resolution_receipt.player @ ErrorCode::InvalidOwner,
        constraint = active_run.run_id == resolution_receipt.run_id @ ErrorCode::InvalidRunId)]
    pub active_run: Box<Account<'info, ActiveRun>>,
    #[account(mut, close = receipt_rent_recipient,
        seeds = [RUN_RESOLUTION_SEED, resolution_receipt.daily.as_ref(), resolution_receipt.player.as_ref(), resolution_receipt.run_id.to_le_bytes().as_ref()], bump = resolution_receipt.bump)]
    pub resolution_receipt: Box<Account<'info, RunResolutionReceipt>>,
    /// CHECK: Canonical funding PDA receives ActiveRun rent.
    #[account(mut, seeds = [PLAYER_FUNDING_SEED, resolution_receipt.player.as_ref()], bump,
        owner = system_program::ID @ ErrorCode::InvalidOwner,
        constraint = rent_recipient.data_is_empty() @ ErrorCode::InvalidOwner)]
    pub rent_recipient: UncheckedAccount<'info>,
    /// CHECK: Exact receipt payer stored at resolution.
    #[account(mut, address = resolution_receipt.rent_recipient)]
    pub receipt_rent_recipient: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
}

pub fn handler_cleanup_resolved_run(_ctx: Context<CleanupResolvedRun>) -> Result<()> {
    Ok(())
}

#[derive(Accounts)]
pub struct RollupArenaToWeekly<'info> {
    #[account(seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump,
        constraint = arena_daily.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.status == ArenaDailyStatus::Finalized @ ErrorCode::InvalidState)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [ARENA_PLAYER_SEED, arena_daily.key().as_ref(), owner.key().as_ref()], bump = arena_player.bump,
        constraint = arena_player.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_player.challenge == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = arena_player.player == owner.key() @ ErrorCode::Unauthorized)]
    pub arena_player: Box<Account<'info, ArenaPlayer>>,
    #[account(mut, seeds = [WEEKLY_JACKPOT_SEED, arena_daily.week_id.to_le_bytes().as_ref()], bump = weekly_jackpot.bump,
        constraint = weekly_jackpot.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = weekly_jackpot.arcade_config == arena_daily.arcade_config @ ErrorCode::InvalidOwner,
        constraint = weekly_jackpot.status == WeeklyStatus::Open @ ErrorCode::InvalidState)]
    pub weekly_jackpot: Box<Account<'info, WeeklyJackpot>>,
    #[account(init_if_needed, payer = payer, space = 8 + WeeklyPlayer::INIT_SPACE,
        seeds = [WEEKLY_PLAYER_SEED, weekly_jackpot.key().as_ref(), owner.key().as_ref()], bump)]
    pub weekly_player: Box<Account<'info, WeeklyPlayer>>,
    /// CHECK: Player identity pinned by ArenaPlayer.
    pub owner: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_rollup_arena_to_weekly(ctx: Context<RollupArenaToWeekly>) -> Result<()> {
    let expected_funding = Pubkey::find_program_address(
        &[PLAYER_FUNDING_SEED, ctx.accounts.owner.key().as_ref()],
        &crate::ID,
    )
    .0;
    require_keys_eq!(
        ctx.accounts.payer.key(),
        expected_funding,
        ErrorCode::InvalidOwner
    );
    require_keys_eq!(
        *ctx.accounts.payer.owner,
        system_program::ID,
        ErrorCode::InvalidOwner
    );
    require!(ctx.accounts.payer.data_is_empty(), ErrorCode::InvalidOwner);
    require!(
        !ctx.accounts.arena_player.weekly_rolled_up && ctx.accounts.arena_player.best_run_id > 0,
        ErrorCode::AlreadySubmitted
    );
    let player = &mut ctx.accounts.weekly_player;
    if player.version == 0 {
        player.set_inner(WeeklyPlayer {
            version: ARCADE_ACCOUNT_VERSION,
            jackpot: ctx.accounts.weekly_jackpot.key(),
            player: ctx.accounts.owner.key(),
            results: [WeeklyResult::default(); WEEKLY_RESULT_CAPACITY],
            result_count: 0,
            score: 0,
            total_bonus_triggers: 0,
            final_submission_at: 0,
            bump: ctx.bumps.weekly_player,
        });
        ctx.accounts.weekly_jackpot.participants =
            checked_add_u32(ctx.accounts.weekly_jackpot.participants, 1)?;
    }
    require!(
        player.version == ARCADE_ACCOUNT_VERSION,
        ErrorCode::InvalidVersion
    );
    require_keys_eq!(
        player.jackpot,
        ctx.accounts.weekly_jackpot.key(),
        ErrorCode::InvalidOwner
    );
    require_keys_eq!(
        player.player,
        ctx.accounts.owner.key(),
        ErrorCode::Unauthorized
    );
    let rank = ctx
        .accounts
        .arena_daily
        .entries
        .iter()
        .position(|entry| entry.player == ctx.accounts.owner.key());
    player.record_daily(
        ctx.accounts.arena_daily.day_id,
        rank,
        ctx.accounts.arena_daily.weekly_eligible_players,
        ctx.accounts.arena_player.best_bonus_triggers,
        ctx.accounts.arena_player.best_submitted_at,
    )?;
    ctx.accounts.weekly_jackpot.record(WeeklyBoardEntry {
        player: player.player,
        score: player.score,
        total_bonus_triggers: player.total_bonus_triggers,
        final_submission_at: player.final_submission_at,
    });
    ctx.accounts.arena_player.weekly_rolled_up = true;
    ctx.accounts.arena_daily.weekly_rollups =
        checked_add_u32(ctx.accounts.arena_daily.weekly_rollups, 1)?;
    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeArenaDaily<'info> {
    #[account(mut, seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump,
        constraint = arena_daily.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [WEEKLY_JACKPOT_SEED, arena_daily.week_id.to_le_bytes().as_ref()], bump = weekly_jackpot.bump,
        constraint = weekly_jackpot.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = weekly_jackpot.arcade_config == arena_daily.arcade_config @ ErrorCode::InvalidOwner,
        constraint = weekly_jackpot.status == WeeklyStatus::Open @ ErrorCode::InvalidState)]
    pub weekly_jackpot: Box<Account<'info, WeeklyJackpot>>,
    pub caller: Signer<'info>,
}

pub fn handler_finalize_arena_daily(ctx: Context<FinalizeArenaDaily>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let daily = &mut ctx.accounts.arena_daily;
    require!(
        daily.status == ArenaDailyStatus::Open && now >= daily.runs_close_at,
        ErrorCode::ChallengeNotEnded
    );
    require!(
        daily
            .runs_finalized
            .checked_add(daily.entries_refunded)
            .and_then(|resolved| resolved.checked_add(daily.entries_expired))
            == Some(daily.entries_paid),
        ErrorCode::InvalidState
    );
    let winners = daily.entries.len().min(DAILY_PRIZE_WEIGHTS.len());
    if winners == 0 {
        move_program_lamports(
            &daily.to_account_info(),
            &ctx.accounts.weekly_jackpot.to_account_info(),
            daily.pot_lamports,
        )?;
        ctx.accounts.weekly_jackpot.pot_lamports =
            checked_add_u64(ctx.accounts.weekly_jackpot.pot_lamports, daily.pot_lamports)?;
    } else {
        require!(
            ctx.remaining_accounts.len() == winners,
            ErrorCode::InvalidState
        );
        for (rank, (entry, amount)) in daily
            .entries
            .iter()
            .take(winners)
            .zip(payout_amounts(
                daily.pot_lamports,
                &DAILY_PRIZE_WEIGHTS,
                winners,
            )?)
            .enumerate()
        {
            let destination = &ctx.remaining_accounts[rank];
            validate_wallet(destination, entry.player)?;
            move_program_lamports(&daily.to_account_info(), destination, amount)?;
        }
    }
    daily.pot_lamports = 0;
    daily.status = ArenaDailyStatus::Finalized;
    daily.finalized_at = now;
    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeWeeklyJackpot<'info> {
    #[account(mut, seeds = [WEEKLY_JACKPOT_SEED, weekly_jackpot.week_id.to_le_bytes().as_ref()], bump = weekly_jackpot.bump,
        constraint = weekly_jackpot.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = weekly_jackpot.status == WeeklyStatus::Open @ ErrorCode::InvalidState)]
    pub weekly_jackpot: Box<Account<'info, WeeklyJackpot>>,
    #[account(mut, seeds = [WEEKLY_JACKPOT_SEED, next_weekly_jackpot.week_id.to_le_bytes().as_ref()], bump = next_weekly_jackpot.bump,
        constraint = next_weekly_jackpot.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = next_weekly_jackpot.arcade_config == weekly_jackpot.arcade_config @ ErrorCode::InvalidOwner,
        constraint = next_weekly_jackpot.status == WeeklyStatus::Open @ ErrorCode::InvalidState)]
    pub next_weekly_jackpot: Box<Account<'info, WeeklyJackpot>>,
    pub caller: Signer<'info>,
}

pub fn handler_finalize_weekly_jackpot(ctx: Context<FinalizeWeeklyJackpot>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let jackpot = &mut ctx.accounts.weekly_jackpot;
    require!(
        jackpot.week_id.checked_add(1) == Some(ctx.accounts.next_weekly_jackpot.week_id),
        ErrorCode::InvalidState
    );
    require!(
        jackpot.status == WeeklyStatus::Open && now >= jackpot.closes_at,
        ErrorCode::ChallengeNotEnded
    );
    validate_weekly_dailies(
        jackpot.week_id,
        &ctx.remaining_accounts[..ctx.remaining_accounts.len().min(7)],
    )?;
    let winners = jackpot.entries.len().min(WEEKLY_PRIZE_WEIGHTS.len());
    require!(
        ctx.remaining_accounts.len() == 7 + winners,
        ErrorCode::InvalidState
    );
    if winners == 0 {
        move_program_lamports(
            &jackpot.to_account_info(),
            &ctx.accounts.next_weekly_jackpot.to_account_info(),
            jackpot.pot_lamports,
        )?;
        ctx.accounts.next_weekly_jackpot.pot_lamports = checked_add_u64(
            ctx.accounts.next_weekly_jackpot.pot_lamports,
            jackpot.pot_lamports,
        )?;
    }
    for (rank, (entry, amount)) in jackpot
        .entries
        .iter()
        .take(winners)
        .zip(payout_amounts(
            jackpot.pot_lamports,
            &WEEKLY_PRIZE_WEIGHTS,
            winners,
        )?)
        .enumerate()
    {
        let destination = &ctx.remaining_accounts[7 + rank];
        validate_wallet(destination, entry.player)?;
        move_program_lamports(&jackpot.to_account_info(), destination, amount)?;
    }
    jackpot.pot_lamports = 0;
    jackpot.status = WeeklyStatus::Finalized;
    jackpot.finalized_at = now;
    Ok(())
}

fn validate_weekly_dailies(week_id: u32, accounts: &[AccountInfo<'_>]) -> Result<()> {
    require!(accounts.len() == 7, ErrorCode::InvalidState);
    let start_day = week_id
        .checked_mul(7)
        .and_then(|day| day.checked_sub(3))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    for (offset, account) in accounts.iter().enumerate() {
        let day_id = start_day
            .checked_add(u32::try_from(offset).map_err(|_| ErrorCode::ArithmeticOverflow)?)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        let expected =
            Pubkey::find_program_address(&[ARENA_DAILY_SEED, &day_id.to_le_bytes()], &crate::ID).0;
        require_keys_eq!(account.key(), expected, ErrorCode::InvalidRunId);
        require_keys_eq!(*account.owner, crate::ID, ErrorCode::InvalidOwner);
        let data = account.try_borrow_data()?;
        let mut bytes: &[u8] = &data;
        let daily = ArenaDaily::try_deserialize(&mut bytes)?;
        require!(
            daily.version == ARCADE_ACCOUNT_VERSION
                && daily.day_id == day_id
                && daily.week_id == week_id,
            ErrorCode::InvalidVersion
        );
        require!(
            daily.status == ArenaDailyStatus::Finalized,
            ErrorCode::InvalidState
        );
        require!(
            daily.weekly_rollups == daily.weekly_eligible_players,
            ErrorCode::InvalidState
        );
    }
    Ok(())
}

fn update_best_finish(
    account: &AccountInfo<'_>,
    player: Pubkey,
    one_based_rank: usize,
    weekly: bool,
) -> Result<()> {
    require!(account.is_writable, ErrorCode::InvalidState);
    require_keys_eq!(*account.owner, crate::ID, ErrorCode::InvalidOwner);
    let expected =
        Pubkey::find_program_address(&[PLAYER_STATE_SEED, player.as_ref()], &crate::ID).0;
    require_keys_eq!(account.key(), expected, ErrorCode::InvalidOwner);
    let mut data = account.try_borrow_mut_data()?;
    let mut source: &[u8] = &data;
    let mut state = PlayerState::try_deserialize(&mut source)?;
    require!(
        state.version == ACCOUNT_VERSION && state.owner == player,
        ErrorCode::InvalidVersion
    );
    let rank = u16::try_from(one_based_rank).map_err(|_| ErrorCode::ArithmeticOverflow)?;
    let best = if weekly {
        &mut state.best_weekly_finish
    } else {
        &mut state.best_daily_finish
    };
    if *best == 0 || rank < *best {
        *best = rank;
    }
    state.try_serialize(&mut &mut data[..])?;
    Ok(())
}

#[derive(Accounts)]
pub struct SyncDailyFinish<'info> {
    #[account(seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump,
        constraint = arena_daily.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.status == ArenaDailyStatus::Finalized @ ErrorCode::InvalidState)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [PLAYER_STATE_SEED, player_state.owner.as_ref()], bump = player_state.bump)]
    pub player_state: Box<Account<'info, PlayerState>>,
    pub caller: Signer<'info>,
}

pub fn handler_sync_daily_finish(ctx: Context<SyncDailyFinish>) -> Result<()> {
    let owner = ctx.accounts.player_state.owner;
    let rank = ctx
        .accounts
        .arena_daily
        .entries
        .iter()
        .position(|entry| entry.player == owner)
        .ok_or(ErrorCode::NoPrize)?;
    update_best_finish(
        &ctx.accounts.player_state.to_account_info(),
        owner,
        rank + 1,
        false,
    )
}

#[derive(Accounts)]
pub struct SyncWeeklyFinish<'info> {
    #[account(seeds = [WEEKLY_JACKPOT_SEED, weekly_jackpot.week_id.to_le_bytes().as_ref()], bump = weekly_jackpot.bump,
        constraint = weekly_jackpot.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = weekly_jackpot.status == WeeklyStatus::Finalized @ ErrorCode::InvalidState)]
    pub weekly_jackpot: Box<Account<'info, WeeklyJackpot>>,
    #[account(mut, seeds = [PLAYER_STATE_SEED, player_state.owner.as_ref()], bump = player_state.bump)]
    pub player_state: Box<Account<'info, PlayerState>>,
    pub caller: Signer<'info>,
}

pub fn handler_sync_weekly_finish(ctx: Context<SyncWeeklyFinish>) -> Result<()> {
    let owner = ctx.accounts.player_state.owner;
    let rank = ctx
        .accounts
        .weekly_jackpot
        .entries
        .iter()
        .position(|entry| entry.player == owner)
        .ok_or(ErrorCode::NoPrize)?;
    update_best_finish(
        &ctx.accounts.player_state.to_account_info(),
        owner,
        rank + 1,
        true,
    )
}

#[derive(Accounts)]
pub struct CloseArenaPlayer<'info> {
    #[account(seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump,
        constraint = arena_daily.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.status == ArenaDailyStatus::Finalized @ ErrorCode::InvalidState)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, close = rent_recipient,
        seeds = [ARENA_PLAYER_SEED, arena_daily.key().as_ref(), arena_player.player.as_ref()], bump = arena_player.bump,
        constraint = arena_player.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_player.challenge == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = arena_player.active_paid_run_id == 0 @ ErrorCode::ActiveRunExists,
        constraint = arena_player.best_run_id == 0 || arena_player.weekly_rolled_up @ ErrorCode::InvalidState)]
    pub arena_player: Box<Account<'info, ArenaPlayer>>,
    /// CHECK: Canonical player funding PDA receives recycled rent.
    #[account(mut, seeds = [PLAYER_FUNDING_SEED, arena_player.player.as_ref()], bump,
        owner = system_program::ID @ ErrorCode::InvalidOwner,
        constraint = rent_recipient.data_is_empty() @ ErrorCode::InvalidOwner)]
    pub rent_recipient: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
}

pub fn handler_close_arena_player(_ctx: Context<CloseArenaPlayer>) -> Result<()> {
    Ok(())
}

#[derive(Accounts)]
pub struct CloseWeeklyPlayer<'info> {
    #[account(seeds = [WEEKLY_JACKPOT_SEED, weekly_jackpot.week_id.to_le_bytes().as_ref()], bump = weekly_jackpot.bump,
        constraint = weekly_jackpot.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = weekly_jackpot.status == WeeklyStatus::Finalized @ ErrorCode::InvalidState)]
    pub weekly_jackpot: Box<Account<'info, WeeklyJackpot>>,
    #[account(mut, close = rent_recipient,
        seeds = [WEEKLY_PLAYER_SEED, weekly_jackpot.key().as_ref(), weekly_player.player.as_ref()], bump = weekly_player.bump,
        constraint = weekly_player.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = weekly_player.jackpot == weekly_jackpot.key() @ ErrorCode::InvalidOwner)]
    pub weekly_player: Box<Account<'info, WeeklyPlayer>>,
    /// CHECK: Canonical player funding PDA receives recycled rent.
    #[account(mut, seeds = [PLAYER_FUNDING_SEED, weekly_player.player.as_ref()], bump,
        owner = system_program::ID @ ErrorCode::InvalidOwner,
        constraint = rent_recipient.data_is_empty() @ ErrorCode::InvalidOwner)]
    pub rent_recipient: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
}

pub fn handler_close_weekly_player(_ctx: Context<CloseWeeklyPlayer>) -> Result<()> {
    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawOperatorRevenue<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump, has_one = authority @ ErrorCode::Unauthorized)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(seeds = [ARCADE_CONFIG_SEED], bump = arcade_config.bump,
        constraint = arcade_config.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arcade_config.protocol == protocol.key() @ ErrorCode::InvalidOwner)]
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    #[account(mut, seeds = [OPERATOR_REVENUE_VAULT_SEED], bump = operator_revenue_vault.bump,
        constraint = operator_revenue_vault.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = operator_revenue_vault.protocol == protocol.key() @ ErrorCode::InvalidOwner)]
    pub operator_revenue_vault: Box<Account<'info, OperatorRevenueVault>>,
    /// CHECK: Protocol-pinned System wallet.
    #[account(mut, address = protocol.team_destination, owner = system_program::ID @ ErrorCode::InvalidOwner)]
    pub team_destination: UncheckedAccount<'info>,
    pub authority: Signer<'info>,
}

pub fn handler_withdraw_operator_revenue(
    ctx: Context<WithdrawOperatorRevenue>,
    lamports: u64,
) -> Result<()> {
    let spendable = spendable_lamports(&ctx.accounts.operator_revenue_vault.to_account_info())?;
    let protected = checked_add_u64(
        ctx.accounts
            .arcade_config
            .operator_withdraw_reserve_lamports,
        ctx.accounts
            .operator_revenue_vault
            .outstanding_refund_liability_lamports,
    )?;
    require!(
        lamports > 0 && spendable.saturating_sub(lamports) >= protected,
        ErrorCode::InsufficientFunds
    );
    move_program_lamports(
        &ctx.accounts.operator_revenue_vault.to_account_info(),
        &ctx.accounts.team_destination.to_account_info(),
        lamports,
    )?;
    ctx.accounts.operator_revenue_vault.withdrawn =
        checked_add_u64(ctx.accounts.operator_revenue_vault.withdrawn, lamports)?;
    Ok(())
}

fn neutral_arena_rules(pressure: DailyPressureProfile) -> LevelRuleSnapshot {
    LevelRuleSnapshot {
        level: 1,
        points_required: u32::MAX,
        max_moves: pressure.max_moves,
        difficulty: 0,
        primary: ConstraintSnapshot::default(),
        secondary: ConstraintSnapshot::default(),
        active_mutator_id: 0,
        passive_mutator_id: 0,
        boss_id: 0,
        block_weights: pressure.block_weights[0],
        score_multiplier_x100: 100,
        combo_multiplier_x100: 100,
        line_clear_bonus: 0,
        perfect_clear_bonus: 0,
        star_threshold_modifier: 128,
        bonus_type: 0,
        bonus_trigger_type: 0,
        bonus_threshold: 0,
        starting_charges: 0,
        starting_rows: pressure.starting_height,
    }
}

fn transfer_from_owner<'info>(
    owner: &Signer<'info>,
    destination: &AccountInfo<'info>,
    system: &Program<'info, System>,
    amount: u64,
) -> Result<()> {
    invoke(
        &system_instruction::transfer(&owner.key(), destination.key, amount),
        &[
            owner.to_account_info(),
            destination.clone(),
            system.to_account_info(),
        ],
    )?;
    Ok(())
}

fn move_program_lamports(
    source: &AccountInfo<'_>,
    destination: &AccountInfo<'_>,
    amount: u64,
) -> Result<()> {
    require!(
        source.is_writable && destination.is_writable,
        ErrorCode::InvalidState
    );
    let source_balance = source.lamports();
    require!(source_balance >= amount, ErrorCode::InsufficientFunds);
    **source.try_borrow_mut_lamports()? = source_balance
        .checked_sub(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    **destination.try_borrow_mut_lamports()? = destination
        .lamports()
        .checked_add(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    Ok(())
}

fn spendable_lamports(account: &AccountInfo<'_>) -> Result<u64> {
    let rent = Rent::get()?.minimum_balance(account.data_len());
    account
        .lamports()
        .checked_sub(rent)
        .ok_or_else(|| error!(ErrorCode::InsufficientFunds))
}

fn validate_wallet(account: &AccountInfo<'_>, expected: Pubkey) -> Result<()> {
    require_keys_eq!(account.key(), expected, ErrorCode::InvalidOwner);
    require!(account.is_writable, ErrorCode::InvalidOwner);
    Ok(())
}

fn arena_entry_better(candidate: &ArenaBoardEntry, player: &ArenaPlayer) -> bool {
    candidate.score > player.best_score
        || (candidate.score == player.best_score
            && candidate.bonus_triggers > player.best_bonus_triggers)
        || (candidate.score == player.best_score
            && candidate.bonus_triggers == player.best_bonus_triggers
            && candidate.engine_score > player.best_engine_score)
        || (candidate.score == player.best_score
            && candidate.bonus_triggers == player.best_bonus_triggers
            && candidate.engine_score == player.best_engine_score
            && candidate.moves < player.best_moves)
        || (candidate.score == player.best_score
            && candidate.bonus_triggers == player.best_bonus_triggers
            && candidate.engine_score == player.best_engine_score
            && candidate.moves == player.best_moves
            && candidate.submitted_at < player.best_submitted_at)
}

fn run_metrics(active: &ActiveRun) -> RunProgressMetrics {
    RunProgressMetrics {
        arena_or_practice: true,
        lines_cleared: active.total_lines_cleared,
        bonus_uses: active.bonus_uses,
        combo2_hits: active.combo2_hits,
        combo3_hits: active.combo3_hits,
        combo4_hits: active.combo4_hits,
        high_combo_hits: active.high_combo_hits,
        blocks_destroyed_by_size: active.blocks_destroyed_by_size,
        max_combo: active.max_combo,
        campaign_level_completed: false,
        rating_improved: false,
        pressure_tier: active.current_difficulty,
        beat_yesterday_score: false,
        practice_top_25: false,
        perfect_clears: active.perfect_clears,
        new_perfect_level: false,
        boss_cleared: false,
    }
}

fn checked_add_u64(left: u64, right: u64) -> Result<u64> {
    left.checked_add(right)
        .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
}
fn checked_add_u32(left: u32, right: u32) -> Result<u32> {
    left.checked_add(right)
        .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
}
