//! The rules hash this checkout's program stores when it prepares a day's
//! Daily: the day's realm from the table, its drawn objective and the
//! catalogue version. `prepare_makes_only_todays_daily_once_and_a_repeat_is_a_checked_no_op`
//! holds it to what the built program really stores.

pub fn prepared(day_id: u32) -> [u8; 32] {
    let (realm, objective) = zkube_core::daily_pair(day_id);
    let rules = zkube_core::REALM_RULES[usize::from(realm - 1)];
    zkube_core::daily_rules_hash(day_id, rules.guardian, rules.starting_height, objective).0
}
