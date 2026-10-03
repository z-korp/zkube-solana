using System;
using System.Collections.Generic;
using System.Linq;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Presentation;

namespace ZKube.Local
{
    // The Campaign both products play, over one local play record: the realm map,
    // a level's preview, its run on the board, the result and the way back. An
    // identity supplies the record, draws the page show names, plays the board
    // openBoard hands it (sending the run's end to Finished, or Left) and adds
    // only its own slots: Realms its purchase, Arena its star write, which
    // resultSaved starts once a result is durable.
    public sealed class CampaignJourney
    {
        public readonly LocalProductStore Product;
        public readonly LocalRunClient Runs;
        private readonly Action<AppPage> show;
        private readonly Action<LocalBoardActionProvider> openBoard;
        private readonly Func<bool> identityCurrent;
        private readonly Action resultSaved;
        private readonly Dictionary<string, LocalBoardActionProvider> providers = new Dictionary<string, LocalBoardActionProvider>();
        private LocalBoardActionProvider current;
        private bool unsaved;
        private byte startingStars;
        private PageCatalog pages;
        public byte Realm { get; private set; }
        public byte Level { get; private set; } = 1;
        // The finished run while its result page shows.
        public CampaignOutcome Last { get; private set; }
        // A run's accepted progress could not be saved.
        public bool Unsaved => unsaved || current?.PersistenceFailure != null;
        // The level to play is the first one, never starred: its run is guided.
        public bool FirstRun => Realm == 1 && Level == 1 && LevelStars(1, 1) == 0;

        public CampaignJourney(LocalProductStore product, LocalRunClient runs, Action<AppPage> show, Action<LocalBoardActionProvider> openBoard,
            Func<bool> identityCurrent = null, Action resultSaved = null)
        {
            Product = product ?? throw new ArgumentNullException(nameof(product));
            Runs = runs ?? throw new ArgumentNullException(nameof(runs));
            this.show = show ?? throw new ArgumentNullException(nameof(show));
            this.openBoard = openBoard ?? throw new ArgumentNullException(nameof(openBoard));
            this.identityCurrent = identityCurrent; this.resultSaved = resultSaved;
            Realm = FurthestRealm;
        }

        private CampaignProgressSummary Progress() => NativeEngine.CampaignProgress(Product.Read.Stars);
        // The furthest realm the core progression opens; a realm closed by a
        // purchase shows its lock on its page rather than being skipped.
        public byte FurthestRealm
        {
            get
            {
                var open = Progress().RealmUnlocked;
                for (int realm = open.Length; realm > 1; realm--) if (open[realm - 1] != 0) return (byte)realm;
                return 1;
            }
        }
        public byte LevelStars(byte realm, byte level) => Product.Read.Stars[(realm - 1) * Protocol.CampaignTargets.Length + level - 1];
        public int Stars(byte realm) => Product.Read.Stars.Skip((realm - 1) * Protocol.CampaignTargets.Length).Take(Protocol.CampaignTargets.Length).Sum(value => (int)value);
        public bool LevelAvailable(byte realm, byte level)
        {
            if (realm < 1 || realm > Protocol.Realms.Length || level < 1 || level > Protocol.CampaignTargets.Length) return false;
            var active = Runs.Active("campaign");
            if (active?.Realm == realm && active.Level == level) return true;
            return Runs.CampaignLock(realm) != "purchase" && Progress().LevelUnlocked[(realm - 1) * Protocol.CampaignTargets.Length + level - 1] != 0;
        }

        // The map of the realm last shown.
        public void Map() { Last = null; show(AppPage.Campaign); }
        public void SelectRealm(byte realm)
        {
            if (realm < 1 || realm > Protocol.Realms.Length) throw new ArgumentOutOfRangeException(nameof(realm));
            Realm = realm; Map();
        }
        public void Preview(byte realm, byte level)
        {
            if (!LevelAvailable(realm, level)) throw new InvalidOperationException("Clear the preceding trial first");
            Realm = realm; Level = level; Last = null; show(AppPage.Level);
        }
        public void Play()
        {
            var saved = Runs.Active("campaign");
            if (saved != null)
            {
                if (saved.Realm != Realm || saved.Level != Level)
                    throw new InvalidOperationException($"Run in progress in realm {saved.Realm}, level {saved.Level}");
                startingStars = LevelStars(Realm, Level); Open(saved); return;
            }
            if (!LevelAvailable(Realm, Level)) throw new InvalidOperationException("This trial is locked");
            startingStars = LevelStars(Realm, Level);
            Open(Runs.StartCampaign(Realm, Level).View);
        }
        public void Retry()
        {
            var last = Last ?? throw new InvalidOperationException("There is no Campaign result to retry");
            Realm = last.Realm; Level = last.Level; Play();
        }
        // The board's run ended: its result page. A run that left the board
        // without a result returns to the map.
        public void Finished(CampaignOutcome outcome)
        {
            if (outcome == null) { Left(); return; }
            outcome.PreviousStars = startingStars; startingStars = LevelStars(outcome.Realm, outcome.Level);
            Realm = outcome.Realm; Level = outcome.Level; Last = outcome; show(AppPage.Result);
        }
        public void Left() => Map();
        // Another page took over: the result it showed is let go.
        public void Forget() => Last = null;

        private void Open(LocalRunView view)
        {
            if (!providers.TryGetValue(view.RunId, out var provider))
            {
                provider = new LocalBoardActionProvider(Runs, view, null, identityCurrent,
                    () => { if (Runs.Active("campaign") == null) resultSaved?.Invoke(); });
                providers[view.RunId] = provider;
            }
            unsaved |= current?.PersistenceFailure != null; current = provider;
            openBoard(provider);
        }

        private static PageAction Action(string label, Action invoke, bool enabled = true) =>
            new PageAction { Label = label, Invoke = invoke, Enabled = enabled };
        private PageCatalog Pages => pages ?? (pages = PageCatalog.Load());
        // The map of the realm shown, without the identity's own slots.
        public CampaignPageView CampaignView()
        {
            var here = Pages.Realm(Realm); var before = Realm > 1 ? Pages.Realm((byte)(Realm - 1)) : null;
            return new CampaignPageView {
                Realm = Realm, Stars = Stars(Realm),
                Previous = Action("Previous", () => SelectRealm((byte)(Realm - 1)), Realm > 1),
                Next = Action("Next", () => SelectRealm((byte)(Realm + 1)), Realm < Protocol.Realms.Length),
                Locked = Runs.CampaignLock(Realm) == "stars" ? "Clear " + before.guardianName + "’s final trial in " + before.realmName + " to open " + here.realmName + "." : null,
                Trials = Trials(Realm)
            };
        }
        // A realm's trials, each opening its level's preview.
        private CampaignTrialView[] Trials(byte realm)
        {
            var active = Runs.Active("campaign");
            return Enumerable.Range(1, Protocol.CampaignTargets.Length).Select(index => {
                byte level = (byte)index;
                return new CampaignTrialView { Level = level, Stars = LevelStars(realm, level),
                    Available = LevelAvailable(realm, level), Playing = active?.Realm == realm && active.Level == level,
                    Open = () => Preview(realm, level) };
            }).ToArray();
        }
        public CampaignSummaryView CampaignSummary()
        {
            byte realm = FurthestRealm;
            var trials = Trials(realm);
            return new CampaignSummaryView { Realm = realm, Stars = trials.Sum(trial => (int)trial.Stars), Levels = trials.Length, Trials = trials,
                Map = Action("Explore map", () => SelectRealm(realm)) };
        }
        public LevelPageView LevelPage()
        {
            var level = Protocol.Realms.Single(value => value.MapId == Realm).Levels[Level - 1];
            return new LevelPageView { Realm = Realm, Level = Level, Stars = LevelStars(Realm, Level),
                Moves = NativeEngine.CampaignMoveBudget(Level, level.Tier),
                Goals = new CampaignGoals { Points = Protocol.CampaignTargets[Level - 1],
                    PrimaryKind = level.Primary[0], PrimaryValue = level.Primary[1], PrimaryCount = level.Primary[2],
                    SecondaryKind = level.Secondary[0], SecondaryValue = level.Secondary[1], SecondaryCount = level.Secondary[2] },
                Play = Action(Runs.Active("campaign") == null ? "Play" : "Resume run", Play),
                Back = Action("Back to map", Map) };
        }
        // The finished run's result: a kept star continues on the map, none leaves
        // for it; Retry plays the level again. Campaign results have no Share.
        public ResultPageView ResultPage(string productName, string playerName)
        {
            var outcome = Last ?? throw new InvalidOperationException("There is no Campaign result");
            return new ResultPageView { ProductName = productName, Mode = "Campaign", PlayerName = playerName,
                HasResult = true, ShowStars = true, Realm = outcome.Realm, Level = outcome.Level, Score = outcome.Score,
                StarSources = outcome.StarSources, EndReason = outcome.EndReason, MovesLeft = outcome.MovesLeft,
                PrimaryProgress = outcome.PrimaryProgress, Goals = outcome.Goals,
                NewBest = outcome.Stars > outcome.PreviousStars, NextOpen = outcome.PreviousStars > 0,
                Done = Action(outcome.Stars > 0 ? "Continue" : "Map", Map),
                Retry = Action("Retry", Retry) };
        }
    }
}
