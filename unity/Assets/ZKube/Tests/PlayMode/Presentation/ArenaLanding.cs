using System.Linq;
using ZKube.Core.Generated;
using ZKube.Presentation;

namespace ZKube.Tests.Presentation
{
    // The Arena's landing page as the page tests draw it: the pot, the Kredit
    // figure and today's two boards with full columns and the reader's rows.
    public static class ArenaLanding
    {
        public static ArcadeView View(string pot = "0.10" + CurrencyMark.Tag, string kredits = "3", KreditLevel level = KreditLevel.Enough, string result = "48,210",
            bool classic = false, string claims = null)
        {
            BoardColumnView Column(string name, string pictogram, string chip) => new BoardColumnView { Name = name, Pictogram = pictogram, Chip = chip,
                Rows = Enumerable.Range(1, PageViews.LandingRowsSeeker).Select(rank => new BoardRowView { Rank = rank.ToString(), Player = rank == 3 ? "mira.skr" : "7WFy…ZDRA",
                    Value = result }).ToArray(),
                Yours = new BoardRowView { Rank = "1,536", Player = "You", Value = result, Yours = true }, Open = new PageAction { Label = "Open " + name + " board" } };
            var goal = PageCatalog.Load().Goal(1, 3);
            var score = Column("Score", SkinSlots.GoalScore, null);
            return new ArcadeView { Pot = pot, Kredits = kredits, KreditLevel = level, OpenKredits = new PageAction { Label = "Kredits" }, HasBoards = true,
                Boards = classic ? new[] { score } : new[] { score, Column("Objective", goal.Pictogram(1), goal.chip) },
                Claims = claims == null ? null : new PageAction { Label = claims, Name = "Rewards to claim" } };
        }
    }
    // A page source that shows one Arena landing page and nothing else.
    public sealed class ArenaLandingSource : IAppPageSource
    {
        public DailyPageView Daily;
        // Reduced motion, as the page reads it from the settings.
        public bool Still;
        public DailyPageView DailyPage() => Daily;
        public CampaignPageView CampaignView() => throw new System.NotSupportedException();
        public CampaignSummaryView CampaignSummary() => null;
        public LevelPageView LevelPage() => throw new System.NotSupportedException();
        public ProfilePageView ProfilePage() => throw new System.NotSupportedException();
        public SettingsPageView SettingsPage() { var settings = AppPreferences.Read(() => { }); settings.ReducedMotion = Still; return settings; }
        public ResultPageView ResultPage() => throw new System.NotSupportedException();
        public bool CanNavigate(AppPage page) => true;
        public void Navigate(AppPage page) { }
        public void Report(System.Exception error) => throw error;
    }
}
