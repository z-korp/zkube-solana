//! Player words: every string a player reads, in every language.
//! `assets/words/<code>.json` is the one owner. English is the source of the
//! keys; every other language carries exactly the same keys with the same
//! placeholders, written for its own readers. The generator emits one C# table
//! per language and one typed accessor per key, so a key that is missing in
//! any language, or a placeholder that disagrees, fails the build.
//!
//! A value is a string, or its language's counted forms when its words change
//! with `{n}`: `{"one": …, "other": …}`, or `{"one": …, "few": …, "many": …}`
//! in Russian. `{n}` and `{#name}` are numbers, written in the language's own
//! grouping; `{name}` is text. Keys under `caption.` and `rule.` are templates
//! the generator fills itself (`captions`, `art_catalog`).

use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Write as _,
    fs,
    path::Path,
};

use serde_json::Value;

/// How a language chooses the form of a counted phrase.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Plural {
    /// `one` for exactly 1: English, Spanish, German.
    One,
    /// `one` for 0 and 1: French, Brazilian Portuguese.
    ZeroOne,
    /// `one` for 1, 21, 31; `few` for 2 to 4, 22 to 24; `many` for the rest: Russian.
    Slavic,
    /// No plural forms: Chinese, Japanese, Korean, Turkish, Vietnamese, Indonesian.
    None,
}

/// The table rows a counted key takes: the most forms any language has.
const FORMS: usize = 3;

impl Plural {
    /// The forms a counted phrase is written in, in table order.
    #[must_use]
    pub fn names(self) -> &'static [&'static str] {
        match self {
            Plural::One | Plural::ZeroOne => &["one", "other"],
            Plural::Slavic => &["one", "few", "many"],
            Plural::None => &[],
        }
    }

    /// Which of its forms a language takes for `n`.
    #[must_use]
    pub fn form(self, n: u64) -> usize {
        match self {
            Plural::One => usize::from(n != 1),
            Plural::ZeroOne => usize::from(n > 1),
            Plural::Slavic => match (n % 10, n % 100) {
                (1, hundred) if hundred != 11 => 0,
                (2..=4, hundred) if !(12..=14).contains(&hundred) => 1,
                _ => 2,
            },
            Plural::None => 0,
        }
    }
}

/// Every language the product can ship, in table order. A file for a code
/// outside this list has no plural or typography rule and is refused.
const RULES: [(&str, Plural); 12] = [
    ("en", Plural::One),
    ("zh-Hans", Plural::None),
    ("es", Plural::One),
    ("pt-BR", Plural::ZeroOne),
    ("fr", Plural::ZeroOne),
    ("de", Plural::One),
    ("ja", Plural::None),
    ("ko", Plural::None),
    ("ru", Plural::Slavic),
    ("tr", Plural::None),
    ("vi", Plural::None),
    ("id", Plural::None),
];

/// Templates only the generator reads; they get no accessor and no table row.
const TEMPLATES: [&str; 2] = ["caption.", "rule."];

#[derive(Clone, Debug, PartialEq, Eq)]
enum Entry {
    Plain(String),
    Counted(Vec<String>),
}

impl Entry {
    fn forms(&self) -> Vec<&str> {
        match self {
            Entry::Plain(text) => vec![text],
            Entry::Counted(forms) => forms.iter().map(String::as_str).collect(),
        }
    }
}

#[derive(Debug)]
pub struct Language {
    pub code: String,
    pub plural: Plural,
    entries: BTreeMap<String, Entry>,
    same: Vec<String>,
}

impl Language {
    /// The words of `key` for the count `n`, unfilled.
    fn form(&self, key: &str, n: u64) -> &str {
        match self
            .entries
            .get(key)
            .unwrap_or_else(|| panic!("{}: no words for {key}", self.code))
        {
            Entry::Plain(text) => text,
            Entry::Counted(forms) => &forms[self.plural.form(n)],
        }
    }

    /// `key` with its placeholders filled. `n` picks the plural form and
    /// fills `{n}`; the rest are named values.
    #[must_use]
    pub fn fill(&self, key: &str, n: u64, values: &[(&str, String)]) -> String {
        let mut text = self.form(key, n).replace("{n}", &n.to_string());
        for (name, value) in values {
            text = text
                .replace(&format!("{{#{name}}}"), value)
                .replace(&format!("{{{name}}}"), value);
        }
        assert!(
            !text.contains('{'),
            "{}: {key} keeps a placeholder: {text}",
            self.code
        );
        text
    }

    #[must_use]
    pub fn plain(&self, key: &str) -> String {
        self.fill(key, 0, &[])
    }
}

/// One table row: its words in every language, in language order.
struct Row {
    texts: Vec<String>,
}

pub struct Words {
    pub languages: Vec<Language>,
    rows: Vec<Row>,
    /// First row of each authored key that has an accessor.
    index: BTreeMap<String, usize>,
}

fn placeholders(text: &str) -> Result<BTreeSet<String>, String> {
    let mut found = BTreeSet::new();
    let mut rest = text;
    while let Some(open) = rest.find('{') {
        let close = rest[open..]
            .find('}')
            .ok_or_else(|| format!("unclosed placeholder in {text:?}"))?;
        let name = &rest[open + 1..open + close];
        let plain = name.strip_prefix('#').unwrap_or(name);
        if plain.is_empty() || !plain.chars().all(|c| c.is_ascii_lowercase() || c == '_') {
            return Err(format!("bad placeholder {{{name}}} in {text:?}"));
        }
        found.insert(name.to_string());
        rest = &rest[open + close + 1..];
    }
    if rest.contains('}') {
        return Err(format!("stray brace in {text:?}"));
    }
    Ok(found)
}

fn parse(code: &str, plural: Plural, source: &str) -> Result<Language, String> {
    let value: Value =
        serde_json::from_str(source).map_err(|error| format!("{code}.json: {error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| format!("{code}.json must be one object"))?;
    let mut entries = BTreeMap::new();
    let mut same = vec![];
    for (key, value) in object {
        if key == "@same" {
            same = value
                .as_array()
                .and_then(|list| list.iter().map(|item| item.as_str().map(String::from)).collect())
                .ok_or_else(|| format!("{code}: @same is a list of keys"))?;
            continue;
        }
        if !key
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '_')
            || key.split('.').any(str::is_empty)
        {
            return Err(format!("{code}: {key:?} is not a dotted lower-case key"));
        }
        let entry = match value {
            Value::String(text) => Entry::Plain(text.clone()),
            Value::Object(forms) => {
                let form = |name: &str| {
                    forms
                        .get(name)
                        .and_then(Value::as_str)
                        .map(String::from)
                        .ok_or_else(|| format!("{code}: {key} needs its {name:?} form"))
                };
                let names = plural.names();
                if names.is_empty() {
                    return Err(format!("{code}: {key} is one string; this language has no counted forms"));
                }
                if forms.len() != names.len() {
                    return Err(format!("{code}: {key} has exactly the forms {}", names.join(", ")));
                }
                Entry::Counted(names.iter().map(|name| form(name)).collect::<Result<_, _>>()?)
            }
            _ => return Err(format!("{code}: {key} is a string or its counted forms")),
        };
        for text in entry.forms() {
            // A format may be nothing but a space (a thousands separator).
            if text.is_empty() || !key.starts_with("format.") && text.trim() != text {
                return Err(format!("{code}: {key} is empty or padded"));
            }
            placeholders(text).map_err(|error| format!("{code}: {key}: {error}"))?;
        }
        entries.insert(key.clone(), entry);
    }
    Ok(Language {
        code: code.into(),
        plural,
        entries,
        same,
    })
}

fn matches(pattern: &str, key: &str) -> bool {
    let pattern: Vec<&str> = pattern.split('.').collect();
    let key: Vec<&str> = key.split('.').collect();
    pattern.len() == key.len() && pattern.iter().zip(&key).all(|(p, k)| *p == "*" || p == k)
}

const NBSP: char = '\u{a0}';

/// The pinned font that draws a language's own script, for the languages the
/// text fonts cannot write. Chinese and Japanese share characters each draws
/// its own way, so each has its own.
fn script_font(code: &str) -> Option<&'static str> {
    match code {
        "zh-Hans" => Some("NotoSansSC-700"),
        "ja" => Some("NotoSansJP-700"),
        "ko" => Some("NotoSansKR-700"),
        _ => None,
    }
}

/// The face that stands in for a skin face that cannot write a language:
/// its titles, then its display text. Fraunces has no Cyrillic; Lilita One has
/// none either and lacks Turkish and Vietnamese letters. A whole face is
/// replaced, never one letter of a word.
fn faces(code: &str) -> (Option<&'static str>, Option<&'static str>) {
    match code {
        "ru" => (Some("NotoSerif-700"), Some("Nunito-1000")),
        "tr" | "vi" => (None, Some("Nunito-1000")),
        _ => (None, None),
    }
}

/// Names the owner fixed. The Daily is the mode's name in every language. A
/// realm keeps its English name and a guardian its Latin letters in every
/// language but Chinese, Japanese and Korean, which write both in their own
/// script.
fn named(code: &str, key: &str, text: &str, english: &str) -> Option<&'static str> {
    let own_script = script_font(code).is_some();
    let realm = key.starts_with("realm.") && key.ends_with(".name");
    let guardian = key.starts_with("guardian.") && key.ends_with(".name");
    if key == "mode.daily" && text != english {
        return Some("is the mode's name and stays as English writes it");
    }
    if realm && !own_script && text != english {
        return Some("is a realm's name and stays as English writes it");
    }
    if (realm || guardian) && own_script && text.chars().any(|c| c.is_ascii_alphabetic()) {
        return Some("is a name and takes this language's own script");
    }
    if guardian && !own_script && !text.chars().all(|c| c.is_ascii_alphabetic() || c == '’' || c == '\'') {
        return Some("is a guardian's name and keeps its Latin letters");
    }
    None
}

/// A failure sentence opens with the service it names, and a service's name
/// is written with the capital that opening needs, so no code capitalises it.
fn opens(key: &str, text: &str) -> Option<&'static str> {
    if key.starts_with("arena.failure.") && text.contains("{service}") && !text.starts_with("{service}") {
        return Some("names its service anywhere but first; open the sentence with {service}");
    }
    if key.starts_with("arena.service.") && text.chars().next().is_some_and(char::is_lowercase) {
        return Some("is a service's name and opens a sentence; write its capital");
    }
    None
}

/// What a language's own typography forbids, as the first fault found.
fn typography(code: &str, text: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().collect();
    if text.contains("  ") {
        return Some("has a double space".into());
    }
    match code {
        "fr" => {
            if text.contains('\'') || text.contains('"') {
                return Some("uses a straight quote; French takes ’ and « »".into());
            }
            if text.contains("...") {
                return Some("uses three dots; write …".into());
            }
            if text.contains(" - ") || text.contains(" — ") || text.contains(" – ") {
                return Some("uses a spaced dash; write the clause out".into());
            }
            for (at, c) in chars.iter().enumerate() {
                let before = at.checked_sub(1).map(|i| chars[i]);
                let after = chars.get(at + 1).copied();
                let digit = |c: Option<char>| c.is_some_and(|c| c.is_ascii_digit());
                match c {
                    '?' | '!' | ';' | '»'
                        if !matches!(before, Some(NBSP | '?' | '!' | '…')) =>
                    {
                        return Some(format!("needs a no-break space before {c}"));
                    }
                    ':' if before != Some(NBSP) && !(digit(before) && digit(after)) => {
                        return Some("needs a no-break space before :".into());
                    }
                    '«' if after != Some(NBSP) => {
                        return Some("needs a no-break space after «".into());
                    }
                    _ => {}
                }
            }
            None
        }
        "es" => {
            // A question or an exclamation opens with its own mark.
            for (close, open) in [('?', '¿'), ('!', '¡')] {
                if text.matches(close).count() != text.matches(open).count() {
                    return Some(format!("needs {open} for every {close}"));
                }
            }
            None
        }
        "de" => {
            if text.contains('"') || text.contains('\'') {
                return Some("uses a straight quote; German takes „ “ and ’".into());
            }
            None
        }
        "ru" | "tr" | "vi" | "id" => {
            if text.contains('"') || text.contains('\'') {
                return Some("uses a straight quote; write « », “ ” or ’".into());
            }
            if text.contains("...") {
                return Some("uses three dots; write …".into());
            }
            // A letter and its marks are one composed character, which is what the fonts hold.
            if chars.iter().any(|c| ('\u{300}'..='\u{36f}').contains(c)) {
                return Some("has a combining mark; write the composed letter".into());
            }
            None
        }
        "ko" => chars
            .iter()
            .find(|c| matches!(c, '，' | '。' | '！' | '？' | '：' | '；' | '、'))
            .map(|c| format!("uses the full-width {c}; Korean takes the half-width mark")),
        "zh-Hans" | "ja" => {
            let wide = |c: char| ('\u{3040}'..='\u{9fff}').contains(&c);
            for pair in chars.windows(2) {
                if wide(pair[0]) && matches!(pair[1], ',' | '.' | '?' | '!' | ':' | ';') {
                    return Some(format!("uses the half-width {} after {}", pair[1], pair[0]));
                }
            }
            for triple in chars.windows(3) {
                if wide(triple[0]) && triple[1] == ' ' && wide(triple[2]) {
                    return Some("puts a space between two characters".into());
                }
            }
            None
        }
        _ => None,
    }
}

/// A short stable mark of a locked statement in two languages. It only has to
/// change when either text changes.
fn seal(source: &str, text: &str) -> String {
    let mut hash: u32 = 0x811c_9dc5;
    for byte in source.bytes().chain([0]).chain(text.bytes()) {
        hash = (hash ^ u32::from(byte)).wrapping_mul(0x0100_0193);
    }
    format!("{hash:08x}")
}

fn template(key: &str) -> bool {
    TEMPLATES.iter().any(|prefix| key.starts_with(prefix))
}

impl Words {
    pub fn load(root: &Path) -> Result<Words, String> {
        let directory = root.join("assets/words");
        let mut files = BTreeSet::new();
        for entry in fs::read_dir(&directory).map_err(|error| format!("assets/words: {error}"))? {
            let name = entry.map_err(|error| error.to_string())?.file_name();
            let name = name.to_string_lossy().into_owned();
            if let Some(code) = name.strip_suffix(".json") {
                if code != "locked" {
                    files.insert(code.to_string());
                }
            }
        }
        let mut sources = vec![];
        for (code, plural) in RULES {
            if files.remove(code) {
                let path = directory.join(format!("{code}.json"));
                sources.push((
                    code,
                    plural,
                    fs::read_to_string(&path).map_err(|error| error.to_string())?,
                ));
            }
        }
        if let Some(code) = files.first() {
            return Err(format!("assets/words/{code}.json: no rules for this language"));
        }
        let locked = fs::read_to_string(directory.join("locked.json"))
            .map_err(|error| format!("assets/words/locked.json: {error}"))?;
        Self::build(&sources, &locked)
    }

    fn build(sources: &[(&str, Plural, String)], locked: &str) -> Result<Words, String> {
        let mut languages = vec![];
        for (code, plural, source) in sources {
            languages.push(parse(code, *plural, source)?);
        }
        if languages.first().map(|language| language.code.as_str()) != Some("en") {
            return Err("assets/words/en.json is the source and must exist".into());
        }
        let english = &languages[0];
        for language in &languages[1..] {
            let code = &language.code;
            for key in english.entries.keys() {
                if !language.entries.contains_key(key) {
                    return Err(format!("{code}: {key} is missing"));
                }
            }
            for (key, entry) in &language.entries {
                let source = english
                    .entries
                    .get(key)
                    .ok_or_else(|| format!("{code}: {key} is not an English key"))?;
                let allowed: BTreeSet<String> = source
                    .forms()
                    .iter()
                    .flat_map(|text| placeholders(text).expect("parsed"))
                    .collect();
                if let (Entry::Plain(text), Entry::Plain(english)) = (entry, source) {
                    if let Some(fault) = named(code, key, text, english).or_else(|| opens(key, text)) {
                        return Err(format!("{code}: {key} {fault}: {text:?}"));
                    }
                }
                let mut used = BTreeSet::new();
                for text in entry.forms() {
                    used.extend(placeholders(text).expect("parsed"));
                    if let Some(fault) = typography(code, text) {
                        return Err(format!("{code}: {key} {fault}: {text:?}"));
                    }
                }
                // A form may leave {n} out ("a line"); nothing else may differ.
                let mut needed = allowed.clone();
                if matches!(entry, Entry::Counted(_)) || language.plural == Plural::None {
                    needed.remove("n");
                }
                if !used.is_subset(&allowed) || !needed.is_subset(&used) {
                    return Err(format!(
                        "{code}: {key} uses {used:?}; English uses {allowed:?}"
                    ));
                }
                if matches!(entry, Entry::Counted(_)) && !allowed.contains("n") {
                    return Err(format!("{code}: {key} has two forms but no {{n}} to count"));
                }
                // Left as English: the same text, with a word in it outside its placeholders.
                let kept = entry.forms() == source.forms()
                    && entry.forms().iter().any(|text| {
                        let mut bare = (*text).to_string();
                        for name in placeholders(text).expect("parsed") {
                            bare = bare.replace(&format!("{{{name}}}"), " ");
                        }
                        bare.split(|c: char| !c.is_alphabetic())
                            .any(|word| word.chars().count() > 1)
                    });
                if kept
                    && !key.starts_with("format.")
                    && !language.same.iter().any(|pattern| matches(pattern, key))
                {
                    return Err(format!(
                        "{code}: {key} is left in English; write it, or list it in @same"
                    ));
                }
            }
            for pattern in &language.same {
                if !language.entries.keys().any(|key| matches(pattern, key)) {
                    return Err(format!("{code}: @same lists {pattern}, which is no key"));
                }
            }
        }
        for (key, entry) in &english.entries {
            if matches!(entry, Entry::Counted(_))
                && !entry
                    .forms()
                    .iter()
                    .any(|text| placeholders(text).expect("parsed").contains("n"))
            {
                return Err(format!("en: {key} has two forms but no {{n}} to count"));
            }
        }
        Self::sealed(&languages, locked)?;

        let mut words = Words {
            languages,
            rows: vec![],
            index: BTreeMap::new(),
        };
        let keys: Vec<String> = words.languages[0].entries.keys().cloned().collect();
        for key in keys {
            if template(&key) {
                continue;
            }
            words.index.insert(key.clone(), words.rows.len());
            let counted = words.counted(&key);
            let order = words.order(&key);
            for form in 0..if counted { FORMS } else { 1 } {
                let texts = words
                    .languages
                    .iter()
                    .map(|language| {
                        let forms = language.entries[&key].forms();
                        positional(forms[form.min(forms.len() - 1)], &order)
                    })
                    .collect();
                words.rows.push(Row { texts });
            }
        }
        Ok(words)
    }

    /// Every locked statement has been read against its meaning in every
    /// language, and neither text has changed since.
    fn sealed(languages: &[Language], locked: &str) -> Result<(), String> {
        let locked: Value =
            serde_json::from_str(locked).map_err(|error| format!("locked.json: {error}"))?;
        let locked = locked.as_object().ok_or("locked.json must be one object")?;
        let english = &languages[0];
        for (key, record) in locked {
            let source = english
                .entries
                .get(key)
                .ok_or_else(|| format!("locked.json: {key} is no key"))?;
            if record["meaning"].as_str().is_none_or(str::is_empty) {
                return Err(format!("locked.json: {key} needs the meaning it must keep"));
            }
            for language in &languages[1..] {
                let code = &language.code;
                let expected = seal(
                    &source.forms().join("\n"),
                    &language.entries[key].forms().join("\n"),
                );
                let review = &record[code.as_str()];
                if review["says"].as_str().is_none_or(str::is_empty) {
                    return Err(format!(
                        "locked.json: {key} has no {code} reading; say what the {code} words say, then seal it {expected}"
                    ));
                }
                if review["seal"].as_str() != Some(expected.as_str()) {
                    return Err(format!(
                        "locked.json: {key} changed in en or {code}; read it against its meaning again, then seal it {expected}"
                    ));
                }
            }
        }
        Ok(())
    }

    fn counted(&self, key: &str) -> bool {
        self.languages
            .iter()
            .any(|language| matches!(language.entries[key], Entry::Counted(_)))
    }

    /// The key's placeholders in the order its accessor takes them: `n`
    /// first, then as English first names them.
    fn order(&self, key: &str) -> Vec<String> {
        let mut order = vec![];
        for text in self.languages[0].entries[key].forms() {
            let mut rest = text;
            while let Some(open) = rest.find('{') {
                let close = rest[open..].find('}').expect("parsed");
                let name = rest[open + 1..open + close].to_string();
                if !order.contains(&name) {
                    order.push(name);
                }
                rest = &rest[open + close + 1..];
            }
        }
        order.sort_by_key(|name| name != "n");
        order
    }

    /// The table row of an authored key (its `one` form when it counts).
    #[must_use]
    pub fn row(&self, key: &str) -> usize {
        *self
            .index
            .get(key)
            .unwrap_or_else(|| panic!("no words for {key}"))
    }

    /// Adds a row the generator rendered itself, one text per language.
    pub fn add(&mut self, texts: Vec<String>) -> usize {
        assert_eq!(texts.len(), self.languages.len());
        self.rows.push(Row { texts });
        self.rows.len() - 1
    }

    /// A row's words in every language.
    #[cfg(test)]
    #[must_use]
    pub fn texts(&self, row: usize) -> &[String] {
        &self.rows[row].texts
    }

    /// One rendered text per language.
    pub fn each(&self, render: impl Fn(&Language) -> String) -> Vec<String> {
        self.languages.iter().map(render).collect()
    }

    #[must_use]
    pub fn count(&self) -> usize {
        self.rows.len()
    }

    /// Every character any language shows, for the font import to bake.
    #[must_use]
    pub fn characters(&self) -> String {
        let mut all = BTreeSet::new();
        for row in &self.rows {
            for text in &row.texts {
                all.extend(text.chars().filter(|c| !c.is_control()));
            }
        }
        all.into_iter().collect()
    }

    #[must_use]
    /// Every character a language shows.
    fn characters_of(&self, language: usize) -> String {
        let mut own = BTreeSet::new();
        for row in &self.rows {
            own.extend(row.texts[language].chars().filter(|c| !c.is_control()));
        }
        own.into_iter().collect()
    }
    pub fn csharp(&self) -> String {
        let mut out = String::from(
            "// Generated by zkube-codegen from assets/words. Do not edit.\nnamespace ZKube.Core.Generated\n{\n    public static partial class Words\n    {\n",
        );
        let list = |values: Vec<String>| values.join(", ");
        let _ = writeln!(
            out,
            "        public static readonly string[] Codes = {{ {} }};",
            list(self.languages.iter().map(|l| quoted(&l.code)).collect())
        );
        let _ = writeln!(
            out,
            "        public static readonly string[] Names = {{ {} }};",
            list(self.languages.iter().map(|l| quoted(&l.plain("language.name"))).collect())
        );
        let _ = writeln!(
            out,
            "        // How each language counts: 0 takes its first form for 1, 1 for 0 and 1, 2 has one form, 3 has the three Russian forms.\n        private static readonly byte[] plurals = {{ {} }};",
            list(
                self.languages
                    .iter()
                    .map(|l| match l.plural {
                        Plural::One => "0".into(),
                        Plural::ZeroOne => "1".into(),
                        Plural::None => "2".into(),
                        Plural::Slavic => "3".into(),
                    })
                    .collect()
            )
        );
        let _ = writeln!(
            out,
            "        // The font behind the text fonts that draws each language's own script, and what it draws for it.\n        public static readonly string[] ScriptFonts = {{ {} }};",
            list(
                self.languages
                    .iter()
                    .map(|l| script_font(&l.code).map_or("null".into(), quoted))
                    .collect()
            )
        );
        let face = |pick: fn((Option<&'static str>, Option<&'static str>)) -> Option<&'static str>| {
            list(
                self.languages
                    .iter()
                    .map(|l| pick(faces(&l.code)).map_or("null".into(), quoted))
                    .collect(),
            )
        };
        let _ = writeln!(
            out,
            "        // The face a language takes for titles and for display text where the skin's cannot write it.\n        public static readonly string[] TitleFonts = {{ {} }};\n        public static readonly string[] DisplayFonts = {{ {} }};",
            face(|faces| faces.0),
            face(|faces| faces.1)
        );
        let _ = writeln!(
            out,
            "        // Every character each language shows.\n        public static readonly string[] CharactersOf = {{ {} }};",
            list((0..self.languages.len()).map(|at| quoted(&self.characters_of(at))).collect())
        );
        let _ = writeln!(out, "        public const int Count = {};", self.rows.len());
        // Families the runtime reads by position; each is checked to be in order.
        for (name, family, first, count) in [
            ("monthRow", "format.month", 1, 12),
            ("weekdayRow", "format.weekday", 0, 7),
            ("compactRow", "format.compact", 1, 6),
        ] {
            let key = |at: usize| {
                if count > 9 {
                    format!("{family}.{at:02}")
                } else {
                    format!("{family}.{at}")
                }
            };
            let start = self.row(&key(first));
            for at in 0..count {
                assert_eq!(
                    self.row(&key(first + at)),
                    start + at,
                    "{family} is one run of rows"
                );
            }
            let _ = writeln!(out, "        private const int {name} = {start};");
        }
        out.push_str("        private const int CompactUnits = 6;\n");
        let _ = writeln!(
            out,
            "        public const string Characters = {};",
            quoted(&self.characters())
        );
        for (key, row) in &self.index {
            let name = accessor(key);
            let order = self.order(key);
            let counted = self.counted(key);
            let pick = if counted {
                format!("Counted({row}, n)")
            } else {
                format!("At({row})")
            };
            if order.is_empty() {
                let _ = writeln!(out, "        public static string {name} => {pick};");
                continue;
            }
            let parameters: Vec<String> = order
                .iter()
                .map(|name| match name.strip_prefix('#') {
                    Some(number) => format!("long {}", camel(number)),
                    None if name == "n" => "long n".into(),
                    None => format!("string {}", camel(name)),
                })
                .collect();
            let values: Vec<String> = order
                .iter()
                .map(|name| match name.strip_prefix('#') {
                    Some(number) => format!("Number({})", camel(number)),
                    None if name == "n" => "Number(n)".into(),
                    None => camel(name),
                })
                .collect();
            let _ = writeln!(
                out,
                "        public static string {name}({}) => string.Format({pick}, {});",
                parameters.join(", "),
                values.join(", ")
            );
        }
        for (at, language) in self.languages.iter().enumerate() {
            let _ = writeln!(
                out,
                "        private static readonly string[] {} =\n        {{",
                table(&language.code)
            );
            for row in &self.rows {
                let _ = writeln!(out, "            {},", quoted(&row.texts[at]));
            }
            out.push_str("        };\n");
        }
        // Static fields are set in the order written: the tables come after their rows.
        let _ = writeln!(
            out,
            "        private static readonly string[][] tables = {{ {} }};",
            list(self.languages.iter().map(|l| table(&l.code)).collect())
        );
        out.push_str("    }\n}\n");
        out
    }
}

/// `text` with each placeholder replaced by its position in `order`, for
/// `string.Format`.
fn positional(text: &str, order: &[String]) -> String {
    let mut out = text.to_string();
    for (at, name) in order.iter().enumerate() {
        out = out.replace(&format!("{{{name}}}"), &format!("{{{at}}}"));
    }
    out
}

fn quoted(text: &str) -> String {
    let mut out = String::from("\"");
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            // Invisible spaces are written as escapes so a reader sees them.
            '\u{a0}' | '\u{202f}' | '\u{2009}' | '\u{200b}' => {
                let _ = write!(out, "\\u{:04X}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn table(code: &str) -> String {
    let mut name = String::new();
    let mut upper = true;
    for c in code.chars() {
        if c == '-' {
            upper = true;
        } else if upper {
            name.extend(c.to_uppercase());
            upper = false;
        } else {
            name.push(c);
        }
    }
    name
}

fn accessor(key: &str) -> String {
    key.split(['.', '_'])
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|first| first.to_uppercase().chain(chars).collect::<String>())
                .unwrap_or_default()
        })
        .collect()
}

fn camel(name: &str) -> String {
    let pascal = accessor(name);
    let mut chars = pascal.chars();
    chars
        .next()
        .map(|first| first.to_lowercase().chain(chars).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const EN: &str = r#"{"language.name": "English", "action.play": "Play",
        "level.title": "Level {#level} of {name}",
        "stars.kept": {"one": "{n} star kept", "other": "{n} stars kept"},
        "caption.lines": "Clear lines", "terms": "No refunds."}"#;
    const LOCKED: &str = r#"{"terms": {"meaning": "A paid entry is never refunded.",
        "fr": {"says": "No refund.", "seal": "SEAL"}}}"#;

    fn french(change: impl Fn(&mut serde_json::Map<String, Value>)) -> String {
        let mut value: Value = serde_json::from_str(
            "{\"language.name\": \"Français\", \"action.play\": \"Jouer\",
            \"level.title\": \"{name}, niveau {#level}\",
            \"stars.kept\": {\"one\": \"{n} étoile gardée\", \"other\": \"{n} étoiles gardées\"},
            \"caption.lines\": \"Efface des lignes\", \"terms\": \"Aucun remboursement.\"}",
        )
        .unwrap();
        change(value.as_object_mut().unwrap());
        value.to_string()
    }
    // The families the runtime reads by position, the same in both test languages.
    fn with_formats(source: &str) -> String {
        let mut value: Value = serde_json::from_str(source).unwrap();
        let object = value.as_object_mut().unwrap();
        for month in 1..=12 {
            object.insert(format!("format.month.{month:02}"), format!("m{month}").into());
        }
        for day in 0..7 {
            object.insert(format!("format.weekday.{day}"), format!("d{day}").into());
        }
        for unit in 1..=6 {
            object.insert(format!("format.compact.{unit}"), format!("u{unit}").into());
        }
        value.to_string()
    }
    fn build(fr: &str) -> Result<Words, String> {
        let locked = LOCKED.replace("SEAL", &seal("No refunds.", "Aucun remboursement."));
        Words::build(
            &[
                ("en", Plural::One, with_formats(EN)),
                ("fr", Plural::ZeroOne, with_formats(fr)),
            ],
            &locked,
        )
    }

    #[test]
    fn every_key_exists_in_every_language_with_the_same_placeholders() {
        let words = build(&french(|_| {})).unwrap();
        // Templates take no row; a counted key takes a row a form.
        assert_eq!(words.count(), 4 + FORMS + 12 + 7 + 6);
        assert_eq!(words.row("stars.kept") + FORMS, words.row("terms"));
        let code = words.csharp();
        assert!(code.contains("public static string ActionPlay => At(0);"), "{code}");
        assert!(!code.contains("CaptionLines"), "{code}");
        let level = words.row("level.title");
        assert!(code.contains(&format!(
            "public static string LevelTitle(long level, string name) => string.Format(At({level}), Number(level), name);"
        )));
        let stars = words.row("stars.kept");
        assert!(code.contains(&format!(
            "public static string StarsKept(long n) => string.Format(Counted({stars}, n), Number(n));"
        )));
        // A language may order its placeholders its own way.
        assert!(code.contains("\"{1}, niveau {0}\""), "{code}");

        let missing = build(&french(|fr| {
            fr.remove("action.play");
        }));
        assert_eq!(missing.err().unwrap(), "fr: action.play is missing");
        let extra = build(&french(|fr| {
            fr.insert("action.stop".into(), "Stop".into());
        }));
        assert_eq!(extra.err().unwrap(), "fr: action.stop is not an English key");
        let renamed = build(&french(|fr| {
            fr.insert("level.title".into(), "Niveau {#niveau}".into());
        }));
        assert!(renamed.err().unwrap().starts_with("fr: level.title uses"));
        let dropped = build(&french(|fr| {
            fr.insert("level.title".into(), "Niveau {#level}".into());
        }));
        assert!(dropped.err().unwrap().starts_with("fr: level.title uses"));
    }

    #[test]
    fn no_key_is_left_in_english_unless_its_language_says_so() {
        let left = build(&french(|fr| {
            fr.insert("action.play".into(), "Play".into());
        }));
        assert_eq!(
            left.err().unwrap(),
            "fr: action.play is left in English; write it, or list it in @same"
        );
        build(&french(|fr| {
            fr.insert("action.play".into(), "Play".into());
            fr.insert("@same".into(), serde_json::json!(["action.*"]));
        }))
        .unwrap();
        let stale = build(&french(|fr| {
            fr.insert("@same".into(), serde_json::json!(["action.stop"]));
        }));
        assert_eq!(stale.err().unwrap(), "fr: @same lists action.stop, which is no key");
    }

    #[test]
    fn a_failure_opens_with_its_service_and_the_service_with_its_capital() {
        assert!(opens("arena.failure.insecure", "A secure connection to {service} could not be made.").is_some());
        assert_eq!(opens("arena.failure.insecure", "{service} could not be reached over a secure connection."), None);
        assert!(opens("arena.service.server", "the game server").is_some());
        assert_eq!(opens("arena.service.server", "Der Spielserver"), None);
        // A script without capitals has nothing to write.
        assert_eq!(opens("arena.service.server", "游戏服务器"), None);
        assert_eq!(opens("arena.failure.no_network", "The network could not be reached."), None);
    }

    #[test]
    fn names_the_owner_fixed_stay_fixed() {
        assert!(named("fr", "mode.daily", "Défi du jour", "Daily").is_some());
        assert!(named("ja", "mode.daily", "デイリー", "Daily").is_some());
        assert_eq!(named("ko", "mode.daily", "Daily", "Daily"), None);
        assert!(named("fr", "realm.2.name", "Égypte", "Egypt").is_some());
        assert_eq!(named("de", "realm.2.name", "Egypt", "Egypt"), None);
        assert!(named("zh-Hans", "realm.2.name", "Egypt", "Egypt").is_some());
        assert_eq!(named("zh-Hans", "realm.2.name", "埃及", "Egypt"), None);
        assert!(named("ja", "guardian.2.name", "Sobek", "Sobek").is_some());
        assert_eq!(named("ja", "guardian.2.name", "ソベク", "Sobek"), None);
        // A Latin-script language may set a guardian's name in its own typography.
        assert_eq!(named("fr", "guardian.8.name", "K’uk’", "K'uk'"), None);
        assert_eq!(named("fr", "realm.2.title", "Égypte", "Egypt"), None);
        assert!(named("ru", "guardian.2.name", "Собек", "Sobek").is_some());
        assert_eq!(named("ru", "guardian.2.name", "Sobek", "Sobek"), None);
        assert!(named("tr", "realm.2.name", "Mısır", "Egypt").is_some());
    }

    #[test]
    fn each_language_keeps_its_own_typography() {
        for (text, fault) in [
            ("Prêt ?", "needs a no-break space before ?"),
            ("Bravo!", "needs a no-break space before !"),
            ("Score: 3", "needs a no-break space before :"),
            ("C'est fini", "uses a straight quote"),
            ("Attends...", "uses three dots"),
            ("La marée - la tienne", "uses a spaced dash"),
            ("«Vague»", "needs a no-break space after «"),
        ] {
            let fault_found = typography("fr", text).unwrap_or_default();
            assert!(fault_found.contains(fault), "{text:?}: {fault_found}");
        }
        for text in ["Prêt\u{a0}?", "Fin à 07:00 UTC", "«\u{a0}Vague\u{a0}»", "C’est fini…", "Quoi\u{a0}?!"] {
            assert_eq!(typography("fr", text), None, "{text:?}");
        }
        assert!(typography("ru", "Нажми \"Далее\"").is_some());
        assert_eq!(typography("ru", "Нажми «Далее»…"), None);
        assert!(typography("vi", "Tie\u{302}\u{301}p").is_some());
        assert_eq!(typography("vi", "Tiếp tục"), None);
        assert!(typography("tr", "Daily'ye gir").is_some());
        assert!(typography("es", "Otra vez?").is_some());
        assert_eq!(typography("es", "¿Otra vez? ¡Claro!"), None);
        assert!(typography("de", "Tippe auf \"Weiter\"").is_some());
        assert!(typography("ko", "다시 해요。").is_some());
        assert!(typography("zh-Hans", "消除方块.").is_some());
        assert!(typography("ja", "ブロック を消す").is_some());
        assert_eq!(typography("zh-Hans", "消除 3 行。"), None);
        let fault = build(&french(|fr| {
            fr.insert("action.play".into(), "Jouer!".into());
        }));
        assert!(fault.err().unwrap().starts_with("fr: action.play needs a no-break space before !"));
    }

    #[test]
    fn a_locked_statement_is_read_again_whenever_either_text_changes() {
        build(&french(|_| {})).unwrap();
        let changed = build(&french(|fr| {
            fr.insert("terms".into(), "Remboursement possible.".into());
        }));
        assert!(
            changed.err().unwrap().starts_with("locked.json: terms changed in en or fr"),
        );
        let unread = Words::build(
            &[
                ("en", Plural::One, with_formats(EN)),
                ("fr", Plural::ZeroOne, with_formats(&french(|_| {}))),
            ],
            r#"{"terms": {"meaning": "A paid entry is never refunded."}}"#,
        );
        assert!(unread.err().unwrap().starts_with("locked.json: terms has no fr reading"));
    }

    #[test]
    fn each_language_counts_its_own_way() {
        let words = build(&french(|_| {})).unwrap();
        let (english, french) = (&words.languages[0], &words.languages[1]);
        assert_eq!(english.fill("stars.kept", 0, &[]), "0 stars kept");
        assert_eq!(english.fill("stars.kept", 1, &[]), "1 star kept");
        assert_eq!(french.fill("stars.kept", 0, &[]), "0 étoile gardée");
        assert_eq!(french.fill("stars.kept", 2, &[]), "2 étoiles gardées");
        assert_eq!(
            french.fill("level.title", 0, &[("level", "4".into()), ("name", "Tiki".into())]),
            "Tiki, niveau 4"
        );
        assert_eq!(Plural::None.form(1), 0);
        // Russian: 1 ход, 2 хода, 5 ходов, and the teens are all "many".
        let forms = |ns: &[u64]| ns.iter().map(|n| Plural::Slavic.form(*n)).collect::<Vec<_>>();
        assert_eq!(forms(&[1, 21, 101]), [0, 0, 0]);
        assert_eq!(forms(&[2, 3, 4, 22, 104]), [1, 1, 1, 1, 1]);
        assert_eq!(forms(&[0, 5, 11, 12, 14, 20, 25, 111, 112]), [2; 9]);
        let russian = parse("ru", Plural::Slavic, r#"{"moves": {"one": "{n} ход", "few": "{n} хода", "many": "{n} ходов"}}"#).unwrap();
        assert_eq!(russian.fill("moves", 22, &[]), "22 хода");
        assert!(parse("ru", Plural::Slavic, r#"{"moves": {"one": "{n} ход", "other": "{n} ходов"}}"#).is_err());
        assert!(parse("tr", Plural::None, r#"{"moves": {"one": "{n} hamle", "other": "{n} hamle"}}"#).is_err());
    }

    #[test]
    fn the_committed_words_are_complete_in_every_language() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let words = Words::load(&root).unwrap();
        assert!(words.languages.len() >= 2);
        assert!(words.count() > 0);
    }
}
