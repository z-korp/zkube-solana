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
            if (product == null || mode == null || player == null || guardian == null ||
                realm == null || objective == null) throw new ArgumentNullException("Result is incomplete");
            var format = culture ?? CultureInfo.CurrentCulture;
            return product + " · " + mode + "\n" + player + " faced " + guardian + " in " + realm + ". " +
                objective + ": " + objectiveTotal.ToString("N0", format) + ". Score: " +
                score.ToString("N0", format) + "." + (streak.HasValue ? " " + streak.Value.ToString(CultureInfo.InvariantCulture) + " day streak." : "");
        }
    }
}
