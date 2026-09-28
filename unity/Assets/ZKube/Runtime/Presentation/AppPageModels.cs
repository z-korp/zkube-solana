using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace ZKube.Presentation
{
    public enum AppPage { Daily, Campaign, Level, Profile, Settings, Result }

    public sealed class PageAction
    {
        public string Label;
        public string Name;
        public bool Enabled = true;
        public Func<bool> CanInvoke;
        public Action Invoke;
        public bool Available => Enabled && (CanInvoke?.Invoke() ?? true);
    }

    public sealed class CampaignTrialView
    {
        public byte Level, Stars;
        public bool Available, Playing;
        public Action Open;
        public Func<bool> CanOpen;
    }

    public sealed class CampaignPageView
    {
        public byte Realm;
        public int Stars;
        public string Notice, SavedRun;
        public CampaignTrialView[] Trials = Array.Empty<CampaignTrialView>();
        public PageAction Previous, Next, Resume, Purchase, Result;
    }

    // A level's three star goals as rules; the pages word each goal from its
    // catalog constraint and show its progress.
    public sealed class CampaignGoals
    {
        public uint Points;
        public byte PrimaryKind, PrimaryValue, PrimaryCount, SecondaryKind, SecondaryValue, SecondaryCount;
    }

    public sealed class LevelPageView
    {
        public byte Realm, Level, Stars;
        public uint Moves;
        public CampaignGoals Goals;
        public string Notice;
        public PageAction Play, Back;
    }

    // The realm a returning player continues in: the furthest realm the core progression opens.
    public sealed class CampaignSummaryView
    {
        public byte Realm;
        public int Stars, Cleared, Levels;
        public PageAction Open;
    }

    public sealed class DailyPageView
    {
        public uint Day;
        public byte Realm, ObjectiveKind, ObjectiveValue;
        // Unix seconds when entries close; zero when the identity has no close to show.
        public long ClosesAt;
        public Func<long> Now;
        public string Status;
        public string[] Facts = Array.Empty<string>();
        public PageAction[] Actions = Array.Empty<PageAction>();
    }

    public sealed class ProfileChoiceView
    {
        public byte Id, Realm;
        public string Name, Detail;
        public bool Available;
        public Action Select;
        public Func<bool> CanSelect;
    }

    public sealed class ProfilePageView
    {
        public string Name, Worn, Notice;
        public Action<string> ChangeName;
        public byte Realm;
        public int Stars;
        public ulong Streak, BestDailyScore;
        public string[] Facts = Array.Empty<string>();
        public ProfileChoiceView[] Emblems = Array.Empty<ProfileChoiceView>();
        public ProfileChoiceView[] Borders = Array.Empty<ProfileChoiceView>();
        public PageAction Save, Restore;
        public PageAction[] Actions = Array.Empty<PageAction>();
    }

    public sealed class SettingsPageView
    {
        public double Music, Effects;
        public bool Muted, ReducedMotion, Haptics, LargeText;
        public Action<double> SetMusic, SetEffects;
        public Action Unmute, ToggleMotion, ToggleHaptics, ToggleText;
    }

    public sealed class ResultPageView
    {
        public string ProductName, PlayerName, Mode, Notice;
        public uint Day;
        public byte Realm, ObjectiveKind, ObjectiveValue, StarSources;
        public ulong Score, ObjectiveTotal;
        public ulong? Streak;
        public bool HasResult, ShowStars, NativeSharing;
        // Campaign results: the level, how the run ended (core end reason), moves
        // left and whether it raised the level's best stars.
        public byte Level, EndReason;
        public uint MovesLeft, PrimaryProgress;
        public CampaignGoals Goals;
        public bool NewBest;
        public Func<string, CancellationToken, Task<bool>> Share;
        public PageAction Done, Retry;
    }

    public interface IAppPageSource
    {
        CampaignPageView CampaignView();
        CampaignSummaryView CampaignSummary();
        LevelPageView LevelPage();
        DailyPageView DailyPage();
        ProfilePageView ProfilePage();
        SettingsPageView SettingsPage();
        ResultPageView ResultPage();
        bool CanNavigate(AppPage page);
        void Navigate(AppPage page);
        IReadOnlyList<PageAction> IdentityNavigation { get; }
        void Report(Exception error);
    }
}
