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
    public sealed class PageViews : MonoBehaviour
    {
        public const float GutterDp = 16, ColumnDp = 480, IconDp = 48;
        private static readonly AppPage[] tabs = { AppPage.Campaign, AppPage.Daily, AppPage.Profile };
        private IAppPageSource source;
        private PageShell shell;
        private PageCatalog catalog;
        private string dailyTab;
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
        private TMP_Text countdown;
        private DailyPageView countdownView;
        private long countdownSecond = -1;
        private double lastMusic = AudioPolicy.ToggleOnLevel, lastEffects = AudioPolicy.ToggleOnLevel;
        private string editedName, savedName;
        private AppPage lastTab = AppPage.Daily;
        public AppPage? Shown { get; private set; }

        public void Initialize(IAppPageSource pageSource, PageShell pageShell, string dailyTabName, float scale, Func<float> displayDensity = null)
        {
            source = pageSource ?? throw new ArgumentNullException(nameof(pageSource));
            shell = pageShell ?? throw new ArgumentNullException(nameof(pageShell));
            dailyTab = dailyTabName; textScale = BoardController.SupportedTextScale(scale);
            density = displayDensity ?? BoardController.ReadDisplayDensity;
            if (actions == null) actions = new PageActions(source.Report);
            if (catalog == null) catalog = PageCatalog.Load();
        }

        public void Render(AppPage page, IEnumerable<string> notices = null)
        {
            if (shell.Artwork == null) throw new InvalidOperationException("Load the page realm before drawing it");
            Retire();
            int from = Shown.HasValue ? TabIndex(Shown.Value) : -1, to = TabIndex(page);
            bool entering = Shown != page;
            if (page == AppPage.Settings && entering) { lastMusic = AudioPolicy.ToggleOnLevel; lastEffects = AudioPolicy.ToggleOnLevel; }
            if (page != AppPage.Profile) { editedName = null; savedName = null; }
            Shown = page;
            if (to >= 0) lastTab = tabs[to];
            ui?.Dispose(); ui = new SkinUi(shell.Artwork, Mathf.Max(.5f, density()), textScale);
            var messages = (notices ?? Enumerable.Empty<string>()).Where(value => !string.IsNullOrEmpty(value)).ToArray();
            float kept = entering ? -1 : shell.Offset;
            switch (page)
            {
                case AppPage.Daily:
                    var daily = source.DailyPage(); var brand = Brand();
                    Frame(1, brand[0], brand[1], null, null, Settings(), messages); Daily(daily); break;
                case AppPage.Campaign:
                    var campaign = source.CampaignView(); var realm = catalog.Realm(campaign.Realm);
                    Frame(0, realm.realmName, "REALM " + campaign.Realm + " / " + Protocol.Realms.Length,
                        campaign.Previous, campaign.Next, null, Array.Empty<string>(), fullBleed: true);
                    Campaign(campaign, messages); break;
                case AppPage.Level:
                    var level = source.LevelPage(); var map = source.CampaignView();
                    Frame(0, catalog.Realm(level.Realm).realmName, "REALM " + level.Realm + " / " + Protocol.Realms.Length,
                        null, null, null, Array.Empty<string>(), fullBleed: true);
                    back = level.Back;
                    Level(level, map, messages); break;
                case AppPage.Profile:
                    var profile = source.ProfilePage();
                    Frame(2, "PROFILE", null, null, null, Settings(), messages); Profile(profile); break;
                case AppPage.Settings:
                    var settings = source.SettingsPage();
                    Frame(-1, "SETTINGS", null, new PageAction { Label = "Back", Name = "Back",
                        CanInvoke = () => source.CanNavigate(lastTab), Invoke = () => source.Navigate(lastTab) }, null, null, messages);
                    Settings(settings); break;
                case AppPage.Result:
                    var result = source.ResultPage();
                    if (result.HasResult && result.ShowStars)
                    {
                        Frame(-1, "LEVEL " + Number(result.Realm, result.Level), catalog.Realm(result.Realm).realmName.ToUpperInvariant(), null, null, null, messages);
                        back = result.Done; CampaignResult(result);
                    }
                    else { Frame(1, result.HasResult ? result.Mode.ToUpperInvariant() + " COMPLETE" : result.Mode.ToUpperInvariant(), null, null, null, null, messages); Result(result); }
                    break;
                default: throw new ArgumentOutOfRangeException(nameof(page));
            }
            shell.Finish(column.Top - 16 * ui.Density);
            if (kept >= 0) shell.Offset = kept;
            else if (reveal.HasValue) shell.Reveal(reveal.Value);
            if (entering) shell.Enter(from < 0 || to < 0 || from == to ? 0 : Math.Sign(to - from), source.SettingsPage().ReducedMotion, ui.Density);
        }

        // A page that could not load its realm art has no skin kit to draw with.
        public void Unavailable(string title, string message, PageAction retry)
        {
            Retire(); Shown = null;
            float d = Mathf.Max(.5f, density());
            var safe = Screen.safeArea;
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

        private string[] Brand()
        {
            var parts = Application.productName.Split(new[] { ": " }, 2, StringSplitOptions.None);
            return parts.Length == 2 ? new[] { parts[0], parts[1].ToUpperInvariant() } : new[] { Application.productName, null };
        }
        private PageAction Settings() => new PageAction { Label = "Settings", Name = "Settings",
            CanInvoke = () => source.CanNavigate(AppPage.Settings), Invoke = () => source.Navigate(AppPage.Settings) };

        // Header, body frame and tab bar for one page. The tab bar sits inside the
        // side gutters and above the bottom safe inset; the body scrolls between the
        // header and the top of the tab bar. A full-bleed page (the map) scrolls
        // under both instead.
        private void Frame(int tab, string title, string subtitle, PageAction left, PageAction right, PageAction settings, string[] notices,
            bool fullBleed = false)
        {
            var safe = Screen.safeArea; float d = ui.Density;
            reveal = null; selectedTab = tab;
            float icon = IconDp * d, titleWidth = safe.width - 2 * (icon + 24 * d);
            float titleHeight = ui.TextHeight(title, titleWidth, 24, true), subtitleHeight = subtitle == null ? 0 : ui.TextHeight(subtitle, titleWidth, 13, true);
            float header = Mathf.Max(icon + 20 * d, titleHeight + subtitleHeight + 18 * d);
            tabBar = ui.TabBarRect(safe);
            float bottom = tab >= 0 ? tabBar.yMax : safe.y;
            headerBottom = safe.yMax - header;
            var body = fullBleed ? new Rect(0, 0, Screen.width, Screen.height) : new Rect(safe.x, bottom, safe.width, headerBottom - bottom);
            shell.Clear(body);
            shell.Backdrop(ui.Art.SkinRealm(SkinSlots.Background), .92f);
            var chrome = shell.Chrome;
            if (fullBleed)
            {
                // The map scrolls under the header; a band keeps the title readable.
                var band = ui.Rect<Image>("Header band", Rect.MinMaxRect(0, headerBottom - 6 * d, Screen.width, Screen.height), chrome);
                var shade = ui.Art.Token(SkinTokens.Scrim); shade.a *= .75f; band.color = shade; band.raycastTarget = false;
            }
            float top = safe.yMax - 8 * d;
            float textTop = top - (header - 8 * d - titleHeight - subtitleHeight) / 2 + 2 * d;
            ui.Label("Page title", title, new Rect(safe.center.x - titleWidth / 2, textTop - titleHeight, titleWidth, titleHeight), 24, SkinTokens.Text, chrome, true);
            if (subtitle != null)
                ui.Label("Page subtitle", subtitle, new Rect(safe.center.x - titleWidth / 2, textTop - titleHeight - subtitleHeight, titleWidth, subtitleHeight),
                    13, SkinTokens.Accent, chrome, true);
            float iconY = top - (header - 8 * d) / 2 - icon / 2;
            back = left;
            if (left != null) HeaderButton(left, new Rect(safe.x + 12 * d, iconY, icon, icon), SkinSlots.IconBack, false);
            if (right != null) HeaderButton(right, new Rect(safe.xMax - 12 * d - icon, iconY, icon, icon), SkinSlots.IconBack, true);
            else if (settings != null) HeaderButton(settings, new Rect(safe.xMax - 12 * d - icon, iconY, icon, icon), SkinSlots.IconSettings, false);
            if (tab >= 0) TabBar(safe, tab);
            float width = Mathf.Min(body.width - 2 * GutterDp * d, ColumnDp * d);
            column = new PageColumn(ui, shell.Page, actions, body.center.x - width / 2, width, body.yMax - 4 * d);
            foreach (var notice in notices) column.Note("Notice", notice);
        }
        private void HeaderButton(PageAction action, Rect rect, string icon, bool mirrored, Transform parent = null)
        {
            var button = ui.IconButton(action.Name ?? action.Label, rect, icon, actions.Click(action), parent ?? shell.Chrome, false, out var glyph, out _);
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

        // Home: today's Daily, then the Campaign realm in progress.
        private void Daily(DailyPageView value)
        {
            var realm = catalog.Realm(value.Realm);
            var card = column.Card("Daily card", "TODAY'S DAILY");
            card.Medallion("Daily guardian", ui.Art.Sprite("boss__idle"), 84, 6);
            card.Text("Daily guardian name", realm.guardianName, 26, SkinTokens.Text, true, 4);
            card.Text("Daily objective", Sentence(catalog.Objective(value.ObjectiveKind, value.ObjectiveValue).description), 17, SkinTokens.Text, false, 6);
            if (value.ClosesAt > 0 && value.Now != null)
            {
                countdownView = value; countdownSecond = value.Now();
                countdown = card.Text("Daily countdown", Remaining(value.ClosesAt - countdownSecond), 17, SkinTokens.Accent, true, 6);
            }
            if (!string.IsNullOrEmpty(value.Status)) card.Text("Daily status", value.Status, 15, SkinTokens.Text, false, 6);
            foreach (var fact in value.Facts) card.Text("Daily fact", fact, 14, SkinTokens.TextMuted, false, 6);
            card.Gap(10);
            for (int i = 0; i < value.Actions.Length; i++) card.Button(value.Actions[i], i == 0);
            column = card.End();
            var summary = source.CampaignSummary();
            if (summary == null) return;
            card = column.Card("Campaign card", "CAMPAIGN");
            card.Text("Campaign realm", catalog.Realm(summary.Realm).realmName, 24, SkinTokens.Text, true, 2);
            card.Text("Campaign realm number", "REALM " + summary.Realm + " / " + Protocol.Realms.Length, 13, SkinTokens.Accent, true, 8);
            card.Text("Campaign levels", summary.Cleared + " / " + summary.Levels + " levels complete", 17, SkinTokens.Text, false, 6);
            StarCount(card, summary.Stars + " / " + summary.Levels * 3 + " stars");
            card.Gap(10);
            card.Button(summary.Open, false);
            column = card.End();
        }
        private void StarCount(PageColumn card, string text)
        {
            float d = ui.Density, star = 26 * d, width = ui.TextWidth(text, 17, false);
            var rect = card.Take(Mathf.Max(star, ui.TextHeight(text, card.Width, 17, false)), 6);
            float x = card.Left + (card.Width - star - 8 * d - width) / 2;
            ui.Star("Campaign star", new Rect(x, rect.center.y - star / 2, star, star), true, card.Parent);
            ui.Label("Campaign stars", text, new Rect(x + star + 8 * d, rect.y, width, rect.height), 17, SkinTokens.Text, card.Parent, false, TextAlignmentOptions.Left);
        }

        // The realm map: the skin's map art scrolls under the header and tab bar,
        // the authored path runs as a trail between the nodes, and the page opens
        // on the level to play next. Locks, purchase and saved-run notices sit on a
        // card above the tab bar.
        private void Campaign(CampaignPageView value, string[] notices)
        {
            Map(value, 0);
            var lines = notices.Concat(new[] { value.Notice, value.SavedRun }).Where(text => !string.IsNullOrEmpty(text)).ToArray();
            var buttons = new[] { value.Resume, value.Purchase, value.Result }.Where(action => action != null).ToArray();
            if (lines.Length == 0 && buttons.Length == 0) return;
            Float("Campaign notice", false, null, card => {
                foreach (var line in lines) card.Text("Campaign notice text", line, 15, SkinTokens.Text, false, 8);
                for (int i = 0; i < buttons.Length; i++) card.Button(buttons[i], i == 0, i == buttons.Length - 1 ? 0 : 10);
            });
        }

        private void Map(CampaignPageView value, byte focusLevel)
        {
            var realm = catalog.Realm(value.Realm);
            float d = ui.Density, width = Screen.width;
            var art = ui.Art.SkinRealm(SkinSlots.Map);
            float height = Mathf.Max(width * art.rect.height / art.rect.width, Screen.height);
            var map = new Rect(0, Screen.height - height, width, height);
            var image = ui.Rect<Image>("Realm map", map, shell.Page); image.sprite = art; image.raycastTarget = false;
            column = new PageColumn(ui, shell.Page, actions, 0, width, map.y + 16 * d);
            int count = value.Trials.Length;
            // The path spans the map between the header and the tab bar, so every
            // node can scroll clear of both.
            var path = Rect.MinMaxRect(map.xMin, map.yMin + tabBar.yMax + 24 * d, map.xMax, map.yMax - (Screen.height - headerBottom) - 24 * d);
            Vector2 At(int index)
            {
                var point = realm.campaignPath[index];
                return new Vector2(path.x + point.x * path.width, path.yMax - point.y * path.height);
            }
            int focus = focusLevel > 0 ? focusLevel - 1 : Array.FindIndex(value.Trials, trial => trial.Playing);
            if (focus < 0) focus = Array.FindIndex(value.Trials, trial => trial.Available && trial.Stars == 0);
            if (focus < 0) focus = Math.Max(0, Array.FindLastIndex(value.Trials, trial => trial.Available || trial.Stars > 0));
            float Radius(int index) => NodeDp(index == count - 1, focusLevel == 0 && index == focus) * d / 2 + 6 * d;
            float step = 13 * d, dot = 7 * d;
            for (int i = 0; i + 1 < count; i++)
            {
                Vector2 from = At(i), to = At(i + 1);
                var next = value.Trials[i + 1];
                float clearFrom = Radius(i), clearTo = Radius(i + 1), length = Vector2.Distance(from, to);
                int dots = Mathf.FloorToInt(length / step);
                var color = ui.Art.Token(SkinTokens.Text);
                if (!next.Available && next.Stars == 0) color.a = .4f;
                for (int k = 1; k < dots; k++)
                {
                    var point = Vector2.Lerp(from, to, k / (float)dots);
                    if (Vector2.Distance(point, from) < clearFrom || Vector2.Distance(point, to) < clearTo) continue;
                    var piece = ui.Rect<Image>("Trail " + (i + 1) + "." + k, new Rect(point.x - dot / 2, point.y - dot / 2, dot, dot), shell.Page);
                    piece.color = color; piece.raycastTarget = false;
                    var rect = piece.rectTransform; rect.pivot = new Vector2(.5f, .5f); rect.anchoredPosition += rect.sizeDelta / 2;
                    rect.localRotation = Quaternion.Euler(0, 0, 45);
                }
            }
            for (int index = 0; index < count; index++)
                Node(value, value.Trials[index], At(index), index == count - 1, focusLevel == 0 && index == focus);
            reveal = At(focus).y;
        }

        // One level on the map. The open node carries its number; a done or locked
        // node, whose art shows a check or a lock, has it underneath, with the earned
        // stars below. The level to play next is larger and says so under it.
        // The touch area covers the node, its number and its stars.
        private void Node(CampaignPageView value, CampaignTrialView trial, Vector2 center, bool guardian, bool next)
        {
            float d = ui.Density;
            string name = "Trial " + trial.Level, number = Number(value.Realm, trial.Level);
            bool done = trial.Stars > 0, open = trial.Available;
            float size = NodeDp(guardian, next) * d, star = 19 * d;
            var rect = new Rect(center.x - size / 2, center.y - size / 2, size, size);
            string caption = guardian ? number + " · " + catalog.Realm(value.Realm).guardianName.ToUpperInvariant() : open && !done ? null : number;
            float captionSize = guardian ? 16 : 17;
            var captionRect = caption == null ? new Rect(rect.x, rect.y, rect.width, 0) : Measured(caption, captionSize, center.x, rect.y - 2 * d);
            bool stars = done || trial.Playing;
            var starRow = new Rect(center.x - 1.5f * star, captionRect.y - star + 2 * d, 3 * star, stars ? star : 0);
            string cue = next && open ? trial.Playing ? "RESUME" : "PLAY" : null;
            var cueRect = cue == null ? rect : Measured(cue, 18, center.x, (stars ? starRow.y : captionRect.y) - 2 * d);
            var area = Union(Union(Union(rect, captionRect), stars ? starRow : rect), cueRect);
            var hit = ui.Rect<Image>(name, new Rect(area.x - 6 * d, area.y - 6 * d, area.width + 12 * d, area.height + 12 * d), shell.Page);
            hit.color = Color.clear; hit.raycastTarget = true;
            var button = hit.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None; button.targetGraphic = hit;
            if (guardian)
            {
                var portrait = ui.Medallion(name + " guardian", rect, ui.Art.Sprite("boss__idle"), hit.transform);
                if (!open && !done)
                {
                    portrait.color = new Color(.45f, .45f, .45f, 1);
                    ui.Piece(name + " lock", SkinSlots.IconLock, new Rect(rect.xMax - 30 * d, rect.y, 32 * d, 32 * d), hit.transform);
                }
            }
            else
            {
                ui.Piece(name + " node", done ? SkinSlots.MapNodeDone : open ? SkinSlots.MapNodeOpen : SkinSlots.MapNodeLocked, rect, hit.transform);
                if (caption == null)
                    ui.Label(name + " number", number, new Rect(rect.x, rect.y + size * .04f, rect.width, rect.height), next ? 27 : 23,
                        SkinTokens.TextOnPrimary, hit.transform, true);
            }
            if (caption != null) ui.Label(name + " number", caption, captionRect, captionSize, guardian ? SkinTokens.Accent : SkinTokens.Text, hit.transform, true);
            if (stars)
                for (int i = 0; i < 3; i++)
                    ui.Star(name + " star " + (i + 1), new Rect(starRow.x + i * star, starRow.y, star, star), i < trial.Stars, hit.transform);
            if (cue != null) ui.Label(name + " cue", cue, cueRect, 18, SkinTokens.Accent, hit.transform, true);
            actions.Wire(button, new PageAction { Name = name, Enabled = trial.Available, CanInvoke = trial.CanOpen, Invoke = trial.Open }, fade: false);
        }
        private static float NodeDp(bool guardian, bool next) => guardian ? 96 : next ? 74 : 62;
        // A one-line display label's rectangle, centred on x under a top edge.
        private Rect Measured(string text, float sizeDp, float x, float top)
        {
            float w = ui.TextWidth(text, sizeDp, true) + 8 * ui.Density, h = ui.TextHeight(text, w, sizeDp, true);
            return new Rect(x - w / 2, top - h, w, h);
        }
        private static Rect Union(Rect a, Rect b) => Rect.MinMaxRect(Mathf.Min(a.xMin, b.xMin), Mathf.Min(a.yMin, b.yMin), Mathf.Max(a.xMax, b.xMax), Mathf.Max(a.yMax, b.yMax));

        // The level preview: a dialog over the dimmed map it was opened from.
        private void Level(LevelPageView value, CampaignPageView map, string[] notices)
        {
            Map(map, value.Level);
            var scrim = ui.Rect<Image>("Level scrim", new Rect(0, 0, Screen.width, Screen.height), shell.Chrome);
            scrim.color = ui.Art.Token(SkinTokens.Scrim); scrim.raycastTarget = true;
            var realm = catalog.Realm(value.Realm);
            Float("Level", true, value.Back, card => {
                foreach (var notice in notices) card.Note("Notice", notice);
                card.Text("Level title", "LEVEL " + Number(value.Realm, value.Level), 30, SkinTokens.Text, true, 2);
                card.Text("Level realm", realm.realmName + " · " + realm.guardianName, 17, SkinTokens.Text, false, 10);
                if (value.Stars > 0) card.Stars("Best stars", value.Stars, 26, 10);
                Goals(card, value.Goals, 0, 0, 0);
                card.Gap(4);
                card.Text("Level moves", value.Moves + " moves", 20, SkinTokens.Accent, true, 10);
                if (!string.IsNullOrEmpty(value.Notice)) card.Text("Level notice", value.Notice, 15, SkinTokens.Text, false, 10);
                card.Button(value.Play, true, 0);
            });
        }
        // The three star goals, each with its progress: score, the repeated goal
        // and the one-move goal, starred once earned.
        private void Goals(PageColumn card, CampaignGoals goals, ulong score, uint primary, byte earned)
        {
            string Star(int bit) => (earned & bit) != 0 ? SkinSlots.StarOn : SkinSlots.StarOff;
            card.Row("Score goal", "Score", score.ToString("N0", CultureInfo.InvariantCulture) + " / " + goals.Points.ToString("N0", CultureInfo.InvariantCulture), Star(1));
            card.Row("Primary goal", catalog.ObjectiveName(goals.PrimaryKind, goals.PrimaryValue, goals.PrimaryCount), Math.Min(primary, goals.PrimaryCount) + " / " + goals.PrimaryCount, Star(2));
            card.Row("Secondary goal", catalog.ObjectiveName(goals.SecondaryKind, goals.SecondaryValue, goals.SecondaryCount), ((earned & 4) != 0 ? 1 : 0) + " / 1", Star(4));
        }

        // A card in the chrome layer: centred between the header and the tab bar as
        // a dialog, or pinned just above the tab bar. It is laid out at the top of
        // the screen, then moved into place once its height is known.
        private void Float(string name, bool centred, PageAction close, Action<PageColumn> fill)
        {
            float d = ui.Density; var safe = Screen.safeArea;
            var holder = Holder(name, new Rect(0, 0, Screen.width, Screen.height), shell.Chrome);
            float width = Mathf.Min(safe.width - 2 * GutterDp * d, ColumnDp * d), left = safe.center.x - width / 2;
            var outer = new PageColumn(ui, holder, actions, left, width, Screen.height);
            var card = outer.Card(name + " card");
            if (close != null) card.Gap(14);
            fill(card);
            card.End(0);
            if (close != null)
                HeaderButton(close, new Rect(left + width - 56 * d, Screen.height - 58 * d, 48 * d, 48 * d), SkinSlots.IconClose, false, holder);
            float height = Screen.height - outer.Top, floor = selectedTab >= 0 ? tabBar.yMax : safe.y;
            float bottom = centred ? Mathf.Max(floor + 8 * d, (headerBottom + floor) / 2 - height / 2) : floor + 10 * d;
            holder.anchoredPosition += new Vector2(0, bottom - outer.Top);
        }
        private static string Number(byte realm, byte level) =>
            ((realm - 1) * Protocol.CampaignTargets.Length + level).ToString(CultureInfo.InvariantCulture);

        private void Profile(ProfilePageView value)
        {
            column.Medallion("Worn emblem", ui.Art.Sprite("boss__idle"), 96, 8);
            float d = ui.Density;
            if (value.ChangeName == null) column.Text("Player name", value.Name, 26, SkinTokens.Text, true, 10);
            else
            {
                if (savedName != value.Name) { savedName = value.Name; editedName = value.Name; }
                var rect = column.Take(PageColumn.RowDp * d * textScale, 8);
                var plate = ui.Piece("Player name", SkinSlots.Plate, rect, shell.Page); plate.raycastTarget = true;
                var field = plate.gameObject.AddComponent<TMP_InputField>(); field.characterLimit = 24;
                var area = ui.Rect<RectMask2D>("Text area", new Rect(rect.x + 32 * d, rect.y + 6 * d, rect.width - 64 * d, rect.height - 12 * d), plate.transform);
                var label = ui.Label("Name text", "", ScreenOf(area), 20, SkinTokens.Text, area.transform, true);
                label.textWrappingMode = TextWrappingModes.NoWrap;
                field.textViewport = area.rectTransform; field.textComponent = label; field.text = editedName;
                field.onValueChanged.AddListener(text => editedName = text);
                field.onSubmit.AddListener(text => actions.Run(() => value.ChangeName(text)));
                column.Button(new PageAction { Label = "Save name", Invoke = () => value.ChangeName(field.text),
                    CanInvoke = () => field != null && !string.IsNullOrWhiteSpace(field.text) }, false);
            }
            if (!string.IsNullOrEmpty(value.Worn)) column.Text("Worn", value.Worn, 15, SkinTokens.Text);
            column.Row("Best Daily", "Best Daily", value.BestDailyScore.ToString("N0", CultureInfo.InvariantCulture));
            column.Row("Campaign stars", "Campaign stars", value.Stars + " / " + Protocol.Realms.Length * Protocol.CampaignTargets.Length * 3);
            column.Row("Daily streak", "Daily streak", value.Streak + (value.Streak == 1 ? " day" : " days"));
            foreach (var fact in value.Facts) column.Text("Profile fact", fact, 15, SkinTokens.Text);
            if (!string.IsNullOrEmpty(value.Notice)) column.Text("Profile notice", value.Notice, 15, SkinTokens.Text);
            foreach (var action in value.Actions) column.Button(action, false);
            var images = new List<KeyValuePair<byte, Image>>();
            if (value.Emblems.Length != 0)
            {
                column.Gap(8);
                column.Text("Emblem heading", "GUARDIAN EMBLEMS", 19, SkinTokens.Accent, true, 10);
                int columns = textScale > 1 ? 3 : 4;
                float cell = column.Width / columns, portrait = Mathf.Min(cell - 12 * d, 72 * d);
                float caption = ui.TextHeight("Ag", cell, 13, false), rowHeight = Mathf.Max(PageColumn.ButtonDp * d, portrait + caption + 10 * d);
                for (int row = 0; row * columns < value.Emblems.Length; row++)
                {
                    var line = column.Take(rowHeight, 8);
                    for (int i = 0; i < columns && row * columns + i < value.Emblems.Length; i++)
                    {
                        var choice = value.Emblems[row * columns + i];
                        var rect = new Rect(line.x + i * cell, line.y, cell, rowHeight);
                        var hit = ui.Rect<Image>("Emblem " + choice.Id, rect, shell.Page); hit.color = Color.clear; hit.raycastTarget = true;
                        var button = hit.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None; button.targetGraphic = hit;
                        var action = new PageAction { Name = "Emblem " + choice.Id, Enabled = choice.Available, CanInvoke = choice.CanSelect, Invoke = choice.Select };
                        if (choice.Realm != 0)
                        {
                            var face = ui.Medallion("Guardian portrait", new Rect(rect.center.x - portrait / 2, rect.yMax - portrait, portrait, portrait), null, hit.transform);
                            face.enabled = false; images.Add(new KeyValuePair<byte, Image>(choice.Realm, face));
                        }
                        ui.Label("Emblem " + choice.Id + " name", choice.Name + (choice.Detail == null ? "" : " · " + choice.Detail),
                            new Rect(rect.x, rect.y, rect.width, caption), 13, choice.Detail == null ? SkinTokens.Text : SkinTokens.Accent, hit.transform);
                        actions.Wire(button, action, fade: false);
                    }
                }
            }
            if (value.Borders.Length != 0) column.Text("Border heading", "BORDER", 19, SkinTokens.Accent, true, 10);
            foreach (var choice in value.Borders)
                column.Button(new PageAction { Name = "Border " + choice.Id, Label = choice.Name + (choice.Detail == null ? "" : " · " + choice.Detail),
                    Enabled = choice.Available, CanInvoke = choice.CanSelect, Invoke = choice.Select }, false);
            column.Button(value.Save, false); column.Button(value.Restore, false);
            if (images.Count != 0) StartCoroutine(LoadPortraits(images, epoch));
        }

        private void Settings(SettingsPageView value)
        {
            var card = column.Card("Sound card");
            Volume(card, "Music", value.Music, value.SetMusic, true);
            Volume(card, "Effects", value.Effects, value.SetEffects, false);
            if (value.Muted) card.Button(new PageAction { Label = "Unmute all sound", Invoke = value.Unmute }, true);
            column = card.End();
            column.Button(new PageAction { Label = "Reduced motion: " + (value.ReducedMotion ? "on" : "off"), Invoke = value.ToggleMotion }, false);
            column.Button(new PageAction { Label = "Haptics: " + (value.Haptics ? "on" : "off"), Invoke = value.ToggleHaptics }, false);
            column.Button(new PageAction { Label = "Text size: " + (value.LargeText ? "larger" : "standard"), Invoke = value.ToggleText }, false);
        }
        private void Volume(PageColumn card, string title, double value, Action<double> set, bool music)
        {
            float d = ui.Density;
            var toggle = new PageAction { Label = title + (value > 0 ? ": on" : ": off") };
            card.Button(toggle, false, 8, 17);
            var rect = card.Take(Mathf.Max(BoardLayout.MinimumTouchDp * d, 44 * d), 4);
            var holder = ui.Rect<Image>(title + " slider", rect, shell.Page); holder.color = Color.clear;
            var track = ui.Rect<Image>("Track", new Rect(rect.x + 12 * d, rect.center.y - 7 * d, rect.width - 24 * d, 14 * d), holder.transform);
            track.color = ui.Art.Token(SkinTokens.Scrim);
            var fillArea = Holder("Fill area", SkinUi.ScreenRect(track.rectTransform), holder.transform);
            var fill = ui.Rect<Image>("Fill", SkinUi.ScreenRect(track.rectTransform), fillArea); fill.color = ui.Art.Token(SkinTokens.Positive);
            fill.rectTransform.anchorMin = Vector2.zero; fill.rectTransform.anchorMax = Vector2.one; fill.rectTransform.sizeDelta = Vector2.zero;
            float knob = 34 * d;
            var handleArea = Holder("Handle area", new Rect(rect.x + 12 * d + knob / 2, rect.y, rect.width - 24 * d - knob, rect.height), holder.transform);
            var handle = ui.Rect<Image>("Handle", new Rect(rect.x, rect.center.y - knob / 2, knob, knob), handleArea);
            handle.sprite = ui.Art.SkinUi(SkinSlots.Badge); handle.preserveAspect = true;
            handle.rectTransform.anchorMin = new Vector2(0, .5f); handle.rectTransform.anchorMax = new Vector2(0, .5f);
            handle.rectTransform.pivot = new Vector2(.5f, .5f); handle.rectTransform.anchoredPosition = Vector2.zero; handle.rectTransform.sizeDelta = new Vector2(knob, knob);
            var slider = holder.gameObject.AddComponent<Slider>(); slider.minValue = 0; slider.maxValue = 100; slider.wholeNumbers = true;
            slider.fillRect = fill.rectTransform; slider.handleRect = handle.rectTransform; slider.targetGraphic = handle;
            slider.SetValueWithoutNotify((float)Math.Round(value * 100));
            var percent = card.Text(title + " level", Math.Round(value * 100) + "%", 15, SkinTokens.TextMuted, false, 10);
            Action<double> apply = level => {
                actions.Run(() => set(level)); value = level;
                if (level > 0) { if (music) lastMusic = level; else lastEffects = level; }
                toggle.Label = title + (level > 0 ? ": on" : ": off");
                slider.SetValueWithoutNotify((float)Math.Round(level * 100)); percent.text = Math.Round(level * 100) + "%";
            };
            toggle.Invoke = () => apply(value > 0 ? 0 : music ? lastMusic : lastEffects);
            slider.onValueChanged.AddListener(next => apply(next / 100d));
        }

        // The Daily result: the guardian, the score, the day's objective in words
        // and the streak, with sharing. The tab bar leads back to the Daily.
        private void Result(ResultPageView value)
        {
            if (!value.HasResult)
            {
                column.Text("No result", "No result yet.", 18, SkinTokens.Text);
                column.Button(value.Done, false);
                return;
            }
            var realm = catalog.Realm(value.Realm);
            var card = column.Card("Result card");
            card.Medallion("Result guardian", ui.Art.Sprite("boss__idle"), 88, 6);
            card.Text("Result guardian name", realm.guardianName, 24, SkinTokens.Text, true, 10);
            card.Text("Score caption", "SCORE", 15, SkinTokens.Text, false, 0);
            card.Text("Score", value.Score.ToString("N0", CultureInfo.InvariantCulture), 44, SkinTokens.Score, true, 12);
            string objective = value.ObjectiveKind == 0 ? null : catalog.Objective(value.ObjectiveKind, value.ObjectiveValue).description;
            if (objective != null) card.Row("Objective", Sentence(objective), value.ObjectiveTotal.ToString("N0", CultureInfo.InvariantCulture));
            if (value.Streak.HasValue) card.Row("Streak", "Daily streak", Days(value.Streak.Value));
            if (!string.IsNullOrEmpty(value.Notice)) card.Text("Result notice", value.Notice, 15, SkinTokens.Text, false, 10);
            if (value.Share != null)
            {
                string text = ResultShareText.Build(value.ProductName, value.Mode, value.PlayerName, realm.guardianName, realm.realmName,
                    objective == null ? "Score only" : Sentence(objective), value.ObjectiveTotal, value.Score, value.Streak);
                card.Gap(4); card.Button(ShareAction(value, text, value.NativeSharing ? "Share result" : "Copy result"), true, 0);
            }
            column = card.End();
        }

        // A Campaign result: how the run ended, the stars it holds and what to do next.
        private void CampaignResult(ResultPageView value)
        {
            int stars = (value.StarSources & 1) + (value.StarSources >> 1 & 1) + (value.StarSources >> 2 & 1);
            string title = value.EndReason == 1 ? "LEVEL CLEARED!" : value.EndReason == 3 ? "RUN ENDED" : value.MovesLeft == 0 ? "OUT OF MOVES" : "BOARD FULL";
            var card = column.Card("Result card");
            card.Text("Result title", title, 22, SkinTokens.Accent, true, 14);
            card.Stars("Result stars", (byte)stars, 62, 16);
            card.Text("Score caption", "SCORE", 15, SkinTokens.Text, false, 0);
            card.Text("Score", value.Score.ToString("N0", CultureInfo.InvariantCulture), 44, SkinTokens.Score, true, 12);
            if (value.NewBest) card.Row("New best", "New best: " + stars + (stars == 1 ? " star" : " stars"), icon: SkinSlots.IconTrophy);
            if (value.Goals != null) Goals(card, value.Goals, value.Score, value.PrimaryProgress, value.StarSources);
            // The core keeps no stars from a run the player ends.
            card.Text("Result status", value.EndReason == 3 ? "An ended run keeps no stars · Try again" : stars == 3 ? "All three goals complete" :
                stars == 0 ? "No stars yet · Try again" : stars + (stars == 1 ? " star" : " stars") + " secured · Try again", 16, SkinTokens.Text, false, 12);
            if (!string.IsNullOrEmpty(value.Notice)) card.Text("Result notice", value.Notice, 15, SkinTokens.Text, false, 10);
            var realm = catalog.Realm(value.Realm);
            PageAction share = null;
            if (value.Share != null)
                share = ShareAction(value, ResultShareText.Build(value.ProductName, value.Mode, value.PlayerName, realm.guardianName,
                    realm.realmName, "Level " + Number(value.Realm, value.Level) + " stars", (ulong)stars, value.Score, null),
                    value.NativeSharing ? "Share" : "Copy");
            card.Button(stars == 3 ? value.Done : value.Retry, true);
            card.Pair(stars == 3 ? value.Retry : value.Done, share, 0);
            column = card.End();
        }
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
            var owned = portraits = new BoardArt(); var request = owned.LoadPortraits();
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
            if (countdown != null && countdownView?.Now != null)
            {
                long now = countdownView.Now();
                if (now != countdownSecond) { countdownSecond = now; countdown.text = Remaining(countdownView.ClosesAt - now); }
            }
            if (back != null && Input.GetKeyDown(KeyCode.Escape) && back.Available) actions.Run(back.Invoke);
        }

        private static string Remaining(long seconds)
        {
            seconds = Math.Max(0, seconds);
            return string.Format(CultureInfo.InvariantCulture, "{0:00}:{1:00}:{2:00} left", seconds / 3600, seconds / 60 % 60, seconds % 60);
        }
        private static string Sentence(string value) => string.IsNullOrEmpty(value) ? value : char.ToUpperInvariant(value[0]) + value.Substring(1);
        private static string Day(uint day) => DateTimeOffset.FromUnixTimeSeconds((long)day * 86400)
            .UtcDateTime.ToString("dd MMM yyyy '· UTC'", CultureInfo.InvariantCulture);
        private static RectTransform Holder(string name, Rect rect, Transform parent)
        {
            var holder = new GameObject(name, typeof(RectTransform)).GetComponent<RectTransform>();
            holder.SetParent(parent, false); SkinUi.Place(holder, rect, parent); return holder;
        }
        private static Rect ScreenOf(Component component) => SkinUi.ScreenRect((RectTransform)component.transform);

        public void Retire()
        {
            epoch++; sharing.Cancel(); sharing.Dispose(); sharing = new CancellationTokenSource();
            actions?.Clear(); back = null; countdown = null; countdownView = null;
            if (shell != null && shell.Page != null) foreach (var image in shell.Page.GetComponentsInChildren<Image>(true)) image.sprite = null;
            portraits?.Dispose(); portraits = null;
        }
        private void OnDestroy() { Retire(); ui?.Dispose(); sharing.Cancel(); sharing.Dispose(); }
    }
}
