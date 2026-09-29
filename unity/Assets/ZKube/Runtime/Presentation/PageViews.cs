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

namespace ZKube.Presentation
{
    // Draws the shared pages into the page shell: the header, the page body and
    // the tab bar, all from the skin kit. Page data and actions only arrive
    // through IAppPageSource; the identity adapter adds its own notices.
    public sealed partial class PageViews : MonoBehaviour
    {
        public const float GutterDp = 16, ColumnDp = 480, IconDp = 48;
        private static readonly AppPage[] tabs = { AppPage.Campaign, AppPage.Daily, AppPage.Profile };
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
        private float? reveal;
        private TMP_Text countdown, nextDaily;
        private DailyPageView countdownView;
        private long countdownSecond = -1;
        private double lastMusic = AudioPolicy.ToggleOnLevel, lastEffects = AudioPolicy.ToggleOnLevel;
        private string editedName, savedName;
        private AppPage lastTab = AppPage.Daily;
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
            int to = TabIndex(page);
            bool entering = Shown != page;
            reducedMotion = source.SettingsPage().ReducedMotion;
            if (page == AppPage.Settings && entering) { lastMusic = AudioPolicy.ToggleOnLevel; lastEffects = AudioPolicy.ToggleOnLevel; }
            if (page != AppPage.Profile) { editedName = null; savedName = null; editingName = false; }
            Shown = page;
            if (to >= 0) lastTab = tabs[to];
            // The previous kit stays with the page drawn from it; the shell releases it.
            ui = new SkinUi(shell.Artwork, Mathf.Max(.5f, density()), textScale);
            var messages = (notices ?? Enumerable.Empty<string>()).Where(value => !string.IsNullOrEmpty(value)).ToArray();
            float kept = entering ? -1 : shell.Offset;
            switch (page)
            {
                case AppPage.Daily:
                    var daily = source.DailyPage();
                    Frame(1, null, null, null, null, Settings(), messages); Home(daily); break;
                case AppPage.Campaign:
                    var campaign = source.CampaignView(); var realm = catalog.Realm(campaign.Realm);
                    // Another realm is another page: it opens at its own start.
                    if (campaign.Realm != shownRealm) kept = -1;
                    shownRealm = campaign.Realm;
                    string place = "REALM " + campaign.Realm + " / " + Protocol.Realms.Length;
                    if (campaign.Locked != null) Frame(0, realm.realmName, place, campaign.Previous, null, null, Array.Empty<string>());
                    else Frame(0, realm.realmName, place + " · " + campaign.Stars + " / " + Protocol.CampaignTargets.Length * 3 + " STARS",
                        campaign.Previous, campaign.Next, null, Array.Empty<string>(), fullBleed: true);
                    Campaign(campaign, messages); break;
                case AppPage.Level:
                    var level = source.LevelPage(); var map = source.CampaignView();
                    Frame(-1, null, null, null, null, null, Array.Empty<string>(), fullBleed: true);
                    back = level.Back;
                    Level(level, map, messages); break;
                case AppPage.Profile:
                    var profile = source.ProfilePage();
                    Frame(2, "Profile", null, null, null, Settings(), messages); Profile(profile); break;
                case AppPage.Settings:
                    var settings = source.SettingsPage();
                    Frame(-1, "Settings", brand, new PageAction { Label = "Back", Name = "Back",
                        CanInvoke = () => source.CanNavigate(lastTab), Invoke = () => source.Navigate(lastTab) }, null, null, messages);
                    Settings(settings); break;
                case AppPage.Result:
                    var result = source.ResultPage();
                    if (result.HasResult && result.ShowStars) { Frame(-1, null, null, null, null, null, messages); back = result.Done; CampaignResult(result); }
                    else if (result.HasResult)
                    {
                        Frame(1, result.Mode + " complete", DayLabel(result.Day) + " · " + catalog.Realm(result.Realm).realmName,
                            null, null, null, messages);
                        Result(result);
                    }
                    else { Frame(1, result.Mode, null, null, null, null, messages); NoResult(result); }
                    break;
                default: throw new ArgumentOutOfRangeException(nameof(page));
            }
            shell.Finish(column.Top - 16 * ui.Density);
            if (kept >= 0) shell.Offset = kept;
            else if (reveal.HasValue) shell.Reveal(reveal.Value);
            if (entering) shell.Enter(source.SettingsPage().ReducedMotion, ui.Density);
        }

        private string[] shownNotices;
        // Draws the shown page again in place, for a change only the page holds.
        private void Redraw() { if (Shown.HasValue) Render(Shown.Value, shownNotices); }

        // Removes the drawn page, so the next page enters without a page to leave.
        public void Hide() { Retire(); Shown = null; shell.Clear(shell.SafeArea); }

        // A page that could not load its realm art has no skin kit to draw with.
        public void Unavailable(string title, string message, PageAction retry)
        {
            Retire(); Shown = null;
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

        private PageAction Settings() => new PageAction { Label = "Settings", Name = "Settings",
            CanInvoke = () => source.CanNavigate(AppPage.Settings), Invoke = () => source.Navigate(AppPage.Settings) };

        // Header, body frame and tab bar for one page. The tab bar sits inside the
        // side gutters and above the bottom safe inset; the body scrolls between the
        // header and the top of the tab bar. A full-bleed page (the map) scrolls
        // under both instead. A page without a title (Home) draws its own header
        // in the body and keeps only its utility tablet fixed at the top.
        private void Frame(int tab, string title, string subtitle, PageAction left, PageAction right, PageAction settings, string[] notices,
            bool fullBleed = false)
        {
            var safe = shell.SafeArea; float d = ui.Density;
            reveal = null; selectedTab = tab;
            float icon = IconDp * d, titleWidth = safe.width - 2 * (icon + 24 * d);
            float titleHeight = title == null ? 0 : ui.TextHeight(title, titleWidth, 25, SkinUi.Type.Title);
            float subtitleHeight = subtitle == null ? 0 : ui.TextHeight(subtitle, titleWidth, 12, SkinUi.Type.Label);
            // The inner-page header: the title 5 dp under the safe inset, its light
            // stroke at 46 dp and the subtitle at 59 dp.
            float header = title == null ? 0 : Mathf.Max((subtitle == null ? 70 : 84) * d, 59 * d + subtitleHeight + 8 * d);
            tabBar = ui.TabBarRect(safe);
            float bottom = tab >= 0 ? tabBar.yMax : safe.y;
            headerBottom = safe.yMax - header;
            var body = fullBleed ? shell.ScreenArea : new Rect(safe.x, bottom, safe.width, headerBottom - bottom);
            shell.Clear(body); shell.Hold(ui.Dispose);
            shell.Backdrop(ui.Art.SkinRealm(SkinSlots.Background), .92f);
            var chrome = shell.Overlay;
            if (title != null)
            {
                var rect = new Rect(safe.center.x - titleWidth / 2, safe.yMax - 5 * d - titleHeight, titleWidth, titleHeight);
                Shade(rect, ui.TextWidth(title, 25, SkinUi.Type.Title), chrome);
                ui.Label("Page title", title, rect, 25, SkinTokens.Text, chrome, SkinUi.Type.Title);
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
            if (left != null && left.Enabled) HeaderButton(left, new Rect(safe.x + GutterDp * d, iconY, icon, icon), SkinSlots.IconBack, false);
            if (right != null) { if (right.Enabled) HeaderButton(right, new Rect(safe.xMax - GutterDp * d - icon, iconY, icon, icon), SkinSlots.IconBack, true); }
            else if (settings != null) HeaderButton(settings, new Rect(safe.xMax - GutterDp * d - icon, iconY, icon, icon), SkinSlots.IconSettings, false);
            if (tab >= 0) TabBar(safe, tab);
            float width = Mathf.Min(body.width - 2 * GutterDp * d, ColumnDp * d);
            column = new PageColumn(ui, shell.Page, actions, body.center.x - width / 2, width, body.yMax - 4 * d);
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
            var icons = new[] { SkinSlots.IconCampaign, SkinSlots.IconDaily, SkinSlots.IconProfile };
            var bound = tabs.Select(target => new PageAction { Label = target == AppPage.Daily ? dailyTab : target.ToString(),
                Name = target == AppPage.Daily ? dailyTab : target.ToString(), CanInvoke = () => source.CanNavigate(target), Invoke = () => source.Navigate(target) }).ToArray();
            var bar = ui.TabBar("Tab bar", safe, bound.Select((action, i) => (icons[i], action.Label, actions.Click(action))).ToArray(), selected, shell.Chrome);
            var buttons = bar.GetComponentsInChildren<Button>();
            for (int i = 0; i < buttons.Length; i++) actions.Bind(buttons[i], bound[i], fade: false);
        }
        private static int TabIndex(AppPage page) =>
            page == AppPage.Campaign || page == AppPage.Level ? 0 : page == AppPage.Daily || page == AppPage.Result ? 1 : page == AppPage.Profile ? 2 : -1;

        // Home, as drawn at 400 dp: the product's painted wordmark lockup, today's
        // Daily and the Campaign realm in progress. Spacing follows the composites
        // (tiki-home, and realms-daily-used once today's play is used); text grows
        // its row when it wraps or the text size is larger.
        private void Home(DailyPageView value)
        {
            float d = ui.Density;
            var mark = ui.Art.Sprite("common/brand__" + brand);
            float markWidth = 180 * d, markHeight = markWidth * mark.rect.height / mark.rect.width;
            var markRect = column.Take(markHeight, 8);
            var wordmark = ui.Rect<Image>("Wordmark", new Rect(column.Left + (column.Width - markWidth) / 2, markRect.y, markWidth, markHeight), shell.Page);
            wordmark.sprite = mark; wordmark.preserveAspect = true; wordmark.raycastTarget = false;
            var realm = catalog.Realm(value.Realm);
            string objective = catalog.ObjectiveName(value.ObjectiveKind, value.ObjectiveValue);
            if (value.Now != null) { countdownView = value; countdownSecond = value.Now(); }
            if (value.NextOpensAt > 0 && value.Now != null) UsedDaily(value, realm, objective);
            else
            {
                var card = column.Card("Daily card", null, 24, 13.5f, 16);
                card.Typed("Daily heading", "TODAY’S DAILY", SkinUi.Type.Label, 11, SkinTokens.Accent, 21.5f);
                card.Medallion("Daily guardian", ui.Art.Sprite("boss__portrait"), 122, 8.5f);
                card.Typed("Daily guardian name", realm.guardianName, SkinUi.Type.Title, 28, SkinTokens.Text, 1.5f);
                card.Typed("Daily objective", objective, SkinUi.Type.Body, 17, SkinTokens.Text, 2.5f);
                if (value.ClosesAt > 0 && value.Now != null)
                    countdown = card.Typed("Daily countdown", Remaining(value.ClosesAt - countdownSecond), SkinUi.Type.Caption, 17, SkinTokens.Accent, 2.5f);
                if (!string.IsNullOrEmpty(value.Status)) card.Typed("Daily status", value.Status, SkinUi.Type.Body, 15, SkinTokens.Text, 2.5f);
                foreach (var fact in value.Facts) card.Typed("Daily fact", fact, SkinUi.Type.Caption, 12, SkinTokens.TextMuted, 2.5f);
                card.Gap(13);
                for (int i = 0; i < value.Actions.Length; i++)
                    Pill(card, value.Actions[i], i == 0, i == 0 ? SkinSlots.IconDaily : null, i == value.Actions.Length - 1 ? 0 : 12);
                column = card.End(24);
            }

            var summary = source.CampaignSummary();
            if (summary == null) return;
            var campaign = column.Card("Campaign card", null, 24, 13.5f, 18.5f);
            campaign.Typed("Campaign heading", "CAMPAIGN", SkinUi.Type.Label, 11, SkinTokens.TextMuted, 3);
            campaign.Typed("Campaign realm", catalog.Realm(summary.Realm).realmName, SkinUi.Type.Title, 28, SkinTokens.Text, 3);
            campaign.Typed("Campaign realm number", "Realm " + summary.Realm + " / " + Protocol.Realms.Length, SkinUi.Type.Body, 13, SkinTokens.TextMuted, 13);
            Stat(campaign, "Campaign levels", null, "Levels", summary.Cleared + " / " + summary.Levels, 7.5f);
            Progress(campaign, "Campaign progress", summary.Levels == 0 ? 0 : summary.Cleared / (float)summary.Levels, 11);
            Stat(campaign, "Campaign stars", SkinSlots.StarOn, "Stars", summary.Stars + " / " + summary.Levels * 3, 21);
            Pill(campaign, summary.Open, false, SkinSlots.IconCampaign, 0);
            column = campaign.End(24);
        }
        // Today's play is used: its reason replaces Play and counts to the next
        // Daily, the run's score and objective count follow, and the action left
        // to take (the result) becomes the primary.
        private void UsedDaily(DailyPageView value, PageCatalog.RealmPage realm, string objective)
        {
            float d = ui.Density;
            var card = column.Card("Daily card", null, 24, 39, 16);
            card.Medallion("Daily guardian", ui.Art.Sprite("boss__portrait"), 122, 11.5f);
            card.Typed("Daily guardian name", realm.realmName + " · " + realm.guardianName, SkinUi.Type.Title, 27, SkinTokens.Text, 14);
            card.Typed("Daily objective", objective, SkinUi.Type.Caption, 18, SkinTokens.Objective, 25.5f);
            card.Typed("Daily used", "Today’s attempt is used", SkinUi.Type.Caption, 20, SkinTokens.Text, 9.5f);
            nextDaily = card.Typed("Next Daily", NextDaily(value.NextOpensAt - countdownSecond), SkinUi.Type.Caption, 14, SkinTokens.TextMuted, 20);
            var rows = new PageColumn(ui, card.Parent, actions, card.Left - 8 * d, card.Width + 16 * d, card.Top);
            ResultRow(rows, "Daily score", "Score", value.Score.ToString("N0", CultureInfo.InvariantCulture), SkinTokens.Score, 12);
            if (value.ObjectiveKind != 0)
                ResultRow(rows, "Daily objective count", objective, value.ObjectiveTotal.ToString("N0", CultureInfo.InvariantCulture), SkinTokens.Objective, 12);
            card.Top = rows.Top - 8 * d;
            for (int i = 0; i < value.Actions.Length; i++) Pill(card, value.Actions[i], i == 0, null, i == value.Actions.Length - 1 ? 0 : 12);
            column = card.End(24);
        }
        // A 52 dp kit list row: the label on the left and its number on the right.
        private void ResultRow(PageColumn rows, string name, string label, string number, string token, float gapDp)
        {
            float d = ui.Density;
            float numberWidth = ui.TextWidth(number, 18, SkinUi.Type.Number);
            float height = Mathf.Max(PageColumn.RowDp * d, ui.TextHeight(label, rows.Width - 44 * d - numberWidth, 15, SkinUi.Type.Caption) + 16 * d);
            var rect = rows.Take(height, gapDp);
            ui.Piece(name + " row", SkinSlots.ListRow, rect, rows.Parent);
            ui.Label(name + " label", label, new Rect(rect.x + 14 * d, rect.y, rect.width - 36 * d - numberWidth, rect.height), 15,
                SkinTokens.Text, rows.Parent, SkinUi.Type.Caption, TextAlignmentOptions.Left);
            ui.Label(name, number, new Rect(rect.xMax - 15 * d - numberWidth, rect.y, numberWidth, rect.height), 18, token,
                rows.Parent, SkinUi.Type.Number, TextAlignmentOptions.Right);
        }
        // A card row: an optional star, the label on the left and its value, the
        // biggest text in the row, on the right.
        private void Stat(PageColumn card, string name, string icon, string label, string value, float gapDp)
        {
            float d = ui.Density, right = 17 * d, iconSize = 18 * d, indent = icon == null ? 0 : 31 * d;
            float valueWidth = ui.TextWidth(value, 20, SkinUi.Type.Number);
            float height = Mathf.Max(ui.TextHeight(value, valueWidth, 20, SkinUi.Type.Number),
                ui.TextHeight(label, card.Width - right - valueWidth - indent, 17, SkinUi.Type.Body));
            var rect = card.Take(height, gapDp);
            if (icon != null) ui.Star(name + " star", new Rect(rect.x + 2.5f * d, rect.center.y - iconSize / 2, iconSize, iconSize), true, card.Parent);
            ui.Label(name + " label", label, new Rect(rect.x + indent, rect.y, rect.width - indent - right - valueWidth, rect.height), 17,
                SkinTokens.Text, card.Parent, SkinUi.Type.Body, TextAlignmentOptions.Left);
            ui.Label(name, value, new Rect(rect.xMax - right - valueWidth, rect.y, valueWidth, rect.height), 20, SkinTokens.Score,
                card.Parent, SkinUi.Type.Number, TextAlignmentOptions.Right);
        }
        // A 4 dp progress line: the groove and a warm fill.
        private void Progress(PageColumn card, string name, float fraction, float gapDp)
        {
            float d = ui.Density;
            var rect = card.Take(4 * d, gapDp);
            var track = new Rect(rect.x + 4 * d, rect.y, rect.width - 8 * d, rect.height);
            ui.Piece(name + " track", SkinSlots.SliderTrack, track, card.Parent, .5f);
            if (fraction > 0)
                ui.Piece(name, SkinSlots.SliderFill, new Rect(track.x, track.y, Mathf.Max(track.height * 2, track.width * Mathf.Clamp01(fraction)), track.height),
                    card.Parent, .5f);
        }
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
                }
            }
            if (back != null && Input.GetKeyDown(KeyCode.Escape) && back.Available) actions.Run(back.Invoke);
        }

        private static string Remaining(long seconds) => Clock(seconds) + " left";
        private static string NextDaily(long seconds) => "Next Daily in " + Clock(seconds);
        private static string Clock(long seconds)
        {
            seconds = Math.Max(0, seconds);
            return string.Format(CultureInfo.InvariantCulture, "{0:00}:{1:00}:{2:00}", seconds / 3600, seconds / 60 % 60, seconds % 60);
        }
        private static string Sentence(string value) => string.IsNullOrEmpty(value) ? value : char.ToUpperInvariant(value[0]) + value.Substring(1);
        private static string DayLabel(uint day) => DateTimeOffset.FromUnixTimeSeconds((long)day * 86400)
            .UtcDateTime.ToString("dd MMM yyyy", CultureInfo.InvariantCulture);
        private static RectTransform Holder(string name, Rect rect, Transform parent)
        {
            var holder = new GameObject(name, typeof(RectTransform)).GetComponent<RectTransform>();
            holder.SetParent(parent, false); SkinUi.Place(holder, rect, parent); return holder;
        }
        private static Rect ScreenOf(Component component) => SkinUi.ScreenRect((RectTransform)component.transform);

        public void Retire()
        {
            epoch++; sharing.Cancel(); sharing.Dispose(); sharing = new CancellationTokenSource();
            actions?.Clear(); back = null; countdown = null; nextDaily = null; countdownView = null;
            // The portraits stay with the page that shows them; the shell releases them.
            portraits = null;
        }
        private void OnDestroy() { Retire(); ui?.Dispose(); sharing.Cancel(); sharing.Dispose(); }
    }
}
