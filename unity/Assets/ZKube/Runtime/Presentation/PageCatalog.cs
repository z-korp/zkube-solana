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
        public ConstraintName[] constraintNames;
        private static PageCatalog cached;
        [Serializable] public sealed class ConstraintName { public byte kind; public string name, any; }
        [Serializable] public sealed class GuardianRule
        {
            public byte bonus, trigger;
            public ushort threshold;
            public string description, sentence;
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
            public string id, realmName, guardianName, guardianGreeting;
            public Swatch[] rgba;
            public AudioEntry[] audio;
            public Point[] campaignPath;
            public PathStyle map;
        }
        public static PageCatalog Load()
        {
            if (cached != null) return cached;
            var asset = Resources.Load<TextAsset>("ZKube/Catalog");
            if (asset == null) throw new InvalidOperationException("Imported page catalog is missing");
            try { var value = JsonUtility.FromJson<PageCatalog>(asset.text); value.Validate(); return cached = value; }
            finally { Resources.UnloadAsset(asset); }
        }
        public string ObjectiveName(byte kind, byte value)
        {
            var caption = constraintNames.Single(entry => entry.kind == kind);
            return value == 0 && !string.IsNullOrEmpty(caption.any) ? caption.any : string.Format(CultureInfo.InvariantCulture, caption.name, value);
        }
        public RealmPage Realm(byte id) => themes.Single(value => value.realmId == id);
        public PortraitEntry Portrait(byte id) => portraits.Single(value => value.realmId == id);
        public DailyTheme Objective(byte kind, byte value) => dailyThemes.Single(theme => theme.kind == kind && theme.value == value);
        public void Validate()
        {
            if (themes == null || themes.Length != 10 || themes.Select(value => value.realmId).Distinct().Count() != 10)
                throw new FormatException("Regenerate the ten-realm page catalog");
            foreach (var realm in themes)
            {
                if (realm.realmId < 1 || realm.realmId > 10 || string.IsNullOrEmpty(realm.realmName) || string.IsNullOrEmpty(realm.guardianName) ||
                    string.IsNullOrEmpty(realm.guardianGreeting) || realm.campaignPath == null || realm.campaignPath.Length != 10 || realm.map == null)
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
            if (constraintNames == null || constraintNames.Any(value => string.IsNullOrEmpty(value.name)) ||
                constraintNames.Select(value => value.kind).Distinct().Count() != constraintNames.Length ||
                dailyThemes.Any(value => !constraintNames.Any(name => name.kind == value.kind)))
                throw new FormatException("Generated constraint names are incomplete");
            if (guardianRules == null) throw new FormatException("Generated guardian descriptions are missing");
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
