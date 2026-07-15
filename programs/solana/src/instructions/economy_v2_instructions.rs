use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};
use ephemeral_rollups_sdk::anchor::{action, commit};
use ephemeral_rollups_sdk::ephem::{CallHandler, FoldableIntentBuilder, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::{ActionArgs, ShortAccountMeta};
use session_keys::SessionTokenV2;
use sha2::{Digest, Sha256};

use crate::error::ErrorCode;
use crate::instructions::player_authorization::require_player_authorization;
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
        space = 8 + StarSalesLedger::INIT_SPACE,
        seeds = [STAR_SALES_LEDGER_SEED],
        bump
    )]
    pub star_sales_ledger: Box<Account<'info, StarSalesLedger>>,
    #[account(address = protocol.payment_mint)]
    pub payment_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_initialize_economy(
    ctx: Context<InitializeEconomy>,
    args: InitializeEconomyArgs,
) -> Result<()> {
    require!(args.daily_rules_version > 0, ErrorCode::InvalidState);
    require!(
        ctx.accounts.payment_mint.decimals == 6,
        ErrorCode::InvalidState
    );
    let config = EconomyConfig::canonical(
        ctx.accounts.protocol.key(),
        ctx.accounts.protocol.payment_mint,
        ctx.accounts.protocol.payment_token_program,
        ctx.accounts.protocol.content_version,
        args.daily_rules_version,
        ctx.bumps.economy_config,
    );
    config.validate()?;
    ctx.accounts.economy_config.set_inner(config);
    ctx.accounts.star_sales_ledger.set_inner(StarSalesLedger {
        version: ECONOMY_ACCOUNT_VERSION,
        economy_config: ctx.accounts.economy_config.key(),
        payment_mint: ctx.accounts.protocol.payment_mint,
        lifetime_gross_sales: 0,
        lifetime_team_share: 0,
        lifetime_reward_share: 0,
        lifetime_treasury_share: 0,
        lifetime_stars_sold: 0,
        purchase_count: 0,
        bump: ctx.bumps.star_sales_ledger,
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
    pub prices: [u64; STAR_PACK_COUNT],
    pub enabled: [bool; STAR_PACK_COUNT],
}

#[derive(Accounts)]
pub struct ManageEconomyPricing<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.pricing_operator == pricing_operator.key() @ ErrorCode::Unauthorized
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [ECONOMY_CONFIG_SEED],
        bump = economy_config.bump,
        constraint = economy_config.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = economy_config.active @ ErrorCode::InvalidState
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
    ctx.accounts.economy_config.star_pack_prices = args.prices;
    ctx.accounts.economy_config.star_pack_enabled = args.enabled;
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

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScheduleSaleArgs {
    pub starts_at: i64,
    pub ends_at: i64,
    pub prices: [u64; STAR_PACK_COUNT],
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
    ctx.accounts.economy_config.sale_prices = [0; STAR_PACK_COUNT];
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
    pub rules_version: u32,
    pub season_id: u32,
    pub starts_day: u32,
    pub season_seed: [u8; 32],
    pub scoring_rule_count: u8,
    pub scoring_rules: [DailyScoringRule; DAILY_SCORE_RULE_CAPACITY],
    pub pressure: DailyPressureProfile,
}

#[derive(Accounts)]
#[instruction(args: PublishDailyRulesArgs)]
pub struct PublishDailyRules<'info> {
    #[account(
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [ECONOMY_CONFIG_SEED],
        bump = economy_config.bump,
        constraint = economy_config.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = economy_config.active @ ErrorCode::InvalidState,
        constraint = economy_config.daily_rules_version == args.rules_version @ ErrorCode::ContentVersionMismatch
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
    validate_daily_rules(&args)?;
    let catalog_hash = hash_daily_rules(&args)?;
    ctx.accounts
        .daily_rules_catalog
        .set_inner(DailyRulesCatalog {
            version: ECONOMY_ACCOUNT_VERSION,
            rules_version: args.rules_version,
            economy_config: ctx.accounts.economy_config.key(),
            content_version: ctx.accounts.economy_config.content_version,
            catalog_hash,
            season_id: args.season_id,
            starts_day: args.starts_day,
            season_seed: args.season_seed,
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
pub struct PurchaseStars<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [ECONOMY_CONFIG_SEED],
        bump = economy_config.bump,
        constraint = economy_config.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = economy_config.active @ ErrorCode::InvalidState,
        constraint = economy_config.content_version == protocol.content_version @ ErrorCode::ContentVersionMismatch
    )]
    pub economy_config: Box<Account<'info, EconomyConfig>>,
    #[account(
        mut,
        seeds = [STAR_SALES_LEDGER_SEED],
        bump = star_sales_ledger.bump,
        constraint = star_sales_ledger.economy_config == economy_config.key() @ ErrorCode::InvalidOwner
    )]
    pub star_sales_ledger: Box<Account<'info, StarSalesLedger>>,
    #[account(
        mut,
        seeds = [PLAYER_PROFILE_SEED, owner.key().as_ref()],
        bump = player_profile.bump,
        has_one = owner @ ErrorCode::Unauthorized
    )]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    #[account(address = protocol.payment_mint)]
    pub payment_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = owner,
    )]
    pub player_payment_account: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        address = protocol.team_destination,
        token::mint = payment_mint,
        constraint = team_destination.owner != protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub team_destination: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        address = protocol.reward_vault,
        token::mint = payment_mint,
        token::authority = protocol,
    )]
    pub reward_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        address = protocol.treasury_destination,
        token::mint = payment_mint,
        constraint = treasury_destination.owner != protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub treasury_destination: Box<Account<'info, TokenAccount>>,
    #[account(address = protocol.payment_token_program)]
    pub token_program: Program<'info, Token>,
    pub owner: Signer<'info>,
}

pub fn handler_purchase_stars<'info>(
    ctx: Context<'info, PurchaseStars<'info>>,
    pack_index: u8,
    expected_stars: u64,
    max_usdc_amount: u64,
) -> Result<()> {
    let (stars, gross) = ctx
        .accounts
        .economy_config
        .quote(pack_index, Clock::get()?.unix_timestamp)?;
    require!(stars == expected_stars, ErrorCode::InvalidPack);
    require!(gross <= max_usdc_amount, ErrorCode::PriceChanged);
    let (team, reward, treasury) = ctx.accounts.economy_config.split_sale(gross)?;
    transfer_from_player(&ctx, ctx.accounts.team_destination.to_account_info(), team)?;
    transfer_from_player(&ctx, ctx.accounts.reward_vault.to_account_info(), reward)?;
    transfer_from_player(
        &ctx,
        ctx.accounts.treasury_destination.to_account_info(),
        treasury,
    )?;
    ctx.accounts
        .star_sales_ledger
        .record_sale(gross, team, reward, treasury, stars)?;
    ctx.accounts.player_profile.credit_stars(stars)?;
    emit!(StarsPurchased {
        owner: ctx.accounts.owner.key(),
        pack_index,
        config_revision: ctx.accounts.economy_config.revision,
        stars,
        gross,
        team,
        reward,
        treasury,
    });
    Ok(())
}

fn transfer_from_player<'info>(
    ctx: &Context<'info, PurchaseStars<'info>>,
    destination: AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.player_payment_account.to_account_info(),
                mint: ctx.accounts.payment_mint.to_account_info(),
                to: destination,
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.payment_mint.decimals,
    )
}

#[derive(Accounts)]
pub struct UnlockZone<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [ECONOMY_CONFIG_SEED],
        bump = economy_config.bump,
        constraint = economy_config.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = economy_config.active @ ErrorCode::InvalidState,
        constraint = economy_config.content_version == protocol.content_version @ ErrorCode::ContentVersionMismatch
    )]
    pub economy_config: Box<Account<'info, EconomyConfig>>,
    #[account(
        mut,
        seeds = [PLAYER_PROFILE_SEED, owner_authority.key().as_ref()],
        bump = player_profile.bump,
        constraint = player_profile.owner == owner_authority.key() @ ErrorCode::Unauthorized
    )]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    #[account(
        mut,
        seeds = [CAMPAIGN_PROGRESS_SEED, owner_authority.key().as_ref()],
        bump = campaign_progress.bump,
        constraint = campaign_progress.owner == owner_authority.key() @ ErrorCode::Unauthorized
    )]
    pub campaign_progress: Box<Account<'info, CampaignProgress>>,
    #[account(
        seeds = [MAP_CATALOG_SEED, protocol.content_version.to_le_bytes().as_ref(), &[map_catalog.map_id]],
        bump = map_catalog.bump,
        constraint = map_catalog.enabled @ ErrorCode::MapDisabled,
        constraint = map_catalog.content_version == economy_config.content_version @ ErrorCode::ContentVersionMismatch
    )]
    pub map_catalog: Box<Account<'info, MapCatalog>>,
    /// CHECK: Immutable durable player identity, constrained above.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
}

pub fn handler_unlock_zone(ctx: Context<UnlockZone>) -> Result<()> {
    require_player_authorization(
        ctx.accounts.owner_authority.key(),
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    let map_id = ctx.accounts.map_catalog.map_id;
    require!(
        (2..=ctx.accounts.protocol.campaign_map_count).contains(&map_id),
        ErrorCode::InvalidMap
    );
    require!(
        !ctx.accounts.campaign_progress.is_map_unlocked(map_id),
        ErrorCode::MapAlreadyUnlocked
    );
    ctx.accounts
        .player_profile
        .spend_stars(ctx.accounts.economy_config.zone_unlock_stars)?;
    ctx.accounts.campaign_progress.unlock_map(map_id, true)?;
    emit!(ZoneUnlocked {
        owner: ctx.accounts.owner_authority.key(),
        map_id,
        stars_spent: ctx.accounts.economy_config.zone_unlock_stars,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimLevelMilestone<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [ECONOMY_CONFIG_SEED],
        bump = economy_config.bump,
        constraint = economy_config.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = economy_config.active @ ErrorCode::InvalidState,
        constraint = economy_config.content_version == protocol.content_version @ ErrorCode::ContentVersionMismatch
    )]
    pub economy_config: Box<Account<'info, EconomyConfig>>,
    #[account(
        mut,
        seeds = [PLAYER_PROFILE_SEED, owner_authority.key().as_ref()],
        bump = player_profile.bump,
        constraint = player_profile.owner == owner_authority.key() @ ErrorCode::Unauthorized
    )]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + LevelMilestones::INIT_SPACE,
        seeds = [LEVEL_MILESTONES_SEED, owner_authority.key().as_ref()],
        bump
    )]
    pub level_milestones: Box<Account<'info, LevelMilestones>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Immutable durable player identity, constrained above.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_claim_level_milestone(
    ctx: Context<ClaimLevelMilestone>,
    milestone_index: u8,
) -> Result<()> {
    require_player_authorization(
        ctx.accounts.owner_authority.key(),
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    let index = usize::from(milestone_index);
    require!(index < LEVEL_MILESTONE_COUNT, ErrorCode::InvalidLevel);
    let milestones = &mut ctx.accounts.level_milestones;
    if milestones.version == 0 {
        milestones.version = ECONOMY_ACCOUNT_VERSION;
        milestones.owner = ctx.accounts.owner_authority.key();
        milestones.claimed = 0;
        milestones.total_stars_claimed = 0;
        milestones.bump = ctx.bumps.level_milestones;
    } else {
        require_keys_eq!(
            milestones.owner,
            ctx.accounts.owner_authority.key(),
            ErrorCode::Unauthorized
        );
        require!(
            milestones.version == ECONOMY_ACCOUNT_VERSION,
            ErrorCode::InvalidVersion
        );
    }
    let mask = 1u16 << index;
    require!(
        milestones.claimed & mask == 0,
        ErrorCode::RewardAlreadyClaimed
    );
    let required_level = (milestone_index + 1) * 10;
    let current_level = player_level(ctx.accounts.player_profile.lifetime_xp);
    require!(current_level >= required_level, ErrorCode::RewardNotEarned);
    milestones.claimed |= mask;
    milestones.total_stars_claimed = milestones
        .total_stars_claimed
        .checked_add(10)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    ctx.accounts.player_profile.credit_stars(10)?;
    emit!(LevelMilestoneClaimed {
        owner: ctx.accounts.owner_authority.key(),
        level: required_level,
        stars: 10,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(day_id: u32)]
pub struct OpenDailyChallenge<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [ECONOMY_CONFIG_SEED],
        bump = economy_config.bump,
        constraint = economy_config.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = economy_config.active @ ErrorCode::InvalidState,
        constraint = economy_config.content_version == protocol.content_version @ ErrorCode::ContentVersionMismatch
    )]
    pub economy_config: Box<Account<'info, EconomyConfig>>,
    #[account(
        seeds = [DAILY_RULES_CATALOG_SEED, economy_config.daily_rules_version.to_le_bytes().as_ref()],
        bump = daily_rules_catalog.bump,
        constraint = daily_rules_catalog.economy_config == economy_config.key() @ ErrorCode::InvalidOwner
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
        week_id: weekly_id_for_day(day_id),
        economy_config: ctx.accounts.economy_config.key(),
        rules_version: catalog.rules_version,
        status: DailyStatus::Open,
        content_version: catalog.content_version,
        catalog_hash: catalog.catalog_hash,
        rules_hash,
        season_id: catalog.season_id,
        map_id,
        scoring_rule,
        rules,
        pressure: catalog.pressure,
        opens_at,
        entries_close_at,
        runs_close_at,
        settlement_grace_close_at,
        finalized_at: 0,
        entry_stars: ctx.accounts.economy_config.daily_entry_stars,
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
        week_id: weekly_id_for_day(day_id),
        season_id: catalog.season_id,
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
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [ECONOMY_CONFIG_SEED],
        bump = economy_config.bump,
        constraint = economy_config.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = economy_config.active @ ErrorCode::InvalidState,
        constraint = economy_config.content_version == protocol.content_version @ ErrorCode::ContentVersionMismatch
    )]
    pub economy_config: Box<Account<'info, EconomyConfig>>,
    #[account(
        mut,
        seeds = [PLAYER_PROFILE_SEED, owner_authority.key().as_ref()],
        bump = player_profile.bump,
        constraint = player_profile.owner == owner_authority.key() @ ErrorCode::Unauthorized,
        constraint = player_profile.daily_eligible @ ErrorCode::MapLocked
    )]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    #[account(
        mut,
        seeds = [DAILY_CHALLENGE_SEED, daily_challenge.day_id.to_le_bytes().as_ref()],
        bump = daily_challenge.bump,
        constraint = daily_challenge.economy_config == economy_config.key() @ ErrorCode::InvalidOwner
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
        init_if_needed,
        payer = payer,
        space = 8 + WeeklyStipend::INIT_SPACE,
        seeds = [WEEKLY_STIPEND_SEED, owner_authority.key().as_ref()],
        bump
    )]
    pub weekly_stipend: Box<Account<'info, WeeklyStipend>>,
    #[account(
        init,
        payer = payer,
        space = 8 + RunShell::INIT_SPACE,
        seeds = [RUN_SHELL_SEED, owner_authority.key().as_ref(), run_id.to_le_bytes().as_ref()],
        bump
    )]
    pub run_shell: Box<Account<'info, RunShell>>,
    #[account(
        init,
        payer = payer,
        space = 8 + ActiveRun::INIT_SPACE,
        seeds = [RUN_SHELL_SEED, b"active", owner_authority.key().as_ref(), run_id.to_le_bytes().as_ref()],
        bump
    )]
    pub active_run: Box<Account<'info, ActiveRun>>,
    #[account(
        init,
        payer = payer,
        space = 8 + RunReceipt::INIT_SPACE,
        seeds = [RUN_RECEIPT_SEED, owner_authority.key().as_ref(), run_id.to_le_bytes().as_ref()],
        bump
    )]
    pub run_receipt: Box<Account<'info, RunReceipt>>,
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
        ctx.accounts.player_profile.next_run_id == run_id,
        ErrorCode::InvalidRunId
    );
    require!(
        ctx.accounts.daily_challenge.entry_stars == ctx.accounts.economy_config.daily_entry_stars,
        ErrorCode::AccountingInvariant
    );
    crate::instructions::progress_instructions::initialize_or_roll_stipend(
        &mut ctx.accounts.weekly_stipend,
        ctx.accounts.owner_authority.key(),
        cadence_week(now),
        ctx.bumps.weekly_stipend,
    )?;

    let daily_player = &mut ctx.accounts.daily_player;
    if daily_player.version == 0 {
        daily_player.version = ECONOMY_ACCOUNT_VERSION;
        daily_player.challenge = ctx.accounts.daily_challenge.key();
        daily_player.player = ctx.accounts.owner_authority.key();
        daily_player.attempts = 0;
        daily_player.finalized_attempts = 0;
        daily_player.best_run_id = 0;
        daily_player.best_receipt = Pubkey::default();
        daily_player.best_daily_score = 0;
        daily_player.best_engine_score = 0;
        daily_player.best_moves = 0;
        daily_player.best_submitted_at = 0;
        daily_player.daily_xp_awarded = false;
        daily_player.pressure_mastery_xp_awarded = false;
        daily_player.weekly_rolled_up = false;
        daily_player.star_refunded = false;
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
    ctx.accounts
        .player_profile
        .spend_stars(ctx.accounts.daily_challenge.entry_stars)?;
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
        &mut ctx.accounts.player_profile,
        &ctx.accounts.daily_challenge,
        challenge_key,
        &mut ctx.accounts.run_shell,
        &mut ctx.accounts.active_run,
        &mut ctx.accounts.run_receipt,
        DailyRunBumps {
            shell: ctx.bumps.run_shell,
            active: ctx.bumps.active_run,
            receipt: ctx.bumps.run_receipt,
        },
        ctx.accounts.owner_authority.key(),
        run_id,
        now,
    )?;
    emit!(DailyEntered {
        challenge: challenge_key,
        owner: ctx.accounts.owner_authority.key(),
        run_id,
        attempt: daily_player.attempts,
        stars_spent: ctx.accounts.daily_challenge.entry_stars,
    });
    Ok(())
}

struct DailyRunBumps {
    shell: u8,
    active: u8,
    receipt: u8,
}

#[allow(clippy::too_many_arguments)]
fn initialize_daily_run(
    player: &mut PlayerProfile,
    challenge: &DailyChallenge,
    challenge_key: Pubkey,
    shell: &mut RunShell,
    active: &mut ActiveRun,
    receipt: &mut RunReceipt,
    bumps: DailyRunBumps,
    owner: Pubkey,
    run_id: u64,
    now: i64,
) -> Result<()> {
    let shell_key = Pubkey::find_program_address(
        &[RUN_SHELL_SEED, owner.as_ref(), &run_id.to_le_bytes()],
        &crate::ID,
    )
    .0;
    shell.version = ACCOUNT_VERSION;
    shell.owner = owner;
    shell.run_id = run_id;
    shell.mode = RunMode::Daily;
    shell.settlement_target = SettlementTarget::DailyLeaderboard;
    shell.content_version = challenge.content_version;
    shell.rules_hash = challenge.rules_hash;
    shell.map_catalog = Pubkey::default();
    shell.daily_challenge = challenge_key;
    shell.delegated_validator = Pubkey::default();
    shell.lifecycle = RunLifecycle::Prepared;
    shell.created_at = now;
    shell.settled_at = 0;
    shell.bump = bumps.shell;

    active.version = ACCOUNT_VERSION;
    active.owner = owner;
    active.run_shell = shell_key;
    active.daily_challenge = challenge_key;
    active.run_id = run_id;
    active.mode = RunMode::Daily;
    active.lifecycle = RunLifecycle::Prepared;
    active.content_version = challenge.content_version;
    active.rules_hash = challenge.rules_hash;
    active.map_id = challenge.map_id;
    active.level = 1;
    active.rules = challenge.rules;
    active.grid = [0; 80];
    active.next_row = [0; 8];
    active.has_next_row = false;
    active.score = 0;
    active.daily_score = 0;
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
    active.vrf_requested_at = 0;
    active.action_hash = [0; 32];
    active.vrf_hash = [0; 32];
    active.started_at = 0;
    active.finished_at = 0;
    active.bump = bumps.active;

    receipt.version = ACCOUNT_VERSION;
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
    receipt.daily_score = 0;
    receipt.pressure_score = 0;
    receipt.final_pressure_tier = 0;
    receipt.daily_scoring_rule = challenge.scoring_rule;
    receipt.moves = 0;
    receipt.level_stars = 0;
    receipt.lines_cleared = 0;
    receipt.bonus_uses = 0;
    receipt.combo2_hits = 0;
    receipt.combo3_hits = 0;
    receipt.combo4_hits = 0;
    receipt.high_combo_hits = 0;
    receipt.blocks_destroyed_by_size = [0; 4];
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
    /// CHECK: Weekly stipend PDA written only by the base-layer action.
    #[account(seeds = [WEEKLY_STIPEND_SEED, active_run.owner.as_ref()], bump)]
    pub weekly_stipend: UncheckedAccount<'info>,
    /// CHECK: Player wallet pinned by active_run.
    #[account(address = active_run.owner @ ErrorCode::Unauthorized)]
    pub owner: UncheckedAccount<'info>,
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
    let action_data =
        anchor_lang::InstructionData::data(&crate::instruction::ConsumeDailyReceipt {});
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
            short_meta(ctx.accounts.weekly_stipend.key(), true),
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
pub struct ConsumeDailyReceipt<'info> {
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
    #[account(
        mut,
        seeds = [WEEKLY_STIPEND_SEED, owner.key().as_ref()],
        bump = weekly_stipend.bump,
        constraint = weekly_stipend.version == ECONOMY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = weekly_stipend.owner == owner.key() @ ErrorCode::Unauthorized
    )]
    pub weekly_stipend: Box<Account<'info, WeeklyStipend>>,
    /// CHECK: Player identity pinned by every durable account.
    pub owner: UncheckedAccount<'info>,
}

pub fn handler_consume_daily_receipt(ctx: Context<ConsumeDailyReceipt>) -> Result<()> {
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
    receipt.daily_score = active.daily_score;
    receipt.pressure_score = active.pressure_score;
    receipt.final_pressure_tier = active.current_difficulty;
    receipt.daily_scoring_rule = active.daily_scoring_rule;
    receipt.moves = active.moves;
    receipt.level_stars = 0;
    receipt.lines_cleared = active.total_lines_cleared;
    receipt.bonus_uses = active.bonus_uses;
    receipt.combo2_hits = active.combo2_hits;
    receipt.combo3_hits = active.combo3_hits;
    receipt.combo4_hits = active.combo4_hits;
    receipt.high_combo_hits = active.high_combo_hits;
    receipt.blocks_destroyed_by_size = active.blocks_destroyed_by_size;
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
            blocks_destroyed_by_size: receipt.blocks_destroyed_by_size,
            max_combo: receipt.max_combo,
            campaign_level_completed: false,
            new_perfect_level: false,
            boss_cleared: false,
        },
        receipt.consumed_at,
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
            .player_profile
            .credit_progression_rewards(0, xp_awarded)?;
        let week = cadence_week(receipt.consumed_at);
        ctx.accounts
            .weekly_stipend
            .record_recurring_xp(week, xp_awarded)?;
        crate::instructions::progress_instructions::emit_stipend_if_awarded(
            &mut ctx.accounts.weekly_stipend,
            &mut ctx.accounts.player_profile,
        )?;
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
        receipt: receipt.key(),
        run_id: active.run_id,
        daily_score: active.daily_score,
        engine_score: active.score,
        moves: active.moves,
        submitted_at: active.finished_at,
    };
    let current = DailyLeaderboardEntry {
        player: active.owner,
        receipt: player.best_receipt,
        run_id: player.best_run_id,
        daily_score: player.best_daily_score,
        engine_score: player.best_engine_score,
        moves: player.best_moves,
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
        player.best_receipt = receipt.key();
        player.best_daily_score = active.daily_score;
        player.best_engine_score = active.score;
        player.best_moves = active.moves;
        player.best_submitted_at = active.finished_at;
        ctx.accounts.leaderboard.record_best(candidate);
    }
    ctx.accounts.run_shell.lifecycle = RunLifecycle::Settled;
    ctx.accounts.run_shell.settled_at = receipt.consumed_at;
    ctx.accounts.active_run.lifecycle = RunLifecycle::Settled;
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
pub struct RefundDailyStars<'info> {
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
        seeds = [PLAYER_PROFILE_SEED, owner_authority.key().as_ref()],
        bump = player_profile.bump,
        constraint = player_profile.owner == owner_authority.key() @ ErrorCode::Unauthorized
    )]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    /// CHECK: Immutable durable player identity, constrained above.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
}

pub fn handler_refund_daily_stars(ctx: Context<RefundDailyStars>) -> Result<()> {
    require_player_authorization(
        ctx.accounts.owner_authority.key(),
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    require!(
        !ctx.accounts.daily_player.star_refunded,
        ErrorCode::RefundAlreadyClaimed
    );
    let refund = u64::from(ctx.accounts.daily_player.attempts)
        .checked_mul(ctx.accounts.daily_challenge.entry_stars)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(refund > 0, ErrorCode::InsufficientFunds);
    ctx.accounts.player_profile.refund_stars(refund)?;
    ctx.accounts.daily_player.star_refunded = true;
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
        seeds = [WEEKLY_CHALLENGE_SEED, daily_challenge.week_id.to_le_bytes().as_ref()],
        bump = weekly_challenge.bump,
        constraint = weekly_challenge.week_id == daily_challenge.week_id @ ErrorCode::InvalidState
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
    /// CHECK: Rent destination is pinned to the fee payer that created the account.
    #[account(mut, address = protocol.paymaster @ ErrorCode::Unauthorized)]
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
            ctx.accounts.daily_player.star_refunded,
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
    star_refunded: bool,
) -> bool {
    if attempts != finalized_attempts {
        return false;
    }
    match status {
        DailyStatus::Claimable => best_run_id == 0 || weekly_rolled_up,
        DailyStatus::Cancelled => star_refunded,
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
        seeds = [WEEKLY_CHALLENGE_SEED, daily_challenge.week_id.to_le_bytes().as_ref()],
        bump = weekly_challenge.bump,
        constraint = weekly_challenge.week_id == daily_challenge.week_id @ ErrorCode::InvalidState
    )]
    pub weekly_challenge: Box<Account<'info, WeeklyChallenge>>,
    /// CHECK: Rent destination is pinned to ProtocolConfig.paymaster.
    #[account(mut, address = protocol.paymaster @ ErrorCode::Unauthorized)]
    pub rent_recipient: UncheckedAccount<'info>,
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
#[instruction(week_id: u32)]
pub struct OpenWeeklyChallenge<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [ECONOMY_CONFIG_SEED],
        bump = economy_config.bump,
        constraint = economy_config.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = economy_config.active @ ErrorCode::InvalidState,
        constraint = economy_config.content_version == protocol.content_version @ ErrorCode::ContentVersionMismatch
    )]
    pub economy_config: Box<Account<'info, EconomyConfig>>,
    #[account(
        init,
        payer = payer,
        space = 8 + WeeklyChallenge::INIT_SPACE,
        seeds = [WEEKLY_CHALLENGE_SEED, week_id.to_le_bytes().as_ref()],
        bump
    )]
    pub weekly_challenge: Box<Account<'info, WeeklyChallenge>>,
    #[account(
        init,
        payer = payer,
        space = 8 + WeeklyLeaderboard::INIT_SPACE,
        seeds = [WEEKLY_LEADERBOARD_SEED, weekly_challenge.key().as_ref()],
        bump
    )]
    pub leaderboard: Box<Account<'info, WeeklyLeaderboard>>,
    #[account(address = protocol.payment_mint)]
    pub payment_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        address = protocol.reward_vault,
        token::mint = payment_mint,
        token::authority = protocol,
    )]
    pub reward_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        init,
        payer = payer,
        seeds = [WEEKLY_VAULT_SEED, week_id.to_le_bytes().as_ref()],
        bump,
        token::mint = payment_mint,
        token::authority = weekly_challenge,
    )]
    pub payment_vault: Box<Account<'info, TokenAccount>>,
    #[account(address = protocol.payment_token_program)]
    pub token_program: Program<'info, Token>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_open_weekly_challenge(
    ctx: Context<OpenWeeklyChallenge>,
    week_id: u32,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(cadence_week(now) == week_id, ErrorCode::ChallengeNotStarted);
    let (opens_at, closes_at, finalizes_at) = weekly_window(week_id)?;
    require!(
        now >= opens_at && now < closes_at,
        ErrorCode::ChallengeEnded
    );
    let available = ctx.accounts.reward_vault.amount;
    let pool = if available < ctx.accounts.economy_config.weekly_min_cash_pool {
        0
    } else {
        available.min(ctx.accounts.economy_config.weekly_max_cash_pool)
    };
    if pool > 0 {
        let bump = [ctx.accounts.protocol.bump];
        let signer: &[&[u8]] = &[PROTOCOL_CONFIG_SEED, &bump];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.reward_vault.to_account_info(),
                    mint: ctx.accounts.payment_mint.to_account_info(),
                    to: ctx.accounts.payment_vault.to_account_info(),
                    authority: ctx.accounts.protocol.to_account_info(),
                },
                &[signer],
            ),
            pool,
            ctx.accounts.payment_mint.decimals,
        )?;
    }
    let challenge_key = ctx.accounts.weekly_challenge.key();
    ctx.accounts.weekly_challenge.set_inner(WeeklyChallenge {
        version: ECONOMY_ACCOUNT_VERSION,
        week_id,
        economy_config: ctx.accounts.economy_config.key(),
        payment_mint: ctx.accounts.payment_mint.key(),
        payment_token_program: ctx.accounts.token_program.key(),
        payment_vault: ctx.accounts.payment_vault.key(),
        status: WeeklyStatus::Open,
        opens_at,
        closes_at,
        finalizes_at,
        finalized_at: 0,
        claims_close_at: 0,
        committed_cash_pool: pool,
        cash_claimed: 0,
        cash_forfeited: 0,
        participants: 0,
        closed_players: 0,
        cash_winner_count: 0,
        star_winner_count: 0,
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
        week_id,
        cash_pool: pool,
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
        seeds = [WEEKLY_CHALLENGE_SEED, weekly_challenge.week_id.to_le_bytes().as_ref()],
        bump = weekly_challenge.bump,
        constraint = weekly_challenge.week_id == daily_challenge.week_id @ ErrorCode::InvalidState,
        constraint = weekly_challenge.status == WeeklyStatus::Open @ ErrorCode::InvalidState
    )]
    pub weekly_challenge: Box<Account<'info, WeeklyChallenge>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + WeeklyPlayer::INIT_SPACE,
        seeds = [WEEKLY_PLAYER_SEED, weekly_challenge.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub weekly_player: Box<Account<'info, WeeklyPlayer>>,
    #[account(
        mut,
        seeds = [WEEKLY_LEADERBOARD_SEED, weekly_challenge.key().as_ref()],
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
        weekly_player.results = [WeeklyDailyResult::default(); WEEKLY_DAILY_RESULTS];
        weekly_player.result_count = 0;
        weekly_player.score = 0;
        weekly_player.cash_claimed = false;
        weekly_player.stars_claimed = false;
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
        week_id: ctx.accounts.weekly_challenge.week_id,
        points,
        weekly_score: weekly_player.score,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeWeeklyChallenge<'info> {
    #[account(
        mut,
        seeds = [WEEKLY_CHALLENGE_SEED, weekly_challenge.week_id.to_le_bytes().as_ref()],
        bump = weekly_challenge.bump
    )]
    pub weekly_challenge: Box<Account<'info, WeeklyChallenge>>,
    #[account(
        seeds = [WEEKLY_LEADERBOARD_SEED, weekly_challenge.key().as_ref()],
        bump = leaderboard.bump,
        constraint = leaderboard.challenge == weekly_challenge.key() @ ErrorCode::InvalidRunId
    )]
    pub leaderboard: Box<Account<'info, WeeklyLeaderboard>>,
    pub caller: Signer<'info>,
}

pub fn handler_finalize_weekly_challenge(ctx: Context<FinalizeWeeklyChallenge>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    validate_weekly_rollups(
        ctx.accounts.weekly_challenge.week_id,
        ctx.remaining_accounts,
    )?;
    let challenge = &mut ctx.accounts.weekly_challenge;
    require!(
        challenge.status == WeeklyStatus::Open,
        ErrorCode::InvalidState
    );
    require!(now >= challenge.finalizes_at, ErrorCode::ChallengeNotEnded);
    let (cash_winner_count, star_winner_count) =
        weekly_winner_counts(challenge.participants, challenge.committed_cash_pool > 0);
    challenge.cash_winner_count = cash_winner_count;
    challenge.star_winner_count = star_winner_count;
    challenge.finalized_at = now;
    challenge.claims_close_at = now
        .checked_add(WEEKLY_CLAIM_WINDOW_SECONDS)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    challenge.status = WeeklyStatus::Claimable;
    emit!(WeeklyFinalized {
        challenge: challenge.key(),
        week_id: challenge.week_id,
        participants: challenge.participants,
        cash_winner_count,
        star_winner_count,
        cash_pool: challenge.committed_cash_pool,
    });
    Ok(())
}

fn validate_weekly_rollups(week_id: u32, daily_accounts: &[AccountInfo<'_>]) -> Result<()> {
    require!(daily_accounts.len() == 7, ErrorCode::InvalidState);
    let start_day = week_id
        .checked_mul(7)
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
        let mut bytes: &[u8] = &data;
        let daily = DailyChallenge::try_deserialize(&mut bytes)?;
        require!(daily.day_id == day_id, ErrorCode::InvalidRunId);
        require!(daily.week_id == week_id, ErrorCode::InvalidState);
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
pub struct ClaimWeeklyStars<'info> {
    #[account(
        seeds = [WEEKLY_CHALLENGE_SEED, weekly_challenge.week_id.to_le_bytes().as_ref()],
        bump = weekly_challenge.bump,
        constraint = weekly_challenge.status == WeeklyStatus::Claimable @ ErrorCode::InvalidState
    )]
    pub weekly_challenge: Box<Account<'info, WeeklyChallenge>>,
    #[account(
        seeds = [WEEKLY_LEADERBOARD_SEED, weekly_challenge.key().as_ref()],
        bump = leaderboard.bump,
        constraint = leaderboard.challenge == weekly_challenge.key() @ ErrorCode::InvalidRunId
    )]
    pub leaderboard: Box<Account<'info, WeeklyLeaderboard>>,
    #[account(
        mut,
        seeds = [WEEKLY_PLAYER_SEED, weekly_challenge.key().as_ref(), owner_authority.key().as_ref()],
        bump = weekly_player.bump,
        constraint = weekly_player.player == owner_authority.key() @ ErrorCode::Unauthorized
    )]
    pub weekly_player: Box<Account<'info, WeeklyPlayer>>,
    #[account(
        mut,
        seeds = [PLAYER_PROFILE_SEED, owner_authority.key().as_ref()],
        bump = player_profile.bump,
        constraint = player_profile.owner == owner_authority.key() @ ErrorCode::Unauthorized
    )]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    /// CHECK: Immutable durable player identity, constrained above.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
}

pub fn handler_claim_weekly_stars(ctx: Context<ClaimWeeklyStars>) -> Result<()> {
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
        !ctx.accounts.weekly_player.stars_claimed,
        ErrorCode::PrizeAlreadyClaimed
    );
    let rank = ctx
        .accounts
        .leaderboard
        .rank_of(ctx.accounts.owner_authority.key())
        .ok_or(ErrorCode::NoPrize)?;
    let stars = weekly_star_reward_for_rank(
        rank,
        ctx.accounts.weekly_challenge.cash_winner_count,
        ctx.accounts.weekly_challenge.star_winner_count,
    )?;
    ctx.accounts.player_profile.credit_stars(stars)?;
    ctx.accounts.weekly_player.stars_claimed = true;
    emit!(WeeklyStarsClaimed {
        owner: ctx.accounts.owner_authority.key(),
        week_id: ctx.accounts.weekly_challenge.week_id,
        rank: (rank + 1) as u8,
        stars,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimWeeklyCash<'info> {
    #[account(
        mut,
        seeds = [WEEKLY_CHALLENGE_SEED, weekly_challenge.week_id.to_le_bytes().as_ref()],
        bump = weekly_challenge.bump,
        constraint = weekly_challenge.status == WeeklyStatus::Claimable @ ErrorCode::InvalidState
    )]
    pub weekly_challenge: Box<Account<'info, WeeklyChallenge>>,
    #[account(
        seeds = [WEEKLY_LEADERBOARD_SEED, weekly_challenge.key().as_ref()],
        bump = leaderboard.bump,
        constraint = leaderboard.challenge == weekly_challenge.key() @ ErrorCode::InvalidRunId
    )]
    pub leaderboard: Box<Account<'info, WeeklyLeaderboard>>,
    #[account(
        mut,
        seeds = [WEEKLY_PLAYER_SEED, weekly_challenge.key().as_ref(), owner_authority.key().as_ref()],
        bump = weekly_player.bump,
        constraint = weekly_player.player == owner_authority.key() @ ErrorCode::Unauthorized
    )]
    pub weekly_player: Box<Account<'info, WeeklyPlayer>>,
    #[account(address = weekly_challenge.payment_mint)]
    pub payment_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        address = weekly_challenge.payment_vault,
        token::mint = payment_mint,
        token::authority = weekly_challenge,
    )]
    pub payment_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = payment_mint,
        associated_token::authority = owner_authority,
    )]
    pub player_payment_account: Box<Account<'info, TokenAccount>>,
    #[account(address = weekly_challenge.payment_token_program)]
    pub token_program: Program<'info, Token>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Immutable durable player identity, constrained above.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler_claim_weekly_cash(ctx: Context<ClaimWeeklyCash>) -> Result<()> {
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
        !ctx.accounts.weekly_player.cash_claimed,
        ErrorCode::PrizeAlreadyClaimed
    );
    let rank = ctx
        .accounts
        .leaderboard
        .rank_of(ctx.accounts.owner_authority.key())
        .ok_or(ErrorCode::NoPrize)?;
    let amount = weekly_cash_amount(
        ctx.accounts.weekly_challenge.committed_cash_pool,
        rank,
        ctx.accounts.weekly_challenge.cash_winner_count,
    )?;
    let week_id = ctx.accounts.weekly_challenge.week_id.to_le_bytes();
    let bump = [ctx.accounts.weekly_challenge.bump];
    let signer: &[&[u8]] = &[WEEKLY_CHALLENGE_SEED, &week_id, &bump];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.payment_vault.to_account_info(),
                mint: ctx.accounts.payment_mint.to_account_info(),
                to: ctx.accounts.player_payment_account.to_account_info(),
                authority: ctx.accounts.weekly_challenge.to_account_info(),
            },
            &[signer],
        ),
        amount,
        ctx.accounts.payment_mint.decimals,
    )?;
    ctx.accounts.weekly_challenge.cash_claimed = ctx
        .accounts
        .weekly_challenge
        .cash_claimed
        .checked_add(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        ctx.accounts.weekly_challenge.cash_claimed
            <= ctx.accounts.weekly_challenge.committed_cash_pool,
        ErrorCode::AccountingInvariant
    );
    ctx.accounts.weekly_player.cash_claimed = true;
    emit!(WeeklyCashClaimed {
        owner: ctx.accounts.owner_authority.key(),
        week_id: ctx.accounts.weekly_challenge.week_id,
        rank: (rank + 1) as u8,
        amount,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ForfeitWeeklyCash<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [WEEKLY_CHALLENGE_SEED, weekly_challenge.week_id.to_le_bytes().as_ref()],
        bump = weekly_challenge.bump,
        constraint = weekly_challenge.status == WeeklyStatus::Claimable @ ErrorCode::InvalidState
    )]
    pub weekly_challenge: Box<Account<'info, WeeklyChallenge>>,
    #[account(address = weekly_challenge.payment_mint)]
    pub payment_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        address = weekly_challenge.payment_vault,
        token::mint = payment_mint,
        token::authority = weekly_challenge,
    )]
    pub payment_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        address = protocol.reward_vault,
        token::mint = payment_mint,
        token::authority = protocol,
    )]
    pub reward_vault: Box<Account<'info, TokenAccount>>,
    #[account(address = weekly_challenge.payment_token_program)]
    pub token_program: Program<'info, Token>,
    pub caller: Signer<'info>,
}

pub fn handler_forfeit_weekly_cash(ctx: Context<ForfeitWeeklyCash>) -> Result<()> {
    require!(
        Clock::get()?.unix_timestamp > ctx.accounts.weekly_challenge.claims_close_at,
        ErrorCode::PrizeClaimWindowOpen
    );
    let amount = ctx.accounts.payment_vault.amount;
    if amount > 0 {
        let week_id = ctx.accounts.weekly_challenge.week_id.to_le_bytes();
        let bump = [ctx.accounts.weekly_challenge.bump];
        let signer: &[&[u8]] = &[WEEKLY_CHALLENGE_SEED, &week_id, &bump];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.payment_vault.to_account_info(),
                    mint: ctx.accounts.payment_mint.to_account_info(),
                    to: ctx.accounts.reward_vault.to_account_info(),
                    authority: ctx.accounts.weekly_challenge.to_account_info(),
                },
                &[signer],
            ),
            amount,
            ctx.accounts.payment_mint.decimals,
        )?;
    }
    ctx.accounts.weekly_challenge.cash_forfeited = amount;
    require!(
        ctx.accounts
            .weekly_challenge
            .cash_claimed
            .checked_add(amount)
            == Some(ctx.accounts.weekly_challenge.committed_cash_pool),
        ErrorCode::AccountingInvariant
    );
    ctx.accounts.weekly_challenge.status = WeeklyStatus::Closed;
    emit!(WeeklyCashForfeited {
        week_id: ctx.accounts.weekly_challenge.week_id,
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
        seeds = [WEEKLY_CHALLENGE_SEED, weekly_challenge.week_id.to_le_bytes().as_ref()],
        bump = weekly_challenge.bump
    )]
    pub weekly_challenge: Box<Account<'info, WeeklyChallenge>>,
    #[account(
        seeds = [WEEKLY_LEADERBOARD_SEED, weekly_challenge.key().as_ref()],
        bump = leaderboard.bump,
        constraint = leaderboard.challenge == weekly_challenge.key() @ ErrorCode::InvalidRunId
    )]
    pub leaderboard: Box<Account<'info, WeeklyLeaderboard>>,
    /// CHECK: Identity pinned by WeeklyPlayer and its PDA seeds.
    pub owner: UncheckedAccount<'info>,
    #[account(
        mut,
        close = rent_recipient,
        seeds = [WEEKLY_PLAYER_SEED, weekly_challenge.key().as_ref(), owner.key().as_ref()],
        bump = weekly_player.bump,
        constraint = weekly_player.challenge == weekly_challenge.key() @ ErrorCode::InvalidRunId,
        constraint = weekly_player.player == owner.key() @ ErrorCode::Unauthorized
    )]
    pub weekly_player: Box<Account<'info, WeeklyPlayer>>,
    /// CHECK: Rent destination is pinned to ProtocolConfig.paymaster.
    #[account(mut, address = protocol.paymaster @ ErrorCode::Unauthorized)]
    pub rent_recipient: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
}

pub fn handler_close_weekly_player(ctx: Context<CloseWeeklyPlayer>) -> Result<()> {
    let rank = ctx.accounts.leaderboard.rank_of(ctx.accounts.owner.key());
    require!(
        weekly_player_close_allowed(
            ctx.accounts.weekly_challenge.status,
            rank,
            ctx.accounts.weekly_challenge.cash_winner_count,
            ctx.accounts.weekly_challenge.star_winner_count,
            ctx.accounts.weekly_player.cash_claimed,
            ctx.accounts.weekly_player.stars_claimed,
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
    cash_winner_count: u8,
    star_winner_count: u8,
    cash_claimed: bool,
    stars_claimed: bool,
) -> bool {
    if status == WeeklyStatus::Closed {
        return true;
    }
    if status != WeeklyStatus::Claimable {
        return false;
    }
    let cash_winner = rank.is_some_and(|rank| rank < usize::from(cash_winner_count));
    let star_limit = usize::from(cash_winner_count) + usize::from(star_winner_count);
    let star_winner = rank.is_some_and(|rank| rank < star_limit);
    (!cash_winner || cash_claimed) && (!star_winner || stars_claimed)
}

#[derive(Accounts)]
pub struct CloseWeeklyChallenge<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    /// CHECK: Rent destination is pinned to ProtocolConfig.paymaster.
    #[account(mut, address = protocol.paymaster @ ErrorCode::Unauthorized)]
    pub rent_recipient: UncheckedAccount<'info>,
    #[account(
        mut,
        close = rent_recipient,
        seeds = [WEEKLY_CHALLENGE_SEED, weekly_challenge.week_id.to_le_bytes().as_ref()],
        bump = weekly_challenge.bump
    )]
    pub weekly_challenge: Box<Account<'info, WeeklyChallenge>>,
    #[account(
        mut,
        close = rent_recipient,
        seeds = [WEEKLY_LEADERBOARD_SEED, weekly_challenge.key().as_ref()],
        bump = leaderboard.bump,
        constraint = leaderboard.challenge == weekly_challenge.key() @ ErrorCode::InvalidRunId
    )]
    pub leaderboard: Box<Account<'info, WeeklyLeaderboard>>,
    #[account(address = weekly_challenge.payment_mint)]
    pub payment_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        address = weekly_challenge.payment_vault,
        token::mint = payment_mint,
        token::authority = weekly_challenge,
    )]
    pub payment_vault: Box<Account<'info, TokenAccount>>,
    #[account(address = weekly_challenge.payment_token_program)]
    pub token_program: Program<'info, Token>,
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
        ctx.accounts.payment_vault.amount == 0,
        ErrorCode::AccountingInvariant
    );
    validate_closed_weekly_dailies(
        ctx.accounts.weekly_challenge.week_id,
        ctx.remaining_accounts,
    )?;

    let week_id = ctx.accounts.weekly_challenge.week_id.to_le_bytes();
    let bump = [ctx.accounts.weekly_challenge.bump];
    let signer: &[&[u8]] = &[WEEKLY_CHALLENGE_SEED, &week_id, &bump];
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.payment_vault.to_account_info(),
            destination: ctx.accounts.rent_recipient.to_account_info(),
            authority: ctx.accounts.weekly_challenge.to_account_info(),
        },
        &[signer],
    ))?;
    emit!(WeeklyChallengeClosed {
        challenge: ctx.accounts.weekly_challenge.key(),
        week_id: ctx.accounts.weekly_challenge.week_id,
    });
    Ok(())
}

fn validate_closed_weekly_dailies(week_id: u32, daily_accounts: &[AccountInfo<'_>]) -> Result<()> {
    require!(
        daily_accounts.len() == WEEKLY_DAILY_RESULTS,
        ErrorCode::InvalidState
    );
    let start_day = week_id
        .checked_mul(7)
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
        args.rules_version > 0
            && args.season_id > 0
            && args.season_seed != [0; 32]
            && usize::from(args.scoring_rule_count) >= DAILY_SCORE_FAMILY_COUNT
            && usize::from(args.scoring_rule_count) <= DAILY_SCORE_RULE_CAPACITY,
        ErrorCode::InvalidState
    );
    DailyRulesCatalog {
        version: ECONOMY_ACCOUNT_VERSION,
        rules_version: args.rules_version,
        economy_config: Pubkey::default(),
        content_version: 1,
        catalog_hash: [0; 32],
        season_id: args.season_id,
        starts_day: args.starts_day,
        season_seed: args.season_seed,
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
    Ok(Sha256::new()
        .chain_update(b"zkube-daily-season-v1")
        .chain_update(serialized)
        .finalize()
        .into())
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
    Ok(Sha256::new()
        .chain_update(b"zkube-daily-challenge-v1")
        .chain_update(catalog.catalog_hash)
        .chain_update(day_id.to_le_bytes())
        .chain_update([map_id])
        .chain_update(rule)
        .finalize()
        .into())
}

fn short_meta(pubkey: Pubkey, is_writable: bool) -> ShortAccountMeta {
    ShortAccountMeta {
        pubkey: pubkey.to_bytes().into(),
        is_writable,
    }
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
    pub prices: [u64; STAR_PACK_COUNT],
    pub enabled: [bool; STAR_PACK_COUNT],
}

#[event]
pub struct EconomySaleScheduled {
    pub revision: u64,
    pub starts_at: i64,
    pub ends_at: i64,
    pub prices: [u64; STAR_PACK_COUNT],
}

#[event]
pub struct EconomySaleCancelled {
    pub revision: u64,
}

#[event]
pub struct DailyRulesPublished {
    pub catalog: Pubkey,
    pub rules_version: u32,
    pub catalog_hash: [u8; 32],
}

#[event]
pub struct StarsPurchased {
    pub owner: Pubkey,
    pub pack_index: u8,
    pub config_revision: u64,
    pub stars: u64,
    pub gross: u64,
    pub team: u64,
    pub reward: u64,
    pub treasury: u64,
}

#[event]
pub struct ZoneUnlocked {
    pub owner: Pubkey,
    pub map_id: u8,
    pub stars_spent: u64,
}

#[event]
pub struct LevelMilestoneClaimed {
    pub owner: Pubkey,
    pub level: u8,
    pub stars: u64,
}

#[event]
pub struct DailyOpened {
    pub challenge: Pubkey,
    pub day_id: u32,
    pub week_id: u32,
    pub season_id: u32,
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
    pub stars_spent: u64,
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
    pub week_id: u32,
    pub cash_pool: u64,
}

#[event]
pub struct DailyRolledUp {
    pub owner: Pubkey,
    pub day_id: u32,
    pub week_id: u32,
    pub points: u16,
    pub weekly_score: u16,
}

#[event]
pub struct WeeklyFinalized {
    pub challenge: Pubkey,
    pub week_id: u32,
    pub participants: u32,
    pub cash_winner_count: u8,
    pub star_winner_count: u8,
    pub cash_pool: u64,
}

#[event]
pub struct WeeklyStarsClaimed {
    pub owner: Pubkey,
    pub week_id: u32,
    pub rank: u8,
    pub stars: u64,
}

#[event]
pub struct WeeklyCashClaimed {
    pub owner: Pubkey,
    pub week_id: u32,
    pub rank: u8,
    pub amount: u64,
}

#[event]
pub struct WeeklyCashForfeited {
    pub week_id: u32,
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
    pub week_id: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn daily_player() -> DailyPlayer {
        DailyPlayer {
            version: ECONOMY_ACCOUNT_VERSION,
            challenge: Pubkey::new_unique(),
            player: Pubkey::new_unique(),
            attempts: 1,
            finalized_attempts: 0,
            best_run_id: 0,
            best_receipt: Pubkey::default(),
            best_daily_score: 0,
            best_engine_score: 0,
            best_moves: 0,
            best_submitted_at: 0,
            daily_xp_awarded: false,
            pressure_mastery_xp_awarded: false,
            weekly_rolled_up: false,
            star_refunded: false,
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
        assert!(!weekly_player_close_allowed(
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
