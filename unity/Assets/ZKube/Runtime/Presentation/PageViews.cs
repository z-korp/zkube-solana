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
        private static readonly AppPage[] tabs = { AppPage.Campaign, AppPage.Daily, AppPage.Profile, AppPage.Settings };
        private IAppPageSource source;
        private PageShell shell;
        private PageCatalog catalog;
        private string dailyTab, brand;
        private float textScale;
        private Func<float> density;
        private PageActions actions;
        private SkinUi ui;
        private PageColumn column;
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
        private string editedName, savedName;
        private bool reducedMotion;
        private byte shownRealm;
        public AppPage? Shown { get; private set; }

        // brandName names the product's wordmark: "realms" or "arena".
        public void Initialize(IAppPageSource pageSource, PageShell pageShell, string dailyTabName, string brandName, float scale,
            Func<float> displayDensity = null)
        {
            source = pageSource ?? throw new ArgumentNullException(nameof(pageSource));
            shell = pageShell ?? throw new ArgumentNullException(nameof(pageShell));
            dailyTab = dailyTabName; brand = brandName ?? throw new ArgumentNullException(nameof(brandName));
            textScale = BoardController.SupportedTextScale(scale);
            density = displayDensity ?? BoardController.ReadDisplayDensity;
            if (actions == null) actions = new PageActions(source.Report);
            if (catalog == null) catalog = PageCatalog.Load();
        }

        public void Render(AppPage page, IEnumerable<string> notices = null)
        {
            shownNotices = notices?.ToArray();
            if (shell.Artwork == null) throw new InvalidOperationException("Load the page realm before drawing it");
            Retire();
            bool entering = Shown != page;
            reducedMotion = source.SettingsPage().ReducedMotion;
            if (page == AppPage.Settings && entering) { lastMusic = AudioPolicy.ToggleOnLevel; lastEffects = AudioPolicy.ToggleOnLevel; }
            if (page != AppPage.Profile) { editedName = null; savedName = null; editingName = false; }
            Shown = page; shownPanel = null;
            // The previous kit stays with the page drawn from it; the shell releases it.
            ui = new SkinUi(shell.Artwork, Mathf.Max(.5f, density()), textScale);
            var messages = (notices ?? Enumerable.Empty<string>()).Where(value => !string.IsNullOrEmpty(value)).ToArray();
            float kept = entering ? -1 : shell.Offset;
            switch (page)
            {
                case AppPage.Daily:
                    var daily = source.DailyPage();
                    Frame(1, null, null, null, null, daily.Arcade != null ? messages : Array.Empty<string>()); Home(daily, messages); break;
                case AppPage.Campaign:
                    var campaign = source.CampaignView(); var realm = catalog.Realm(campaign.Realm);
                    // Another realm is another page: it opens at its own start.
                    if (campaign.Realm != shownRealm) kept = -1;
                    shownRealm = campaign.Realm;
                    if (campaign.Locked != null) Frame(0, realm.realmName, "Realm " + campaign.Realm + " of " + Protocol.Realms.Length, campaign.Previous, null,
                        Array.Empty<string>());
                    else Frame(0, null, null, null, null, Array.Empty<string>(), fullBleed: true);
                    Campaign(campaign, messages); break;
                case AppPage.Level:
                    var level = source.LevelPage();
                    Frame(-1, null, null, null, null, Array.Empty<string>(), fullBleed: true);
                    back = level.Back;
                    LevelScreen(level, messages); break;
                case AppPage.Profile:
                    var profile = source.ProfilePage();
                    Frame(2, null, null, null, null, Array.Empty<string>()); Profile(profile, messages); break;
                case AppPage.Settings:
                    var settings = source.SettingsPage();
                    Frame(3, null, null, null, null, Array.Empty<string>());
                    Settings(settings, messages); break;
                case AppPage.Result:
                    var result = source.ResultPage();
                    if (result.HasResult && result.ShowStars) { Frame(-1, null, null, null, null, messages, fullBleed: true); back = result.Done; CampaignScreen(result); }
                    else if (result.HasResult) { Frame(-1, null, null, null, null, messages, fullBleed: true); back = result.Done; DailyResultScreen(result); }
                    else { Frame(1, result.Mode, null, null, null, messages); NoResult(result); }
                    break;
                default: throw new ArgumentOutOfRangeException(nameof(page));
            }
            FinishPage();
            if (kept >= 0) shell.Offset = kept;
            if (entering) shell.Enter(source.SettingsPage().ReducedMotion, ui.Density);
        }
        // A page that fits its body does not scroll; one that overflows scrolls
        // to its last piece and a little past it, clear of the fade.
        private void FinishPage()
        {
            float bottom = SkinUi.ScreenRect(shell.Viewport).yMin;
            shell.Finish(column.Top >= bottom - .5f ? Mathf.Max(column.Top, bottom) : column.Top - (16 + FadeDp) * ui.Density);
        }

        private string[] shownNotices;
        // Draws the shown page again in place, for a change only the page holds.
        private void Redraw()
        {
            if (Shown.HasValue) Render(Shown.Value, shownNotices);
            else if (shownPanel != null) RenderPanel(shownPanel, shownNotices);
        }

        // Removes the drawn page, so the next page enters without a page to leave.
        public void Hide() { Retire(); Shown = null; shownPanel = null; shell.Clear(shell.SafeArea); }

        // A page that could not load its realm art has no skin kit to draw with.
        public void Unavailable(string title, string message, PageAction retry)
        {
            Retire(); Shown = null; shownPanel = null;
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

        // Body frame, title and tab bar for one page. The tab bar sits inside the
        // side gutters and above the bottom safe inset; the body scrolls between
        // the safe top and the top of the tab bar. A titled page carries its title
        // on the screens' title plate at the top of its body, with its left and
        // right tablets beside it; they scroll with it. A full-bleed page (the map,
        // the preview and the results) runs under the tab bar and draws its own.
        private void Frame(int tab, string title, string subtitle, PageAction left, PageAction right, string[] notices,
            bool fullBleed = false, string leftIcon = SkinSlots.IconBack)
        {
            var safe = shell.SafeArea; float d = ui.Density;
            selectedTab = tab;
            float icon = IconDp * d;
            tabBar = ScreenKit.TabRect(ui, shell.ScreenArea, safe);
            float bottom = tab >= 0 ? tabBar.yMax : safe.y;
            var screen = shell.ScreenArea;
            var body = fullBleed ? screen : new Rect(safe.x, bottom, safe.width, safe.yMax - bottom);
            // Scrolling content fades out over its last 24 dp at the tab bar.
            shell.Clear(body, fullBleed ? 0 : FadeDp * d); shell.Hold(ui.Dispose);
            shell.Backdrop(ui.Art.SkinRealm(SkinSlots.Background));
            // Utility tablets (.x3) sit 4 dp under the top safe inset, 12u in
            // from the edges. An action that cannot be taken is not drawn.
            var kit = new ScreenKit(ui, null, shell.ScreenArea, safe);
            icon = kit.Touch(40);
            float iconY = safe.yMax - 4 * d - icon;
            back = left;
            var parent = fullBleed ? shell.Overlay : shell.Page;
            if (left != null && left.Enabled) HeaderButton(left, new Rect(safe.x + 12 * kit.U, iconY, icon, icon), leftIcon, false, parent);
            if (right != null && right.Enabled) HeaderButton(right, new Rect(safe.xMax - 12 * kit.U - icon, iconY, icon, icon), SkinSlots.IconBack, true, parent);
            if (tab >= 0) TabBar(safe, tab);
            float width = Mathf.Min(body.width - 2 * GutterDp * d, ColumnDp * d);
            column = new PageColumn(ui, shell.Page, actions, body.center.x - width / 2, width, body.yMax - 4 * d);
            if ((title ?? subtitle) != null)
            {
                // The plate keeps clear of the tablets on both sides.
                var plate = Kit.Title(title ?? subtitle, title == null ? null : subtitle, room: TitleRoom(kit));
                plate.Draw(new Rect(column.Left, safe.yMax - plate.Height, column.Width, plate.Height));
                column.Top = safe.yMax - plate.Height - 10 * kit.U;
            }
            foreach (var notice in notices) column.Note("Notice", notice);
        }
        // A title's room between the corner tablets.
        private float TitleRoom(ScreenKit kit) => shell.SafeArea.width - 2 * (12 * kit.U + kit.Touch(40) + 8 * ui.Density);
        private void HeaderButton(PageAction action, Rect rect, string icon, bool mirrored, Transform parent = null)
        {
            var button = ui.IconButton(action.Name ?? action.Label, rect, icon, actions.Click(action), parent ?? shell.Overlay, false, out var glyph, out _);
            if (mirrored)
            {
                var glyphRect = glyph.rectTransform;
                glyphRect.pivot = new Vector2(.5f, .5f); glyphRect.anchoredPosition += glyphRect.sizeDelta / 2;
                glyphRect.localScale = new Vector3(-1, 1, 1);
            }
            actions.Bind(button, action);
        }
        // The kit tab bar; each tab is bound to its page action so it dims while
        // navigation is unavailable.
        private void TabBar(Rect safe, int selected)
        {
            var icons = new[] { SkinSlots.IconCampaign, SkinSlots.IconDaily, SkinSlots.IconProfile, SkinSlots.IconSettings };
            var bound = tabs.Select(target => new PageAction { Label = target == AppPage.Daily ? dailyTab : target.ToString(),
                Name = target == AppPage.Daily ? dailyTab : target.ToString(), CanInvoke = () => source.CanNavigate(target), Invoke = () => source.Navigate(target) }).ToArray();
            var bar = ui.TabBar("Tab bar", tabBar, new ScreenKit(ui, null, shell.ScreenArea, safe).U, bound.Select((action, i) => (icons[i], action.Label, actions.Click(action))).ToArray(), selected, shell.Chrome);
            var buttons = bar.GetComponentsInChildren<Button>();
            for (int i = 0; i < buttons.Length; i++) actions.Bind(buttons[i], bound[i], fade: false);
        }
        // Home, as the wireframe draws it: the product's painted lockup over the
        // painting, today's Daily card right under it with Play today inside it,
        // then the Campaign card with its level's button inside it, over the tab
        // bar. Once today's attempt is used, the Daily card counts to the next
        // Daily and its action opens the result. The Arena draws its Arcade
        // instead.
        private void Home(DailyPageView value, string[] notices)
        {
            if (value.Arcade != null) { ArcadeHome(value, notices); return; }
            var kit = Kit; float u = kit.U;
            var realm = catalog.Realm(value.Realm);
            if (value.Now != null) { countdownView = value; countdownSecond = value.Now(); }
            bool used = value.NextOpensAt > 0 && value.Now != null;
            long? clock = used ? value.NextOpensAt - countdownSecond : value.ClosesAt > 0 && value.Now != null ? value.ClosesAt - countdownSecond : (long?)null;
            var pieces = new List<Piece> { Lockup(kit, 94), DailyCard(kit, value, realm.guardianName, clock, used, Array.Empty<Piece>(),
                Buttons(kit.Inside(), value.Actions.Select((action, i) => (action, i == 0 ? ScreenKit.Kind.Primary : ScreenKit.Kind.Quiet,
                    i == 0 ? SkinSlots.IconPlay : (string)null)).ToArray())) };
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
                pieces.Add(kit.Card("Campaign · ten realms of ten levels", new[] {
                    PortraitRow(inside, "Campaign", Step(60, 48), image => Portrait(summary.Realm, image), campaign.realmName, "Realm " + summary.Realm + " of " + Protocol.Realms.Length + (level == null ? "" : " · Level " + level), null, count),
                    Buttons(inside, (play, ScreenKit.Kind.Quiet, play == summary.Map ? SkinSlots.IconMap : SkinSlots.IconPlay)) }, "Campaign card"));
            }
            foreach (var notice in notices) pieces.Add(kit.Note(notice));
            pieces.Add(Piece.Grow);
            Compose(pieces.ToArray());
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
        // Today's Daily card: the guardian's portrait beside its name and the
        // objective, then the objective's pictogram and the clock chip; once the
        // attempt is used, that and the count to the next Daily. rows follow
        // (the Arena's prize pool), then the card's buttons.
        private Piece DailyCard(ScreenKit kit, DailyPageView value, string title, long? clock, bool used, Piece[] rows, Piece buttons)
        {
            float u = kit.U; var inside = kit.Inside();
            var under = new List<ScreenKit.Side>();
            if (used) under.Add(inside.Word("Daily used", "Today’s attempt is used", inside.CaptionDp, SkinTokens.Text));
            else if (value.ObjectiveKind != 0)
            {
                var goal = catalog.Goal(value.ObjectiveKind, value.ObjectiveValue);
                under.Add(inside.Pictogram("Daily objective", goal.Pictogram(RealmBonus(value.Realm)), goal.chip, value.Arcade == null ? 26 : 24));
            }
            if (clock.HasValue)
            {
                // The chip holds the widest the clock can read; the page's clock updates its words.
                string shown = used ? NextDaily(clock.Value) : DayClock(clock.Value), widest = System.Text.RegularExpressions.Regex.Replace(shown, "[0-9]", "8");
                var chip = used ? inside.Chip("Next Daily", SkinSlots.IconClock, 18, null, widest) : inside.Chip("Daily countdown", SkinSlots.IconClock, 18, widest, "left");
                under.Add(new ScreenKit.Side(chip.Width, chip.Height, rect => {
                    chip.Draw(rect);
                    var text = shell.Page.GetComponentsInChildren<TMP_Text>().Last(label => label.name == (used ? "Next Daily words" : "Daily countdown number"));
                    text.text = shown;
                    if (used) nextDaily = text; else if (value.Arcade?.Headline == null) countdown = text;
                }));
            }
            if (value.Arcade?.Headline != null) under.Add(inside.Word("Daily headline", value.Arcade.Headline, inside.SmallDp, SkinTokens.Text));
            // The day's own guardian, whatever realm the page's art is from. Its
            // line's parts sit side by side where they fit beside the portrait,
            // else one under another.
            float face = (value.Arcade == null ? Step(76, 60) : Step(72, 56)) * inside.U, room = inside.Width - face - 12 * inside.U;
            ScreenKit.Side? line = null;
            if (under.Count != 0) { line = inside.Beside(8, under.ToArray()); if (line.Value.Width > room) line = inside.Over(4, under.ToArray()); }
            var portrait = PortraitRow(inside, "Daily", face / inside.U, image => Portrait(value.Realm, image), title,
                catalog.ObjectiveName(value.ObjectiveKind, value.ObjectiveValue), line, null);
            return kit.Card("Today’s Daily", new[] { portrait }.Concat(rows).Append(buttons), "Daily card");
        }
        // The product's painted lockup in its 200u box.
        private Piece Lockup(ScreenKit kit, float heightU)
        {
            var mark = ui.Art.Sprite("common/brand__" + brand);
            float width = 200 * kit.U, height = heightU * kit.U;
            return new Piece(height, rect => {
                var wordmark = ui.Rect<Image>("Wordmark", new Rect(rect.center.x - width / 2, rect.y, width, height), shell.Page);
                wordmark.sprite = mark; wordmark.preserveAspect = true; wordmark.raycastTarget = false;
            });
        }
        // A card's first row: the portrait, 12u from the caption (a name and a
        // line), with under drawn 4u below them (the Daily's clock) and side on
        // the right (the Campaign's stars, the profile's Edit name).
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
        // The Arena's Home, as the wireframe draws it: the Arena lockup over the
        // painting, today's Daily card with the prize pool and when entries
        // close and Enter inside it, why no entry can be made when none can,
        // then the identity's blocks (the Kredit balance with Kredits and
        // Rewards, and the board rule).
        private void ArcadeHome(DailyPageView value, string[] notices)
        {
            var kit = Kit; float u = kit.U, k = kit.K;
            var arcade = value.Arcade; var realm = catalog.Realm(value.Realm);
            if (value.Now != null) { countdownView = value; countdownSecond = value.Now(); }
            long? clock = arcade.Headline == null && value.ClosesAt > 0 && value.Now != null ? value.ClosesAt - countdownSecond : (long?)null;
            var inside = kit.Inside();
            var rows = new List<Piece>();
            if (arcade.Pot != null)
                rows.Add(inside.Row("Prize pool", null, "Prize pool", arcade.Closes, inside.Value("Prize pool value", arcade.Pot, SkinTokens.Accent), false));
            var pieces = new List<Piece> { Lockup(kit, 90), DailyCard(kit, value, realm.guardianName + " · " + realm.realmName, clock, false, rows.ToArray(),
                Buttons(inside, value.Actions.Select((action, i) => (action, i == 0 ? ScreenKit.Kind.Primary : ScreenKit.Kind.Quiet,
                    i == 0 ? SkinSlots.IconPlay : (string)null)).ToArray())) };
            if (arcade.Reason != null)
            {
                pieces.Add(Line("Daily reason", arcade.Reason, arcade.Warning ? SkinTokens.Negative : SkinTokens.Text, kit));
                if (arcade.Detail != null) pieces.Add(Line("Daily reason detail", arcade.Detail, arcade.Warning ? SkinTokens.Text : SkinTokens.TextMuted, kit));
            }
            pieces.AddRange(BlockPieces(value.Blocks, kit, false));
            foreach (var notice in notices) pieces.Add(kit.Note(notice));
            pieces.Add(Piece.Grow);
            Compose(pieces.ToArray());
            ShowPortraits();
        }
        // A centred line in its own name and ink, between a screen's pieces.
        private Piece Line(string name, string text, string token, ScreenKit kit)
        {
            float size = kit.SubtitleDp, height = kit.Block(text, kit.Width, size, SkinUi.Type.Caption, ScreenKit.NoteLeading);
            return new Piece(height, rect => kit.Text(name, text, rect, size, token, SkinUi.Type.Caption, ScreenKit.NoteLeading));
        }
        // A 52 dp ruled row: the label on the left and its number on the right, in
        // the display face, as the screens' cards draw their rows.
        private Image ResultRow(PageColumn rows, string name, string label, string number, string token, float gapDp)
        {
            float d = ui.Density;
            float numberWidth = Mathf.Min(ui.TextWidth(number, 20, SkinUi.Type.Display), rows.Width / 2);
            float height = Mathf.Max(PageColumn.RowDp * d, ui.TextHeight(label, rows.Width - 44 * d - numberWidth, 15, SkinUi.Type.Caption) + 16 * d);
            var rect = rows.Take(height, gapDp);
            var row = ui.Rect<Image>(name + " row", rect, rows.Parent); row.color = Color.clear; row.raycastTarget = false;
            var rule = ui.Rect<Image>(name + " rule", new Rect(rect.x, rect.yMax, rect.width, Mathf.Max(1, d)), rows.Parent);
            rule.color = new Color(35 / 255f, 57 / 255f, 74 / 255f, 1); rule.raycastTarget = false;
            ui.Label(name + " label", label, new Rect(rect.x + 14 * d, rect.y, rect.width - 36 * d - numberWidth, rect.height), 15,
                SkinTokens.Text, row.transform, SkinUi.Type.Caption, TextAlignmentOptions.Left);
            NumberFit.Apply(ui, ui.Label(name, number, new Rect(rect.xMax - 15 * d - numberWidth, rect.y, numberWidth, rect.height), 20, token, row.transform,
                SkinUi.Type.Display, TextAlignmentOptions.Right), numberWidth, 20);
            return row;
        }
        // A number drawn on one line, fitted to its rect.
        private TMP_Text FittedNumber(string name, string number, Rect rect, float sizeDp, string token, Transform parent, TextAlignmentOptions alignment) =>
            NumberFit.Apply(ui, ui.Label(name, number, rect, sizeDp, token, parent, SkinUi.Type.Number, alignment), rect.width, sizeDp);
        // A kit pill. An icon leads the label; the screen's one primary action
        // carries the breathing halo behind it.
        private Button Pill(PageColumn card, PageAction action, bool primary, string icon, float gapDp)
        {
            var button = card.Button(action, primary, gapDp, icon);
            if (button == null || !primary) return button;
            var rect = SkinUi.ScreenRect((RectTransform)button.transform);
            var halo = ui.Glow(button.name + " halo", new Rect(rect.center.x - rect.width * .65f, rect.center.y - rect.height * .65f,
                rect.width * 1.3f, rect.height * 1.3f), SkinUi.WithAlpha(ui.Art.Token(SkinTokens.Accent), .4f), button.transform.parent, HaloSeconds);
            halo.transform.SetSiblingIndex(button.transform.GetSiblingIndex());
            return button;
        }
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
            actions?.Refresh();
            if (countdownView?.Now != null)
            {
                long now = countdownView.Now();
                if (now != countdownSecond)
                {
                    countdownSecond = now;
                    if (countdown != null) countdown.text = DayClock(countdownView.ClosesAt - now);
                    if (nextDaily != null) nextDaily.text = NextDaily(countdownView.NextOpensAt - now);
                    if (nextDailyResult != null) nextDailyResult.text = UsedLine(countdownView.NextOpensAt - now);
                }
            }
            if (back != null && Input.GetKeyDown(KeyCode.Escape) && back.Available) actions.Run(back.Invoke);
        }

        private static string NextDaily(long seconds) => "Next Daily in " + DayClock(seconds);
        // A countdown to 00:00 UTC, when the day closes and the next Daily opens:
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
            epoch++; sharing.Cancel(); sharing.Dispose(); sharing = new CancellationTokenSource();
            actions?.Clear(); pendingPortraits.Clear(); back = null; countdown = null; nextDaily = null; nextDailyResult = null; countdownView = null;
            // The portraits stay with the page that shows them; the shell releases them.
            portraits = null;
        }
        private void OnDestroy() { Retire(); ui?.Dispose(); sharing.Cancel(); sharing.Dispose(); }
    }
}
