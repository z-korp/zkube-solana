using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;
using ZKube.Core.Generated;
using ZKube.Persistence;

namespace ZKube.Presentation
{
    // The board's independent master mute never overwrites these preferences.
    public sealed class AudioPreferences
    {
        private readonly Action<string, string> write;
        public double MusicVolume { get; private set; } = AudioPolicy.DefaultMusicVolume;
        public double EffectsVolume { get; private set; } = AudioPolicy.DefaultEffectsVolume;
        public AudioPreferences(Func<string, string> read = null, Action<string, string> write = null)
        {
            this.write = write;
            try
            {
                string text = read?.Invoke(AudioPolicy.StorageKey);
                if (string.IsNullOrEmpty(text)) return;
                var root = StrictJson.Parse(text);
                if (!(root is JObject value)) return;
                double music = Read(value["musicVolume"], AudioPolicy.DefaultMusicVolume);
                double effects = Read(value["effectsVolume"], AudioPolicy.DefaultEffectsVolume);
                MusicVolume = music; EffectsVolume = effects;
            }
            catch { MusicVolume = AudioPolicy.DefaultMusicVolume; EffectsVolume = AudioPolicy.DefaultEffectsVolume; }
        }
        public void SetMusicVolume(double value) { MusicVolume = Clamp(value); Save(); }
        public void SetEffectsVolume(double value) { EffectsVolume = Clamp(value); Save(); }
        private void Save() => write?.Invoke(AudioPolicy.StorageKey,
            "{\"musicVolume\":" + MusicVolume.ToString("R", CultureInfo.InvariantCulture) +
            ",\"effectsVolume\":" + EffectsVolume.ToString("R", CultureInfo.InvariantCulture) + "}");
        private static double Clamp(double value) => double.IsNaN(value) ? 0 : Math.Min(1, Math.Max(0, value));
        private static double Read(JToken value, double fallback) =>
            value == null || value.Type == JTokenType.Null ? fallback : Clamp(Number(value));

        // JSON may contain values older clients wrote outside the slider UI.
        // Match JS Number coercion here; do not silently apply different types
        // or decimal parsing rules from the original save parser.
        private static readonly Regex Decimal = new Regex(@"^([+-]?)(?:([0-9]+)(?:\.([0-9]*))?|\.([0-9]+))([eE][+-]?[0-9]+)?$", RegexOptions.CultureInvariant);
        private static double Number(JToken value)
        {
            if (value.Type == JTokenType.Integer || value.Type == JTokenType.Float) return (double)value;
            if (value.Type == JTokenType.Boolean) return (bool)value ? 1 : 0;
            string text = StrictJson.TrimString(value is JArray array ? ArrayString(array) : ScalarString(value));
            if (text.Length == 0) return 0;
            if (text == "Infinity" || text == "+Infinity") return double.PositiveInfinity;
            if (text == "-Infinity") return double.NegativeInfinity;
            if (text.StartsWith("0x", StringComparison.OrdinalIgnoreCase) || text.StartsWith("0b", StringComparison.OrdinalIgnoreCase) || text.StartsWith("0o", StringComparison.OrdinalIgnoreCase))
            {
                int radix = char.ToLowerInvariant(text[1]) == 'x' ? 16 : char.ToLowerInvariant(text[1]) == 'b' ? 2 : 8;
                bool positive = false;
                if (text.Length == 2) return double.NaN;
                for (int i = 2; i < text.Length; i++)
                {
                    char c = char.ToLowerInvariant(text[i]);
                    int digit = c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1;
                    if (digit < 0 || digit >= radix) return double.NaN;
                    positive |= digit != 0;
                }
                // These unsigned integer syntaxes clamp to either zero or one.
                return positive ? 1 : 0;
            }
            var match = Decimal.Match(text);
            if (!match.Success) return double.NaN;
            string integer = match.Groups[2].Value.TrimStart('0');
            string fraction = match.Groups[3].Success ? match.Groups[3].Value : match.Groups[4].Value;
            string json = (match.Groups[1].Value == "-" ? "-" : "") + (integer.Length == 0 ? "0" : integer) +
                (fraction.Length == 0 ? "" : "." + fraction) + match.Groups[5].Value;
            return (double)StrictJson.Parse(json);
        }
        private static string ScalarString(JToken value)
        {
            if (value.Type == JTokenType.Null) return "";
            if (value.Type == JTokenType.String) return (string)value;
            if (value.Type == JTokenType.Boolean) return (bool)value ? "true" : "false";
            if (value.Type == JTokenType.Integer || value.Type == JTokenType.Float) return ((double)value).ToString("R", CultureInfo.InvariantCulture);
            if (value is JObject obj && obj.Property("toString") != null)
                throw new FormatException("Audio preference cannot convert an object to a number");
            return "[object Object]";
        }
        private static string ArrayString(JArray root)
        {
            var text = new StringBuilder(); var pending = new Stack<(JArray Array, int Index)>(); pending.Push((root, 0));
            while (pending.Count != 0)
            {
                var frame = pending.Pop(); if (frame.Index == frame.Array.Count) continue;
                if (frame.Index != 0) text.Append(','); pending.Push((frame.Array, frame.Index + 1));
                var value = frame.Array[frame.Index];
                if (value is JArray child) pending.Push((child, 0)); else text.Append(ScalarString(value));
            }
            return text.ToString();
        }
    }
}
