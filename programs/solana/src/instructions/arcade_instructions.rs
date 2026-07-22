//! Native-SOL Arena entry, period funding, resolution, and push settlement.

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
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = protocol.paused @ ErrorCode::InvalidState
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        constraint = daily_rules_catalog.version == RULES_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = daily_rules_catalog.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = daily_rules_catalog.content_version == protocol.content_version @ ErrorCode::ContentVersionMismatch
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
            withdrawn: 0,
            bump: ctx.bumps.operator_revenue_vault,
        });
    Ok(())
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
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized)]
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
        args.content_version >= ctx.accounts.protocol.content_version,
        ErrorCode::ContentVersionMismatch
    );
    require!(
        args.rules_version > ctx.accounts.protocol.daily_rules_version,
        ErrorCode::InvalidVersion
    );
    require!(
        arena_rules_staging_is_allowed(
            ctx.accounts.protocol.content_version,
            args.content_version,
            ctx.accounts.protocol.paused,
        ),
        ErrorCode::InvalidState
    );
    let mut serialized = Vec::new();
    args.serialize(&mut serialized)?;
    let catalog_hash = sha256v(&[b"zkube-arena-catalog-v2", &serialized]);
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
    #[account(constraint = daily_rules_catalog.protocol == protocol.key() @ ErrorCode::InvalidOwner,
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

#[derive(Accounts)]
#[instruction(day_id: u32)]
pub struct PrepareArenaDaily<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(seeds = [ARCADE_CONFIG_SEED], bump = arcade_config.bump,
        constraint = arcade_config.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = arcade_config.rules_catalog == daily_rules_catalog.key() @ ErrorCode::InvalidOwner)]
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    pub daily_rules_catalog: Box<Account<'info, DailyRulesCatalog>>,
    #[account(init, payer = payer, space = 8 + ArenaDaily::INIT_SPACE,
        seeds = [ARENA_DAILY_SEED, day_id.to_le_bytes().as_ref()], bump)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_prepare_arena_daily(ctx: Context<PrepareArenaDaily>, day_id: u32) -> Result<()> {
    let today = day_id_at(Clock::get()?.unix_timestamp)?;
    require!(
        prepare_period_is_allowed(
            day_id,
            today,
            ctx.accounts.arcade_config.launch_seeded,
            ctx.accounts.arcade_config.launch_day_id,
        ),
        ErrorCode::InvalidPeriod
    );
    ctx.accounts.daily_rules_catalog.validate()?;
    let (opens_at, entries_close_at, runs_close_at, recovery_deadline_at) = day_window(day_id)?;
    // A missed historical Daily is necessarily recovery-only: its play
    // window can never reopen. If rules rotated during the outage, use the
    // current catalog's first supported day solely to construct a valid empty
    // carrier account so predecessor funds can roll through. Live/current
    // and following Dailies retain the exact catalog day selection.
    let scoring_day = if day_id < today {
        day_id.max(ctx.accounts.daily_rules_catalog.starts_day)
    } else {
        day_id
    };
    let scoring_rule = ctx
        .accounts
        .daily_rules_catalog
        .scoring_rule_for_day(scoring_day)?;
    let map_id = ctx.accounts.daily_rules_catalog.map_for_day(day_id);
    let rules_hash = zkube_core::daily_challenge_rules_hash_with::<SolanaSha256>(
        day_id,
        ctx.accounts.daily_rules_catalog.catalog_hash,
        ctx.accounts.daily_rules_catalog.rules_version,
        map_id,
        scoring_rule.id,
    )
    .0;
    ctx.accounts.arena_daily.set_inner(ArenaDaily {
        version: ARCADE_ACCOUNT_VERSION,
        day_id,
        week_id: week_id_for_day(day_id)?,
        season_id: season_id_for_day(day_id)?,
        arcade_config: ctx.accounts.arcade_config.key(),
        rules_version: ctx.accounts.daily_rules_catalog.rules_version,
        status: PeriodStatus::Funding,
        predecessor_rollover_applied: false,
        content_version: ctx.accounts.daily_rules_catalog.content_version,
        catalog_hash: ctx.accounts.daily_rules_catalog.catalog_hash,
        rules_hash,
        map_id,
        scoring_rule,
        rules: neutral_arena_rules(ctx.accounts.daily_rules_catalog.pressure),
        pressure: ctx.accounts.daily_rules_catalog.pressure,
        opens_at,
        entries_close_at,
        runs_close_at,
        recovery_deadline_at,
        finalized_at: 0,
        ledger: PoolLedger::default(),
        entries_paid: 0,
        entries_scored: 0,
        entries_expired: 0,
        unique_players: 0,
        season_eligible_players: 0,
        season_rollups: 0,
        season_rollup_sealed: false,
        entries: Vec::new(),
        profile_sync_mask: 0,
        bump: ctx.bumps.arena_daily,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(week_id: u32)]
pub struct PrepareWeeklyJackpot<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(seeds = [ARCADE_CONFIG_SEED], bump = arcade_config.bump,
        constraint = arcade_config.protocol == protocol.key() @ ErrorCode::InvalidOwner)]
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    #[account(address = arcade_config.rules_catalog)]
    pub daily_rules_catalog: Box<Account<'info, DailyRulesCatalog>>,
    #[account(init, payer = payer, space = 8 + WeeklyJackpot::INIT_SPACE,
        seeds = [WEEKLY_JACKPOT_SEED, week_id.to_le_bytes().as_ref()], bump)]
    pub weekly_jackpot: Box<Account<'info, WeeklyJackpot>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_prepare_weekly_jackpot(
    ctx: Context<PrepareWeeklyJackpot>,
    week_id: u32,
) -> Result<()> {
    let current = week_id_for_day(day_id_at(Clock::get()?.unix_timestamp)?)?;
    let launch = if ctx.accounts.arcade_config.launch_seeded {
        week_id_for_day(ctx.accounts.arcade_config.launch_day_id)?
    } else {
        current
    };
    require!(
        prepare_period_is_allowed(
            week_id,
            current,
            ctx.accounts.arcade_config.launch_seeded,
            launch,
        ),
        ErrorCode::InvalidPeriod
    );
    let (opens_at, closes_at) = week_window(week_id)?;
    let rules_hash = ctx.accounts.daily_rules_catalog.catalog_hash;
    ctx.accounts.weekly_jackpot.set_inner(WeeklyJackpot {
        version: ARCADE_ACCOUNT_VERSION,
        week_id,
        qualification_start_day: week_start_day(week_id)?,
        arcade_config: ctx.accounts.arcade_config.key(),
        status: PeriodStatus::Funding,
        predecessor_rollover_applied: false,
        metrics: weekly_metric_selection(week_id, rules_hash),
        rules_hash,
        opens_at,
        closes_at,
        finalized_at: 0,
        ledger: PoolLedger::default(),
        combo_entries: Vec::new(),
        action_entries: Vec::new(),
        run_entries: Vec::new(),
        profile_sync_mask: 0,
        bump: ctx.bumps.weekly_jackpot,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(season_id: u32)]
pub struct PrepareSeason<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(seeds = [ARCADE_CONFIG_SEED], bump = arcade_config.bump,
        constraint = arcade_config.protocol == protocol.key() @ ErrorCode::InvalidOwner)]
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    #[account(init, payer = payer, space = 8 + Season::INIT_SPACE,
        seeds = [SEASON_SEED, season_id.to_le_bytes().as_ref()], bump)]
    pub season: Box<Account<'info, Season>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_prepare_season(ctx: Context<PrepareSeason>, season_id: u32) -> Result<()> {
    let current = season_id_for_day(day_id_at(Clock::get()?.unix_timestamp)?)?;
    let launch = if ctx.accounts.arcade_config.launch_seeded {
        season_id_for_day(ctx.accounts.arcade_config.launch_day_id)?
    } else {
        current
    };
    require!(
        prepare_period_is_allowed(
            season_id,
            current,
            ctx.accounts.arcade_config.launch_seeded,
            launch,
        ),
        ErrorCode::InvalidPeriod
    );
    let (opens_at, closes_at) = season_window(season_id)?;
    ctx.accounts.season.set_inner(Season {
        version: ARCADE_ACCOUNT_VERSION,
        season_id,
        qualification_start_day: season_start_day(season_id)?,
        arcade_config: ctx.accounts.arcade_config.key(),
        status: PeriodStatus::Funding,
        predecessor_rollover_applied: false,
        opens_at,
        closes_at,
        finalized_at: 0,
        ledger: PoolLedger::default(),
        sealed_dailies: 0,
        entries: Vec::new(),
        profile_sync_mask: 0,
        bump: ctx.bumps.season,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ActivateArenaDaily<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump,
        constraint = arena_daily.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.status == PeriodStatus::Funding @ ErrorCode::InvalidState)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    pub caller: Signer<'info>,
}

pub fn handler_activate_arena_daily(ctx: Context<ActivateArenaDaily>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let current = day_id_at(now)?;
    require!(
        (current == ctx.accounts.arena_daily.day_id
            && now >= ctx.accounts.arena_daily.opens_at
            && now < ctx.accounts.arena_daily.entries_close_at)
            || (ctx.accounts.arena_daily.day_id < current
                && ctx.accounts.arena_daily.predecessor_rollover_applied
                && now >= ctx.accounts.arena_daily.recovery_deadline_at),
        ErrorCode::InvalidPeriod
    );
    ctx.accounts.arena_daily.status = PeriodStatus::Open;
    Ok(())
}

#[derive(Accounts)]
pub struct ActivateWeeklyJackpot<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [WEEKLY_JACKPOT_SEED, weekly_jackpot.week_id.to_le_bytes().as_ref()], bump = weekly_jackpot.bump,
        constraint = weekly_jackpot.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = weekly_jackpot.status == PeriodStatus::Funding @ ErrorCode::InvalidState)]
    pub weekly_jackpot: Box<Account<'info, WeeklyJackpot>>,
    pub caller: Signer<'info>,
}

pub fn handler_activate_weekly_jackpot(ctx: Context<ActivateWeeklyJackpot>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let current = week_id_for_day(day_id_at(now)?)?;
    require!(
        (current == ctx.accounts.weekly_jackpot.week_id
            && now >= ctx.accounts.weekly_jackpot.opens_at
            && now < ctx.accounts.weekly_jackpot.closes_at)
            || (ctx.accounts.weekly_jackpot.week_id < current
                && ctx.accounts.weekly_jackpot.predecessor_rollover_applied
                && period_settlement_ready(now, ctx.accounts.weekly_jackpot.closes_at)),
        ErrorCode::InvalidPeriod
    );
    ctx.accounts.weekly_jackpot.status = PeriodStatus::Open;
    Ok(())
}

#[derive(Accounts)]
pub struct ActivateSeason<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [SEASON_SEED, season.season_id.to_le_bytes().as_ref()], bump = season.bump,
        constraint = season.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = season.status == PeriodStatus::Funding @ ErrorCode::InvalidState)]
    pub season: Box<Account<'info, Season>>,
    pub caller: Signer<'info>,
}

pub fn handler_activate_season(ctx: Context<ActivateSeason>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let current = season_id_for_day(day_id_at(now)?)?;
    require!(
        (current == ctx.accounts.season.season_id
            && now >= ctx.accounts.season.opens_at
            && now < ctx.accounts.season.closes_at)
            || (ctx.accounts.season.season_id < current
                && ctx.accounts.season.predecessor_rollover_applied
                && period_settlement_ready(now, ctx.accounts.season.closes_at)),
        ErrorCode::InvalidPeriod
    );
    ctx.accounts.season.status = PeriodStatus::Open;
    Ok(())
}

#[derive(Accounts)]
pub struct SeedLaunchPools<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.paused @ ErrorCode::InvalidState)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [ARCADE_CONFIG_SEED], bump = arcade_config.bump,
        constraint = arcade_config.protocol == protocol.key() @ ErrorCode::InvalidOwner)]
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump,
        constraint = arena_daily.arcade_config == arcade_config.key() @ ErrorCode::InvalidOwner)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [WEEKLY_JACKPOT_SEED, weekly_jackpot.week_id.to_le_bytes().as_ref()], bump = weekly_jackpot.bump,
        constraint = weekly_jackpot.arcade_config == arcade_config.key() @ ErrorCode::InvalidOwner)]
    pub weekly_jackpot: Box<Account<'info, WeeklyJackpot>>,
    #[account(mut, seeds = [SEASON_SEED, season.season_id.to_le_bytes().as_ref()], bump = season.bump,
        constraint = season.arcade_config == arcade_config.key() @ ErrorCode::InvalidOwner)]
    pub season: Box<Account<'info, Season>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_seed_launch_pools(
    ctx: Context<SeedLaunchPools>,
    daily_lamports: u64,
    weekly_lamports: u64,
    season_lamports: u64,
) -> Result<()> {
    require!(
        !ctx.accounts.arcade_config.launch_seeded,
        ErrorCode::AlreadySeeded
    );
    require!(
        daily_lamports > 0 && weekly_lamports > 0 && season_lamports > 0,
        ErrorCode::InvalidState
    );
    require!(
        ctx.accounts.arena_daily.ledger.funded_lamports()? == 0
            && ctx.accounts.weekly_jackpot.ledger.funded_lamports()? == 0
            && ctx.accounts.season.ledger.funded_lamports()? == 0,
        ErrorCode::AlreadySeeded
    );
    require!(
        ctx.accounts.arena_daily.status == PeriodStatus::Funding
            && ctx.accounts.weekly_jackpot.status == PeriodStatus::Funding
            && ctx.accounts.season.status == PeriodStatus::Funding
            && !ctx.accounts.arena_daily.predecessor_rollover_applied
            && !ctx.accounts.weekly_jackpot.predecessor_rollover_applied
            && !ctx.accounts.season.predecessor_rollover_applied,
        ErrorCode::InvalidState
    );
    let today = day_id_at(Clock::get()?.unix_timestamp)?;
    require!(
        ctx.accounts.arena_daily.day_id == today
            && ctx.accounts.arena_daily.week_id == ctx.accounts.weekly_jackpot.week_id
            && ctx.accounts.arena_daily.season_id == ctx.accounts.season.season_id
            && week_id_for_day(today)? == ctx.accounts.weekly_jackpot.week_id
            && season_id_for_day(today)? == ctx.accounts.season.season_id,
        ErrorCode::InvalidPeriod
    );
    for (destination, amount) in [
        (ctx.accounts.arena_daily.to_account_info(), daily_lamports),
        (
            ctx.accounts.weekly_jackpot.to_account_info(),
            weekly_lamports,
        ),
        (ctx.accounts.season.to_account_info(), season_lamports),
    ] {
        transfer_from_signer(
            &ctx.accounts.authority,
            &destination,
            &ctx.accounts.system_program,
            amount,
        )?;
    }
    ctx.accounts.arena_daily.ledger.seeded_lamports = daily_lamports;
    ctx.accounts.weekly_jackpot.ledger.seeded_lamports = weekly_lamports;
    ctx.accounts.season.ledger.seeded_lamports = season_lamports;
    ctx.accounts.weekly_jackpot.qualification_start_day = today;
    ctx.accounts.season.qualification_start_day = today;
    ctx.accounts.arena_daily.predecessor_rollover_applied = true;
    ctx.accounts.weekly_jackpot.predecessor_rollover_applied = true;
    ctx.accounts.season.predecessor_rollover_applied = true;
    ctx.accounts.arcade_config.launch_seeded = true;
    ctx.accounts.arcade_config.launch_day_id = today;
    Ok(())
}

#[derive(Accounts)]
#[instruction(run_id: u64, expected_entry_lamports: u64)]
pub struct EnterArena<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(seeds = [ARCADE_CONFIG_SEED], bump = arcade_config.bump,
        constraint = arcade_config.protocol == protocol.key() @ ErrorCode::InvalidOwner)]
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    #[account(mut, seeds = [PLAYER_STATE_SEED, owner.key().as_ref()], bump = player_state.bump,
        constraint = player_state.owner == owner.key() @ ErrorCode::Unauthorized)]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, current_daily.day_id.to_le_bytes().as_ref()], bump = current_daily.bump,
        constraint = current_daily.arcade_config == arcade_config.key() @ ErrorCode::InvalidOwner)]
    pub current_daily: Box<Account<'info, ArenaDaily>>,
    #[account(init_if_needed, payer = payer, space = 8 + ArenaPlayer::INIT_SPACE,
        seeds = [ARENA_PLAYER_SEED, current_daily.key().as_ref(), owner.key().as_ref()], bump)]
    pub arena_player: Box<Account<'info, ArenaPlayer>>,
    #[account(seeds = [WEEKLY_JACKPOT_SEED, current_weekly.week_id.to_le_bytes().as_ref()], bump = current_weekly.bump,
        constraint = current_weekly.arcade_config == arcade_config.key() @ ErrorCode::InvalidOwner)]
    pub current_weekly: Box<Account<'info, WeeklyJackpot>>,
    #[account(seeds = [SEASON_SEED, current_season.season_id.to_le_bytes().as_ref()], bump = current_season.bump,
        constraint = current_season.arcade_config == arcade_config.key() @ ErrorCode::InvalidOwner)]
    pub current_season: Box<Account<'info, Season>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, following_daily.day_id.to_le_bytes().as_ref()], bump = following_daily.bump,
        constraint = following_daily.arcade_config == arcade_config.key() @ ErrorCode::InvalidOwner)]
    pub following_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [WEEKLY_JACKPOT_SEED, following_weekly.week_id.to_le_bytes().as_ref()], bump = following_weekly.bump,
        constraint = following_weekly.arcade_config == arcade_config.key() @ ErrorCode::InvalidOwner)]
    pub following_weekly: Box<Account<'info, WeeklyJackpot>>,
    #[account(mut, seeds = [SEASON_SEED, following_season.season_id.to_le_bytes().as_ref()], bump = following_season.bump,
        constraint = following_season.arcade_config == arcade_config.key() @ ErrorCode::InvalidOwner)]
    pub following_season: Box<Account<'info, Season>>,
    #[account(mut, seeds = [OPERATOR_REVENUE_VAULT_SEED], bump = operator_revenue_vault.bump,
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

pub fn handler_enter_arena(
    ctx: Context<EnterArena>,
    run_id: u64,
    expected_entry_lamports: u64,
) -> Result<()> {
    require_player_rent_payer(
        ctx.accounts.owner.key(),
        ctx.accounts.owner.key(),
        ctx.accounts.payer.key(),
    )?;
    ctx.accounts.arcade_config.validate_terms()?;
    require!(
        ctx.accounts.arcade_config.launch_seeded,
        ErrorCode::InvalidState
    );
    require!(
        expected_entry_lamports == ARENA_ENTRY_LAMPORTS,
        ErrorCode::PriceChanged
    );
    let now = Clock::get()?.unix_timestamp;
    let day_id = day_id_at(now)?;
    let week_id = week_id_for_day(day_id)?;
    let season_id = season_id_for_day(day_id)?;
    require!(
        ctx.accounts.current_daily.day_id == day_id
            && ctx.accounts.current_weekly.week_id == week_id
            && ctx.accounts.current_season.season_id == season_id
            && ctx.accounts.following_daily.day_id == day_id.saturating_add(1)
            && ctx.accounts.following_weekly.week_id == week_id.saturating_add(1)
            && ctx.accounts.following_season.season_id == season_id.saturating_add(1),
        ErrorCode::InvalidPeriod
    );
    require!(
        ctx.accounts.current_daily.status == PeriodStatus::Open
            && ctx.accounts.current_weekly.status == PeriodStatus::Open
            && ctx.accounts.current_season.status == PeriodStatus::Open
            && matches!(
                ctx.accounts.following_daily.status,
                PeriodStatus::Funding | PeriodStatus::Open
            )
            && matches!(
                ctx.accounts.following_weekly.status,
                PeriodStatus::Funding | PeriodStatus::Open
            )
            && matches!(
                ctx.accounts.following_season.status,
                PeriodStatus::Funding | PeriodStatus::Open
            )
            && now >= ctx.accounts.current_daily.opens_at
            && now < ctx.accounts.current_daily.entries_close_at,
        ErrorCode::ChallengeEnded
    );
    if ctx.accounts.arena_player.version == 0 {
        ctx.accounts.arena_player.set_inner(ArenaPlayer::initialize(
            ctx.accounts.current_daily.key(),
            ctx.accounts.owner.key(),
            ctx.bumps.arena_player,
        ));
        ctx.accounts.current_daily.unique_players =
            checked_add_u32(ctx.accounts.current_daily.unique_players, 1)?;
    }
    require!(
        ctx.accounts.arena_player.version == ARCADE_ACCOUNT_VERSION
            && ctx.accounts.arena_player.challenge == ctx.accounts.current_daily.key()
            && ctx.accounts.arena_player.player == ctx.accounts.owner.key()
            && ctx.accounts.arena_player.active_paid_run_id == 0,
        ErrorCode::InvalidOwner
    );
    for (destination, amount) in [
        (
            ctx.accounts.following_daily.to_account_info(),
            ENTRY_DAILY_LAMPORTS,
        ),
        (
            ctx.accounts.following_weekly.to_account_info(),
            ENTRY_WEEKLY_LAMPORTS,
        ),
        (
            ctx.accounts.following_season.to_account_info(),
            ENTRY_SEASON_LAMPORTS,
        ),
        (
            ctx.accounts.operator_revenue_vault.to_account_info(),
            ENTRY_OPERATOR_LAMPORTS,
        ),
    ] {
        transfer_from_signer(
            &ctx.accounts.owner,
            &destination,
            &ctx.accounts.system_program,
            amount,
        )?;
    }
    ctx.accounts
        .following_daily
        .ledger
        .add_entry(ENTRY_DAILY_LAMPORTS)?;
    ctx.accounts
        .following_weekly
        .ledger
        .add_entry(ENTRY_WEEKLY_LAMPORTS)?;
    ctx.accounts
        .following_season
        .ledger
        .add_entry(ENTRY_SEASON_LAMPORTS)?;
    ctx.accounts.operator_revenue_vault.gross_operator_share = checked_add_u64(
        ctx.accounts.operator_revenue_vault.gross_operator_share,
        ENTRY_OPERATOR_LAMPORTS,
    )?;
    ctx.accounts.current_daily.entries_paid =
        checked_add_u64(ctx.accounts.current_daily.entries_paid, 1)?;
    ctx.accounts.arena_player.paid_entries =
        checked_add_u32(ctx.accounts.arena_player.paid_entries, 1)?;
    ctx.accounts.player_state.record_paid_entry()?;
    ctx.accounts.arena_player.active_paid_run_id = run_id;
    let daily_key = ctx.accounts.current_daily.key();
    initialize_arena_run(
        &mut ctx.accounts.player_state,
        &ctx.accounts.current_daily,
        daily_key,
        &mut ctx.accounts.active_run,
        ctx.bumps.active_run,
        ctx.accounts.owner.key(),
        run_id,
        RunMode::Daily,
        ctx.accounts.current_daily.runs_close_at,
        ctx.accounts.protocol.replay_domain,
    )
}

#[derive(Accounts)]
#[instruction(run_id: u64)]
pub struct PreparePracticeRun<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [PLAYER_STATE_SEED, owner_authority.key().as_ref()], bump = player_state.bump,
        constraint = player_state.owner == owner_authority.key() @ ErrorCode::Unauthorized)]
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

pub fn handler_prepare_practice_run(ctx: Context<PreparePracticeRun>, run_id: u64) -> Result<()> {
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
    // Practice reuses yesterday's immutable rules and replay challenge, but
    // receives today's full run window. Pinning it to yesterday's close would
    // make every VRF request and action immediately stale.
    let practice_runs_close_at = practice_runs_close_at(ctx.accounts.arena_daily.day_id, now)?;
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
        practice_runs_close_at,
        ctx.accounts.protocol.replay_domain,
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
    deadline_at: i64,
    replay_domain: [u8; 32],
) -> Result<()> {
    player.reserve_arcade_run(run_id, daily_key, mode, deadline_at)?;
    *active = ActiveRun {
        version: ACCOUNT_VERSION,
        owner,
        daily_challenge: daily_key,
        run_id,
        mode,
        lifecycle: RunLifecycle::Prepared,
        rules_hash: daily.rules_hash,
        map_id: daily.map_id,
        level: 1,
        rules: daily.rules,
        daily_scoring_rule: daily.scoring_rule,
        daily_pressure: daily.pressure,
        starting_height_target: daily.rules.starting_rows,
        current_difficulty: 0,
        replay_hash: canonical_initial_replay(
            replay_domain,
            daily_key,
            daily.rules_hash,
            owner,
            run_id,
            mode,
        )?,
        deadline_at,
        bump,
        ..ActiveRun::default()
    };
    Ok(())
}

fn canonical_initial_replay(
    replay_domain: [u8; 32],
    daily: Pubkey,
    rules_hash: [u8; 32],
    owner: Pubkey,
    run_id: u64,
    mode: RunMode,
) -> Result<[u8; 32]> {
    let replay_mode = match mode {
        RunMode::Daily => zkube_core::ReplayMode::Ranked,
        RunMode::Practice => zkube_core::ReplayMode::Practice,
        RunMode::Campaign => return err!(ErrorCode::InvalidState),
    };
    let domain = zkube_core::ChainDomain(replay_domain);
    let player = zkube_core::derive_player_id_with::<SolanaSha256>(domain, owner.to_bytes());
    Ok(zkube_core::ReplayCommitment::initial_with::<SolanaSha256>(
        domain,
        zkube_core::ChallengeId(daily.to_bytes()),
        zkube_core::RulesHash(rules_hash),
        player,
        run_id,
        replay_mode,
    )
    .to_bytes())
}

#[derive(Accounts)]
pub struct ConsumeArenaRun<'info> {
    #[account(mut, seeds = [PLAYER_STATE_SEED, active_run.owner.as_ref()], bump = player_state.bump,
        constraint = player_state.owner == active_run.owner @ ErrorCode::Unauthorized)]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump,
        constraint = arena_daily.key() == active_run.daily_challenge @ ErrorCode::InvalidOwner)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [ARENA_PLAYER_SEED, arena_daily.key().as_ref(), active_run.owner.as_ref()], bump = arena_player.bump,
        constraint = arena_player.player == active_run.owner @ ErrorCode::Unauthorized)]
    pub arena_player: Box<Account<'info, ArenaPlayer>>,
    #[account(mut, seeds = [WEEKLY_JACKPOT_SEED, weekly_jackpot.week_id.to_le_bytes().as_ref()], bump = weekly_jackpot.bump,
        constraint = weekly_jackpot.week_id == arena_daily.week_id @ ErrorCode::InvalidPeriod)]
    pub weekly_jackpot: Box<Account<'info, WeeklyJackpot>>,
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
            && active.finished_at > 0
            && active.finished_at <= ctx.accounts.arena_daily.runs_close_at
            && active.pending_vrf_counter == 0,
        ErrorCode::GameNotFinished
    );
    require!(
        ctx.accounts.player_state.arcade_reservation_matches(
            active.run_id,
            active.daily_challenge,
            active.mode,
            active.deadline_at,
        ) && ctx.accounts.arena_player.active_paid_run_id == active.run_id,
        ErrorCode::InvalidRunId
    );
    ctx.accounts.arena_player.active_paid_run_id = 0;
    if active.action_counter == 0 {
        ctx.accounts
            .arena_daily
            .record_expired_entry(&mut ctx.accounts.arena_player)?;
    } else {
        let candidate = ArenaBoardEntry {
            player: active.owner,
            run_id: active.run_id,
            score: active.daily_score,
            attempts: ctx.accounts.arena_player.paid_entries,
            finalized_at: active.finished_at,
            replay_hash: active.replay_hash,
            metrics: active_run_metrics(active)?,
        };
        let first = ctx.accounts.arena_player.record_score(candidate);
        ctx.accounts
            .arena_daily
            .record_best(ctx.accounts.arena_player.best_entry);
        ctx.accounts
            .weekly_jackpot
            .record_run(ctx.accounts.arena_daily.key(), candidate);
        ctx.accounts.arena_daily.entries_scored =
            checked_add_u64(ctx.accounts.arena_daily.entries_scored, 1)?;
        ctx.accounts.arena_player.resolved_entries =
            checked_add_u32(ctx.accounts.arena_player.resolved_entries, 1)?;
        if first {
            ctx.accounts.arena_daily.season_eligible_players =
                checked_add_u32(ctx.accounts.arena_daily.season_eligible_players, 1)?;
        }
    }
    ctx.accounts.player_state.release_run(active.run_id)
}

#[derive(Accounts)]
pub struct ConsumePracticeRun<'info> {
    #[account(mut, seeds = [PLAYER_STATE_SEED, active_run.owner.as_ref()], bump = player_state.bump)]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(address = active_run.daily_challenge @ ErrorCode::InvalidOwner)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(seeds = [ARENA_PLAYER_SEED, arena_daily.key().as_ref(), active_run.owner.as_ref()], bump = arena_player.bump,
        constraint = arena_player.player == active_run.owner @ ErrorCode::Unauthorized)]
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
        active.mode == RunMode::Practice
            && active.lifecycle == RunLifecycle::Finished
            && active.pending_vrf_counter == 0,
        ErrorCode::GameNotFinished
    );
    require!(
        ctx.accounts.player_state.arcade_reservation_matches(
            active.run_id,
            active.daily_challenge,
            active.mode,
            active.deadline_at,
        ),
        ErrorCode::InvalidRunId
    );
    // Practice exists only for a client-side "would have ranked" comparison.
    // Consuming it releases the durable run reservation and writes no profile,
    // leaderboard, payout, or other progression state.
    ctx.accounts.player_state.release_run(active.run_id)
}

#[derive(Accounts)]
#[instruction(run_id: u64)]
pub struct ExpireUnresolvedArenaRun<'info> {
    #[account(mut, seeds = [PLAYER_STATE_SEED, owner.key().as_ref()], bump = player_state.bump,
        constraint = player_state.owner == owner.key() @ ErrorCode::Unauthorized)]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(mut, address = player_state.active_run_daily,
        seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [ARENA_PLAYER_SEED, arena_daily.key().as_ref(), owner.key().as_ref()], bump = arena_player.bump,
        constraint = arena_player.player == owner.key() @ ErrorCode::Unauthorized)]
    pub arena_player: Option<Box<Account<'info, ArenaPlayer>>>,
    /// CHECK: Wallet identity pinned by PlayerState.
    pub owner: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
}

pub fn handler_expire_unresolved_arena_run(
    ctx: Context<ExpireUnresolvedArenaRun>,
    run_id: u64,
) -> Result<()> {
    require!(
        Clock::get()?.unix_timestamp
            >= ctx
                .accounts
                .player_state
                .active_run_deadline_at
                .checked_add(STUCK_RUN_RECOVERY_SECONDS)
                .ok_or(ErrorCode::ArithmeticOverflow)?,
        ErrorCode::ChallengeNotEnded
    );
    require!(
        ctx.accounts.player_state.active_run_id == run_id,
        ErrorCode::InvalidRunId
    );
    if ctx.accounts.player_state.active_run_mode == RunMode::Daily {
        let player = ctx
            .accounts
            .arena_player
            .as_deref_mut()
            .ok_or(ErrorCode::InvalidState)?;
        require!(player.active_paid_run_id == run_id, ErrorCode::InvalidRunId);
        ctx.accounts.arena_daily.record_expired_entry(player)?;
        player.active_paid_run_id = 0;
    } else {
        require!(ctx.accounts.arena_player.is_none(), ErrorCode::InvalidState);
    }
    ctx.accounts.player_state.expire_arcade_run(run_id)
}

#[derive(Accounts)]
pub struct CleanupOrphanActiveRun<'info> {
    #[account(mut, close = rent_recipient,
        seeds = [ACTIVE_RUN_SEED, b"active", active_run.owner.as_ref(), active_run.run_id.to_le_bytes().as_ref()],
        bump = active_run.bump, constraint = active_run.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion)]
    pub active_run: Box<Account<'info, ActiveRun>>,
    #[account(mut, seeds = [PLAYER_STATE_SEED, active_run.owner.as_ref()], bump = player_state.bump,
        constraint = player_state.owner == active_run.owner @ ErrorCode::Unauthorized)]
    pub player_state: Box<Account<'info, PlayerState>>,
    /// CHECK: Canonical zero-data player funding PDA receives recycled rent.
    #[account(mut, seeds = [PLAYER_FUNDING_SEED, active_run.owner.as_ref()], bump,
        owner = system_program::ID @ ErrorCode::InvalidOwner,
        constraint = rent_recipient.data_is_empty() @ ErrorCode::InvalidOwner)]
    pub rent_recipient: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
}

pub fn handler_cleanup_orphan_active_run(ctx: Context<CleanupOrphanActiveRun>) -> Result<()> {
    require!(
        ctx.accounts.player_state.active_run_id == 0
            && ctx.accounts.player_state.orphan_run_id == ctx.accounts.active_run.run_id
            && Clock::get()?.unix_timestamp
                >= ctx
                    .accounts
                    .active_run
                    .deadline_at
                    .checked_add(STUCK_RUN_RECOVERY_SECONDS)
                    .ok_or(ErrorCode::ArithmeticOverflow)?,
        ErrorCode::InvalidState
    );
    ctx.accounts
        .player_state
        .release_orphan(ctx.accounts.active_run.run_id)
}

#[derive(Accounts)]
pub struct InitializeSeasonPlayer<'info> {
    #[account(seeds = [SEASON_SEED, season.season_id.to_le_bytes().as_ref()], bump = season.bump)]
    pub season: Box<Account<'info, Season>>,
    #[account(init, payer = payer, space = 8 + SeasonPlayer::INIT_SPACE,
        seeds = [SEASON_PLAYER_SEED, season.key().as_ref(), player.key().as_ref()], bump)]
    pub season_player: Box<Account<'info, SeasonPlayer>>,
    /// CHECK: Public wallet identity for deterministic leaderboard state.
    pub player: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_initialize_season_player(ctx: Context<InitializeSeasonPlayer>) -> Result<()> {
    ctx.accounts
        .season_player
        .set_inner(SeasonPlayer::initialize(
            ctx.accounts.season.key(),
            ctx.accounts.player.key(),
            ctx.bumps.season_player,
        ));
    Ok(())
}

#[derive(Accounts)]
pub struct RollupArenaToSeason<'info> {
    #[account(mut, seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump,
        constraint = arena_daily.status == PeriodStatus::Finalized @ ErrorCode::InvalidState)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [SEASON_SEED, season.season_id.to_le_bytes().as_ref()], bump = season.bump,
        constraint = season.season_id == arena_daily.season_id @ ErrorCode::InvalidPeriod)]
    pub season: Box<Account<'info, Season>>,
    #[account(mut, seeds = [SEASON_PLAYER_SEED, season.key().as_ref(), season_player.player.as_ref()], bump = season_player.bump,
        constraint = season_player.season == season.key() @ ErrorCode::InvalidOwner)]
    pub season_player: Box<Account<'info, SeasonPlayer>>,
    #[account(mut, seeds = [ARENA_PLAYER_SEED, arena_daily.key().as_ref(), season_player.player.as_ref()], bump = arena_player.bump,
        constraint = arena_player.challenge == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = arena_player.player == season_player.player @ ErrorCode::Unauthorized)]
    pub arena_player: Box<Account<'info, ArenaPlayer>>,
    pub caller: Signer<'info>,
}

pub fn handler_rollup_arena_to_season(ctx: Context<RollupArenaToSeason>) -> Result<()> {
    require!(
        ctx.accounts.arena_daily.day_id >= ctx.accounts.season.qualification_start_day
            && ctx.accounts.arena_player.resolved()
            && ctx.accounts.arena_player.has_best
            && !ctx.accounts.arena_player.season_rolled_up,
        ErrorCode::InvalidState
    );
    let position = ctx
        .accounts
        .arena_daily
        .entries
        .iter()
        .position(|entry| entry.player == ctx.accounts.season_player.player);
    let (rank, points) = match position {
        Some(zero_based) => (
            u16::try_from(zero_based + 1).map_err(|_| ErrorCode::ArithmeticOverflow)?,
            // Only players with a score are in the finalized board. Paid
            // zero-action expiries must not dilute the season percentile.
            daily_points(
                zero_based + 1,
                ctx.accounts.arena_daily.season_eligible_players,
            ),
        ),
        None => (51, 2),
    };
    ctx.accounts.season_player.record(DailySeasonResult {
        day_id: ctx.accounts.arena_daily.day_id,
        points,
        rank,
        recorded_at: ctx.accounts.arena_daily.finalized_at,
    })?;
    ctx.accounts.season.record(SeasonBoardEntry {
        player: ctx.accounts.season_player.player,
        points: ctx.accounts.season_player.points,
        finalized_at: ctx.accounts.season_player.final_counted_at,
    });
    ctx.accounts.arena_player.season_rolled_up = true;
    ctx.accounts.arena_daily.season_rollups =
        checked_add_u32(ctx.accounts.arena_daily.season_rollups, 1)?;
    Ok(())
}

#[derive(Accounts)]
pub struct SealArenaSeasonRollups<'info> {
    #[account(mut, seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump,
        constraint = arena_daily.status == PeriodStatus::Finalized @ ErrorCode::InvalidState)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [SEASON_SEED, season.season_id.to_le_bytes().as_ref()], bump = season.bump,
        constraint = season.season_id == arena_daily.season_id @ ErrorCode::InvalidPeriod)]
    pub season: Box<Account<'info, Season>>,
    pub caller: Signer<'info>,
}

pub fn handler_seal_arena_season_rollups(ctx: Context<SealArenaSeasonRollups>) -> Result<()> {
    require!(
        ctx.accounts.arena_daily.day_id >= ctx.accounts.season.qualification_start_day
            && !ctx.accounts.arena_daily.season_rollup_sealed
            && ctx.accounts.arena_daily.season_rollups
                == ctx.accounts.arena_daily.season_eligible_players,
        ErrorCode::InvalidState
    );
    ctx.accounts.arena_daily.season_rollup_sealed = true;
    ctx.accounts.season.sealed_dailies = ctx
        .accounts
        .season
        .sealed_dailies
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeArenaDaily<'info> {
    #[account(mut, seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, following_daily.day_id.to_le_bytes().as_ref()], bump = following_daily.bump,
        constraint = following_daily.day_id == arena_daily.day_id.saturating_add(1) @ ErrorCode::InvalidPeriod,
        constraint = !following_daily.predecessor_rollover_applied @ ErrorCode::AlreadySubmitted)]
    pub following_daily: Box<Account<'info, ArenaDaily>>,
    pub caller: Signer<'info>,
}

pub fn handler_finalize_arena_daily<'info>(
    ctx: Context<'info, FinalizeArenaDaily<'info>>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.arena_daily.status == PeriodStatus::Open
            && ctx.accounts.arena_daily.predecessor_rollover_applied
            && now >= ctx.accounts.arena_daily.runs_close_at
            && ctx.accounts.arena_daily.resolved(),
        ErrorCode::ChallengeNotEnded
    );
    let players = ctx
        .accounts
        .arena_daily
        .entries
        .iter()
        .map(|entry| entry.player)
        .collect::<Vec<_>>();
    let source_info = ctx.accounts.arena_daily.to_account_info();
    let successor_info = ctx.accounts.following_daily.to_account_info();
    settle_ranked_period(
        &mut **ctx.accounts.arena_daily,
        &mut **ctx.accounts.following_daily,
        &source_info,
        &successor_info,
        ctx.remaining_accounts,
        &players,
        now,
    )
}

#[derive(Accounts)]
pub struct FinalizeWeeklyJackpot<'info> {
    #[account(mut, seeds = [WEEKLY_JACKPOT_SEED, weekly_jackpot.week_id.to_le_bytes().as_ref()], bump = weekly_jackpot.bump)]
    pub weekly_jackpot: Box<Account<'info, WeeklyJackpot>>,
    #[account(mut, seeds = [WEEKLY_JACKPOT_SEED, following_weekly.week_id.to_le_bytes().as_ref()], bump = following_weekly.bump,
        constraint = following_weekly.week_id == weekly_jackpot.week_id.saturating_add(1) @ ErrorCode::InvalidPeriod,
        constraint = !following_weekly.predecessor_rollover_applied @ ErrorCode::AlreadySubmitted)]
    pub following_weekly: Box<Account<'info, WeeklyJackpot>>,
    pub caller: Signer<'info>,
}

pub fn handler_finalize_weekly_jackpot<'info>(
    ctx: Context<'info, FinalizeWeeklyJackpot<'info>>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.weekly_jackpot.status == PeriodStatus::Open
            && ctx.accounts.weekly_jackpot.predecessor_rollover_applied
            && period_settlement_ready(now, ctx.accounts.weekly_jackpot.closes_at),
        ErrorCode::ChallengeNotEnded
    );
    // Remaining accounts have one deterministic split: every qualified Daily
    // first, in ascending day order and read-only, followed by the unique
    // writable payout wallets in aggregate-recipient order. Validating every
    // Daily on-chain prevents a permissionless caller from settling Weekly
    // while an eligible ranked run could still change a skill board.
    let qualified_daily_count = usize::from(ctx.accounts.weekly_jackpot.qualified_day_count()?);
    require!(
        ctx.remaining_accounts.len() >= qualified_daily_count,
        ErrorCode::InvalidState
    );
    let (qualified_dailies, payout_destinations) =
        ctx.remaining_accounts.split_at(qualified_daily_count);
    for (offset, account) in qualified_dailies.iter().enumerate() {
        let expected_day = ctx
            .accounts
            .weekly_jackpot
            .qualification_start_day
            .checked_add(u32::try_from(offset).map_err(|_| ErrorCode::ArithmeticOverflow)?)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        validate_finalized_weekly_daily(account, &ctx.accounts.weekly_jackpot, expected_day)?;
    }
    let pool = ctx.accounts.weekly_jackpot.ledger.available_lamports()?;
    require_spendable(&ctx.accounts.weekly_jackpot.to_account_info(), pool)?;
    let budget = weekly_bounty_budget(pool);
    let boards: [&[MetricBoardEntry]; 3] = [
        &ctx.accounts.weekly_jackpot.combo_entries,
        &ctx.accounts.weekly_jackpot.action_entries,
        &ctx.accounts.weekly_jackpot.run_entries,
    ];
    let counts = boards.map(|board| {
        board
            .iter()
            .take(WEEKLY_PRIZE_WEIGHTS.len())
            .take_while(|entry| entry.value > 0)
            .count()
    });
    let plans = [
        rounded_payouts(budget, &WEEKLY_PRIZE_WEIGHTS, counts[0])?,
        rounded_payouts(budget, &WEEKLY_PRIZE_WEIGHTS, counts[1])?,
        rounded_payouts(budget, &WEEKLY_PRIZE_WEIGHTS, counts[2])?,
    ];
    let recipients = aggregate_weekly_recipients(boards, counts, &plans)?;
    require!(
        payout_destinations.len() == usize::from(recipients.count),
        ErrorCode::InvalidState
    );
    for (index, destination) in payout_destinations.iter().enumerate() {
        validate_wallet(destination, recipients.players[index])?;
        move_program_lamports(
            &ctx.accounts.weekly_jackpot.to_account_info(),
            destination,
            recipients.amounts[index],
        )?;
    }
    let rollover = pool
        .checked_sub(recipients.total_lamports)
        .ok_or(ErrorCode::AccountingInvariant)?;
    move_program_lamports(
        &ctx.accounts.weekly_jackpot.to_account_info(),
        &ctx.accounts.following_weekly.to_account_info(),
        rollover,
    )?;
    ctx.accounts
        .weekly_jackpot
        .ledger
        .settle(recipients.total_lamports, rollover)?;
    ctx.accounts
        .following_weekly
        .ledger
        .add_rollover(rollover)?;
    ctx.accounts.following_weekly.predecessor_rollover_applied = true;
    ctx.accounts.weekly_jackpot.status = PeriodStatus::Finalized;
    ctx.accounts.weekly_jackpot.finalized_at = now;
    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeSeason<'info> {
    #[account(mut, seeds = [SEASON_SEED, season.season_id.to_le_bytes().as_ref()], bump = season.bump)]
    pub season: Box<Account<'info, Season>>,
    #[account(mut, seeds = [SEASON_SEED, following_season.season_id.to_le_bytes().as_ref()], bump = following_season.bump,
        constraint = following_season.season_id == season.season_id.saturating_add(1) @ ErrorCode::InvalidPeriod,
        constraint = !following_season.predecessor_rollover_applied @ ErrorCode::AlreadySubmitted)]
    pub following_season: Box<Account<'info, Season>>,
    pub caller: Signer<'info>,
}

pub fn handler_finalize_season<'info>(ctx: Context<'info, FinalizeSeason<'info>>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.season.status == PeriodStatus::Open
            && ctx.accounts.season.predecessor_rollover_applied
            && ctx.accounts.season.sealed_dailies == ctx.accounts.season.qualified_day_count()?
            && period_settlement_ready(now, ctx.accounts.season.closes_at),
        ErrorCode::ChallengeNotEnded
    );
    let players = ctx
        .accounts
        .season
        .entries
        .iter()
        .map(|entry| entry.player)
        .collect::<Vec<_>>();
    let source_info = ctx.accounts.season.to_account_info();
    let successor_info = ctx.accounts.following_season.to_account_info();
    settle_ranked_period(
        &mut **ctx.accounts.season,
        &mut **ctx.accounts.following_season,
        &source_info,
        &successor_info,
        ctx.remaining_accounts,
        &players,
        now,
    )
}

trait RankedPeriod {
    fn status_mut(&mut self) -> &mut PeriodStatus;
    fn predecessor_applied(&self) -> bool;
    fn predecessor_applied_mut(&mut self) -> &mut bool;
    fn ledger(&self) -> PoolLedger;
    fn ledger_mut(&mut self) -> &mut PoolLedger;
    fn finalized_at_mut(&mut self) -> &mut i64;
}

impl RankedPeriod for ArenaDaily {
    fn status_mut(&mut self) -> &mut PeriodStatus {
        &mut self.status
    }
    fn predecessor_applied(&self) -> bool {
        self.predecessor_rollover_applied
    }
    fn predecessor_applied_mut(&mut self) -> &mut bool {
        &mut self.predecessor_rollover_applied
    }
    fn ledger(&self) -> PoolLedger {
        self.ledger
    }
    fn ledger_mut(&mut self) -> &mut PoolLedger {
        &mut self.ledger
    }
    fn finalized_at_mut(&mut self) -> &mut i64 {
        &mut self.finalized_at
    }
}

impl RankedPeriod for Season {
    fn status_mut(&mut self) -> &mut PeriodStatus {
        &mut self.status
    }
    fn predecessor_applied(&self) -> bool {
        self.predecessor_rollover_applied
    }
    fn predecessor_applied_mut(&mut self) -> &mut bool {
        &mut self.predecessor_rollover_applied
    }
    fn ledger(&self) -> PoolLedger {
        self.ledger
    }
    fn ledger_mut(&mut self) -> &mut PoolLedger {
        &mut self.ledger
    }
    fn finalized_at_mut(&mut self) -> &mut i64 {
        &mut self.finalized_at
    }
}

fn settle_ranked_period<'info, T: RankedPeriod>(
    source: &mut T,
    successor: &mut T,
    source_info: &AccountInfo<'info>,
    successor_info: &AccountInfo<'info>,
    destinations: &[AccountInfo<'info>],
    players: &[Pubkey],
    finalized_at: i64,
) -> Result<()> {
    require!(source.predecessor_applied(), ErrorCode::InvalidState);
    let pool = source.ledger().available_lamports()?;
    require_spendable(source_info, pool)?;
    let winners = players.len().min(DAILY_PRIZE_WEIGHTS.len());
    let plan = rounded_payouts(pool, &DAILY_PRIZE_WEIGHTS, winners)?;
    let positive = plan.amounts[..winners]
        .iter()
        .filter(|amount| **amount > 0)
        .count();
    require!(destinations.len() == positive, ErrorCode::InvalidState);
    let mut destination_index = 0usize;
    for (rank, amount) in plan.amounts[..winners].iter().enumerate() {
        if *amount == 0 {
            continue;
        }
        validate_wallet(&destinations[destination_index], players[rank])?;
        move_program_lamports(source_info, &destinations[destination_index], *amount)?;
        destination_index += 1;
    }
    move_program_lamports(source_info, successor_info, plan.rollover_lamports)?;
    source
        .ledger_mut()
        .settle(plan.paid_lamports, plan.rollover_lamports)?;
    successor
        .ledger_mut()
        .add_rollover(plan.rollover_lamports)?;
    *successor.predecessor_applied_mut() = true;
    *source.status_mut() = PeriodStatus::Finalized;
    *source.finalized_at_mut() = finalized_at;
    Ok(())
}

#[derive(Accounts)]
pub struct CloseArenaPlayer<'info> {
    #[account(seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump,
        constraint = arena_daily.status == PeriodStatus::Finalized @ ErrorCode::InvalidState)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, close = rent_recipient,
        seeds = [ARENA_PLAYER_SEED, arena_daily.key().as_ref(), arena_player.player.as_ref()], bump = arena_player.bump,
        constraint = arena_player.active_paid_run_id == 0 @ ErrorCode::ActiveRunExists,
        constraint = !arena_player.has_best || arena_player.season_rolled_up @ ErrorCode::InvalidState)]
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
pub struct CloseSeasonPlayer<'info> {
    #[account(seeds = [SEASON_SEED, season.season_id.to_le_bytes().as_ref()], bump = season.bump,
        constraint = season.status == PeriodStatus::Finalized @ ErrorCode::InvalidState)]
    pub season: Box<Account<'info, Season>>,
    #[account(mut, close = rent_recipient,
        seeds = [SEASON_PLAYER_SEED, season.key().as_ref(), season_player.player.as_ref()], bump = season_player.bump)]
    pub season_player: Box<Account<'info, SeasonPlayer>>,
    /// CHECK: Canonical player funding PDA receives recycled rent.
    #[account(mut, seeds = [PLAYER_FUNDING_SEED, season_player.player.as_ref()], bump,
        owner = system_program::ID @ ErrorCode::InvalidOwner,
        constraint = rent_recipient.data_is_empty() @ ErrorCode::InvalidOwner)]
    pub rent_recipient: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
}

pub fn handler_close_season_player(_ctx: Context<CloseSeasonPlayer>) -> Result<()> {
    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawOperatorRevenue<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [OPERATOR_REVENUE_VAULT_SEED], bump = operator_revenue_vault.bump,
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
    require!(
        lamports > 0
            && ctx
                .accounts
                .operator_revenue_vault
                .gross_operator_share
                .checked_sub(ctx.accounts.operator_revenue_vault.withdrawn)
                .is_some_and(|available| lamports <= available),
        ErrorCode::InsufficientFunds
    );
    require_spendable(
        &ctx.accounts.operator_revenue_vault.to_account_info(),
        lamports,
    )?;
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

fn active_run_metrics(active: &ActiveRun) -> Result<RunMetrics> {
    Ok(active.arcade_metrics)
}

fn transfer_from_signer<'info>(
    signer: &Signer<'info>,
    destination: &AccountInfo<'info>,
    system: &Program<'info, System>,
    amount: u64,
) -> Result<()> {
    invoke(
        &system_instruction::transfer(&signer.key(), destination.key, amount),
        &[
            signer.to_account_info(),
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

fn require_spendable(account: &AccountInfo<'_>, amount: u64) -> Result<()> {
    let rent = Rent::get()?.minimum_balance(account.data_len());
    require!(
        account.lamports().saturating_sub(rent) >= amount,
        ErrorCode::InsufficientFunds
    );
    Ok(())
}

fn validate_wallet(account: &AccountInfo<'_>, expected: Pubkey) -> Result<()> {
    require_keys_eq!(account.key(), expected, ErrorCode::InvalidOwner);
    require!(
        account.is_writable && *account.owner == system_program::ID && account.data_is_empty(),
        ErrorCode::InvalidOwner
    );
    Ok(())
}

fn validate_finalized_weekly_daily(
    account: &AccountInfo<'_>,
    weekly: &WeeklyJackpot,
    expected_day: u32,
) -> Result<()> {
    require!(
        !account.executable && !account.is_writable && *account.owner == crate::ID,
        ErrorCode::InvalidOwner
    );
    require!(
        account.data_len() == 8 + ArenaDaily::INIT_SPACE,
        ErrorCode::InvalidOwner
    );
    let data = account.try_borrow_data()?;
    let mut bytes = data.as_ref();
    let daily = ArenaDaily::try_deserialize(&mut bytes)?;
    require!(
        daily.version == ARCADE_ACCOUNT_VERSION
            && daily.day_id == expected_day
            && daily.week_id == weekly.week_id
            && daily.arcade_config == weekly.arcade_config
            && daily.status == PeriodStatus::Finalized
            && daily.resolved(),
        ErrorCode::ChallengeNotEnded
    );
    let (expected_key, bump) =
        Pubkey::find_program_address(&[ARENA_DAILY_SEED, &expected_day.to_le_bytes()], &crate::ID);
    require_keys_eq!(account.key(), expected_key, ErrorCode::InvalidPeriod);
    require!(daily.bump == bump, ErrorCode::InvalidPeriod);
    Ok(())
}

fn checked_add_u64(left: u64, right: u64) -> Result<u64> {
    left.checked_add(right)
        .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
}

fn prepare_period_is_allowed(
    requested: u32,
    current: u32,
    launch_seeded: bool,
    launch: u32,
) -> bool {
    let no_future_gap = requested <= current.saturating_add(1);
    if launch_seeded {
        requested >= launch && no_future_gap
    } else {
        requested >= current && no_future_gap
    }
}

fn arena_rules_staging_is_allowed(
    active_content_version: u32,
    requested_content_version: u32,
    paused: bool,
) -> bool {
    requested_content_version == active_content_version || paused
}

fn practice_runs_close_at(challenge_day_id: u32, now: i64) -> Result<i64> {
    let today = day_id_at(now)?;
    require!(
        challenge_day_id.saturating_add(1) == today,
        ErrorCode::InvalidPeriod
    );
    let (opens_at, _, runs_close_at, _) = day_window(today)?;
    require!(
        now >= opens_at && now < runs_close_at,
        ErrorCode::ChallengeEnded
    );
    Ok(runs_close_at)
}

fn checked_add_u32(left: u32, right: u32) -> Result<u32> {
    left.checked_add(right)
        .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launched_period_preparation_can_rebuild_only_bounded_history() {
        assert!(prepare_period_is_allowed(100, 104, true, 100));
        assert!(prepare_period_is_allowed(104, 104, true, 100));
        assert!(prepare_period_is_allowed(105, 104, true, 100));
        assert!(!prepare_period_is_allowed(99, 104, true, 100));
        assert!(!prepare_period_is_allowed(106, 104, true, 100));
    }

    #[test]
    fn prelaunch_preparation_remains_current_or_successor_only() {
        assert!(prepare_period_is_allowed(104, 104, false, 0));
        assert!(prepare_period_is_allowed(105, 104, false, 0));
        assert!(!prepare_period_is_allowed(103, 104, false, 0));
        assert!(!prepare_period_is_allowed(106, 104, false, 0));
    }

    #[test]
    fn future_arena_rules_can_only_be_staged_while_paused() {
        assert!(arena_rules_staging_is_allowed(7, 7, false));
        assert!(arena_rules_staging_is_allowed(7, 8, true));
        assert!(!arena_rules_staging_is_allowed(7, 8, false));
    }

    #[test]
    fn practice_reuses_yesterday_rules_but_gets_todays_run_window() {
        let yesterday = 104;
        let today = yesterday + 1;
        let (today_opens, _, today_runs_close, _) = day_window(today).unwrap();
        let (_, _, stale_yesterday_close, _) = day_window(yesterday).unwrap();
        assert_eq!(
            practice_runs_close_at(yesterday, today_opens + 1).unwrap(),
            today_runs_close
        );
        assert!(today_runs_close > stale_yesterday_close);
        assert!(practice_runs_close_at(today, today_opens + 1).is_err());
        assert!(practice_runs_close_at(yesterday, today_runs_close).is_err());
    }
}
