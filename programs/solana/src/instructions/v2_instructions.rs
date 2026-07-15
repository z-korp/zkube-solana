use anchor_lang::prelude::*;
use session_keys::SessionTokenV2;
use sha2::{Digest, Sha256};

use crate::error::ErrorCode;
use crate::instructions::player_authorization::require_player_authorization;
use crate::state::economy_v2::{DailyPressureProfile, DailyScoringRule};
use crate::state::v2::*;

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
    validate_vault_segregation([
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

fn validate_vault_segregation(vaults: [Pubkey; 3]) -> Result<()> {
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
        space = 8 + PlayerProfile::INIT_SPACE,
        seeds = [PLAYER_PROFILE_SEED, owner_authority.key().as_ref()],
        bump
    )]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + CampaignProgress::INIT_SPACE,
        seeds = [CAMPAIGN_PROGRESS_SEED, owner_authority.key().as_ref()],
        bump
    )]
    pub campaign_progress: Box<Account<'info, CampaignProgress>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + PlayerFundingVault::INIT_SPACE,
        seeds = [PLAYER_FUNDING_SEED, owner_authority.key().as_ref()],
        bump
    )]
    pub player_funding: Box<Account<'info, PlayerFundingVault>>,
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
    let player = &mut ctx.accounts.player_profile;
    if player.version == 0 {
        player.set_inner(PlayerProfile::initialize(owner, ctx.bumps.player_profile));
    } else {
        require!(player.owner == owner, ErrorCode::Unauthorized);
        require!(player.version == ACCOUNT_VERSION, ErrorCode::InvalidVersion);
    }

    let campaign = &mut ctx.accounts.campaign_progress;
    if campaign.version == 0 {
        campaign.set_inner(CampaignProgress::initialize(
            owner,
            ctx.bumps.campaign_progress,
        ));
    } else {
        require!(campaign.owner == owner, ErrorCode::Unauthorized);
        require!(
            campaign.version == ACCOUNT_VERSION,
            ErrorCode::InvalidVersion
        );
    }
    let funding = &mut ctx.accounts.player_funding;
    if funding.version == 0 {
        funding.set_inner(PlayerFundingVault {
            version: ACCOUNT_VERSION,
            owner,
            bump: ctx.bumps.player_funding,
        });
    } else {
        require_keys_eq!(funding.owner, owner, ErrorCode::Unauthorized);
        require!(
            funding.version == ACCOUNT_VERSION,
            ErrorCode::InvalidVersion
        );
    }
    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawPlayerFunding<'info> {
    #[account(
        mut,
        seeds = [PLAYER_FUNDING_SEED, owner.key().as_ref()],
        bump = player_funding.bump,
        constraint = player_funding.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = player_funding.owner == owner.key() @ ErrorCode::Unauthorized
    )]
    pub player_funding: Box<Account<'info, PlayerFundingVault>>,
    #[account(mut)]
    pub owner: Signer<'info>,
}

pub fn handler_withdraw_player_funding(
    ctx: Context<WithdrawPlayerFunding>,
    lamports: u64,
) -> Result<()> {
    require!(lamports > 0, ErrorCode::InsufficientFunds);
    let funding_info = ctx.accounts.player_funding.to_account_info();
    let reserve = Rent::get()?.minimum_balance(funding_info.data_len());
    let spendable = funding_info
        .lamports()
        .checked_sub(reserve)
        .ok_or(ErrorCode::AccountingInvariant)?;
    require!(spendable >= lamports, ErrorCode::InsufficientFunds);
    let funding_after = funding_info
        .lamports()
        .checked_sub(lamports)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let owner_after = ctx
        .accounts
        .owner
        .to_account_info()
        .lamports()
        .checked_add(lamports)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    **funding_info.try_borrow_mut_lamports()? = funding_after;
    **ctx
        .accounts
        .owner
        .to_account_info()
        .try_borrow_mut_lamports()? = owner_after;
    Ok(())
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
    require!(!ctx.accounts.protocol.paused, ErrorCode::ProtocolPaused);
    require!(
        (1..=MAX_MAPS as u8).contains(&args.map_id),
        ErrorCode::InvalidMap
    );
    require!(
        args.content_version == ctx.accounts.protocol.content_version,
        ErrorCode::ContentVersionMismatch
    );
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
        (1..=9).contains(&rules.starting_rows),
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
#[instruction(run_id: u64, map_id: u8, level: u8)]
pub struct PrepareCampaignRun<'info> {
    #[account(
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [PLAYER_PROFILE_SEED, owner_authority.key().as_ref()],
        bump = player_profile.bump,
        constraint = player_profile.owner == owner_authority.key() @ ErrorCode::Unauthorized
    )]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    #[account(
        seeds = [CAMPAIGN_PROGRESS_SEED, owner_authority.key().as_ref()],
        bump = campaign_progress.bump,
        constraint = campaign_progress.owner == owner_authority.key() @ ErrorCode::Unauthorized
    )]
    pub campaign_progress: Box<Account<'info, CampaignProgress>>,
    #[account(
        seeds = [
            MAP_CATALOG_SEED,
            protocol.content_version.to_le_bytes().as_ref(),
            &[map_id]
        ],
        bump = map_catalog.bump,
        constraint = map_catalog.content_version == protocol.content_version @ ErrorCode::ContentVersionMismatch,
        constraint = map_catalog.map_id == map_id @ ErrorCode::InvalidMap
    )]
    pub map_catalog: Box<Account<'info, MapCatalog>>,
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
    require!(
        ctx.accounts.player_profile.next_run_id == run_id,
        ErrorCode::InvalidRunId
    );
    require!(
        ctx.accounts.player_profile.active_run_id == 0,
        ErrorCode::ActiveRunExists
    );
    require!(
        ctx.accounts.campaign_progress.is_map_unlocked(map_id),
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

    let shell = &mut ctx.accounts.run_shell;
    shell.version = ACCOUNT_VERSION;
    shell.owner = owner;
    shell.run_id = run_id;
    shell.mode = RunMode::Campaign;
    shell.settlement_target = SettlementTarget::CampaignProgress;
    shell.content_version = ctx.accounts.protocol.content_version;
    shell.rules_hash = rules_hash;
    shell.map_catalog = ctx.accounts.map_catalog.key();
    shell.daily_challenge = Pubkey::default();
    shell.delegated_validator = Pubkey::default();
    shell.lifecycle = RunLifecycle::Prepared;
    shell.created_at = now;
    shell.settled_at = 0;
    shell.bump = ctx.bumps.run_shell;

    let active = &mut ctx.accounts.active_run;
    active.version = ACCOUNT_VERSION;
    active.owner = owner;
    active.run_shell = shell.key();
    active.daily_challenge = Pubkey::default();
    active.run_id = run_id;
    active.mode = RunMode::Campaign;
    active.lifecycle = RunLifecycle::Prepared;
    active.content_version = shell.content_version;
    active.rules_hash = rules_hash;
    active.map_id = map_id;
    active.level = level;
    active.rules = rules;
    active.grid = [0; 80];
    active.next_row = [0; 8];
    active.has_next_row = false;
    active.score = 0;
    active.daily_score = 0;
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
    active.vrf_requested_at = 0;
    active.action_hash = [0; 32];
    active.vrf_hash = [0; 32];
    active.started_at = 0;
    active.finished_at = 0;
    active.bump = ctx.bumps.active_run;

    let receipt = &mut ctx.accounts.run_receipt;
    receipt.version = ACCOUNT_VERSION;
    receipt.owner = owner;
    receipt.run_shell = shell.key();
    receipt.run_id = run_id;
    receipt.mode = RunMode::Campaign;
    receipt.settlement_target = SettlementTarget::CampaignProgress;
    receipt.content_version = shell.content_version;
    receipt.rules_hash = rules_hash;
    receipt.map_id = map_id;
    receipt.level = level;
    receipt.score = 0;
    receipt.daily_score = 0;
    receipt.pressure_score = 0;
    receipt.final_pressure_tier = 0;
    receipt.daily_scoring_rule = DailyScoringRule::default();
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
    receipt.bump = ctx.bumps.run_receipt;

    ctx.accounts.player_profile.record_run_started(now)?;
    ctx.accounts.player_profile.reserve_run(run_id)?;
    Ok(())
}

fn hash_rules(content_version: u32, map_id: u8, rules: &LevelRuleSnapshot) -> Result<[u8; 32]> {
    let mut serialized = Vec::new();
    rules.serialize(&mut serialized)?;
    Ok(Sha256::new()
        .chain_update(b"zkube-rules-v1")
        .chain_update(content_version.to_le_bytes())
        .chain_update([map_id])
        .chain_update(serialized)
        .finalize()
        .into())
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
        assert!(validate_vault_segregation(vaults).is_ok());

        let duplicate = Pubkey::new_unique();
        assert!(validate_vault_segregation([duplicate, Pubkey::new_unique(), duplicate,]).is_err());
        assert!(validate_vault_segregation([
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
}
