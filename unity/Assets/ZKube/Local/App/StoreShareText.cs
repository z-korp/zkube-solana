using System;
using System.Globalization;

namespace ZKube.Local.App
{
    public static class StoreShareText
    {
        public static string Build(string name, string guardian, string realm, string objective,
            string objectiveTotal, ulong score, ulong streak, CultureInfo culture = null)
        {
            if (name == null || guardian == null || realm == null || objective == null || objectiveTotal == null)
                throw new ArgumentNullException("Share result is incomplete");
            return name + " faced " + guardian + " in " + realm + ". " + objective + ": " + objectiveTotal +
                ". Score: " + Score(score, culture ?? CultureInfo.CurrentCulture) + ". " +
                streak.ToString(CultureInfo.InvariantCulture) + " day streak.";
        }

        private static string Score(ulong value, CultureInfo culture)
        {
            // Mono and Intl ship different locale tables. Apply the generated
            // grouping data only to the number, preserving player/content text
            // and the caller's shared CultureInfo. Other locales use platform data.
            if (!ShareNumberFormats.TryGet(culture.Name, out var policy)) return value.ToString("N0", culture);
            if (value < policy.MinimumGroupedValue) return value.ToString(CultureInfo.InvariantCulture);
            var format = (NumberFormatInfo)culture.NumberFormat.Clone();
            format.NumberGroupSeparator = policy.Separator;
            format.NumberGroupSizes = policy.GroupSizes;
            return value.ToString("N0", format);
        }
    }
}
