use std::path::Path;

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

/// Every guardian frame, drawn whole behind the board rim or dialogue rail;
/// the paws layer is drawn in front of it.
pub const GUARDIAN_FRAMES: [&str; 10] = [
    "idle",
    "blink",
    "talk-mid",
    "talk-open",
    "greeting",
    "satisfied",
    "surprised",
    "celebrate",
    "defeated",
    "portrait",
];

/// What each guardian says, by moment: its first map greeting, the Daily,
/// the guardian level's preview, respect once passed,
/// a win by stars kept, an ended run, its defeat and an Arcade personal best.
pub const GUARDIAN_LINES: [&str; 10] = [
    "greeting",
    "dailyGreeting",
    "trialIntro",
    "respectLine",
    "oneStar",
    "twoStar",
    "threeStar",
    "incomplete",
    "defeatLine",
    "newBestLine",
];

/// A realm's guardian title and lines, each present and spoken.
fn guardian_lines(source: &Value) -> Result<(Value, Value), String> {
    let realm = &source["realmId"];
    let text = |value: &Value, what: &str| {
        value
            .as_str()
            .filter(|line| !line.trim().is_empty())
            .map(|line| json!(line))
            .ok_or_else(|| format!("realm {realm} guardian needs a {what}"))
    };
    let title = text(&source["guardianTitle"], "title")?;
    let lines = source["guardianLines"]
        .as_object()
        .ok_or_else(|| format!("realm {realm} guardian needs its lines"))?;
    let names: std::collections::BTreeSet<&str> = lines.keys().map(String::as_str).collect();
    if names != GUARDIAN_LINES.into_iter().collect() {
        return Err(format!(
            "realm {realm} guardian must say exactly the lines {GUARDIAN_LINES:?}"
        ));
    }
    let mut spoken = serde_json::Map::new();
    for name in GUARDIAN_LINES {
        spoken.insert(name.into(), text(&lines[name], name)?);
    }
    Ok((title, Value::Object(spoken)))
}

#[derive(serde::Deserialize)]
struct GuardianContact {
    canvas_px: [u32; 2],
    frame_names: Vec<String>,
    representation: String,
    paws: String,
    rail_y_px: u32,
    rail_front_y_px: u32,
    /// The only region a frame may differ from idle in: x, y, width, height
    /// from the canvas's top left.
    face_rect_px: [u32; 4],
}

/// Where the guardian's paws rest and where its face changes, as fractions of
/// its square canvas from the top left. The client draws idle and lays only a
/// frame's face over it, so every frame shares idle's body pixels.
fn guardian_contact(root: &Path, id: &str) -> Result<Value, String> {
    let path = root.join(format!("assets/{id}/boss/contact.json"));
    let text = std::fs::read_to_string(&path)
        .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    let contact: GuardianContact = serde_json::from_str(&text)
        .map_err(|error| format!("invalid {}: {error}", path.display()))?;
    let [width, height] = contact.canvas_px;
    if width != height
        || contact.representation != "full-frame-behind-rail"
        || contact.paws != "paws.png"
        || contact.frame_names != GUARDIAN_FRAMES
        || !(0 < contact.rail_y_px
            && contact.rail_y_px <= contact.rail_front_y_px
            && contact.rail_front_y_px < height)
    {
        return Err(format!(
            "{} must describe full frames {GUARDIAN_FRAMES:?} over a square canvas, with paws.png and a rail inside it",
            path.display()
        ));
    }
    let [x, y, face_width, face_height] = contact.face_rect_px;
    if face_width == 0 || face_height == 0 || x + face_width > width || y + face_height > height {
        return Err(format!(
            "{} must place face_rect_px inside its canvas",
            path.display()
        ));
    }
    let fraction = |y: u32| f64::from(y) / f64::from(height);
    Ok(json!({"railY": fraction(contact.rail_y_px), "railFrontY": fraction(contact.rail_front_y_px),
        "face": [fraction(x), fraction(y), fraction(face_width), fraction(face_height)]}))
}

fn theme(source: &Value, root: &Path) -> Result<Value, String> {
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
    images.insert(
        "background".into(),
        json!(format!("/assets/{id}/background.png")),
    );
    for frame in GUARDIAN_FRAMES.iter().chain(&["paws"]) {
        images.insert(
            format!("guardian-{frame}"),
            json!(format!("/assets/{id}/boss/{frame}.png")),
        );
    }
    // The realm's level track, and the guardian's for its own level.
    let music: serde_json::Map<String, Value> = ["level", "boss"]
        .into_iter()
        .map(|kind| {
            (
                kind.into(),
                json!(format!("/assets/{id}/sounds/musics/{kind}.mp3")),
            )
        })
        .collect();
    let guardian = guardian_contact(root, &id)?;
    let (title, lines) = guardian_lines(source)?;
    Ok(json!({
        "id": id, "realmId": realm, "realmName": source["realmName"],
        "guardianName": source["guardianName"], "guardianTitle": title, "guardianLines": lines,
        "guardianPortrait": format!("/assets/{id}/boss/portrait.png"), "guardian": guardian,
        "campaignPath": source["campaignPath"], "rgba": swatches, "images": images, "music": music,
        "map": {
            "pathStyle": source["pathStyle"], "lockedDash": source["lockedDash"],
            "strokeWidth": source["strokeWidth"], "lockedStrokeWidth": source["lockedStrokeWidth"],
            "clearedRgba": rgba(accent), "activeRgba": rgba(color("accent2")),
            "lockedRgba": rgba(&mix(bg, 0, 45)),
        },
    }))
}

fn guardian([bonus, trigger, threshold, _]: [u16; 4]) -> Value {
    let name = format!(
        "{:?}",
        zkube_core::Bonus::from_tag(u8::try_from(bonus).unwrap()).unwrap()
    );
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
    // What the bonus does, in the words shown beside its rule. A bonus removes
    // blocks without scoring; only the lines the drop completes score.
    let effect = match name.as_str() {
        "Hammer" => "The Hammer breaks the block you pick.",
        "Totem" => "The Totem removes every block the size of the one you pick.",
        "Wave" => "The Wave clears the row you pick.",
        _ => unreachable!("validated bonus"),
    };
    // The Earn panel draws the trigger as a goal pictogram with its chip.
    let bonus_kind = zkube_core::Bonus::from_tag(u8::try_from(bonus).unwrap()).unwrap();
    let goal = super::pictograms::trigger_goal(u8::try_from(trigger).unwrap(), threshold)
        .expect("validated guardian");
    let pictogram = super::pictograms::pictogram(goal.kind, goal.value, bonus_kind);
    let chip = super::pictograms::chip(goal.kind, goal.value, goal.required_count);
    json!({"bonus": bonus, "trigger": trigger, "threshold": threshold, "name": name,
        "pictogram": pictogram, "chip": chip,
        "description": description, "sentence": format!("{condition} a {name}."),
        "effect": format!("{effect} What it removes scores nothing.")})
}

// A Daily objective's words come from the one caption owner.
fn objective(theme: &zkube_core::DailyTheme) -> Value {
    json!({"kind": theme.kind.tag(), "value": theme.value,
        "description": super::captions::caption(theme.kind, theme.value, 0)})
}

/// Every sound the board plays: its cue, as presentation code names it, and
/// its clip under assets/common/sounds/effects. The clips are imported and the
/// C# names emitted from this one list, so a played cue cannot lack its clip.
/// The small win is the old client's level-up sting until its own is authored.
pub const SOUND_CUES: [(&str, &str); 8] = [
    ("Move", "swipe"),
    ("LineBreak", "explode"),
    ("Bonus", "bonus-activate"),
    ("Star", "star"),
    ("Loss", "over"),
    ("SmallWin", "levelup"),
    ("BigWin", "victory"),
    ("BossIntro", "boss-intro"),
];

pub fn render(catalog: &CampaignCatalog, source: &str, root: &Path) -> Result<String, String> {
    let authored: Value = serde_json::from_str(source).map_err(|error| error.to_string())?;
    let realms = authored["realms"]
        .as_array()
        .ok_or("Missing authored realms")?;
    if realms.len() != catalog.maps.len() {
        return Err("Art realm count disagrees with catalog".into());
    }
    let effects: serde_json::Map<String, Value> =
        SOUND_CUES
            .into_iter()
            .map(|(_, name)| {
                (
                    name.into(),
                    json!(format!("/assets/common/sounds/effects/{name}.mp3")),
                )
            })
            .collect();
    let output = json!({
        "schema": 1,
        "themes": realms.iter().map(|realm| theme(realm, root)).collect::<Result<Vec<_>, _>>()?,
        "constraintCaptions": super::captions::render(catalog)?,
        "guardianRules": catalog.maps.iter().map(|map| guardian(map.rules)).collect::<Vec<_>>(),
        "dailyThemes": zkube_core::DAILY_THEMES.iter().map(|theme|
            objective(theme)).collect::<Vec<_>>(),
        "effects": effects,
        // The product wordmarks; each identity's pages draw their own.
        "commonImages": {
            "mark": "/assets/common/mark.png",
            "wordmark-realms": "/assets/common/brand/realms.png",
            "wordmark-arena": "/assets/common/brand/arena.png",
        },
        "skins": super::skins::render(root, &authored, realms.len())?,
    });
    serde_json::to_string_pretty(&output)
        .map(|value| value + "\n")
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_guardian_says_every_line_and_none_is_empty() {
        let authored: Value =
            serde_json::from_str(include_str!("../../../assets/catalog.json")).unwrap();
        for realm in authored["realms"].as_array().unwrap() {
            let (title, lines) = guardian_lines(realm).unwrap();
            assert!(!title.as_str().unwrap().is_empty());
            assert_eq!(lines.as_object().unwrap().len(), GUARDIAN_LINES.len());
        }
        let mut realm = authored["realms"][0].clone();
        realm["guardianLines"]["oneStar"] = json!("  ");
        assert!(guardian_lines(&realm).unwrap_err().contains("oneStar"));
        realm["guardianLines"]
            .as_object_mut()
            .unwrap()
            .remove("oneStar");
        assert!(
            guardian_lines(&realm)
                .unwrap_err()
                .contains("exactly the lines")
        );
        realm["guardianLines"]["oneStar"] = json!("Back.");
        realm["guardianLines"]["taunt"] = json!("Extra.");
        assert!(
            guardian_lines(&realm)
                .unwrap_err()
                .contains("exactly the lines")
        );
        realm["guardianTitle"] = json!("");
        assert!(guardian_lines(&realm).unwrap_err().contains("title"));
    }

    #[test]
    fn every_daily_objective_uses_its_constraint_caption() {
        let catalog: Value =
            serde_json::from_str(include_str!("../../../assets/theme-catalog.generated.json"))
                .unwrap();
        let themes = catalog["dailyThemes"].as_array().unwrap();
        assert_eq!(themes.len(), zkube_core::DAILY_THEMES.len());
        for theme in themes {
            let caption = catalog["constraintCaptions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|entry| {
                    entry["kind"] == theme["kind"]
                        && entry["value"] == theme["value"]
                        && entry["count"] == 0
                })
                .unwrap();
            assert_eq!(theme["description"], caption["text"], "{theme}");
        }
    }

    #[test]
    fn guardian_contact_names_every_frame_and_a_rail_inside_its_canvas() {
        let root = std::env::temp_dir().join(format!("zkube-guardian-{}", std::process::id()));
        let dir = root.join("assets/theme-1/boss");
        std::fs::create_dir_all(&dir).unwrap();
        let write =
            |contact: Value| std::fs::write(dir.join("contact.json"), contact.to_string()).unwrap();
        let good = json!({"canvas_px": [1536, 1536], "frame_names": GUARDIAN_FRAMES,
            "representation": "full-frame-behind-rail", "paws": "paws.png",
            "rail_y_px": 1280, "rail_front_y_px": 1330, "hud_width_dp": 168,
            "face_rect_px": [384, 192, 768, 576]});
        write(good.clone());
        let contact = guardian_contact(&root, "theme-1").unwrap();
        assert_eq!(contact["railY"], json!(1280.0 / 1536.0));
        assert_eq!(contact["railFrontY"], json!(1330.0 / 1536.0));
        assert_eq!(contact["face"], json!([0.25, 0.125, 0.5, 0.375]));
        for (field, value) in [
            ("frame_names", json!(["idle"])),
            ("canvas_px", json!([1536, 1024])),
            ("rail_y_px", json!(1536)),
            ("representation", json!("head-layers")),
            ("face_rect_px", json!([1000, 192, 768, 576])),
            ("face_rect_px", json!([384, 192, 0, 576])),
        ] {
            let mut bad = good.clone();
            bad[field] = value;
            write(bad);
            assert!(guardian_contact(&root, "theme-1").is_err(), "{field}");
        }
        let _ = std::fs::remove_dir_all(root);
    }
}
