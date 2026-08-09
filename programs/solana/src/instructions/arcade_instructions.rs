//! Native-SOL Arena entry, period funding, resolution, and claim settlement.

use crate::error::ErrorCode;
use crate::game::sha256v;
use crate::instructions::player_authorization::{
    require_player_authorization, require_player_rent_payer,
};
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction, system_program};
use session_keys::SessionTokenV2;

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
    #[account(init, payer = authority, space = 8 + CreditVault::INIT_SPACE, seeds = [CREDIT_VAULT_SEED], bump)]
    pub credit_vault: Box<Account<'info, CreditVault>>,
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
    ctx.accounts.credit_vault.set_inner(CreditVault {
        version: ARCADE_ACCOUNT_VERSION,
        protocol: ctx.accounts.protocol.key(),
        purchased_prize_lamports: 0,
        spent_prize_lamports: 0,
        bump: ctx.bumps.credit_vault,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(first_day_id: u32)]
pub struct InitializeArcadeArchive<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = protocol.paused @ ErrorCode::InvalidState
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [ARCADE_CONFIG_SEED], bump = arcade_config.bump,
        constraint = arcade_config.protocol == protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    #[account(
        address = arcade_config.rules_catalog @ ErrorCode::InvalidOwner,
        constraint = daily_rules_catalog.protocol == protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub daily_rules_catalog: Box<Account<'info, DailyRulesCatalog>>,
    #[account(
        init,
        payer = authority,
        space = 8 + ArcadeArchive::INIT_SPACE,
        seeds = [ARCADE_ARCHIVE_SEED],
        bump
    )]
    pub arcade_archive: Box<Account<'info, ArcadeArchive>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_initialize_arcade_archive(
    ctx: Context<InitializeArcadeArchive>,
    first_day_id: u32,
) -> Result<()> {
    let today = day_id_at(Clock::get()?.unix_timestamp)?;
    require!(
        (ctx.accounts.arcade_config.launch_seeded
            && first_day_id == ctx.accounts.arcade_config.launch_day_id)
            || (!ctx.accounts.arcade_config.launch_seeded && first_day_id == today),
        ErrorCode::InvalidPeriod
    );
    ctx.accounts.daily_rules_catalog.validate()?;
    require!(
        ctx.accounts.daily_rules_catalog.is_scheduled(first_day_id),
        ErrorCode::DailyNotScheduled
    );
    ctx.accounts
        .arcade_archive
        .set_inner(ArcadeArchive::initialize(
            ctx.accounts.arcade_config.key(),
            first_day_id,
            ctx.bumps.arcade_archive,
        )?);
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PublishArenaRulesArgs {
    pub content_version: u32,
    pub rules_version: u32,
    pub pool_revision: u32,
    pub starts_day: u32,
    pub pool_entry_count: u8,
    pub pool_entries: Vec<DailyPoolEntry>,
    pub difficulty_band_count: u8,
    pub difficulty_bands: [DailyPressureProfile; DAILY_DIFFICULTY_BAND_CAPACITY],
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
    require!(
        args.pool_entries.len() == usize::from(args.pool_entry_count)
            && args.pool_entries.len() <= DAILY_POOL_ENTRY_CAPACITY,
        ErrorCode::InvalidLevel
    );
    let mut serialized = Vec::new();
    args.serialize(&mut serialized)?;
    let catalog_hash = sha256v(&[b"zkube-arena-catalog-v4", &serialized]);
    let catalog = &mut ctx.accounts.daily_rules_catalog;
    catalog.version = RULES_ACCOUNT_VERSION;
    catalog.rules_version = args.rules_version;
    catalog.protocol = ctx.accounts.protocol.key();
    catalog.content_version = args.content_version;
    catalog.catalog_hash = catalog_hash;
    catalog.pool_revision = args.pool_revision;
    catalog.starts_day = args.starts_day;
    catalog.selection_seed = zkube_core::DAILY_POOL_SELECTION_SEED;
    catalog.pool_entry_count = args.pool_entry_count;
    catalog.pool_entries = args.pool_entries;
    catalog.difficulty_band_count = args.difficulty_band_count;
    catalog.difficulty_bands = args.difficulty_bands;
    catalog.bump = ctx.bumps.daily_rules_catalog;
    catalog.validate()?;
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
    #[account(
        seeds = [ARCADE_ARCHIVE_SEED],
        bump = arcade_archive.bump,
        constraint = arcade_archive.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arcade_archive.arcade_config == arcade_config.key() @ ErrorCode::InvalidOwner,
        constraint = day_id > arcade_archive.last_daily_id @ ErrorCode::InvalidPeriod
    )]
    pub arcade_archive: Box<Account<'info, ArcadeArchive>>,
    pub daily_rules_catalog: Box<Account<'info, DailyRulesCatalog>>,
    #[account(
        constraint = realm_map_catalog.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = realm_map_catalog.content_version == daily_rules_catalog.content_version @ ErrorCode::ContentVersionMismatch,
        constraint = realm_map_catalog.enabled @ ErrorCode::MapDisabled
    )]
    pub realm_map_catalog: Box<Account<'info, MapCatalog>>,
    #[account(
        constraint = passive_map_catalog.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = passive_map_catalog.content_version == daily_rules_catalog.content_version @ ErrorCode::ContentVersionMismatch,
        constraint = passive_map_catalog.enabled @ ErrorCode::MapDisabled
    )]
    pub passive_map_catalog: Box<Account<'info, MapCatalog>>,
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
            ctx.accounts.daily_rules_catalog.starts_day,
            ctx.accounts.daily_rules_catalog.pool_entry_count,
        ),
        ErrorCode::InvalidPeriod
    );
    ctx.accounts.daily_rules_catalog.validate()?;
    let (opens_at, entries_close_at, runs_close_at, recovery_deadline_at) = day_window(day_id)?;
    let content = ctx.accounts.daily_rules_catalog.content_for_day(day_id)?;
    let entry = content.entry;
    let realm_account_id = entry.realm_map_id.max(1);
    validate_daily_map_catalog(
        &ctx.accounts.realm_map_catalog,
        realm_account_id,
        ctx.accounts.daily_rules_catalog.content_version,
    )?;
    validate_daily_map_catalog(
        &ctx.accounts.passive_map_catalog,
        entry.passive_map_id,
        ctx.accounts.daily_rules_catalog.content_version,
    )?;
    validate_daily_pool_entry(
        entry,
        &ctx.accounts.realm_map_catalog.map_rules,
        &ctx.accounts.passive_map_catalog.map_rules,
    )?;
    let rules = daily_level_rules(entry, content.pressure);
    let rules_hash = zkube_core::daily_challenge_rules_hash_with::<SolanaSha256>(
        day_id,
        ctx.accounts.daily_rules_catalog.catalog_hash,
        ctx.accounts.daily_rules_catalog.rules_version,
        entry.realm_map_id,
        entry.scoring_rule.id,
    )
    .0;
    ctx.accounts.arena_daily.set_inner(ArenaDaily {
        version: ARCADE_ACCOUNT_VERSION,
        day_id,
        arcade_config: ctx.accounts.arcade_config.key(),
        rules_version: ctx.accounts.daily_rules_catalog.rules_version,
        status: PeriodStatus::Funding,
        predecessor_rollover_applied: false,
        content_version: ctx.accounts.daily_rules_catalog.content_version,
        catalog_hash: ctx.accounts.daily_rules_catalog.catalog_hash,
        rules_hash,
        map_id: entry.realm_map_id,
        passive_map_id: entry.passive_map_id,
        scoring_rule: entry.scoring_rule,
        rules,
        pressure: content.pressure,
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
        score_qualified_players: 0,
        theme_qualified_players: 0,
        claims_expired: false,
        bump: ctx.bumps.arena_daily,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ActivateArenaDaily<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        constraint = daily_rules_catalog.protocol == protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub daily_rules_catalog: Box<Account<'info, DailyRulesCatalog>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump,
        constraint = arena_daily.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.status == PeriodStatus::Funding @ ErrorCode::InvalidState)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    pub caller: Signer<'info>,
}

pub fn handler_activate_arena_daily(ctx: Context<ActivateArenaDaily>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let current = day_id_at(now)?;
    let scheduled = scheduled_daily_window(&ctx.accounts.daily_rules_catalog, current)?;
    require!(
        (ctx.accounts.arena_daily.day_id == scheduled.0
            || ctx.accounts.arena_daily.day_id == scheduled.1)
            || (ctx.accounts.arena_daily.day_id < current
                && ctx.accounts.arena_daily.predecessor_rollover_applied
                && now >= ctx.accounts.arena_daily.recovery_deadline_at),
        ErrorCode::InvalidPeriod
    );
    ctx.accounts.arena_daily.status = PeriodStatus::Open;
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
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_seed_launch_pools(ctx: Context<SeedLaunchPools>, daily_lamports: u64) -> Result<()> {
    require!(
        !ctx.accounts.arcade_config.launch_seeded,
        ErrorCode::AlreadySeeded
    );
    require!(daily_lamports > 0, ErrorCode::InvalidState);
    require!(
        ctx.accounts.arena_daily.ledger.funded_lamports()? == 0,
        ErrorCode::AlreadySeeded
    );
    require!(
        ctx.accounts.arena_daily.status == PeriodStatus::Funding
            && !ctx.accounts.arena_daily.predecessor_rollover_applied,
        ErrorCode::InvalidState
    );
    let today = day_id_at(Clock::get()?.unix_timestamp)?;
    require!(
        ctx.accounts.arena_daily.day_id == today,
        ErrorCode::InvalidPeriod
    );
    transfer_from_signer(
        &ctx.accounts.authority,
        &ctx.accounts.arena_daily.to_account_info(),
        &ctx.accounts.system_program,
        daily_lamports,
    )?;
    ctx.accounts.arena_daily.ledger.seeded_lamports = daily_lamports;
    ctx.accounts.arena_daily.predecessor_rollover_applied = true;
    ctx.accounts.arcade_config.launch_seeded = true;
    ctx.accounts.arcade_config.launch_day_id = today;
    Ok(())
}

#[derive(Accounts)]
pub struct TopUpArenaDaily<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [ARCADE_CONFIG_SEED],
        bump = arcade_config.bump,
        constraint = arcade_config.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arcade_config.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = arcade_config.launch_seeded @ ErrorCode::InvalidState
    )]
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    #[account(
        address = arcade_config.rules_catalog @ ErrorCode::InvalidOwner,
        constraint = daily_rules_catalog.protocol == protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub daily_rules_catalog: Box<Account<'info, DailyRulesCatalog>>,
    #[account(
        mut,
        seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()],
        bump = arena_daily.bump,
        constraint = arena_daily.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.arcade_config == arcade_config.key() @ ErrorCode::InvalidOwner
    )]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_top_up_arena_daily(ctx: Context<TopUpArenaDaily>, lamports: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let current = day_id_at(now)?;
    require!(lamports > 0, ErrorCode::InvalidState);
    require!(
        top_up_period_is_allowed(
            ctx.accounts.arena_daily.day_id,
            current,
            &ctx.accounts.daily_rules_catalog,
        ),
        ErrorCode::InvalidPeriod
    );
    require!(
        matches!(
            ctx.accounts.arena_daily.status,
            PeriodStatus::Funding | PeriodStatus::Open
        ) && now < ctx.accounts.arena_daily.runs_close_at,
        ErrorCode::ChallengeEnded
    );
    transfer_from_signer(
        &ctx.accounts.authority,
        &ctx.accounts.arena_daily.to_account_info(),
        &ctx.accounts.system_program,
        lamports,
    )?;
    ctx.accounts.arena_daily.ledger.add_seed(lamports)?;
    emit!(PrizePoolFunded {
        period_id: ctx.accounts.arena_daily.day_id,
        authority: ctx.accounts.authority.key(),
        lamports,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(kredit_count: u32, expected_unit_lamports: u64)]
pub struct PurchaseKredits<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [ARCADE_CONFIG_SEED],
        bump = arcade_config.bump,
        constraint = arcade_config.protocol == protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, owner.key().as_ref()],
        bump = player_state.bump,
        constraint = player_state.owner == owner.key() @ ErrorCode::Unauthorized,
        constraint = player_state.schema_valid() @ ErrorCode::InvalidVersion
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(
        mut,
        seeds = [CREDIT_VAULT_SEED],
        bump = credit_vault.bump,
        constraint = credit_vault.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = credit_vault.protocol == protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub credit_vault: Box<Account<'info, CreditVault>>,
    #[account(
        mut,
        seeds = [OPERATOR_REVENUE_VAULT_SEED],
        bump = operator_revenue_vault.bump,
        constraint = operator_revenue_vault.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = operator_revenue_vault.protocol == protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub operator_revenue_vault: Box<Account<'info, OperatorRevenueVault>>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_purchase_kredits(
    ctx: Context<PurchaseKredits>,
    kredit_count: u32,
    expected_unit_lamports: u64,
) -> Result<()> {
    ctx.accounts.arcade_config.validate_terms()?;
    require!(
        ctx.accounts.arcade_config.launch_seeded,
        ErrorCode::InvalidState
    );
    require!(
        kredit_count > 0 && expected_unit_lamports == ARENA_ENTRY_LAMPORTS,
        ErrorCode::InvalidKreditPurchase
    );
    let split = zkube_core::split_arena_entry(expected_unit_lamports)
        .map_err(|_| error!(ErrorCode::AccountingInvariant))?;
    let count = u64::from(kredit_count);
    let prize_lamports = split
        .next_daily_lamports
        .checked_mul(count)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let operator_lamports = split
        .operator_lamports
        .checked_mul(count)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        prize_lamports.checked_add(operator_lamports) == expected_unit_lamports.checked_mul(count),
        ErrorCode::AccountingInvariant
    );
    transfer_from_signer(
        &ctx.accounts.owner,
        &ctx.accounts.credit_vault.to_account_info(),
        &ctx.accounts.system_program,
        prize_lamports,
    )?;
    transfer_from_signer(
        &ctx.accounts.owner,
        &ctx.accounts.operator_revenue_vault.to_account_info(),
        &ctx.accounts.system_program,
        operator_lamports,
    )?;
    ctx.accounts.credit_vault.record_purchase(prize_lamports)?;
    ctx.accounts.operator_revenue_vault.gross_operator_share = checked_add_u64(
        ctx.accounts.operator_revenue_vault.gross_operator_share,
        operator_lamports,
    )?;
    ctx.accounts.player_state.record_kredit_purchase(count)?;
    emit!(KreditsPurchased {
        owner: ctx.accounts.owner.key(),
        kredit_count,
        prize_lamports,
        operator_lamports,
    });
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
    #[account(mut, seeds = [PLAYER_STATE_SEED, owner_authority.key().as_ref()], bump = player_state.bump,
        constraint = player_state.owner == owner_authority.key() @ ErrorCode::Unauthorized,
        constraint = player_state.schema_valid() @ ErrorCode::InvalidVersion)]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, current_daily.day_id.to_le_bytes().as_ref()], bump = current_daily.bump,
        constraint = current_daily.arcade_config == arcade_config.key() @ ErrorCode::InvalidOwner)]
    pub current_daily: Box<Account<'info, ArenaDaily>>,
    #[account(init_if_needed, payer = payer, space = 8 + ArenaPlayer::INIT_SPACE,
        seeds = [ARENA_PLAYER_SEED, current_daily.key().as_ref(), owner_authority.key().as_ref()], bump)]
    pub arena_player: Box<Account<'info, ArenaPlayer>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, following_daily.day_id.to_le_bytes().as_ref()], bump = following_daily.bump,
        constraint = following_daily.arcade_config == arcade_config.key() @ ErrorCode::InvalidOwner)]
    pub following_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [CREDIT_VAULT_SEED], bump = credit_vault.bump,
        constraint = credit_vault.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = credit_vault.protocol == protocol.key() @ ErrorCode::InvalidOwner)]
    pub credit_vault: Box<Account<'info, CreditVault>>,
    #[account(init, payer = payer, space = 8 + ActiveRun::INIT_SPACE,
        seeds = [ACTIVE_RUN_SEED, b"active", owner_authority.key().as_ref(), run_id.to_le_bytes().as_ref()], bump)]
    pub active_run: Box<Account<'info, ActiveRun>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Durable identity pinned by PlayerState and all player PDAs.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_enter_arena(
    ctx: Context<EnterArena>,
    run_id: u64,
    expected_entry_lamports: u64,
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
    require!(
        ctx.accounts.current_daily.day_id == day_id
            && valid_daily_successor(day_id, ctx.accounts.following_daily.day_id),
        ErrorCode::InvalidPeriod
    );
    require!(
        ctx.accounts.current_daily.status == PeriodStatus::Open
            && matches!(
                ctx.accounts.following_daily.status,
                PeriodStatus::Funding | PeriodStatus::Open
            )
            && now >= ctx.accounts.current_daily.opens_at
            && now < ctx.accounts.current_daily.entries_close_at,
        ErrorCode::ChallengeEnded
    );
    if ctx.accounts.arena_player.version == 0 {
        ctx.accounts.arena_player.set_inner(ArenaPlayer::initialize(
            ctx.accounts.current_daily.key(),
            ctx.accounts.owner_authority.key(),
            ctx.bumps.arena_player,
        ));
        ctx.accounts.current_daily.unique_players =
            checked_add_u32(ctx.accounts.current_daily.unique_players, 1)?;
    }
    require!(
        ctx.accounts.arena_player.version == ARCADE_ACCOUNT_VERSION
            && ctx.accounts.arena_player.challenge == ctx.accounts.current_daily.key()
            && ctx.accounts.arena_player.player == ctx.accounts.owner_authority.key()
            && ctx.accounts.arena_player.active_paid_run_id == 0,
        ErrorCode::InvalidOwner
    );
    require!(
        ctx.accounts.player_state.kredit_balance > 0,
        ErrorCode::InsufficientKredits
    );
    let split = zkube_core::split_arena_entry(expected_entry_lamports)
        .map_err(|_| error!(ErrorCode::AccountingInvariant))?;
    require!(
        split.next_daily_lamports == ENTRY_DAILY_LAMPORTS
            && split.operator_lamports == ENTRY_OPERATOR_LAMPORTS,
        ErrorCode::AccountingInvariant
    );
    require!(
        ctx.accounts.credit_vault.available_prize_lamports()? >= split.next_daily_lamports,
        ErrorCode::AccountingInvariant
    );
    require_spendable(
        &ctx.accounts.credit_vault.to_account_info(),
        split.next_daily_lamports,
    )?;
    move_program_lamports(
        &ctx.accounts.credit_vault.to_account_info(),
        &ctx.accounts.following_daily.to_account_info(),
        split.next_daily_lamports,
    )?;
    ctx.accounts
        .credit_vault
        .record_spend(split.next_daily_lamports)?;
    ctx.accounts
        .following_daily
        .ledger
        .add_entry(split.next_daily_lamports)?;
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
        ctx.accounts.owner_authority.key(),
        run_id,
        RunMode::Daily,
        ctx.accounts.current_daily.runs_close_at,
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
        constraint = player_state.owner == active_run.owner @ ErrorCode::Unauthorized,
        constraint = player_state.schema_valid() @ ErrorCode::InvalidVersion)]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump,
        constraint = arena_daily.key() == active_run.daily_challenge @ ErrorCode::InvalidOwner)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [ARENA_PLAYER_SEED, arena_daily.key().as_ref(), active_run.owner.as_ref()], bump = arena_player.bump,
        constraint = arena_player.player == active_run.owner @ ErrorCode::Unauthorized)]
    pub arena_player: Box<Account<'info, ArenaPlayer>>,
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
            score: active.daily_score,
            objective_total: active.objective_total,
            finalized_at: active.finished_at,
            replay_hash: active.replay_hash,
        };
        ctx.accounts.arena_daily.record_scored_entry(
            &mut ctx.accounts.arena_player,
            candidate,
            active.run_id,
        )?;
        ctx.accounts.arena_daily.entries_scored =
            checked_add_u64(ctx.accounts.arena_daily.entries_scored, 1)?;
        ctx.accounts.arena_player.resolved_entries =
            checked_add_u32(ctx.accounts.arena_player.resolved_entries, 1)?;
    }
    ctx.accounts.player_state.release_arcade_run(active.run_id)
}

#[derive(Accounts)]
#[instruction(run_id: u64)]
pub struct ExpireUnresolvedArenaRun<'info> {
    #[account(mut, seeds = [PLAYER_STATE_SEED, owner.key().as_ref()], bump = player_state.bump,
        constraint = player_state.owner == owner.key() @ ErrorCode::Unauthorized,
        constraint = player_state.schema_valid() @ ErrorCode::InvalidVersion)]
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
    require!(
        ctx.accounts.player_state.active_run_mode == RunMode::Daily,
        ErrorCode::InvalidState
    );
    let player = ctx
        .accounts
        .arena_player
        .as_deref_mut()
        .ok_or(ErrorCode::InvalidState)?;
    require!(player.active_paid_run_id == run_id, ErrorCode::InvalidRunId);
    ctx.accounts.arena_daily.record_expired_entry(player)?;
    player.active_paid_run_id = 0;
    ctx.accounts.player_state.expire_arcade_run(run_id)
}

#[derive(Accounts)]
pub struct CleanupOrphanActiveRun<'info> {
    #[account(mut, close = rent_recipient,
        seeds = [ACTIVE_RUN_SEED, b"active", active_run.owner.as_ref(), active_run.run_id.to_le_bytes().as_ref()],
        bump = active_run.bump, constraint = active_run.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion)]
    pub active_run: Box<Account<'info, ActiveRun>>,
    #[account(mut, seeds = [PLAYER_STATE_SEED, active_run.owner.as_ref()], bump = player_state.bump,
        constraint = player_state.owner == active_run.owner @ ErrorCode::Unauthorized,
        constraint = player_state.schema_valid() @ ErrorCode::InvalidVersion)]
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
#[instruction(score_payout_count: u32, theme_payout_count: u32)]
pub struct FinalizeArenaDaily<'info> {
    #[account(mut, seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, following_daily.day_id.to_le_bytes().as_ref()], bump = following_daily.bump,
        constraint = !following_daily.predecessor_rollover_applied @ ErrorCode::AlreadySubmitted)]
    pub following_daily: Box<Account<'info, ArenaDaily>>,
    #[account(
        init,
        payer = cadence_funding,
        space = ArenaBoard::account_space_for_init(score_payout_count),
        seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), DailyBoardKind::Score.seed()],
        bump
    )]
    pub score_board: Box<Account<'info, ArenaBoard>>,
    #[account(
        init,
        payer = cadence_funding,
        space = ArenaBoard::account_space_for_init(theme_payout_count),
        seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), DailyBoardKind::Theme.seed()],
        bump
    )]
    pub theme_board: Box<Account<'info, ArenaBoard>>,
    /// Canonical recyclable cadence-rent PDA. It can sign only through the
    /// narrow funded self-CPI wrapper.
    #[account(mut, seeds = [CADENCE_FUNDING_SEED], bump)]
    pub cadence_funding: Signer<'info>,
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_finalize_arena_daily(
    ctx: Context<FinalizeArenaDaily>,
    score_payout_count: u32,
    theme_payout_count: u32,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.arena_daily.status == PeriodStatus::Open
            && ctx.accounts.arena_daily.predecessor_rollover_applied
            && now >= ctx.accounts.arena_daily.runs_close_at
            && ctx.accounts.arena_daily.resolved(),
        ErrorCode::ChallengeNotEnded
    );
    require!(
        valid_daily_successor(
            ctx.accounts.arena_daily.day_id,
            ctx.accounts.following_daily.day_id,
        ),
        ErrorCode::InvalidPeriod
    );
    let source_info = ctx.accounts.arena_daily.to_account_info();
    let successor_info = ctx.accounts.following_daily.to_account_info();
    let score_info = ctx.accounts.score_board.to_account_info();
    let theme_info = ctx.accounts.theme_board.to_account_info();
    settle_daily_period(
        DailySettlementAccounts {
            source: &mut ctx.accounts.arena_daily,
            successor: &mut ctx.accounts.following_daily,
            score_board: &mut ctx.accounts.score_board,
            theme_board: &mut ctx.accounts.theme_board,
            source_info: &source_info,
            successor_info: &successor_info,
            score_info: &score_info,
            theme_info: &theme_info,
        },
        DailySettlementArgs {
            score_payout_count,
            theme_payout_count,
            score_bump: ctx.bumps.score_board,
            theme_bump: ctx.bumps.theme_board,
            finalized_at: now,
        },
    )
}

struct DailySettlementAccounts<'a, 'info> {
    source: &'a mut ArenaDaily,
    successor: &'a mut ArenaDaily,
    score_board: &'a mut ArenaBoard,
    theme_board: &'a mut ArenaBoard,
    source_info: &'a AccountInfo<'info>,
    successor_info: &'a AccountInfo<'info>,
    score_info: &'a AccountInfo<'info>,
    theme_info: &'a AccountInfo<'info>,
}

struct DailySettlementArgs {
    score_payout_count: u32,
    theme_payout_count: u32,
    score_bump: u8,
    theme_bump: u8,
    finalized_at: i64,
}

fn settle_daily_period(
    accounts: DailySettlementAccounts<'_, '_>,
    args: DailySettlementArgs,
) -> Result<()> {
    let DailySettlementAccounts {
        source,
        successor,
        score_board,
        theme_board,
        source_info,
        successor_info,
        score_info,
        theme_info,
    } = accounts;
    let DailySettlementArgs {
        score_payout_count,
        theme_payout_count,
        score_bump,
        theme_bump,
        finalized_at,
    } = args;
    require!(source.predecessor_rollover_applied, ErrorCode::InvalidState);
    let pool = source.ledger.available_lamports()?;
    require_spendable(source_info, pool)?;
    let pools = daily_board_pools(pool, source.theme_qualified_players);
    let score_plan = board_payout_plan(pools.score, source.score_qualified_players)?;
    let theme_plan = board_payout_plan(pools.theme, source.theme_qualified_players)?;
    require!(
        score_payout_count == score_plan.count
            && theme_payout_count == theme_plan.count
            && !source.claims_expired,
        ErrorCode::AccountingInvariant
    );
    let paid_lamports = score_plan
        .paid_lamports
        .checked_add(theme_plan.paid_lamports)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let rollover_lamports = score_plan
        .rollover_lamports
        .checked_add(theme_plan.rollover_lamports)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        paid_lamports.checked_add(rollover_lamports) == Some(pool),
        ErrorCode::AccountingInvariant
    );
    move_program_lamports(source_info, successor_info, rollover_lamports)?;
    source.ledger.settle(paid_lamports, rollover_lamports)?;
    successor.ledger.add_rollover(rollover_lamports)?;
    successor.predecessor_rollover_applied = true;
    initialize_arena_board(
        score_board,
        ArenaBoardInitialization {
            daily: source_info.key(),
            day_id: source.day_id,
            kind: DailyBoardKind::Score,
            qualified_count: source.score_qualified_players,
            pool_lamports: pools.score,
            plan: score_plan,
            bump: score_bump,
        },
    );
    initialize_arena_board(
        theme_board,
        ArenaBoardInitialization {
            daily: source_info.key(),
            day_id: source.day_id,
            kind: DailyBoardKind::Theme,
            qualified_count: source.theme_qualified_players,
            pool_lamports: pools.theme,
            plan: theme_plan,
            bump: theme_bump,
        },
    );
    require!(
        score_info.data_len() == ArenaBoard::account_space(score_plan.count)?
            && theme_info.data_len() == ArenaBoard::account_space(theme_plan.count)?,
        ErrorCode::AccountingInvariant
    );
    source.status = PeriodStatus::Finalized;
    source.finalized_at = finalized_at;
    Ok(())
}

#[derive(Accounts)]
#[instruction(kind: DailyBoardKind)]
pub struct SubmitArenaBoardChunk<'info> {
    #[account(
        seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()],
        bump = arena_daily.bump,
        constraint = arena_daily.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.status == PeriodStatus::Finalized @ ErrorCode::InvalidState
    )]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(
        mut,
        seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), kind.seed()],
        bump = arena_board.bump,
        constraint = arena_board.kind == kind @ ErrorCode::InvalidOwner,
        constraint = arena_board.arena_daily == arena_daily.key() @ ErrorCode::InvalidOwner
    )]
    pub arena_board: Box<Account<'info, ArenaBoard>>,
    pub caller: Signer<'info>,
}

pub fn handler_submit_arena_board_chunk<'info>(
    ctx: Context<'info, SubmitArenaBoardChunk<'info>>,
    kind: DailyBoardKind,
    entries: Vec<SubmittedBoardEntry>,
    seal: bool,
) -> Result<()> {
    require!(
        !ctx.accounts.arena_board.sealed
            && !entries.is_empty()
            && entries.len() <= ARENA_BOARD_CHUNK_CAPACITY
            && entries.len() == ctx.remaining_accounts.len(),
        ErrorCode::BoardIncomplete
    );
    let board_info = ctx.accounts.arena_board.to_account_info();
    ctx.accounts.arena_board.validate(
        ctx.accounts.arena_daily.key(),
        kind,
        board_info.data_len(),
    )?;
    let appended = u32::try_from(entries.len()).map_err(|_| ErrorCode::ArithmeticOverflow)?;
    let next_cursor = ctx
        .accounts
        .arena_board
        .cursor
        .checked_add(appended)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    verify_board_completion(next_cursor, ctx.accounts.arena_board.payout_count, seal)?;

    let mut previous = if ctx.accounts.arena_board.cursor == 0 {
        None
    } else {
        Some(read_board_entry(
            &board_info,
            ctx.accounts.arena_board.cursor - 1,
        )?)
    };
    for (offset, (submitted, source_info)) in entries
        .into_iter()
        .zip(ctx.remaining_accounts.iter())
        .enumerate()
    {
        require_keys_eq!(*source_info.owner, crate::ID, ErrorCode::InvalidOwner);
        let source = {
            let data = source_info.try_borrow_data()?;
            let mut bytes: &[u8] = &data;
            ArenaPlayer::try_deserialize(&mut bytes)?
        };
        let (expected_key, _) = Pubkey::find_program_address(
            &[
                ARENA_PLAYER_SEED,
                ctx.accounts.arena_daily.key().as_ref(),
                source.player.as_ref(),
            ],
            &crate::ID,
        );
        require_keys_eq!(source_info.key(), expected_key, ErrorCode::InvalidOwner);
        require!(
            source.version == ARCADE_ACCOUNT_VERSION
                && source.challenge == ctx.accounts.arena_daily.key()
                && source.resolved(),
            ErrorCode::InvalidState
        );
        let entry = verify_submitted_board_entry(kind, submitted, &source)?;
        if let Some(prior) = previous {
            verify_next_board_entry(kind, &prior, &entry)?;
        }
        let position = ctx
            .accounts
            .arena_board
            .cursor
            .checked_add(u32::try_from(offset).map_err(|_| ErrorCode::ArithmeticOverflow)?)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        write_board_entry(&board_info, position, &entry)?;
        previous = Some(entry);
    }
    ctx.accounts.arena_board.cursor = next_cursor;
    if seal {
        ctx.accounts.arena_board.sealed = true;
    }
    Ok(())
}

#[derive(Accounts)]
#[instruction(board: DailyBoardKind)]
pub struct ClaimDailyPrize<'info> {
    #[account(
        mut,
        seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()],
        bump = arena_daily.bump,
        constraint = arena_daily.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.status == PeriodStatus::Finalized @ ErrorCode::InvalidState
    )]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(
        mut,
        seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), board.seed()],
        bump = arena_board.bump,
        constraint = arena_board.arena_daily == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = arena_board.kind == board @ ErrorCode::InvalidOwner
    )]
    pub arena_board: Box<Account<'info, ArenaBoard>>,
    #[account(
        seeds = [PLAYER_STATE_SEED, owner_authority.key().as_ref()],
        bump = player_state.bump,
        constraint = player_state.schema_valid() @ ErrorCode::InvalidVersion,
        constraint = player_state.owner == owner_authority.key() @ ErrorCode::Unauthorized
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
    /// CHECK: Durable wallet identity and the only reward destination.
    #[account(mut)]
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
}

pub fn handler_claim_daily_prize(
    ctx: Context<ClaimDailyPrize>,
    board: DailyBoardKind,
) -> Result<()> {
    require_player_authorization(
        ctx.accounts.owner_authority.key(),
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    let now = Clock::get()?.unix_timestamp;
    require!(
        !ctx.accounts.arena_daily.claims_expired
            && now < daily_claim_deadline(ctx.accounts.arena_daily.finalized_at)?,
        ErrorCode::ClaimWindowClosed
    );
    let board_info = ctx.accounts.arena_board.to_account_info();
    validate_finalized_board(
        &ctx.accounts.arena_daily,
        ctx.accounts.arena_daily.key(),
        &ctx.accounts.arena_board,
        board_info.data_len(),
        board,
    )?;
    let prize = ranked_prize(
        &ctx.accounts.arena_board,
        &board_info,
        ctx.accounts.owner_authority.key(),
    )?;
    require!(
        !board_bitmap_is_set(
            &board_info,
            &ctx.accounts.arena_board,
            BoardBitmap::Claimed,
            prize.position,
        )?,
        ErrorCode::PrizeAlreadyClaimed
    );
    let source = ctx.accounts.arena_daily.to_account_info();
    let destination = ctx.accounts.owner_authority.to_account_info();
    validate_wallet(&destination, ctx.accounts.player_state.owner)?;
    require_spendable(&source, prize.amount)?;
    move_program_lamports(&source, &destination, prize.amount)?;
    set_board_bitmap(
        &board_info,
        &ctx.accounts.arena_board,
        BoardBitmap::Claimed,
        prize.position,
    )?;
    ctx.accounts.arena_board.claimed_lamports = ctx
        .accounts
        .arena_board
        .claimed_lamports
        .checked_add(prize.amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    ctx.accounts.arena_board.claimed_count = ctx
        .accounts
        .arena_board
        .claimed_count
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    emit!(DailyPrizeClaimed {
        owner: ctx.accounts.player_state.owner,
        day_id: ctx.accounts.arena_daily.day_id,
        board,
        rank: prize.rank,
        reward_lamports: prize.amount,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ExpireDailyClaims<'info> {
    #[account(
        seeds = [ARCADE_ARCHIVE_SEED],
        bump = arcade_archive.bump,
        constraint = arcade_archive.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arcade_archive.arcade_config == arcade_config.key() @ ErrorCode::InvalidOwner
    )]
    pub arcade_archive: Box<Account<'info, ArcadeArchive>>,
    #[account(
        seeds = [ARCADE_CONFIG_SEED],
        bump = arcade_config.bump,
        constraint = arcade_config.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arcade_config.rules_catalog == daily_rules_catalog.key() @ ErrorCode::InvalidOwner
    )]
    pub arcade_config: Box<Account<'info, ArcadeConfig>>,
    pub daily_rules_catalog: Box<Account<'info, DailyRulesCatalog>>,
    #[account(
        mut,
        seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()],
        bump = arena_daily.bump,
        constraint = arena_daily.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.arcade_config == arcade_config.key() @ ErrorCode::InvalidOwner,
        constraint = arena_daily.status == PeriodStatus::Finalized @ ErrorCode::InvalidState,
        constraint = arcade_archive.last_daily_id >= arena_daily.day_id @ ErrorCode::InvalidState
    )]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(
        seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), DailyBoardKind::Score.seed()],
        bump = score_board.bump,
        constraint = score_board.arena_daily == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = score_board.kind == DailyBoardKind::Score @ ErrorCode::InvalidOwner
    )]
    pub score_board: Box<Account<'info, ArenaBoard>>,
    #[account(
        seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), DailyBoardKind::Theme.seed()],
        bump = theme_board.bump,
        constraint = theme_board.arena_daily == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = theme_board.kind == DailyBoardKind::Theme @ ErrorCode::InvalidOwner
    )]
    pub theme_board: Box<Account<'info, ArenaBoard>>,
    #[account(
        mut,
        seeds = [ARENA_DAILY_SEED, following_daily.day_id.to_le_bytes().as_ref()],
        bump = following_daily.bump,
        constraint = following_daily.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = following_daily.arcade_config == arcade_config.key() @ ErrorCode::InvalidOwner,
        constraint = matches!(following_daily.status, PeriodStatus::Funding | PeriodStatus::Open) @ ErrorCode::InvalidState
    )]
    pub following_daily: Box<Account<'info, ArenaDaily>>,
    pub caller: Signer<'info>,
}

pub fn handler_expire_daily_claims(ctx: Context<ExpireDailyClaims>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        !ctx.accounts.arena_daily.claims_expired,
        ErrorCode::AlreadySubmitted
    );
    require!(
        now >= daily_claim_deadline(ctx.accounts.arena_daily.finalized_at)?,
        ErrorCode::ClaimWindowOpen
    );
    let current_day = day_id_at(now)?;
    require!(
        ctx.accounts.following_daily.day_id
            == next_scheduled_daily(&ctx.accounts.daily_rules_catalog, current_day)?,
        ErrorCode::InvalidPeriod
    );
    let score_info = ctx.accounts.score_board.to_account_info();
    let theme_info = ctx.accounts.theme_board.to_account_info();
    validate_finalized_board(
        &ctx.accounts.arena_daily,
        ctx.accounts.arena_daily.key(),
        &ctx.accounts.score_board,
        score_info.data_len(),
        DailyBoardKind::Score,
    )?;
    validate_finalized_board(
        &ctx.accounts.arena_daily,
        ctx.accounts.arena_daily.key(),
        &ctx.accounts.theme_board,
        theme_info.data_len(),
        DailyBoardKind::Theme,
    )?;
    require!(
        ctx.accounts.score_board.sealed
            && ctx.accounts.theme_board.sealed
            && ctx.accounts.score_board.claimed_lamports <= ctx.accounts.score_board.paid_lamports
            && ctx.accounts.theme_board.claimed_lamports <= ctx.accounts.theme_board.paid_lamports,
        ErrorCode::BoardIncomplete
    );
    let claimed = ctx
        .accounts
        .score_board
        .claimed_lamports
        .checked_add(ctx.accounts.theme_board.claimed_lamports)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let expired = ctx
        .accounts
        .arena_daily
        .ledger
        .payout_lamports
        .checked_sub(claimed)
        .ok_or(ErrorCode::AccountingInvariant)?;
    require!(
        claimed.checked_add(expired).and_then(
            |value| value.checked_add(ctx.accounts.arena_daily.ledger.rollover_out_lamports)
        ) == Some(ctx.accounts.arena_daily.ledger.funded_lamports()?),
        ErrorCode::AccountingInvariant
    );
    let source = ctx.accounts.arena_daily.to_account_info();
    let successor = ctx.accounts.following_daily.to_account_info();
    require_spendable(&source, expired)?;
    move_program_lamports(&source, &successor, expired)?;
    ctx.accounts.following_daily.ledger.add_rollover(expired)?;
    ctx.accounts.arena_daily.claims_expired = true;
    emit!(DailyClaimsExpired {
        day_id: ctx.accounts.arena_daily.day_id,
        claimed_lamports: claimed,
        expired_lamports: expired,
        rollover_lamports: ctx.accounts.arena_daily.ledger.rollover_out_lamports,
        following_day_id: ctx.accounts.following_daily.day_id,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ArchiveArenaDaily<'info> {
    #[account(
        mut,
        seeds = [ARCADE_ARCHIVE_SEED],
        bump = arcade_archive.bump,
        constraint = arcade_archive.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub arcade_archive: Box<Account<'info, ArcadeArchive>>,
    #[account(
        seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()],
        bump = arena_daily.bump,
        constraint = arena_daily.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.arcade_config == arcade_archive.arcade_config @ ErrorCode::InvalidOwner,
        constraint = arena_daily.status == PeriodStatus::Finalized @ ErrorCode::InvalidState
    )]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(
        seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), DailyBoardKind::Score.seed()],
        bump = score_board.bump,
        constraint = score_board.arena_daily == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = score_board.kind == DailyBoardKind::Score @ ErrorCode::InvalidOwner
    )]
    pub score_board: Box<Account<'info, ArenaBoard>>,
    #[account(
        seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), DailyBoardKind::Theme.seed()],
        bump = theme_board.bump,
        constraint = theme_board.arena_daily == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = theme_board.kind == DailyBoardKind::Theme @ ErrorCode::InvalidOwner
    )]
    pub theme_board: Box<Account<'info, ArenaBoard>>,
    pub caller: Signer<'info>,
}

pub fn handler_archive_arena_daily(ctx: Context<ArchiveArenaDaily>) -> Result<()> {
    require!(ctx.accounts.arena_daily.resolved(), ErrorCode::InvalidState);
    let score_info = ctx.accounts.score_board.to_account_info();
    let theme_info = ctx.accounts.theme_board.to_account_info();
    validate_finalized_board(
        &ctx.accounts.arena_daily,
        ctx.accounts.arena_daily.key(),
        &ctx.accounts.score_board,
        score_info.data_len(),
        DailyBoardKind::Score,
    )?;
    validate_finalized_board(
        &ctx.accounts.arena_daily,
        ctx.accounts.arena_daily.key(),
        &ctx.accounts.theme_board,
        theme_info.data_len(),
        DailyBoardKind::Theme,
    )?;
    let result_hash = daily_result_hash(
        &ctx.accounts.arena_daily,
        &ctx.accounts.score_board,
        &score_info,
        &ctx.accounts.theme_board,
        &theme_info,
    )?;
    ctx.accounts
        .arcade_archive
        .append_daily(ctx.accounts.arena_daily.day_id, result_hash)?;
    emit!(CadenceArchived {
        period_id: ctx.accounts.arena_daily.day_id,
        result_hash,
        root: ctx.accounts.arcade_archive.daily_root,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CloseArenaDaily<'info> {
    #[account(
        seeds = [ARCADE_ARCHIVE_SEED],
        bump = arcade_archive.bump,
        constraint = arcade_archive.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub arcade_archive: Box<Account<'info, ArcadeArchive>>,
    #[account(
        mut,
        close = cadence_funding,
        seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()],
        bump = arena_daily.bump,
        constraint = arena_daily.version == ARCADE_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.arcade_config == arcade_archive.arcade_config @ ErrorCode::InvalidOwner,
        constraint = arena_daily.status == PeriodStatus::Finalized @ ErrorCode::InvalidState,
        constraint = arcade_archive.last_daily_id >= arena_daily.day_id @ ErrorCode::InvalidState
    )]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(
        mut,
        close = cadence_funding,
        seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), DailyBoardKind::Score.seed()],
        bump = score_board.bump,
        constraint = score_board.arena_daily == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = score_board.kind == DailyBoardKind::Score @ ErrorCode::InvalidOwner
    )]
    pub score_board: Box<Account<'info, ArenaBoard>>,
    #[account(
        mut,
        close = cadence_funding,
        seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), DailyBoardKind::Theme.seed()],
        bump = theme_board.bump,
        constraint = theme_board.arena_daily == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = theme_board.kind == DailyBoardKind::Theme @ ErrorCode::InvalidOwner
    )]
    pub theme_board: Box<Account<'info, ArenaBoard>>,
    /// CHECK: The only destination for cadence-account rent. It is a
    /// canonical System-owned zero-data PDA and exposes no withdrawal path.
    #[account(
        mut,
        seeds = [CADENCE_FUNDING_SEED],
        bump,
        owner = system_program::ID @ ErrorCode::InvalidOwner,
        constraint = cadence_funding.data_is_empty() @ ErrorCode::InvalidOwner
    )]
    pub cadence_funding: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
}

pub fn handler_close_arena_daily(ctx: Context<CloseArenaDaily>) -> Result<()> {
    let daily = &ctx.accounts.arena_daily;
    let score_info = ctx.accounts.score_board.to_account_info();
    let theme_info = ctx.accounts.theme_board.to_account_info();
    validate_finalized_board(
        daily,
        ctx.accounts.arena_daily.key(),
        &ctx.accounts.score_board,
        score_info.data_len(),
        DailyBoardKind::Score,
    )?;
    validate_finalized_board(
        daily,
        ctx.accounts.arena_daily.key(),
        &ctx.accounts.theme_board,
        theme_info.data_len(),
        DailyBoardKind::Theme,
    )?;
    require!(
        daily.resolved()
            && daily.claims_expired
            && Clock::get()?.unix_timestamp >= daily_claim_deadline(daily.finalized_at)?
            && ctx.accounts.score_board.sealed
            && ctx.accounts.theme_board.sealed
            && ctx.accounts.score_board.profile_sync_count == ctx.accounts.score_board.payout_count
            && ctx.accounts.theme_board.profile_sync_count == ctx.accounts.theme_board.payout_count,
        ErrorCode::InvalidState
    );
    Ok(())
}

#[event]
pub struct CadenceArchived {
    pub period_id: u32,
    pub result_hash: [u8; 32],
    pub root: [u8; 32],
}

#[event]
pub struct DailyPrizeClaimed {
    pub owner: Pubkey,
    pub day_id: u32,
    pub board: DailyBoardKind,
    pub rank: u16,
    pub reward_lamports: u64,
}

#[event]
pub struct DailyClaimsExpired {
    pub day_id: u32,
    pub claimed_lamports: u64,
    pub expired_lamports: u64,
    pub rollover_lamports: u64,
    pub following_day_id: u32,
}

#[event]
pub struct PrizePoolFunded {
    pub period_id: u32,
    pub authority: Pubkey,
    pub lamports: u64,
}

#[event]
pub struct KreditsPurchased {
    pub owner: Pubkey,
    pub kredit_count: u32,
    pub prize_lamports: u64,
    pub operator_lamports: u64,
}

#[derive(Accounts)]
pub struct CloseArenaPlayer<'info> {
    /// CHECK: Must be either the live, finalized parent Daily or its canonical
    /// closed System placeholder.
    pub arena_daily: UncheckedAccount<'info>,
    #[account(mut, close = rent_recipient,
        seeds = [ARENA_PLAYER_SEED, arena_player.challenge.as_ref(), arena_player.player.as_ref()], bump = arena_player.bump,
        constraint = arena_player.active_paid_run_id == 0 @ ErrorCode::ActiveRunExists,
        constraint = arena_player.resolved() @ ErrorCode::InvalidState)]
    pub arena_player: Box<Account<'info, ArenaPlayer>>,
    /// CHECK: Canonical player funding PDA receives recycled rent.
    #[account(mut, seeds = [PLAYER_FUNDING_SEED, arena_player.player.as_ref()], bump,
        owner = system_program::ID @ ErrorCode::InvalidOwner,
        constraint = rent_recipient.data_is_empty() @ ErrorCode::InvalidOwner)]
    pub rent_recipient: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
}

pub fn handler_close_arena_player(ctx: Context<CloseArenaPlayer>) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.arena_daily.key(),
        ctx.accounts.arena_player.challenge,
        ErrorCode::InvalidOwner
    );
    validate_live_or_closed_daily(&ctx.accounts.arena_daily.to_account_info())
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

fn daily_level_rules(entry: DailyPoolEntry, pressure: DailyPressureProfile) -> LevelRuleSnapshot {
    LevelRuleSnapshot {
        level: 1,
        points_required: u32::MAX,
        max_moves: pressure.max_moves,
        difficulty: 0,
        primary: ConstraintSnapshot::default(),
        secondary: ConstraintSnapshot::default(),
        active_mutator_id: entry.active_mutator_id,
        passive_mutator_id: entry.passive_mutator_id,
        boss_id: 0,
        block_weights: pressure.block_weights[0],
        score_multiplier_x100: entry.score_multiplier_x100,
        combo_multiplier_x100: entry.combo_multiplier_x100,
        line_clear_bonus: entry.line_clear_bonus,
        perfect_clear_bonus: entry.perfect_clear_bonus,
        star_threshold_modifier: 128,
        bonus_type: entry.bonus_type,
        bonus_trigger_type: entry.bonus_trigger_type,
        bonus_threshold: entry.bonus_threshold,
        starting_charges: entry.starting_charges,
        starting_rows: entry.starting_rows,
    }
}

fn validate_daily_pool_entry(
    entry: DailyPoolEntry,
    realm: &CampaignMapRuleSnapshot,
    passive: &CampaignMapRuleSnapshot,
) -> Result<()> {
    if entry.realm_map_id > 0 {
        require!(
            entry.active_mutator_id == realm.active_mutator_id
                && entry.bonus_type == realm.bonus_type
                && entry.bonus_trigger_type == realm.bonus_trigger_type
                && entry.bonus_threshold == realm.bonus_threshold
                && entry.starting_charges == realm.starting_charges
                && entry.starting_rows == realm.starting_rows,
            ErrorCode::InvalidMap
        );
    }
    require!(
        entry.passive_mutator_id == passive.passive_mutator_id
            && entry.score_multiplier_x100 == passive.score_multiplier_x100
            && entry.combo_multiplier_x100 == passive.combo_multiplier_x100
            && entry.line_clear_bonus == passive.line_clear_bonus
            && entry.perfect_clear_bonus == passive.perfect_clear_bonus,
        ErrorCode::InvalidMap
    );
    Ok(())
}

fn validate_daily_map_catalog(
    catalog: &Account<'_, MapCatalog>,
    expected_map_id: u8,
    content_version: u32,
) -> Result<()> {
    require!(
        catalog.version == ACCOUNT_VERSION
            && catalog.content_version == content_version
            && catalog.map_id == expected_map_id
            && catalog.enabled,
        ErrorCode::InvalidMap
    );
    let (expected, bump) = Pubkey::find_program_address(
        &[
            MAP_CATALOG_SEED,
            &content_version.to_le_bytes(),
            &[expected_map_id],
        ],
        &crate::ID,
    );
    require_keys_eq!(catalog.key(), expected, ErrorCode::InvalidMap);
    require!(catalog.bump == bump, ErrorCode::InvalidMap);
    Ok(())
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

fn validate_live_or_closed_daily(account: &AccountInfo<'_>) -> Result<()> {
    if *account.owner == system_program::ID && account.data_is_empty() {
        return Ok(());
    }
    require_keys_eq!(*account.owner, crate::ID, ErrorCode::InvalidOwner);
    require!(
        account.data_len() == 8 + ArenaDaily::INIT_SPACE,
        ErrorCode::InvalidOwner
    );
    let data = account.try_borrow_data()?;
    let mut bytes = data.as_ref();
    let daily = ArenaDaily::try_deserialize(&mut bytes)?;
    require!(
        daily.version == ARCADE_ACCOUNT_VERSION && daily.status == PeriodStatus::Finalized,
        ErrorCode::InvalidState
    );
    Ok(())
}

fn checked_add_u64(left: u64, right: u64) -> Result<u64> {
    left.checked_add(right)
        .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
}

pub(crate) fn prepare_period_is_allowed(
    requested: u32,
    current: u32,
    launch_seeded: bool,
    launch: u32,
    starts_day: u32,
    pool_entry_count: u8,
) -> bool {
    if pool_entry_count == 0 || requested < starts_day {
        return false;
    }
    let first = current.max(starts_day);
    let Some(following) = first.checked_add(1) else {
        return false;
    };
    let in_live_window = requested <= current || requested == first || requested == following;
    if launch_seeded {
        requested >= launch && in_live_window
    } else {
        requested == first || requested == following
    }
}

fn top_up_period_is_allowed(requested: u32, current: u32, catalog: &DailyRulesCatalog) -> bool {
    scheduled_daily_window(catalog, current)
        .is_ok_and(|(first, following)| requested == first || requested == following)
}

fn arena_rules_staging_is_allowed(
    active_content_version: u32,
    requested_content_version: u32,
    paused: bool,
) -> bool {
    requested_content_version == active_content_version || paused
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
        assert!(prepare_period_is_allowed(100, 104, true, 100, 100, 1));
        assert!(prepare_period_is_allowed(104, 104, true, 100, 100, 1));
        assert!(prepare_period_is_allowed(105, 104, true, 100, 100, 1));
        assert!(!prepare_period_is_allowed(99, 104, true, 100, 100, 1));
        assert!(!prepare_period_is_allowed(106, 104, true, 100, 100, 1));
    }

    #[test]
    fn prelaunch_preparation_remains_current_or_successor_only() {
        assert!(prepare_period_is_allowed(104, 104, false, 0, 104, 1));
        assert!(prepare_period_is_allowed(105, 104, false, 0, 104, 1));
        assert!(!prepare_period_is_allowed(103, 104, false, 0, 104, 1));
        assert!(!prepare_period_is_allowed(106, 104, false, 0, 104, 1));
    }

    #[test]
    fn future_arena_rules_can_only_be_staged_while_paused() {
        assert!(arena_rules_staging_is_allowed(7, 7, false));
        assert!(arena_rules_staging_is_allowed(7, 8, true));
        assert!(!arena_rules_staging_is_allowed(7, 8, false));
    }
}
