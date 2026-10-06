using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;
using Piece = ZKube.Presentation.ScreenKit.Piece;

namespace ZKube.Presentation
{
    // Draws the shared pages into the page shell: the header, the page body and
    // the tab bar, all from the skin kit. Page data and actions only arrive
    // through IAppPageSource; the identity adapter adds its own notices.
    public sealed partial class PageViews : MonoBehaviour
    {
        public const float GutterDp = 16, ColumnDp = 480, IconDp = 48, FadeDp = 24;
        private static readonly AppPage[] tabs = { AppPage.Home, AppPage.Campaign, AppPage.Profile, AppPage.Settings };
        private IAppPageSource source;
        private PageShell shell;
        private PageCatalog catalog;
        private string homeTab, brand;
        private float textScale;
        private Func<float> density;
        private PageActions actions;
        private SkinUi ui;
        // The bottom of what the page drew, which FinishPage scrolls to.
        private float pageFoot;
        private BoardArt portraits;
        private long epoch;
        private CancellationTokenSource sharing = new CancellationTokenSource();
        private PageAction back;
        private Rect tabBar;
        private int selectedTab;
        private TMP_Text countdown, nextDaily;
        private DailyPageView countdownView;
        private long countdownSecond = -1;
        private double lastMusic = AudioPolicy.ToggleOnLevel, lastEffects = AudioPolicy.ToggleOnLevel;
        private bool reducedMotion;
        private byte shownRealm;
        public AppPage? Shown { get; private set; }
        // The menu music: it plays under every page, an identity page without
        // tabs included, at the player's music level, and stops only for a result
        // and the board.
        public AudioSource MenuMusic { get; private set; }

        // homeTabName is the Home tab's word ("Home", or the Arena's own name);
        // brandName names the product's wordmark: "realms" or "arena".
        public void Initialize(IAppPageSource pageSource, PageShell pageShell, string homeTabName, string brandName, float scale,
            Func<float> displayDensity = null)
        {
            source = pageSource ?? throw new ArgumentNullException(nameof(pageSource));
            shell = pageShell ?? throw new ArgumentNullException(nameof(pageShell));
            homeTab = homeTabName; brand = brandName ?? throw new ArgumentNullException(nameof(brandName));
            textScale = BoardController.SupportedTextScale(scale);
            density = displayDensity ?? BoardController.ReadDisplayDensity;
            if (actions == null) actions = new PageActions(source.Report);
            if (catalog == null) catalog = PageCatalog.Load();
            if (MenuMusic == null)
            {
                MenuMusic = gameObject.AddComponent<AudioSource>(); MenuMusic.playOnAwake = false; MenuMusic.loop = true;
                MenuMusic.Stop();
            }
        }
        private void Music(bool on)
        {
            var settings = source.SettingsPage();
            MenuMusic.volume = settings.Muted ? 0 : (float)settings.Music;
            if (!on) { MenuMusic.Stop(); return; }
            if (MenuMusic.clip == null) MenuMusic.clip = Resources.Load<AudioClip>(catalog.menuMusicResource)
                ?? throw new InvalidOperationException("The menu music is not imported");
            if (!MenuMusic.isPlaying) MenuMusic.Play();
        }

        public void Render(AppPage page, IEnumerable<string> notices = null)
        {
            // A result page shows a result: with none to show, the page is Home, and nothing is drawn here.
            if (page == AppPage.Result && !source.ResultPage().HasResult)
            { Shown = null; shownPanel = null; unavailable = null; source.Navigate(AppPage.Home); return; }
            shownNotices = notices?.ToArray();
            if (shell.Artwork == null) throw new InvalidOperationException("Load the page realm before drawing it");
            Retire();
            bool entering = Shown != page;
            reducedMotion = source.SettingsPage().ReducedMotion;
            if (page == AppPage.Settings && entering) { lastMusic = AudioPolicy.ToggleOnLevel; lastEffects = AudioPolicy.ToggleOnLevel; }
            Shown = page; shownPanel = null; unavailable = null;
            // The previous kit stays with the page drawn from it; the shell releases it.
            ui = new SkinUi(shell.Artwork, Mathf.Max(.5f, density()), textScale);
            var messages = (notices ?? Enumerable.Empty<string>()).Where(value => !string.IsNullOrEmpty(value)).ToArray();
            float kept = entering ? -1 : shell.Offset;
            pageNotices = messages;
            switch (page)
            {
                case AppPage.Home:
                    var daily = source.DailyPage();
                    Stage(daily.NoTabs ? (AppPage?)null : AppPage.Home, false); Home(daily); break;
                case AppPage.Campaign:
                    var campaign = source.CampaignView(); var realm = catalog.Realm(campaign.Realm);
                    // Another realm is another page: it opens at its own start.
                    if (campaign.Realm != shownRealm) kept = -1;
                    shownRealm = campaign.Realm;
                    // The open map runs under the whole screen; a realm that is not open is a page of words.
                    Stage(AppPage.Campaign, campaign.Locked == null);
                    Campaign(campaign); break;
                case AppPage.Level:
                    var level = source.LevelPage();
                    Stage(null, true);
                    LevelScreen(level); break;
                case AppPage.Profile:
                    var profile = source.ProfilePage();
                    Stage(AppPage.Profile, false); Profile(profile); break;
                case AppPage.Settings:
                    var settings = source.SettingsPage();
                    Stage(AppPage.Settings, false);
                    Settings(settings); break;
                case AppPage.Result:
                    var result = source.ResultPage();
                    if (result.HasResult && result.ShowStars) { Stage(null, true); back = result.Done; CampaignScreen(result); }
                    else if (result.HasResult) { Stage(null, true); back = result.Done; DailyResultScreen(result); }
                    else throw new InvalidOperationException("There is no result to show");
                    break;
                default: throw new ArgumentOutOfRangeException(nameof(page));
            }
            FinishPage();
            if (kept >= 0) shell.Offset = kept;
            if (entering) shell.Enter(source.SettingsPage().ReducedMotion, ui.Density);
            Music(page != AppPage.Result); Drawn();
        }
        // A page that fits its body does not scroll; one that overflows scrolls
        // to its last piece and a little past it, clear of the fade.
        private void FinishPage()
        {
            float bottom = SkinUi.ScreenRect(shell.Viewport).yMin;
            shell.Finish(pageFoot >= bottom - .5f ? Mathf.Max(pageFoot, bottom) : pageFoot - (16 + FadeDp) * ui.Density);
        }

        private string[] shownNotices;
        // Draws the shown page again in place, for a change only the page holds.
        private void Redraw()
        {
            // A result that is gone is not drawn again; its owner draws the page it is on now.
            if (Shown == AppPage.Result && !source.ResultPage().HasResult) { Shown = null; return; }
            if (Shown.HasValue) Render(Shown.Value, shownNotices);
            else if (shownPanel != null) RenderPanel(shownPanel, shownNotices);
            else unavailable?.Invoke();
        }
        // The display the shown page was laid out for. A page is absolute layout, so when the
        // screen or its safe area changes it is drawn again, here, for every identity.
        private Rect drawnScreen, drawnSafe;
        private Action unavailable;
        private void Drawn() { drawnScreen = shell.ScreenArea; drawnSafe = shell.SafeArea; }
        private bool Showing => Shown.HasValue || shownPanel != null || unavailable != null;

        // Removes the drawn page, so the next page enters without a page to leave.
        public void Hide() { Retire(); Shown = null; shownPanel = null; unavailable = null; shell.Clear(shell.SafeArea); Music(false); }
        // A board takes the screen: its music replaces the page's now, and the
        // page stays, taking no input, until the board has drawn (PageShell.HandOver).
        public void HandOver(BoardController board) { Music(false); shell.HandOver(board, Hide); }

        // A page that could not load its realm art has no skin kit to draw with.
        public void Unavailable(string title, string message, PageAction retry)
        {
            Retire(); Shown = null; shownPanel = null; unavailable = () => Unavailable(title, message, retry); Drawn();
            float d = Mathf.Max(.5f, density());
            var safe = shell.SafeArea;
            shell.Clear(safe); shell.Backdrop(null);
            var font = TMP_Settings.defaultFontAsset;
            float y = safe.yMax - 40 * d;
            foreach (var (text, size) in new[] { (title, 26f), (message, 17f) })
            {
                var label = new GameObject(text, typeof(RectTransform), typeof(TextMeshProUGUI)).GetComponent<TextMeshProUGUI>();
                label.transform.SetParent(shell.Page, false); label.font = font; label.text = text; label.fontSize = size * d * textScale;
                label.alignment = TextAlignmentOptions.Center; label.color = Color.white; label.raycastTarget = false;
                float height = label.GetPreferredValues(text, safe.width - 32 * d, float.PositiveInfinity).y + 8 * d;
                SkinUi.Place(label.rectTransform, new Rect(safe.x + 16 * d, y - height, safe.width - 32 * d, height), shell.Page);
                y -= height + 12 * d;
            }
            var face = new GameObject(retry.Label, typeof(RectTransform), typeof(Image), typeof(Button));
            face.transform.SetParent(shell.Page, false); face.GetComponent<Image>().color = new Color(.95f, .78f, .3f);
            SkinUi.Place((RectTransform)face.transform, new Rect(safe.center.x - 120 * d, y - 56 * d, 240 * d, 56 * d), shell.Page);
            var caption = new GameObject("Label", typeof(RectTransform), typeof(TextMeshProUGUI)).GetComponent<TextMeshProUGUI>();
            caption.transform.SetParent(face.transform, false); caption.font = font; caption.text = retry.Label; caption.color = Color.black;
            caption.fontSize = 18 * d * textScale; caption.alignment = TextAlignmentOptions.Center; caption.raycastTarget = false;
            caption.rectTransform.anchorMin = Vector2.zero; caption.rectTransform.anchorMax = Vector2.one; caption.rectTransform.sizeDelta = Vector2.zero;
            var button = face.GetComponent<Button>(); actions.Wire(button, retry);
            shell.Finish(y - 56 * d);
        }

        // The page's notices and errors, drawn at its bottom (DECISIONS
        // 2026-10-02): Compose sets them after the page's last spacer, so they
        // sit over its foot buttons, or over the tab bar; a page drawn without
        // the kit floats them over its foot.
        private string[] pageNotices = Array.Empty<string>();
        private ScreenKit.Piece Notices(ScreenKit kit)
        {
            var inside = kit.Inside();
            return kit.Card(null, pageNotices.Select(notice => inside.Note(notice, "Notice", SkinTokens.Text)), "Notice card");
        }
        // The stage a page is drawn on: its body between the safe top and its tab
        // bar (or the whole screen for a page that runs under it), its painting
        // and nothing else. It places no control.
        private void Stage(AppPage? page, bool fullBleed)
        {
            var safe = shell.SafeArea; float d = ui.Density;
            int tab = page.HasValue ? Array.IndexOf(tabs, page.Value) : -1;
            selectedTab = tab;
            tabBar = ScreenKit.TabRect(ui, shell.ScreenArea, safe);
            float bottom = tab >= 0 ? tabBar.yMax : safe.y;
            var screen = shell.ScreenArea;
            var body = fullBleed ? screen : new Rect(safe.x, bottom, safe.width, safe.yMax - bottom);
            // Scrolling content fades out over its last 24 dp at the tab bar.
            shell.Clear(body, fullBleed ? 0 : FadeDp * d); shell.Hold(ui.Dispose);
            shell.Backdrop(ui.Art.SkinRealm(SkinSlots.Background));
            pageFoot = body.yMax;
            back = null;
        }
        // An action as a control of the composer: bound to its availability, its
        // progress on its own button.
        private ScreenKit.Control Control(PageAction action, string icon = null) => action == null ? null : new ScreenKit.Control {
            Name = action.Name ?? action.Label, Label = action.Progress ?? action.Label, Icon = Mark(action, icon ?? action.Icon), Shorter = action.Short,
            Click = actions.Click(action),
            Made = (button, text) => {
                if (text == null) { actions.Bind(button, action, fade: button.GetComponent<Placed>().Role != ScreenKit.Role.Step); return; }
                actions.Bind(button, action, relabel: action.Progress == null ? value => text.text = value : (Action<string>)null);
                Loader(button, action);
            } };
        // A stepper's arrow: one that cannot step is still drawn, dimmed, under its own name.
        private ScreenKit.Control Arrow(PageAction action, string name) => action == null || !action.Enabled ? new ScreenKit.Control { Name = name } : Control(action);
        // A hero page's pieces (a preview, a result), its guardian and title sized against the page with its foot.
        private List<Piece> HeroBody(ScreenKit kit, List<Piece> pieces, ScreenKit.Slots slots, Func<float?, Piece> title, float guardianU)
        {
            if (kit.Foot(slots.Primary, slots.Secondary, slots.Tertiary, slots.Destructive) is Piece foot) pieces.Add(new Piece(foot.Height, null));
            else pieces.Add(new Piece(0, null));
            var body = HeroTitled(pieces, title, guardianU).ToList();
            body.RemoveAt(body.Count - 1);
            return body;
        }
        // A page, laid out by the kit's composer from its controls by role: the
        // page's notices stand over its foot and its tab bar on the bottom edge.
        // returning is where the page leads back to: no button draws it. The
        // Android back key takes it, and so does the lit tab of a page under a
        // tab's main page.
        private void Place(ScreenKit kit, ScreenKit.Slots slots, PageAction returning = null)
        {
            if (pageNotices.Length != 0)
            {
                var notices = Notices(kit);
                slots.Notices = slots.Notices.HasValue ? kit.Stack(10, slots.Notices.Value, notices) : notices;
                pageNotices = Array.Empty<string>();
            }
            if (selectedTab >= 0) slots.Tabs = _ => TabBar(shell.SafeArea, selectedTab);
            back = returning ?? back;
            pageFoot = kit.Page(slots).y;
        }
        // The room of the title of a page under another: the room its wireframe gives it, clear on both sides.
        private float TitleRoom(ScreenKit kit) => shell.SafeArea.width - 2 * (12 * kit.U + kit.Touch(40) + 8 * ui.Density);
        // The kit tab bar; each tab is bound to its page action so it dims while
        // navigation is unavailable. The lit tab is the way back (owner,
        // 2026-10-06): on a page under a tab's main page it returns there, as the
        // Android back key does; on the main page itself it does nothing.
        private void TabBar(Rect safe, int selected)
        {
            var icons = new[] { SkinSlots.IconHome, SkinSlots.IconCampaign, SkinSlots.IconProfile, SkinSlots.IconSettings };
            bool under = shownPanel != null; var returning = back;
            var bound = tabs.Select((target, i) => new PageAction { Label = target == AppPage.Home ? homeTab : target.ToString(),
                Name = target == AppPage.Home ? homeTab : target.ToString(),
                CanInvoke = () => i == selected && under && returning != null ? returning.Available : source.CanNavigate(target),
                Invoke = () => { if (i != selected) source.Navigate(target); else if (under) GoBack(); } }).ToArray();
            var bar = ui.TabBar("Tab bar", tabBar, new ScreenKit(ui, null, shell.ScreenArea, safe).U, bound.Select((action, i) => (icons[i], action.Label, actions.Click(action))).ToArray(), selected, shell.Chrome);
            var buttons = bar.GetComponentsInChildren<Button>();
            for (int i = 0; i < buttons.Length; i++) { actions.Bind(buttons[i], bound[i], fade: false); ScreenKit.As(buttons[i], ScreenKit.Role.Tab); }
        }
        // Home, as the wireframe draws it: the product's painted lockup over the
        // painting, today's Daily card right under it with Play today inside it,
        // then the Campaign card with its level's button inside it, over the tab
        // bar. Once today's attempt is used, the Daily card counts to the next
        // Daily and its action opens the result. The Arena draws its Arcade
        // instead.
        private void Home(DailyPageView value)
        {
            if (value.Arcade != null) { ArcadeHome(value); return; }
            var kit = Kit; float u = kit.U;
            var realm = catalog.Realm(value.Realm);
            if (value.Now != null) { countdownView = value; countdownSecond = value.Now(); }
            bool used = value.NextOpensAt > 0 && value.Now != null;
            long? clock = used ? value.NextOpensAt - countdownSecond : value.ClosesAt > 0 && value.Now != null ? value.ClosesAt - countdownSecond : (long?)null;
            var pieces = new List<Piece> { Lockup(kit, 94), DailyCard(kit, value, realm.guardianName, clock, used, Array.Empty<Piece>(),
                Buttons(kit.Inside(), ScreenKit.Role.CardAction, value.Actions.Select((action, i) => (action, i == 0 ? ScreenKit.Kind.Primary : ScreenKit.Kind.Quiet,
                    i == 0 ? SkinSlots.IconPlay : SkinSlots.IconTrophy)).ToArray())) };
            if (!string.IsNullOrEmpty(value.Status)) pieces.Add(kit.Note(value.Status));
            foreach (var fact in value.Facts) pieces.Add(kit.Note(fact));
            var summary = source.CampaignSummary();
            if (summary != null)
            {
                var trial = summary.Trials.Length == 0 ? null : summary.Trials[Focus(summary.Trials, 0)];
                string level = trial == null ? null : Number(summary.Realm, trial.Level);
                var play = trial != null && trial.Available
                    ? new PageAction { Label = (trial.Playing ? "Resume level " : "Play level ") + level, CanInvoke = trial.CanOpen, Invoke = trial.Open }
                    : summary.Map;
                var campaign = catalog.Realm(summary.Realm);
                var inside = kit.Inside();
                string stars = summary.Stars + "<color=#" + ColorUtility.ToHtmlStringRGB(ui.Art.Token(SkinTokens.TextMuted)) + ">/" + summary.Levels * 3 + "</color>";
                var count = inside.Beside(10, inside.Icon("Campaign stars icon", SkinSlots.StarLit, 24), inside.Value("Campaign stars", stars));
                pieces.Add(kit.Card("Campaign", new[] {
                    PortraitRow(inside, "Campaign", Step(60, 48), image => Portrait(summary.Realm, image), campaign.realmName, "Realm " + summary.Realm + " of " + Protocol.Realms.Length, null, count),
                    Buttons(inside, ScreenKit.Role.CardAction, (play, ScreenKit.Kind.Quiet, play == summary.Map ? SkinSlots.IconMap : SkinSlots.IconPlay)) }, "Campaign card"));
            }
            Place(kit, new ScreenKit.Slots { Body = pieces });
            ShowPortraits();
        }
        // The cards' guardian portraits come from their own realms, loaded once for the page.
        private readonly List<KeyValuePair<byte, Image>> pendingPortraits = new List<KeyValuePair<byte, Image>>();
        private void Portrait(byte realm, Image image) { image.enabled = false; pendingPortraits.Add(new KeyValuePair<byte, Image>(realm, image)); }
        private void ShowPortraits()
        {
            if (pendingPortraits.Count == 0) return;
            StartCoroutine(LoadPortraits(pendingPortraits.ToList(), epoch)); pendingPortraits.Clear();
        }
        // Today's Daily card: the guardian's portrait beside its name, the
        // objective's pictogram left of its caption, and the clock chip under
        // them; once the attempt is used, that and the count to the next Daily.
        // rows follow (the Arena's prize pool), then the card's buttons.
        private Piece DailyCard(ScreenKit kit, DailyPageView value, string title, long? clock, bool used, Piece[] rows, Piece buttons)
        {
            float u = kit.U; var inside = kit.Inside();
            // The day's own guardian, whatever realm the page's art is from.
            float face = (value.Arcade == null ? Step(76, 60) : Step(72, 56)) * inside.U, room = inside.Width - face - 12 * inside.U;
            string caption = catalog.ObjectiveName(value.ObjectiveKind, value.ObjectiveValue);
            ScreenKit.Side? objective = null;
            var under = new List<ScreenKit.Side>();
            if (used) under.Add(inside.Word("Daily used", "Today’s attempt is used", inside.CaptionDp, SkinTokens.Text));
            if (!used && value.ObjectiveKind != 0)
            {
                var goal = catalog.Goal(value.ObjectiveKind, value.ObjectiveValue);
                var picture = inside.Pictogram("Daily objective", goal.Pictogram(RealmBonus(value.Realm)), goal.chip, value.Arcade == null ? 26 : 24);
                // The caption takes the room beside its pictogram, on as many lines as it needs.
                float width = Mathf.Min(inside.TextWidth(caption, inside.SmallDp, SkinUi.Type.Caption) + 2, room - picture.Width - 8 * inside.U);
                float height = inside.Block(caption, width, inside.SmallDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
                string words = caption;
                objective = inside.Beside(8, picture, new ScreenKit.Side(width, height, rect => inside.Text("Daily line", words, rect, inside.SmallDp,
                    SkinTokens.TextMuted, SkinUi.Type.Caption, ScreenKit.CaptionLeading, TextAlignmentOptions.Left)));
                caption = null;
            }
            if (clock.HasValue)
            {
                // The chip holds the widest the clock can read; the page's clock updates its words.
                // The clock's digits keep one width, so "left" sits right after them whatever the time.
                clockEm = (inside.TextWidth("88", 16 * inside.K, SkinUi.Type.Display) - inside.TextWidth("8", 16 * inside.K, SkinUi.Type.Display)) /
                    (16 * inside.K * ui.Scale * ui.Density);
                string shown = used ? NextDaily(clock.Value) : Tabular(DayClock(clock.Value)), widest = System.Text.RegularExpressions.Regex.Replace(
                    used ? shown : DayClock(clock.Value), "[0-9]", "8");
                var chip = used ? inside.Chip("Next Daily", SkinSlots.IconClock, 18, null, widest) : inside.Chip("Daily countdown", SkinSlots.IconClock, 18, widest, "left");
                under.Add(new ScreenKit.Side(chip.Width, chip.Height, rect => {
                    chip.Draw(rect);
                    var text = shell.Page.GetComponentsInChildren<TMP_Text>().Last(label => label.name == (used ? "Next Daily words" : "Daily countdown number"));
                    text.richText = true; text.text = shown;
                    if (used) nextDaily = text; else if (value.Arcade?.Headline == null) countdown = text;
                }));
            }
            if (value.Arcade?.Headline != null) under.Add(inside.Word("Daily headline", value.Arcade.Headline, inside.SmallDp, SkinTokens.Text));
            // Under the name: the objective, then the clock and what else the day
            // says, side by side where they fit beside the portrait, else one
            // under another.
            ScreenKit.Side? line = null;
            if (under.Count != 0) { line = inside.Beside(8, under.ToArray()); if (line.Value.Width > room) line = inside.Over(4, under.ToArray()); }
            if (objective.HasValue) line = line.HasValue ? inside.Over(4, objective.Value, line.Value) : objective;
            var portrait = PortraitRow(inside, "Daily", face / inside.U, image => Portrait(value.Realm, image), title, caption, line, null);
            return kit.Card("Today’s Daily", new[] { portrait }.Concat(rows).Append(buttons), "Daily card");
        }
        // The product's painted lockup in its 200u box, in the colours of the
        // page's realm: on Home, the day's Daily realm.
        private Piece Lockup(ScreenKit kit, float heightU)
        {
            var mark = ui.Art.SkinRealm("wordmark-" + brand);
            float width = 200 * kit.U, height = heightU * kit.U;
            return new Piece(height, rect => {
                var wordmark = ui.Rect<Image>("Wordmark", new Rect(rect.center.x - width / 2, rect.y, width, height), shell.Page);
                wordmark.sprite = mark; wordmark.preserveAspect = true; wordmark.raycastTarget = false;
            });
        }
        // A card's first row: the portrait, 12u from the caption (a name and a
        // line), with under drawn 4u below them (the Daily's clock) and side on
        // the right (the Campaign's stars).
        private Piece PortraitRow(ScreenKit inside, string name, float portraitU, Action<Image> portrait, string title, string line, ScreenKit.Side? under,
            ScreenKit.Side? side)
        {
            float u = inside.U, face = portraitU * u, text = inside.Width - face - 12 * u - (side.HasValue ? side.Value.Width + 12 * u : 0);
            float titleHeight = inside.Block(title, text, inside.CaptionDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
            float lineHeight = inside.Block(line, text, inside.SmallDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
            float block = titleHeight + lineHeight + (under.HasValue ? 4 * u + under.Value.Height : 0);
            return new Piece(Mathf.Max(face, block), rect => {
                var image = ui.Rect<Image>(name + " guardian", new Rect(rect.x, rect.center.y - face / 2, face, face), shell.Page);
                image.preserveAspect = true; image.raycastTarget = false; portrait(image);
                float x = rect.x + face + 12 * u, y = rect.center.y + block / 2;
                inside.Text(name + " guardian name", title, new Rect(x, y - titleHeight, text, titleHeight), inside.CaptionDp, SkinTokens.Text, SkinUi.Type.Caption,
                    ScreenKit.CaptionLeading, TextAlignmentOptions.Left);
                if (line != null)
                    inside.Text(name + " line", line, new Rect(x, y - titleHeight - lineHeight, text, lineHeight), inside.SmallDp, SkinTokens.TextMuted,
                        SkinUi.Type.Caption, ScreenKit.CaptionLeading, TextAlignmentOptions.Left);
                if (under.HasValue)
                    under.Value.Draw(new Rect(x, y - block, Mathf.Min(under.Value.Width, rect.xMax - x), under.Value.Height));
                if (side.HasValue)
                    side.Value.Draw(new Rect(rect.xMax - side.Value.Width, rect.center.y - side.Value.Height / 2, side.Value.Width, side.Value.Height));
            });
        }
        // A centred line in its own name and ink, between a screen's pieces.
        private Piece Line(string name, string text, string token, ScreenKit kit)
        {
            float size = kit.SubtitleDp, height = kit.Block(text, kit.Width, size, SkinUi.Type.Caption, ScreenKit.NoteLeading);
            return new Piece(height, rect => kit.Text(name, text, rect, size, token, SkinUi.Type.Caption, ScreenKit.NoteLeading));
        }
        // The breathing halo behind a page's one primary action.
        public const float HaloSeconds = 2.4f;

        // The kit's underpaint behind centred text over the painting, sized to its ink.
        private void Shade(Rect text, float inkWidth, Transform parent)
        {
            float width = Mathf.Min(text.width, inkWidth);
            ui.Underpaint("Text shade", new Rect(text.center.x - width / 2, text.y, width, text.height), parent);
        }
        private static string Number(byte realm, byte level) => HudLayout.LevelNumber(realm, level);

        private PageAction ShareAction(ResultPageView value, string text, string label)
        {
            var action = new PageAction { Label = label, Name = "Share" };
            action.Invoke = () => Share(value, text, action, epoch);
            return action;
        }
        private static string Days(ulong days) => NumberFit.Figure(days) + (days == 1 ? " day" : " days");

        private async void Share(ResultPageView value, string text, PageAction action, long expectedEpoch)
        {
            action.Enabled = false; var token = sharing.Token;
            try
            {
                bool copied = await value.Share(text, token);
                if (copied && !token.IsCancellationRequested && expectedEpoch == epoch) action.Label = "Copied";
            }
            catch (OperationCanceledException) { }
            catch (Exception error) { if (!token.IsCancellationRequested && expectedEpoch == epoch) source.Report(error); }
            finally { if (!token.IsCancellationRequested && expectedEpoch == epoch) action.Enabled = true; }
        }

        private IEnumerator LoadPortraits(List<KeyValuePair<byte, Image>> images, long expectedEpoch)
        {
            var owned = portraits = new BoardArt(); shell.Hold(owned.Dispose);
            var request = owned.LoadPortraits();
            while (true)
            {
                bool more;
                try { more = request.MoveNext(); }
                catch (Exception error) { if (expectedEpoch == epoch) source.Report(error); yield break; }
                if (!more) break; yield return request.Current;
            }
            if (expectedEpoch != epoch) yield break;
            foreach (var pair in images)
                if (pair.Value != null) { pair.Value.sprite = owned.Sprite(catalog.Portrait(pair.Key).sprite); pair.Value.enabled = true; }
        }

        private void Update()
        {
            if (Showing && (drawnScreen != shell.ScreenArea || drawnSafe != shell.SafeArea)) Redraw();
            actions?.Refresh();
            if (countdownView?.Now != null)
            {
                long now = countdownView.Now();
                if (now != countdownSecond)
                {
                    countdownSecond = now;
                    if (countdown != null) countdown.text = Tabular(DayClock(countdownView.ClosesAt - now));
                    if (nextDaily != null) nextDaily.text = NextDaily(countdownView.NextOpensAt - now);
                    if (nextDailyResult != null) nextDailyResult.text = UsedLine(countdownView.NextOpensAt - now);
                }
            }
            if (Input.GetKeyDown(KeyCode.Escape)) GoBack();
        }
        // What the Android back key and gesture do: where the page leads back to. A page under a
        // tab's main page returns there, a decision page declines, a preview or a result goes on
        // as its foot row would; a tab's main page has nowhere to go back to.
        public bool GoBack()
        {
            if (back == null || !back.Available) return false;
            actions.Run(back.Invoke); return true;
        }
        public bool LeadsBack => back != null;

        private static string NextDaily(long seconds) => "Next Daily in " + DayClock(seconds);
        // A clock whose digits each take the widest digit's width (clockEm, in ems).
        private float clockEm;
        private string Tabular(string clock) => System.Text.RegularExpressions.Regex.Replace(clock, "[0-9]+",
            "<mspace=" + clockEm.ToString("0.###", CultureInfo.InvariantCulture) + "em>$0</mspace>");
        // A countdown to 07:00 UTC, when the day closes and the next Daily opens:
        // at most 23:59:59, even at the day's first second.
        public static string DayClock(long seconds) => Clock(HudLayout.DayCountdown(seconds));
        private static string Clock(long seconds)
        {
            seconds = Math.Max(0, seconds);
            return string.Format(CultureInfo.InvariantCulture, "{0:00}:{1:00}:{2:00}", seconds / 3600, seconds / 60 % 60, seconds % 60);
        }
        private static string Sentence(string value) => string.IsNullOrEmpty(value) ? value : char.ToUpperInvariant(value[0]) + value.Substring(1);
        private static string DayLabel(uint day) => DateTimeOffset.FromUnixTimeSeconds((long)day * 86400)
            .UtcDateTime.ToString("d MMM", CultureInfo.InvariantCulture);
        private static RectTransform Holder(string name, Rect rect, Transform parent)
        {
            var holder = new GameObject(name, typeof(RectTransform)).GetComponent<RectTransform>();
            holder.SetParent(parent, false); SkinUi.Place(holder, rect, parent); return holder;
        }
        private static Rect ScreenOf(Component component) => SkinUi.ScreenRect((RectTransform)component.transform);

        public void Retire()
        {
            pageNotices = Array.Empty<string>();
            epoch++; sharing.Cancel(); sharing.Dispose(); sharing = new CancellationTokenSource();
            actions?.Clear(); pendingPortraits.Clear(); back = null; countdown = null; nextDaily = null; nextDailyResult = null; countdownView = null;
            // The portraits stay with the page that shows them; the shell releases them.
            portraits = null;
        }
        private void OnDestroy() { Retire(); ui?.Dispose(); sharing.Cancel(); sharing.Dispose(); }
    }
}
