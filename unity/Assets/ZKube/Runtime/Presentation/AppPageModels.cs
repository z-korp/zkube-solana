using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    public enum AppPage { Home, Campaign, Level, Profile, Settings, Result }

    public sealed class PageAction
    {
        public string Label;
        // The shorter words a pill uses when Label does not fit it on one line.
        public string Short;
        public string Name;
        // The step of an action in progress, one word: its button shows the loader and
        // this word in place of its own, and takes no tap, until the outcome.
        public string Progress;
        // Its icon, a skin slot, set where the action is made: it travels with the action to wherever it is placed.
        public string Icon;
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
        // Set when the realm is not open yet, in player words. The page then shows
        // the realm waiting instead of its map, with Previous as the way back or
        // Purchase and Restore as the way in. StoreProblem is set when the store
        // cannot be reached; Purchase then retries it.
        public string Locked, StoreProblem;
        public CampaignTrialView[] Trials = Array.Empty<CampaignTrialView>();
        public PageAction Previous, Next, Purchase, Restore;
    }

    // A level's three star goals as rules; the pages word each goal from its
    // catalog constraint and show its progress.
    public sealed class CampaignGoals
    {
        public uint Points;
        public byte PrimaryKind, PrimaryValue, PrimaryCount, SecondaryKind, SecondaryValue, SecondaryCount;
    }

    // How a Campaign run ended, kept for its result page.
    public sealed class CampaignOutcome
    {
        public byte Realm, Level, StarSources, EndReason, PreviousStars;
        public ulong Score;
        public uint MovesLeft, PrimaryProgress;
        public CampaignGoals Goals;
        public int Stars => (StarSources & 1) + (StarSources >> 1 & 1) + (StarSources >> 2 & 1);
    }

    public sealed class LevelPageView
    {
        public byte Realm, Level, Stars;
        public uint Moves;
        public CampaignGoals Goals;
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
        // An identity with nowhere else to go yet (the Arena before an address) draws no tab bar.
        public bool NoTabs;
    }

    // The Arena's landing page: the Daily card with the prize pool, the Kredit
    // figure and the reason an entry cannot be made, then today's boards.
    public sealed class ArcadeView
    {
        // The prize pool, or null when the Daily has none to show.
        public string Pot;
        // In place of the countdown when entries are not open ("Entries closed").
        public string Headline;
        // Why no entry can be made now, and what still can be done; in the
        // negative ink when Warning is set.
        public string Reason, Detail;
        public bool Warning;
        // The confirmed Kredit balance as a figure that shows its own state and
        // opens the Kredits page; null where there is no balance to show.
        public string Kredits;
        public KreditLevel KreditLevel;
        public PageAction OpenKredits;
        // Today's boards, side by side: null while they are being read (the card
        // then holds their places), or BoardsNotice with BoardsRetry when the
        // read failed. No card at all when HasBoards is unset.
        public bool HasBoards;
        public BoardColumnView[] Boards;
        public string BoardsNotice;
        public PageAction BoardsRetry;
        // Rewards waiting to be claimed, as the badge's words ("2 to claim"); null when there are none.
        public PageAction Claims;
    }
    // How the Kredit figure reads: enough to play on, the last one, or none.
    public enum KreditLevel { Enough, Last, None }

    // One row of a board: its rank, the player, the result and, on a sealed
    // board, the payout. Yours is the reader's own row; Unofficial is a place
    // the board no longer holds, shown from the public read model. Note is a
    // few words in place of a result the row does not have.
    public sealed class BoardRowView
    {
        public string Rank, Player, Value, Payout, Note;
        public bool Yours, Unofficial;
    }
    // A board on the landing page: its pictogram (with its chip) and name, its
    // top rows, and the tap that opens it. Empty says why a board has no rows.
    // Yours is the reader's own line: their row wherever the board holds it,
    // a line saying they have no score here once they have played, or none.
    public sealed class BoardColumnView
    {
        public string Name, Pictogram, Chip, Empty;
        public BoardRowView[] Rows = Array.Empty<BoardRowView>();
        public BoardRowView Yours;
        public PageAction Open;
        // A player appears once in a column. Among the rows shown, their row is
        // lit in place and nothing is pinned; their line is pinned under the
        // rows only when it is not one of them.
        public BoardRowView Pinned(int shown) => Rows.Take(shown).Any(row => row.Yours) ? null : Yours;
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
        // The player's name (a platform account's display name or Realms'
        // fixed "Player", the Arena's Seeker ID or address), its avatar and a
        // badge shown under it (a verified Seeker); what is worn, and a notice.
        public string Name, Badge, Worn, Notice;
        public UnityEngine.Texture2D Avatar;
        // The realm behind the page, and the worn emblem (0 when none is worn).
        public byte Realm, Emblem;
        // The worn ladder tier, whose border rings the medallion, and the ladder
        // points under the name: a figure led by the badge of the tier they
        // reach, without words. Both absent where there is no ladder.
        public byte? Tier;
        public ulong? LadderPoints;
        public byte LadderTier;
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
        // The identity's own cards, such as this device's.
        public PanelBlock[] Identity = Array.Empty<PanelBlock>();
        // The identity's own actions, by role, for the foot row: restoring purchases; the last operation, and disconnecting last.
        public PageAction Tertiary, Destructive;
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
        // Leaderboard opens the platform's own leaderboard where the identity has one.
        public PageAction Done, Retry, Leaderboard;
        // The guardian's line on a Daily result: the identity's own moment (a
        // star or new-best line), or its daily greeting when unset.
        public TalkMoment? Speaks;
        public int SpeaksStars;
        // A Daily result speaks of the run itself, in both products: its finest,
        // a scoring run, or one that scored nothing.
        public void DailyOutcome(bool beatsBest)
        {
            NewBest = beatsBest && Score > 0;
            Speaks = NewBest ? TalkMoment.NewBest : TalkMoment.Win; SpeaksStars = Score > 0 ? 2 : 1;
        }
    }

    // An identity's own page, drawn from the kit by the shared page views: the
    // header, then blocks top-down. A page keeps its key while it redraws in
    // place; a new key is a new page and enters with the page motion.
    // The two icons the placement rule asks of the art (a device, a wallet) are not
    // drawn yet: until they are, these kit icons stand in for them, from this one place.
    public static class StandInIcons
    {
        public const string Device = SkinSlots.IconSettings, Wallet = SkinSlots.IconKey;
    }

    // A stepper: what it steps and that step's state, between its two arrows. An arrow
    // that cannot step is absent here and drawn dimmed, so the bar never changes shape.
    public sealed class StepperView
    {
        public string Label, State, StateToken, Mark;
        public PageAction Previous, Next;
    }

    public sealed class PanelPageView
    {
        public string Key;
        // The tab the page belongs to, or none.
        public AppPage? Tab;
        // Without a title the header is the product mark over the subtitle.
        public string Title, Subtitle;
        // The left tablet: Back, or on a tab page an action with its own icon.
        public PageAction Back, Corner;
        public string CornerIcon;
        public PanelBlock[] Blocks = Array.Empty<PanelBlock>();
        // The page's controls by role: the composer places them in the foot row and on the stepper bar.
        public PageAction Primary, Secondary, Tertiary, Destructive;
        public StepperView Stepper;
        // One line directly above the foot row: why its action waits, or what it did.
        public PanelBlock Reason;
        // The page hands its controls over by role (every page will; the flag goes with the last one that does not).
        public bool ByRole;
    }

    public enum PanelKind { Title, Text, Eyebrow, Figure, Split, Row, Icon, Portrait, Button, Pair, Bar, Card, Rows, Balance, Packs, Space }

    // One Kredit pack on its card: its picture, its count and its price on the
    // card's button. Buy is the card's tap; in progress it is the loader, and a
    // refused purchase's retry. Every pack is drawn alike: none is marked.
    public sealed class PackView
    {
        public string Name, Art, Count, Price;
        public PageAction Buy;
        public bool Dim, Refused;
    }

    // One piece of an identity page, laid out by the screen kit as the
    // wireframes lay out the Arena. Text is left-aligned inside a card and
    // centred outside one; muted words in a card are a step smaller.
    public sealed class PanelBlock
    {
        public PanelKind Kind;
        // Sprite, Badge and Pictogram are kit slots; a portrait shows Emblem in its Ring.
        public string Name, Copy, Value, Caption, Token, Tag, TagToken, Sprite, Badge, Pictogram, Chip, Ring;
        public byte Emblem;
        public bool? Centered;
        public bool Dim, ChipAtEnd;
        public int Primary = -1;
        public PageAction Action;
        public PageAction[] Actions = Array.Empty<PageAction>();
        public PanelBlock[] Lines = Array.Empty<PanelBlock>();
        public BoardRowView[] Rows = Array.Empty<BoardRowView>();
        public PackView[] Packs = Array.Empty<PackView>();

        // A title, with an optional tag on the right of its line; a card's first
        // title with a tag is its header.
        public static PanelBlock Title(string text, string token = SkinTokens.Text, bool? centered = null, string tag = null,
            string tagToken = SkinTokens.Positive, string name = null) =>
            new PanelBlock { Kind = PanelKind.Title, Name = name ?? text, Copy = text, Token = token, Centered = centered, Tag = tag, TagToken = tagToken };
        public static PanelBlock Text(string name, string text, string token = SkinTokens.Text, bool? centered = null) =>
            new PanelBlock { Kind = PanelKind.Text, Name = name, Copy = text, Token = token, Centered = centered };
        // A card's header: its capitals, with an optional tag beside them.
        public static PanelBlock Eyebrow(string text, string token = SkinTokens.Accent, string tag = null, string tagToken = SkinTokens.Positive) =>
            new PanelBlock { Kind = PanelKind.Eyebrow, Name = text, Copy = text, Token = token, Tag = tag, TagToken = tagToken };
        // A big number beside its unit over its caption, led by a sprite.
        public static PanelBlock Figure(string name, string caption, string value, string unit = null, string sprite = null, string token = SkinTokens.Accent) =>
            new PanelBlock { Kind = PanelKind.Figure, Name = name, Caption = caption, Value = value, Copy = unit, Sprite = sprite, Token = token };
        // A captioned number and a second value beside it, a title beside its
        // badge when one is given.
        public static PanelBlock Split(string name, string caption, string value, string side, string badge = null) =>
            new PanelBlock { Kind = PanelKind.Split, Name = name, Caption = caption, Value = value, Copy = side, Badge = badge };
        // A kit row: its icon (a goal's pictogram with its chip), the label and its detail, and the value on the
        // right (as a tag in tagToken when one is given), or, without a value,
        // its action's button. A row with an action and a value is one button.
        // With a sprite it is a choice row: the sprite (a border) and its badge
        // lead the label.
        public static PanelBlock Row(string name, string label, string value, string token = SkinTokens.Score, PageAction action = null,
            string sprite = null, string badge = null, bool dim = false, string detail = null, string icon = null, string tagToken = null, bool primary = false,
            string chip = null) =>
            new PanelBlock { Kind = PanelKind.Row, Name = name, Copy = label, Value = value, Token = token, Action = action, Sprite = sprite,
                Badge = badge, Dim = dim, Caption = detail, Pictogram = icon, Chip = chip, Tag = tagToken == null ? null : value, TagToken = tagToken, Primary = primary ? 0 : -1 };
        public static PanelBlock Icon(string slot, string token) =>
            new PanelBlock { Kind = PanelKind.Icon, Name = slot, Sprite = slot, Token = token };
        // A medallion: an emblem (a guardian's is the page realm's portrait) in
        // the guardian ring, or in a worn ladder border.
        public static PanelBlock Portrait(byte emblem, string ring = SkinSlots.GuardianFrame) =>
            new PanelBlock { Kind = PanelKind.Portrait, Name = "Portrait", Emblem = emblem, Ring = ring };
        // A button, led by its icon when it has one; buttons side by side share
        // a row, and the page's last primary and the buttons after it sit at its foot.
        public static PanelBlock Button(PageAction action, bool primary, string icon = null) =>
            new PanelBlock { Kind = PanelKind.Button, Action = action, Primary = primary ? 0 : -1, Sprite = icon };
        // Two buttons side by side; primary names the lit one.
        public static PanelBlock Pair(PageAction left, PageAction right, int primary = -1) =>
            new PanelBlock { Kind = PanelKind.Pair, Actions = new[] { left, right }, Primary = primary };
        // A chip (its icon, a number and words) and quiet buttons on one line,
        // the chip at the start, or at the end.
        public static PanelBlock Bar(string name, string icon, string number, string words, bool chipAtEnd, params PageAction[] actions) =>
            new PanelBlock { Kind = PanelKind.Bar, Name = name, Sprite = icon, Value = number, Copy = words, ChipAtEnd = chipAtEnd, Actions = actions };
        public static PanelBlock Card(string name, params PanelBlock[] lines) =>
            new PanelBlock { Kind = PanelKind.Card, Name = name, Lines = lines };
        // The Kredit balance as its page's hero: the coin and the figure, then
        // what it means (the entries it buys, the one unit price) or one line in
        // their place. Without a figure the loader stands for it. gained shows
        // beside a balance that just grew, counted up from what it was.
        public static PanelBlock Balance(string figure, string entries, string price, string line = null, string gained = null, string from = null) =>
            new PanelBlock { Kind = PanelKind.Balance, Name = "Kredit balance", Value = figure, Copy = entries, Tag = price, Caption = line, Badge = gained, Chip = from };
        // Room that takes its share of the page's spare height: what follows sits lower.
        public static PanelBlock Space() => new PanelBlock { Kind = PanelKind.Space, Name = "Space" };
        // The packs in a row, one size and one style; reason is the one line
        // under them (a refusal, or calm when it only waits); from is the pack
        // whose Kredits just arrived, or -1.
        public static PanelBlock PackRow(PackView[] packs, string reason = null, bool calm = false, int from = -1) =>
            new PanelBlock { Kind = PanelKind.Packs, Name = "Packs", Packs = packs, Caption = reason, Dim = calm, Primary = from };
        // A board's rows in a list that takes the page's spare height and scrolls
        // inside it. divider stands before the first unofficial row; more, when
        // set, is the list's last row; empty says why there are no rows.
        public static PanelBlock List(string name, BoardRowView[] rows, string divider = null, PageAction more = null, string empty = null) =>
            new PanelBlock { Kind = PanelKind.Rows, Name = name, Rows = rows, Caption = divider, Action = more, Copy = empty };
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
