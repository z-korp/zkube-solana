using ZKube.Core.Generated;
using System;
using System.Globalization;

namespace ZKube.Presentation
{
    public static class ResultShareText
    {
        public static string Build(string product, string mode, string player, string guardian,
            string realm, string objective, ulong objectiveTotal, ulong score, ulong? streak,
            CultureInfo culture = null)
        {
            if (product == null || mode == null || guardian == null ||
                realm == null || objective == null) throw new ArgumentNullException("Result is incomplete");
            var format = culture ?? CultureInfo.CurrentCulture;
            // The figures keep the caller's platform formatting; the sentence is the language's own.
            string total = objectiveTotal.ToString("N0", format), points = score.ToString("N0", format);
            string text = string.IsNullOrEmpty(player) ? Words.ShareDaily(product, mode, guardian, realm, objective, total, points)
                : Words.ShareDailyPlayer(product, mode, player, guardian, realm, objective, total, points);
            return streak.HasValue ? Words.ShareWithStreak(text, Words.ShareStreak((long)streak.Value)) : text;
        }
    }
}
