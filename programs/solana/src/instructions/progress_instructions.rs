use anchor_lang::prelude::*;
use session_keys::SessionTokenV2;

use crate::error::ErrorCode;
use crate::instructions::player_authorization::require_player_authorization;
use crate::state::*;

#[derive(Clone, Copy)]
struct AchievementDefinition {
    metric: u8,
    threshold: u64,
    xp: u32,
}

const ACHIEVEMENTS: [AchievementDefinition; MAX_ACHIEVEMENTS] = [
    achievement(0, 20, 100),
    achievement(0, 100, 400),
    achievement(0, 400, 1_500),
    achievement(0, 1_000, 4_000),
    achievement(1, 200, 100),
    achievement(1, 1_000, 400),
    achievement(1, 4_000, 1_500),
    achievement(1, 10_000, 4_000),
    achievement(2, 3, 100),
    achievement(2, 4, 400),
    achievement(2, 5, 1_500),
    achievement(2, 6, 4_000),
    achievement(3, 1, 100),
    achievement(3, 5, 400),
    achievement(3, 15, 1_500),
    achievement(3, 50, 4_000),
    achievement(4, 1, 200),
    achievement(4, 3, 800),
    achievement(5, 30, 2_400),
    achievement(4, 10, 6_800),
    achievement(6, 1, 100),
    achievement(6, 7, 400),
    achievement(6, 30, 1_500),
    achievement(6, 100, 4_000),
];

const fn achievement(metric: u8, threshold: u64, xp: u32) -> AchievementDefinition {
    AchievementDefinition {
        metric,
        threshold,
        xp,
    }
}

const QUEST_THRESHOLDS: [u32; MAX_QUESTS] = [
    1, 40, 3, 1, 1, 1, 1, 1, 3, // Daily pool + finisher.
    5, 300, 3, 25, 15, 3, 1, 6, 2, 2, 2,
];
const WEEKLY_ATTENDANCE_INDEX: u8 = 9;
const WEEKLY_OPTIONAL_POOL: [u8; 10] = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const DAILY_QUEST_POOL_SIZE: usize = 8;
const DAILY_QUEST_SELECTION_SIZE: usize = DAILY_ACTIVE_QUESTS;
const DAILY_QUEST_MIX_SEED: u32 = 0x9e37_79b9;

#[derive(Clone, Copy)]
struct QuestDefinition {
    metric: u8,
    cadence: u8,
    threshold: u32,
    xp_reward: u32,
}

fn quest_definition(index: usize) -> Result<QuestDefinition> {
    require!(index < MAX_QUESTS, ErrorCode::InvalidProgressRule);
    let (cadence, xp_reward) = match index {
        0..=7 => (0, 100),
        DAILY_FINISHER_INDEX => (0, 350),
        9..=19 => (1, 500),
        _ => return err!(ErrorCode::InvalidProgressRule),
    };
    Ok(QuestDefinition {
        metric: index as u8,
        cadence,
        threshold: QUEST_THRESHOLDS[index],
        xp_reward,
    })
}

fn seeded_xorshift(seed: u32) -> u32 {
    let mut state = if seed == 0 { 0x6d2b_79f5 } else { seed };
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    state
}

pub(crate) fn daily_quest_indices(
    day: u32,
    owner: Pubkey,
    all_campaign_perfect: bool,
    entered_yesterday: bool,
) -> [u8; DAILY_QUEST_SELECTION_SIZE] {
    let mut shuffled = [0, 1, 2, 3, 4, 5, 6, 7];
    let owner_mix = u32::from_le_bytes(owner.to_bytes()[..4].try_into().unwrap());
    let mut state = day ^ owner_mix ^ DAILY_QUEST_MIX_SEED;
    for upper in (1..DAILY_QUEST_POOL_SIZE).rev() {
        state = seeded_xorshift(state);
        let selected = state as usize % (upper + 1);
        shuffled.swap(upper, selected);
    }

    let mut selected = [0u8; DAILY_QUEST_SELECTION_SIZE];
    let mut selected_count = 0usize;
    for index in shuffled {
        if (index == 5 && all_campaign_perfect) || (index == 7 && !entered_yesterday) {
            continue;
        }
        selected[selected_count] = index;
        selected_count += 1;
        if selected_count == DAILY_QUEST_SELECTION_SIZE {
            break;
        }
    }
    selected
}

pub(crate) fn weekly_quest_indices(
    week: u32,
    owner: Pubkey,
    all_campaign_perfect: bool,
) -> [u8; 3] {
    let mut pool = WEEKLY_OPTIONAL_POOL;
    let owner_mix = u32::from_le_bytes(owner.to_bytes()[4..8].try_into().unwrap());
    let mut state = seeded_xorshift(week ^ owner_mix ^ DAILY_QUEST_MIX_SEED);
    for upper in (1..pool.len()).rev() {
        state = seeded_xorshift(state);
        let selected = state as usize % (upper + 1);
        pool.swap(upper, selected);
    }
    let mut result = [WEEKLY_ATTENDANCE_INDEX, 0, 0];
    let mut count = 1usize;
    for index in pool {
        if index == 11 && all_campaign_perfect {
            continue;
        }
        result[count] = index;
        count += 1;
        if count == result.len() {
            break;
        }
    }
    result
}

fn all_campaign_perfect(player: &PlayerState, campaign_map_count: u8) -> Result<bool> {
    if campaign_map_count == 0 {
        return Ok(false);
    }
    for map_id in 1..=campaign_map_count {
        for level in 1..=LEVELS_PER_MAP as u8 {
            if player.best_stars(map_id, level)? < 3 {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

#[derive(Accounts)]
pub struct ClaimAchievement<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
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
    /// CHECK: Immutable durable player identity, constrained above.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
}

pub fn handler_claim_achievement(
    ctx: Context<ClaimAchievement>,
    achievement_index: u8,
) -> Result<()> {
    require_player_authorization(
        ctx.accounts.owner_authority.key(),
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    let index = usize::from(achievement_index);
    let definition = *ACHIEVEMENTS
        .get(index)
        .ok_or(ErrorCode::InvalidProgressRule)?;
    let progress = ctx
        .accounts
        .player_state
        .achievement_metric(definition.metric)
        .ok_or(ErrorCode::InvalidProgressRule)?;
    claim_achievement_once(
        &mut ctx.accounts.player_state.achievement_flags,
        index,
        progress,
        definition,
    )?;
    ctx.accounts.player_state.credit_xp(definition.xp)?;
    emit!(AchievementClaimed {
        owner: ctx.accounts.owner_authority.key(),
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
    /// CHECK: Immutable durable player identity, constrained above.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
}

pub fn handler_claim_quest(ctx: Context<ClaimQuest>, quest_index: u8) -> Result<()> {
    require_player_authorization(
        ctx.accounts.owner_authority.key(),
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    let index = usize::from(quest_index);
    let now = Clock::get()?.unix_timestamp;
    let day = cadence_day(now);
    let week = cadence_week(now);
    let definition = quest_definition(index)?;
    ctx.accounts.player_state.roll_quest_cadences(now);

    ctx.accounts.player_state.roll_claims(day, week);

    let perfect = all_campaign_perfect(
        &ctx.accounts.player_state,
        ctx.accounts.protocol.campaign_map_count,
    )?;
    let daily_active = daily_quest_indices(
        day,
        ctx.accounts.owner_authority.key(),
        perfect,
        ctx.accounts
            .player_state
            .last_daily_challenge_day
            .checked_add(1)
            == Some(day),
    );
    let weekly_active = weekly_quest_indices(week, ctx.accounts.owner_authority.key(), perfect);
    let progress = if index == DAILY_FINISHER_INDEX {
        u32::from(
            daily_active
                .iter()
                .filter(|quest| ctx.accounts.player_state.daily_claimed & (1u32 << **quest) != 0)
                .count() as u8,
        )
    } else if index == 15 {
        let packed = ctx.accounts.player_state.quest_counters[15];
        u32::from(packed & (1 << 31) != 0 || packed & !(1 << 31) >= 5)
    } else {
        ctx.accounts.player_state.quest_counters[usize::from(definition.metric)]
    };
    let claimed = if definition.cadence == 0 {
        &mut ctx.accounts.player_state.daily_claimed
    } else {
        &mut ctx.accounts.player_state.weekly_claimed
    };
    claim_quest_once(
        claimed,
        index,
        progress,
        definition,
        &daily_active,
        &weekly_active,
    )?;

    if index == DAILY_FINISHER_INDEX {
        ctx.accounts.player_state.quest_counters[14] = ctx.accounts.player_state.quest_counters[14]
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }

    let owner = ctx.accounts.owner_authority.key();
    ctx.accounts.player_state.credit_xp(definition.xp_reward)?;
    if definition.cadence == 1
        && weekly_active
            .iter()
            .all(|quest| ctx.accounts.player_state.weekly_claimed & (1u32 << *quest) != 0)
        && ctx.accounts.player_state.last_crest_week != week
    {
        let previous = ctx.accounts.player_state.last_crest_week;
        ctx.accounts.player_state.crest_streak = if previous.checked_add(1) == Some(week) {
            ctx.accounts.player_state.crest_streak.saturating_add(1)
        } else {
            1
        };
        ctx.accounts.player_state.last_crest_week = week;
    }
    if definition.cadence == 0 {
        emit!(DailyQuestXpClaimed {
            owner,
            quest_index,
            cadence_id: day,
            xp_reward: definition.xp_reward,
        });
    } else {
        emit!(WeeklyQuestXpClaimed {
            owner,
            quest_index,
            cadence_id: week,
            xp_reward: definition.xp_reward,
        });
    }
    Ok(())
}

fn claim_achievement_once(
    flags: &mut u32,
    index: usize,
    progress: u64,
    definition: AchievementDefinition,
) -> Result<()> {
    require!(index < MAX_ACHIEVEMENTS, ErrorCode::InvalidProgressRule);
    let mask = 1u32 << index;
    require!(*flags & mask == 0, ErrorCode::RewardAlreadyClaimed);
    require!(progress >= definition.threshold, ErrorCode::RewardNotEarned);
    *flags |= mask;
    Ok(())
}

fn claim_quest_once(
    claimed: &mut u32,
    index: usize,
    progress: u32,
    definition: QuestDefinition,
    daily_active: &[u8; 3],
    weekly_active: &[u8; 3],
) -> Result<()> {
    let active = if definition.cadence == 0 {
        index == DAILY_FINISHER_INDEX || daily_active.contains(&(index as u8))
    } else {
        weekly_active.contains(&(index as u8))
    };
    require!(active, ErrorCode::QuestNotActive);
    let mask = 1u32 << index;
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
pub struct WeeklyQuestXpClaimed {
    pub owner: Pubkey,
    pub quest_index: u8,
    pub cadence_id: u32,
    pub xp_reward: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::ToAccountMetas;

    #[test]
    fn quest_claim_has_no_payer_or_system_account() {
        let actor = Pubkey::new_unique();
        let metas = crate::accounts::ClaimQuest {
            protocol: Pubkey::new_unique(),
            player_state: Pubkey::new_unique(),
            owner_authority: Pubkey::new_unique(),
            session_token: Some(Pubkey::new_unique()),
            actor,
        }
        .to_account_metas(None);

        assert_eq!(metas.len(), 5);
        assert_eq!(metas[4].pubkey, actor);
        assert_eq!(metas.iter().filter(|meta| meta.is_signer).count(), 1);
    }

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
    fn daily_selection_is_player_stable_distinct_and_eligibility_filtered() {
        let owner = Pubkey::new_unique();
        for day in 0..1_000 {
            let selected = daily_quest_indices(day, owner, false, true);
            assert_eq!(selected, daily_quest_indices(day, owner, false, true));
            assert_eq!(
                selected
                    .iter()
                    .collect::<std::collections::BTreeSet<_>>()
                    .len(),
                3
            );
            assert!(!daily_quest_indices(day, owner, true, false).contains(&5));
            assert!(!daily_quest_indices(day, owner, true, false).contains(&7));
        }
    }

    #[test]
    fn weekly_selection_always_includes_attendance_and_filters_rating() {
        let owner = Pubkey::new_unique();
        let mut observed = std::collections::BTreeSet::new();
        for week in 0..1_000 {
            let selected = weekly_quest_indices(week, owner, false);
            assert_eq!(selected[0], WEEKLY_ATTENDANCE_INDEX);
            assert_ne!(selected[1], selected[2]);
            assert!(WEEKLY_OPTIONAL_POOL.contains(&selected[1]));
            assert!(WEEKLY_OPTIONAL_POOL.contains(&selected[2]));
            observed.extend(selected[1..].iter().copied());
            let perfect = weekly_quest_indices(week, owner, true);
            assert_eq!(perfect[0], WEEKLY_ATTENDANCE_INDEX);
            assert!(!perfect.contains(&11));
        }
        assert_eq!(
            observed,
            WEEKLY_OPTIONAL_POOL.into_iter().collect(),
            "every explicitly frozen optional candidate must be reachable"
        );
    }

    #[test]
    fn canonical_quests_are_xp_only_with_strict_finishers() {
        for index in 0..8 {
            let quest = quest_definition(index).unwrap();
            assert_eq!(quest.cadence, 0);
            assert_eq!(quest.xp_reward, 100);
        }
        assert_eq!(
            quest_definition(DAILY_FINISHER_INDEX).unwrap().xp_reward,
            350
        );
        for index in 9..20 {
            let quest = quest_definition(index).unwrap();
            assert_eq!(quest.cadence, 1);
            assert_eq!(quest.xp_reward, 500);
        }
    }
}
