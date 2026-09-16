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

    public sealed class LevelPageView
    {
        public byte Realm, Level, Stars;
        public uint Moves;
        public string Score, Primary, Secondary, Notice;
        public PageAction Play, Back;
    }

    public sealed class DailyPageView
    {
        public uint Day;
        public byte Realm, ObjectiveKind, ObjectiveValue;
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
        public Func<string, CancellationToken, Task<bool>> Share;
        public PageAction Done;
    }

    public interface IAppPageSource
    {
        CampaignPageView CampaignView();
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
