use crate::{Sha256Provider, SoftwareSha256};

pub const DAILY_POOL_CAPACITY: usize = 128;
/// Protocol-fixed permutation seed. A catalog publisher can author the pool,
/// but cannot grind this value to choose which entry lands on a given day.
pub const DAILY_POOL_SELECTION_SEED: [u8; 32] = *b"zkube-daily-pool-v01-public-seed";
const DAILY_POOL_DRAW_DOMAIN: &[u8] = b"zkube-daily-pool-draw-v2";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DailyPoolError {
    EmptyPool,
    PoolTooLarge,
    BeforeCatalogStart,
}

/// Resolve one authored pool entry from published catalog data alone.
///
/// Fisher-Yates derives one seed- and cycle-keyed permutation. Consecutive
/// scheduled day identifiers traverse the current cycle, so every entry appears
/// exactly once before the next independently shuffled cycle begins.
///
/// A cycle boundary may repeat the same entry on adjacent days when the prior
/// cycle's last element equals the next cycle's first. This deliberately avoids
/// a rejection loop or cross-cycle state in the on-chain draw.
///
/// # Errors
///
/// Returns an error for an empty or oversized pool, or a day before the
/// catalog's published start.
pub fn daily_pool_entry_index(
    selection_seed: [u8; 32],
    starts_day: u32,
    day_id: u32,
    entry_count: u8,
) -> Result<u8, DailyPoolError> {
    daily_pool_entry_index_with::<SoftwareSha256>(selection_seed, starts_day, day_id, entry_count)
}

/// Chain-adaptable form of [`daily_pool_entry_index`].
///
/// # Errors
///
/// Returns an error for an empty or oversized pool, or a day before the
/// catalog's published start.
pub fn daily_pool_entry_index_with<H: Sha256Provider>(
    selection_seed: [u8; 32],
    starts_day: u32,
    day_id: u32,
    entry_count: u8,
) -> Result<u8, DailyPoolError> {
    let count = usize::from(entry_count);
    if count == 0 {
        return Err(DailyPoolError::EmptyPool);
    }
    if count > DAILY_POOL_CAPACITY {
        return Err(DailyPoolError::PoolTooLarge);
    }
    if day_id < starts_day {
        return Err(DailyPoolError::BeforeCatalogStart);
    }
    let entry_count = u32::from(entry_count);
    let cycle_index = day_id / entry_count;
    let mut permutation: [u8; DAILY_POOL_CAPACITY] =
        core::array::from_fn(|index| u8::try_from(index).unwrap_or(0));
    for index in (1..count).rev() {
        let upper_bound = u64::try_from(index + 1).unwrap_or(1);
        let swap = usize::try_from(
            pool_hash_u64_with::<H>(
                selection_seed,
                cycle_index,
                u8::try_from(index).unwrap_or(0),
            ) % upper_bound,
        )
        .unwrap_or(0);
        permutation.swap(index, swap);
    }
    // The catalog start gates availability but never rotates the permutation.
    // Otherwise a publisher could choose which entry lands on a target day by
    // shifting `starts_day`, even with a protocol-fixed seed.
    Ok(permutation[usize::try_from(day_id % entry_count).unwrap_or(0)])
}

fn pool_hash_u64_with<H: Sha256Provider>(seed: [u8; 32], cycle_index: u32, index: u8) -> u64 {
    let digest = H::hashv(&[
        DAILY_POOL_DRAW_DOMAIN,
        &seed,
        &cycle_index.to_le_bytes(),
        &[index],
    ]);
    u64::from_le_bytes(
        digest[..8]
            .try_into()
            .expect("SHA-256 prefix is eight bytes"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn a_full_pool_cycle_uses_every_entry_before_any_repeat() {
        let seed = [7; 32];
        let starts_day = 20_000;
        let first_cycle = (starts_day..starts_day + 10)
            .map(|day| daily_pool_entry_index(seed, starts_day, day, 10).unwrap())
            .collect::<std::vec::Vec<_>>();
        let mut sorted = first_cycle.clone();
        sorted.sort_unstable();
        assert_eq!(sorted, (0..10u8).collect::<std::vec::Vec<_>>());
        let second_cycle = (starts_day + 10..starts_day + 20)
            .map(|day| daily_pool_entry_index(seed, starts_day, day, 10).unwrap())
            .collect::<std::vec::Vec<_>>();
        let mut second_sorted = second_cycle.clone();
        second_sorted.sort_unstable();
        assert_eq!(second_sorted, (0..10u8).collect::<std::vec::Vec<_>>());
        assert_ne!(second_cycle, first_cycle);
    }

    #[test]
    fn draw_is_reproducible_and_tomorrow_is_resolvable_today() {
        let published_seed = [19; 32];
        let today = 31_415;
        let today_entry = daily_pool_entry_index(published_seed, today, today, 16).unwrap();
        let tomorrow_entry = daily_pool_entry_index(published_seed, today, today + 1, 16).unwrap();
        assert_eq!(
            today_entry,
            daily_pool_entry_index(published_seed, today, today, 16).unwrap()
        );
        assert_eq!(
            tomorrow_entry,
            daily_pool_entry_index(published_seed, today, today + 1, 16).unwrap()
        );
        assert_ne!(today_entry, tomorrow_entry);
    }

    #[test]
    fn catalog_start_cannot_rotate_a_day_selection() {
        let seed = [23; 32];
        let day = 31_415;
        assert_eq!(
            daily_pool_entry_index(seed, day - 20, day, 10),
            daily_pool_entry_index(seed, day, day, 10),
        );
    }

    #[test]
    fn raised_capacity_draws_one_complete_cycle() {
        let count = u8::try_from(DAILY_POOL_CAPACITY).unwrap();
        let starts_day = 128 * 200;
        let mut cycle = (starts_day..starts_day + u32::from(count))
            .map(|day| daily_pool_entry_index([29; 32], starts_day, day, count).unwrap())
            .collect::<std::vec::Vec<_>>();
        cycle.sort_unstable();
        assert_eq!(cycle, (0..count).collect::<std::vec::Vec<_>>());
    }

    #[test]
    fn committed_pool_cycles_match_the_shared_fixture() {
        let fixture: Value =
            serde_json::from_str(include_str!("../../../fixtures/game-parity.json")).unwrap();
        assert_eq!(fixture["schemaVersion"], 4);
        assert_eq!(fixture["phase1Core"]["coreVersion"], crate::CORE_VERSION);
        let pool = &fixture["phase1Core"]["dailyPoolDraw"];
        let starts_day = u32::try_from(pool["startsDay"].as_u64().unwrap()).unwrap();
        let entry_count = u8::try_from(pool["entryCount"].as_u64().unwrap()).unwrap();
        let actual = pool["entryIndicesByDay"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
            .map(|(offset, _)| {
                daily_pool_entry_index(
                    DAILY_POOL_SELECTION_SEED,
                    starts_day,
                    starts_day + u32::try_from(offset).unwrap(),
                    entry_count,
                )
                .unwrap()
            })
            .collect::<std::vec::Vec<_>>();
        let expected = pool["entryIndicesByDay"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| u8::try_from(entry.as_u64().unwrap()).unwrap())
            .collect::<std::vec::Vec<_>>();
        assert_eq!(actual, expected);
    }

    #[test]
    fn protocol_fixture_pins_capacity() {
        let fixture: Value =
            serde_json::from_str(include_str!("../../../fixtures/protocol-invariants.json"))
                .unwrap();
        assert_eq!(
            fixture["dailyPoolCapacity"].as_u64(),
            Some(u64::try_from(DAILY_POOL_CAPACITY).unwrap())
        );
    }

    #[test]
    fn suspended_and_not_yet_started_catalogs_do_not_draw() {
        assert_eq!(
            daily_pool_entry_index([1; 32], 10, 10, 0),
            Err(DailyPoolError::EmptyPool)
        );
        assert_eq!(
            daily_pool_entry_index([1; 32], 10, 9, 1),
            Err(DailyPoolError::BeforeCatalogStart)
        );
    }
}
