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
                    if (campaign.Locked != null) Frame(0, realm.realmName, "REALM " + campaign.Realm + " / " + Protocol.Realms.Length, campaign.Previous, null,
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
            shell.Finish(column.Top - (16 + FadeDp) * ui.Density);
            if (kept >= 0) shell.Offset = kept;
            if (entering) shell.Enter(source.SettingsPage().ReducedMotion, ui.Density);
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
            shell.Clear(safe); shell.Backdrop(null, 1);
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
            tabBar = ui.TabBarRect(safe);
            float bottom = tab >= 0 ? tabBar.yMax : safe.y;
            var screen = shell.ScreenArea;
            var body = fullBleed ? screen : new Rect(safe.x, bottom, safe.width, safe.yMax - bottom);
            // Scrolling content fades out over its last 24 dp at the tab bar.
            shell.Clear(body, fullBleed ? 0 : FadeDp * d); shell.Hold(ui.Dispose);
            shell.Backdrop(ui.Art.SkinRealm(SkinSlots.Background), .92f);
            // Utility tablets sit 4 dp inside the top safe inset, on the page gutters.
            // An action that cannot be taken is not drawn.
            float iconY = safe.yMax - 4 * d - icon;
            back = left;
            var parent = fullBleed ? shell.Overlay : shell.Page;
            if (left != null && left.Enabled) HeaderButton(left, new Rect(safe.x + GutterDp * d, iconY, icon, icon), leftIcon, false, parent);
            if (right != null && right.Enabled) HeaderButton(right, new Rect(safe.xMax - GutterDp * d - icon, iconY, icon, icon), SkinSlots.IconBack, true, parent);
            if (tab >= 0) TabBar(safe, tab);
            float width = Mathf.Min(body.width - 2 * GutterDp * d, ColumnDp * d);
            column = new PageColumn(ui, shell.Page, actions, body.center.x - width / 2, width, body.yMax - 4 * d);
            if ((title ?? subtitle) != null)
            {
                // The plate keeps clear of the tablets on both sides.
                var kit = Kit;
                var plate = kit.TitlePlate(title ?? subtitle, title == null ? null : subtitle, room: safe.width - 2 * (GutterDp * d + icon + 8 * d));
                plate.Draw(new Rect(column.Left, safe.yMax - 4 * d - plate.Height, column.Width, plate.Height));
                column.Top = safe.yMax - 4 * d - plate.Height - 10 * kit.U;
            }
            foreach (var notice in notices) column.Note("Notice", notice);
        }
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
            var bar = ui.TabBar("Tab bar", safe, bound.Select((action, i) => (icons[i], action.Label, actions.Click(action))).ToArray(), selected, shell.Chrome);
            var buttons = bar.GetComponentsInChildren<Button>();
            for (int i = 0; i < buttons.Length; i++) actions.Bind(buttons[i], bound[i], fade: false);
        }
        // Home, as the v3 composite draws it: the product's painted lockup over
        // the painting, today's Daily card and the Campaign card, then Play today
        // with the Campaign's current level beside it, over the tab bar. Once
        // today's attempt is used, the Daily card counts to the next Daily and
        // its action opens the result. The Arena draws its Arcade instead.
        private void Home(DailyPageView value, string[] notices)
        {
            if (value.Arcade != null) { ArcadeHome(value, notices); return; }
            var kit = Kit; float u = kit.U;
            var realm = catalog.Realm(value.Realm);
            if (value.Now != null) { countdownView = value; countdownSecond = value.Now(); }
            bool used = value.NextOpensAt > 0 && value.Now != null;
            string clock = used ? NextDaily(value.NextOpensAt - countdownSecond)
                : value.ClosesAt > 0 && value.Now != null ? Remaining(value.ClosesAt - countdownSecond) : null;
            var pieces = new List<Piece> { Lockup(kit), Piece.Grow, DailyCard(kit, value, realm.guardianName, clock, used, 0, null) };
            foreach (var notice in notices) pieces.Add(kit.Note(notice));
            if (!string.IsNullOrEmpty(value.Status)) pieces.Add(kit.Note(value.Status));
            foreach (var fact in value.Facts) pieces.Add(kit.Note(fact));
            PageAction play = null;
            var summary = source.CampaignSummary();
            if (summary != null)
            {
                var trial = summary.Trials.Length == 0 ? null : summary.Trials[Focus(summary.Trials, 0)];
                string level = trial == null ? null : Number(summary.Realm, trial.Level);
                play = trial != null && trial.Available
                    ? new PageAction { Label = (trial.Playing ? "Resume level " : "Play level ") + level, CanInvoke = trial.CanOpen, Invoke = trial.Open }
                    : summary.Map;
                var campaign = catalog.Realm(summary.Realm);
                string stars = summary.Stars + "<color=#" + ColorUtility.ToHtmlStringRGB(ui.Art.Token(SkinTokens.TextMuted)) + ">/" + summary.Levels * 3 + "</color>";
                float starsWidth = kit.NumeralWidth(summary.Stars + "/" + summary.Levels * 3), side = 24 * u + 8 * u + starsWidth;
                pieces.Add(HomeCard(kit, "Campaign", "CAMPAIGN · TEN REALMS OF TEN LEVELS", Step(60, 48), image => {
                        image.enabled = false;
                        StartCoroutine(LoadPortraits(new List<KeyValuePair<byte, Image>> { new KeyValuePair<byte, Image>(summary.Realm, image) }, epoch));
                    }, campaign.realmName, "Realm " + summary.Realm + " of " + Protocol.Realms.Length + (level == null ? "" : " · Level " + level), 0, null,
                    side, rect => {
                        ui.Piece("Campaign stars icon", SkinSlots.IconCampaign, new Rect(rect.x, rect.center.y - 12 * u, 24 * u, 24 * u), shell.Page);
                        kit.Numeral("Campaign stars", stars, new Rect(rect.xMax - starsWidth, rect.y, starsWidth, rect.height));
                    }));
            }
            pieces.Add(Buttons((value.Actions.FirstOrDefault(), true, SkinSlots.IconPlay), (play, false, play == summary?.Map ? SkinSlots.IconMap : SkinSlots.IconPlay)));
            Compose(pieces.ToArray());
        }
        // Today's Daily card: the guardian, its name, the objective and, beside the
        // objective's pictogram, the time left; once the attempt is used, the count
        // to the next Daily. footer draws under the row (the Arena's prize pool).
        private Piece DailyCard(ScreenKit kit, DailyPageView value, string title, string clock, bool used, float footerHeight, Action<Rect> footer)
        {
            float u = kit.U, k = kit.K;
            float chipDp = Mathf.Max(13, 15 * k), chipHeight = 30 * u;
            // The chip holds the widest the clock can read.
            float chipWidth = clock == null ? 0 : 18 * u + 6 * u + ui.TextWidth(System.Text.RegularExpressions.Regex.Replace(clock, "[0-9]", "8"), chipDp,
                SkinUi.Type.Display) + 22 * u;
            float usedHeight = used ? ui.TextHeight("Today’s attempt is used", kit.Inner, Mathf.Max(13, 15 * k), SkinUi.Type.Caption) + 4 * u : 0;
            return HomeCard(kit, "Daily", "TODAY’S DAILY", Step(76, 60), image => image.sprite = ui.Art.Sprite("boss__portrait"), title,
                catalog.ObjectiveName(value.ObjectiveKind, value.ObjectiveValue), clock == null ? 0 : usedHeight + chipHeight, rect => {
                    float x = rect.x;
                    if (used)
                        ui.Label("Daily used", "Today’s attempt is used", new Rect(rect.x, rect.yMax - usedHeight, rect.width, usedHeight),
                            Mathf.Max(13, 15 * k), SkinTokens.Text, shell.Page, SkinUi.Type.Caption, TextAlignmentOptions.Left);
                    else if (value.ObjectiveKind != 0)
                    {
                        var goal = catalog.Goal(value.ObjectiveKind, value.ObjectiveValue);
                        ui.Piece("Daily objective pictogram", goal.Pictogram(RealmBonus(value.Realm)), new Rect(x, rect.y + 2 * u, 26 * u, 26 * u), shell.Page);
                        // The goal's sign sits on the picture's lower left, as on the HUD.
                        if (!string.IsNullOrEmpty(goal.chip))
                        {
                            float signDp = Mathf.Max(9, 11 * k), sign = ui.TextHeight(goal.chip, 40 * u, signDp, SkinUi.Type.Display);
                            ui.Label("Daily objective chip", goal.chip, new Rect(x - 4 * u, rect.y - 2 * u, 22 * u, sign), signDp, SkinTokens.Text, shell.Page,
                                SkinUi.Type.Display).textWrappingMode = TextWrappingModes.NoWrap;
                        }
                        x += 34 * u;
                    }
                    var chip = new Rect(x, rect.y, Mathf.Min(chipWidth, rect.xMax - x), chipHeight);
                    ui.Pill("Daily clock chip", chip, shell.Page, new Color(11 / 255f, 20 / 255f, 28 / 255f, 1));
                    ui.Piece("Daily clock icon", SkinSlots.IconClock, new Rect(chip.x + 10 * u, chip.center.y - 9 * u, 18 * u, 18 * u), shell.Page);
                    var text = ui.Label(used ? "Next Daily" : "Daily countdown", clock, new Rect(chip.x + 34 * u, chip.y, chip.width - 40 * u, chip.height),
                        chipDp, SkinTokens.Text, shell.Page, SkinUi.Type.Display, TextAlignmentOptions.Left);
                    text.textWrappingMode = TextWrappingModes.NoWrap;
                    if (used) nextDaily = text; else if (value.Arcade?.Headline == null) countdown = text;
                }, 0, null, footerHeight, footer);
        }
        // The product's painted lockup, 200u wide.
        private Piece Lockup(ScreenKit kit)
        {
            var mark = ui.Art.Sprite("common/brand__" + brand);
            float width = 200 * kit.U, height = width * mark.rect.height / mark.rect.width;
            return new Piece(height, rect => {
                var wordmark = ui.Rect<Image>("Wordmark", new Rect(rect.center.x - width / 2, rect.y, width, height), shell.Page);
                wordmark.sprite = mark; wordmark.preserveAspect = true; wordmark.raycastTarget = false;
            });
        }
        // A Home card: its heading in capitals, then the guardian's portrait
        // beside a name and a line; under draws below the line (the Daily's
        // clock), side on the right (the Campaign's stars).
        private Piece HomeCard(ScreenKit kit, string name, string heading, float portraitU, Action<Image> portrait, string title, string line,
            float underHeight, Action<Rect> under, float sideWidth, Action<Rect> side, float footerHeight = 0, Action<Rect> footer = null)
        {
            float u = kit.U, k = kit.K, headingDp = Mathf.Max(11, 12 * k), titleDp = Mathf.Max(15, 17 * k), lineDp = Mathf.Max(12, 14 * k);
            float face = portraitU * u, text = kit.Inner - face - 12 * u - (side == null ? 0 : sideWidth + 10 * u);
            float headingHeight = ui.TextHeight(heading, kit.Inner, headingDp, SkinUi.Type.Label);
            float titleHeight = ui.TextHeight(title, text, titleDp, SkinUi.Type.Caption), lineHeight = ui.TextHeight(line, text, lineDp, SkinUi.Type.Caption);
            float block = titleHeight + lineHeight + (underHeight > 0 ? 6 * u + underHeight : 0), row = Mathf.Max(face, block);
            float foot = footer == null ? 0 : footerHeight + 8 * u;
            return kit.Card(10 * u + headingHeight + 8 * u + row + foot + 12 * u, card => {
                float x = card.x + 12 * u, top = card.yMax - 10 * u;
                ui.Label(name + " heading", heading, new Rect(x, top - headingHeight, kit.Inner, headingHeight), headingDp, SkinTokens.Text, shell.Page,
                    SkinUi.Type.Label, TextAlignmentOptions.Left);
                float rowTop = top - headingHeight - 8 * u, middle = rowTop - row / 2;
                var image = ui.Rect<Image>(name + " guardian", new Rect(x, middle - face / 2, face, face), shell.Page);
                image.preserveAspect = true; image.raycastTarget = false; portrait(image);
                float tx = x + face + 12 * u, y = middle + block / 2;
                ui.Label(name + " guardian name", title, new Rect(tx, y - titleHeight, text, titleHeight), titleDp, SkinTokens.Text, shell.Page,
                    SkinUi.Type.Caption, TextAlignmentOptions.Left);
                ui.Label(name + " line", line, new Rect(tx, y - titleHeight - lineHeight, text, lineHeight), lineDp, SkinTokens.TextMuted, shell.Page,
                    SkinUi.Type.Caption, TextAlignmentOptions.Left);
                if (under != null) under(new Rect(tx, y - block, card.xMax - 12 * u - tx, underHeight));
                if (side != null) side(new Rect(card.xMax - 12 * u - sideWidth, middle - face / 2, sideWidth, face));
                if (footer != null)
                {
                    var foot = new Rect(x, card.y + 12 * u, kit.Inner, footerHeight);
                    kit.Rule(name + " footer rule", new Rect(foot.x, foot.y, foot.width, foot.height + 4 * u));
                    footer(foot);
                }
            }, name + " card");
        }
        // The Arena's Home, as the v3 composite draws it: the Arena lockup over the
        // painting, today's Daily card with the prize pool and when entries close,
        // why no entry can be made when none can, the identity's words (the Kredit
        // balance and the board rule), the Daily's actions, then its pill pairs
        // (Kredits and Rewards).
        private void ArcadeHome(DailyPageView value, string[] notices)
        {
            var kit = Kit; float u = kit.U, k = kit.K;
            var arcade = value.Arcade; var realm = catalog.Realm(value.Realm);
            if (value.Now != null) { countdownView = value; countdownSecond = value.Now(); }
            string clock = arcade.Headline ?? (value.ClosesAt > 0 && value.Now != null ? Remaining(value.ClosesAt - countdownSecond) : null);
            float poolDp = Mathf.Max(13, 15 * k), closesDp = Mathf.Max(11, 12 * k), potDp = 24 * k;
            float footer = arcade.Pot == null ? 0 : Mathf.Max(ui.TextHeight("Prize pool", kit.Inner, poolDp, SkinUi.Type.Caption)
                + (arcade.Closes == null ? 0 : ui.TextHeight(arcade.Closes, kit.Inner, closesDp, SkinUi.Type.Caption)), ui.TextHeight("0", kit.Inner, potDp, SkinUi.Type.Display));
            var pieces = new List<Piece> { Lockup(kit), Piece.Grow };
            foreach (var notice in notices) pieces.Add(kit.Note(notice));
            pieces.Add(DailyCard(kit, value, realm.guardianName + " · " + realm.realmName, clock, false, footer, rect => {
                float potWidth = Mathf.Min(rect.width / 2, ui.TextWidth(arcade.Pot, potDp, SkinUi.Type.Display) + 2 * u);
                float poolHeight = ui.TextHeight("Prize pool", rect.width, poolDp, SkinUi.Type.Caption);
                ui.Label("Prize pool caption", "Prize pool", new Rect(rect.x, rect.yMax - poolHeight, rect.width - potWidth, poolHeight), poolDp, SkinTokens.Text,
                    shell.Page, SkinUi.Type.Caption, TextAlignmentOptions.Left);
                if (arcade.Closes != null)
                    ui.Label("Daily closes", arcade.Closes, new Rect(rect.x, rect.y, rect.width - potWidth, rect.height - poolHeight), closesDp, SkinTokens.TextMuted,
                        shell.Page, SkinUi.Type.Caption, TextAlignmentOptions.TopLeft);
                NumberFit.Apply(ui, ui.Label("Prize pool", arcade.Pot, new Rect(rect.xMax - potWidth, rect.y, potWidth, rect.height), potDp, SkinTokens.Accent,
                    shell.Page, SkinUi.Type.Display, TextAlignmentOptions.Right), potWidth, potDp);
            }));
            if (arcade.Reason != null)
            {
                pieces.Add(Line("Daily reason", arcade.Reason, arcade.Warning ? SkinTokens.Negative : SkinTokens.Text, kit));
                if (arcade.Detail != null) pieces.Add(Line("Daily reason detail", arcade.Detail, arcade.Warning ? SkinTokens.Text : SkinTokens.TextMuted, kit));
            }
            var words = value.Blocks.Where(block => block.Kind != PanelKind.Pair).ToArray();
            var pairs = value.Blocks.Where(block => block.Kind == PanelKind.Pair).ToArray();
            if (words.Length != 0) pieces.Add(BlockPiece("Arcade words", words, kit));
            pieces.Add(Buttons(value.Actions.Select((action, i) => (action, i == 0, i == 0 ? SkinSlots.IconPlay : (string)null)).ToArray()));
            if (pairs.Length != 0) pieces.Add(BlockPiece("Arcade pills", pairs, kit));
            Compose(pieces.ToArray());
        }
        // A centred line in its own name and ink, between a screen's pieces.
        private Piece Line(string name, string text, string token, ScreenKit kit)
        {
            float size = Mathf.Max(13, 15 * kit.K), height = ui.TextHeight(text, kit.Width, size, SkinUi.Type.Caption);
            return new Piece(height, rect => ui.Label(name, text, rect, size, token, shell.Page, SkinUi.Type.Caption));
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
        private static string Days(ulong days) => days + (days == 1 ? " day" : " days");

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
                    if (countdown != null) countdown.text = Remaining(countdownView.ClosesAt - now);
                    if (nextDaily != null) nextDaily.text = NextDaily(countdownView.NextOpensAt - now);
                    if (nextDailyResult != null) nextDailyResult.text = UsedLine(countdownView.NextOpensAt - now);
                }
            }
            if (back != null && Input.GetKeyDown(KeyCode.Escape) && back.Available) actions.Run(back.Invoke);
        }

        private static string Remaining(long seconds) => DayClock(seconds) + " left";
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
            actions?.Clear(); back = null; countdown = null; nextDaily = null; nextDailyResult = null; countdownView = null;
            // The portraits stay with the page that shows them; the shell releases them.
            portraits = null;
        }
        private void OnDestroy() { Retire(); ui?.Dispose(); sharing.Cancel(); sharing.Dispose(); }
    }
}
