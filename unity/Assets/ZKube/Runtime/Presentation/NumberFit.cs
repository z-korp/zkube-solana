using System.Globalization;
using System.Text.RegularExpressions;
using TMPro;
using UnityEngine;

namespace ZKube.Presentation
{
    // A number never wraps. It shrinks to fit its width, down to its role's
    // smallest size (the type table: the 56 dp result score to 28, the 21–39 dp
    // numbers to 17, the 14–20 dp values to 14, the badge size), and when it
    // still does not fit its large figures abbreviate (18.4Qi).
    public static class NumberFit
    {
        public static float Minimum(float sizeDp) => sizeDp >= 40 ? 28 : sizeDp > 20 ? 17 : Mathf.Min(sizeDp, 14);

        public static (string Text, float Size) Fit(SkinUi ui, string value, float width, float sizeDp, bool abbreviate = true)
        {
            float min = Minimum(sizeDp);
            float measured = ui.TextWidth(value, sizeDp, SkinUi.Type.Number);
            if (measured <= width) return (value, sizeDp);
            float scaled = Shrunk(sizeDp, width, measured);
            if (scaled >= min || !abbreviate) return (value, Mathf.Max(min, scaled));
            string shortened = Abbreviate(value);
            measured = ui.TextWidth(shortened, sizeDp, SkinUi.Type.Number);
            return (shortened, measured <= width ? sizeDp : Mathf.Max(min, Shrunk(sizeDp, width, measured)));
        }
        private static float Shrunk(float sizeDp, float width, float measured) => Mathf.Floor(sizeDp * width / measured * 10) / 10;

        // Sets a drawn number to its fitted text and size, on one line.
        public static TMP_Text Apply(SkinUi ui, TMP_Text text, float width, float sizeDp, bool abbreviate = true)
        {
            var (shown, size) = Fit(ui, text.text, width, sizeDp, abbreviate);
            text.text = shown; text.fontSize = size * ui.Density * ui.Scale;
            text.textWrappingMode = TextWrappingModes.NoWrap; text.overflowMode = TextOverflowModes.Overflow;
            return text;
        }

        // Every figure of four digits or more (with its thousands separators and
        // any fraction) becomes its short-scale abbreviation.
        public static string Abbreviate(string value) =>
            Regex.Replace(value, @"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4,}(?:\.\d+)?", match =>
                Compact(decimal.Parse(match.Value.Replace(",", ""), CultureInfo.InvariantCulture)));
        private static readonly string[] suffixes = { "K", "M", "B", "T", "Qa", "Qi" };
        public static string Compact(decimal value)
        {
            if (value < 1000) return value.ToString("0.#", CultureInfo.InvariantCulture);
            int step = -1;
            while (value >= 1000 && step < suffixes.Length - 1) { value /= 1000; step++; }
            return (decimal.Truncate(value * 10) / 10).ToString("0.0", CultureInfo.InvariantCulture) + suffixes[step];
        }
    }
}
