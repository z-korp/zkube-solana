using ZKube.Core.Generated;
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

        // A number at a size already fitted: as it is, or abbreviated when wider.
        public static string Within(SkinUi ui, string value, float width, float sizeDp) =>
            ui.TextWidth(value, sizeDp, SkinUi.Type.Number) <= width ? value : Abbreviate(value);

        // Sets a drawn number to its fitted text and size, on one line.
        public static TMP_Text Apply(SkinUi ui, TMP_Text text, float width, float sizeDp, bool abbreviate = true)
        {
            var (shown, size) = Fit(ui, text.text, width, sizeDp, abbreviate);
            text.text = shown; text.fontSize = size * ui.Density * ui.Scale;
            text.textWrappingMode = TextWrappingModes.NoWrap; text.overflowMode = TextOverflowModes.Overflow;
            return text;
        }

        // A count written into running text ("1,240 ladder points"): grouped up
        // to seven digits, its short-scale abbreviation beyond, so no sentence
        // carries a figure longer than "9,999,999".
        public static string Figure(ulong value) =>
            value < 10_000_000 ? Words.Number(value) : Compact(value);

        // Every figure of four digits or more (with its thousands separators and
        // any fraction) becomes its short-scale abbreviation.
        // The figure is read as the language in use writes it: its thousands
        // separator and its decimal mark.
        public static string Abbreviate(string value)
        {
            string group = Regex.Escape(Words.FormatThousands), mark = Regex.Escape(Words.FormatDecimal);
            return Regex.Replace(value, @"\d{1,3}(?:" + group + @"\d{3})+(?:" + mark + @"\d+)?|\d{4,}(?:" + mark + @"\d+)?", match =>
                Compact(decimal.Parse(match.Value.Replace(Words.FormatThousands, "").Replace(Words.FormatDecimal, "."), CultureInfo.InvariantCulture)));
        }
        public static string Compact(decimal value) => Words.Compact(value);
    }
}
