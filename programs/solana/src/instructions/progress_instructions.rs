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
    reserved_achievement(),
    reserved_achievement(),
    reserved_achievement(),
    reserved_achievement(),
    reserved_achievement(),
    reserved_achievement(),
    reserved_achievement(),
    reserved_achievement(),
    achievement(6, 1, 100),
    achievement(6, 7, 400),
    achievement(6, 30, 1_500),
    achievement(6, 100, 4_000),
];

// Keep the 24-bit achievement account ABI stable, but leave the former
// Campaign-derived slots permanently ungrantable. Campaign progress is local
// and must never cross into the on-chain Arcade profile economy.
const ARCADE_ACHIEVEMENT_INDICES: [usize; 16] =
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 20, 21, 22, 23];

const fn achievement(metric: u8, threshold: u64, xp: u32) -> AchievementDefinition {
    AchievementDefinition {
        metric,
        threshold,
        xp,
    }
}

const fn reserved_achievement() -> AchievementDefinition {
    AchievementDefinition {
        metric: u8::MAX,
        threshold: u64::MAX,
        xp: 0,
    }
}

const QUEST_THRESHOLDS: [u32; MAX_QUESTS] = [
    1, 40, 3, 1, 1, 1, 1, 1, 3, // Daily pool + finisher.
    5, 300, 3, 25, 15, 3, 1, 6, 2, 2, 2,
];
const WEEKLY_ATTENDANCE_INDEX: u8 = 9;
// Campaign/rating/boss counters (5, 11, and 17) are deliberately absent.
// Free Campaign progression must never feed Arcade quests or XP.
const WEEKLY_OPTIONAL_POOL: [u8; 8] = [10, 12, 13, 14, 15, 16, 18, 19];
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
        if index == 5 || (index == 7 && !entered_yesterday) {
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

pub(crate) fn weekly_quest_indices(week: u32, owner: Pubkey) -> [u8; 3] {
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
        result[count] = index;
        count += 1;
        if count == result.len() {
            break;
        }
    }
    result
}

/// Applies every eligible Arcade achievement and cadence quest during the
/// terminal consume instruction. There is deliberately no claim instruction:
/// profile rewards are automatic, free, and unable to block money settlement.
pub(crate) fn apply_automatic_arcade_progress(player: &mut PlayerState, now: i64) {
    let day = cadence_day(now);
    let week = cadence_week(now);
    player.roll_quest_cadences(now);
    player.roll_completions(day, week);

    for index in ARCADE_ACHIEVEMENT_INDICES {
        let definition = ACHIEVEMENTS[index];
        let mask = 1u32 << index;
        let earned = player
            .achievement_metric(definition.metric)
            .is_some_and(|progress| progress >= definition.threshold);
        if earned && player.achievement_flags & mask == 0 {
            player.achievement_flags |= mask;
            player.lifetime_xp = player.lifetime_xp.saturating_add(u64::from(definition.xp));
        }
    }

    let daily_active = daily_quest_indices(
        day,
        player.owner,
        player.last_daily_challenge_day.checked_add(1) == Some(day),
    );
    let weekly_active = weekly_quest_indices(week, player.owner);

    for index in daily_active {
        auto_complete_quest(player, usize::from(index));
    }
    if daily_active
        .iter()
        .all(|quest| player.daily_completed & (1u32 << *quest) != 0)
        && auto_complete_quest(player, DAILY_FINISHER_INDEX)
    {
        player.quest_counters[14] = player.quest_counters[14].saturating_add(1);
    }
    for index in weekly_active {
        auto_complete_quest(player, usize::from(index));
    }
    if weekly_active
        .iter()
        .all(|quest| player.weekly_completed & (1u32 << *quest) != 0)
        && player.last_crest_week != week
    {
        player.crest_streak = if player.last_crest_week.checked_add(1) == Some(week) {
            player.crest_streak.saturating_add(1)
        } else {
            1
        };
        player.last_crest_week = week;
    }
}

fn auto_complete_quest(player: &mut PlayerState, index: usize) -> bool {
    let Ok(definition) = quest_definition(index) else {
        return false;
    };
    let progress = if index == DAILY_FINISHER_INDEX {
        u32::from(
            daily_quest_indices(
                player.daily_completion_cadence_id,
                player.owner,
                player.last_daily_challenge_day.checked_add(1)
                    == Some(player.daily_completion_cadence_id),
            )
            .iter()
            .filter(|quest| player.daily_completed & (1u32 << **quest) != 0)
            .count() as u8,
        )
    } else if index == 15 {
        let packed = player.quest_counters[15];
        u32::from(packed & (1 << 31) != 0 || packed & !(1 << 31) >= 5)
    } else {
        player.quest_counters[usize::from(definition.metric)]
    };
    if progress < definition.threshold {
        return false;
    }
    let completed = if definition.cadence == 0 {
        &mut player.daily_completed
    } else {
        &mut player.weekly_completed
    };
    let mask = 1u32 << index;
    if *completed & mask != 0 {
        return false;
    }
    *completed |= mask;
    player.lifetime_xp = player
        .lifetime_xp
        .saturating_add(u64::from(definition.xp_reward));
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_arcade_achievements_total_24_000_xp_and_reserve_campaign_slots() {
        assert_eq!(
            ACHIEVEMENTS
                .iter()
                .map(|definition| u64::from(definition.xp))
                .sum::<u64>(),
            24_000
        );
        assert!(ACHIEVEMENTS[12..20]
            .iter()
            .all(|definition| definition.metric == u8::MAX && definition.xp == 0));
        assert!(ARCADE_ACHIEVEMENT_INDICES
            .iter()
            .all(|index| !((12..20).contains(index))));
    }

    #[test]
    fn daily_selection_is_player_stable_distinct_and_eligibility_filtered() {
        let owner = Pubkey::new_unique();
        for day in 0..1_000 {
            let selected = daily_quest_indices(day, owner, true);
            assert_eq!(selected, daily_quest_indices(day, owner, true));
            assert_eq!(
                selected
                    .iter()
                    .collect::<std::collections::BTreeSet<_>>()
                    .len(),
                3
            );
            assert!(!daily_quest_indices(day, owner, false).contains(&5));
            assert!(!daily_quest_indices(day, owner, false).contains(&7));
        }
    }

    #[test]
    fn weekly_selection_always_includes_attendance_and_filters_rating() {
        let owner = Pubkey::new_unique();
        let mut observed = std::collections::BTreeSet::new();
        for week in 0..1_000 {
            let selected = weekly_quest_indices(week, owner);
            assert_eq!(selected[0], WEEKLY_ATTENDANCE_INDEX);
            assert_ne!(selected[1], selected[2]);
            assert!(WEEKLY_OPTIONAL_POOL.contains(&selected[1]));
            assert!(WEEKLY_OPTIONAL_POOL.contains(&selected[2]));
            observed.extend(selected[1..].iter().copied());
            assert!(!selected.contains(&11));
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

    #[test]
    fn arcade_progress_is_automatic_idempotent_and_saturating() {
        let now = 1_700_000_000;
        let mut player = PlayerState::initialize(Pubkey::new_unique(), 1);
        player.roll_quest_cadences(now);
        player.roll_completions(cadence_day(now), cadence_week(now));
        player.lifetime_runs_started = 20;
        player.lifetime_xp = u64::MAX;
        player.quest_counters.fill(u32::MAX);

        apply_automatic_arcade_progress(&mut player, now);
        let flags = player.achievement_flags;
        let daily = player.daily_completed;
        let weekly = player.weekly_completed;
        let finishers = player.quest_counters[14];
        assert_ne!(flags, 0);
        assert_ne!(daily, 0);
        assert_ne!(weekly, 0);
        assert_eq!(player.lifetime_xp, u64::MAX);

        apply_automatic_arcade_progress(&mut player, now);
        assert_eq!(player.achievement_flags, flags);
        assert_eq!(player.daily_completed, daily);
        assert_eq!(player.weekly_completed, weekly);
        assert_eq!(player.quest_counters[14], finishers);
        assert_eq!(player.lifetime_xp, u64::MAX);
    }
}
