using System.Globalization;
using ZKube.Core;
using ZKube.Presentation;

namespace ZKube.Integration.Presentation
{
    // The player's words for the Arena's money values: the two boards' names
    // and SOL amounts.
    public static class MoneyText
    {
        // Score, and the other board by the day's objective; where no one day is
        // meant (records, claims) or the day has none (a Classic day), Objective.
        public static string Board(string kind, PageCatalog catalog, uint? day = null)
        {
            if (kind == "score") return "Score";
            if (!day.HasValue) return "Objective";
            var daily = NativeEngine.Daily(day.Value);
            if (daily.Kind == 0) return "Objective";
            string name = catalog.ObjectiveName(daily.Kind, daily.Value);
            return string.IsNullOrEmpty(name) ? "Objective" : char.ToUpperInvariant(name[0]) + name.Substring(1);
        }

        // A SOL amount with at least two decimals: 0.10 SOL, 0.005 SOL.
        public static string Sol(ulong lamports) => (lamports / 1000000000m).ToString("0.00#######", CultureInfo.InvariantCulture) + " SOL";
    }
}
