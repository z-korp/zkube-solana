//! Skin contract: every skin supplies every slot for the UI and for each realm,
//! so a skin can never ship with a missing piece. Art lives in
//! `assets/skins/<id>/{skin.json, ui/<slot>.png, realm-<n>/<slot>.png}`.

use std::{collections::BTreeSet, fmt::Write as _, fs, path::Path};

use serde::Deserialize;
use serde_json::{Map, Value, json};

/// UI pieces drawn stretched; each declares its stretch border in skin.json.
pub const UI_STRETCH_SLOTS: [&str; 19] = [
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
];

/// UI pieces drawn at their own aspect ratio.
pub const UI_FIXED_SLOTS: [&str; 33] = [
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
    // Effect sprites are white with variable alpha; the client tints them.
    "fx-spark",
    "fx-shard",
    "fx-glow",
    "fx-ring",
];

/// Blocks are coloured by width, so each realm draws one block per width.
pub const BLOCK_WIDTHS: u8 = 4;

pub const TOKENS: [&str; 14] = [
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
    // Effects for a cleared block take the colour of its width.
    "block-tint-1",
    "block-tint-2",
    "block-tint-3",
    "block-tint-4",
];

pub fn realm_slots() -> Vec<String> {
    let mut slots = vec!["background".to_owned(), "map".to_owned()];
    slots.extend((1..=BLOCK_WIDTHS).map(|width| format!("block-{width}")));
    slots
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SkinSource {
    name: String,
    tokens: std::collections::BTreeMap<String, String>,
    borders: std::collections::BTreeMap<String, [u16; 4]>,
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

fn png_files(dir: &Path) -> Result<BTreeSet<String>, String> {
    let entries =
        fs::read_dir(dir).map_err(|error| format!("cannot read {}: {error}", dir.display()))?;
    let mut names = BTreeSet::new();
    for entry in entries {
        let name = entry.map_err(|error| error.to_string())?.file_name();
        let name = name.to_string_lossy();
        let stem = name
            .strip_suffix(".png")
            .ok_or_else(|| format!("{} holds a non-PNG file: {name}", dir.display()))?;
        names.insert(stem.to_owned());
    }
    Ok(names)
}

fn exact_slots(dir: &Path, expected: &BTreeSet<String>) -> Result<(), String> {
    let present = png_files(dir)?;
    if let Some(missing) = expected.difference(&present).next() {
        return Err(format!("{} is missing slot {missing}", dir.display()));
    }
    if let Some(extra) = present.difference(expected).next() {
        return Err(format!("{} holds unknown slot {extra}", dir.display()));
    }
    Ok(())
}

fn skin(root: &Path, id: &str, realm_count: usize) -> Result<Value, String> {
    let base = root.join("assets/skins").join(id);
    let path = base.join("skin.json");
    let source: SkinSource = serde_json::from_str(
        &fs::read_to_string(&path)
            .map_err(|error| format!("cannot read {}: {error}", path.display()))?,
    )
    .map_err(|error| format!("invalid {}: {error}", path.display()))?;

    let token_names: BTreeSet<&str> = source.tokens.keys().map(String::as_str).collect();
    if token_names != TOKENS.into_iter().collect() {
        return Err(format!(
            "skin {id} must define exactly the tokens {TOKENS:?}"
        ));
    }
    let border_names: BTreeSet<&str> = source.borders.keys().map(String::as_str).collect();
    if border_names != UI_STRETCH_SLOTS.into_iter().collect() {
        return Err(format!(
            "skin {id} must give a border for exactly the stretched slots {UI_STRETCH_SLOTS:?}"
        ));
    }
    let ui: BTreeSet<String> = UI_STRETCH_SLOTS
        .iter()
        .chain(&UI_FIXED_SLOTS)
        .map(|s| (*s).to_owned())
        .collect();
    exact_slots(&base.join("ui"), &ui)?;
    let realm: BTreeSet<String> = realm_slots().into_iter().collect();
    let mut realms = vec![];
    for realm_id in 1..=realm_count {
        exact_slots(&base.join(format!("realm-{realm_id}")), &realm)?;
        let images: Map<String, Value> = realm_slots()
            .into_iter()
            .map(|slot| {
                let file = json!(format!("/assets/skins/{id}/realm-{realm_id}/{slot}.png"));
                (slot, file)
            })
            .collect();
        realms.push(json!({"realmId": realm_id, "images": images}));
    }
    let tokens = TOKENS
        .iter()
        .map(|name| Ok(json!({"name": name, "value": rgba(&source.tokens[*name])?})))
        .collect::<Result<Vec<_>, String>>()?;
    let ui_slots: Vec<Value> = UI_STRETCH_SLOTS
        .iter()
        .chain(&UI_FIXED_SLOTS)
        .map(|slot| {
            json!({"slot": slot, "image": format!("/assets/skins/{id}/ui/{slot}.png"),
                "border": source.borders.get(*slot).copied().unwrap_or([0; 4])})
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
    for slot in UI_STRETCH_SLOTS.iter().chain(&UI_FIXED_SLOTS) {
        let _ = writeln!(
            out,
            "        public const string {} = \"{slot}\";",
            pascal(slot)
        );
    }
    let _ = write!(
        out,
        "        public const string Background = \"background\";\n        public const string Map = \"map\";\n\
         \x20       public const int BlockWidths = {BLOCK_WIDTHS};\n\
         \x20       public static string Block(int width) => \"block-\" + width;\n    }}\n\n\
         \x20   public static class SkinTokens\n    {{\n"
    );
    for token in TOKENS {
        let _ = writeln!(
            out,
            "        public const string {} = \"{token}\";",
            pascal(token)
        );
    }
    out += "        public static string BlockTint(int width) => \"block-tint-\" + width;\n    }\n}\n";
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
            fs::write(dir.join(format!("{slot}.png")), b"png").unwrap();
        };
        for slot in UI_STRETCH_SLOTS.iter().chain(&UI_FIXED_SLOTS) {
            write(&base.join("ui"), slot);
        }
        for realm in 1..=2 {
            for slot in realm_slots() {
                write(&base.join(format!("realm-{realm}")), &slot);
            }
        }
        let tokens: Map<String, Value> = TOKENS
            .iter()
            .map(|t| ((*t).to_owned(), json!("#102030")))
            .collect();
        let borders: Map<String, Value> = UI_STRETCH_SLOTS
            .iter()
            .map(|s| ((*s).to_owned(), json!([8, 8, 8, 8])))
            .collect();
        fs::write(
            base.join("skin.json"),
            json!({"name": "Test", "tokens": tokens, "borders": borders}).to_string(),
        )
        .unwrap();
        root
    }

    #[test]
    fn every_skin_fills_every_ui_and_realm_slot() {
        let root = fixture("complete");
        let skins = render(&root, &json!({"skins": ["test"]}), 2).unwrap();
        assert_eq!(skins[0]["realms"].as_array().unwrap().len(), 2);
        assert_eq!(
            skins[0]["ui"].as_array().unwrap().len(),
            UI_STRETCH_SLOTS.len() + UI_FIXED_SLOTS.len()
        );

        fs::remove_file(root.join("assets/skins/test/realm-2/block-3.png")).unwrap();
        let error = render(&root, &json!({"skins": ["test"]}), 2).unwrap_err();
        assert!(error.contains("missing slot block-3"), "{error}");

        fs::write(root.join("assets/skins/test/realm-2/block-3.png"), b"png").unwrap();
        fs::write(root.join("assets/skins/test/ui/unused.png"), b"png").unwrap();
        let error = render(&root, &json!({"skins": ["test"]}), 2).unwrap_err();
        assert!(error.contains("unknown slot unused"), "{error}");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn generated_csharp_names_cover_every_slot_and_token() {
        let source = csharp();
        for name in UI_STRETCH_SLOTS
            .iter()
            .chain(&UI_FIXED_SLOTS)
            .chain(&TOKENS)
        {
            assert!(source.contains(&format!("= \"{name}\";")), "{name}");
        }
        assert!(source.contains("ButtonPrimaryPressed = \"button-primary-pressed\""));
        assert!(source.contains("TextOnPrimary = \"text-on-primary\""));
        for width in 1..=BLOCK_WIDTHS {
            assert!(TOKENS.contains(&format!("block-tint-{width}").as_str()), "{width}");
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
            render(&root, &json!({"skins": ["test"]}), 2)
                .unwrap_err()
                .contains("exactly the tokens")
        );

        source["tokens"]["scrim"] = json!("#00000080");
        source["borders"]["grid-cell"] = json!([1, 1, 1, 1]);
        fs::write(&path, source.to_string()).unwrap();
        assert!(
            render(&root, &json!({"skins": ["test"]}), 2)
                .unwrap_err()
                .contains("stretched slots")
        );
        let _ = fs::remove_dir_all(root);
    }
}
