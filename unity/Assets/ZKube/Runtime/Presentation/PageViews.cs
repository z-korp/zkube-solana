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
        public const float TabBarDp = 78, GutterDp = 16, ColumnDp = 480, IconDp = 48;
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
            switch (page)
            {
                case AppPage.Daily:
                    var daily = source.DailyPage(); var brand = Brand();
                    Frame(page, brand[0], brand[1], null, null, Settings(), messages); Daily(daily); break;
                case AppPage.Campaign:
                    var campaign = source.CampaignView(); var realm = catalog.Realm(campaign.Realm);
                    Frame(page, realm.realmName, "REALM " + campaign.Realm + " / " + Protocol.Realms.Length,
                        campaign.Previous, campaign.Next, null, messages);
                    Campaign(campaign); break;
                case AppPage.Level:
                    var level = source.LevelPage();
                    Frame(page, catalog.Realm(level.Realm).realmName, "REALM " + level.Realm + " / " + Protocol.Realms.Length, level.Back, null, null, messages);
                    Level(level); break;
                case AppPage.Profile:
                    var profile = source.ProfilePage();
                    Frame(page, "PROFILE", null, null, null, Settings(), messages); Profile(profile); break;
                case AppPage.Settings:
                    var settings = source.SettingsPage();
                    Frame(page, "SETTINGS", null, new PageAction { Label = "Back", Name = "Back",
                        CanInvoke = () => source.CanNavigate(lastTab), Invoke = () => source.Navigate(lastTab) }, null, null, messages);
                    Settings(settings); break;
                case AppPage.Result:
                    var result = source.ResultPage();
                    Frame(page, result.HasResult ? result.Mode.ToUpperInvariant() + " COMPLETE" : result.Mode.ToUpperInvariant(), null, null, null, null, messages);
                    Result(result); break;
                default: throw new ArgumentOutOfRangeException(nameof(page));
            }
            shell.Finish(column.Top - 16 * ui.Density);
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

        // Header, body frame and tab bar for one page.
        private void Frame(AppPage page, string title, string subtitle, PageAction left, PageAction right, PageAction settings, string[] notices)
        {
            var safe = Screen.safeArea; float d = ui.Density;
            float icon = IconDp * d, titleWidth = safe.width - 2 * (icon + 24 * d);
            float titleHeight = ui.TextHeight(title, titleWidth, 24, true), subtitleHeight = subtitle == null ? 0 : ui.TextHeight(subtitle, titleWidth, 13, true);
            float header = Mathf.Max(icon + 20 * d, titleHeight + subtitleHeight + 18 * d);
            bool tabbed = TabIndex(page) >= 0;
            var tabBar = new Rect(safe.x + 4 * d, safe.y + 4 * d, safe.width - 8 * d, TabBarDp * d);
            float bottom = tabbed ? tabBar.yMax : safe.y;
            var body = new Rect(safe.x, bottom, safe.width, safe.yMax - header - bottom);
            shell.Clear(body);
            shell.Backdrop(ui.Art.SkinRealm(SkinSlots.Background), .92f);
            var chrome = shell.Chrome;
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
            if (tabbed) TabBar(tabBar, page);
            float width = Mathf.Min(body.width - 2 * GutterDp * d, ColumnDp * d);
            column = new PageColumn(ui, shell.Page, actions, body.center.x - width / 2, width, body.yMax - 4 * d);
            foreach (var notice in notices) column.Note("Notice", notice);
        }
        private void HeaderButton(PageAction action, Rect rect, string icon, bool mirrored)
        {
            var button = ui.IconButton(action.Name ?? action.Label, rect, icon, actions.Click(action), shell.Chrome, false, out var glyph, out _);
            if (mirrored)
            {
                var glyphRect = glyph.rectTransform;
                glyphRect.pivot = new Vector2(.5f, .5f); glyphRect.anchoredPosition += glyphRect.sizeDelta / 2;
                glyphRect.localScale = new Vector3(-1, 1, 1);
            }
            actions.Bind(button, action);
        }
        private void TabBar(Rect rect, AppPage page)
        {
            float d = ui.Density, inset = 18 * d, width = (rect.width - 2 * inset) / tabs.Length;
            ui.Piece("Tab bar", SkinSlots.TabBar, rect, shell.Chrome).raycastTarget = true;
            for (int i = 0; i < tabs.Length; i++)
            {
                var target = tabs[i];
                string label = target == AppPage.Daily ? dailyTab : target.ToString();
                var cell = new Rect(rect.x + inset + i * width, rect.y + 8 * d, width, rect.height - 16 * d);
                if (TabIndex(page) == i)
                    ui.Piece(label + " tab selected", SkinSlots.TabSelected, new Rect(cell.x + 2 * d, cell.y - 2 * d, cell.width - 4 * d, cell.height + 4 * d), shell.Chrome);
                var hit = ui.Rect<Image>(label, cell, shell.Chrome); hit.color = Color.clear; hit.raycastTarget = true;
                var button = hit.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None; button.targetGraphic = hit;
                var action = new PageAction { Label = label, Name = label, CanInvoke = () => source.CanNavigate(target), Invoke = () => source.Navigate(target) };
                ui.Label(label + " label", label, cell, 15, SkinTokens.Text, hit.transform, true);
                actions.Wire(button, action);
            }
        }
        private static int TabIndex(AppPage page) =>
            page == AppPage.Campaign || page == AppPage.Level ? 0 : page == AppPage.Daily || page == AppPage.Result ? 1 : page == AppPage.Profile ? 2 : -1;

        // Home: today's Daily, then the Campaign realm in progress.
        private void Daily(DailyPageView value)
        {
            var realm = catalog.Realm(value.Realm);
            var card = column.Card("Daily card");
            card.Text("Daily heading", "TODAY'S DAILY", 19, SkinTokens.Accent, true, 10);
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
            var campaign = source.CampaignView();
            if (campaign == null) return;
            var world = catalog.Realm(campaign.Realm);
            card = column.Card("Campaign card");
            card.Text("Campaign heading", "CAMPAIGN", 19, SkinTokens.Accent, true, 8);
            card.Text("Campaign realm", world.realmName, 24, SkinTokens.Text, true, 6);
            int cleared = campaign.Trials.Count(trial => trial.Stars > 0);
            card.Text("Campaign levels", cleared + " / " + campaign.Trials.Length + " levels complete", 17, SkinTokens.Text, false, 6);
            StarCount(card, campaign.Stars + " / " + campaign.Trials.Length * 3 + " stars");
            card.Gap(10);
            card.Button(new PageAction { Label = "Explore map", Name = "Explore map",
                CanInvoke = () => source.CanNavigate(AppPage.Campaign), Invoke = () => source.Navigate(AppPage.Campaign) }, false);
            column = card.End();
        }
        private void StarCount(PageColumn card, string text)
        {
            float d = ui.Density, star = 26 * d, width = ui.TextWidth(text, 17, false);
            var rect = card.Take(Mathf.Max(star, ui.TextHeight(text, card.Width, 17, false)), 6);
            float x = card.Left + (card.Width - star - 8 * d - width) / 2;
            ui.Piece("Campaign star", SkinSlots.StarOn, new Rect(x, rect.center.y - star / 2, star, star), shell.Page);
            ui.Label("Campaign stars", text, new Rect(x + star + 8 * d, rect.y, width, rect.height), 17, SkinTokens.Text, shell.Page, false, TextAlignmentOptions.Left);
        }

        // The realm path with one node per level.
        private void Campaign(CampaignPageView value)
        {
            var realm = catalog.Realm(value.Realm);
            if (!string.IsNullOrEmpty(value.Notice)) column.Text("Campaign notice", value.Notice, 15, SkinTokens.Text);
            if (!string.IsNullOrEmpty(value.SavedRun)) column.Text("Saved run", value.SavedRun, 15, SkinTokens.Text);
            column.Button(value.Resume, true); column.Button(value.Purchase, true); column.Button(value.Result, false);
            float d = ui.Density, node = 64 * d, guardian = 84 * d;
            var map = column.Take(Mathf.Max(560 * d * textScale, 10 * (node + 30 * d * textScale)), 0);
            var area = new Rect(map.x + guardian / 2, map.y + guardian / 2, map.width - guardian, map.height - guardian);
            for (int index = 0; index < value.Trials.Length; index++)
            {
                var trial = value.Trials[index];
                bool boss = index == value.Trials.Length - 1;
                var point = realm.campaignPath[index];
                var center = new Vector2(area.x + point.x * area.width, area.yMax - point.y * area.height);
                float size = boss ? guardian : node;
                string slot = boss ? SkinSlots.MapNodeGuardian : trial.Stars > 0 ? SkinSlots.MapNodeDone : trial.Available ? SkinSlots.MapNodeOpen : SkinSlots.MapNodeLocked;
                var rect = new Rect(center.x - size / 2, center.y - size / 2, size, size);
                var face = ui.Piece("Trial " + trial.Level, slot, rect, shell.Page); face.raycastTarget = true;
                var button = face.gameObject.AddComponent<Button>(); button.targetGraphic = face;
                var action = new PageAction { Name = "Trial " + trial.Level, Enabled = trial.Available, CanInvoke = trial.CanOpen, Invoke = trial.Open };
                string number = ((value.Realm - 1) * value.Trials.Length + trial.Level).ToString(CultureInfo.InvariantCulture);
                if (slot == SkinSlots.MapNodeOpen)
                    ui.Label("Trial " + trial.Level + " number", number, rect, 20, SkinTokens.TextOnPrimary, face.transform, true);
                else
                {
                    float w = ui.TextWidth(number, 14, true), h = ui.TextHeight(number, w, 14, true);
                    ui.Label("Trial " + trial.Level + " number", number, new Rect(rect.xMax, rect.center.y - h / 2, w, h), 14, SkinTokens.Text, face.transform, true);
                }
                if (trial.Stars > 0 || trial.Playing)
                {
                    float star = 18 * d;
                    for (int i = 0; i < 3; i++)
                        ui.Piece("Trial " + trial.Level + " star " + (i + 1), i < trial.Stars ? SkinSlots.StarOn : SkinSlots.StarOff,
                            new Rect(center.x - 1.5f * star + i * star, rect.y - star * .8f, star, star), face.transform);
                }
                actions.Wire(button, action, fade: false);
            }
        }

        private void Level(LevelPageView value)
        {
            var realm = catalog.Realm(value.Realm);
            var card = column.Card("Level card");
            card.Text("Level title", "LEVEL " + ((value.Realm - 1) * Protocol.CampaignTargets.Length + value.Level), 28, SkinTokens.Accent, true, 4);
            card.Text("Level realm", realm.realmName + " · " + realm.guardianName, 17, SkinTokens.Text, false, 8);
            card.Stars("Best stars", value.Stars, 30, 12);
            Goal(card, "Score goal", "Reach " + value.Score);
            Goal(card, "Shape goal", value.Primary);
            Goal(card, "Blow goal", value.Secondary);
            card.Gap(6);
            card.Text("Level moves", value.Moves + " moves", 20, SkinTokens.Accent, true, 8);
            if (!string.IsNullOrEmpty(value.Notice)) card.Text("Level notice", value.Notice, 15, SkinTokens.Text);
            card.Gap(6);
            card.Button(value.Play, true);
            column = card.End();
        }
        private void Goal(PageColumn card, string name, string text)
        {
            float d = ui.Density, star = 28 * d, inner = card.Width - star - 72 * d;
            var rect = card.Take(Mathf.Max(PageColumn.RowDp * d, ui.TextHeight(text, inner, 16, false) + 20 * d), 10);
            ui.Piece(name, SkinSlots.Plate, rect, shell.Page);
            ui.Piece(name + " star", SkinSlots.StarOn, new Rect(rect.x + 26 * d, rect.center.y - star / 2, star, star), shell.Page);
            ui.Label(name + " text", text, new Rect(rect.x + star + 36 * d, rect.y, inner, rect.height), 16, SkinTokens.Text, shell.Page, false, TextAlignmentOptions.Left);
        }

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

        private void Result(ResultPageView value)
        {
            if (!value.HasResult)
            {
                column.Text("No result", "No result yet.", 18, SkinTokens.Text);
                column.Button(value.Done, false);
                return;
            }
            var realm = catalog.Realm(value.Realm);
            string objective = catalog.ObjectiveName(value.ObjectiveKind, value.ObjectiveValue);
            var card = column.Card("Result card");
            card.Medallion("Result guardian", ui.Art.Sprite("boss__idle"), 88, 6);
            card.Text("Result guardian name", realm.guardianName, 24, SkinTokens.Text, true, 4);
            if (value.Day != 0) card.Text("Result day", Day(value.Day), 14, SkinTokens.TextMuted, false, 8);
            card.Text("Score caption", "SCORE", 15, SkinTokens.Text, false, 0);
            card.Text("Score", value.Score.ToString("N0", CultureInfo.InvariantCulture), 44, SkinTokens.Score, true, 10);
            if (value.ShowStars) card.Stars("Result stars", (byte)((value.StarSources & 1) + ((value.StarSources >> 1) & 1) + ((value.StarSources >> 2) & 1)), 36, 10);
            card.Row("Theme", value.ShowStars ? objective : objective == "CLASSIC" ? "Theme" : objective, value.ObjectiveTotal.ToString("N0", CultureInfo.InvariantCulture));
            if (value.Streak.HasValue) card.Row("Streak", "Daily streak", value.Streak.Value + (value.Streak.Value == 1 ? " day" : " days"));
            if (!string.IsNullOrEmpty(value.Notice)) card.Text("Result notice", value.Notice, 15, SkinTokens.Text);
            card.Text("Greeting", "“" + realm.guardianGreeting + "”", 14, SkinTokens.TextMuted, false, 10);
            if (value.Share != null)
            {
                string text = ResultShareText.Build(value.ProductName, value.Mode, value.PlayerName,
                    realm.guardianName, realm.realmName, objective, value.ObjectiveTotal, value.Score, value.Streak);
                var action = new PageAction { Label = value.NativeSharing ? "Share" : "Copy result" };
                action.Invoke = () => Share(value, text, action, epoch);
                card.Button(action, true);
            }
            card.Button(value.Done, value.Share == null);
            column = card.End();
        }
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
