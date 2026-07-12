use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::v2::*;

const CANONICAL_ACHIEVEMENTS: [(u8, u64, u32); MAX_ACHIEVEMENTS] = [
    (0, 20, 50),
    (0, 100, 150),
    (0, 400, 300),
    (0, 1_000, 500),
    (1, 200, 50),
    (1, 1_000, 150),
    (1, 4_000, 300),
    (1, 10_000, 500),
    (2, 3, 50),
    (2, 4, 150),
    (2, 5, 300),
    (2, 6, 500),
    (3, 1, 50),
    (3, 5, 150),
    (3, 15, 300),
    (3, 50, 500),
    (4, 1, 100),
    (4, 3, 200),
    (5, 30, 400),
    (4, 10, 1_000),
    (6, 1, 50),
    (6, 7, 150),
    (6, 30, 300),
    (6, 100, 500),
];
const CANONICAL_QUEST_METRICS: [u8; MAX_QUESTS] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const CANONICAL_QUEST_THRESHOLDS: [u32; MAX_QUESTS] = [20, 3, 1, 2, 1, 1, 1, 2, 5, 3, 150, 3];

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct WriteProgressCatalogArgs {
    pub progress_version: u32,
    pub achievement_count: u8,
    pub quest_count: u8,
    pub achievements: [AchievementRule; MAX_ACHIEVEMENTS],
    pub quests: [QuestRule; MAX_QUESTS],
}

#[derive(Accounts)]
#[instruction(args: WriteProgressCatalogArgs)]
pub struct WriteProgressCatalogV1<'info> {
    #[account(
        mut,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        init,
        payer = authority,
        space = 8 + ProgressCatalog::INIT_SPACE,
        seeds = [PROGRESS_CATALOG_SEED, args.progress_version.to_le_bytes().as_ref()],
        bump
    )]
    pub progress_catalog: Box<Account<'info, ProgressCatalog>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_write_progress_catalog_v1(
    ctx: Context<WriteProgressCatalogV1>,
    args: WriteProgressCatalogArgs,
) -> Result<()> {
    require!(!ctx.accounts.protocol.paused, ErrorCode::ProtocolPaused);
    validate_catalog(&args)?;
    let initial_activation = catalog_activates_immediately(
        ctx.accounts.protocol.progress_version,
        args.progress_version,
    )?;
    ctx.accounts.progress_catalog.set_inner(ProgressCatalog {
        version: ACCOUNT_VERSION_V1,
        progress_version: args.progress_version,
        achievement_count: args.achievement_count,
        quest_count: args.quest_count,
        achievements: args.achievements,
        quests: args.quests,
        bump: ctx.bumps.progress_catalog,
    });
    if initial_activation {
        ctx.accounts.protocol.progress_version = args.progress_version;
    }
    emit!(ProgressCatalogPublishedV1 {
        progress_catalog: ctx.accounts.progress_catalog.key(),
        progress_version: args.progress_version,
        publisher: ctx.accounts.authority.key(),
        activated: initial_activation,
    });
    Ok(())
}

#[event]
pub struct ProgressCatalogPublishedV1 {
    pub progress_catalog: Pubkey,
    pub progress_version: u32,
    pub publisher: Pubkey,
    pub activated: bool,
}

#[derive(Accounts)]
pub struct ClaimAchievementV1<'info> {
    #[account(
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused,
        constraint = protocol.progress_version == progress_catalog.progress_version @ ErrorCode::ContentVersionMismatch
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [PROGRESS_CATALOG_SEED, protocol.progress_version.to_le_bytes().as_ref()],
        bump = progress_catalog.bump,
        constraint = progress_catalog.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion
    )]
    pub progress_catalog: Box<Account<'info, ProgressCatalog>>,
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
    pub owner: Signer<'info>,
}

pub fn handler_claim_achievement_v1(
    ctx: Context<ClaimAchievementV1>,
    achievement_index: u8,
) -> Result<()> {
    let index = usize::from(achievement_index);
    require!(
        index < usize::from(ctx.accounts.progress_catalog.achievement_count),
        ErrorCode::InvalidProgressCatalog
    );
    let rule = ctx.accounts.progress_catalog.achievements[index];
    require!(rule.enabled, ErrorCode::InvalidProgressCatalog);
    let progress = ctx
        .accounts
        .player_profile
        .achievement_metric(rule.metric, &ctx.accounts.campaign_progress)
        .ok_or(ErrorCode::InvalidProgressCatalog)?;
    let (star_reward, xp_reward) = claim_achievement_once(
        &mut ctx.accounts.player_profile.achievement_flags,
        index,
        progress,
        rule,
    )?;
    ctx.accounts
        .player_profile
        .credit_achievement_rewards(star_reward, xp_reward)?;
    emit!(AchievementClaimedV1 {
        owner: ctx.accounts.owner.key(),
        progress_version: ctx.accounts.protocol.progress_version,
        achievement_index,
        star_reward,
        xp_reward,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimQuestV1<'info> {
    #[account(
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused,
        constraint = protocol.progress_version == progress_catalog.progress_version @ ErrorCode::ContentVersionMismatch
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [PROGRESS_CATALOG_SEED, protocol.progress_version.to_le_bytes().as_ref()],
        bump = progress_catalog.bump,
        constraint = progress_catalog.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion
    )]
    pub progress_catalog: Box<Account<'info, ProgressCatalog>>,
    #[account(
        mut,
        seeds = [PLAYER_PROFILE_SEED, owner.key().as_ref()],
        bump = player_profile.bump,
        has_one = owner @ ErrorCode::Unauthorized
    )]
    pub player_profile: Box<Account<'info, PlayerProfile>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + QuestClaims::INIT_SPACE,
        seeds = [QUEST_CLAIMS_SEED, owner.key().as_ref(), protocol.progress_version.to_le_bytes().as_ref()],
        bump
    )]
    pub quest_claims: Box<Account<'info, QuestClaims>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_claim_quest_v1(ctx: Context<ClaimQuestV1>, quest_index: u8) -> Result<()> {
    let index = usize::from(quest_index);
    require!(
        index < usize::from(ctx.accounts.progress_catalog.quest_count),
        ErrorCode::InvalidProgressCatalog
    );
    let rule = ctx.accounts.progress_catalog.quests[index];
    require!(rule.enabled, ErrorCode::InvalidProgressCatalog);
    let now = Clock::get()?.unix_timestamp;
    let day = cadence_day(now);
    let week = cadence_week(now);
    ctx.accounts.player_profile.roll_quest_cadences(now);
    let claims = &mut ctx.accounts.quest_claims;
    if claims.version == 0 {
        claims.version = ACCOUNT_VERSION_V1;
        claims.owner = ctx.accounts.owner.key();
        claims.progress_version = ctx.accounts.protocol.progress_version;
        claims.daily_cadence_id = day;
        claims.weekly_cadence_id = week;
        claims.daily_claimed = 0;
        claims.weekly_claimed = 0;
        claims.bump = ctx.bumps.quest_claims;
    } else {
        require_keys_eq!(
            claims.owner,
            ctx.accounts.owner.key(),
            ErrorCode::Unauthorized
        );
        require!(
            claims.progress_version == ctx.accounts.protocol.progress_version,
            ErrorCode::ContentVersionMismatch
        );
        claims.roll(day, week);
    }
    let claimed = if rule.cadence == 0 {
        &mut claims.daily_claimed
    } else {
        &mut claims.weekly_claimed
    };
    let progress = ctx.accounts.player_profile.quest_counters[usize::from(rule.metric)];
    let reward = claim_quest_once(claimed, index, day, progress, rule)?;
    if rule.cadence == 0 && rule.metric != 9 {
        ctx.accounts.player_profile.quest_counters[9] = ctx.accounts.player_profile.quest_counters
            [9]
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    }
    ctx.accounts.player_profile.credit_stars(reward)?;
    emit!(QuestClaimedV1 {
        owner: ctx.accounts.owner.key(),
        progress_version: ctx.accounts.protocol.progress_version,
        quest_index,
        cadence_id: if rule.cadence == 0 { day } else { week },
        star_reward: reward,
    });
    Ok(())
}

#[event]
pub struct AchievementClaimedV1 {
    pub owner: Pubkey,
    pub progress_version: u32,
    pub achievement_index: u8,
    pub star_reward: u64,
    pub xp_reward: u32,
}

#[event]
pub struct QuestClaimedV1 {
    pub owner: Pubkey,
    pub progress_version: u32,
    pub quest_index: u8,
    pub cadence_id: u32,
    pub star_reward: u64,
}

fn validate_catalog(args: &WriteProgressCatalogArgs) -> Result<()> {
    require!(args.progress_version > 0, ErrorCode::InvalidProgressCatalog);
    require!(
        usize::from(args.achievement_count) <= MAX_ACHIEVEMENTS
            && usize::from(args.quest_count) <= MAX_QUESTS,
        ErrorCode::InvalidProgressCatalog
    );
    require!(
        usize::from(args.achievement_count) == MAX_ACHIEVEMENTS,
        ErrorCode::InvalidProgressCatalog
    );
    for rule in args
        .achievements
        .iter()
        .take(usize::from(args.achievement_count))
    {
        require!(
            rule.enabled
                && rule.metric <= 7
                && rule.threshold > 0
                && rule.star_reward <= MAX_PROGRESS_REWARD
                && rule.xp_reward <= MAX_ACHIEVEMENT_XP_REWARD
                && (rule.star_reward > 0 || rule.xp_reward > 0),
            ErrorCode::InvalidProgressCatalog
        );
    }
    for (rule, (metric, threshold, xp_reward)) in
        args.achievements.iter().zip(CANONICAL_ACHIEVEMENTS)
    {
        require!(
            rule.metric == metric
                && rule.threshold == threshold
                && rule.star_reward == 0
                && rule.xp_reward == xp_reward,
            ErrorCode::InvalidProgressCatalog
        );
    }
    for rule in args.quests.iter().take(usize::from(args.quest_count)) {
        require!(
            rule.enabled
                && usize::from(rule.metric) < MAX_QUEST_COUNTERS
                && rule.cadence <= 1
                && rule.rotation_modulus > 0
                && rule.rotation_remainder < rule.rotation_modulus
                && (rule.cadence == 0
                    || (rule.rotation_modulus == 1 && rule.rotation_remainder == 0))
                && rule.threshold > 0
                && (1..=MAX_PROGRESS_REWARD).contains(&rule.star_reward),
            ErrorCode::InvalidProgressCatalog
        );
    }
    validate_repeatable_quest_budget(args)?;
    Ok(())
}

fn catalog_activates_immediately(current_version: u32, published_version: u32) -> Result<bool> {
    require!(
        published_version > current_version && (current_version != 0 || published_version == 1),
        ErrorCode::InvalidProgressCatalog
    );
    Ok(current_version == 0)
}

fn validate_repeatable_quest_budget(args: &WriteProgressCatalogArgs) -> Result<()> {
    require!(
        args.quest_count == ACTIVATION_QUEST_COUNT,
        ErrorCode::InvalidProgressCatalog
    );
    for (index, rule) in args.quests.iter().enumerate() {
        require!(
            rule.metric == CANONICAL_QUEST_METRICS[index]
                && rule.threshold == CANONICAL_QUEST_THRESHOLDS[index],
            ErrorCode::InvalidProgressCatalog
        );
    }
    for (index, rule) in args.quests.iter().take(DAILY_ROTATING_QUESTS).enumerate() {
        require!(
            rule.cadence == 0
                && rule.metric != 9
                && rule.rotation_modulus == 3
                && usize::from(rule.rotation_remainder) == index / DAILY_ACTIVE_QUESTS
                && rule.star_reward == 1,
            ErrorCode::InvalidProgressCatalog
        );
    }
    let finisher = args.quests[DAILY_FINISHER_INDEX];
    require!(
        finisher.cadence == 0
            && finisher.metric == 9
            && finisher.threshold == DAILY_ACTIVE_QUESTS as u32
            && finisher.rotation_modulus == 1
            && finisher.rotation_remainder == 0
            && finisher.star_reward == 2,
        ErrorCode::InvalidProgressCatalog
    );
    for rule in args
        .quests
        .iter()
        .take(usize::from(ACTIVATION_QUEST_COUNT))
        .skip(DAILY_FINISHER_INDEX + 1)
    {
        require!(
            rule.cadence == 1
                && rule.rotation_modulus == 1
                && rule.rotation_remainder == 0
                && rule.star_reward == 5,
            ErrorCode::InvalidProgressCatalog
        );
    }
    Ok(())
}

fn claim_achievement_once(
    flags: &mut [u64; 4],
    index: usize,
    progress: u64,
    rule: AchievementRule,
) -> Result<(u64, u32)> {
    let word = index / 64;
    let mask = 1u64 << (index % 64);
    require!(flags[word] & mask == 0, ErrorCode::RewardAlreadyClaimed);
    require!(progress >= rule.threshold, ErrorCode::RewardNotEarned);
    flags[word] |= mask;
    Ok((rule.star_reward, rule.xp_reward))
}

fn claim_quest_once(
    claimed: &mut u16,
    index: usize,
    day: u32,
    progress: u32,
    rule: QuestRule,
) -> Result<u64> {
    if rule.cadence == 0 {
        require!(
            day % u32::from(rule.rotation_modulus) == u32::from(rule.rotation_remainder),
            ErrorCode::QuestNotActive
        );
    }
    let mask = 1u16 << index;
    require!(*claimed & mask == 0, ErrorCode::RewardAlreadyClaimed);
    require!(progress >= rule.threshold, ErrorCode::RewardNotEarned);
    *claimed |= mask;
    Ok(rule.star_reward)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_rejects_canonical_reward_or_threshold_drift() {
        let mut args = activation_catalog();
        assert!(validate_catalog(&args).is_ok());
        args.achievements[0].star_reward = 1;
        assert!(validate_catalog(&args).is_err());
        args.achievements[0].star_reward = 0;
        args.achievements[0].xp_reward = 0;
        assert!(validate_catalog(&args).is_err());
        args.achievements[0].xp_reward = 50;
        args.achievements[0].threshold = 21;
        assert!(validate_catalog(&args).is_err());
        args.achievements[0].threshold = 20;
        args.quests[0].star_reward = 0;
        assert!(validate_catalog(&args).is_err());
        args.quests[0].star_reward = 1;
        args.quests[0].star_reward = MAX_PROGRESS_REWARD + 1;
        assert!(validate_catalog(&args).is_err());
    }

    #[test]
    fn repeatable_catalog_is_exactly_five_stars_daily_and_ten_weekly() {
        let mut args = activation_catalog();
        assert!(validate_catalog(&args).is_ok());
        for day in 0..3u32 {
            let daily: u64 = args.quests[..=DAILY_FINISHER_INDEX]
                .iter()
                .filter(|rule| {
                    day % u32::from(rule.rotation_modulus) == u32::from(rule.rotation_remainder)
                })
                .map(|rule| rule.star_reward)
                .sum();
            assert_eq!(daily, 5);
        }
        let weekly: u64 = args.quests[10..12]
            .iter()
            .map(|rule| rule.star_reward)
            .sum();
        assert_eq!(weekly, 10);
        assert_eq!(5 * 7 + weekly, 45);

        args.quests[0].star_reward = 2;
        assert!(validate_catalog(&args).is_err());
        args = activation_catalog();
        args.quests[DAILY_FINISHER_INDEX].threshold = 2;
        assert!(validate_catalog(&args).is_err());
        args = activation_catalog();
        args.quests[3].rotation_remainder = 0;
        assert!(validate_catalog(&args).is_err());
        args = activation_catalog();
        args.quest_count = 11;
        assert!(validate_catalog(&args).is_err());
    }

    #[test]
    fn achievement_reward_is_earned_and_claimed_exactly_once() {
        let rule = AchievementRule {
            metric: 0,
            enabled: true,
            threshold: 20,
            star_reward: 0,
            xp_reward: 50,
        };
        let mut flags = [0; 4];
        assert!(claim_achievement_once(&mut flags, 0, 19, rule).is_err());
        assert_eq!(
            claim_achievement_once(&mut flags, 0, 20, rule).unwrap(),
            (0, 50)
        );
        assert!(claim_achievement_once(&mut flags, 0, 20, rule).is_err());
    }

    #[test]
    fn rotating_quest_is_active_and_claimable_once_per_cadence() {
        let rule = QuestRule {
            metric: 0,
            cadence: 0,
            rotation_modulus: 3,
            rotation_remainder: 1,
            enabled: true,
            threshold: 20,
            star_reward: 1,
        };
        let mut claimed = 0;
        assert!(claim_quest_once(&mut claimed, 2, 3, 20, rule).is_err());
        assert!(claim_quest_once(&mut claimed, 2, 4, 19, rule).is_err());
        assert_eq!(claim_quest_once(&mut claimed, 2, 4, 20, rule).unwrap(), 1);
        assert!(claim_quest_once(&mut claimed, 2, 4, 20, rule).is_err());
    }

    #[test]
    fn only_the_genesis_catalog_activates_without_governance() {
        assert!(catalog_activates_immediately(0, 1).unwrap());
        assert!(!catalog_activates_immediately(1, 2).unwrap());
        assert!(catalog_activates_immediately(0, 2).is_err());
        assert!(catalog_activates_immediately(2, 2).is_err());
        assert!(catalog_activates_immediately(2, 1).is_err());
    }

    fn activation_catalog() -> WriteProgressCatalogArgs {
        let mut args = WriteProgressCatalogArgs {
            progress_version: 1,
            achievement_count: MAX_ACHIEVEMENTS as u8,
            quest_count: ACTIVATION_QUEST_COUNT,
            achievements: [AchievementRule::default(); MAX_ACHIEVEMENTS],
            quests: [QuestRule::default(); MAX_QUESTS],
        };
        for (index, (metric, threshold, xp_reward)) in
            CANONICAL_ACHIEVEMENTS.into_iter().enumerate()
        {
            args.achievements[index] = AchievementRule {
                metric,
                enabled: true,
                threshold,
                star_reward: 0,
                xp_reward,
            };
        }
        for (index, metric) in [0u8, 1, 2, 3, 4, 5, 6, 7, 8].into_iter().enumerate() {
            args.quests[index] = QuestRule {
                metric,
                cadence: 0,
                rotation_modulus: 3,
                rotation_remainder: (index / DAILY_ACTIVE_QUESTS) as u8,
                enabled: true,
                threshold: CANONICAL_QUEST_THRESHOLDS[index],
                star_reward: 1,
            };
        }
        args.quests[DAILY_FINISHER_INDEX] = QuestRule {
            metric: 9,
            cadence: 0,
            rotation_modulus: 1,
            rotation_remainder: 0,
            enabled: true,
            threshold: 3,
            star_reward: 2,
        };
        for (index, metric) in [10u8, 11].into_iter().enumerate() {
            args.quests[index + DAILY_FINISHER_INDEX + 1] = QuestRule {
                metric,
                cadence: 1,
                rotation_modulus: 1,
                rotation_remainder: 0,
                enabled: true,
                threshold: CANONICAL_QUEST_THRESHOLDS[index + DAILY_FINISHER_INDEX + 1],
                star_reward: 5,
            };
        }
        args
    }
}
