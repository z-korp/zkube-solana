using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    public enum AppPage { Daily, Campaign, Level, Profile, Settings, Result }

    public sealed class PageAction
    {
        public string Label;
        // The shorter words a pill uses when Label does not fit it on one line.
        public string Short;
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
        // Set when the realm is not open yet, in player words. The page then shows
        // the realm waiting instead of its map, with Previous as the way back or
        // Purchase and Restore as the way in. StoreProblem is set when the store
        // cannot be reached; Purchase then retries it.
        public string Locked, StoreProblem;
        public CampaignTrialView[] Trials = Array.Empty<CampaignTrialView>();
        public PageAction Previous, Next, Resume, Purchase, Restore, Result;
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
    // Home's Campaign card: the furthest open realm, its stars and its trials,
    // from which the card plays the map's current level; Map opens the realm
    // when no level there can be played (a purchase closes it).
    public sealed class CampaignSummaryView
    {
        public byte Realm;
        public int Stars, Levels;
        public CampaignTrialView[] Trials = Array.Empty<CampaignTrialView>();
        public PageAction Map;
    }

    public sealed class DailyPageView
    {
        public uint Day;
        public byte Realm, ObjectiveKind, ObjectiveValue;
        // Unix seconds when entries close; zero when the identity has no close to show.
        public long ClosesAt;
        // Set once today's play is used: Unix seconds when the next Daily opens,
        // with that run's score and objective count. The page then shows the
        // reason in place of the play action.
        public long NextOpensAt;
        public ulong Score, ObjectiveTotal;
        public Func<long> Now;
        public string Status;
        public string[] Facts = Array.Empty<string>();
        public PageAction[] Actions = Array.Empty<PageAction>();
        // Set by an identity whose Daily is entered on its own terms (the Arena
        // Arcade); the page then draws the Arcade panel instead of the Daily one.
        public ArcadeView Arcade;
        // The identity's own blocks under the Daily panel.
        public PanelBlock[] Blocks = Array.Empty<PanelBlock>();
    }

    // The Arcade's Daily panel: the prize pool beside the entry clock, and the
    // reason an entry cannot be made, which replaces the entry action.
    public sealed class ArcadeView
    {
        // The prize pool, or null when the Daily has none to show.
        public string Pot;
        // Under the headline: when entries close ("Closes 23:59 UTC").
        public string Closes;
        // In place of the countdown when entries are not open ("Entries closed").
        public string Headline;
        // Why no entry can be made now, and what still can be done; in the
        // negative ink when Warning is set.
        public string Reason, Detail;
        public bool Warning;
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
        // The realm behind the page, and the worn emblem (0 when none is worn).
        public byte Realm, Emblem;
        // The worn ladder tier, whose border rings the medallion and whose badge
        // leads the standing line under the name; absent where there is no ladder.
        public byte? Tier;
        public string Standing;
        public PageAction Records, ChooseBorder;
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
        // The identity's own settings, such as restoring purchases.
        public PanelBlock[] Identity = Array.Empty<PanelBlock>();
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
        // Whether the next level was already open before this run (it then stays
        // open without a star); null when the identity cannot tell.
        public bool? NextOpen;
        // A Daily result: the pressure tier the run finished on (null when the
        // identity keeps none), when the next Daily opens with the clock to count
        // to it, and whether it is an Arcade result, whose runs count on two boards.
        public byte? Tier;
        public long NextOpensAt;
        public Func<long> Now;
        public bool Arcade;
        public Func<string, CancellationToken, Task<bool>> Share;
        public PageAction Done, Retry;
        // The guardian's line on a Daily result: the identity's own moment (a
        // star or new-best line), or its daily greeting when unset.
        public TalkMoment? Speaks;
        public int SpeaksStars;
    }

    // An identity's own page, drawn from the kit by the shared page views: the
    // header, then blocks top-down. A page keeps its key while it redraws in
    // place; a new key is a new page and enters with the page motion.
    public sealed class PanelPageView
    {
        public string Key;
        // The tab the page belongs to (0 Campaign, 1 Daily, 2 Profile), or -1.
        public int Tab = -1;
        // Without a title the header is the product mark over the subtitle.
        public string Title, Subtitle;
        // The left tablet: Back, or on a tab page an action with its own icon.
        public PageAction Back, Corner;
        public string CornerIcon;
        public PanelBlock[] Blocks = Array.Empty<PanelBlock>();
    }

    public enum PanelKind { Talk, Title, Text, Eyebrow, Figure, Split, Row, Icon, Portrait, Button, Pair, Card }

    // One piece of an identity page. Sizes are in dp; a block's lead is the space
    // above it and its gap the space under it. Text is left-aligned inside a
    // card and centred outside one.
    public sealed class PanelBlock
    {
        public PanelKind Kind;
        // Sprite and Badge are kit slots; a portrait shows Emblem in its Ring.
        public string Name, Copy, Value, Caption, Token, Tag, TagToken, Sprite, Badge, Ring, Mood;
        public byte Emblem;
        public float Size, Lead;
        public float? Gap;
        public bool? Centered;
        public bool Dim;
        public int Primary = -1;
        public PageAction Action;
        public PageAction[] Actions = Array.Empty<PageAction>();
        public PanelBlock[] Lines = Array.Empty<PanelBlock>();

        // The page realm's guardian says a line on its rail; lead is the space above.
        public static PanelBlock Talk(string line, string mood, float lead = 209) =>
            new PanelBlock { Kind = PanelKind.Talk, Name = "Talk", Copy = line, Mood = mood, Lead = lead };
        // A title, with an optional tag on the right of its line.
        public static PanelBlock Title(string text, float size = 25, string token = SkinTokens.Text, float? gap = null, bool? centered = null,
            string tag = null, string tagToken = SkinTokens.Positive, string name = null) =>
            new PanelBlock { Kind = PanelKind.Title, Name = name ?? text, Copy = text, Size = size, Token = token, Gap = gap, Centered = centered,
                Tag = tag, TagToken = tagToken };
        public static PanelBlock Text(string name, string text, float size = 16, string token = SkinTokens.Text, float? gap = null, bool? centered = null,
            float lead = 0) =>
            new PanelBlock { Kind = PanelKind.Text, Name = name, Copy = text, Size = size, Token = token, Gap = gap, Centered = centered, Lead = lead };
        // Small capitals over a section, with an optional tag on the right.
        public static PanelBlock Eyebrow(string text, string token = SkinTokens.Accent, string tag = null, string tagToken = SkinTokens.Positive,
            float? gap = null) =>
            new PanelBlock { Kind = PanelKind.Eyebrow, Name = text, Copy = text, Token = token, Tag = tag, TagToken = tagToken, Gap = gap };
        // A big number with its caption above and unit after, and an optional
        // sprite on its left.
        public static PanelBlock Figure(string name, string caption, string value, float size, string unit = null, string sprite = null,
            string token = SkinTokens.Accent, float? gap = null) =>
            new PanelBlock { Kind = PanelKind.Figure, Name = name, Caption = caption, Value = value, Size = size, Copy = unit, Sprite = sprite,
                Token = token, Gap = gap };
        // A captioned big number on the left and a second value on the right, a
        // title beside its badge when one is given.
        public static PanelBlock Split(string name, string caption, string value, float size, string side, string badge = null, float? gap = null) =>
            new PanelBlock { Kind = PanelKind.Split, Name = name, Caption = caption, Value = value, Size = size, Copy = side, Badge = badge, Gap = gap };
        // A kit list row, one button when it has an action. With a sprite it is a
        // choice row: the sprite (a border) and its badge lead the label.
        public static PanelBlock Row(string name, string label, string value, string token = SkinTokens.Score, PageAction action = null,
            string sprite = null, string badge = null, bool dim = false, float? gap = null) =>
            new PanelBlock { Kind = PanelKind.Row, Name = name, Copy = label, Value = value, Token = token, Action = action, Sprite = sprite,
                Badge = badge, Dim = dim, Gap = gap };
        public static PanelBlock Icon(string slot, float size, string token, float? gap = null) =>
            new PanelBlock { Kind = PanelKind.Icon, Name = slot, Sprite = slot, Size = size, Token = token, Gap = gap };
        // A medallion: an emblem (a guardian's is the page realm's portrait) in
        // the guardian ring, or in a worn ladder border.
        public static PanelBlock Portrait(byte emblem, float size, string ring = SkinSlots.GuardianFrame, float? gap = null, float lead = 0) =>
            new PanelBlock { Kind = PanelKind.Portrait, Name = "Portrait", Emblem = emblem, Ring = ring, Size = size, Gap = gap, Lead = lead };
        // A pill, led by its icon when it has one.
        public static PanelBlock Button(PageAction action, bool primary, float? gap = null, float lead = 0, string icon = null) =>
            new PanelBlock { Kind = PanelKind.Button, Action = action, Primary = primary ? 0 : -1, Gap = gap, Lead = lead, Sprite = icon };
        // Two half-width pills side by side; primary names the one with the halo.
        public static PanelBlock Pair(PageAction left, PageAction right, int primary = -1, float? gap = null) =>
            new PanelBlock { Kind = PanelKind.Pair, Actions = new[] { left, right }, Primary = primary, Gap = gap };
        public static PanelBlock Card(string name, params PanelBlock[] lines) =>
            new PanelBlock { Kind = PanelKind.Card, Name = name, Lines = lines };
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
        void Report(Exception error);
    }
}
