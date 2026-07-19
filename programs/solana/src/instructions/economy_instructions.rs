//! Cube sales, free Campaign progression, Daily/Weekly contests, and settlement.
//!
//! Cubes are non-transferable counters. A Cube purchase is always owner-signed
//! and transfers native SOL atomically before crediting Cubes: 20% team, 40%
//! active-weekly pot, and 40% treasury. Session authorization never reaches
//! this custody boundary.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};
use session_keys::SessionTokenV2;

use crate::error::ErrorCode;
use crate::game::sha256v;
use crate::instructions::player_authorization::{
    require_player_authorization, require_player_rent_payer,
};
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeEconomyArgs {
    pub daily_rules_version: u32,
}

#[derive(Accounts)]
#[instruction(args: InitializeEconomyArgs)]
pub struct InitializeEconomy<'info> {
    #[account(
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused,
        constraint = protocol.content_version > 0 @ ErrorCode::ContentVersionMismatch
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        init,
        payer = authority,
        space = 8 + EconomyConfig::INIT_SPACE,
        seeds = [ECONOMY_CONFIG_SEED],
        bump
    )]
    pub economy_config: Box<Account<'info, EconomyConfig>>,
    #[account(
        init,
        payer = authority,
        space = 8 + CubeSalesLedger::INIT_SPACE,
        seeds = [CUBE_SALES_LEDGER_SEED],
        bump
    )]
    pub cube_sales_ledger: Box<Account<'info, CubeSalesLedger>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_initialize_economy(
    ctx: Context<InitializeEconomy>,
    args: InitializeEconomyArgs,
) -> Result<()> {
    require!(args.daily_rules_version > 0, ErrorCode::InvalidState);
    let config = EconomyConfig::canonical(
        ctx.accounts.protocol.key(),
        ctx.accounts.protocol.content_version,
        args.daily_rules_version,
        ctx.bumps.economy_config,
    );
    config.validate()?;
    ctx.accounts.economy_config.set_inner(config);
    ctx.accounts.cube_sales_ledger.set_inner(CubeSalesLedger {
        version: ECONOMY_ACCOUNT_VERSION,
        economy_config: ctx.accounts.economy_config.key(),
        lifetime_gross_sales: 0,
        lifetime_team_share: 0,
        lifetime_reward_share: 0,
        lifetime_treasury_share: 0,
        lifetime_cubes_sold: 0,
        purchase_count: 0,
        bump: ctx.bumps.cube_sales_ledger,
    });
    emit!(EconomyConfigured {
        economy_config: ctx.accounts.economy_config.key(),
        content_version: ctx.accounts.protocol.content_version,
        daily_rules_version: args.daily_rules_version,
    });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateRegularPricesArgs {
    pub prices: [u64; CUBE_PACK_COUNT],
    pub enabled: [bool; CUBE_PACK_COUNT],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateCubePacksArgs {
    pub cubes: [u64; CUBE_PACK_COUNT],
    pub prices: [u64; CUBE_PACK_COUNT],
    pub enabled: [bool; CUBE_PACK_COUNT],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScheduleRevenueSplitArgs {
    pub team_bps: u16,
    pub pot_bps: u16,
    pub treasury_bps: u16,
    pub activates_weekly: u32,
}

#[derive(Accounts)]
pub struct ManageEconomyPricing<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = protocol.pricing_operator == pricing_operator.key() @ ErrorCode::Unauthorized
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [ECONOMY_CONFIG_SEED],
        bump = economy_config.bump,
        constraint = economy_config.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = economy_config.version == ECONOMY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub economy_config: Box<Account<'info, EconomyConfig>>,
    pub pricing_operator: Signer<'info>,
}

pub fn handler_update_regular_prices(
    ctx: Context<ManageEconomyPricing>,
    args: UpdateRegularPricesArgs,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let sale_is_active =
        ctx.accounts.economy_config.sale_enabled && now < ctx.accounts.economy_config.sale_ends_at;
    require!(!sale_is_active, ErrorCode::InvalidState);
    ctx.accounts.economy_config.cube_pack_prices = args.prices;
    ctx.accounts.economy_config.cube_pack_enabled = args.enabled;
    ctx.accounts.economy_config.revision = ctx
        .accounts
        .economy_config
        .revision
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    ctx.accounts.economy_config.validate()?;
    emit!(EconomyPricesUpdated {
        revision: ctx.accounts.economy_config.revision,
        prices: args.prices,
        enabled: args.enabled,
    });
    Ok(())
}

pub fn handler_update_cube_packs(
    ctx: Context<ManageEconomyPricing>,
    args: UpdateCubePacksArgs,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let sale_is_active =
        ctx.accounts.economy_config.sale_enabled && now < ctx.accounts.economy_config.sale_ends_at;
    require!(!sale_is_active, ErrorCode::InvalidState);
    validate_cube_packs(args.cubes, args.prices, args.enabled)?;
    ctx.accounts.economy_config.cube_pack_cubes = args.cubes;
    ctx.accounts.economy_config.cube_pack_prices = args.prices;
    ctx.accounts.economy_config.cube_pack_enabled = args.enabled;
    ctx.accounts.economy_config.revision = ctx
        .accounts
        .economy_config
        .revision
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    ctx.accounts.economy_config.validate()?;
    emit!(EconomyCubePacksUpdated {
        revision: ctx.accounts.economy_config.revision,
        cubes: args.cubes,
        prices: args.prices,
        enabled: args.enabled,
    });
    Ok(())
}

pub fn handler_schedule_revenue_split(
    ctx: Context<ManageEconomyPricing>,
    args: ScheduleRevenueSplitArgs,
) -> Result<()> {
    validate_sale_split(args.team_bps, args.pot_bps, args.treasury_bps)?;
    let current_weekly = weekly_id_for_day(cadence_day(Clock::get()?.unix_timestamp));
    require!(
        args.activates_weekly >= current_weekly.saturating_add(1),
        ErrorCode::InvalidState
    );
    let current = ctx
        .accounts
        .economy_config
        .sale_bps_for_weekly(current_weekly);
    let config = &mut ctx.accounts.economy_config;
    config.team_sale_bps = current.0;
    config.pot_sale_bps = current.1;
    config.treasury_sale_bps = current.2;
    config.pending_team_sale_bps = args.team_bps;
    config.pending_pot_sale_bps = args.pot_bps;
    config.pending_treasury_sale_bps = args.treasury_bps;
    config.split_activates_weekly = args.activates_weekly;
    config.revision = config
        .revision
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    config.validate()?;
    emit!(RevenueSplitScheduled {
        revision: config.revision,
        activates_weekly: args.activates_weekly,
        team_bps: args.team_bps,
        pot_bps: args.pot_bps,
        treasury_bps: args.treasury_bps,
    });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScheduleSaleArgs {
    pub starts_at: i64,
    pub ends_at: i64,
    pub prices: [u64; CUBE_PACK_COUNT],
}

pub fn handler_schedule_sale(
    ctx: Context<ManageEconomyPricing>,
    args: ScheduleSaleArgs,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        args.starts_at < args.ends_at && args.ends_at > now,
        ErrorCode::InvalidState
    );
    require!(
        !ctx.accounts.economy_config.sale_enabled
            || now >= ctx.accounts.economy_config.sale_ends_at,
        ErrorCode::InvalidState
    );
    ctx.accounts.economy_config.sale_enabled = true;
    ctx.accounts.economy_config.sale_starts_at = args.starts_at;
    ctx.accounts.economy_config.sale_ends_at = args.ends_at;
    ctx.accounts.economy_config.sale_prices = args.prices;
    ctx.accounts.economy_config.revision = ctx
        .accounts
        .economy_config
        .revision
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    ctx.accounts.economy_config.validate()?;
    emit!(EconomySaleScheduled {
        revision: ctx.accounts.economy_config.revision,
        starts_at: args.starts_at,
        ends_at: args.ends_at,
        prices: args.prices,
    });
    Ok(())
}

pub fn handler_cancel_sale(ctx: Context<ManageEconomyPricing>) -> Result<()> {
    require!(
        ctx.accounts.economy_config.sale_enabled,
        ErrorCode::InvalidState
    );
    ctx.accounts.economy_config.sale_enabled = false;
    ctx.accounts.economy_config.sale_starts_at = 0;
    ctx.accounts.economy_config.sale_ends_at = 0;
    ctx.accounts.economy_config.sale_prices = [0; CUBE_PACK_COUNT];
    ctx.accounts.economy_config.revision = ctx
        .accounts
        .economy_config
        .revision
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    emit!(EconomySaleCancelled {
        revision: ctx.accounts.economy_config.revision,
    });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PublishDailyRulesArgs {
    pub content_version: u32,
    pub rules_version: u32,
    pub weekly_id: u32,
    pub starts_day: u32,
    pub weekly_seed: [u8; 32],
    pub scoring_rule_count: u8,
    pub scoring_rules: [DailyScoringRule; DAILY_SCORE_RULE_CAPACITY],
    pub pressure: DailyPressureProfile,
}

#[derive(Accounts)]
#[instruction(args: PublishDailyRulesArgs)]
pub struct PublishDailyRules<'info> {
    #[account(
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [ECONOMY_CONFIG_SEED],
        bump = economy_config.bump,
        constraint = economy_config.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = economy_config.version == ECONOMY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = economy_config.content_version == protocol.content_version @ ErrorCode::ContentVersionMismatch
    )]
    pub economy_config: Box<Account<'info, EconomyConfig>>,
    #[account(
        init,
        payer = authority,
        space = 8 + DailyRulesCatalog::INIT_SPACE,
        seeds = [DAILY_RULES_CATALOG_SEED, args.rules_version.to_le_bytes().as_ref()],
        bump
    )]
    pub daily_rules_catalog: Box<Account<'info, DailyRulesCatalog>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_publish_daily_rules(
    ctx: Context<PublishDailyRules>,
    args: PublishDailyRulesArgs,
) -> Result<()> {
    let current_release = args.content_version == ctx.accounts.economy_config.content_version
        && args.rules_version == ctx.accounts.economy_config.daily_rules_version;
    let future_release = args.content_version > ctx.accounts.economy_config.content_version
        && args.rules_version > ctx.accounts.economy_config.daily_rules_version;
    require!(
        current_release || future_release,
        ErrorCode::ContentVersionMismatch
    );
    if current_release {
        require!(!ctx.accounts.protocol.paused, ErrorCode::ProtocolPaused);
    }
    validate_daily_rules(&args)?;
    let catalog_hash = hash_daily_rules(&args)?;
    ctx.accounts
        .daily_rules_catalog
        .set_inner(DailyRulesCatalog {
            version: ECONOMY_ACCOUNT_VERSION,
            rules_version: args.rules_version,
            economy_config: ctx.accounts.economy_config.key(),
            content_version: args.content_version,
            catalog_hash,
            weekly_id: args.weekly_id,
            starts_day: args.starts_day,
            weekly_seed: args.weekly_seed,
            scoring_rule_count: args.scoring_rule_count,
            scoring_rules: args.scoring_rules,
            pressure: args.pressure,
            bump: ctx.bumps.daily_rules_catalog,
        });
    emit!(DailyRulesPublished {
        catalog: ctx.accounts.daily_rules_catalog.key(),
        rules_version: args.rules_version,
        catalog_hash,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct PurchaseCubes<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [ECONOMY_CONFIG_SEED],
        bump = economy_config.bump,
        constraint = economy_config.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = economy_config.version == ECONOMY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = economy_config.content_version == protocol.content_version @ ErrorCode::ContentVersionMismatch
    )]
    pub economy_config: Box<Account<'info, EconomyConfig>>,
    #[account(
        mut,
        seeds = [CUBE_SALES_LEDGER_SEED],
        bump = cube_sales_ledger.bump,
        constraint = cube_sales_ledger.economy_config == economy_config.key() @ ErrorCode::InvalidOwner,
        constraint = cube_sales_ledger.version == ECONOMY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub cube_sales_ledger: Box<Account<'info, CubeSalesLedger>>,
    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, owner.key().as_ref()],
        bump = player_state.bump,
        has_one = owner @ ErrorCode::Unauthorized,
        constraint = player_state.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
    /// CHECK: Native-SOL destination pinned by protocol state.
    #[account(mut, address = protocol.team_destination)]
    pub team_destination: UncheckedAccount<'info>,
    #[account(
        mut,
        address = protocol.reward_vault,
        seeds = [REWARD_VAULT_SEED],
        bump = reward_vault.bump,
        constraint = reward_vault.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = reward_vault.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub reward_vault: Box<Account<'info, RewardVault>>,
    #[account(mut)]
    pub weekly_challenge: Option<Box<Account<'info, WeeklyChallenge>>>,
    /// CHECK: Native-SOL destination pinned by protocol state.
    #[account(mut, address = protocol.treasury_destination)]
    pub treasury_destination: UncheckedAccount<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_purchase_cubes<'info>(
    ctx: Context<'info, PurchaseCubes<'info>>,
    pack_index: u8,
    expected_cubes: u64,
    expected_lamports: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let (cubes, gross) = ctx.accounts.economy_config.quote(pack_index, now)?;
    require!(cubes == expected_cubes, ErrorCode::InvalidPack);
    require!(gross == expected_lamports, ErrorCode::PriceChanged);
    let weekly_id = weekly_id_for_day(cadence_day(now));
    let (team, reward, treasury) = ctx.accounts.economy_config.split_sale(gross, weekly_id)?;
    transfer_from_player(&ctx, ctx.accounts.team_destination.to_account_info(), team)?;
    if let Some(weekly) = ctx.accounts.weekly_challenge.as_ref() {
        let (expected, _) = Pubkey::find_program_address(
            &[SEASON_CHALLENGE_SEED, &weekly_id.to_le_bytes()],
            &crate::ID,
        );
        require_keys_eq!(weekly.key(), expected, ErrorCode::InvalidOwner);
        require!(
            weekly.version == ECONOMY_ACCOUNT_VERSION
                && weekly.weekly_id == weekly_id
                && weekly.status == WeeklyStatus::Open
                && now >= weekly.opens_at
                && now < weekly.closes_at,
            ErrorCode::InvalidState
        );
        transfer_from_player(&ctx, weekly.to_account_info(), reward)?;
    } else {
        transfer_from_player(&ctx, ctx.accounts.reward_vault.to_account_info(), reward)?;
    }
    transfer_from_player(
        &ctx,
        ctx.accounts.treasury_destination.to_account_info(),
        treasury,
    )?;
    ctx.accounts
        .cube_sales_ledger
        .record_sale(gross, team, reward, treasury, cubes)?;
    if let Some(weekly) = ctx.accounts.weekly_challenge.as_mut() {
        weekly.purchase_funded_sol = weekly
            .purchase_funded_sol
            .checked_add(reward)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        weekly.committed_sol_pool = weekly
            .committed_sol_pool
            .checked_add(reward)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }
    ctx.accounts.player_state.credit_cubes(cubes)?;
    emit!(CubesPurchased {
        owner: ctx.accounts.owner.key(),
        pack_index,
        config_revision: ctx.accounts.economy_config.revision,
        cubes,
        gross,
        team,
        reward,
        treasury,
    });
    Ok(())
}

fn transfer_from_player<'info>(
    ctx: &Context<'info, PurchaseCubes<'info>>,
    destination: AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to: destination,
            },
        ),
        amount,
    )
}

fn spendable_lamports(account: &AccountInfo<'_>) -> Result<u64> {
    let reserve = Rent::get()?.minimum_balance(account.data_len());
    account
        .lamports()
        .checked_sub(reserve)
        .ok_or(ErrorCode::AccountingInvariant.into())
}

/// Moves native SOL between program-owned accounts while preserving the
/// source account's rent-exempt reserve. This is the custody boundary used by
/// the reward reserve and each Weekly challenge pool.
fn move_program_lamports(
    source: &AccountInfo<'_>,
    destination: &AccountInfo<'_>,
    amount: u64,
) -> Result<()> {
    require_keys_eq!(*source.owner, crate::ID, ErrorCode::InvalidOwner);
    require!(
        spendable_lamports(source)? >= amount,
        ErrorCode::InsufficientFunds
    );
    let source_after = source
        .lamports()
        .checked_sub(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let destination_after = destination
        .lamports()
        .checked_add(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    **source.try_borrow_mut_lamports()? = source_after;
    **destination.try_borrow_mut_lamports()? = destination_after;
    Ok(())
}

#[derive(Accounts)]
#[instruction(day_id: u32)]
pub struct OpenDailyChallenge<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [ECONOMY_CONFIG_SEED],
        bump = economy_config.bump,
        constraint = economy_config.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = economy_config.version == ECONOMY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = economy_config.content_version == protocol.content_version @ ErrorCode::ContentVersionMismatch
    )]
    pub economy_config: Box<Account<'info, EconomyConfig>>,
    #[account(
        seeds = [DAILY_RULES_CATALOG_SEED, economy_config.daily_rules_version.to_le_bytes().as_ref()],
        bump = daily_rules_catalog.bump,
        constraint = daily_rules_catalog.economy_config == economy_config.key() @ ErrorCode::InvalidOwner,
        constraint = daily_rules_catalog.version == ECONOMY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub daily_rules_catalog: Box<Account<'info, DailyRulesCatalog>>,
    #[account(
        init,
        payer = payer,
        space = 8 + DailyChallenge::INIT_SPACE,
        seeds = [DAILY_CHALLENGE_SEED, day_id.to_le_bytes().as_ref()],
        bump
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,
    #[account(
        init,
        payer = payer,
        space = 8 + DailyLeaderboard::INIT_SPACE,
        seeds = [DAILY_LEADERBOARD_SEED, daily_challenge.key().as_ref()],
        bump
    )]
    pub leaderboard: Box<Account<'info, DailyLeaderboard>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_open_daily_challenge(ctx: Context<OpenDailyChallenge>, day_id: u32) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(cadence_day(now) == day_id, ErrorCode::ChallengeNotStarted);
    let opens_at = i64::from(day_id)
        .checked_mul(SECONDS_PER_DAY)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let entries_close_at = opens_at
        .checked_add(DAILY_ENTRIES_CLOSE_OFFSET)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let runs_close_at = opens_at
        .checked_add(DAILY_RUNS_CLOSE_OFFSET)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let settlement_grace_close_at = opens_at
        .checked_add(SECONDS_PER_DAY)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(now < entries_close_at, ErrorCode::ChallengeEnded);
    let catalog = &ctx.accounts.daily_rules_catalog;
    catalog.validate()?;
    let scoring_rule = catalog.scoring_rule_for_day(day_id)?;
    let map_id = catalog.map_for_day(day_id);
    let rules = neutral_daily_rules(catalog.pressure);
    let rules_hash = hash_daily_challenge(catalog, day_id, map_id, scoring_rule)?;
    let challenge_key = ctx.accounts.daily_challenge.key();
    ctx.accounts.daily_challenge.set_inner(DailyChallenge {
        version: ECONOMY_ACCOUNT_VERSION,
        day_id,
        weekly_id: weekly_id_for_day(day_id),
        economy_config: ctx.accounts.economy_config.key(),
        rent_recipient: ctx.accounts.payer.key(),
        rules_version: catalog.rules_version,
        status: DailyStatus::Open,
        content_version: catalog.content_version,
        catalog_hash: catalog.catalog_hash,
        rules_hash,
        rules_weekly_id: catalog.weekly_id,
        map_id,
        scoring_rule,
        rules,
        pressure: catalog.pressure,
        opens_at,
        entries_close_at,
        runs_close_at,
        settlement_grace_close_at,
        finalized_at: 0,
        retry_cubes: ctx.accounts.economy_config.daily_retry_cubes,
        max_paid_retries: ctx.accounts.economy_config.max_paid_daily_retries,
        unique_players: 0,
        closed_players: 0,
        weekly_eligible_players: 0,
        weekly_rollups: 0,
        attempts_started: 0,
        runs_finalized: 0,
        bump: ctx.bumps.daily_challenge,
    });
    ctx.accounts.leaderboard.set_inner(DailyLeaderboard {
        version: ECONOMY_ACCOUNT_VERSION,
        challenge: challenge_key,
        entries: Vec::new(),
        bump: ctx.bumps.leaderboard,
    });
    emit!(DailyOpened {
        challenge: challenge_key,
        day_id,
        weekly_id: weekly_id_for_day(day_id),
        rules_weekly_id: catalog.weekly_id,
        map_id,
        scoring_rule,
        rules_hash,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(run_id: u64)]
pub struct EnterDaily<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [ECONOMY_CONFIG_SEED],
        bump = economy_config.bump,
        constraint = economy_config.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = economy_config.version == ECONOMY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = economy_config.content_version == protocol.content_version @ ErrorCode::ContentVersionMismatch
    )]
    pub economy_config: Box<Account<'info, EconomyConfig>>,
    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, owner_authority.key().as_ref()],
        bump = player_state.bump,
        constraint = player_state.owner == owner_authority.key() @ ErrorCode::Unauthorized,
        constraint = player_state.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = player_state.daily_eligible @ ErrorCode::MapLocked
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(
        mut,
        seeds = [DAILY_CHALLENGE_SEED, daily_challenge.day_id.to_le_bytes().as_ref()],
        bump = daily_challenge.bump,
        constraint = daily_challenge.economy_config == economy_config.key() @ ErrorCode::InvalidOwner,
        constraint = daily_challenge.version == ECONOMY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + DailyPlayer::INIT_SPACE,
        seeds = [DAILY_PLAYER_SEED, daily_challenge.key().as_ref(), owner_authority.key().as_ref()],
        bump
    )]
    pub daily_player: Box<Account<'info, DailyPlayer>>,
    #[account(
        init,
        payer = payer,
        space = 8 + ActiveRun::INIT_SPACE,
        seeds = [ACTIVE_RUN_SEED, b"active", owner_authority.key().as_ref(), run_id.to_le_bytes().as_ref()],
        bump
    )]
    pub active_run: Box<Account<'info, ActiveRun>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Immutable durable player identity, constrained above.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_enter_daily(ctx: Context<EnterDaily>, run_id: u64) -> Result<()> {
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
        ctx.accounts.daily_challenge.status == DailyStatus::Open,
        ErrorCode::InvalidState
    );
    require!(
        now >= ctx.accounts.daily_challenge.opens_at,
        ErrorCode::ChallengeNotStarted
    );
    require!(
        now < ctx.accounts.daily_challenge.entries_close_at,
        ErrorCode::ChallengeEnded
    );
    require!(
        ctx.accounts.player_state.next_run_id == run_id,
        ErrorCode::InvalidRunId
    );
    require!(
        ctx.accounts.player_state.active_run_id == 0,
        ErrorCode::ActiveRunExists
    );
    require!(
        ctx.accounts.daily_challenge.retry_cubes == ctx.accounts.economy_config.daily_retry_cubes,
        ErrorCode::AccountingInvariant
    );
    let daily_player = &mut ctx.accounts.daily_player;
    if daily_player.version == 0 {
        daily_player.version = ECONOMY_ACCOUNT_VERSION;
        daily_player.challenge = ctx.accounts.daily_challenge.key();
        daily_player.player = ctx.accounts.owner_authority.key();
        daily_player.attempts = 0;
        daily_player.paid_attempts = 0;
        daily_player.finalized_attempts = 0;
        daily_player.best_run_id = 0;
        daily_player.best_daily_score = 0;
        daily_player.best_daily_bonus_triggers = 0;
        daily_player.best_engine_score = 0;
        daily_player.best_moves = 0;
        daily_player.best_submitted_at = 0;
        daily_player.daily_xp_awarded = false;
        daily_player.pressure_mastery_xp_awarded = false;
        daily_player.weekly_rolled_up = false;
        daily_player.cube_refunded = false;
        daily_player.bump = ctx.bumps.daily_player;
        ctx.accounts.daily_challenge.unique_players = ctx
            .accounts
            .daily_challenge
            .unique_players
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    } else {
        require!(
            daily_player.version == ECONOMY_ACCOUNT_VERSION,
            ErrorCode::InvalidVersion
        );
        require_keys_eq!(
            daily_player.challenge,
            ctx.accounts.daily_challenge.key(),
            ErrorCode::InvalidRunId
        );
        require_keys_eq!(
            daily_player.player,
            ctx.accounts.owner_authority.key(),
            ErrorCode::Unauthorized
        );
    }
    let cubes_spent = if daily_player.attempts == 0 {
        0
    } else {
        require!(
            daily_player.paid_attempts < ctx.accounts.daily_challenge.max_paid_retries,
            ErrorCode::ChallengeEnded
        );
        ctx.accounts
            .player_state
            .spend_cubes(ctx.accounts.daily_challenge.retry_cubes)?;
        daily_player.paid_attempts = daily_player
            .paid_attempts
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        ctx.accounts.daily_challenge.retry_cubes
    };
    daily_player.attempts = daily_player
        .attempts
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    ctx.accounts.daily_challenge.attempts_started = ctx
        .accounts
        .daily_challenge
        .attempts_started
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let challenge_key = ctx.accounts.daily_challenge.key();
    initialize_daily_run(
        &mut ctx.accounts.player_state,
        &ctx.accounts.daily_challenge,
        challenge_key,
        &mut ctx.accounts.active_run,
        ctx.bumps.active_run,
        ctx.accounts.owner_authority.key(),
        run_id,
        now,
    )?;
    emit!(DailyEntered {
        challenge: challenge_key,
        owner: ctx.accounts.owner_authority.key(),
        run_id,
        attempt: daily_player.attempts,
        cubes_spent,
    });
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn initialize_daily_run(
    player: &mut PlayerState,
    challenge: &DailyChallenge,
    challenge_key: Pubkey,
    active: &mut ActiveRun,
    active_bump: u8,
    owner: Pubkey,
    run_id: u64,
    now: i64,
) -> Result<()> {
    active.version = ACCOUNT_VERSION;
    active.owner = owner;
    active.daily_challenge = challenge_key;
    active.run_id = run_id;
    active.mode = RunMode::Daily;
    active.lifecycle = RunLifecycle::Prepared;
    active.rules_hash = challenge.rules_hash;
    active.map_id = challenge.map_id;
    active.level = 1;
    active.rules = challenge.rules;
    active.grid = [0; 80];
    active.next_row = [0; 8];
    active.has_next_row = false;
    active.score = 0;
    active.daily_score = 0;
    active.daily_bonus_triggers = 0;
    active.pressure_score = 0;
    active.daily_scoring_rule = challenge.scoring_rule;
    active.daily_pressure = challenge.pressure;
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
    active.blocks_destroyed_by_size = [0; 4];
    active.bonus_type = 0;
    active.bonus_charges = 0;
    active.perfect_trigger_available = true;
    active.starting_height_target = challenge.pressure.starting_height;
    active.current_difficulty = 0;
    active.vrf_request_counter = 0;
    active.pending_vrf_counter = 0;
    active.finished_at = 0;
    active.bump = active_bump;

    player.record_run_started(now)?;
    player.record_daily_join(challenge.day_id, now)?;
    player.reserve_run(run_id)?;
    Ok(())
}

#[commit]
#[derive(Accounts)]
pub struct CommitDailyRun<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        owner = crate::ID,
        constraint = active_run.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = active_run.mode == RunMode::Daily @ ErrorCode::InvalidState
    )]
    pub active_run: Box<Account<'info, ActiveRun>>,
    /// CHECK: MagicBlock context required by MagicIntentBundleBuilder.
    #[account(mut, address = ephemeral_rollups_sdk::consts::MAGIC_CONTEXT_ID @ ErrorCode::InvalidMagicProgram)]
    pub magic_context: UncheckedAccount<'info>,
    pub magic_program: Program<'info, ephemeral_rollups_sdk::anchor::MagicProgram>,
}

pub fn handler_commit_daily_run(ctx: Context<CommitDailyRun>) -> Result<()> {
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
pub struct ConsumeDailyRun<'info> {
    #[account(
        mut,
        close = rent_recipient,
        owner = crate::ID,
        seeds = [ACTIVE_RUN_SEED, b"active", owner.key().as_ref(), active_run.run_id.to_le_bytes().as_ref()],
        bump = active_run.bump,
        has_one = owner @ ErrorCode::Unauthorized,
        constraint = active_run.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = active_run.daily_challenge == daily_challenge.key() @ ErrorCode::InvalidRunId
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
    #[account(
        mut,
        seeds = [DAILY_CHALLENGE_SEED, daily_challenge.day_id.to_le_bytes().as_ref()],
        bump = daily_challenge.bump,
        constraint = daily_challenge.version == ECONOMY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,
    #[account(
        mut,
        seeds = [DAILY_PLAYER_SEED, daily_challenge.key().as_ref(), owner.key().as_ref()],
        bump = daily_player.bump,
        constraint = daily_player.challenge == daily_challenge.key() @ ErrorCode::InvalidRunId,
        constraint = daily_player.player == owner.key() @ ErrorCode::Unauthorized,
        constraint = daily_player.version == ECONOMY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub daily_player: Box<Account<'info, DailyPlayer>>,
    #[account(
        mut,
        seeds = [DAILY_LEADERBOARD_SEED, daily_challenge.key().as_ref()],
        bump = leaderboard.bump,
        constraint = leaderboard.challenge == daily_challenge.key() @ ErrorCode::InvalidRunId,
        constraint = leaderboard.version == ECONOMY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub leaderboard: Box<Account<'info, DailyLeaderboard>>,
    /// CHECK: Player identity pinned by every durable account.
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

pub fn handler_consume_daily_run(ctx: Context<ConsumeDailyRun>) -> Result<()> {
    let active = &ctx.accounts.active_run;
    require!(
        ctx.accounts.player_state.active_run_id == active.run_id,
        ErrorCode::InvalidRunId
    );
    require!(
        active.lifecycle == RunLifecycle::Finished,
        ErrorCode::GameNotFinished
    );
    require!(active.finished_at > 0, ErrorCode::GameNotFinished);
    let consumed_at = Clock::get()?.unix_timestamp;
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
            campaign_level_completed: false,
            new_perfect_level: false,
            boss_cleared: false,
        },
        consumed_at,
    )?;
    let player = &mut ctx.accounts.daily_player;
    player.finalized_attempts = player
        .finalized_attempts
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let (xp_awarded, pressure_mastery_awarded) =
        daily_progression_xp(player, active.current_difficulty)?;
    if xp_awarded > 0 {
        ctx.accounts
            .player_state
            .credit_progression_rewards(0, xp_awarded)?;
    }
    if pressure_mastery_awarded {
        emit!(DailyPressureMasteryAwarded {
            challenge: ctx.accounts.daily_challenge.key(),
            owner: active.owner,
            pressure_tier: active.current_difficulty,
            xp: DAILY_PRESSURE_MASTERY_XP,
        });
    }
    ctx.accounts.daily_challenge.runs_finalized = ctx
        .accounts
        .daily_challenge
        .runs_finalized
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let eligible = active.finished_at <= ctx.accounts.daily_challenge.runs_close_at
        && ctx.accounts.daily_challenge.status == DailyStatus::Open;
    let candidate = DailyLeaderboardEntry {
        player: active.owner,
        run_id: active.run_id,
        daily_score: active.daily_score,
        daily_bonus_triggers: active.daily_bonus_triggers,
        engine_score: active.score,
        moves: active.moves,
        finalized_attempts: player.finalized_attempts,
        submitted_at: active.finished_at,
    };
    let current = DailyLeaderboardEntry {
        player: active.owner,
        run_id: player.best_run_id,
        daily_score: player.best_daily_score,
        daily_bonus_triggers: player.best_daily_bonus_triggers,
        engine_score: player.best_engine_score,
        moves: player.best_moves,
        finalized_attempts: player.finalized_attempts,
        submitted_at: player.best_submitted_at,
    };
    let improves = player.best_run_id == 0 || daily_entry_is_better(&candidate, &current);
    if eligible && improves {
        if player.best_run_id == 0 {
            ctx.accounts.daily_challenge.weekly_eligible_players = ctx
                .accounts
                .daily_challenge
                .weekly_eligible_players
                .checked_add(1)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
        player.best_run_id = active.run_id;
        player.best_daily_score = active.daily_score;
        player.best_daily_bonus_triggers = active.daily_bonus_triggers;
        player.best_engine_score = active.score;
        player.best_moves = active.moves;
        player.best_submitted_at = active.finished_at;
    }
    if eligible {
        ctx.accounts.leaderboard.record_best(DailyLeaderboardEntry {
            player: active.owner,
            run_id: player.best_run_id,
            daily_score: player.best_daily_score,
            daily_bonus_triggers: player.best_daily_bonus_triggers,
            engine_score: player.best_engine_score,
            moves: player.best_moves,
            finalized_attempts: player.finalized_attempts,
            submitted_at: player.best_submitted_at,
        });
    }
    ctx.accounts.player_state.release_run(active.run_id)?;
    Ok(())
}

fn daily_progression_xp(player: &mut DailyPlayer, final_pressure_tier: u8) -> Result<(u32, bool)> {
    let mut xp = 0u32;
    if !player.daily_xp_awarded {
        xp = xp
            .checked_add(DAILY_XP)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        player.daily_xp_awarded = true;
    }
    let pressure_mastery_awarded = final_pressure_tier == 7 && !player.pressure_mastery_xp_awarded;
    if pressure_mastery_awarded {
        xp = xp
            .checked_add(DAILY_PRESSURE_MASTERY_XP)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        player.pressure_mastery_xp_awarded = true;
    }
    Ok((xp, pressure_mastery_awarded))
}

#[derive(Accounts)]
pub struct FinalizeDailyChallenge<'info> {
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

pub fn handler_finalize_daily_challenge(ctx: Context<FinalizeDailyChallenge>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let challenge = &mut ctx.accounts.daily_challenge;
    require!(
        challenge.status == DailyStatus::Open,
        ErrorCode::InvalidState
    );
    require!(now >= challenge.runs_close_at, ErrorCode::ChallengeNotEnded);
    require!(
        challenge.runs_finalized == challenge.attempts_started
            || now >= challenge.settlement_grace_close_at,
        ErrorCode::InvalidState
    );
    challenge.status = DailyStatus::Claimable;
    challenge.finalized_at = now;
    emit!(DailyFinalized {
        challenge: challenge.key(),
        day_id: challenge.day_id,
        participants: challenge.unique_players,
        finalized_runs: challenge.runs_finalized,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CancelDailyChallenge<'info> {
    #[account(has_one = authority @ ErrorCode::Unauthorized)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [DAILY_CHALLENGE_SEED, daily_challenge.day_id.to_le_bytes().as_ref()],
        bump = daily_challenge.bump,
        constraint = daily_challenge.status == DailyStatus::Open @ ErrorCode::InvalidState
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,
    pub authority: Signer<'info>,
}

pub fn handler_cancel_daily_challenge(ctx: Context<CancelDailyChallenge>) -> Result<()> {
    ctx.accounts.daily_challenge.status = DailyStatus::Cancelled;
    Ok(())
}

#[derive(Accounts)]
pub struct RefundDailyCubes<'info> {
    #[account(
        seeds = [DAILY_CHALLENGE_SEED, daily_challenge.day_id.to_le_bytes().as_ref()],
        bump = daily_challenge.bump,
        constraint = daily_challenge.status == DailyStatus::Cancelled @ ErrorCode::InvalidState
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,
    #[account(
        mut,
        seeds = [DAILY_PLAYER_SEED, daily_challenge.key().as_ref(), owner_authority.key().as_ref()],
        bump = daily_player.bump,
        constraint = daily_player.player == owner_authority.key() @ ErrorCode::Unauthorized,
        constraint = daily_player.challenge == daily_challenge.key() @ ErrorCode::InvalidRunId
    )]
    pub daily_player: Box<Account<'info, DailyPlayer>>,
    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, owner_authority.key().as_ref()],
        bump = player_state.bump,
        constraint = player_state.owner == owner_authority.key() @ ErrorCode::Unauthorized
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
    /// CHECK: Immutable durable player identity, constrained above.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
}

pub fn handler_refund_daily_cubes(ctx: Context<RefundDailyCubes>) -> Result<()> {
    require_player_authorization(
        ctx.accounts.owner_authority.key(),
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    require!(
        !ctx.accounts.daily_player.cube_refunded,
        ErrorCode::RefundAlreadyClaimed
    );
    let refund = u64::from(ctx.accounts.daily_player.paid_attempts)
        .checked_mul(ctx.accounts.daily_challenge.retry_cubes)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(refund > 0, ErrorCode::InsufficientFunds);
    ctx.accounts.player_state.refund_cubes(refund)?;
    ctx.accounts.daily_player.cube_refunded = true;
    Ok(())
}

#[derive(Accounts)]
pub struct CloseDailyPlayer<'info> {
    // No pause check: completed-account rent recovery must remain available.
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [DAILY_CHALLENGE_SEED, daily_challenge.day_id.to_le_bytes().as_ref()],
        bump = daily_challenge.bump
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,
    #[account(
        seeds = [SEASON_CHALLENGE_SEED, daily_challenge.weekly_id.to_le_bytes().as_ref()],
        bump = weekly_challenge.bump,
        constraint = weekly_challenge.weekly_id == daily_challenge.weekly_id @ ErrorCode::InvalidState
    )]
    pub weekly_challenge: Box<Account<'info, WeeklyChallenge>>,
    /// CHECK: Identity pinned by DailyPlayer and its PDA seeds.
    pub owner: UncheckedAccount<'info>,
    #[account(
        mut,
        close = rent_recipient,
        seeds = [DAILY_PLAYER_SEED, daily_challenge.key().as_ref(), owner.key().as_ref()],
        bump = daily_player.bump,
        constraint = daily_player.challenge == daily_challenge.key() @ ErrorCode::InvalidRunId,
        constraint = daily_player.player == owner.key() @ ErrorCode::Unauthorized
    )]
    pub daily_player: Box<Account<'info, DailyPlayer>>,
    /// CHECK: Canonical zero-data System PDA receives recycled Daily rent.
    #[account(
        mut,
        seeds = [PLAYER_FUNDING_SEED, owner.key().as_ref()],
        bump,
        owner = system_program::ID @ ErrorCode::InvalidOwner,
        constraint = rent_recipient.data_is_empty() @ ErrorCode::InvalidOwner
    )]
    pub rent_recipient: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
}

pub fn handler_close_daily_player(ctx: Context<CloseDailyPlayer>) -> Result<()> {
    require!(
        matches!(
            ctx.accounts.weekly_challenge.status,
            WeeklyStatus::Claimable | WeeklyStatus::Closed
        ),
        ErrorCode::InvalidState
    );
    require!(
        daily_player_close_allowed(
            ctx.accounts.daily_challenge.status,
            ctx.accounts.daily_player.attempts,
            ctx.accounts.daily_player.finalized_attempts,
            ctx.accounts.daily_player.best_run_id,
            ctx.accounts.daily_player.weekly_rolled_up,
            ctx.accounts.daily_player.cube_refunded,
        ),
        ErrorCode::InvalidState
    );
    ctx.accounts.daily_challenge.closed_players = ctx
        .accounts
        .daily_challenge
        .closed_players
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        ctx.accounts.daily_challenge.closed_players <= ctx.accounts.daily_challenge.unique_players,
        ErrorCode::AccountingInvariant
    );
    emit!(DailyPlayerClosed {
        challenge: ctx.accounts.daily_challenge.key(),
        owner: ctx.accounts.owner.key(),
    });
    Ok(())
}

fn daily_player_close_allowed(
    status: DailyStatus,
    attempts: u32,
    finalized_attempts: u32,
    best_run_id: u64,
    weekly_rolled_up: bool,
    cube_refunded: bool,
) -> bool {
    if attempts != finalized_attempts {
        return false;
    }
    match status {
        DailyStatus::Claimable => best_run_id == 0 || weekly_rolled_up,
        DailyStatus::Cancelled => cube_refunded,
        _ => false,
    }
}

#[derive(Accounts)]
pub struct CloseDailyChallenge<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [SEASON_CHALLENGE_SEED, daily_challenge.weekly_id.to_le_bytes().as_ref()],
        bump = weekly_challenge.bump,
        constraint = weekly_challenge.weekly_id == daily_challenge.weekly_id @ ErrorCode::InvalidState
    )]
    pub weekly_challenge: Box<Account<'info, WeeklyChallenge>>,
    #[account(
        mut,
        close = rent_recipient,
        seeds = [DAILY_CHALLENGE_SEED, daily_challenge.day_id.to_le_bytes().as_ref()],
        bump = daily_challenge.bump
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,
    #[account(
        mut,
        close = rent_recipient,
        seeds = [DAILY_LEADERBOARD_SEED, daily_challenge.key().as_ref()],
        bump = leaderboard.bump,
        constraint = leaderboard.challenge == daily_challenge.key() @ ErrorCode::InvalidRunId
    )]
    pub leaderboard: Box<Account<'info, DailyLeaderboard>>,
    /// CHECK: Pinned when the challenge was opened.
    #[account(mut, address = daily_challenge.rent_recipient @ ErrorCode::InvalidOwner)]
    pub rent_recipient: UncheckedAccount<'info>,
    #[account(mut)]
    pub caller: Signer<'info>,
}

pub fn handler_close_daily_challenge(ctx: Context<CloseDailyChallenge>) -> Result<()> {
    require!(
        matches!(
            ctx.accounts.daily_challenge.status,
            DailyStatus::Claimable | DailyStatus::Cancelled
        ) && matches!(
            ctx.accounts.weekly_challenge.status,
            WeeklyStatus::Claimable | WeeklyStatus::Closed
        ),
        ErrorCode::InvalidState
    );
    require!(
        ctx.accounts.daily_challenge.closed_players == ctx.accounts.daily_challenge.unique_players,
        ErrorCode::AccountingInvariant
    );
    emit!(DailyChallengeClosed {
        challenge: ctx.accounts.daily_challenge.key(),
        day_id: ctx.accounts.daily_challenge.day_id,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(weekly_id: u32)]
pub struct OpenWeeklyChallenge<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [ECONOMY_CONFIG_SEED],
        bump = economy_config.bump,
        constraint = economy_config.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = economy_config.version == ECONOMY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = economy_config.content_version == protocol.content_version @ ErrorCode::ContentVersionMismatch
    )]
    pub economy_config: Box<Account<'info, EconomyConfig>>,
    #[account(
        init,
        payer = payer,
        space = 8 + WeeklyChallenge::INIT_SPACE,
        seeds = [SEASON_CHALLENGE_SEED, weekly_id.to_le_bytes().as_ref()],
        bump
    )]
    pub weekly_challenge: Box<Account<'info, WeeklyChallenge>>,
    #[account(
        init,
        payer = payer,
        space = 8 + WeeklyLeaderboard::INIT_SPACE,
        seeds = [SEASON_LEADERBOARD_SEED, weekly_challenge.key().as_ref()],
        bump
    )]
    pub leaderboard: Box<Account<'info, WeeklyLeaderboard>>,
    #[account(
        mut,
        address = protocol.reward_vault,
        seeds = [REWARD_VAULT_SEED],
        bump = reward_vault.bump,
        constraint = reward_vault.protocol == protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub reward_vault: Box<Account<'info, RewardVault>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_open_weekly_challenge(
    ctx: Context<OpenWeeklyChallenge>,
    weekly_id: u32,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        weekly_id_for_day(cadence_day(now)) == weekly_id,
        ErrorCode::ChallengeNotStarted
    );
    let (opens_at, closes_at, finalizes_at) = weekly_window(weekly_id)?;
    require!(
        now >= opens_at && now < closes_at,
        ErrorCode::ChallengeEnded
    );
    let available = spendable_lamports(&ctx.accounts.reward_vault.to_account_info())?;
    let pool = available;
    if pool > 0 {
        move_program_lamports(
            &ctx.accounts.reward_vault.to_account_info(),
            &ctx.accounts.weekly_challenge.to_account_info(),
            pool,
        )?;
    }
    let challenge_key = ctx.accounts.weekly_challenge.key();
    ctx.accounts.weekly_challenge.set_inner(WeeklyChallenge {
        version: ECONOMY_ACCOUNT_VERSION,
        weekly_id,
        economy_config: ctx.accounts.economy_config.key(),
        rent_recipient: ctx.accounts.payer.key(),
        status: WeeklyStatus::Open,
        opens_at,
        closes_at,
        finalizes_at,
        finalized_at: 0,
        claims_close_at: 0,
        committed_sol_pool: pool,
        purchase_funded_sol: 0,
        founder_seeded_sol: 0,
        rolled_over_sol: pool,
        sol_claimed: 0,
        sol_forfeited: 0,
        participants: 0,
        closed_players: 0,
        sol_winner_count: 0,
        cube_winner_count: 0,
        bump: ctx.bumps.weekly_challenge,
    });
    ctx.accounts.leaderboard.set_inner(WeeklyLeaderboard {
        version: ECONOMY_ACCOUNT_VERSION,
        challenge: challenge_key,
        entries: Vec::new(),
        bump: ctx.bumps.leaderboard,
    });
    emit!(WeeklyOpened {
        challenge: challenge_key,
        weekly_id,
        sol_pool: pool,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct FundWeekly<'info> {
    #[account(
        mut,
        seeds = [SEASON_CHALLENGE_SEED, weekly_challenge.weekly_id.to_le_bytes().as_ref()],
        bump = weekly_challenge.bump,
        constraint = weekly_challenge.status == WeeklyStatus::Open @ ErrorCode::InvalidState
    )]
    pub weekly_challenge: Box<Account<'info, WeeklyChallenge>>,
    #[account(mut)]
    pub funder: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_fund_weekly(ctx: Context<FundWeekly>, lamports: u64) -> Result<()> {
    require!(lamports > 0, ErrorCode::InsufficientFunds);
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= ctx.accounts.weekly_challenge.opens_at
            && now < ctx.accounts.weekly_challenge.closes_at,
        ErrorCode::ChallengeEnded
    );
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.funder.to_account_info(),
                to: ctx.accounts.weekly_challenge.to_account_info(),
            },
        ),
        lamports,
    )?;
    let challenge = &mut ctx.accounts.weekly_challenge;
    challenge.founder_seeded_sol = challenge
        .founder_seeded_sol
        .checked_add(lamports)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    challenge.committed_sol_pool = challenge
        .committed_sol_pool
        .checked_add(lamports)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    emit!(WeeklyFunded {
        challenge: challenge.key(),
        funder: ctx.accounts.funder.key(),
        lamports,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RollupDailyToWeekly<'info> {
    #[account(
        mut,
        seeds = [DAILY_CHALLENGE_SEED, daily_challenge.day_id.to_le_bytes().as_ref()],
        bump = daily_challenge.bump,
        constraint = daily_challenge.status == DailyStatus::Claimable @ ErrorCode::InvalidState
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,
    #[account(
        seeds = [DAILY_LEADERBOARD_SEED, daily_challenge.key().as_ref()],
        bump = daily_leaderboard.bump,
        constraint = daily_leaderboard.challenge == daily_challenge.key() @ ErrorCode::InvalidRunId
    )]
    pub daily_leaderboard: Box<Account<'info, DailyLeaderboard>>,
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
        seeds = [SEASON_CHALLENGE_SEED, weekly_challenge.weekly_id.to_le_bytes().as_ref()],
        bump = weekly_challenge.bump,
        constraint = weekly_challenge.weekly_id == daily_challenge.weekly_id @ ErrorCode::InvalidState,
        constraint = weekly_challenge.status == WeeklyStatus::Open @ ErrorCode::InvalidState
    )]
    pub weekly_challenge: Box<Account<'info, WeeklyChallenge>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + WeeklyPlayer::INIT_SPACE,
        seeds = [SEASON_PLAYER_SEED, weekly_challenge.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub weekly_player: Box<Account<'info, WeeklyPlayer>>,
    #[account(
        mut,
        seeds = [SEASON_LEADERBOARD_SEED, weekly_challenge.key().as_ref()],
        bump = weekly_leaderboard.bump,
        constraint = weekly_leaderboard.challenge == weekly_challenge.key() @ ErrorCode::InvalidRunId
    )]
    pub weekly_leaderboard: Box<Account<'info, WeeklyLeaderboard>>,
    /// CHECK: Identity pinned by DailyPlayer and WeeklyPlayer.
    pub owner: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_rollup_daily_to_weekly(ctx: Context<RollupDailyToWeekly>) -> Result<()> {
    require_player_rent_payer(
        ctx.accounts.owner.key(),
        ctx.accounts.caller.key(),
        ctx.accounts.payer.key(),
    )?;
    require!(
        !ctx.accounts.daily_player.weekly_rolled_up,
        ErrorCode::AlreadySubmitted
    );
    require!(
        ctx.accounts.daily_player.best_run_id > 0,
        ErrorCode::RewardNotEarned
    );
    require!(
        Clock::get()?.unix_timestamp <= ctx.accounts.weekly_challenge.finalizes_at,
        ErrorCode::ChallengeEnded
    );
    let weekly_player = &mut ctx.accounts.weekly_player;
    if weekly_player.version == 0 {
        weekly_player.version = ECONOMY_ACCOUNT_VERSION;
        weekly_player.challenge = ctx.accounts.weekly_challenge.key();
        weekly_player.player = ctx.accounts.owner.key();
        weekly_player.results = [WeeklyDailyResult::default(); SEASON_DAILY_RESULTS];
        weekly_player.result_count = 0;
        weekly_player.score = 0;
        weekly_player.sol_claimed = false;
        weekly_player.cubes_claimed = false;
        weekly_player.bump = ctx.bumps.weekly_player;
        ctx.accounts.weekly_challenge.participants = ctx
            .accounts
            .weekly_challenge
            .participants
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    } else {
        require!(
            weekly_player.version == ECONOMY_ACCOUNT_VERSION,
            ErrorCode::InvalidVersion
        );
        require_keys_eq!(
            weekly_player.challenge,
            ctx.accounts.weekly_challenge.key(),
            ErrorCode::InvalidRunId
        );
        require_keys_eq!(
            weekly_player.player,
            ctx.accounts.owner.key(),
            ErrorCode::Unauthorized
        );
    }
    let rank = ctx
        .accounts
        .daily_leaderboard
        .rank_of(ctx.accounts.owner.key());
    let points = daily_points_for_rank(rank, ctx.accounts.daily_challenge.weekly_eligible_players);
    weekly_player.record_daily(ctx.accounts.daily_challenge.day_id, points)?;
    ctx.accounts
        .weekly_leaderboard
        .record_score(WeeklyLeaderboardEntry {
            player: ctx.accounts.owner.key(),
            score: weekly_player.score,
            updated_at: 0,
        });
    ctx.accounts.daily_player.weekly_rolled_up = true;
    ctx.accounts.daily_challenge.weekly_rollups = ctx
        .accounts
        .daily_challenge
        .weekly_rollups
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        ctx.accounts.daily_challenge.weekly_rollups
            <= ctx.accounts.daily_challenge.weekly_eligible_players,
        ErrorCode::AccountingInvariant
    );
    emit!(DailyRolledUp {
        owner: ctx.accounts.owner.key(),
        day_id: ctx.accounts.daily_challenge.day_id,
        weekly_id: ctx.accounts.weekly_challenge.weekly_id,
        points,
        weekly_score: weekly_player.score,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeWeeklyChallenge<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [SEASON_CHALLENGE_SEED, weekly_challenge.weekly_id.to_le_bytes().as_ref()],
        bump = weekly_challenge.bump
    )]
    pub weekly_challenge: Box<Account<'info, WeeklyChallenge>>,
    #[account(
        seeds = [SEASON_LEADERBOARD_SEED, weekly_challenge.key().as_ref()],
        bump = leaderboard.bump,
        constraint = leaderboard.challenge == weekly_challenge.key() @ ErrorCode::InvalidRunId
    )]
    pub leaderboard: Box<Account<'info, WeeklyLeaderboard>>,
    #[account(
        mut,
        address = protocol.reward_vault,
        seeds = [REWARD_VAULT_SEED],
        bump = reward_vault.bump,
        constraint = reward_vault.protocol == protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub reward_vault: Box<Account<'info, RewardVault>>,
    pub caller: Signer<'info>,
}

pub fn handler_finalize_weekly_challenge(ctx: Context<FinalizeWeeklyChallenge>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    validate_weekly_rollups(
        ctx.accounts.weekly_challenge.weekly_id,
        ctx.remaining_accounts,
    )?;
    let challenge = &mut ctx.accounts.weekly_challenge;
    require!(
        challenge.status == WeeklyStatus::Open,
        ErrorCode::InvalidState
    );
    require!(now >= challenge.finalizes_at, ErrorCode::ChallengeNotEnded);
    if challenge.participants == 0 {
        let amount = spendable_lamports(&challenge.to_account_info())?;
        if amount > 0 {
            move_program_lamports(
                &challenge.to_account_info(),
                &ctx.accounts.reward_vault.to_account_info(),
                amount,
            )?;
        }
        challenge.sol_forfeited = amount;
        challenge.finalized_at = now;
        challenge.status = WeeklyStatus::Closed;
        emit!(WeeklyFinalized {
            challenge: challenge.key(),
            weekly_id: challenge.weekly_id,
            participants: 0,
            sol_winner_count: 0,
            cube_winner_count: 0,
            sol_pool: challenge.committed_sol_pool,
        });
        return Ok(());
    }
    let (sol_winner_count, cube_winner_count) =
        weekly_winner_counts(challenge.participants, challenge.committed_sol_pool > 0);
    challenge.sol_winner_count = sol_winner_count;
    challenge.cube_winner_count = cube_winner_count;
    challenge.finalized_at = now;
    challenge.claims_close_at = now
        .checked_add(SEASON_CLAIM_WINDOW_SECONDS)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    challenge.status = WeeklyStatus::Claimable;
    emit!(WeeklyFinalized {
        challenge: challenge.key(),
        weekly_id: challenge.weekly_id,
        participants: challenge.participants,
        sol_winner_count,
        cube_winner_count,
        sol_pool: challenge.committed_sol_pool,
    });
    Ok(())
}

fn validate_weekly_rollups(weekly_id: u32, daily_accounts: &[AccountInfo<'_>]) -> Result<()> {
    require!(daily_accounts.len() == 14, ErrorCode::InvalidState);
    let start_day = weekly_id
        .checked_mul(14)
        .and_then(|day| day.checked_sub(3))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    for (offset, account) in daily_accounts.iter().enumerate() {
        let day_id = start_day
            .checked_add(u32::try_from(offset).map_err(|_| ErrorCode::ArithmeticOverflow)?)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        let (expected, _) = Pubkey::find_program_address(
            &[DAILY_CHALLENGE_SEED, &day_id.to_le_bytes()],
            &crate::ID,
        );
        require_keys_eq!(account.key(), expected, ErrorCode::InvalidRunId);
        if account.data_is_empty() {
            require_keys_eq!(*account.owner, system_program::ID, ErrorCode::InvalidOwner);
            continue;
        }
        require_keys_eq!(*account.owner, crate::ID, ErrorCode::InvalidOwner);
        let data = account.try_borrow_data()?;
        require!(
            data.len() == 8 + DailyChallenge::INIT_SPACE,
            ErrorCode::InvalidVersion
        );
        let mut bytes: &[u8] = &data;
        let daily = DailyChallenge::try_deserialize(&mut bytes)?;
        require!(
            daily.version == ECONOMY_ACCOUNT_VERSION,
            ErrorCode::InvalidVersion
        );
        require!(daily.day_id == day_id, ErrorCode::InvalidRunId);
        require!(daily.weekly_id == weekly_id, ErrorCode::InvalidState);
        require!(
            daily_rollups_complete(
                &daily.status,
                daily.weekly_eligible_players,
                daily.weekly_rollups,
            ),
            ErrorCode::InvalidState
        );
    }
    Ok(())
}

fn daily_rollups_complete(status: &DailyStatus, eligible: u32, rolled_up: u32) -> bool {
    match status {
        DailyStatus::Claimable => rolled_up == eligible,
        DailyStatus::Cancelled => rolled_up == 0,
        _ => false,
    }
}

#[derive(Accounts)]
pub struct ClaimWeeklyCubes<'info> {
    #[account(
        seeds = [SEASON_CHALLENGE_SEED, weekly_challenge.weekly_id.to_le_bytes().as_ref()],
        bump = weekly_challenge.bump,
        constraint = weekly_challenge.status == WeeklyStatus::Claimable @ ErrorCode::InvalidState
    )]
    pub weekly_challenge: Box<Account<'info, WeeklyChallenge>>,
    #[account(
        seeds = [SEASON_LEADERBOARD_SEED, weekly_challenge.key().as_ref()],
        bump = leaderboard.bump,
        constraint = leaderboard.challenge == weekly_challenge.key() @ ErrorCode::InvalidRunId
    )]
    pub leaderboard: Box<Account<'info, WeeklyLeaderboard>>,
    #[account(
        mut,
        seeds = [SEASON_PLAYER_SEED, weekly_challenge.key().as_ref(), owner_authority.key().as_ref()],
        bump = weekly_player.bump,
        constraint = weekly_player.player == owner_authority.key() @ ErrorCode::Unauthorized
    )]
    pub weekly_player: Box<Account<'info, WeeklyPlayer>>,
    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, owner_authority.key().as_ref()],
        bump = player_state.bump,
        constraint = player_state.owner == owner_authority.key() @ ErrorCode::Unauthorized
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
    /// CHECK: Immutable durable player identity, constrained above.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
}

pub fn handler_claim_weekly_cubes(ctx: Context<ClaimWeeklyCubes>) -> Result<()> {
    require_player_authorization(
        ctx.accounts.owner_authority.key(),
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    require!(
        Clock::get()?.unix_timestamp <= ctx.accounts.weekly_challenge.claims_close_at,
        ErrorCode::ChallengeEnded
    );
    require!(
        !ctx.accounts.weekly_player.cubes_claimed,
        ErrorCode::PrizeAlreadyClaimed
    );
    let rank = ctx
        .accounts
        .leaderboard
        .rank_of(ctx.accounts.owner_authority.key())
        .ok_or(ErrorCode::NoPrize)?;
    let cubes = weekly_cube_reward_for_rank(
        rank,
        ctx.accounts.weekly_challenge.sol_winner_count,
        ctx.accounts.weekly_challenge.cube_winner_count,
    )?;
    ctx.accounts.player_state.credit_cubes(cubes)?;
    ctx.accounts.weekly_player.cubes_claimed = true;
    emit!(WeeklyCubesClaimed {
        owner: ctx.accounts.owner_authority.key(),
        weekly_id: ctx.accounts.weekly_challenge.weekly_id,
        rank: (rank + 1) as u8,
        cubes,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimWeeklySol<'info> {
    #[account(
        mut,
        seeds = [SEASON_CHALLENGE_SEED, weekly_challenge.weekly_id.to_le_bytes().as_ref()],
        bump = weekly_challenge.bump,
        constraint = weekly_challenge.status == WeeklyStatus::Claimable @ ErrorCode::InvalidState
    )]
    pub weekly_challenge: Box<Account<'info, WeeklyChallenge>>,
    #[account(
        seeds = [SEASON_LEADERBOARD_SEED, weekly_challenge.key().as_ref()],
        bump = leaderboard.bump,
        constraint = leaderboard.challenge == weekly_challenge.key() @ ErrorCode::InvalidRunId
    )]
    pub leaderboard: Box<Account<'info, WeeklyLeaderboard>>,
    #[account(
        mut,
        seeds = [SEASON_PLAYER_SEED, weekly_challenge.key().as_ref(), owner_authority.key().as_ref()],
        bump = weekly_player.bump,
        constraint = weekly_player.player == owner_authority.key() @ ErrorCode::Unauthorized
    )]
    pub weekly_player: Box<Account<'info, WeeklyPlayer>>,
    /// CHECK: Immutable durable player identity, constrained above.
    #[account(mut)]
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
}

pub fn handler_claim_weekly_sol(ctx: Context<ClaimWeeklySol>) -> Result<()> {
    require_player_authorization(
        ctx.accounts.owner_authority.key(),
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    require!(
        Clock::get()?.unix_timestamp <= ctx.accounts.weekly_challenge.claims_close_at,
        ErrorCode::ChallengeEnded
    );
    require!(
        !ctx.accounts.weekly_player.sol_claimed,
        ErrorCode::PrizeAlreadyClaimed
    );
    let rank = ctx
        .accounts
        .leaderboard
        .rank_of(ctx.accounts.owner_authority.key())
        .ok_or(ErrorCode::NoPrize)?;
    let amount = weekly_sol_amount(
        ctx.accounts.weekly_challenge.committed_sol_pool,
        rank,
        ctx.accounts.weekly_challenge.sol_winner_count,
    )?;
    move_program_lamports(
        &ctx.accounts.weekly_challenge.to_account_info(),
        &ctx.accounts.owner_authority.to_account_info(),
        amount,
    )?;
    ctx.accounts.weekly_challenge.sol_claimed = ctx
        .accounts
        .weekly_challenge
        .sol_claimed
        .checked_add(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        ctx.accounts.weekly_challenge.sol_claimed
            <= ctx.accounts.weekly_challenge.committed_sol_pool,
        ErrorCode::AccountingInvariant
    );
    ctx.accounts.weekly_player.sol_claimed = true;
    emit!(WeeklySolClaimed {
        owner: ctx.accounts.owner_authority.key(),
        weekly_id: ctx.accounts.weekly_challenge.weekly_id,
        rank: (rank + 1) as u8,
        amount,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ForfeitWeeklySol<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [SEASON_CHALLENGE_SEED, weekly_challenge.weekly_id.to_le_bytes().as_ref()],
        bump = weekly_challenge.bump,
        constraint = weekly_challenge.status == WeeklyStatus::Claimable @ ErrorCode::InvalidState
    )]
    pub weekly_challenge: Box<Account<'info, WeeklyChallenge>>,
    #[account(
        mut,
        address = protocol.reward_vault,
        seeds = [REWARD_VAULT_SEED],
        bump = reward_vault.bump,
        constraint = reward_vault.protocol == protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub reward_vault: Box<Account<'info, RewardVault>>,
    pub caller: Signer<'info>,
}

pub fn handler_forfeit_weekly_sol(ctx: Context<ForfeitWeeklySol>) -> Result<()> {
    require!(
        Clock::get()?.unix_timestamp > ctx.accounts.weekly_challenge.claims_close_at,
        ErrorCode::PrizeClaimWindowOpen
    );
    let amount = spendable_lamports(&ctx.accounts.weekly_challenge.to_account_info())?;
    if amount > 0 {
        move_program_lamports(
            &ctx.accounts.weekly_challenge.to_account_info(),
            &ctx.accounts.reward_vault.to_account_info(),
            amount,
        )?;
    }
    ctx.accounts.weekly_challenge.sol_forfeited = amount;
    require!(
        ctx.accounts
            .weekly_challenge
            .sol_claimed
            .checked_add(amount)
            == Some(ctx.accounts.weekly_challenge.committed_sol_pool),
        ErrorCode::AccountingInvariant
    );
    ctx.accounts.weekly_challenge.status = WeeklyStatus::Closed;
    emit!(WeeklySolForfeited {
        weekly_id: ctx.accounts.weekly_challenge.weekly_id,
        amount,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CloseWeeklyPlayer<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [SEASON_CHALLENGE_SEED, weekly_challenge.weekly_id.to_le_bytes().as_ref()],
        bump = weekly_challenge.bump
    )]
    pub weekly_challenge: Box<Account<'info, WeeklyChallenge>>,
    #[account(
        seeds = [SEASON_LEADERBOARD_SEED, weekly_challenge.key().as_ref()],
        bump = leaderboard.bump,
        constraint = leaderboard.challenge == weekly_challenge.key() @ ErrorCode::InvalidRunId
    )]
    pub leaderboard: Box<Account<'info, WeeklyLeaderboard>>,
    /// CHECK: Identity pinned by WeeklyPlayer and its PDA seeds.
    pub owner: UncheckedAccount<'info>,
    #[account(
        mut,
        close = rent_recipient,
        seeds = [SEASON_PLAYER_SEED, weekly_challenge.key().as_ref(), owner.key().as_ref()],
        bump = weekly_player.bump,
        constraint = weekly_player.challenge == weekly_challenge.key() @ ErrorCode::InvalidRunId,
        constraint = weekly_player.player == owner.key() @ ErrorCode::Unauthorized
    )]
    pub weekly_player: Box<Account<'info, WeeklyPlayer>>,
    /// CHECK: Canonical zero-data System PDA receives recycled Weekly rent.
    #[account(
        mut,
        seeds = [PLAYER_FUNDING_SEED, owner.key().as_ref()],
        bump,
        owner = system_program::ID @ ErrorCode::InvalidOwner,
        constraint = rent_recipient.data_is_empty() @ ErrorCode::InvalidOwner
    )]
    pub rent_recipient: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
}

pub fn handler_close_weekly_player(ctx: Context<CloseWeeklyPlayer>) -> Result<()> {
    let rank = ctx.accounts.leaderboard.rank_of(ctx.accounts.owner.key());
    require!(
        weekly_player_close_allowed(
            ctx.accounts.weekly_challenge.status,
            rank,
            ctx.accounts.weekly_challenge.sol_winner_count,
            ctx.accounts.weekly_challenge.cube_winner_count,
            ctx.accounts.weekly_player.sol_claimed,
            ctx.accounts.weekly_player.cubes_claimed,
        ),
        ErrorCode::InvalidState
    );
    ctx.accounts.weekly_challenge.closed_players = ctx
        .accounts
        .weekly_challenge
        .closed_players
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        ctx.accounts.weekly_challenge.closed_players <= ctx.accounts.weekly_challenge.participants,
        ErrorCode::AccountingInvariant
    );
    emit!(WeeklyPlayerClosed {
        challenge: ctx.accounts.weekly_challenge.key(),
        owner: ctx.accounts.owner.key(),
    });
    Ok(())
}

fn weekly_player_close_allowed(
    status: WeeklyStatus,
    rank: Option<usize>,
    sol_winner_count: u8,
    cube_winner_count: u8,
    sol_claimed: bool,
    cubes_claimed: bool,
) -> bool {
    if status == WeeklyStatus::Closed {
        return true;
    }
    if status != WeeklyStatus::Claimable {
        return false;
    }
    let sol_winner = rank.is_some_and(|rank| rank < usize::from(sol_winner_count));
    let cube_start = SEASON_SOL_WEIGHTS.len();
    let cube_limit = cube_start + usize::from(cube_winner_count);
    let cube_winner = rank.is_some_and(|rank| rank >= cube_start && rank < cube_limit);
    (!sol_winner || sol_claimed) && (!cube_winner || cubes_claimed)
}

#[derive(Accounts)]
pub struct CloseWeeklyChallenge<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        close = rent_recipient,
        seeds = [SEASON_CHALLENGE_SEED, weekly_challenge.weekly_id.to_le_bytes().as_ref()],
        bump = weekly_challenge.bump
    )]
    pub weekly_challenge: Box<Account<'info, WeeklyChallenge>>,
    #[account(
        mut,
        close = rent_recipient,
        seeds = [SEASON_LEADERBOARD_SEED, weekly_challenge.key().as_ref()],
        bump = leaderboard.bump,
        constraint = leaderboard.challenge == weekly_challenge.key() @ ErrorCode::InvalidRunId
    )]
    pub leaderboard: Box<Account<'info, WeeklyLeaderboard>>,
    /// CHECK: Pinned when the challenge was opened.
    #[account(mut, address = weekly_challenge.rent_recipient @ ErrorCode::InvalidOwner)]
    pub rent_recipient: UncheckedAccount<'info>,
    #[account(mut)]
    pub caller: Signer<'info>,
}

pub fn handler_close_weekly_challenge(ctx: Context<CloseWeeklyChallenge>) -> Result<()> {
    require!(
        ctx.accounts.weekly_challenge.status == WeeklyStatus::Closed,
        ErrorCode::InvalidState
    );
    require!(
        ctx.accounts.weekly_challenge.closed_players == ctx.accounts.weekly_challenge.participants,
        ErrorCode::AccountingInvariant
    );
    require!(
        spendable_lamports(&ctx.accounts.weekly_challenge.to_account_info())? == 0,
        ErrorCode::AccountingInvariant
    );
    validate_closed_weekly_dailies(
        ctx.accounts.weekly_challenge.weekly_id,
        ctx.remaining_accounts,
    )?;

    emit!(WeeklyChallengeClosed {
        challenge: ctx.accounts.weekly_challenge.key(),
        weekly_id: ctx.accounts.weekly_challenge.weekly_id,
    });
    Ok(())
}

fn validate_closed_weekly_dailies(
    weekly_id: u32,
    daily_accounts: &[AccountInfo<'_>],
) -> Result<()> {
    require!(
        daily_accounts.len() == SEASON_DAILY_RESULTS,
        ErrorCode::InvalidState
    );
    let start_day = weekly_id
        .checked_mul(SEASON_DAILY_RESULTS as u32)
        .and_then(|day| day.checked_sub(3))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    for (offset, account) in daily_accounts.iter().enumerate() {
        let day_id = start_day
            .checked_add(u32::try_from(offset).map_err(|_| ErrorCode::ArithmeticOverflow)?)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        let (expected, _) = Pubkey::find_program_address(
            &[DAILY_CHALLENGE_SEED, &day_id.to_le_bytes()],
            &crate::ID,
        );
        require_keys_eq!(account.key(), expected, ErrorCode::InvalidRunId);
        require!(account.data_is_empty(), ErrorCode::InvalidState);
        require_keys_eq!(*account.owner, system_program::ID, ErrorCode::InvalidOwner);
    }
    Ok(())
}

fn validate_daily_rules(args: &PublishDailyRulesArgs) -> Result<()> {
    require!(
        args.content_version > 0
            && args.rules_version > 0
            && args.weekly_id > 0
            && args.weekly_seed != [0; 32]
            && usize::from(args.scoring_rule_count) >= DAILY_SCORE_FAMILY_COUNT
            && usize::from(args.scoring_rule_count) <= DAILY_SCORE_RULE_CAPACITY,
        ErrorCode::InvalidState
    );
    DailyRulesCatalog {
        version: ECONOMY_ACCOUNT_VERSION,
        rules_version: args.rules_version,
        economy_config: Pubkey::default(),
        content_version: args.content_version,
        catalog_hash: [0; 32],
        weekly_id: args.weekly_id,
        starts_day: args.starts_day,
        weekly_seed: args.weekly_seed,
        scoring_rule_count: args.scoring_rule_count,
        scoring_rules: args.scoring_rules,
        pressure: args.pressure,
        bump: 0,
    }
    .validate()
}

fn hash_daily_rules(args: &PublishDailyRulesArgs) -> Result<[u8; 32]> {
    let mut serialized = Vec::new();
    args.serialize(&mut serialized)?;
    Ok(sha256v(&[b"zkube-daily-weekly-v1", &serialized]))
}

fn neutral_daily_rules(pressure: DailyPressureProfile) -> LevelRuleSnapshot {
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

fn hash_daily_challenge(
    catalog: &DailyRulesCatalog,
    day_id: u32,
    map_id: u8,
    scoring_rule: DailyScoringRule,
) -> Result<[u8; 32]> {
    let mut rule = Vec::new();
    scoring_rule.serialize(&mut rule)?;
    let day = day_id.to_le_bytes();
    Ok(sha256v(&[
        b"zkube-daily-challenge-v1",
        &catalog.catalog_hash,
        &day,
        &[map_id],
        &rule,
    ]))
}

#[event]
pub struct EconomyConfigured {
    pub economy_config: Pubkey,
    pub content_version: u32,
    pub daily_rules_version: u32,
}

#[event]
pub struct EconomyPricesUpdated {
    pub revision: u64,
    pub prices: [u64; CUBE_PACK_COUNT],
    pub enabled: [bool; CUBE_PACK_COUNT],
}

#[event]
pub struct EconomyCubePacksUpdated {
    pub revision: u64,
    pub cubes: [u64; CUBE_PACK_COUNT],
    pub prices: [u64; CUBE_PACK_COUNT],
    pub enabled: [bool; CUBE_PACK_COUNT],
}

#[event]
pub struct EconomySaleScheduled {
    pub revision: u64,
    pub starts_at: i64,
    pub ends_at: i64,
    pub prices: [u64; CUBE_PACK_COUNT],
}

#[event]
pub struct EconomySaleCancelled {
    pub revision: u64,
}

#[event]
pub struct RevenueSplitScheduled {
    pub revision: u64,
    pub activates_weekly: u32,
    pub team_bps: u16,
    pub pot_bps: u16,
    pub treasury_bps: u16,
}

#[event]
pub struct DailyRulesPublished {
    pub catalog: Pubkey,
    pub rules_version: u32,
    pub catalog_hash: [u8; 32],
}

#[event]
pub struct CubesPurchased {
    pub owner: Pubkey,
    pub pack_index: u8,
    pub config_revision: u64,
    pub cubes: u64,
    pub gross: u64,
    pub team: u64,
    pub reward: u64,
    pub treasury: u64,
}

#[event]
pub struct DailyOpened {
    pub challenge: Pubkey,
    pub day_id: u32,
    pub rules_weekly_id: u32,
    pub weekly_id: u32,
    pub map_id: u8,
    pub scoring_rule: DailyScoringRule,
    pub rules_hash: [u8; 32],
}

#[event]
pub struct DailyEntered {
    pub challenge: Pubkey,
    pub owner: Pubkey,
    pub run_id: u64,
    pub attempt: u32,
    pub cubes_spent: u64,
}

#[event]
pub struct DailyPressureMasteryAwarded {
    pub challenge: Pubkey,
    pub owner: Pubkey,
    pub pressure_tier: u8,
    pub xp: u32,
}

#[event]
pub struct DailyFinalized {
    pub challenge: Pubkey,
    pub day_id: u32,
    pub participants: u32,
    pub finalized_runs: u64,
}

#[event]
pub struct DailyPlayerClosed {
    pub challenge: Pubkey,
    pub owner: Pubkey,
}

#[event]
pub struct DailyChallengeClosed {
    pub challenge: Pubkey,
    pub day_id: u32,
}

#[event]
pub struct WeeklyOpened {
    pub challenge: Pubkey,
    pub weekly_id: u32,
    pub sol_pool: u64,
}

#[event]
pub struct WeeklyFunded {
    pub challenge: Pubkey,
    pub funder: Pubkey,
    pub lamports: u64,
}

#[event]
pub struct DailyRolledUp {
    pub owner: Pubkey,
    pub day_id: u32,
    pub weekly_id: u32,
    pub points: u16,
    pub weekly_score: u16,
}

#[event]
pub struct WeeklyFinalized {
    pub challenge: Pubkey,
    pub weekly_id: u32,
    pub participants: u32,
    pub sol_winner_count: u8,
    pub cube_winner_count: u8,
    pub sol_pool: u64,
}

#[event]
pub struct WeeklyCubesClaimed {
    pub owner: Pubkey,
    pub weekly_id: u32,
    pub rank: u8,
    pub cubes: u64,
}

#[event]
pub struct WeeklySolClaimed {
    pub owner: Pubkey,
    pub weekly_id: u32,
    pub rank: u8,
    pub amount: u64,
}

#[event]
pub struct WeeklySolForfeited {
    pub weekly_id: u32,
    pub amount: u64,
}

#[event]
pub struct WeeklyPlayerClosed {
    pub challenge: Pubkey,
    pub owner: Pubkey,
}

#[event]
pub struct WeeklyChallengeClosed {
    pub challenge: Pubkey,
    pub weekly_id: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::ToAccountMetas;

    #[test]
    fn daily_consumer_is_permissionless_and_has_no_action_escrow() {
        let owner = Pubkey::new_unique();
        let metas = crate::accounts::ConsumeDailyRun {
            active_run: Pubkey::new_unique(),
            player_state: Pubkey::new_unique(),
            daily_challenge: Pubkey::new_unique(),
            daily_player: Pubkey::new_unique(),
            leaderboard: Pubkey::new_unique(),
            owner,
            rent_recipient: Pubkey::new_unique(),
        }
        .to_account_metas(None);

        assert_eq!(metas.len(), 7);
        assert_eq!(metas[5].pubkey, owner);
        assert!(metas.iter().all(|meta| !meta.is_signer));
    }

    fn daily_player() -> DailyPlayer {
        DailyPlayer {
            version: ECONOMY_ACCOUNT_VERSION,
            challenge: Pubkey::new_unique(),
            player: Pubkey::new_unique(),
            attempts: 1,
            paid_attempts: 0,
            finalized_attempts: 0,
            best_run_id: 0,
            best_daily_score: 0,
            best_daily_bonus_triggers: 0,
            best_engine_score: 0,
            best_moves: 0,
            best_submitted_at: 0,
            daily_xp_awarded: false,
            pressure_mastery_xp_awarded: false,
            weekly_rolled_up: false,
            cube_refunded: false,
            bump: 1,
        }
    }

    #[test]
    fn daily_progression_xp_awards_participation_and_tier_seven_once() {
        let mut player = daily_player();
        assert_eq!(daily_progression_xp(&mut player, 3).unwrap(), (100, false));
        assert_eq!(daily_progression_xp(&mut player, 7).unwrap(), (50, true));
        assert_eq!(daily_progression_xp(&mut player, 7).unwrap(), (0, false));
    }

    #[test]
    fn weekly_finalization_requires_every_eligible_daily_rollup() {
        assert!(daily_rollups_complete(&DailyStatus::Claimable, 0, 0));
        assert!(daily_rollups_complete(&DailyStatus::Claimable, 7, 7));
        assert!(!daily_rollups_complete(&DailyStatus::Claimable, 7, 6));
        assert!(daily_rollups_complete(&DailyStatus::Cancelled, 7, 0));
        assert!(!daily_rollups_complete(&DailyStatus::Cancelled, 7, 1));
        assert!(!daily_rollups_complete(&DailyStatus::Open, 0, 0));
    }

    #[test]
    fn daily_cleanup_preserves_rollups_and_cancelled_refunds() {
        assert!(daily_player_close_allowed(
            DailyStatus::Claimable,
            1,
            1,
            0,
            false,
            false
        ));
        assert!(!daily_player_close_allowed(
            DailyStatus::Claimable,
            1,
            1,
            7,
            false,
            false
        ));
        assert!(daily_player_close_allowed(
            DailyStatus::Claimable,
            1,
            1,
            7,
            true,
            false
        ));
        assert!(!daily_player_close_allowed(
            DailyStatus::Cancelled,
            1,
            1,
            7,
            false,
            false
        ));
        assert!(daily_player_close_allowed(
            DailyStatus::Cancelled,
            1,
            1,
            7,
            false,
            true
        ));
        assert!(!daily_player_close_allowed(
            DailyStatus::Open,
            1,
            1,
            0,
            false,
            true
        ));
        assert!(!daily_player_close_allowed(
            DailyStatus::Claimable,
            2,
            1,
            7,
            true,
            false
        ));
    }

    #[test]
    fn weekly_cleanup_preserves_each_unclaimed_prize() {
        assert!(!weekly_player_close_allowed(
            WeeklyStatus::Open,
            None,
            3,
            5,
            true,
            true,
        ));
        assert!(weekly_player_close_allowed(
            WeeklyStatus::Claimable,
            None,
            3,
            5,
            false,
            false,
        ));
        assert!(!weekly_player_close_allowed(
            WeeklyStatus::Claimable,
            Some(0),
            3,
            5,
            false,
            true,
        ));
        assert!(weekly_player_close_allowed(
            WeeklyStatus::Claimable,
            Some(0),
            3,
            5,
            true,
            false,
        ));
        assert!(weekly_player_close_allowed(
            WeeklyStatus::Claimable,
            Some(0),
            3,
            5,
            true,
            true,
        ));
        assert!(weekly_player_close_allowed(
            WeeklyStatus::Closed,
            Some(0),
            3,
            5,
            false,
            false,
        ));
    }
}
