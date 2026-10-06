using ZKube.Core.Generated;
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
            if (kind == "score") return Words.ArenaBoardScore;
            if (!day.HasValue) return Words.ArenaBoardObjective;
            var daily = NativeEngine.Daily(day.Value);
            if (daily.Kind == 0) return Words.ArenaBoardObjective;
            string name = catalog.ObjectiveName(daily.Kind, daily.Value);
            return string.IsNullOrEmpty(name) ? Words.ArenaBoardObjective : name;
        }

        // A SOL amount is its figure with at least two decimals (0.10, 0.005) and then the Solana mark, which the
        // kit draws in the version its surface takes. Only a sentence says the word instead.
        public static string Sol(ulong lamports) => Figure(lamports) + CurrencyMark.Tag;
        public static string SolInWords(ulong lamports) => Words.FormatSol(Figure(lamports));
        private static string Figure(ulong lamports) => Words.Decimal(lamports / 1000000000m, "0.00#######");
    }
}
