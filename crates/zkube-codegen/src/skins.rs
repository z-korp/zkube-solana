//! Skin contract: every skin supplies every slot for the UI and for each realm,
//! so a skin can never ship with a missing piece. Art lives in
//! `assets/skins/<id>/{skin.json, ui/<slot>.png, realm-<n>/{<slot>.png, tokens.json}}`.

use std::{collections::BTreeSet, fmt::Write as _, fs, path::Path};

use serde::Deserialize;
use serde_json::{Map, Value, json};

/// UI pieces drawn stretched; each declares its stretch border in skin.json.
pub const UI_STRETCH_SLOTS: [&str; 31] = [
    "panel",
    "plate",
    "dialog",
    "button-primary",
    "button-primary-pressed",
    "button-secondary",
    "button-secondary-pressed",
    "button-icon",
    "button-icon-pressed",
    "tab-bar",
    "tab-selected",
    "title-ribbon",
    "board-frame",
    "grid-well",
    "preview-tray",
    "slider-track",
    "slider-fill",
    "list-row",
    "toggle-track",
    // A cumulative goal's fill bar: the track, its fill and the fill once met.
    "counter-track",
    "counter-fill",
    "counter-fill-done",
    // The board HUD: the opaque goal plate, the moves tablet calm, warm and
    // ember, the Earn panel, a goal's tap bubble and a pictogram's value chip.
    "goal-plate",
    "moves-calm",
    "moves-warm",
    "moves-ember",
    "earn-panel",
    "tap-bubble",
    "chip",
    // A page's card and its title plate.
    "card",
    "title-plate",
];

/// UI pieces drawn at their own aspect ratio.
pub const UI_FIXED_SLOTS: [&str; 75] = [
    "grid-cell",
    "guardian-frame",
    "badge",
    "map-node-locked",
    "map-node-open",
    "map-node-done",
    "map-node-guardian",
    "star-on",
    "star-off",
    "star-big",
    "slider-knob",
    "toggle-knob",
    "icon-hammer",
    "icon-totem",
    "icon-wave",
    "icon-reroll",
    "icon-pause",
    "icon-back",
    "icon-settings",
    "icon-close",
    "icon-kredit",
    "icon-campaign",
    "icon-daily",
    "icon-profile",
    "icon-share",
    "icon-music",
    "icon-sound",
    "icon-lock",
    "icon-trophy",
    // A bonus or reroll tablet with no charge, the moves tablet's hourglass,
    // the Daily best's crown and the Daily's time left.
    "icon-hammer-empty",
    "icon-totem-empty",
    "icon-wave-empty",
    "icon-reroll-empty",
    "icon-hourglass",
    "icon-crown",
    "icon-clock",
    // Result and page actions and outcomes: play, retry, the map, out of
    // moves, a full board and an ended run.
    "icon-play",
    "icon-retry",
    "icon-map",
    "icon-hourglass-empty",
    "icon-board-full",
    "icon-flag",
    // Effect sprites are white with variable alpha; the client tints them.
    // fx-glow is the light code places behind live and earned things.
    "fx-glow",
    // A broken block's chunks, tinted by its width colour, and white sparks.
    "fx-shard-1",
    "fx-shard-2",
    "fx-shard-3",
    "fx-shard-4",
    "fx-spark-1",
    "fx-spark-2",
    "fx-spark-3",
    // A completed line's sweep and the motes it releases.
    "fx-sweep",
    "fx-mote",
    // Combo and perfect-clear bursts, the soft ring, and an earned star's
    // flare and trail.
    "fx-burst",
    "fx-ring-soft",
    "fx-star-flare",
    "fx-trail",
    // The guardian's celebration halo and its defeat ripple.
    "fx-halo",
    "fx-dim-ripple",
    // A realm's light shaft, the page-transition vignette and a press glint.
    "fx-shaft",
    "fx-vignette",
    "fx-press",
    // The emblems beyond the ten guardians: every realm conquered and the
    // perfect world; drawn in the ring's opening like a portrait.
    "emblem-11",
    "emblem-12",
    // The score's pictogram, a crown socket and its earned star, the bubble's
    // tail, and the glows behind a warm and an ember moves tablet.
    "goal-score",
    "star-socket",
    "star-lit",
    "tap-bubble-tail",
    "moves-warm-glow",
    "moves-ember-glow",
    // The Daily's multiplier capsule and the lit fill that runs round it.
    "multiplier-ring",
    "multiplier-ring-fill",
    // A one-move goal's ring, the pips of moves in a row, and the tick of a
    // met goal (also the ring once earned).
    "counter-ring",
    "counter-pip",
    "counter-pip-filled",
    "tick",
];

/// The ladder's tiers, from the core's own progression.
pub fn ladder_tiers() -> u8 {
    zkube_core::ladder_tier_for_points(u64::MAX) + 1
}

/// Every UI slot: the stretched and fixed pieces, every goal pictogram, and
/// for each ladder tier the border worn around the emblem (in place of the
/// guardian ring) and its badge.
pub fn ui_slots() -> Vec<String> {
    let mut slots: Vec<String> = UI_STRETCH_SLOTS
        .iter()
        .chain(&UI_FIXED_SLOTS)
        .map(|s| (*s).to_owned())
        .collect();
    slots.extend(super::pictograms::slots());
    for tier in 0..ladder_tiers() {
        slots.push(format!("ladder-border-{tier}"));
        slots.push(format!("ladder-badge-{tier}"));
    }
    slots
}

/// Blocks are coloured by width, so each realm draws one block per width.
pub const BLOCK_WIDTHS: u8 = 4;

pub const TOKENS: [&str; 10] = [
    "text",
    "text-muted",
    "text-on-primary",
    "text-on-secondary",
    "accent",
    "positive",
    "negative",
    "score",
    "objective",
    "scrim",
];

/// Each realm's own colours, from its `tokens.json`.
pub const REALM_TOKENS: [&str; 6] = [
    // Effects for a cleared block take the colour of its width.
    "block-tint-1",
    "block-tint-2",
    "block-tint-3",
    "block-tint-4",
    // The realm's key light and the colour of the glows placed in it.
    "light-key",
    "light-glow",
];

/// Opaque realm paintings, stored as JPEG; the build re-encodes them anyway.
pub const REALM_PAINTINGS: [&str; 3] = ["background", "hud-background", "map"];

/// Realm pieces drawn stretched; their borders are skin-wide in skin.json.
pub const REALM_STRETCH_SLOTS: [&str; 1] = ["ledge"];

pub fn realm_slots() -> Vec<String> {
    let mut slots: Vec<String> = ["background", "hud-background", "map", "mote"]
        .into_iter()
        .chain(REALM_STRETCH_SLOTS)
        .map(str::to_owned)
        .collect();
    slots.extend((1..=BLOCK_WIDTHS).map(|width| format!("block-{width}")));
    slots
}

type Colours = std::collections::BTreeMap<String, String>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SkinSource {
    name: String,
    tokens: Colours,
    borders: std::collections::BTreeMap<String, [u16; 4]>,
    light: std::collections::BTreeMap<String, RealmLight>,
}

/// Where a realm's painting keeps its key light (a fraction of the painting
/// from its top left), whether that light throws a shaft, and how its motes
/// look: their drawn size in dp and whether they rise (1) or fall (-1).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RealmLight {
    source: [f64; 2],
    shafts: u8,
    mote_dp: f64,
    mote_drift: i8,
}

fn realm_light(light: &RealmLight, owner: &str) -> Result<Value, String> {
    let inside = |v: f64| (0.0..=1.0).contains(&v);
    if !light.source.iter().all(|v| inside(*v))
        || light.shafts > 2
        || !(2.0..=48.0).contains(&light.mote_dp)
        || light.mote_drift.abs() != 1
    {
        return Err(format!(
            "{owner} light needs a source inside its painting, at most two shafts, a mote of 2-48 dp and a drift of 1 or -1"
        ));
    }
    Ok(
        json!({"source": light.source, "shafts": light.shafts, "moteDp": light.mote_dp,
        "moteDrift": light.mote_drift}),
    )
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    serde_json::from_str(
        &fs::read_to_string(path)
            .map_err(|error| format!("cannot read {}: {error}", path.display()))?,
    )
    .map_err(|error| format!("invalid {}: {error}", path.display()))
}

fn colours(source: &Colours, names: &[&str], owner: &str) -> Result<Vec<Value>, String> {
    let present: BTreeSet<&str> = source.keys().map(String::as_str).collect();
    if present != names.iter().copied().collect() {
        return Err(format!("{owner} must define exactly the tokens {names:?}"));
    }
    names
        .iter()
        .map(|name| Ok(json!({"name": name, "value": rgba(&source[*name])?})))
        .collect()
}

fn rgba(hex: &str) -> Result<Value, String> {
    let digits = hex
        .strip_prefix('#')
        .filter(|d| d.len() == 6 || d.len() == 8);
    let digits =
        digits.ok_or_else(|| format!("token colour {hex} must be #RRGGBB or #RRGGBBAA"))?;
    let channel = |at: usize| {
        u8::from_str_radix(&digits[at..at + 2], 16)
            .map(|v| f64::from(v) / 255.0)
            .map_err(|_| format!("token colour {hex} is not hexadecimal"))
    };
    let alpha = if digits.len() == 8 { channel(6)? } else { 1.0 };
    Ok(json!([channel(0)?, channel(2)?, channel(4)?, alpha]))
}

/// A slot's file: opaque paintings are JPEG, everything else is PNG with alpha.
pub fn slot_file(slot: &str) -> String {
    let extension = if REALM_PAINTINGS.contains(&slot) {
        "jpg"
    } else {
        "png"
    };
    format!("{slot}.{extension}")
}

/// dir holds exactly the files of slots, plus the one data file if named.
fn exact_slots<'a>(
    dir: &Path,
    slots: impl IntoIterator<Item = &'a str>,
    data: Option<&str>,
) -> Result<(), String> {
    let entries =
        fs::read_dir(dir).map_err(|error| format!("cannot read {}: {error}", dir.display()))?;
    let mut present = BTreeSet::new();
    for entry in entries {
        present.insert(
            entry
                .map_err(|error| error.to_string())?
                .file_name()
                .to_string_lossy()
                .into_owned(),
        );
    }
    let mut expected: BTreeSet<String> = data.into_iter().map(str::to_owned).collect();
    for slot in slots {
        let file = slot_file(slot);
        if !present.contains(&file) {
            return Err(format!("{} is missing slot {slot} ({file})", dir.display()));
        }
        expected.insert(file);
    }
    if let Some(extra) = present.difference(&expected).next() {
        return Err(format!("{} holds unknown file {extra}", dir.display()));
    }
    Ok(())
}

fn skin(root: &Path, id: &str, realm_count: usize) -> Result<Value, String> {
    let base = root.join("assets/skins").join(id);
    let source: SkinSource = read_json(&base.join("skin.json"))?;
    let tokens = colours(&source.tokens, &TOKENS, &format!("skin {id}"))?;
    let stretched: BTreeSet<&str> = UI_STRETCH_SLOTS
        .into_iter()
        .chain(REALM_STRETCH_SLOTS)
        .collect();
    let border_names: BTreeSet<&str> = source.borders.keys().map(String::as_str).collect();
    if border_names != stretched {
        return Err(format!(
            "skin {id} must give a border for exactly the stretched slots {stretched:?}"
        ));
    }
    exact_slots(
        &base.join("ui"),
        ui_slots().iter().map(String::as_str),
        None,
    )?;
    let lit: BTreeSet<String> = (1..=realm_count).map(|r| r.to_string()).collect();
    if source.light.keys().cloned().collect::<BTreeSet<_>>() != lit {
        return Err(format!(
            "skin {id} must light exactly realms 1 to {realm_count}"
        ));
    }
    let mut realms = vec![];
    for realm_id in 1..=realm_count {
        let dir = base.join(format!("realm-{realm_id}"));
        exact_slots(
            &dir,
            realm_slots().iter().map(String::as_str),
            Some("tokens.json"),
        )?;
        let realm_tokens = colours(
            &read_json(&dir.join("tokens.json"))?,
            &REALM_TOKENS,
            &dir.join("tokens.json").display().to_string(),
        )?;
        let images: Map<String, Value> = realm_slots()
            .into_iter()
            .map(|slot| {
                let file = json!(format!(
                    "/assets/skins/{id}/realm-{realm_id}/{}",
                    slot_file(&slot)
                ));
                (slot, file)
            })
            .collect();
        let borders: Map<String, Value> = REALM_STRETCH_SLOTS
            .iter()
            .map(|slot| ((*slot).to_owned(), json!(source.borders[*slot])))
            .collect();
        let light = realm_light(
            &source.light[&realm_id.to_string()],
            &format!("skin {id} realm {realm_id}"),
        )?;
        realms.push(
            json!({"realmId": realm_id, "images": images, "borders": borders,
            "tokens": realm_tokens, "light": light}),
        );
    }
    let ui_slots: Vec<Value> = ui_slots()
        .iter()
        .map(|slot| {
            json!({"slot": slot, "image": format!("/assets/skins/{id}/ui/{slot}.png"),
                "border": source.borders.get(slot).copied().unwrap_or([0; 4])})
        })
        .collect();
    Ok(json!({"id": id, "name": source.name, "tokens": tokens, "ui": ui_slots, "realms": realms}))
}

/// Renders every authored skin; the first listed skin is the default.
pub fn render(root: &Path, authored: &Value, realm_count: usize) -> Result<Value, String> {
    let ids = authored["skins"]
        .as_array()
        .ok_or("assets/catalog.json must list its skins")?;
    let mut seen = BTreeSet::new();
    let mut skins = vec![];
    for id in ids {
        let id = id.as_str().ok_or("skin ids are strings")?;
        if id.is_empty()
            || !id.bytes().all(|b| b.is_ascii_lowercase() || b == b'-')
            || !seen.insert(id)
        {
            return Err(format!(
                "skin id {id:?} must be unique lowercase letters and hyphens"
            ));
        }
        skins.push(skin(root, id, realm_count)?);
    }
    if skins.is_empty() {
        return Err("assets/catalog.json must list at least one skin".into());
    }
    Ok(Value::Array(skins))
}

fn pascal(name: &str) -> String {
    name.split('-')
        .map(|part| {
            let mut chars = part.chars();
            chars.next().map_or_else(String::new, |first| {
                first.to_ascii_uppercase().to_string() + chars.as_str()
            })
        })
        .collect()
}

/// C# names for every slot and token, so presentation code cannot name a slot the contract lacks.
pub fn csharp() -> String {
    let mut out = String::from(
        "// Generated by zkube-codegen from crates/zkube-codegen/src/skins.rs. Do not edit.\n\
         namespace ZKube.Core.Generated\n{\n    public static class SkinSlots\n    {\n",
    );
    for slot in ui_slots() {
        let _ = writeln!(
            out,
            "        public const string {} = \"{slot}\";",
            pascal(&slot)
        );
    }
    for slot in realm_slots()
        .iter()
        .filter(|slot| !slot.starts_with("block-"))
    {
        let _ = writeln!(
            out,
            "        public const string {} = \"{slot}\";",
            pascal(slot)
        );
    }
    let tiers = ladder_tiers();
    let _ = write!(
        out,
        "        public const int BlockWidths = {BLOCK_WIDTHS};\n\
         \x20       public static string Block(int width) => \"block-\" + width;\n\
         \x20       public const int LadderTiers = {tiers};\n\
         \x20       public static string LadderBorder(int tier) => \"ladder-border-\" + tier;\n\
         \x20       public static string LadderBadge(int tier) => \"ladder-badge-\" + tier;\n    }}\n\n\
         \x20   public static class SkinTokens\n    {{\n"
    );
    for token in TOKENS.iter().chain(&REALM_TOKENS) {
        let _ = writeln!(
            out,
            "        public const string {} = \"{token}\";",
            pascal(token)
        );
    }
    out +=
        "        public static string BlockTint(int width) => \"block-tint-\" + width;\n    }\n}\n";
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("zkube-skins-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let base = root.join("assets/skins/test");
        let write = |dir: &Path, slot: &str| {
            fs::create_dir_all(dir).unwrap();
            fs::write(dir.join(slot_file(slot)), b"image").unwrap();
        };
        for slot in ui_slots() {
            write(&base.join("ui"), &slot);
        }
        for realm in 1..=2 {
            let dir = base.join(format!("realm-{realm}"));
            for slot in realm_slots() {
                write(&dir, &slot);
            }
            let tokens: Map<String, Value> = REALM_TOKENS
                .iter()
                .map(|t| ((*t).to_owned(), json!(format!("#0{realm}0000"))))
                .collect();
            fs::write(dir.join("tokens.json"), Value::Object(tokens).to_string()).unwrap();
        }
        let tokens: Map<String, Value> = TOKENS
            .iter()
            .map(|t| ((*t).to_owned(), json!("#102030")))
            .collect();
        let borders: Map<String, Value> = UI_STRETCH_SLOTS
            .iter()
            .chain(&REALM_STRETCH_SLOTS)
            .map(|s| ((*s).to_owned(), json!([8, 8, 8, 8])))
            .collect();
        let light: Map<String, Value> = (1..=2)
            .map(|r| {
                (
                    r.to_string(),
                    json!({"source": [0.5, 0.05], "shafts": 0, "moteDp": 12, "moteDrift": 1}),
                )
            })
            .collect();
        fs::write(
            base.join("skin.json"),
            json!({"name": "Test", "tokens": tokens, "borders": borders, "light": light})
                .to_string(),
        )
        .unwrap();
        root
    }

    fn listed() -> Value {
        json!({"skins": ["test"]})
    }

    #[test]
    fn every_skin_fills_every_ui_and_realm_slot() {
        let root = fixture("complete");
        let skins = render(&root, &listed(), 2).unwrap();
        assert_eq!(skins[0]["realms"].as_array().unwrap().len(), 2);
        assert_eq!(
            skins[0]["ui"].as_array().unwrap().len(),
            UI_STRETCH_SLOTS.len()
                + UI_FIXED_SLOTS.len()
                + super::super::pictograms::slots().len()
                + 2 * usize::from(ladder_tiers())
        );
        let pictogram = root.join("assets/skins/test/ui/goal-streak.png");
        fs::remove_file(&pictogram).unwrap();
        let error = render(&root, &listed(), 2).unwrap_err();
        assert!(error.contains("missing slot goal-streak"), "{error}");
        fs::write(&pictogram, b"image").unwrap();
        let top = format!("ladder-border-{}", ladder_tiers() - 1);
        let path = root.join("assets/skins/test/ui").join(slot_file(&top));
        fs::remove_file(&path).unwrap();
        let error = render(&root, &listed(), 2).unwrap_err();
        assert!(error.contains(&format!("missing slot {top}")), "{error}");
        fs::write(&path, b"image").unwrap();
        let realm = &skins[0]["realms"][1];
        assert_eq!(
            realm["images"]["ledge"],
            "/assets/skins/test/realm-2/ledge.png"
        );
        assert_eq!(realm["borders"]["ledge"], json!([8, 8, 8, 8]));

        assert_eq!(realm["images"]["map"], "/assets/skins/test/realm-2/map.jpg");
        for slot in ["block-3", "hud-background", "ledge"] {
            let path = root.join("assets/skins/test/realm-2").join(slot_file(slot));
            fs::remove_file(&path).unwrap();
            let error = render(&root, &listed(), 2).unwrap_err();
            assert!(error.contains(&format!("missing slot {slot}")), "{error}");
            fs::write(&path, b"image").unwrap();
        }
        fs::write(root.join("assets/skins/test/ui/unused.png"), b"png").unwrap();
        let error = render(&root, &listed(), 2).unwrap_err();
        assert!(error.contains("unknown file unused.png"), "{error}");
        fs::remove_file(root.join("assets/skins/test/ui/unused.png")).unwrap();
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn paintings_are_jpeg_and_everything_with_alpha_is_png() {
        for slot in REALM_PAINTINGS {
            assert_eq!(slot_file(slot), format!("{slot}.jpg"));
        }
        for slot in realm_slots()
            .into_iter()
            .filter(|slot| !REALM_PAINTINGS.contains(&slot.as_str()))
            .chain(ui_slots())
        {
            assert_eq!(slot_file(&slot), format!("{slot}.png"));
        }
        let root = fixture("extensions");
        let realm = root.join("assets/skins/test/realm-1");
        fs::rename(realm.join("map.jpg"), realm.join("map.png")).unwrap();
        let error = render(&root, &listed(), 2).unwrap_err();
        assert!(error.contains("missing slot map (map.jpg)"), "{error}");
        fs::rename(realm.join("map.png"), realm.join("map.jpg")).unwrap();
        fs::rename(realm.join("ledge.png"), realm.join("ledge.jpg")).unwrap();
        let error = render(&root, &listed(), 2).unwrap_err();
        assert!(error.contains("missing slot ledge (ledge.png)"), "{error}");
        let error = render(&root, &json!({"skins": []}), 2).unwrap_err();
        assert!(error.contains("at least one skin"), "{error}");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn every_realm_declares_its_own_block_tints_and_light() {
        let root = fixture("realm-tokens");
        let skins = render(&root, &listed(), 2).unwrap();
        let tokens = |realm: usize| skins[0]["realms"][realm]["tokens"].clone();
        let first = tokens(0);
        let names: Vec<&str> = first
            .as_array()
            .unwrap()
            .iter()
            .map(|token| token["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, REALM_TOKENS);
        assert_ne!(tokens(0), tokens(1), "Realm tokens are each realm's own");
        assert!(
            skins[0]["tokens"]
                .as_array()
                .unwrap()
                .iter()
                .all(|token| !REALM_TOKENS.contains(&token["name"].as_str().unwrap())),
            "Realm tokens are not skin-wide"
        );

        let path = root.join("assets/skins/test/realm-2/tokens.json");
        let mut source: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        source.as_object_mut().unwrap().remove("light-glow");
        fs::write(&path, source.to_string()).unwrap();
        let error = render(&root, &listed(), 2).unwrap_err();
        assert!(
            error.contains("realm-2") && error.contains("exactly the tokens"),
            "{error}"
        );
        fs::remove_file(&path).unwrap();
        let error = render(&root, &listed(), 2).unwrap_err();
        assert!(
            error.contains("cannot read") && error.contains("tokens.json"),
            "{error}"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn every_realm_places_its_key_light_shafts_and_motes() {
        let root = fixture("light");
        let skins = render(&root, &listed(), 2).unwrap();
        assert_eq!(
            skins[0]["realms"][1]["light"],
            json!({"source": [0.5, 0.05], "shafts": 0, "moteDp": 12.0, "moteDrift": 1})
        );
        let path = root.join("assets/skins/test/skin.json");
        let good: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        for (field, value) in [
            ("source", json!([1.2, 0.0])),
            ("shafts", json!(3)),
            ("moteDp", json!(0.5)),
            ("moteDrift", json!(0)),
        ] {
            let mut bad = good.clone();
            bad["light"]["2"][field] = value;
            fs::write(&path, bad.to_string()).unwrap();
            assert!(
                render(&root, &listed(), 2)
                    .unwrap_err()
                    .contains("realm 2 light"),
                "{field}"
            );
        }
        let mut missing = good.clone();
        missing["light"].as_object_mut().unwrap().remove("2");
        fs::write(&path, missing.to_string()).unwrap();
        assert!(
            render(&root, &listed(), 2)
                .unwrap_err()
                .contains("light exactly realms")
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn generated_csharp_names_cover_every_slot_and_token() {
        let source = csharp();
        for name in ui_slots()
            .iter()
            .map(String::as_str)
            .chain(TOKENS)
            .chain(REALM_TOKENS)
        {
            assert!(source.contains(&format!("= \"{name}\";")), "{name}");
        }
        assert!(source.contains(&format!("LadderTiers = {};", ladder_tiers())));
        assert_eq!(
            ladder_tiers(),
            5,
            "The ladder has five tiers of border and badge"
        );
        for slot in realm_slots()
            .iter()
            .filter(|slot| !slot.starts_with("block-"))
        {
            assert!(source.contains(&format!("= \"{slot}\";")), "{slot}");
        }
        assert!(source.contains("ButtonPrimaryPressed = \"button-primary-pressed\""));
        assert!(source.contains("TextOnPrimary = \"text-on-primary\""));
        assert!(source.contains("HudBackground = \"hud-background\""));
        for width in 1..=BLOCK_WIDTHS {
            assert!(
                REALM_TOKENS.contains(&format!("block-tint-{width}").as_str()),
                "{width}"
            );
        }
    }

    #[test]
    fn skins_declare_exact_tokens_and_stretch_borders() {
        let root = fixture("tokens");
        let path = root.join("assets/skins/test/skin.json");
        let mut source: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        source["tokens"].as_object_mut().unwrap().remove("scrim");
        fs::write(&path, source.to_string()).unwrap();
        assert!(
            render(&root, &listed(), 2)
                .unwrap_err()
                .contains("exactly the tokens")
        );

        source["tokens"]["scrim"] = json!("#00000080");
        source["tokens"]["block-tint-1"] = json!("#00000080");
        fs::write(&path, source.to_string()).unwrap();
        assert!(
            render(&root, &listed(), 2)
                .unwrap_err()
                .contains("exactly the tokens"),
            "Block tints belong to realms"
        );

        source["tokens"]
            .as_object_mut()
            .unwrap()
            .remove("block-tint-1");
        for (slot, border) in [("grid-cell", json!([1, 1, 1, 1])), ("ledge", Value::Null)] {
            let mut changed = source.clone();
            if border.is_null() {
                changed["borders"].as_object_mut().unwrap().remove(slot);
            } else {
                changed["borders"][slot] = border;
            }
            fs::write(&path, changed.to_string()).unwrap();
            assert!(
                render(&root, &listed(), 2)
                    .unwrap_err()
                    .contains("stretched slots"),
                "{slot}"
            );
        }
        let _ = fs::remove_dir_all(root);
    }
}
