use anchor_lang::prelude::*;
use session_keys::SessionTokenV2;

use crate::error::ErrorCode;
use crate::instructions::player_authorization::{
    require_player_authorization, require_player_rent_payer,
};
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

const QUEST_THRESHOLDS: [u32; MAX_QUESTS] = [20, 3, 1, 2, 1, 2, 1, 10, 5, 3, 150, 3];
const DAILY_QUEST_POOL_SIZE: usize = 9;
const DAILY_QUEST_SELECTION_SIZE: usize = DAILY_ACTIVE_QUESTS;
const DAILY_QUEST_MIX_SEED: u32 = 0x9e37_79b9;
const BLOCK_QUEST_VARIANT_SEED: u32 = 0xb10c_5eed;
const BLOCK_QUEST_VARIANTS: [(u8, u32); 8] = [
    (1, 6),
    (2, 8),
    (3, 6),
    (4, 5),
    (1, 8),
    (2, 10),
    (3, 8),
    (4, 6),
];
const COMBO_QUESTS: [u8; 4] = [2, 3, 6, 8];

#[derive(Clone, Copy)]
struct QuestDefinition {
    metric: u8,
    cadence: u8,
    threshold: u32,
    xp_reward: u32,
    star_reward: u64,
}

fn quest_definition(index: usize, day: u32) -> Result<QuestDefinition> {
    require!(index < MAX_QUESTS, ErrorCode::InvalidProgressRule);
    let (cadence, xp_reward, star_reward) = match index {
        0..=8 => (0, 100, 0),
        DAILY_FINISHER_INDEX => (0, 200, 2),
        10..=11 => (1, 500, 5),
        _ => return err!(ErrorCode::InvalidProgressRule),
    };
    let (metric, threshold) = if index == 7 {
        let (block_size, target) = block_quest_variant(day);
        (
            BLOCK_QUEST_COUNTERS[usize::from(block_size - 1)] as u8,
            target,
        )
    } else {
        (index as u8, QUEST_THRESHOLDS[index])
    };
    Ok(QuestDefinition {
        metric,
        cadence,
        threshold,
        xp_reward,
        star_reward,
    })
}

fn seeded_xorshift(seed: u32) -> u32 {
    let mut state = if seed == 0 { 0x6d2b_79f5 } else { seed };
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    state
}

pub(crate) fn block_quest_variant(day: u32) -> (u8, u32) {
    let mixed = seeded_xorshift(day ^ BLOCK_QUEST_VARIANT_SEED);
    BLOCK_QUEST_VARIANTS[mixed as usize % BLOCK_QUEST_VARIANTS.len()]
}

pub(crate) fn daily_quest_indices(day: u32) -> [u8; DAILY_QUEST_SELECTION_SIZE] {
    // Compact deterministic v1 Fisher-Yates schedule; the client mirrors these
    // exact u32 xorshift operations and shared parity vectors pin the result.
    let mut shuffled = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    let mut state = day ^ DAILY_QUEST_MIX_SEED;
    for upper in (1..DAILY_QUEST_POOL_SIZE).rev() {
        state = seeded_xorshift(state);
        let selected = state as usize % (upper + 1);
        shuffled.swap(upper, selected);
    }

    let mut selected = [0u8; DAILY_QUEST_SELECTION_SIZE];
    let mut selected_count = 0usize;
    let mut combo_count = 0usize;
    for index in shuffled {
        let is_combo = COMBO_QUESTS.contains(&index);
        if is_combo && combo_count == 2 {
            continue;
        }
        selected[selected_count] = index;
        selected_count += 1;
        combo_count += usize::from(is_combo);
        if selected_count == DAILY_QUEST_SELECTION_SIZE {
            break;
        }
    }
    selected
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
        .credit_progression_rewards(0, definition.xp)?;
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
        init_if_needed,
        payer = payer,
        space = 8 + QuestClaims::INIT_SPACE,
        seeds = [QUEST_CLAIMS_SEED, owner_authority.key().as_ref()],
        bump
    )]
    pub quest_claims: Box<Account<'info, QuestClaims>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + WeeklyStipend::INIT_SPACE,
        seeds = [WEEKLY_STIPEND_SEED, owner_authority.key().as_ref()],
        bump
    )]
    pub weekly_stipend: Box<Account<'info, WeeklyStipend>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Immutable durable player identity, constrained above.
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_claim_quest(ctx: Context<ClaimQuest>, quest_index: u8) -> Result<()> {
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
    let index = usize::from(quest_index);
    let now = Clock::get()?.unix_timestamp;
    let day = cadence_day(now);
    let week = cadence_week(now);
    let definition = quest_definition(index, day)?;
    ctx.accounts.player_profile.roll_quest_cadences(now);

    let claims = &mut ctx.accounts.quest_claims;
    if claims.version == 0 {
        claims.version = ACCOUNT_VERSION;
        claims.owner = ctx.accounts.owner_authority.key();
        claims.daily_cadence_id = day;
        claims.weekly_cadence_id = week;
        claims.daily_claimed = 0;
        claims.weekly_claimed = 0;
        claims.bump = ctx.bumps.quest_claims;
    } else {
        require_keys_eq!(
            claims.owner,
            ctx.accounts.owner_authority.key(),
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

    if definition.cadence == 0 && index < DAILY_QUEST_POOL_SIZE {
        ctx.accounts.player_profile.quest_counters[9] = ctx.accounts.player_profile.quest_counters
            [9]
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    }

    let owner = ctx.accounts.owner_authority.key();
    initialize_or_roll_stipend(
        &mut ctx.accounts.weekly_stipend,
        owner,
        week,
        ctx.bumps.weekly_stipend,
    )?;
    ctx.accounts
        .player_profile
        .credit_progression_rewards(definition.star_reward, definition.xp_reward)?;
    if definition.xp_reward > 0 {
        ctx.accounts
            .weekly_stipend
            .record_recurring_xp(week, definition.xp_reward)?;
        emit_stipend_if_awarded(
            &mut ctx.accounts.weekly_stipend,
            &mut ctx.accounts.player_profile,
        )?;
    }
    if definition.cadence == 0 {
        emit!(DailyQuestXpClaimed {
            owner,
            quest_index,
            cadence_id: day,
            xp_reward: definition.xp_reward,
            stars: definition.star_reward,
        });
    } else {
        emit!(WeeklyQuestStarsClaimed {
            owner,
            quest_index,
            cadence_id: week,
            xp_reward: definition.xp_reward,
            stars: definition.star_reward,
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
    if definition.cadence == 0 && index < DAILY_QUEST_POOL_SIZE {
        require!(
            daily_quest_indices(day).contains(&(index as u8)),
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
    pub stars: u64,
}

#[event]
pub struct WeeklyQuestStarsClaimed {
    pub owner: Pubkey,
    pub quest_index: u8,
    pub cadence_id: u32,
    pub xp_reward: u32,
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
    fn daily_selection_is_deterministic_distinct_and_combo_bounded() {
        let parity_vectors = [
            (0, [0, 8, 4]),
            (1, [6, 2, 1]),
            (2, [2, 6, 5]),
            (3, [3, 1, 7]),
            (10, [6, 3, 0]),
            (100, [5, 7, 3]),
            (20_000, [1, 5, 0]),
        ];
        for (day, expected) in parity_vectors {
            assert_eq!(daily_quest_indices(day), expected);
        }
        for day in 0..1_000 {
            let selected = daily_quest_indices(day);
            assert_eq!(selected, daily_quest_indices(day));
            assert_eq!(
                selected
                    .iter()
                    .collect::<std::collections::BTreeSet<_>>()
                    .len(),
                3
            );
            assert!(
                selected
                    .iter()
                    .filter(|index| COMBO_QUESTS.contains(index))
                    .count()
                    <= 2
            );
        }
    }

    #[test]
    fn block_quest_variants_are_deterministic_and_cover_every_size() {
        let parity_vectors = [
            (0, (2, 10)),
            (1, (1, 8)),
            (2, (4, 6)),
            (3, (3, 8)),
            (10, (4, 6)),
            (100, (4, 6)),
            (20_000, (4, 6)),
        ];
        for (day, expected) in parity_vectors {
            assert_eq!(block_quest_variant(day), expected);
        }

        let mut seen_sizes = [false; 4];
        for day in 0..1_000 {
            let (block_size, target) = block_quest_variant(day);
            seen_sizes[usize::from(block_size - 1)] = true;
            assert!((5..=10).contains(&target));
            let definition = quest_definition(7, day).unwrap();
            assert_eq!(
                definition.metric,
                BLOCK_QUEST_COUNTERS[usize::from(block_size - 1)] as u8
            );
            assert_eq!(definition.threshold, target);
        }
        assert!(seen_sizes.into_iter().all(|seen| seen));
    }

    #[test]
    fn canonical_quests_keep_dual_daily_and_weekly_rewards() {
        for index in 0..9 {
            let quest = quest_definition(index, 0).unwrap();
            assert_eq!(quest.cadence, 0);
            assert_eq!(quest.xp_reward, 100);
            assert_eq!(quest.star_reward, 0);
        }
        assert_eq!(quest_definition(9, 0).unwrap().xp_reward, 200);
        assert_eq!(quest_definition(9, 0).unwrap().star_reward, 2);
        for index in 10..12 {
            let quest = quest_definition(index, 0).unwrap();
            assert_eq!(quest.cadence, 1);
            assert_eq!(quest.xp_reward, 500);
            assert_eq!(quest.star_reward, 5);
        }
    }
}
