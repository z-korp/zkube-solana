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
        private float headerBottom;
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
                    Frame(2, "Profile", null, profile.Records, null, messages, leftIcon: SkinSlots.IconTrophy); Profile(profile); break;
                case AppPage.Settings:
                    var settings = source.SettingsPage();
                    Frame(3, "Settings", null, null, null, messages);
                    Settings(settings); break;
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

        // Header, body frame and tab bar for one page. The tab bar sits inside the
        // side gutters and above the bottom safe inset; the body scrolls between the
        // header and the top of the tab bar. A full-bleed page (the map) scrolls
        // under both instead. A page without a title (Home) draws its own header
        // in the body.
        // A page with a subtitle and no title carries the product mark in the
        // title's place. The left tablet is Back unless the page names its icon.
        private void Frame(int tab, string title, string subtitle, PageAction left, PageAction right, string[] notices,
            bool fullBleed = false, string leftIcon = SkinSlots.IconBack)
        {
            var safe = shell.SafeArea; float d = ui.Density;
            selectedTab = tab;
            float icon = IconDp * d, titleWidth = TitleWidth();
            float titleHeight = title == null ? 0 : ui.TextHeight(title, titleWidth, 25, SkinUi.Type.Title);
            float subtitleHeight = subtitle == null ? 0 : ui.TextHeight(subtitle, titleWidth, 12, SkinUi.Type.Label);
            float header = Header(title, subtitle);
            tabBar = ui.TabBarRect(safe);
            float bottom = tab >= 0 ? tabBar.yMax : safe.y;
            headerBottom = safe.yMax - header;
            // A full-bleed page runs under the header and tab bar.
            var screen = shell.ScreenArea;
            var body = fullBleed ? screen :
                new Rect(safe.x, bottom, safe.width, headerBottom - bottom);
            // Scrolling content fades out over its last 24 dp at the tab bar and the header.
            shell.Clear(body, fullBleed ? 0 : FadeDp * d); shell.Hold(ui.Dispose);
            shell.Backdrop(ui.Art.SkinRealm(SkinSlots.Background), .92f);
            var chrome = shell.Overlay;
            if (title != null)
            {
                var rect = new Rect(safe.center.x - titleWidth / 2, safe.yMax - 5 * d - titleHeight, titleWidth, titleHeight);
                Shade(rect, ui.TextWidth(title, 25, SkinUi.Type.Title), chrome);
                ui.Label("Page title", title, rect, 25, SkinTokens.Text, chrome, SkinUi.Type.Title);
                ui.Piece("Page title stroke", SkinSlots.TitleRibbon, new Rect(safe.center.x - 75 * d, safe.yMax - 53 * d, 150 * d, 7 * d), chrome);
            }
            else if (subtitle != null)
            {
                // The wordmark's mark, 48 dp wide, in the title's band.
                var mark = ui.Art.Sprite(BoardArt.Mark);
                float markWidth = IconDp * d, markHeight = markWidth * mark.rect.height / mark.rect.width;
                var image = ui.Rect<Image>("Page mark", new Rect(safe.center.x - markWidth / 2, safe.yMax - 12 * d - markHeight, markWidth, markHeight), chrome);
                image.sprite = mark; image.preserveAspect = true; image.raycastTarget = false;
                ui.Piece("Page title stroke", SkinSlots.TitleRibbon, new Rect(safe.center.x - 75 * d, safe.yMax - 53 * d, 150 * d, 7 * d), chrome);
            }
            if (subtitle != null)
            {
                var rect = new Rect(safe.center.x - titleWidth / 2, safe.yMax - 59 * d - subtitleHeight, titleWidth, subtitleHeight);
                Shade(rect, ui.TextWidth(subtitle, 12, SkinUi.Type.Label), chrome);
                ui.Label("Page subtitle", subtitle, rect, 12, SkinTokens.TextMuted, chrome, SkinUi.Type.Label);
            }
            // Utility tablets sit 4 dp inside the top safe inset, on the page gutters.
            // An action that cannot be taken is not drawn.
            float iconY = safe.yMax - 4 * d - icon;
            back = left;
            if (left != null && left.Enabled) HeaderButton(left, new Rect(safe.x + GutterDp * d, iconY, icon, icon), leftIcon, false);
            if (right != null && right.Enabled) HeaderButton(right, new Rect(safe.xMax - GutterDp * d - icon, iconY, icon, icon), SkinSlots.IconBack, true);
            if (tab >= 0) TabBar(safe, tab);
            float width = Mathf.Min(body.width - 2 * GutterDp * d, ColumnDp * d);
            column = new PageColumn(ui, shell.Page, actions, body.center.x - width / 2, width, body.yMax - 4 * d);
            foreach (var notice in notices) column.Note("Notice", notice);
        }
        private float TitleWidth() => shell.SafeArea.width - 2 * (IconDp + 24) * ui.Density;
        // The inner-page header's height: the title 5 dp under the safe inset, its
        // light stroke at 46 dp and the subtitle at 59 dp.
        private float Header(string title, string subtitle)
        {
            float d = ui.Density;
            if (title == null && subtitle == null) return 0;
            float subtitleHeight = subtitle == null ? 0 : ui.TextHeight(subtitle, TitleWidth(), 12, SkinUi.Type.Label);
            return Mathf.Max((subtitle == null ? 70 : 84) * d, 59 * d + subtitleHeight + 8 * d);
        }
        private void HeaderButton(PageAction action, Rect rect, string icon, bool mirrored)
        {
            var button = ui.IconButton(action.Name ?? action.Label, rect, icon, actions.Click(action), shell.Overlay, false, out var glyph, out _);
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
            if (value.Arcade != null) { ArcadeHome(value); return; }
            var kit = Kit; float u = kit.U, k = kit.K;
            var realm = catalog.Realm(value.Realm);
            string objective = catalog.ObjectiveName(value.ObjectiveKind, value.ObjectiveValue);
            if (value.Now != null) { countdownView = value; countdownSecond = value.Now(); }
            bool used = value.NextOpensAt > 0 && value.Now != null;
            string clock = used ? NextDaily(value.NextOpensAt - countdownSecond)
                : value.ClosesAt > 0 && value.Now != null ? Remaining(value.ClosesAt - countdownSecond) : null;
            float chipDp = Mathf.Max(13, 15 * k), chipHeight = 30 * u;
            // The chip holds the widest the clock can read.
            float chipWidth = clock == null ? 0 : 18 * u + 6 * u + ui.TextWidth(System.Text.RegularExpressions.Regex.Replace(clock, "[0-9]", "8"), chipDp,
                SkinUi.Type.Display) + 22 * u;
            float usedHeight = used ? ui.TextHeight("Today’s attempt is used", kit.Inner, Mathf.Max(13, 15 * k), SkinUi.Type.Caption) + 4 * u : 0;
            var pieces = new List<Piece> { Lockup(kit), Piece.Grow,
                HomeCard(kit, "Daily", "TODAY’S DAILY", Step(76, 60), image => image.sprite = ui.Art.Sprite("boss__portrait"), realm.guardianName, objective,
                    clock == null ? 0 : usedHeight + chipHeight, rect => {
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
                        if (used) nextDaily = text; else countdown = text;
                    }, 0, null) };
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
            float underHeight, Action<Rect> under, float sideWidth, Action<Rect> side)
        {
            float u = kit.U, k = kit.K, headingDp = Mathf.Max(11, 12 * k), titleDp = Mathf.Max(15, 17 * k), lineDp = Mathf.Max(12, 14 * k);
            float face = portraitU * u, text = kit.Inner - face - 12 * u - (side == null ? 0 : sideWidth + 10 * u);
            float headingHeight = ui.TextHeight(heading, kit.Inner, headingDp, SkinUi.Type.Label);
            float titleHeight = ui.TextHeight(title, text, titleDp, SkinUi.Type.Caption), lineHeight = ui.TextHeight(line, text, lineDp, SkinUi.Type.Caption);
            float block = titleHeight + lineHeight + (underHeight > 0 ? 6 * u + underHeight : 0), row = Mathf.Max(face, block);
            return kit.Card(10 * u + headingHeight + 8 * u + row + 12 * u, card => {
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
            }, name + " card");
        }
        // The Arena's Home: its lockup over the Arcade panel and its blocks.
        private void ArcadeHome(DailyPageView value)
        {
            float d = ui.Density;
            var mark = ui.Art.Sprite("common/brand__" + brand);
            float markWidth = 180 * d, markHeight = markWidth * mark.rect.height / mark.rect.width;
            var markRect = column.Take(markHeight, 8);
            var wordmark = ui.Rect<Image>("Wordmark", new Rect(column.Left + (column.Width - markWidth) / 2, markRect.y, markWidth, markHeight), shell.Page);
            wordmark.sprite = mark; wordmark.preserveAspect = true; wordmark.raycastTarget = false;
            if (value.Now != null) { countdownView = value; countdownSecond = value.Now(); }
            Arcade(value, catalog.Realm(value.Realm), catalog.ObjectiveName(value.ObjectiveKind, value.ObjectiveValue));
            Blocks(value.Blocks);
        }
        // A 52 dp kit list row: the label on the left and its number on the right.
        private Image ResultRow(PageColumn rows, string name, string label, string number, string token, float gapDp)
        {
            float d = ui.Density;
            float numberWidth = NumberSlot(number, 18, rows.Width / 2);
            float height = Mathf.Max(PageColumn.RowDp * d, ui.TextHeight(label, rows.Width - 44 * d - numberWidth, 15, SkinUi.Type.Caption) + 16 * d);
            var rect = rows.Take(height, gapDp);
            var row = ui.Piece(name + " row", SkinSlots.ListRow, rect, rows.Parent);
            ui.Label(name + " label", label, new Rect(rect.x + 14 * d, rect.y, rect.width - 36 * d - numberWidth, rect.height), 15,
                SkinTokens.Text, rows.Parent, SkinUi.Type.Caption, TextAlignmentOptions.Left);
            FittedNumber(name, number, new Rect(rect.xMax - 15 * d - numberWidth, rect.y, numberWidth, rect.height), 18, token, rows.Parent,
                TextAlignmentOptions.Right);
            return row;
        }
        // A number's slot: its width, at most the room it is given.
        private float NumberSlot(string number, float sizeDp, float room) => Mathf.Min(ui.TextWidth(number, sizeDp, SkinUi.Type.Number), room);
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
