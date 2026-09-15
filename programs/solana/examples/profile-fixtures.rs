//! Offline cosmetic eligibility oracle. Calls the program's current rules;
//! clients compare their presentation against this output without changing them.
use solana::state::PlayerState;
use std::error::Error;
use std::io::{self, Write};

fn row(id: &str, player: &PlayerState) -> Result<String, Box<dyn Error>> {
    let mut zones = Vec::new();
    for zone_id in 1..=10 {
        let levels: Vec<u8> = (1..=10)
            .map(|level| player.best_stars(zone_id, level))
            .collect::<Result<_, _>>()?;
        zones.push(format!(
            "{{\"zoneId\":{zone_id},\"stars\":{},\"maxStars\":30,\"unlocked\":{},\"cleared\":{},\"perfected\":{},\"levelStars\":{levels:?}}}",
            levels.iter().map(|&stars| u16::from(stars)).sum::<u16>(),
            zkube_core::CampaignStars::from_packed(player.campaign_stars).level_unlocked(zone_id, 1),
            player.zone_cleared(zone_id)?,
            player.zone_perfected(zone_id)?,
        ));
    }
    // Include the whole wire byte space, so unsupported IDs stay rejected.
    let unlocked: Vec<bool> = (0..=u8::MAX).map(|id| player.emblem_unlocked(id)).collect();
    Ok(format!(
        "{{\"id\":\"{id}\",\"packedStars\":{:?},\"totalStars\":{},\"zones\":[{}],\"emblemUnlocked\":{unlocked:?}}}",
        player.campaign_stars, player.total_campaign_stars(), zones.join(",")
    ))
}

fn run() -> Result<(), Box<dyn Error>> {
    let mut cases = Vec::new();
    let mut player = PlayerState::initialize(Default::default(), 0);
    cases.push(row("fresh", &player)?);
    // Every predecessor unlock, guardian clear and perfection transition.
    for stars in [1, 3] {
        for realm in 1..=10 {
            for level in 1..=10 {
                let index = (realm - 1) * 10 + level - 1;
                let mut submitted = [0; zkube_core::CAMPAIGN_STAR_BYTES];
                submitted[index / 4] = stars << ((index % 4) * 2);
                player.merge_campaign_stars(submitted);
                cases.push(row(
                    &format!("stars-{stars}-realm-{realm}-level-{level}"),
                    &player,
                )?);
            }
        }
    }
    // Packed lifetime records can be sparse. Clearing is determined by the
    // guardian cell even when preceding cells or later visibility differ.
    for realm in 1u8..=10 {
        for stars in 1u8..=3 {
            let mut sparse = PlayerState::initialize(Default::default(), 0);
            let index = usize::from(realm) * 10 - 1;
            sparse.campaign_stars[index / 4] = stars << ((index % 4) * 2);
            cases.push(row(
                &format!("sparse-realm-{realm}-stars-{stars}"),
                &sparse,
            )?);
        }
    }
    io::stdout()
        .lock()
        .write_all(format!("{{\"schema\":1,\"cases\":[{}]}}\n", cases.join(",\n")).as_bytes())?;
    Ok(())
}

fn main() -> std::process::ExitCode {
    match run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            let _ = writeln!(
                io::stderr().lock(),
                "profile-fixtures: {error}; inspect fixtures/unity-profile-eligibility-v1.json"
            );
            std::process::ExitCode::FAILURE
        }
    }
}
