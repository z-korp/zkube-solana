//! Protocol initialization, content staging/activation, and Campaign preparation.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self as anchor_system_program, Transfer};
use session_keys::SessionTokenV2;

use crate::error::ErrorCode;
use crate::game::sha256v;
use crate::instructions::player_authorization::{
    require_player_authorization, require_player_rent_payer,
};
use crate::state::economy::{
    DailyPressureProfile, DailyRulesCatalog, DailyScoringRule, DAILY_RULES_CATALOG_SEED,
    ECONOMY_ACCOUNT_VERSION,
};
use crate::state::protocol::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeProtocolArgs {
    pub pricing_operator: Pubkey,
    pub team_destination: Pubkey,
    pub treasury_destination: Pubkey,
    pub content_version: u32,
}

#[derive(Accounts)]
#[instruction(args: InitializeProtocolArgs)]
pub struct InitializeProtocol<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + ProtocolConfig::INIT_SPACE,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        init,
        payer = authority,
        space = 8 + RewardVault::INIT_SPACE,
        seeds = [REWARD_VAULT_SEED],
        bump
    )]
    pub reward_vault: Box<Account<'info, RewardVault>>,
    /// CHECK: Immutable native-SOL revenue recipient validated against args.
    #[account(address = args.team_destination)]
    pub team_destination: UncheckedAccount<'info>,
    /// CHECK: Immutable native-SOL revenue recipient validated against args.
    #[account(address = args.treasury_destination)]
    pub treasury_destination: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_initialize_protocol(
    ctx: Context<InitializeProtocol>,
    args: InitializeProtocolArgs,
) -> Result<()> {
    require!(args.content_version > 0, ErrorCode::ContentVersionMismatch);
    validate_revenue_destinations([
        args.team_destination,
        args.treasury_destination,
        ctx.accounts.reward_vault.key(),
    ])?;
    require_keys_neq!(
        args.pricing_operator,
        Pubkey::default(),
        ErrorCode::InvalidOwner
    );
    let protocol = &mut ctx.accounts.protocol;
    protocol.version = ACCOUNT_VERSION;
    protocol.authority = ctx.accounts.authority.key();
    protocol.pending_authority = Pubkey::default();
    protocol.pricing_operator = args.pricing_operator;
    protocol.team_destination = args.team_destination;
    protocol.treasury_destination = args.treasury_destination;
    protocol.reward_vault = ctx.accounts.reward_vault.key();
    protocol.content_version = args.content_version;
    protocol.daily_rules_version = 0;
    protocol.player_funding_target_lamports = PLAYER_FUNDING_TARGET_LAMPORTS;
    protocol.campaign_map_count = 0;
    protocol.paused = false;
    protocol.bump = ctx.bumps.protocol;
    ctx.accounts.reward_vault.set_inner(RewardVault {
        version: ACCOUNT_VERSION,
        protocol: protocol.key(),
        bump: ctx.bumps.reward_vault,
    });
    Ok(())
}

pub(crate) fn validate_revenue_destinations(vaults: [Pubkey; 3]) -> Result<()> {
    for (index, vault) in vaults.iter().enumerate() {
        require_keys_neq!(*vault, Pubkey::default(), ErrorCode::InvalidOwner);
        require!(
            vaults[..index].iter().all(|previous| previous != vault),
            ErrorCode::InvalidOwner
        );
    }
    Ok(())
}

#[derive(Accounts)]
pub struct InitializePlayer<'info> {
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + PlayerState::INIT_SPACE,
        seeds = [PLAYER_STATE_SEED, owner_authority.key().as_ref()],
        bump
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
    /// CHECK: Canonical owner-scoped funding PDA. Only an empty System-owned
    /// account is accepted; no retired program-owned layout is convertible.
    #[account(
        mut,
        seeds = [PLAYER_FUNDING_SEED, owner_authority.key().as_ref()],
        bump
    )]
    pub player_funding: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Immutable durable player identity used for the player PDAs.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_initialize_player(ctx: Context<InitializePlayer>) -> Result<()> {
    let owner = ctx.accounts.owner_authority.key();
    require_player_authorization(
        owner,
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    require_player_rent_payer(owner, ctx.accounts.actor.key(), ctx.accounts.payer.key())?;
    let player = &mut ctx.accounts.player_state;
    if player.version == 0 {
        player.set_inner(PlayerState::initialize(owner, ctx.bumps.player_state));
    } else {
        require!(player.owner == owner, ErrorCode::Unauthorized);
        require!(player.version == ACCOUNT_VERSION, ErrorCode::InvalidVersion);
    }

    require_canonical_player_funding(&ctx.accounts.player_funding.to_account_info())?;
    Ok(())
}

fn require_canonical_player_funding(funding: &AccountInfo<'_>) -> Result<()> {
    require!(!funding.executable, ErrorCode::InvalidOwner);
    require_keys_eq!(*funding.owner, system_program::ID, ErrorCode::InvalidOwner);
    require!(funding.data_is_empty(), ErrorCode::InvalidOwner);
    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawPlayerFunding<'info> {
    /// CHECK: Canonical System-owned funding PDA validated in the handler.
    #[account(
        mut,
        seeds = [PLAYER_FUNDING_SEED, owner.key().as_ref()],
        bump
    )]
    pub player_funding: UncheckedAccount<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_withdraw_player_funding(
    ctx: Context<WithdrawPlayerFunding>,
    lamports: u64,
) -> Result<()> {
    require!(lamports > 0, ErrorCode::InsufficientFunds);
    let funding_info = ctx.accounts.player_funding.to_account_info();
    require_keys_eq!(
        *funding_info.owner,
        system_program::ID,
        ErrorCode::InvalidOwner
    );
    require!(funding_info.data_is_empty(), ErrorCode::InvalidOwner);
    require!(
        funding_info.lamports() >= lamports,
        ErrorCode::InsufficientFunds
    );
    let bump = [ctx.bumps.player_funding];
    let owner = ctx.accounts.owner.key();
    let seeds: &[&[u8]] = &[PLAYER_FUNDING_SEED, owner.as_ref(), &bump];
    anchor_system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.key(),
            Transfer {
                from: funding_info,
                to: ctx.accounts.owner.to_account_info(),
            },
            &[seeds],
        ),
        lamports,
    )
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct WriteMapCatalogArgs {
    pub content_version: u32,
    pub map_id: u8,
    pub theme_id: u8,
    pub enabled: bool,
    pub map_rules: CampaignMapRuleSnapshot,
    pub levels: [CampaignLevelSnapshot; LEVELS_PER_MAP],
}

#[derive(Accounts)]
#[instruction(args: WriteMapCatalogArgs)]
pub struct WriteMapCatalog<'info> {
    #[account(
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Account<'info, ProtocolConfig>,
    #[account(
        init,
        payer = authority,
        space = 8 + MapCatalog::INIT_SPACE,
        seeds = [
            MAP_CATALOG_SEED,
            args.content_version.to_le_bytes().as_ref(),
            &[args.map_id]
        ],
        bump
    )]
    pub map_catalog: Box<Account<'info, MapCatalog>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_write_map_catalog(
    ctx: Context<WriteMapCatalog>,
    args: WriteMapCatalogArgs,
) -> Result<()> {
    require!(
        (1..=MAX_MAPS as u8).contains(&args.map_id),
        ErrorCode::InvalidMap
    );
    require!(
        args.content_version >= ctx.accounts.protocol.content_version,
        ErrorCode::ContentVersionMismatch
    );
    if args.content_version == ctx.accounts.protocol.content_version {
        require!(!ctx.accounts.protocol.paused, ErrorCode::ProtocolPaused);
    }
    validate_campaign_map_rules(&args.map_rules)?;
    for (index, level) in args.levels.iter().enumerate() {
        require!(level.level == index as u8 + 1, ErrorCode::InvalidLevel);
        require!(level.points_required > 0, ErrorCode::InvalidLevel);
        require!(level.max_moves > 0, ErrorCode::InvalidLevel);
        require!(level.difficulty <= 7, ErrorCode::InvalidLevel);
        validate_constraint_snapshot(level.primary)?;
        validate_constraint_snapshot(level.secondary)?;
        require!(
            level.block_weights[0] > 0
                && level.block_weights[1..].iter().any(|weight| *weight > 0)
                && level
                    .block_weights
                    .iter()
                    .map(|weight| u32::from(*weight))
                    .sum::<u32>()
                    == 100,
            ErrorCode::InvalidBlockWeights
        );
    }

    let catalog = &mut ctx.accounts.map_catalog;
    catalog.version = ACCOUNT_VERSION;
    catalog.content_version = args.content_version;
    catalog.map_id = args.map_id;
    catalog.theme_id = args.theme_id;
    catalog.enabled = args.enabled;
    catalog.map_rules = args.map_rules;
    catalog.levels = args.levels;
    catalog.bump = ctx.bumps.map_catalog;
    Ok(())
}

fn validate_campaign_map_rules(rules: &CampaignMapRuleSnapshot) -> Result<()> {
    require!(rules.active_mutator_id > 0, ErrorCode::InvalidLevel);
    require!(rules.passive_mutator_id > 0, ErrorCode::InvalidLevel);
    require!(rules.boss_id > 0, ErrorCode::InvalidLevel);
    require!(rules.score_multiplier_x100 > 0, ErrorCode::InvalidLevel);
    require!(rules.combo_multiplier_x100 > 0, ErrorCode::InvalidLevel);
    require!((1..=3).contains(&rules.bonus_type), ErrorCode::InvalidLevel);
    require!(
        (1..=7).contains(&rules.bonus_trigger_type),
        ErrorCode::InvalidLevel
    );
    require!(rules.starting_charges <= 15, ErrorCode::InvalidLevel);
    require!(
        (crate::game::MIN_OPENING_HEIGHT..=crate::game::MAX_OPENING_HEIGHT)
            .contains(&rules.starting_rows),
        ErrorCode::InvalidLevel
    );
    match rules.bonus_trigger_type {
        1 | 4 => require!(
            (1..=8).contains(&rules.bonus_threshold),
            ErrorCode::InvalidLevel
        ),
        2 | 3 | 7 => require!(rules.bonus_threshold > 0, ErrorCode::InvalidLevel),
        5 | 6 => require!(rules.bonus_threshold == 0, ErrorCode::InvalidLevel),
        _ => return err!(ErrorCode::InvalidLevel),
    }
    Ok(())
}

fn validate_constraint_snapshot(constraint: ConstraintSnapshot) -> Result<()> {
    match constraint.kind {
        0 => require!(
            constraint.value == 0 && constraint.required_count == 0,
            ErrorCode::InvalidLevel
        ),
        1 => require!(
            (2..=8).contains(&constraint.value) && constraint.required_count > 0,
            ErrorCode::InvalidLevel
        ),
        2 => require!(
            (1..=4).contains(&constraint.value) && constraint.required_count > 0,
            ErrorCode::InvalidLevel
        ),
        3 => require!(
            constraint.value > 0 && constraint.required_count == 1,
            ErrorCode::InvalidLevel
        ),
        _ => return err!(ErrorCode::InvalidLevel),
    }
    Ok(())
}

#[derive(Accounts)]
pub struct ActivateCampaignMap<'info> {
    #[account(
        mut,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [
            MAP_CATALOG_SEED,
            protocol.content_version.to_le_bytes().as_ref(),
            &[map_catalog.map_id]
        ],
        bump = map_catalog.bump,
        constraint = map_catalog.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = map_catalog.content_version == protocol.content_version @ ErrorCode::ContentVersionMismatch,
        constraint = map_catalog.enabled @ ErrorCode::MapDisabled
    )]
    pub map_catalog: Box<Account<'info, MapCatalog>>,
    pub authority: Signer<'info>,
}

pub fn handler_activate_campaign_map(ctx: Context<ActivateCampaignMap>) -> Result<()> {
    let protocol = &mut ctx.accounts.protocol;
    require!(!protocol.paused, ErrorCode::ProtocolPaused);
    let next = protocol
        .campaign_map_count
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(next <= MAX_MAPS as u8, ErrorCode::InvalidMap);
    require!(
        ctx.accounts.map_catalog.map_id == next,
        ErrorCode::InvalidMap
    );
    protocol.campaign_map_count = next;
    Ok(())
}

#[derive(Accounts)]
#[instruction(content_version: u32, daily_rules_version: u32, campaign_map_count: u8)]
pub struct ActivateContentRelease<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [DAILY_RULES_CATALOG_SEED, daily_rules_version.to_le_bytes().as_ref()],
        bump = daily_rules_catalog.bump,
        constraint = daily_rules_catalog.version == ECONOMY_ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = daily_rules_catalog.rules_version == daily_rules_version @ ErrorCode::ContentVersionMismatch,
        constraint = daily_rules_catalog.protocol == protocol.key() @ ErrorCode::InvalidOwner,
        constraint = daily_rules_catalog.content_version == content_version @ ErrorCode::ContentVersionMismatch
    )]
    pub daily_rules_catalog: Box<Account<'info, DailyRulesCatalog>>,
    pub authority: Signer<'info>,
}

pub fn handler_activate_content_release(
    ctx: Context<ActivateContentRelease>,
    content_version: u32,
    daily_rules_version: u32,
    campaign_map_count: u8,
) -> Result<()> {
    validate_content_release_transition(
        ctx.accounts.protocol.content_version,
        ctx.accounts.protocol.daily_rules_version,
        content_version,
        daily_rules_version,
        campaign_map_count,
        ctx.remaining_accounts.len(),
    )?;
    ctx.accounts.daily_rules_catalog.validate()?;
    for (index, account) in ctx.remaining_accounts.iter().enumerate() {
        validate_release_map(account, content_version, index as u8 + 1)?;
    }

    ctx.accounts.protocol.content_version = content_version;
    ctx.accounts.protocol.campaign_map_count = campaign_map_count;
    ctx.accounts.protocol.daily_rules_version = daily_rules_version;
    emit!(ContentReleaseActivated {
        content_version,
        daily_rules_version,
        campaign_map_count,
    });
    Ok(())
}

fn validate_content_release_transition(
    current_content_version: u32,
    current_daily_rules_version: u32,
    content_version: u32,
    daily_rules_version: u32,
    campaign_map_count: u8,
    provided_map_count: usize,
) -> Result<()> {
    require!(
        content_version > current_content_version,
        ErrorCode::ContentVersionMismatch
    );
    require!(
        daily_rules_version > current_daily_rules_version,
        ErrorCode::ContentVersionMismatch
    );
    require!(
        (1..=MAX_MAPS as u8).contains(&campaign_map_count),
        ErrorCode::InvalidMap
    );
    require!(
        provided_map_count == usize::from(campaign_map_count),
        ErrorCode::InvalidMap
    );
    Ok(())
}

fn validate_release_map(account: &AccountInfo<'_>, content_version: u32, map_id: u8) -> Result<()> {
    require_keys_eq!(*account.owner, crate::ID, ErrorCode::InvalidOwner);
    let data = account.try_borrow_data()?;
    require!(
        data.len() == 8 + MapCatalog::INIT_SPACE,
        ErrorCode::InvalidOwner
    );
    let mut bytes = data.as_ref();
    let catalog = MapCatalog::try_deserialize(&mut bytes)?;
    require!(
        catalog.version == ACCOUNT_VERSION,
        ErrorCode::InvalidVersion
    );
    require!(catalog.enabled, ErrorCode::MapDisabled);
    require!(catalog.map_id == map_id, ErrorCode::InvalidMap);
    require!(
        catalog.content_version == content_version,
        ErrorCode::ContentVersionMismatch
    );
    let (expected, bump) = Pubkey::find_program_address(
        &[MAP_CATALOG_SEED, &content_version.to_le_bytes(), &[map_id]],
        &crate::ID,
    );
    require_keys_eq!(account.key(), expected, ErrorCode::InvalidMap);
    require!(catalog.bump == bump, ErrorCode::InvalidMap);
    Ok(())
}

#[event]
pub struct ContentReleaseActivated {
    pub content_version: u32,
    pub daily_rules_version: u32,
    pub campaign_map_count: u8,
}

#[derive(Accounts)]
#[instruction(run_id: u64, map_id: u8, level: u8)]
pub struct PrepareCampaignRun<'info> {
    #[account(
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, owner_authority.key().as_ref()],
        bump = player_state.bump,
        constraint = player_state.owner == owner_authority.key() @ ErrorCode::Unauthorized,
        constraint = player_state.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(
        seeds = [
            MAP_CATALOG_SEED,
            protocol.content_version.to_le_bytes().as_ref(),
            &[map_id]
        ],
        bump = map_catalog.bump,
        constraint = map_catalog.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = map_catalog.content_version == protocol.content_version @ ErrorCode::ContentVersionMismatch,
        constraint = map_catalog.map_id == map_id @ ErrorCode::InvalidMap
    )]
    pub map_catalog: Box<Account<'info, MapCatalog>>,
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
    /// CHECK: Immutable durable player identity, constrained by all player PDAs.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_prepare_campaign_run(
    ctx: Context<PrepareCampaignRun>,
    run_id: u64,
    map_id: u8,
    level: u8,
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
    require!(
        ctx.accounts.player_state.next_run_id == run_id,
        ErrorCode::InvalidRunId
    );
    require!(
        ctx.accounts.player_state.active_run_id == 0,
        ErrorCode::ActiveRunExists
    );
    require!(
        ctx.accounts.player_state.is_map_unlocked(map_id),
        ErrorCode::MapLocked
    );
    require!(
        map_id > 0 && map_id <= ctx.accounts.protocol.campaign_map_count,
        ErrorCode::InvalidMap
    );
    require!(ctx.accounts.map_catalog.enabled, ErrorCode::MapDisabled);
    require!(
        (1..=LEVELS_PER_MAP as u8).contains(&level),
        ErrorCode::InvalidLevel
    );

    let rules = ctx.accounts.map_catalog.expanded_level(level)?;
    let rules_hash = hash_rules(ctx.accounts.protocol.content_version, map_id, &rules)?;
    let now = Clock::get()?.unix_timestamp;
    let owner = ctx.accounts.owner_authority.key();

    let active = &mut ctx.accounts.active_run;
    active.version = ACCOUNT_VERSION;
    active.owner = owner;
    active.daily_challenge = Pubkey::default();
    active.run_id = run_id;
    active.mode = RunMode::Campaign;
    active.lifecycle = RunLifecycle::Prepared;
    active.rules_hash = rules_hash;
    active.map_id = map_id;
    active.level = level;
    active.rules = rules;
    active.grid = [0; 80];
    active.next_row = [0; 8];
    active.has_next_row = false;
    active.score = 0;
    active.daily_score = 0;
    active.daily_bonus_triggers = 0;
    active.pressure_score = 0;
    active.daily_scoring_rule = DailyScoringRule::default();
    active.daily_pressure = DailyPressureProfile::default();
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
    active.bonus_type = rules.bonus_type;
    active.bonus_charges = rules.starting_charges;
    active.perfect_trigger_available = true;
    active.starting_height_target = rules.starting_rows.max(1);
    active.current_difficulty = rules.difficulty;
    active.vrf_request_counter = 0;
    active.pending_vrf_counter = 0;
    active.finished_at = 0;
    active.bump = ctx.bumps.active_run;

    ctx.accounts.player_state.record_run_started(now)?;
    ctx.accounts.player_state.reserve_run(run_id)?;
    Ok(())
}

fn hash_rules(content_version: u32, map_id: u8, rules: &LevelRuleSnapshot) -> Result<[u8; 32]> {
    let mut serialized = Vec::new();
    rules.serialize(&mut serialized)?;
    let content = content_version.to_le_bytes();
    Ok(sha256v(&[
        b"zkube-rules-v1",
        &content,
        &[map_id],
        &serialized,
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rule_hash_is_domain_separated_and_stable() {
        let rules = LevelRuleSnapshot {
            level: 1,
            max_moves: 20,
            block_weights: [20; 5],
            ..LevelRuleSnapshot::default()
        };
        let first = hash_rules(1, 1, &rules).unwrap();
        assert_eq!(first, hash_rules(1, 1, &rules).unwrap());
        assert_ne!(first, hash_rules(2, 1, &rules).unwrap());
        assert_ne!(first, hash_rules(1, 2, &rules).unwrap());
    }

    #[test]
    fn protocol_vaults_must_be_nonzero_and_pairwise_distinct() {
        let vaults: [Pubkey; 3] = std::array::from_fn(|_| Pubkey::new_unique());
        assert!(validate_revenue_destinations(vaults).is_ok());

        let duplicate = Pubkey::new_unique();
        assert!(
            validate_revenue_destinations([duplicate, Pubkey::new_unique(), duplicate,]).is_err()
        );
        assert!(validate_revenue_destinations([
            Pubkey::default(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
        ])
        .is_err());
    }

    #[test]
    fn campaign_map_rules_require_a_playable_fixed_bonus_identity() {
        let valid = CampaignMapRuleSnapshot {
            active_mutator_id: 1,
            passive_mutator_id: 2,
            boss_id: 1,
            score_multiplier_x100: 100,
            combo_multiplier_x100: 100,
            bonus_type: 3,
            bonus_trigger_type: 1,
            bonus_threshold: 3,
            starting_charges: 1,
            starting_rows: 4,
            ..CampaignMapRuleSnapshot::default()
        };
        assert!(validate_campaign_map_rules(&valid).is_ok());
        assert!(validate_campaign_map_rules(&CampaignMapRuleSnapshot {
            bonus_trigger_type: 0,
            ..valid
        })
        .is_err());
        assert!(validate_campaign_map_rules(&CampaignMapRuleSnapshot {
            bonus_type: 0,
            ..valid
        })
        .is_err());
        assert!(validate_campaign_map_rules(&CampaignMapRuleSnapshot {
            starting_rows: 0,
            ..valid
        })
        .is_err());
    }

    #[test]
    fn content_release_requires_strict_versions_and_the_exact_campaign_set() {
        assert!(validate_content_release_transition(1, 2, 3, 4, 10, 10).is_ok());
        assert!(validate_content_release_transition(3, 2, 3, 4, 10, 10).is_err());
        assert!(validate_content_release_transition(1, 4, 3, 4, 10, 10).is_err());
        assert!(validate_content_release_transition(1, 2, 3, 4, 0, 0).is_err());
        assert!(validate_content_release_transition(1, 2, 3, 4, 10, 9).is_err());
    }

    #[test]
    fn staged_release_maps_are_exact_versioned_enabled_pdas() {
        let content_version = 7u32;
        let map_id = 3u8;
        let (key, bump) = Pubkey::find_program_address(
            &[MAP_CATALOG_SEED, &content_version.to_le_bytes(), &[map_id]],
            &crate::ID,
        );
        let mut lamports = 1;
        let mut data = release_map_data(content_version, map_id, bump, true, ACCOUNT_VERSION);
        let owner = crate::ID;
        let account = AccountInfo::new(&key, false, false, &mut lamports, &mut data, &owner, false);
        assert!(validate_release_map(&account, content_version, map_id).is_ok());
        assert!(validate_release_map(&account, content_version + 1, map_id).is_err());
        assert!(validate_release_map(&account, content_version, map_id + 1).is_err());

        let mut disabled_lamports = 1;
        let mut disabled_data =
            release_map_data(content_version, map_id, bump, false, ACCOUNT_VERSION);
        let disabled = AccountInfo::new(
            &key,
            false,
            false,
            &mut disabled_lamports,
            &mut disabled_data,
            &owner,
            false,
        );
        assert!(validate_release_map(&disabled, content_version, map_id).is_err());

        let mut stale_lamports = 1;
        let mut stale_data = release_map_data(content_version, map_id, bump, true, 0);
        let stale = AccountInfo::new(
            &key,
            false,
            false,
            &mut stale_lamports,
            &mut stale_data,
            &owner,
            false,
        );
        assert!(validate_release_map(&stale, content_version, map_id).is_err());
    }

    fn release_map_data(
        content_version: u32,
        map_id: u8,
        bump: u8,
        enabled: bool,
        version: u8,
    ) -> Vec<u8> {
        let catalog = MapCatalog {
            version,
            content_version,
            map_id,
            theme_id: 1,
            enabled,
            map_rules: CampaignMapRuleSnapshot::default(),
            levels: [CampaignLevelSnapshot::default(); LEVELS_PER_MAP],
            bump,
        };
        let mut data = vec![0; 8 + MapCatalog::INIT_SPACE];
        catalog
            .try_serialize(&mut std::io::Cursor::new(&mut data[..]))
            .unwrap();
        data
    }
}
