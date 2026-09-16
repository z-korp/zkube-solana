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
    public sealed class AppPages : MonoBehaviour
    {
        private IAppPageSource source;
        private TMP_FontAsset heading, body;
        private float textScale;
        private Func<float> density;
        private RectTransform content;
        private PageCatalog catalog;
        private BoardArt portraits;
        private long epoch;
        private CancellationTokenSource sharing = new CancellationTokenSource();
        private readonly Dictionary<Button, PageAction> actions = new Dictionary<Button, PageAction>();
        private readonly Color ink = new Color(.07f, .12f, .2f), pale = new Color(1, .96f, .84f);
        private double lastMusic = AudioPolicy.ToggleOnLevel, lastEffects = AudioPolicy.ToggleOnLevel;
        private AppPage? previousPage;
        private string editedName, savedName;

        public void Initialize(IAppPageSource pageSource, TMP_FontAsset displayFont,
            TMP_FontAsset bodyFont, float scale, Func<float> displayDensity = null)
        {
            source = pageSource ?? throw new ArgumentNullException(nameof(pageSource));
            heading = displayFont; body = bodyFont;
            textScale = BoardController.SupportedTextScale(scale);
            density = displayDensity ?? BoardController.ReadDisplayDensity;
            if (catalog == null) catalog = PageCatalog.Load();
        }

        public void Render(AppPage page, RectTransform parent)
        {
            Retire(); content = parent;
            if (page == AppPage.Settings && previousPage != page)
            { lastMusic = AudioPolicy.ToggleOnLevel; lastEffects = AudioPolicy.ToggleOnLevel; }
            if (page != AppPage.Profile) { editedName = null; savedName = null; }
            previousPage = page;
            switch (page)
            {
                case AppPage.Campaign: Campaign(source.CampaignView()); break;
                case AppPage.Level: Level(source.LevelPage()); break;
                case AppPage.Daily: Daily(source.DailyPage()); break;
                case AppPage.Profile: Profile(source.ProfilePage()); break;
                case AppPage.Settings: Settings(source.SettingsPage()); break;
                case AppPage.Result: Result(source.ResultPage()); break;
                default: throw new ArgumentOutOfRangeException(nameof(page));
            }
        }

        public void Navigation(RectTransform parent)
        {
            foreach (var page in new[] { AppPage.Daily, AppPage.Campaign, AppPage.Profile, AppPage.Settings })
            {
                var target = page;
                Button(parent, new PageAction { Label = page.ToString(),
                    CanInvoke = () => source.CanNavigate(target), Invoke = () => source.Navigate(target) });
            }
            foreach (var action in source.IdentityNavigation) Button(parent, action);
        }

        private void Campaign(CampaignPageView value)
        {
            GetComponent<AppShell>()?.RequestRealm(value.Realm);
            var realm = catalog.Realm(value.Realm);
            Text("Campaign", 38, true); Text(realm.guardianName, 30, true);
            Text("Realm " + value.Realm + " · " + value.Stars + " / 30 stars", 20);
            var row = Row("Realms"); Button(row, value.Previous); Button(row, value.Next);
            Notice(value.Notice); Notice(value.SavedRun); Button(content, value.Resume); Button(content, value.Purchase);
            Button(content, value.Result);
            var map = Rect("Authored Campaign path", content);
            var path = map.gameObject.AddComponent<CampaignPathGraphic>();
            var states = new string[value.Trials.Length];
            float size = TouchSize(64 * textScale);
            Height(map, CampaignPathGraphic.RequiredMapHeight(realm, ContentWidth(), size, 660 * textScale));
            for (int index = 0; index < value.Trials.Length; index++)
            {
                var trial = value.Trials[index];
                var state = trial.Playing ? "playing" : trial.Stars > 0 ? "cleared" : trial.Available ? "current" : "locked";
                states[index] = state;
                var action = new PageAction { Label = (index == value.Trials.Length - 1 ? "BOSS" : trial.Level.ToString()) + "\n" + Stars(trial.Stars),
                    Name = "Trial " + trial.Level,
                    Enabled = trial.Available, CanInvoke = trial.CanOpen, Invoke = trial.Open };
                var button = Button(map, action); var rect = (RectTransform)button.transform;
                var point = realm.campaignPath[index];
                rect.anchorMin = rect.anchorMax = new Vector2(point.x, 1 - point.y);
                rect.pivot = new Vector2(.5f, .5f); rect.sizeDelta = new Vector2(size, size); rect.anchoredPosition = Vector2.zero;
                var label = button.GetComponentInChildren<TMP_Text>(); label.fontSize = 16 * textScale;
                label.textWrappingMode = TextWrappingModes.NoWrap; Stretch(label.rectTransform, 4 * textScale);
            }
            path.Configure(realm, states);
        }

        private void Level(LevelPageView value)
        {
            GetComponent<AppShell>()?.RequestRealm(value.Realm);
            Text(catalog.Realm(value.Realm).guardianName, 32, true);
            Text("Trial " + value.Level, 26, true); Text(Stars(value.Stars), 20);
            Text(value.Moves + " moves"); Text("Score · " + value.Score);
            Text("Shape · " + value.Primary); Text("Blow · " + value.Secondary);
            Notice(value.Notice); Button(content, value.Play); Button(content, value.Back);
        }

        private void Daily(DailyPageView value)
        {
            GetComponent<AppShell>()?.RequestRealm(value.Realm);
            Text("Daily", 38, true);
            var realm = catalog.Realm(value.Realm);
            var objective = catalog.Objective(value.ObjectiveKind, value.ObjectiveValue);
            Text(realm.realmName + " · " + realm.guardianName, 29, true);
            Text(objective.name, 25, true); Text(objective.description, 19);
            Text(Day(value.Day), 18); Notice(value.Status);
            foreach (var fact in value.Facts) Text(fact, 20);
            foreach (var action in value.Actions) Button(content, action);
        }

        private void Profile(ProfilePageView value)
        {
            GetComponent<AppShell>()?.RequestRealm(value.Realm);
            Text("Profile", 38, true);
            if (value.ChangeName == null) Text(value.Name, 26, true);
            else
            {
                if (savedName != value.Name) { savedName = value.Name; editedName = value.Name; }
                var holder = Rect("Player name", content); Height(holder, TouchSize(64));
                holder.gameObject.AddComponent<Image>().color = ink;
                var field = holder.gameObject.AddComponent<TMP_InputField>(); field.characterLimit = 24;
                var area = Rect("Text area", holder); Stretch(area, 12); area.gameObject.AddComponent<RectMask2D>();
                var label = Label(area, "", 24); Stretch(label.rectTransform);
                field.textViewport = area; field.textComponent = label; field.text = editedName;
                field.onValueChanged.AddListener(text => editedName = text);
                field.onSubmit.AddListener(text => Try(() => value.ChangeName(text)));
                Button(content, new PageAction { Label = "Save name", Invoke = () => value.ChangeName(field.text),
                    CanInvoke = () => field != null && !string.IsNullOrWhiteSpace(field.text) });
            }
            Notice(value.Worn);
            Text("Campaign · " + value.Stars + " / 300 stars · " + value.Streak + " day streak", 20);
            Text("Best Daily score · " + value.BestDailyScore.ToString("N0"), 20);
            foreach (var fact in value.Facts) Text(fact, 20);
            Notice(value.Notice);
            foreach (var action in value.Actions) Button(content, action);
            var images = new List<KeyValuePair<byte, Image>>();
            if (value.Emblems.Length != 0)
            {
                Text("Emblem", 26, true);
                int columns = textScale > 1 ? 2 : 3;
                float width = ContentWidth(), minimum = TouchSize(0);
                columns = Math.Min(columns, Math.Max(1, Mathf.FloorToInt((width + 8) / (minimum + 8))));
                float height = TouchSize(136 * textScale);
                var grid = Rect("Emblems", content);
                Height(grid, (float)Math.Ceiling(value.Emblems.Length / (double)columns) * (height + 8));
                var layout = grid.gameObject.AddComponent<GridLayoutGroup>();
                layout.constraint = GridLayoutGroup.Constraint.FixedColumnCount; layout.constraintCount = columns;
                layout.spacing = new Vector2(8, 8); layout.cellSize = new Vector2((width - (columns - 1) * 8) / columns, height);
                foreach (var choice in value.Emblems)
                {
                    var button = Button(grid, new PageAction { Name = "Emblem " + choice.Id,
                        Label = choice.Name + (choice.Detail == null ? "" : "\n" + choice.Detail),
                        Enabled = choice.Available, CanInvoke = choice.CanSelect, Invoke = choice.Select });
                    if (choice.Realm == 0) continue;
                    var rect = Rect("Guardian portrait", button.transform);
                    rect.anchorMin = new Vector2(0, .36f); rect.anchorMax = Vector2.one;
                    rect.offsetMin = new Vector2(6, 4); rect.offsetMax = new Vector2(-6, -6);
                    var image = rect.gameObject.AddComponent<Image>(); image.preserveAspect = true;
                    image.raycastTarget = false; image.enabled = false;
                    images.Add(new KeyValuePair<byte, Image>(choice.Realm, image));
                    var caption = button.GetComponentInChildren<TMP_Text>(); caption.fontSize = 17 * textScale;
                    caption.rectTransform.anchorMin = Vector2.zero; caption.rectTransform.anchorMax = new Vector2(1, .36f);
                    caption.rectTransform.offsetMin = caption.rectTransform.offsetMax = Vector2.zero;
                }
            }
            if (value.Borders.Length != 0) Text("Border", 26, true);
            foreach (var choice in value.Borders)
                Button(content, new PageAction { Name = "Border " + choice.Id,
                    Label = choice.Name + (choice.Detail == null ? "" : " · " + choice.Detail),
                    Enabled = choice.Available, CanInvoke = choice.CanSelect, Invoke = choice.Select });
            Button(content, value.Save); Button(content, value.Restore);
            if (images.Count != 0) StartCoroutine(LoadPortraits(images, epoch));
        }

        private void Settings(SettingsPageView value)
        {
            Text("Settings", 38, true);
            Volume("Music", value.Music, value.SetMusic, true);
            Volume("Effects", value.Effects, value.SetEffects, false);
            if (value.Muted) Button(content, new PageAction { Label = "Unmute all sound", Invoke = value.Unmute });
            Button(content, new PageAction { Label = "Reduced motion: " + (value.ReducedMotion ? "on" : "off"), Invoke = value.ToggleMotion });
            Button(content, new PageAction { Label = "Haptics: " + (value.Haptics ? "on" : "off"), Invoke = value.ToggleHaptics });
            Button(content, new PageAction { Label = "Text size: " + (value.LargeText ? "larger" : "standard"), Invoke = value.ToggleText });
        }

        private void Result(ResultPageView value)
        {
            Text(value.ProductName + " · " + value.Mode, 38, true);
            if (!value.HasResult) { Text("No result yet."); return; }
            GetComponent<AppShell>()?.RequestRealm(value.Realm);
            var realm = catalog.Realm(value.Realm);
            var objective = catalog.Objective(value.ObjectiveKind, value.ObjectiveValue).name;
            Text(realm.realmName + " · " + objective, 20); Text(value.PlayerName, 26, true);
            Text("“" + realm.guardianGreeting + "”", 20);
            if (value.Day != 0) Text(Day(value.Day), 18);
            Text("Score · " + value.Score.ToString("N0")); Text((value.ShowStars ? objective : "Theme") + " · " + value.ObjectiveTotal.ToString("N0"));
            if (value.ShowStars) Text(((value.StarSources & 1) != 0 ? "★" : "☆") +
                ((value.StarSources & 2) != 0 ? "★" : "☆") + ((value.StarSources & 4) != 0 ? "★" : "☆"));
            if (value.Streak.HasValue) Text("Streak · " + value.Streak.Value);
            Notice(value.Notice);
            if (value.Share != null)
            {
                string text = ResultShareText.Build(value.ProductName, value.Mode, value.PlayerName,
                    realm.guardianName, realm.realmName, objective, value.ObjectiveTotal, value.Score, value.Streak);
                var action = new PageAction { Label = value.NativeSharing ? "Share" : "Copy result" };
                action.Invoke = () => Share(value, text, action, epoch);
                Button(content, action);
            }
            Button(content, value.Done);
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

        private void Volume(string title, double value, Action<double> set, bool music)
        {
            var action = new PageAction { Label = title + (value > 0 ? ": on" : ": off") };
            Button(content, action);
            var holder = Rect(title + " slider", content); Height(holder, TouchSize(52));
            holder.gameObject.AddComponent<Image>().color = Color.clear;
            var slider = holder.gameObject.AddComponent<Slider>(); slider.minValue = 0; slider.maxValue = 100; slider.wholeNumbers = true;
            var track = Rect("Track", holder); track.anchorMin = new Vector2(0, .4f); track.anchorMax = new Vector2(1, .6f);
            track.offsetMin = new Vector2(12, 0); track.offsetMax = new Vector2(-12, 0); track.gameObject.AddComponent<Image>().color = ink;
            var area = Rect("Handle area", holder); Stretch(area, 12);
            var handle = Rect("Handle", area); handle.sizeDelta = new Vector2(30, 30);
            var image = handle.gameObject.AddComponent<Image>(); image.color = pale;
            slider.handleRect = handle; slider.targetGraphic = image; slider.SetValueWithoutNotify((float)Math.Round(value * 100));
            var percent = Text(Math.Round(value * 100) + "%", 18);
            Action<double> apply = level => {
                Try(() => set(level)); value = level;
                if (level > 0) { if (music) lastMusic = level; else lastEffects = level; }
                action.Label = title + (level > 0 ? ": on" : ": off");
                slider.SetValueWithoutNotify((float)Math.Round(level * 100)); percent.text = Math.Round(level * 100) + "%";
            };
            action.Invoke = () => apply(value > 0 ? 0 : music ? lastMusic : lastEffects);
            slider.onValueChanged.AddListener(next => apply(next / 100d));
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
            foreach (var pair in actions)
            {
                if (pair.Key == null) continue;
                pair.Key.interactable = pair.Value.Available;
                pair.Key.GetComponentInChildren<TMP_Text>().text = pair.Value.Label;
            }
        }

        private void Notice(string text) { if (!string.IsNullOrEmpty(text)) Text(text, 19); }
        private static string Stars(byte value) => new string('★', value) + new string('☆', 3 - value);
        private static string Day(uint day) => DateTimeOffset.FromUnixTimeSeconds((long)day * 86400)
            .UtcDateTime.ToString("dd MMM yyyy '· UTC'", CultureInfo.InvariantCulture);
        private TMP_Text Text(string value, float size = 22, bool title = false) => Label(content, value, size, title);
        public TMP_Text Label(Transform parent, string value, float size, bool title = false)
        {
            var rect = Rect(value ?? "Text", parent); var text = rect.gameObject.AddComponent<TextMeshProUGUI>();
            text.font = title ? heading : body; text.text = value; text.fontSize = size * textScale;
            text.color = pale; text.alignment = TextAlignmentOptions.Center;
            text.enableAutoSizing = false; text.richText = false; text.raycastTarget = false;
            text.textWrappingMode = TextWrappingModes.Normal;
            rect.gameObject.AddComponent<LayoutElement>().minHeight = size * textScale * 1.7f;
            return text;
        }
        public Button Button(Transform parent, PageAction action, bool observe = true)
        {
            if (action == null) return null;
            var rect = Rect(action.Name ?? action.Label, parent);
            float scale = parent.GetComponentInParent<Canvas>().scaleFactor;
            Height(rect, BoardLayout.CanvasTouchSize(60 * textScale, density(), scale));
            rect.GetComponent<LayoutElement>().minWidth = BoardLayout.CanvasTouchSize(0, density(), scale);
            var image = rect.gameObject.AddComponent<Image>(); image.color = new Color(.95f, .82f, .42f);
            var button = rect.gameObject.AddComponent<Button>(); button.targetGraphic = image;
            button.interactable = action.Available; button.onClick.AddListener(() => { if (action.Available) Try(action.Invoke); });
            var text = Label(rect, action.Label, 21); Stretch(text.rectTransform, 8); text.color = ink;
            if (observe) actions.Add(button, action); return button;
        }
        private RectTransform Row(string name)
        {
            var row = Rect(name, content); Height(row, TouchSize(60 * textScale));
            var group = row.gameObject.AddComponent<HorizontalLayoutGroup>(); group.spacing = 8;
            group.childControlWidth = group.childControlHeight = group.childForceExpandWidth = true; return row;
        }
        private float TouchSize(float preferred) => BoardLayout.CanvasTouchSize(preferred, density(), content.GetComponentInParent<Canvas>().scaleFactor);
        private float ContentWidth()
        {
            Canvas.ForceUpdateCanvases();
            return content.rect.width - content.GetComponent<VerticalLayoutGroup>().padding.horizontal;
        }
        private void Try(Action action) { try { action?.Invoke(); } catch (Exception error) { source.Report(error); } }
        public static RectTransform Rect(string name, Transform parent)
        { var rect = new GameObject(name, typeof(RectTransform)).GetComponent<RectTransform>(); rect.SetParent(parent, false); return rect; }
        public static void Stretch(RectTransform rect, float inset = 0)
        { rect.anchorMin = Vector2.zero; rect.anchorMax = Vector2.one; rect.offsetMin = Vector2.one * inset; rect.offsetMax = -Vector2.one * inset; }
        public static void Height(RectTransform rect, float height)
        { var layout = rect.gameObject.AddComponent<LayoutElement>(); layout.minHeight = layout.preferredHeight = height; layout.flexibleWidth = 1; }
        public void Retire()
        {
            epoch++; sharing.Cancel(); sharing.Dispose(); sharing = new CancellationTokenSource();
            foreach (var button in actions.Keys.Where(button => button == null || content != null && button.transform.IsChildOf(content)).ToArray())
                actions.Remove(button);
            if (content != null) foreach (var image in content.GetComponentsInChildren<Image>(true)) image.sprite = null;
            portraits?.Dispose(); portraits = null;
        }
        private void OnDestroy() { Retire(); sharing.Cancel(); sharing.Dispose(); }
    }
}
