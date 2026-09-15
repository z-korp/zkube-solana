using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Local.Billing;
using ZKube.Presentation;

namespace ZKube.Local.App
{
    // Explicit composition only: the root-owned startup supplies the one local
    // store/client/billing lifetime and the board instance. No runtime installer.
    public sealed class StoreAppController : MonoBehaviour
    {
        public StoreAppFlow Flow { get; private set; }
        public bool PageReady { get; private set; }
        private BoardController board;
        private Camera pageCamera;
        private BoardArt art;
        private GameObject pageRoot, warningRoot;
        private RectTransform safe, content;
        private TMP_Text warning;
        private TMP_InputField name;
        private bool loading, dirty, lastBusy, lastUnsaved;
        private uint lastDay;
        private LocalProductState lastProduct;
        private Rect lastSafe;
        private Vector2Int lastSize;
        private Exception lastFulfillment;
        private PageCatalog pages;
        private BoardArt portraitArt;
        private long pageEpoch;
        private int pendingEmblems;
        private CancellationTokenSource sharing = new CancellationTokenSource();
        private StorePage previousPage;
        private float? injectedDensity;
        private double lastMusic = AudioPolicy.ToggleOnLevel, lastEffects = AudioPolicy.ToggleOnLevel;
        private readonly Color pale = new Color(1, .96f, .84f), panel = new Color(.06f, .10f, .17f, .95f);
        private float TextScale => board.TextScale > 1 ? 1.3f : 1;

        public void Initialize(LocalProductStore product, LocalRunClient runs, CampaignBilling billing, BoardController boardController, float? displayDensity = null)
        {
            if (Flow != null) throw new InvalidOperationException("Store app was already initialized");
            board = boardController ?? throw new ArgumentNullException(nameof(boardController));
            injectedDensity = displayDensity;
            Flow = new StoreAppFlow(product, runs, billing);
            if (EventSystem.current == null || EventSystem.current.transform.IsChildOf(board.transform))
                throw new InvalidOperationException("Startup must create a shared EventSystem outside the board object");
            // Overlay UI still needs a defined backbuffer on Android Vulkan.
            // This camera clears only; the board owns its rendering while open.
            pageCamera = new GameObject("Store page background", typeof(Camera)).GetComponent<Camera>();
            pageCamera.transform.SetParent(transform, false);
            pageCamera.clearFlags = CameraClearFlags.SolidColor;
            pageCamera.backgroundColor = panel; pageCamera.cullingMask = 0;
            pageCamera.depth = -100; pageCamera.allowHDR = false; pageCamera.allowMSAA = false;
            Flow.Changed += Refresh; Flow.BoardOpened += OpenBoard;
            board.ExitRequested += ExitBoard; board.Accepted += Accepted; board.Rejected += Rejected;
            board.gameObject.SetActive(false);
            warningRoot = CanvasRoot("Unsaved progress", 80);
            var banner = Rect("Save warning", warningRoot.transform);
            banner.anchorMin = new Vector2(0, 1); banner.anchorMax = Vector2.one; banner.pivot = new Vector2(.5f, 1);
            banner.sizeDelta = new Vector2(0, 76); banner.gameObject.AddComponent<Image>().color = new Color(.35f, .12f, .03f, .98f);
            warning = Label(banner, "Progress is not saved. Keep the app open; closing it may lose this result.", 18, 68);
            Stretch(warning.rectTransform, 14);
            warningRoot.SetActive(false); Refresh();
            _ = Flow.RefreshBilling();
        }
        private void Update()
        {
            if (Flow == null) return;
            Flow.ObservePersistence();
            var today = Flow.Today.DayId;
            bool busy = Flow.Billing.Busy;
            if (!ReferenceEquals(lastProduct, Flow.Product.Read) || lastDay != today || lastBusy != busy ||
                lastUnsaved != Flow.Unsaved || lastSafe != Screen.safeArea || lastSize != new Vector2Int(Screen.width, Screen.height) ||
                !ReferenceEquals(lastFulfillment, Flow.Billing.LastFulfillmentError))
            {
                lastProduct = Flow.Product.Read; lastDay = today; lastBusy = busy; lastUnsaved = Flow.Unsaved;
                lastSafe = Screen.safeArea; lastSize = new Vector2Int(Screen.width, Screen.height);
                lastFulfillment = Flow.Billing.LastFulfillmentError; Refresh();
            }
            if (dirty && !loading && Flow.Page != StorePage.Board) StartCoroutine(Render());
        }
        private byte PageRealm => Flow.Page == StorePage.Daily ? Flow.Today.Realm :
            Flow.Page == StorePage.Result && Flow.Product.Read.DailyAttempt != null ? (byte)Flow.Product.Read.DailyAttempt.Realm :
            Flow.Page == StorePage.Profile ? (byte)Math.Max(1, Flow.Product.Read.WornEmblem) : Flow.Realm;
        private void Refresh()
        {
            if (this == null || Flow == null) return;
            if (previousPage != Flow.Page)
            {
                if (Flow.Page == StorePage.Settings) { lastMusic = AudioPolicy.ToggleOnLevel; lastEffects = AudioPolicy.ToggleOnLevel; }
                previousPage = Flow.Page;
            }
            dirty = true; PageReady = false;
            if (pageCamera != null) pageCamera.enabled = Flow.Page != StorePage.Board;
            if (pageRoot != null) pageRoot.SetActive(Flow.Page != StorePage.Board);
            if (warningRoot != null)
            {
                warningRoot.SetActive(Flow.Unsaved);
                var rect = (RectTransform)warning.transform.parent;
                rect.anchorMin = new Vector2(Screen.safeArea.xMin / Screen.width, Screen.safeArea.yMax / Screen.height);
                rect.anchorMax = new Vector2(Screen.safeArea.xMax / Screen.width, Screen.safeArea.yMax / Screen.height);
                rect.anchoredPosition = Vector2.zero;
            }
        }
        private IEnumerator Render()
        {
            loading = true; dirty = false;
            byte realm = PageRealm; StorePage page = Flow.Page;
            if (art == null || art.RealmId != realm)
            {
                // Clear Images before replacing the realm; keep the common
                // atlas and fonts owned across page transitions.
                RetirePage();
                yield return null;
                if (art == null) art = new BoardArt();
                var iterator = art.Load(realm);
                while (true)
                {
                    bool more;
                    try { more = iterator.MoveNext(); }
                    catch (Exception error) { loading = false; DrawLoadError(error); yield break; }
                    if (!more) break;
                    yield return iterator.Current;
                }
            }
            loading = false;
            if (this == null || Flow == null) yield break;
            if (Flow.Page != page || PageRealm != realm) { dirty = true; yield break; }
            try { Draw(); PageReady = pendingEmblems == 0; }
            catch (Exception error) { DrawLoadError(error); }
        }
        private void DrawLoadError(Exception error)
        {
            // A missing imported asset is an explicit retry page, not an
            // exception-driven per-frame load loop.
            dirty = false; PageReady = false;
            RetirePage();
            pageRoot = CanvasRoot("Page unavailable", 20);
            content = Rect("Failure", pageRoot.transform); Stretch(content, 24);
            var group = content.gameObject.AddComponent<VerticalLayoutGroup>(); group.childForceExpandHeight = false; group.spacing = 16;
            Text("This page could not be opened.", 28, true); Text(error.Message, 18);
            Button(content, "Try again", () => { art?.Dispose(); art = null; Refresh(); });
        }
        private void Draw()
        {
            if (pages == null) pages = PageCatalog.Load();
            string typed = name == null ? null : name.text;
            RetirePage();
            pageRoot = CanvasRoot("Store " + Flow.Page, 20);
            var bg = Rect("Realm backdrop", pageRoot.transform); Stretch(bg);
            var background = bg.gameObject.AddComponent<Image>(); background.sprite = art.Sprite("background"); background.color = new Color(.4f, .4f, .4f);
            safe = Rect("Safe content", pageRoot.transform);
            safe.anchorMin = new Vector2(Screen.safeArea.xMin / Screen.width, Screen.safeArea.yMin / Screen.height);
            safe.anchorMax = new Vector2(Screen.safeArea.xMax / Screen.width, Screen.safeArea.yMax / Screen.height);
            safe.offsetMin = new Vector2(18, 18); safe.offsetMax = new Vector2(-18, Flow.Unsaved ? -92 : -18);
            var scroll = safe.gameObject.AddComponent<ScrollRect>(); scroll.horizontal = false; scroll.movementType = ScrollRect.MovementType.Clamped;
            var viewport = Rect("Viewport", safe); Stretch(viewport); viewport.gameObject.AddComponent<RectMask2D>();
            // Empty space must receive drag events too, not only child buttons.
            viewport.gameObject.AddComponent<Image>().color = Color.clear;
            content = Rect("Page", viewport); content.anchorMin = new Vector2(0, 1); content.anchorMax = Vector2.one;
            content.pivot = new Vector2(.5f, 1); content.sizeDelta = Vector2.zero;
            var layout = content.gameObject.AddComponent<VerticalLayoutGroup>(); layout.spacing = 12; layout.childControlHeight = true;
            layout.childControlWidth = true; layout.childForceExpandHeight = false; layout.padding = new RectOffset(8, 8, 8, 20);
            content.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.viewport = viewport; scroll.content = content;
            switch (Flow.Page)
            {
                case StorePage.Name: NameGate(typed); break;
                case StorePage.Daily: Daily(); break;
                case StorePage.Campaign: Campaign(); break;
                case StorePage.Level: Level(); break;
                case StorePage.Profile: Profile(); break;
                case StorePage.Settings: Settings(); break;
                case StorePage.Result: Result(); break;
            }
            if (!string.IsNullOrEmpty(Flow.Error)) Text(Flow.Error, 19);
            if (Flow.Billing.Busy) Text("A store operation is still in progress.", 18);
            else if (!string.IsNullOrEmpty(Flow.BillingNotice)) Text(Flow.BillingNotice, 18);
            if (Flow.Billing.LastFulfillmentError != null) Text("Store confirmation needs attention. Restore purchases to retry.", 18);
            if (Flow.Page != StorePage.Name)
            {
                var nav = Row("Navigation");
                Button(nav, "Daily", () => Flow.Show(StorePage.Daily)); Button(nav, "Campaign", () => Flow.Show(StorePage.Campaign));
                Button(nav, "Profile", () => Flow.Show(StorePage.Profile));
                Button(content, "Settings", () => Flow.Show(StorePage.Settings));
            }
        }
        private void NameGate(string typed)
        {
            Text("Welcome to zKube", 36, true); Portrait();
            Text("Pick the name shown with your progress. It stays on this device.");
            var holder = Rect("Player name", content); Height(holder, TouchSize(64)); holder.gameObject.AddComponent<Image>().color = panel;
            name = holder.gameObject.AddComponent<TMP_InputField>(); name.characterLimit = 24;
            var area = Rect("Text area", holder); Stretch(area, 12); area.gameObject.AddComponent<RectMask2D>();
            var value = Label(area, "", 24, 50); Stretch(value.rectTransform);
            var placeholder = Label(area, "Name", 24, 50); Stretch(placeholder.rectTransform); placeholder.color = new Color(1, 1, 1, .45f);
            name.textViewport = area; name.textComponent = value; name.placeholder = placeholder; name.text = typed ?? "";
            var play = Button(content, "Play", () => Flow.SetName(name.text), !string.IsNullOrWhiteSpace(name.text));
            name.onValueChanged.AddListener(text => play.interactable = !string.IsNullOrWhiteSpace(text));
            name.onSubmit.AddListener(text => Try(() => Flow.SetName(text)));
        }
        private void Daily()
        {
            Text("Arcade", 38, true); Portrait(); Text("Daily challenge", 20); Text(art.GuardianName, 32, true);
            var today = Flow.Today; var objective = pages.Objective(today.ObjectiveKind, today.ObjectiveValue);
            Text(objective.name, 24); Text(objective.description, 20);
            Text(DateTimeOffset.FromUnixTimeSeconds(today.OpensAt).UtcDateTime.ToString("dd MMM yyyy '· UTC'"), 18);
            Button(content, Flow.DailyAction, Flow.PlayDaily);
            Text("One attempt today. Play it while the app stays open.", 18);
        }
        private void Campaign()
        {
            Text("Campaign", 38, true); Text(art.GuardianName, 30, true);
            Text($"Realm {Flow.Realm} · {Flow.Stars(Flow.Realm)} / 30 stars", 20);
            var realmRow = Row("Realms");
            Button(realmRow, "Previous", () => Flow.SelectRealm((byte)(Flow.Realm - 1)), Flow.Realm > 1);
            Button(realmRow, "Next", () => Flow.SelectRealm((byte)(Flow.Realm + 1)), Flow.Realm < Protocol.Realms.Length);
            string locked = Flow.Runs.CampaignLock(Flow.Realm);
            if (locked == "purchase") Button(content, "Unlock the full Campaign" + (Flow.Product.Read.CampaignPrice == null ? "" : " · " + Flow.Product.Read.CampaignPrice), () => _ = Flow.RefreshBilling(purchase: true), !Flow.Billing.Busy);
            else if (locked == "stars") Text("Defeat the previous guardian. Clear its final trial to open this path.");
            var map = Rect("Authored Campaign path", content);
            var path = map.gameObject.AddComponent<CampaignPathGraphic>();
            var definition = pages.Realm(Flow.Realm); var states = new string[10];
            float nodeSize = TouchSize(64 * TextScale);
            float mapWidth = ContentWidth();
            Height(map, CampaignPathGraphic.RequiredMapHeight(definition, mapWidth, nodeSize, 660 * TextScale));
            var active = Flow.Runs.Active("campaign");
            for (byte n = 1; n <= Protocol.CampaignTargets.Length; n++)
            {
                byte level = n; int stars = Flow.Product.Read.Stars[(Flow.Realm - 1) * Protocol.CampaignTargets.Length + level - 1];
                bool available = Flow.LevelAvailable(Flow.Realm, level);
                states[n - 1] = active?.Realm == Flow.Realm && active.Level == level ? "playing" : stars > 0 ? "cleared" : available ? "current" : "locked";
                string label = (level == Protocol.CampaignTargets.Length ? "BOSS" : level.ToString()) + "\n" + new string('★', stars) + new string('☆', 3 - stars);
                var node = Button(map, label, () => Flow.Preview(level), available);
                var rect = (RectTransform)node.transform; var point = definition.campaignPath[level - 1];
                rect.anchorMin = rect.anchorMax = new Vector2(point.x, 1 - point.y); rect.pivot = new Vector2(.5f, .5f);
                rect.sizeDelta = new Vector2(nodeSize, nodeSize); rect.anchoredPosition = Vector2.zero;
                // A path node has two fixed rows, unlike a full-width action.
                // Keep its title and all three stars inside the same hit tile.
                var caption = node.GetComponentInChildren<TMP_Text>();
                caption.fontSize = 16 * TextScale; caption.textWrappingMode = TextWrappingModes.NoWrap;
                Stretch(caption.rectTransform, 4 * TextScale);
                node.name = "Trial " + level + " · " + states[n - 1] + " · " + stars + " stars";
            }
            path.Configure(definition, states);
        }
        private void Level()
        {
            var realm = Protocol.Realms.Single(value => value.MapId == Flow.Realm); var level = realm.Levels[Flow.Level - 1];
            Text(art.GuardianName, 32, true); Portrait(); Text("Trial " + Flow.Level, 26, true);
            Text(NativeEngine.CampaignMoveBudget(Flow.Level, level.Tier) + " moves");
            Text("Score · " + Protocol.CampaignTargets[Flow.Level - 1] + " points");
            Text("Shape · " + BoardView.ObjectiveName(level.Primary[0], level.Primary[1]) + " · " + level.Primary[2]);
            Text("Blow · " + BoardView.ObjectiveName(level.Secondary[0], level.Secondary[1]) + " · " + level.Secondary[2]);
            Button(content, Flow.Runs.Active("campaign") == null ? "Play" : "Resume run", Flow.PlayCampaign);
            Button(content, "Back to map", () => Flow.Show(StorePage.Campaign));
        }
        private void Profile()
        {
            var state = Flow.Product.Read; Text("Profile", 38, true); Portrait(); Text(state.Name, 30, true);
            Text(state.Stars.Sum(value => (int)value) + " stars · " + state.Streak + " day streak"); Text("Best Daily score · " + state.BestDailyScore);
            var earned = Protocol.Realms.Where(realm => Flow.Cleared(realm.MapId)).ToArray();
            if (earned.Length > 0)
            {
                var images = new Dictionary<byte, Image>();
                Text("Guardian emblem", 20);
                int columns = TextScale > 1 ? 2 : 3;
                float available = ContentWidth(), minimum = TouchSize(0);
                if (available < minimum) throw new InvalidOperationException("Guardian emblems need a wider view.");
                columns = Math.Min(columns, Math.Max(1, Mathf.FloorToInt((available + 8) / (minimum + 8))));
                float cellHeight = TouchSize(136 * TextScale);
                var grid = Rect("Earned guardians", content); Height(grid, (float)Math.Ceiling(earned.Length / (double)columns) * (cellHeight + 8));
                var layout = grid.gameObject.AddComponent<GridLayoutGroup>(); layout.constraint = GridLayoutGroup.Constraint.FixedColumnCount; layout.constraintCount = columns;
                layout.spacing = new Vector2(8, 8); layout.cellSize = new Vector2((available - (columns - 1) * 8) / columns, cellHeight);
                foreach (var realm in earned)
                {
                    byte id = realm.MapId; var data = pages.Realm(id);
                    var button = Button(grid, "", () => Flow.Wear(id)); button.name = "Wear " + data.guardianName;
                    var imageRect = Rect("Emblem " + data.guardianName, button.transform); imageRect.anchorMin = new Vector2(0, .3f); imageRect.anchorMax = Vector2.one;
                    imageRect.offsetMin = new Vector2(6, 4); imageRect.offsetMax = new Vector2(-6, -6);
                    var image = imageRect.gameObject.AddComponent<Image>(); image.preserveAspect = true; image.raycastTarget = false; image.enabled = false;
                    var caption = Label(button.transform, data.guardianName + (state.WornEmblem == id ? " · Worn" : ""), 17, 30);
                    caption.rectTransform.anchorMin = Vector2.zero; caption.rectTransform.anchorMax = new Vector2(1, .3f);
                    caption.rectTransform.offsetMin = Vector2.zero; caption.rectTransform.offsetMax = Vector2.zero; caption.color = panel;
                    images.Add(id, image);
                }
                StartCoroutine(LoadEmblems(images, pageEpoch));
            }
            Button(content, "Restore purchases", () => _ = Flow.RefreshBilling(restore: true), !Flow.Billing.Busy);
        }
        private void Settings()
        {
            Text("Settings", 38, true);
            Volume("Music", board.MusicVolume, board.SetMusicVolume, true);
            Volume("Effects", board.EffectsVolume, board.SetEffectsVolume, false);
            if (board.Muted) Button(content, "Unmute all sound", () => { board.SetMuted(false); Refresh(); });
            Button(content, "Reduced motion: " + (board.ReducedMotion ? "on" : "off"), () => { board.SetReducedMotion(!board.ReducedMotion); Refresh(); });
            Button(content, "Haptics: " + (board.Haptics ? "on" : "off"), () => { board.SetHaptics(!board.Haptics); Refresh(); });
            Button(content, "Text size: " + (board.TextScale > 1 ? "larger" : "standard"), () => { board.SetTextScale(board.TextScale > 1 ? 1 : 1.3f); Refresh(); });
        }
        private void Result()
        {
            Text("zKube Daily", 38, true); Portrait(); var attempt = Flow.Product.Read.DailyAttempt;
            if (attempt == null) { Text("No Daily result yet."); return; }
            var data = pages.Realm((byte)attempt.Realm); string objective = pages.Objective((byte)attempt.ObjectiveKind, (byte)attempt.ObjectiveValue).name;
            Text(data.realmName + " · " + objective, 20); Text(Flow.Product.Read.Name, 26, true);
            Text("“" + data.guardianGreeting + "”", 20);
            Text(DateTimeOffset.FromUnixTimeSeconds((long)attempt.DayId * 86400).UtcDateTime.ToString("dd MMM yyyy '· UTC'"), 18);
            Text("Score · " + attempt.DailyScore.ToString("N0")); Text("Theme · " + attempt.ObjectiveTotal); Text("Streak · " + Flow.Product.Read.Streak);
            if (!attempt.Finished) Text("Attempt used. This run is no longer open in this app session.");
            string shareText = StoreShareText.Build(Flow.Product.Read.Name, data.guardianName, data.realmName, objective,
                attempt.ObjectiveTotal, attempt.DailyScore, Flow.Product.Read.Streak);
            Button share = null;
            share = Button(content, StoreResultSharing.NativeAvailable ? "Share" : "Copy result", () => Share(shareText, share, pageEpoch));
            Button(content, "Done", () => Flow.Show(StorePage.Daily));
        }
        private IEnumerator LoadEmblems(Dictionary<byte, Image> images, long epoch)
        {
            pendingEmblems = 1;
            var owned = portraitArt = new BoardArt(); var request = owned.LoadPortraits();
            while (true)
            {
                bool more;
                try { more = request.MoveNext(); }
                catch
                {
                    foreach (var image in images.Values) EmblemFailure(image, epoch);
                    owned.Dispose(); EmblemReady(epoch); yield break;
                }
                if (!more) break; yield return request.Current;
            }
            if (epoch != pageEpoch) { owned.Dispose(); yield break; }
            foreach (var pair in images)
            {
                if (pair.Value == null) continue;
                try { pair.Value.sprite = owned.Sprite(pages.Portrait(pair.Key).sprite); pair.Value.enabled = true; }
                catch { EmblemFailure(pair.Value, epoch); }
            }
            EmblemReady(epoch);
        }
        private void EmblemFailure(Image image, long epoch)
        {
            if (image == null || epoch != pageEpoch) return;
            image.enabled = false;
            var note = Label(image.transform, "Portrait unavailable", 14, 0); Stretch(note.rectTransform); note.color = panel;
        }
        private void EmblemReady(long epoch)
        { if (epoch == pageEpoch && --pendingEmblems == 0 && Flow?.Page == StorePage.Profile) PageReady = true; }
        private void Volume(string title, double value, Action<double> set, bool music)
        {
            var row = Row(title + " volume");
            var toggle = Button(row, title + (value > 0 ? ": on" : ": off"), () => {
                if (value > 0) { if (music) lastMusic = value; else lastEffects = value; set(0); }
                else set(music ? lastMusic : lastEffects);
                Refresh();
            });
            var holder = Rect(title + " slider", content); Height(holder, TouchSize(52));
            holder.gameObject.AddComponent<Image>().color = Color.clear;
            var slider = holder.gameObject.AddComponent<Slider>(); slider.minValue = 0; slider.maxValue = 100; slider.wholeNumbers = true;
            var background = Rect("Track", holder); background.anchorMin = new Vector2(0, .4f); background.anchorMax = new Vector2(1, .6f);
            background.offsetMin = new Vector2(12, 0); background.offsetMax = new Vector2(-12, 0); background.gameObject.AddComponent<Image>().color = panel;
            var handleArea = Rect("Handle area", holder); Stretch(handleArea, 12);
            var handle = Rect("Handle", handleArea); handle.sizeDelta = new Vector2(30, 30);
            var image = handle.gameObject.AddComponent<Image>(); image.color = pale;
            slider.handleRect = handle; slider.targetGraphic = image; slider.value = (float)Math.Round(value * 100);
            var percent = Text(Math.Round(value * 100) + "%", 18);
            slider.onValueChanged.AddListener(next => {
                double level = next / 100d; if (level > 0) { if (music) lastMusic = level; else lastEffects = level; }
                Try(() => { set(level); value = level; percent.text = next.ToString("0") + "%";
                    toggle.GetComponentInChildren<TMP_Text>().text = title + (level > 0 ? ": on" : ": off"); });
            });
        }
        private async void Share(string text, Button button, long epoch)
        {
            button.interactable = false; var token = sharing.Token;
            try
            {
                bool copied = await StoreResultSharing.Open(text, token);
                if (token.IsCancellationRequested || epoch != pageEpoch || button == null) return;
                if (copied) button.GetComponentInChildren<TMP_Text>().text = "Copied";
            }
            catch (OperationCanceledException) { }
            catch (Exception error) { if (!token.IsCancellationRequested && epoch == pageEpoch) Flow.Report(error); }
            finally { if (!token.IsCancellationRequested && epoch == pageEpoch && button != null) button.interactable = true; }
        }
        private void Portrait()
        { var rect = Rect("Guardian", content); Height(rect, 116); var image = rect.gameObject.AddComponent<Image>(); image.sprite = art.Sprite("boss__idle"); image.preserveAspect = true; }
        private TMP_Text Text(string value, float size = 22, bool display = false) => Label(content, value, size, 0, display);
        private TMP_Text Label(Transform parent, string value, float size, float height, bool display = false)
        {
            var rect = Rect(value ?? "Text", parent); var text = rect.gameObject.AddComponent<TextMeshProUGUI>();
            text.font = display ? art?.Display : art?.Body;
            if (text.font == null) text.font = Resources.Load<TMP_FontAsset>("ZKube/Fonts/Outfit-Regular");
            text.text = value; text.fontSize = size * TextScale; text.enableAutoSizing = false;
            text.color = pale; text.alignment = TextAlignmentOptions.Center; text.raycastTarget = false;
            text.richText = false; text.textWrappingMode = TextWrappingModes.Normal;
            var layout = rect.gameObject.AddComponent<LayoutElement>(); layout.minHeight = height > 0 ? height : size * TextScale * 1.7f;
            return text;
        }
        private Button Button(Transform parent, string label, Action action, bool enabled = true)
        {
            var rect = Rect(label, parent); Height(rect, TouchSize(60 * TextScale));
            rect.GetComponent<LayoutElement>().minWidth = TouchSize(0);
            var image = rect.gameObject.AddComponent<Image>(); image.color = enabled ? new Color(.95f, .82f, .42f) : new Color(.2f, .23f, .29f);
            var button = rect.gameObject.AddComponent<Button>(); button.targetGraphic = image; button.interactable = enabled;
            button.onClick.AddListener(() => Try(action)); var text = Label(rect, label, 21, 0);
            Stretch(text.rectTransform, 8); text.color = enabled ? new Color(.07f, .12f, .2f) : new Color(.65f, .67f, .7f);
            return button;
        }
        private RectTransform Row(string name)
        { var rect = Rect(name, content); Height(rect, TouchSize(60 * TextScale)); var group = rect.gameObject.AddComponent<HorizontalLayoutGroup>(); group.spacing = 8; group.childControlHeight = group.childControlWidth = true; group.childForceExpandWidth = true; return rect; }
        private float TouchSize(float preferred) => BoardLayout.CanvasTouchSize(preferred,
            injectedDensity ?? BoardController.ReadDisplayDensity(), pageRoot.GetComponent<Canvas>().scaleFactor);
        private float ContentWidth()
        {
            if (content.rect.width <= 0) Canvas.ForceUpdateCanvases();
            return content.rect.width - content.GetComponent<VerticalLayoutGroup>().padding.horizontal;
        }
        private void OpenBoard(LocalBoardActionProvider provider)
        { board.gameObject.SetActive(true); board.Bind(provider.Bind(null)); if (pageRoot != null) pageRoot.SetActive(false); }
        private void ExitBoard() { board.gameObject.SetActive(false); Flow.LeaveBoard(); }
        private void Accepted(CoreRunToken _) { Flow.ObservePersistence(); Refresh(); }
        private void Rejected(string _) { Flow.ObservePersistence(); Refresh(); }
        private void Try(Action action) { try { action(); } catch (Exception error) { Flow.Report(error); } }
        private void OnApplicationPause(bool paused) { if (!paused && Flow != null) { Refresh(); _ = Flow.RefreshBilling(); } }
        private static RectTransform Rect(string name, Transform parent)
        { var value = new GameObject(name, typeof(RectTransform)).GetComponent<RectTransform>(); value.SetParent(parent, false); return value; }
        private static void Stretch(RectTransform rect, float inset = 0)
        { rect.anchorMin = Vector2.zero; rect.anchorMax = Vector2.one; rect.offsetMin = Vector2.one * inset; rect.offsetMax = -Vector2.one * inset; }
        private static void Height(RectTransform rect, float height)
        { var layout = rect.gameObject.AddComponent<LayoutElement>(); layout.minHeight = layout.preferredHeight = height; layout.flexibleWidth = 1; }
        private GameObject CanvasRoot(string name, int order)
        {
            var root = Rect(name, transform).gameObject; var canvas = root.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay; canvas.sortingOrder = order;
            var scaler = root.AddComponent<CanvasScaler>(); scaler.enabled = false; scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(430, 900); scaler.matchWidthOrHeight = 0; scaler.enabled = true;
            root.AddComponent<GraphicRaycaster>(); return root;
        }
        private void RetirePage()
        {
            pageEpoch++; pendingEmblems = 0; sharing.Cancel(); sharing.Dispose(); sharing = new CancellationTokenSource();
            if (pageRoot == null) return;
            pageRoot.SetActive(false);
            // Destroy is deferred. Remove all page renderer references now;
            // only then may this owner's atlas/sprite leases be released.
            foreach (var image in pageRoot.GetComponentsInChildren<Image>(true)) image.sprite = null;
            portraitArt?.Dispose(); portraitArt = null;
            Destroy(pageRoot); pageRoot = null; name = null;
        }
        private void OnDestroy()
        {
            if (Flow != null) { Flow.Changed -= Refresh; Flow.BoardOpened -= OpenBoard; Flow.Dispose(); Flow = null; }
            if (board != null) { board.ExitRequested -= ExitBoard; board.Accepted -= Accepted; board.Rejected -= Rejected; }
            RetirePage(); sharing.Cancel(); sharing.Dispose(); art?.Dispose();
            if (pageCamera != null) Destroy(pageCamera.gameObject);
        }
    }
}
