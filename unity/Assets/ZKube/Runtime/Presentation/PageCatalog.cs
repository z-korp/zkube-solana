using System;
using System.Linq;
using System.Globalization;
using UnityEngine;

namespace ZKube.Presentation
{
    // Authored presentation data is emitted by Rust codegen from the asset catalog.
    // No path coordinates, guardian lines or palette values are mirrored here.
    [Serializable] public sealed class PageCatalog
    {
        public RealmPage[] themes;
        public DailyTheme[] dailyThemes;
        public GuardianRule[] guardianRules;
        public ConstraintCaption[] constraintCaptions;
        public SkinEntry[] skins;
        private static PageCatalog cached;
        [Serializable] public sealed class SkinEntry { public string id, name; public Swatch[] tokens; public UiSlot[] ui; public SkinRealm[] realms; }
        [Serializable] public sealed class UiSlot { public string slot, image; public int[] border; }
        [Serializable] public sealed class SkinRealm { public byte realmId; public Swatch[] tokens; public RealmLight light; }
        // Where the realm's painting keeps its key light (a fraction of the painting
        // from its top left), how many shafts it throws, and its motes' size and drift.
        [Serializable] public sealed class RealmLight { public float[] source; public int shafts; public float moteDp; public int moteDrift; }
        // Every goal the product shows, rendered by codegen: its sentence-case
        // caption, the chip's numbers and signs, how its progress is counted
        // (fill, ring, bar, or none for Classic) and its pictogram slot for
        // each bonus in tag order.
        [Serializable] public sealed class ConstraintCaption
        {
            public byte kind, value, count;
            public string text, chip, counter;
            public string[] pictograms;
            // The picture for a realm whose guardian grants this bonus.
            public string Pictogram(byte bonus) => pictograms[bonus - 1];
        }
        [Serializable] public sealed class GuardianRule
        {
            public byte bonus, trigger;
            public ushort threshold;
            public string name, description, sentence, effect;
            // The Earn panel draws the trigger as this goal pictogram and chip.
            public string pictogram, chip;
        }
        [Serializable] public sealed class AudioEntry { public string context, resource; }
        [Serializable] public sealed class Swatch { public string name; public float[] value; }
        public PortraitEntry[] portraits;
        [Serializable] public sealed class PortraitEntry { public byte realmId; public string atlas, sprite, source, sha256; }
        [Serializable] public sealed class DailyTheme { public byte kind, value; public string description; }
        [Serializable] public sealed class Point { public float x, y; }
        [Serializable] public sealed class PathStyle
        {
            public string pathStyle, lockedDash;
            public float strokeWidth, lockedStrokeWidth;
            public float[] clearedRgba, activeRgba, lockedRgba;
        }
        [Serializable] public sealed class RealmPage
        {
            public byte realmId;
            public string id, realmName, guardianName, guardianTitle;
            public GuardianLines guardianLines;
            public Swatch[] rgba;
            public AudioEntry[] audio;
            public Point[] campaignPath;
            public PathStyle map;
            public GuardianContact guardian;
        }
        // What the guardian says, by moment (codegen checks each is present and spoken).
        [Serializable] public sealed class GuardianLines
        {
            public string greeting, dailyGreeting, trialIntro, respectLine, oneStar, twoStar, threeStar,
                incomplete, defeatLine, newBestLine;
            public string[] All => new[] { greeting, dailyGreeting, trialIntro, respectLine, oneStar, twoStar, threeStar,
                incomplete, defeatLine, newBestLine };
            // A win by the stars it kept.
            public string Stars(int stars) => stars >= 3 ? threeStar : stars == 2 ? twoStar : oneStar;
        }
        // Where the guardian's paws rest, as fractions of its square canvas from the top.
        [Serializable] public sealed class GuardianContact { public float railY, railFrontY; }
        public static PageCatalog Load()
        {
            if (cached != null) return cached;
            var asset = Resources.Load<TextAsset>("ZKube/Catalog");
            if (asset == null) throw new InvalidOperationException("Imported page catalog is missing");
            try { var value = JsonUtility.FromJson<PageCatalog>(asset.text); value.Validate(); return cached = value; }
            finally { Resources.UnloadAsset(asset); }
        }
        // A Daily objective has no count; a Campaign goal passes its authored count.
        // Codegen stores wording that does not change with the count at count zero.
        public string ObjectiveName(byte kind, byte value, byte count = 0) => Goal(kind, value, count).text;
        public ConstraintCaption Goal(byte kind, byte value, byte count = 0) =>
            constraintCaptions.SingleOrDefault(entry => entry.kind == kind && entry.value == value && entry.count == count)
            ?? constraintCaptions.SingleOrDefault(entry => entry.kind == kind && entry.value == value && entry.count == 0)
            ?? throw new FormatException("No generated caption for constraint kind " + kind + " value " + value + " count " + count);
        public RealmPage Realm(byte id) => themes.Single(value => value.realmId == id);
        // The first listed skin is the default; the generator guarantees every slot exists.
        public SkinEntry DefaultSkin => skins[0];
        public PortraitEntry Portrait(byte id) => portraits.Single(value => value.realmId == id);
        // A realm's guardian rule, from the protocol's bonus, trigger and threshold.
        public GuardianRule Rule(byte realm)
        {
            var rules = ZKube.Core.Generated.Protocol.Realms.Single(value => value.MapId == realm).GuardianAndHeight;
            return guardianRules.Single(rule => rule.bonus == rules[0] && rule.trigger == rules[1] && rule.threshold == rules[2]);
        }
        public void Validate()
        {
            if (themes == null || themes.Length != 10 || themes.Select(value => value.realmId).Distinct().Count() != 10)
                throw new FormatException("Regenerate the ten-realm page catalog");
            foreach (var realm in themes)
            {
                if (realm.realmId < 1 || realm.realmId > 10 || string.IsNullOrEmpty(realm.realmName) || string.IsNullOrEmpty(realm.guardianName) ||
                    string.IsNullOrEmpty(realm.guardianTitle) || realm.guardianLines == null ||
                    realm.guardianLines.All.Any(string.IsNullOrWhiteSpace) || realm.campaignPath == null || realm.campaignPath.Length != 10 || realm.map == null)
                    throw new FormatException("Imported realm page is incomplete");
                foreach (var point in realm.campaignPath)
                    if (point == null || !Finite(point.x) || !Finite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)
                        throw new FormatException("Invalid authored Campaign path point");
                var style = realm.map;
                if (!new[] { "solid", "dashed", "dotted", "double" }.Contains(style.pathStyle) || !Finite(style.strokeWidth) || !Finite(style.lockedStrokeWidth) || style.strokeWidth <= 0 || style.lockedStrokeWidth <= 0)
                    throw new FormatException("Invalid authored Campaign path style");
                foreach (var color in new[] { style.clearedRgba, style.activeRgba, style.lockedRgba })
                    if (color == null || color.Length != 4 || color.Any(value => !Finite(value) || value < 0 || value > 1)) throw new FormatException("Invalid authored path color");
                var dash = style.lockedDash?.Split(' ');
                if (dash?.Length != 2 || dash.Any(value => !float.TryParse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float number) || !Finite(number) || number <= 0))
                    throw new FormatException("Invalid authored path dash");
            }
            if (dailyThemes == null || dailyThemes.Length != ZKube.Core.Generated.Protocol.DailyThemes.Length) throw new FormatException("Imported Daily labels are incomplete");
            foreach (var pair in ZKube.Core.Generated.Protocol.DailyThemes)
                if (dailyThemes.Count(theme => theme.kind == pair[0] && theme.value == pair[1] && !string.IsNullOrEmpty(theme.description)) != 1)
                    throw new FormatException("Imported Daily label disagrees with the published objective set");
            if (constraintCaptions == null || constraintCaptions.Any(value => string.IsNullOrEmpty(value.text)) ||
                constraintCaptions.Select(value => (value.kind, value.value, value.count)).Distinct().Count() != constraintCaptions.Length ||
                dailyThemes.Any(value => !constraintCaptions.Any(name => name.kind == value.kind && name.value == value.value && name.count == 0)))
                throw new FormatException("Generated constraint names are incomplete");
            // Codegen makes every pictogram a skin slot; an older import lacks them.
            if (constraintCaptions.Any(goal => goal.chip == null || goal.pictograms?.Length != (goal.kind == 0 ? 0 : 3) ||
                    !new[] { "fill", "ring", "bar", "none" }.Contains(goal.counter)))
                throw new FormatException("Regenerate the catalog with its goal pictograms");
            if (guardianRules == null || guardianRules.Any(rule => string.IsNullOrEmpty(rule.name) || string.IsNullOrEmpty(rule.effect)))
                throw new FormatException("Generated guardian descriptions are missing");
            foreach (var realm in themes) Rule(realm.realmId);
            if (skins == null || skins.Length == 0) throw new FormatException("Regenerate the catalog with its skin list");
            foreach (var skin in skins)
                if (string.IsNullOrEmpty(skin.id) || skin.tokens == null || skin.ui == null || skin.realms == null ||
                    skin.realms.Any(realm => realm.tokens == null || realm.light?.source == null || realm.light.source.Length != 2) ||
                    skin.realms.Select(realm => realm.realmId).OrderBy(id => id).SequenceEqual(themes.Select(realm => realm.realmId).OrderBy(id => id)) == false)
                    throw new FormatException("Imported skin does not cover every realm");
            if (portraits == null || portraits.Length != themes.Length || portraits.Select(value => value.realmId).Distinct().Count() != themes.Length)
                throw new FormatException("Generated guardian portraits are incomplete");
            foreach (var realm in themes)
            {
                var portrait = Portrait(realm.realmId);
                if (portrait.atlas != "ZKube/Atlases/portraits" || string.IsNullOrEmpty(portrait.sprite) || string.IsNullOrEmpty(portrait.source) || portrait.sha256?.Length != 64)
                    throw new FormatException("Guardian portrait has no canonical import binding");
            }
        }
        private static bool Finite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);
    }
}
