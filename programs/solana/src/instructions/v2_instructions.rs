use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use sha2::{Digest, Sha256};

use crate::error::ErrorCode;
use crate::game::{campaign_map, CampaignLevelRules, ConstraintKind};
use crate::state::v2::*;

use super::governance_instructions::validate_governance_timing;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeProtocolArgs {
    pub paymaster: Pubkey,
    pub team_vault: Pubkey,
    pub paymaster_vault: Pubkey,
    pub treasury_vault: Pubkey,
    pub reward_vault: Pubkey,
    pub paymaster_cap: u64,
    pub revenue_reward_bps: u16,
    pub sponsorship_daily_tx_limit: u16,
    pub sponsorship_daily_paid_attempt_limit: u16,
    pub payment_mint: Pubkey,
    pub payment_token_program: Pubkey,
    pub payment_vault: Pubkey,
    pub content_version: u32,
    pub governance_delay_seconds: u32,
    pub governance_execution_window_seconds: u32,
}

#[derive(Accounts)]
#[instruction(args: InitializeProtocolArgs)]
pub struct InitializeProtocolV1<'info> {
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
        space = 8 + TreasuryLedger::INIT_SPACE,
        seeds = [TREASURY_LEDGER_SEED],
        bump
    )]
    pub treasury_ledger: Box<Account<'info, TreasuryLedger>>,
    #[account(
        init,
        payer = authority,
        space = 8 + YieldStrategyPolicy::INIT_SPACE,
        seeds = [YIELD_POLICY_SEED],
        bump
    )]
    pub yield_policy: Box<Account<'info, YieldStrategyPolicy>>,
    #[account(address = args.payment_mint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        address = args.team_vault,
        token::mint = payment_mint,
        token::token_program = payment_token_program
    )]
    pub team_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        address = args.paymaster_vault,
        token::mint = payment_mint,
        token::authority = protocol,
        token::token_program = payment_token_program
    )]
    pub paymaster_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        address = args.treasury_vault,
        token::mint = payment_mint,
        token::authority = protocol,
        token::token_program = payment_token_program
    )]
    pub treasury_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        address = args.reward_vault,
        token::mint = payment_mint,
        token::authority = protocol,
        token::token_program = payment_token_program
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        address = args.payment_vault,
        token::mint = payment_mint,
        token::authority = protocol,
        token::token_program = payment_token_program
    )]
    pub payment_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        address = args.payment_token_program,
        constraint = args.payment_token_program == anchor_spl::token::ID @ ErrorCode::InvalidOwner
    )]
    pub payment_token_program: Interface<'info, TokenInterface>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_initialize_protocol_v1(
    ctx: Context<InitializeProtocolV1>,
    args: InitializeProtocolArgs,
) -> Result<()> {
    validate_governance_timing(
        args.governance_delay_seconds,
        args.governance_execution_window_seconds,
    )?;
    require!(
        args.revenue_reward_bps <= 10_000,
        ErrorCode::InvalidBasisPoints
    );
    validate_payment_asset(
        ctx.accounts.payment_token_program.key(),
        ctx.accounts.payment_mint.decimals,
    )?;
    validate_vault_segregation([
        args.team_vault,
        args.paymaster_vault,
        args.treasury_vault,
        args.reward_vault,
        args.payment_vault,
    ])?;
    let protocol = &mut ctx.accounts.protocol;
    protocol.version = ACCOUNT_VERSION_V1;
    protocol.authority = ctx.accounts.authority.key();
    protocol.pending_authority = Pubkey::default();
    protocol.paymaster = args.paymaster;
    protocol.team_vault = args.team_vault;
    protocol.paymaster_vault = args.paymaster_vault;
    protocol.treasury_vault = args.treasury_vault;
    protocol.reward_vault = args.reward_vault;
    protocol.paymaster_cap = args.paymaster_cap;
    protocol.revenue_reward_bps = args.revenue_reward_bps;
    require!(
        args.sponsorship_daily_tx_limit > 0 && args.sponsorship_daily_paid_attempt_limit > 0,
        ErrorCode::InvalidState
    );
    protocol.sponsorship_daily_tx_limit = args.sponsorship_daily_tx_limit;
    protocol.sponsorship_daily_paid_attempt_limit = args.sponsorship_daily_paid_attempt_limit;
    protocol.payment_mint = args.payment_mint;
    protocol.payment_token_program = args.payment_token_program;
    protocol.payment_vault = args.payment_vault;
    protocol.treasury_ledger = ctx.accounts.treasury_ledger.key();
    protocol.yield_policy = ctx.accounts.yield_policy.key();
    protocol.content_version = args.content_version;
    protocol.progress_version = 0;
    protocol.governance_delay_seconds = args.governance_delay_seconds;
    protocol.governance_execution_window_seconds = args.governance_execution_window_seconds;
    protocol.next_governance_proposal_id = 1;
    protocol.paused = false;
    protocol.bump = ctx.bumps.protocol;
    ctx.accounts
        .treasury_ledger
        .set_inner(TreasuryLedger::initialize(
            protocol.key(),
            args.payment_mint,
            ctx.bumps.treasury_ledger,
        ));
    ctx.accounts
        .yield_policy
        .set_inner(YieldStrategyPolicy::initialize(
            protocol.key(),
            ctx.bumps.yield_policy,
        ));
    Ok(())
}

fn validate_payment_asset(token_program: Pubkey, decimals: u8) -> Result<()> {
    require_keys_eq!(
        token_program,
        anchor_spl::token::ID,
        ErrorCode::InvalidOwner
    );
    require!(decimals == 6, ErrorCode::InvalidState);
    Ok(())
}

fn validate_vault_segregation(vaults: [Pubkey; 5]) -> Result<()> {
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
pub struct InitializePlayerV1<'info> {
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + PlayerProfile::INIT_SPACE,
        seeds = [PLAYER_PROFILE_SEED, owner.key().as_ref()],
        bump
    )]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + CampaignProgress::INIT_SPACE,
        seeds = [CAMPAIGN_PROGRESS_SEED, owner.key().as_ref()],
        bump
    )]
    pub campaign_progress: Box<Account<'info, CampaignProgress>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_initialize_player_v1(ctx: Context<InitializePlayerV1>) -> Result<()> {
    let owner = ctx.accounts.owner.key();
    let player = &mut ctx.accounts.player_profile;
    if player.version == 0 {
        player.set_inner(PlayerProfile::initialize(owner, ctx.bumps.player_profile));
    } else {
        require!(player.owner == owner, ErrorCode::Unauthorized);
        require!(
            player.version == ACCOUNT_VERSION_V1,
            ErrorCode::InvalidVersion
        );
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
            campaign.version == ACCOUNT_VERSION_V1,
            ErrorCode::InvalidVersion
        );
    }
    Ok(())
}

#[derive(Accounts)]
#[instruction(run_id: u64)]
pub struct RotateRunShellAuthorityV1<'info> {
    #[account(
        mut,
        seeds = [RUN_SHELL_SEED, owner.key().as_ref(), run_id.to_le_bytes().as_ref()],
        bump = run_shell.bump,
        has_one = owner @ ErrorCode::Unauthorized
    )]
    pub run_shell: Box<Account<'info, RunShell>>,
    pub owner: Signer<'info>,
}

pub fn handler_rotate_run_shell_authority_v1(
    ctx: Context<RotateRunShellAuthorityV1>,
    run_id: u64,
    new_action_authority: Pubkey,
) -> Result<()> {
    require!(
        session_rotation_is_allowed(ctx.accounts.run_shell.lifecycle, new_action_authority),
        ErrorCode::InvalidState
    );
    require!(
        ctx.accounts.run_shell.run_id == run_id,
        ErrorCode::InvalidRunId
    );
    ctx.accounts.run_shell.action_authority = new_action_authority;
    Ok(())
}

fn session_rotation_is_allowed(lifecycle: RunLifecycle, new_authority: Pubkey) -> bool {
    new_authority != Pubkey::default()
        && !matches!(
            lifecycle,
            RunLifecycle::Committing | RunLifecycle::Settled | RunLifecycle::Cancelled
        )
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct WriteMapCatalogArgs {
    pub content_version: u32,
    pub map_id: u8,
    pub theme_id: u8,
    pub enabled: bool,
    pub star_unlock_cost: u64,
    pub usdc_unlock_cost: u64,
    pub levels: [LevelRuleSnapshot; LEVELS_PER_MAP],
}

#[derive(Accounts)]
#[instruction(args: WriteMapCatalogArgs)]
pub struct WriteMapCatalogV1<'info> {
    #[account(
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion
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

pub fn handler_write_map_catalog_v1(
    ctx: Context<WriteMapCatalogV1>,
    args: WriteMapCatalogArgs,
) -> Result<()> {
    require!(!ctx.accounts.protocol.paused, ErrorCode::ProtocolPaused);
    require!(
        (1..=MAX_MAPS as u8).contains(&args.map_id),
        ErrorCode::InvalidMap
    );
    for (index, level) in args.levels.iter().enumerate() {
        require!(level.level == index as u8 + 1, ErrorCode::InvalidLevel);
        require!(level.max_moves > 0, ErrorCode::InvalidLevel);
        require!(level.bonus_type <= 3, ErrorCode::InvalidLevel);
        require!(level.bonus_trigger_type <= 3, ErrorCode::InvalidLevel);
        require!(level.starting_charges <= 15, ErrorCode::InvalidLevel);
        require!(level.starting_rows <= 9, ErrorCode::InvalidLevel);
        require!(
            level.bonus_trigger_type == 0 || level.bonus_threshold > 0,
            ErrorCode::InvalidLevel
        );
        require!(
            level.block_weights[0] > 0 && level.block_weights.iter().any(|weight| *weight > 0),
            ErrorCode::InvalidBlockWeights
        );
    }

    let catalog = &mut ctx.accounts.map_catalog;
    catalog.version = ACCOUNT_VERSION_V1;
    catalog.content_version = args.content_version;
    catalog.map_id = args.map_id;
    catalog.theme_id = args.theme_id;
    catalog.enabled = args.enabled;
    catalog.star_unlock_cost = args.star_unlock_cost;
    catalog.usdc_unlock_cost = args.usdc_unlock_cost;
    catalog.levels = args.levels;
    catalog.bump = ctx.bumps.map_catalog;
    Ok(())
}

#[derive(Accounts)]
#[instruction(content_version: u32, map_id: u8)]
pub struct WriteCanonicalMapCatalogV1<'info> {
    #[account(
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion,
        constraint = protocol.content_version == content_version @ ErrorCode::ContentVersionMismatch
    )]
    pub protocol: Account<'info, ProtocolConfig>,
    #[account(
        init,
        payer = authority,
        space = 8 + MapCatalog::INIT_SPACE,
        seeds = [MAP_CATALOG_SEED, content_version.to_le_bytes().as_ref(), &[map_id]],
        bump
    )]
    pub map_catalog: Box<Account<'info, MapCatalog>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_write_canonical_map_catalog_v1(
    ctx: Context<WriteCanonicalMapCatalogV1>,
    content_version: u32,
    map_id: u8,
) -> Result<()> {
    require!(!ctx.accounts.protocol.paused, ErrorCode::ProtocolPaused);
    let canonical = campaign_map(content_version, map_id).ok_or(ErrorCode::InvalidMap)?;
    let catalog = &mut ctx.accounts.map_catalog;
    catalog.version = ACCOUNT_VERSION_V1;
    catalog.content_version = content_version;
    catalog.map_id = canonical.map_id;
    catalog.theme_id = canonical.theme_id;
    catalog.enabled = true;
    catalog.star_unlock_cost = canonical.star_unlock_cost;
    catalog.usdc_unlock_cost = canonical.usdc_unlock_cost;
    catalog.levels = canonical.levels.map(snapshot_from_campaign);
    catalog.bump = ctx.bumps.map_catalog;
    Ok(())
}

fn snapshot_from_campaign(level: CampaignLevelRules) -> LevelRuleSnapshot {
    LevelRuleSnapshot {
        level: level.level,
        points_required: level.points_required,
        max_moves: level.max_moves,
        difficulty: level.difficulty,
        primary: constraint_snapshot(level.primary),
        secondary: constraint_snapshot(level.secondary),
        active_mutator_id: level.active_mutator_id,
        passive_mutator_id: level.passive_mutator_id,
        boss_id: level.boss_id,
        block_weights: level.block_weights,
        score_multiplier_x100: level.score_multiplier_x100,
        combo_multiplier_x100: level.combo_multiplier_x100,
        line_clear_bonus: level.line_clear_bonus,
        perfect_clear_bonus: level.perfect_clear_bonus,
        star_threshold_modifier: level.star_threshold_modifier,
        bonus_type: level.bonus_type,
        bonus_trigger_type: level.bonus_trigger_type,
        bonus_threshold: level.bonus_threshold,
        starting_charges: level.starting_charges,
        starting_rows: level.starting_rows,
    }
}

fn constraint_snapshot(constraint: crate::game::Constraint) -> ConstraintSnapshot {
    ConstraintSnapshot {
        kind: match constraint.kind {
            ConstraintKind::None => 0,
            ConstraintKind::ComboLines => 1,
            ConstraintKind::BreakBlocks => 2,
            ConstraintKind::ComboStreak => 3,
        },
        value: constraint.value,
        required_count: constraint.required_count,
    }
}

#[derive(Accounts)]
#[instruction(run_id: u64, map_id: u8, level: u8)]
pub struct PrepareCampaignRunV1<'info> {
    #[account(
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [PLAYER_PROFILE_SEED, owner.key().as_ref()],
        bump = player_profile.bump,
        has_one = owner @ ErrorCode::Unauthorized
    )]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    #[account(
        seeds = [CAMPAIGN_PROGRESS_SEED, owner.key().as_ref()],
        bump = campaign_progress.bump,
        has_one = owner @ ErrorCode::Unauthorized
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

pub fn handler_prepare_campaign_run_v1(
    ctx: Context<PrepareCampaignRunV1>,
    run_id: u64,
    map_id: u8,
    level: u8,
    action_authority: Pubkey,
) -> Result<()> {
    require!(
        ctx.accounts.player_profile.next_run_id == run_id,
        ErrorCode::InvalidRunId
    );
    require!(
        ctx.accounts.campaign_progress.is_map_unlocked(map_id),
        ErrorCode::MapLocked
    );
    require!(ctx.accounts.map_catalog.enabled, ErrorCode::MapDisabled);
    require!(
        (1..=LEVELS_PER_MAP as u8).contains(&level),
        ErrorCode::InvalidLevel
    );
    require!(
        action_authority != Pubkey::default(),
        ErrorCode::Unauthorized
    );

    let rules = ctx.accounts.map_catalog.levels[(level - 1) as usize];
    let rules_hash = hash_rules(ctx.accounts.protocol.content_version, map_id, &rules)?;
    let now = Clock::get()?.unix_timestamp;
    let owner = ctx.accounts.owner.key();

    let shell = &mut ctx.accounts.run_shell;
    shell.version = ACCOUNT_VERSION_V1;
    shell.owner = owner;
    shell.run_id = run_id;
    shell.mode = RunMode::Campaign;
    shell.settlement_target = SettlementTarget::CampaignProgress;
    shell.content_version = ctx.accounts.protocol.content_version;
    shell.rules_hash = rules_hash;
    shell.map_catalog = ctx.accounts.map_catalog.key();
    shell.daily_challenge = Pubkey::default();
    shell.action_authority = action_authority;
    shell.delegated_validator = Pubkey::default();
    shell.lifecycle = RunLifecycle::Prepared;
    shell.created_at = now;
    shell.settled_at = 0;
    shell.bump = ctx.bumps.run_shell;

    let active = &mut ctx.accounts.active_run;
    active.version = ACCOUNT_VERSION_V1;
    active.owner = owner;
    active.run_shell = shell.key();
    active.daily_challenge = Pubkey::default();
    active.run_id = run_id;
    active.mode = RunMode::Campaign;
    active.lifecycle = RunLifecycle::Prepared;
    active.action_authority = action_authority;
    active.content_version = shell.content_version;
    active.rules_hash = rules_hash;
    active.map_id = map_id;
    active.level = level;
    active.rules = rules;
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
    active.bonus_type = rules.bonus_type;
    active.bonus_charges = rules.starting_charges;
    active.initial_rows_remaining = rules.starting_rows.max(1);
    active.current_difficulty = rules.difficulty;
    active.endless_thresholds = [0; 7];
    active.endless_score_multipliers_x100 = [100; 8];
    active.endless_ramp_multiplier_x100 = 100;
    active.vrf_request_counter = 0;
    active.pending_vrf_counter = 0;
    active.vrf_requested_at = 0;
    active.action_hash = [0; 32];
    active.vrf_hash = [0; 32];
    active.started_at = 0;
    active.finished_at = 0;
    active.bump = ctx.bumps.active_run;

    let receipt = &mut ctx.accounts.run_receipt;
    receipt.version = ACCOUNT_VERSION_V1;
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
    receipt.bump = ctx.bumps.run_receipt;

    ctx.accounts.player_profile.record_run_started(now)?;
    ctx.accounts.player_profile.next_run_id = ctx
        .accounts
        .player_profile
        .next_run_id
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
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
    fn session_rotation_stops_at_terminal_settlement_states() {
        let authority = Pubkey::new_unique();
        assert!(session_rotation_is_allowed(
            RunLifecycle::Prepared,
            authority
        ));
        assert!(session_rotation_is_allowed(
            RunLifecycle::Playing,
            authority
        ));
        assert!(!session_rotation_is_allowed(
            RunLifecycle::Settled,
            authority
        ));
        assert!(!session_rotation_is_allowed(
            RunLifecycle::Playing,
            Pubkey::default()
        ));
    }

    #[test]
    fn payment_asset_rejects_token_2022_extensions_and_non_usdc_precision() {
        assert!(validate_payment_asset(anchor_spl::token::ID, 6).is_ok());
        assert!(validate_payment_asset(anchor_spl::token_2022::ID, 6).is_err());
        assert!(validate_payment_asset(anchor_spl::token::ID, 9).is_err());
    }

    #[test]
    fn protocol_vaults_must_be_nonzero_and_pairwise_distinct() {
        let vaults = std::array::from_fn(|_| Pubkey::new_unique());
        assert!(validate_vault_segregation(vaults).is_ok());

        let duplicate = Pubkey::new_unique();
        assert!(validate_vault_segregation([
            duplicate,
            Pubkey::new_unique(),
            duplicate,
            Pubkey::new_unique(),
            Pubkey::new_unique(),
        ])
        .is_err());
        assert!(validate_vault_segregation([
            Pubkey::default(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
        ])
        .is_err());
    }
}
