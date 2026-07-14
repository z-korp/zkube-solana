use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::*;

#[derive(Clone, Copy)]
struct AchievementDefinition {
    metric: u8,
    threshold: u64,
    xp: u32,
}

const ACHIEVEMENTS: [AchievementDefinition; MAX_ACHIEVEMENTS] = [
    achievement(0, 20, 300),
    achievement(0, 100, 900),
    achievement(0, 400, 1_800),
    achievement(0, 1_000, 3_000),
    achievement(1, 200, 300),
    achievement(1, 1_000, 900),
    achievement(1, 4_000, 1_800),
    achievement(1, 10_000, 3_000),
    achievement(2, 3, 300),
    achievement(2, 4, 900),
    achievement(2, 5, 1_800),
    achievement(2, 6, 3_000),
    achievement(3, 1, 300),
    achievement(3, 5, 900),
    achievement(3, 15, 1_800),
    achievement(3, 50, 3_000),
    achievement(4, 1, 600),
    achievement(4, 3, 1_200),
    achievement(5, 30, 2_400),
    achievement(4, 10, 6_000),
    achievement(6, 1, 300),
    achievement(6, 7, 900),
    achievement(6, 30, 1_800),
    achievement(6, 100, 3_000),
];

const fn achievement(metric: u8, threshold: u64, xp: u32) -> AchievementDefinition {
    AchievementDefinition {
        metric,
        threshold,
        xp,
    }
}

const QUEST_THRESHOLDS: [u32; MAX_QUESTS] = [20, 3, 1, 2, 1, 1, 1, 2, 5, 3, 150, 3];

#[derive(Clone, Copy)]
struct QuestDefinition {
    metric: u8,
    cadence: u8,
    rotation_modulus: u8,
    rotation_remainder: u8,
    threshold: u32,
    reward_units: u64,
}

fn quest_definition(index: usize) -> Result<QuestDefinition> {
    require!(index < MAX_QUESTS, ErrorCode::InvalidProgressRule);
    let (cadence, rotation_modulus, rotation_remainder, reward_units) = match index {
        0..=8 => (0, 3, (index / DAILY_ACTIVE_QUESTS) as u8, 1),
        DAILY_FINISHER_INDEX => (0, 1, 0, 2),
        10..=11 => (1, 1, 0, 5),
        _ => return err!(ErrorCode::InvalidProgressRule),
    };
    Ok(QuestDefinition {
        metric: index as u8,
        cadence,
        rotation_modulus,
        rotation_remainder,
        threshold: QUEST_THRESHOLDS[index],
        reward_units,
    })
}

#[derive(Accounts)]
pub struct ClaimAchievement<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
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
    pub owner: Signer<'info>,
}

pub fn handler_claim_achievement(
    ctx: Context<ClaimAchievement>,
    achievement_index: u8,
) -> Result<()> {
    let index = usize::from(achievement_index);
    let definition = *ACHIEVEMENTS
        .get(index)
        .ok_or(ErrorCode::InvalidProgressRule)?;
    let progress = ctx
        .accounts
        .player_profile
        .achievement_metric(definition.metric, &ctx.accounts.campaign_progress)
        .ok_or(ErrorCode::InvalidProgressRule)?;
    claim_achievement_once(
        &mut ctx.accounts.player_profile.achievement_flags,
        index,
        progress,
        definition,
    )?;
    ctx.accounts
        .player_profile
        .credit_achievement_rewards(0, definition.xp)?;
    emit!(AchievementClaimed {
        owner: ctx.accounts.owner.key(),
        achievement_index,
        xp_reward: definition.xp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimQuest<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
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
        init_if_needed,
        payer = payer,
        space = 8 + QuestClaims::INIT_SPACE,
        seeds = [QUEST_CLAIMS_SEED, owner.key().as_ref()],
        bump
    )]
    pub quest_claims: Box<Account<'info, QuestClaims>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + WeeklyStipend::INIT_SPACE,
        seeds = [WEEKLY_STIPEND_SEED, owner.key().as_ref()],
        bump
    )]
    pub weekly_stipend: Box<Account<'info, WeeklyStipend>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_claim_quest(ctx: Context<ClaimQuest>, quest_index: u8) -> Result<()> {
    let index = usize::from(quest_index);
    let definition = quest_definition(index)?;
    let now = Clock::get()?.unix_timestamp;
    let day = cadence_day(now);
    let week = cadence_week(now);
    ctx.accounts.player_profile.roll_quest_cadences(now);

    let claims = &mut ctx.accounts.quest_claims;
    if claims.version == 0 {
        claims.version = ACCOUNT_VERSION;
        claims.owner = ctx.accounts.owner.key();
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
        claims.roll(day, week);
    }

    let claimed = if definition.cadence == 0 {
        &mut claims.daily_claimed
    } else {
        &mut claims.weekly_claimed
    };
    let progress = ctx.accounts.player_profile.quest_counters[usize::from(definition.metric)];
    claim_quest_once(claimed, index, day, progress, definition)?;

    if definition.cadence == 0 && definition.metric != 9 {
        ctx.accounts.player_profile.quest_counters[9] = ctx.accounts.player_profile.quest_counters
            [9]
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    }

    let owner = ctx.accounts.owner.key();
    initialize_or_roll_stipend(
        &mut ctx.accounts.weekly_stipend,
        owner,
        week,
        ctx.bumps.weekly_stipend,
    )?;
    if definition.cadence == 0 {
        let xp_reward = u32::try_from(
            definition
                .reward_units
                .checked_mul(u64::from(QUEST_XP_PER_LEGACY_STAR))
                .ok_or(ErrorCode::ArithmeticOverflow)?,
        )
        .map_err(|_| ErrorCode::ArithmeticOverflow)?;
        ctx.accounts
            .player_profile
            .credit_achievement_rewards(0, xp_reward)?;
        ctx.accounts
            .weekly_stipend
            .record_recurring_xp(week, xp_reward)?;
        emit_stipend_if_awarded(
            &mut ctx.accounts.weekly_stipend,
            &mut ctx.accounts.player_profile,
        )?;
        emit!(DailyQuestXpClaimed {
            owner,
            quest_index,
            cadence_id: day,
            xp_reward,
        });
    } else {
        ctx.accounts
            .player_profile
            .credit_stars(definition.reward_units)?;
        emit!(WeeklyQuestStarsClaimed {
            owner,
            quest_index,
            cadence_id: week,
            stars: definition.reward_units,
        });
    }
    Ok(())
}

pub(crate) fn initialize_or_roll_stipend(
    stipend: &mut WeeklyStipend,
    owner: Pubkey,
    week: u32,
    bump: u8,
) -> Result<()> {
    if stipend.version == 0 {
        *stipend = WeeklyStipend::initialize(owner, week, bump);
    } else {
        require!(
            stipend.version == ECONOMY_ACCOUNT_VERSION,
            ErrorCode::InvalidVersion
        );
        require_keys_eq!(stipend.owner, owner, ErrorCode::Unauthorized);
        stipend.roll(week);
    }
    Ok(())
}

pub(crate) fn emit_stipend_if_awarded(
    stipend: &mut WeeklyStipend,
    player: &mut PlayerProfile,
) -> Result<()> {
    if stipend.maybe_award(player)? {
        emit!(WeeklyStipendAwarded {
            owner: stipend.owner,
            week_id: stipend.week_id,
            recurring_xp: stipend.recurring_xp,
            stars: WEEKLY_STIPEND_STARS,
        });
    }
    Ok(())
}

fn claim_achievement_once(
    flags: &mut [u64; 4],
    index: usize,
    progress: u64,
    definition: AchievementDefinition,
) -> Result<()> {
    let word = index / 64;
    let mask = 1u64 << (index % 64);
    require!(flags[word] & mask == 0, ErrorCode::RewardAlreadyClaimed);
    require!(progress >= definition.threshold, ErrorCode::RewardNotEarned);
    flags[word] |= mask;
    Ok(())
}

fn claim_quest_once(
    claimed: &mut u16,
    index: usize,
    day: u32,
    progress: u32,
    definition: QuestDefinition,
) -> Result<()> {
    if definition.cadence == 0 {
        require!(
            day % u32::from(definition.rotation_modulus)
                == u32::from(definition.rotation_remainder),
            ErrorCode::QuestNotActive
        );
    }
    let mask = 1u16 << index;
    require!(*claimed & mask == 0, ErrorCode::RewardAlreadyClaimed);
    require!(progress >= definition.threshold, ErrorCode::RewardNotEarned);
    *claimed |= mask;
    Ok(())
}

#[event]
pub struct AchievementClaimed {
    pub owner: Pubkey,
    pub achievement_index: u8,
    pub xp_reward: u32,
}

#[event]
pub struct DailyQuestXpClaimed {
    pub owner: Pubkey,
    pub quest_index: u8,
    pub cadence_id: u32,
    pub xp_reward: u32,
}

#[event]
pub struct WeeklyQuestStarsClaimed {
    pub owner: Pubkey,
    pub quest_index: u8,
    pub cadence_id: u32,
    pub stars: u64,
}

#[event]
pub struct WeeklyStipendAwarded {
    pub owner: Pubkey,
    pub week_id: u32,
    pub recurring_xp: u32,
    pub stars: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_achievements_total_40_200_xp() {
        assert_eq!(
            ACHIEVEMENTS
                .iter()
                .map(|definition| u64::from(definition.xp))
                .sum::<u64>(),
            40_200
        );
    }

    #[test]
    fn canonical_quests_keep_daily_xp_and_weekly_stars() {
        for index in 0..9 {
            let quest = quest_definition(index).unwrap();
            assert_eq!(quest.cadence, 0);
            assert_eq!(quest.reward_units, 1);
        }
        assert_eq!(quest_definition(9).unwrap().reward_units, 2);
        for index in 10..12 {
            let quest = quest_definition(index).unwrap();
            assert_eq!(quest.cadence, 1);
            assert_eq!(quest.reward_units, 5);
        }
    }
}
