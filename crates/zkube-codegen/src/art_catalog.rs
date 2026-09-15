use serde_json::{Value, json};

use super::CampaignCatalog;

fn channels(hex: &str) -> [u32; 3] {
    [1, 3, 5].map(|offset| {
        u32::from_str_radix(&hex[offset..offset + 2], 16).expect("authored hex color")
    })
}

fn mix(hex: &str, target: u32, percent: u32) -> String {
    let [r, g, b] = channels(hex).map(|v| (v * (100 - percent) + target * percent + 50) / 100);
    format!("#{r:02x}{g:02x}{b:02x}")
}

fn rgba(hex: &str) -> Value {
    let [r, g, b] = channels(hex).map(|v| f64::from(v) / 255.0);
    json!([r, g, b, 1])
}

fn theme(source: &Value) -> Value {
    let realm = source["realmId"].as_u64().expect("realm id");
    let id = format!("theme-{realm}");
    let color = |key: &str| source[key].as_str().expect("authored color");
    let bg = color("background");
    let accent = color("accent");
    let mut swatches = vec![];
    for (name, value) in [
        ("background", bg.to_owned()),
        ("backgroundGradientStart", mix(bg, 255, 6)),
        ("backgroundGradientEnd", mix(bg, 0, 12)),
        ("gridLines", mix(accent, 0, 25)),
        ("gridBg", mix(bg, 255, 4)),
        ("gridCellAlt", mix(bg, 255, 7)),
        ("frameBorder", accent.to_owned()),
        ("hudBar", mix(bg, 0, 20)),
        ("hudBarBorder", mix(accent, 0, 35)),
        ("actionBarBg", mix(bg, 0, 20)),
        ("dangerZone", "#ff4444".to_owned()),
        ("accent", accent.to_owned()),
        ("accent2", color("accent2").to_owned()),
        ("text", "#ffffff".to_owned()),
    ] {
        swatches.push(json!({"name": name, "value": rgba(&value)}));
    }
    for (name, alpha) in [("textMuted", 0.5), ("surface", 0.04), ("border", 0.08)] {
        swatches.push(json!({"name": name, "value": [1, 1, 1, alpha]}));
    }
    let mut images = serde_json::Map::new();
    for (name, file) in [
        ("block1", "block-1"),
        ("block2", "block-2"),
        ("block3", "block-3"),
        ("block4", "block-4"),
        ("loadingBg", "loading-bg"),
        ("background", "background"),
        ("mapBg", "map-bg"),
        ("mapNodeLevel", "map-node-level"),
        ("mapNodeBoss", "map-node-boss"),
        ("mapNodeCompleted", "map-node-completed"),
    ] {
        images.insert(name.into(), json!(format!("/assets/{id}/{file}.png")));
    }
    let music: serde_json::Map<String, Value> = ["main", "level", "boss"]
        .into_iter()
        .map(|kind| {
            (
                kind.into(),
                json!(format!("/assets/{id}/sounds/musics/{kind}.mp3")),
            )
        })
        .collect();
    json!({
        "id": id, "realmId": realm, "realmName": source["realmName"],
        "guardianName": source["guardianName"], "guardianGreeting": source["guardianGreeting"],
        "guardianPortrait": format!("/assets/{id}/boss/idle.png"),
        "campaignPath": source["campaignPath"], "rgba": swatches, "images": images, "music": music,
        "map": {
            "pathStyle": source["pathStyle"], "lockedDash": source["lockedDash"],
            "strokeWidth": source["strokeWidth"], "lockedStrokeWidth": source["lockedStrokeWidth"],
            "clearedRgba": rgba(accent), "activeRgba": rgba(color("accent2")),
            "lockedRgba": rgba(&mix(bg, 0, 45)),
        },
    })
}

fn guardian([bonus, trigger, threshold, _]: [u16; 4]) -> Value {
    let name = match bonus {
        1 => "Hammer",
        2 => "Totem",
        3 => "Wave",
        _ => unreachable!(),
    };
    let (description, condition) = match trigger {
        1 => (
            format!("Clear {threshold}+ lines in a move"),
            format!("Clear {threshold} or more lines in one move to earn"),
        ),
        2 => (
            format!("Every {threshold} lines cleared by moves"),
            format!("Every {threshold} lines cleared by moves earns"),
        ),
        4 => (
            format!("Clear exactly {threshold} lines in a move"),
            format!("Clear exactly {threshold} lines in one move to earn"),
        ),
        6 => (
            "Break every size in one move".into(),
            "Break every block size in one move to earn".into(),
        ),
        7 => (
            format!("Every {threshold} combos"),
            format!("Every {threshold} combos earns"),
        ),
        8 => (
            format!("Break {threshold}+ blocks in one move"),
            format!("Break {threshold} or more blocks in one move to earn"),
        ),
        9 => (
            format!("Clear a line {threshold} moves in a row"),
            format!("Clear lines on {threshold} moves in a row to earn"),
        ),
        _ => unreachable!("validated guardian"),
    };
    json!({"bonus": bonus, "trigger": trigger, "threshold": threshold,
        "description": description, "sentence": format!("{condition} a {name}.")})
}

fn objective(kind: u8, value: u8) -> Value {
    let (name, description) = match kind {
        0 => (
            "Classic Score".into(),
            "No Theme today — the whole pot pays Score".into(),
        ),
        1 => (
            format!("Combo {value}+"),
            format!("{value}+-line combo moves"),
        ),
        2 => (
            format!("Break Width {value}"),
            format!("width-{value} blocks broken"),
        ),
        4 => (
            format!("Exact {value}"),
            format!("exact {value}-line clears"),
        ),
        6 => ("Guardian Triggers".into(), "the realm trigger fired".into()),
        7 => ("Bonus Lines".into(), "lines cleared with a bonus".into()),
        8 => ("Bonus Breaks".into(), "blocks broken with a bonus".into()),
        17 => (
            format!("Clutch Clears {value}+"),
            format!("clears started at height {value}+"),
        ),
        18 => (
            format!("Clean Clears {value}"),
            format!("clears ending at height {value} or lower"),
        ),
        _ => unreachable!("protocol objective"),
    };
    json!({"kind": kind, "value": value, "name": name, "description": description})
}

pub fn render(catalog: &CampaignCatalog, source: &str) -> Result<String, String> {
    let authored: Value = serde_json::from_str(source).map_err(|error| error.to_string())?;
    let realms = authored["realms"]
        .as_array()
        .ok_or("Missing authored realms")?;
    if realms.len() != catalog.maps.len() {
        return Err("Art realm count disagrees with catalog".into());
    }
    let effects: serde_json::Map<String, Value> = [
        "swipe",
        "explode",
        "over",
        "levelup",
        "victory",
        "boss-intro",
        "boss-defeat",
        "coin",
        "star",
        "bonus-activate",
    ]
    .into_iter()
    .map(|name| {
        (
            name.into(),
            json!(format!("/assets/common/sounds/effects/{name}.mp3")),
        )
    })
    .collect();
    let output = json!({
        "schema": 1,
        "themes": realms.iter().map(theme).collect::<Vec<_>>(),
        "guardianRules": catalog.maps.iter().map(|map| guardian(map.rules)).collect::<Vec<_>>(),
        "dailyThemes": zkube_core::DAILY_THEMES.iter().map(|theme|
            objective(theme.kind.tag(), theme.value)).collect::<Vec<_>>(),
        "effects": effects,
    });
    serde_json::to_string_pretty(&output)
        .map(|value| value + "\n")
        .map_err(|error| error.to_string())
}
