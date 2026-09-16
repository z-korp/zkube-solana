using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Integration.App;
using ZKube.Integration.Client;
using ZKube.Integration.Execution;
using ZKube.Presentation;

namespace ZKube.Integration.Presentation
{
    // Money pages coordinate explicit operations; accepted launches bind the shared board host.
    public sealed partial class MoneyAppController : MonoBehaviour
    {
        public MoneyAppFlow Flow { get; private set; }
        public bool Busy { get; private set; }
        public string Status => status == null ? null : status.text;
        public ExecutionResult LastReceipt => identity != null && identity.IsCurrent(receiptLease) ? lastReceipt : null;
        private ExecutionResult lastReceipt;
        private ClientIdentity identity;
        private Func<long> now;
        private TMP_FontAsset heading, body;
        private float textScale;
        private float? injectedDensity;
        private float lastCanvasScale, lastDensity;
        private TMP_Text status, daily, owner, receipt;
        private Button connect, disconnect, refresh, check;
        private Button receiptDetails;
        private bool fullReceipt;
        private GameObject root;
        private RectTransform safe;
        private Image background;
        private BoardArt art;
        private PageCatalog catalog;
        private CancellationTokenSource reads;
        private MoneyRead<PublicDaily> publicRead;
        private MoneyRead<MoneyOwnerState> ownerRead;
        private bool paused, detached, initialized, artLoading;
        private long generation, observedDay, freezeAttempt = -1;
        private byte requestedRealm;
        private string receiptOwner;
        private IdentityLease receiptLease;
        private Rect lastSafe;
        private Vector2Int lastSize;
        private readonly Color ink = new Color(.045f, .065f, .105f, 1);

        public void Initialize(MoneyAppFlow flow, ClientIdentity clientIdentity, TMP_FontAsset displayFont,
            TMP_FontAsset bodyFont, Func<long> clock = null, float scale = 1, float? displayDensity = null)
        {
            if (initialized) throw new InvalidOperationException("Money overview is already initialized");
            Flow = flow ?? throw new ArgumentNullException(nameof(flow));
            identity = clientIdentity ?? throw new ArgumentNullException(nameof(clientIdentity));
            now = clock ?? (() => DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            injectedDensity = displayDensity; InitializeView(displayFont, bodyFont, scale);
            observedDay = now() / 86400;
            _ = RefreshOverview();
        }

        public void ShowUnavailable(TMP_FontAsset displayFont, TMP_FontAsset bodyFont, string message, float scale = 1, float? displayDensity = null)
        {
            if (initialized) throw new InvalidOperationException("Money overview is already initialized");
            injectedDensity = displayDensity; InitializeView(displayFont, bodyFont, scale);
            status.text = message; daily.text = ""; owner.text = "";
            Controls();
        }

        private void InitializeView(TMP_FontAsset displayFont, TMP_FontAsset bodyFont, float scale)
        {
            textScale = BoardController.SupportedTextScale(scale);
            heading = displayFont ?? throw new ArgumentNullException(nameof(displayFont));
            body = bodyFont ?? throw new ArgumentNullException(nameof(bodyFont)); initialized = true;
            var camera = new GameObject("Money page background", typeof(Camera)).GetComponent<Camera>();
            camera.transform.SetParent(transform, false); camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = ink; camera.cullingMask = 0; camera.depth = -100;
            camera.allowHDR = false; camera.allowMSAA = false;
            root = new GameObject("Money overview", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            root.transform.SetParent(transform, false); root.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = root.GetComponent<CanvasScaler>(); scaler.enabled = false; scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(430, 932);
            scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.Expand; scaler.enabled = true;
            background = Rect("Realm background", root.transform).gameObject.AddComponent<Image>(); Stretch(background.rectTransform);
            background.color = Color.clear; background.raycastTarget = false;
            safe = Rect("Safe overview", root.transform); PlaceSafe();
            var viewport = Rect("Viewport", safe); Stretch(viewport); viewport.gameObject.AddComponent<RectMask2D>();
            // Empty space must route drag gestures to ScrollRect, just like a button.
            viewport.gameObject.AddComponent<Image>().color = Color.clear;
            var scroll = safe.gameObject.AddComponent<ScrollRect>(); scroll.horizontal = false;
            scroll.viewport = viewport; scroll.movementType = ScrollRect.MovementType.Clamped;
            var content = Rect("Content", viewport); content.anchorMin = new Vector2(0, 1); content.anchorMax = Vector2.one;
            content.pivot = new Vector2(.5f, 1); content.offsetMin = content.offsetMax = Vector2.zero;
            var layout = content.gameObject.AddComponent<VerticalLayoutGroup>(); layout.spacing = 12;
            layout.padding = new RectOffset(10, 10, 18, 30); layout.childControlHeight = true;
            layout.childForceExpandHeight = false; layout.childForceExpandWidth = true;
            content.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize; scroll.content = content;
            Label(content, Application.productName, 36, true);
            status = Label(content, "Loading Daily…", 19, false); status.name = "Overview status";
            pageContent = content;
            overviewPanel = Rect("Overview panel", content);
            Stack(overviewPanel);
            var overview = overviewPanel;
            daily = Label(overview, "", 23, true); daily.name = "Daily facts";
            owner = Label(overview, "Connect your wallet to view your profile and runs.", 20, false); owner.name = "Owner facts";
            receipt = Label(content, "", 18, false); receipt.name = "Transaction receipt";
            receiptDetails = Button(content, "Receipt details", ToggleReceiptDetails);
            receiptDetails.GetComponentInChildren<TMP_Text>().text = "Show receipt";
            connect = Button(overview, "Connect", () => _ = Connect());
            disconnect = Button(overview, "Disconnect", () => _ = Disconnect());
            refresh = Button(overview, "Refresh", () => _ = RefreshOverview());
            check = Button(overview, "Check transaction", () => _ = CheckTransaction());
            campaignButton = Button(overview, "Campaign", () => _ = OpenCampaign());
            sessionButton = Button(overview, "This device", () => _ = OpenSession());
            dailyButton = Button(overview, "Daily", () => _ = OpenDaily());
            kreditButton = Button(overview, "Kredits", () => _ = OpenKredits());
            rewardButton = Button(overview, "Results", () => _ = OpenRewards());
            profileButton = Button(overview, "Profile", () => _ = OpenProfile());
            Controls();
        }

        public Task RefreshOverview() => Run(RefreshVisiblePage);
        private Task RefreshVisiblePage(long epoch, CancellationToken token) =>
            browsingProfile ? RefreshProfilePage(epoch, token) : browsingRewards ? RefreshRewardPage(epoch, token) : browsingKredits ? RefreshKreditPage(epoch, token) : browsingDaily ? RefreshDailyPage(epoch, token) : browsingSession ? RefreshSessionPage(epoch, token) :
            browsingCampaign ? RefreshCampaignPage(epoch, token) : Refresh(epoch, token);
        public Task Connect() => Run(async (epoch, token) => {
            await Flow.Connect(); if (Current(epoch)) await Refresh(epoch, token);
        });
        public Task CheckTransaction() => Run(async (epoch, token) => {
            var result = await Flow.ResumePending(token);
            if (!Current(epoch)) return;
            ShowReceipt(result.Value, identity.Owner);
            await RefreshVisiblePage(epoch, token); // A receipt survives an empty post-confirmation journal.
        });
        public async Task Disconnect()
        {
            if (detached || !isActiveAndEnabled || Flow == null || paused) return;
            if (PlayingRun) boardHost.Board.SetHostInputEnabled(false);
            // Disconnect is available even during a wallet/read callback.
            CloseProductViews(); RetireRead(); ownerRead = null; owner.text = "Disconnected"; receipt.text = ""; receiptOwner = null; receiptLease = null; lastReceipt = null;
            Busy = true; Controls(); long epoch = generation;
            try { await Flow.Disconnect(); if (Current(epoch)) status.text = "Disconnected"; }
            catch (Exception error) { if (Current(epoch)) ShowError(error); }
            finally { if (Current(epoch)) { Busy = false; Controls(); } }
        }
        private async Task RunCampaign(Func<long, CancellationToken, Task> operation)
        {
            if (detached || !isActiveAndEnabled || paused || Flow == null || PlayingRun || identity.Owner == null) return;
            long epoch = generation;
            try { await operation(epoch, CancellationToken.None); }
            catch (Exception error) { if (Current(epoch)) ShowError(error); }
            finally { if (Current(epoch)) { Controls(); } }
        }
        private static string RunText(ZKube.Local.LocalRunView state) =>
            state == null ? "No saved run" : "Saved on this device";

        private async Task Run(Func<long, CancellationToken, Task> operation)
        {
            if (detached || !isActiveAndEnabled || paused || Flow == null || Busy || PlayingRun) return;
            RetireRead(); reads = new CancellationTokenSource(); long epoch = generation;
            Busy = true; Controls();
            try { await operation(epoch, reads.Token); }
            catch (OperationCanceledException) { if (Current(epoch)) status.text = "Refresh was cancelled. Refresh to try again."; }
            catch (Exception error) { if (Current(epoch)) ShowError(error); }
            finally { if (Current(epoch)) { Busy = false; Controls(); } }
        }
        private async Task Refresh(long epoch, CancellationToken token)
        {
            var publication = await Flow.RefreshPublic(token);
            if (!Current(epoch)) return;
            var value = publication.Value; publicRead = publication;
            if (value.FreezesAt.HasValue && value.ObservedAt >= value.FreezesAt.Value) freezeAttempt = value.FreezesAt.Value;
            if (catalog == null) catalog = PageCatalog.Load();
            string pot = value.PotLamports.HasValue ? "\nPot: " + (value.PotLamports.Value / 1000000000m).ToString("0.#########", CultureInfo.InvariantCulture) + " SOL" : "";
            daily.text = "Daily · " + DateTimeOffset.FromUnixTimeSeconds(value.ObservedAt).ToString("d MMM yyyy", CultureInfo.InvariantCulture) + " UTC\n" +
                catalog.Realm(value.Realm).realmName + " · " + catalog.Objective(value.ObjectiveKind, value.ObjectiveValue).name +
                "\n" + PublicStatus(value.Status) + pot;
            status.text = "Daily updated"; RequestArt(value.Realm);
            if (identity.Owner == null) { owner.text = "Connect your wallet to view your profile and runs."; return; }
            var privateRead = await Flow.RefreshOwner(token);
            if (!Current(epoch)) return;
            var state = privateRead.Value; ownerRead = privateRead;
            owner.text = state.Owner + "\n" + (state.Profile == null ? "Your profile will refresh after the transaction is checked." :
                !state.Profile.Exists ? "No player profile yet." : "Kredits: " + state.Profile.Kredits + "\nLadder points: " + state.Profile.LadderPoints +
                " · Tier " + state.Profile.CurrentTier + " · Highest " + state.Profile.HighestTier) +
                "\n" + SessionText(state.Session) +
                "\nCampaign: " + RunText(state.Campaign) + "\nDaily: " + RunText(state.Daily) +
                (state.Pending == null ? "" : "\nA transaction still needs checking.");
            if (state.PreviousOperation != null) ShowReceipt(state.PreviousOperation, state.Owner);
        }
        private static string PublicStatus(string value) => value switch {
            "missing-config" => "Daily service unavailable", "missing-daily" => "Today's Daily is not available",
            "suspended" => "Daily is suspended", "paused" => "Daily play is paused", "not-open" => "Opens later today",
            "funding" => "Daily is being prepared", "open" => "Daily is open", "frozen" => "Entries are closed",
            "finalized" => "Daily complete", _ => "Daily status unavailable"
        };
        private static string SessionText(SessionAssessment value)
        {
            if (value == null) return "Device session not checked yet";
            if (value.Status == "none") return "Device session not set up";
            if (!value.Current) return value.TokenMayClose ? "Device session expired" : "Device session needs renewal";
            if (value.Funding != "ready") return "Device session needs a fee refill";
            return value.Status == "expiring" ? "Device session expires soon" : "Device session ready";
        }
        private static string RunText(ZKube.Integration.Client.Runs.RunClientState state)
        {
            if (state == null) return "Not checked yet";
            return state.Phase switch {
                "none" => "No saved run", "base" => "Run saved", "delegated" => "Run saved",
                "resolving" => "Loading saved run", "settleable" => "Result awaiting settlement", "consumed" => "Result settled",
                "identity-changed" => "Reconnect to check this run", "other-action-pending" => "Check the pending transaction first",
                _ => "Saved run unavailable. Refresh to check again."
            };
        }
        private void ShowReceipt(ExecutionResult result, string address)
        {
            if (result.Code == "no-pending-transaction")
            {
                // This observation is not a transaction receipt. Preserve an
                // actual receipt, but acknowledge an empty check when none exists.
                if (LastReceipt == null) receipt.text = "There is no transaction waiting to be checked.";
                return;
            }
            if (lastReceipt?.Signature != result.Signature) fullReceipt = false;
            receiptOwner = address; receiptLease = identity.Lease(); lastReceipt = result;
            RenderReceipt();
        }
        private void ToggleReceiptDetails()
        {
            if (Busy || detached || paused || !isActiveAndEnabled || string.IsNullOrEmpty(LastReceipt?.Signature)) return;
            fullReceipt = !fullReceipt; RenderReceipt();
        }
        private void RenderReceipt()
        {
            receipt.text = MoneyReceiptText.Describe(LastReceipt, fullReceipt);
            receiptDetails.GetComponentInChildren<TMP_Text>().text = fullReceipt ? "Hide receipt" : "Show receipt";
        }
        private void ShowError(Exception error)
        { status.text = error is MoneyConfigurationException ? "Network configuration is unavailable." :
            error is WalletRequestException wallet ? wallet.Code == "wallet-busy" ? "A wallet request is already open." :
                wallet.Code == "account-changed" ? "The wallet account changed. Connect again." : "The wallet request was not completed." :
            "Could not refresh. Try again."; }
        private bool Current(long epoch) => this != null && isActiveAndEnabled && !detached && !paused && epoch == generation;
        private void Controls()
        {
            if (connect == null) return;
            bool available = Flow != null && !detached && !paused;
            connect.gameObject.SetActive(identity?.Owner == null); disconnect.gameObject.SetActive(identity?.Owner != null);
            connect.interactable = refresh.interactable = available && !Busy;
            disconnect.interactable = available; check.interactable = available && !Busy && identity.Owner != null;
            receiptDetails.gameObject.SetActive(!string.IsNullOrEmpty(LastReceipt?.Signature));
            receiptDetails.interactable = available && !Busy;
            CampaignControls(available); SessionControls(available); DailyControls(available); KreditControls(available); RewardControls(available); ProfileControls(available);
        }
        private void Update()
        {
            if (!initialized || detached) return;
            if (PlayingRun) return;
            if (lastSafe != Screen.safeArea || lastSize != new Vector2Int(Screen.width, Screen.height)) { PlaceSafe(); RefreshCampaignLayout(); }
            if (Flow == null || paused) return;
            if (ownerRead != null && !ownerRead.IsCurrent) { ownerRead = null; owner.text = "Owner information changed. Refresh to update."; }
            if (receiptOwner != null && !identity.IsCurrent(receiptLease)) { receipt.text = ""; receiptOwner = null; receiptLease = null; lastReceipt = null; }
            RefreshCampaignIdentity(); RefreshSessionIdentity(); RefreshDailyIdentity(); RefreshKreditIdentity(); RefreshRewardIdentity(); RefreshProfileIdentity();
            Controls();
            if (Busy || browsingCampaign || browsingSession || browsingDaily || browsingKredits || browsingRewards || browsingProfile) return;
            long timestamp = now(), day = timestamp / 86400;
            long? freeze = publicRead != null && publicRead.IsCurrent ? publicRead.Value.FreezesAt : null;
            if (day != observedDay || (freeze.HasValue && timestamp >= freeze.Value && freezeAttempt != freeze.Value))
            { observedDay = day; if (freeze.HasValue && timestamp >= freeze.Value) freezeAttempt = freeze.Value; _ = RefreshOverview(); }
        }
        private void LateUpdate()
        {
            if (root == null || detached || !root.activeInHierarchy) return;
            float scale = root.GetComponent<Canvas>().scaleFactor, density = injectedDensity ?? BoardController.ReadDisplayDensity();
            if (scale == lastCanvasScale && density == lastDensity) return;
            lastCanvasScale = scale; lastDensity = density;
            foreach (var button in root.GetComponentsInChildren<Button>(true))
                button.GetComponent<LayoutElement>().minHeight = BoardLayout.CanvasTouchSize(52, density, scale);
            RefreshCampaignLayout();
        }
        private void OnApplicationPause(bool value)
        {
            if (detached || paused == value) return;
            paused = value;
            if (PlayingRun) { boardHost.Suspend(value); return; }
            if (value)
            {
                RetireRead(); Busy = false; publicRead = null; ownerRead = null;
                if (owner != null) owner.text = "Refresh to view your profile and runs.";
                if (daily != null) daily.text = "";
                ClearProductObservations();
                if (root != null) root.SetActive(false);
            }
            else if (isActiveAndEnabled)
            { if (root != null) root.SetActive(true); if (Flow != null) _ = RefreshOverview(); }
        }
        private void OnDisable()
        {
            if (!initialized || detached) return;
            if (PlayingRun) boardHost.Close();
            RetireRead(); Busy = false; ownerRead = null; publicRead = null;
            if (root != null) root.SetActive(false);
            owner.text = "Refresh to view your profile and runs.";
            ClearProductObservations();
            RetireArtwork();
        }
        private void OnEnable()
        {
            if (!initialized || detached || paused) return;
            if (root != null) root.SetActive(true);
            if (Flow != null) _ = RefreshOverview();
        }
        private void RetireRead()
        {
            generation++; var old = reads; reads = null;
            try { old?.Cancel(); }
            catch (Exception error) { Debug.LogException(error); }
            finally { old?.Dispose(); }
        }
        public void Detach()
        {
            if (detached) return; detached = true; RetireRead();
            if (PlayingRun) boardHost.Close();
            RetireArtwork(); publicRead = null; ownerRead = null; ClearProductObservations();
            if (root != null) root.SetActive(false); Controls();
        }
        private void OnDestroy() => Detach();
        private void CloseProductViews()
        {
            CloseSessionView(); CloseCampaignView(); CloseDailyView(); CloseKreditView(); CloseRewardView(); CloseProfileView();
        }
        private void ClearProductObservations()
        {
            ClearCampaignObservation(); ClearSessionObservation(); ClearDailyObservation(); ClearKreditObservation(); ClearRewardObservation(); ClearProfileObservation();
        }
        private void RetireArtwork()
        {
            StopAllCoroutines(); artLoading = false; requestedRealm = 0;
            if (background != null) { background.sprite = null; background.color = Color.clear; }
            art?.Dispose(); art = null;
        }
        private void RequestArt(byte realm)
        {
            requestedRealm = realm;
            if (!artLoading && isActiveAndEnabled) StartCoroutine(LoadArt());
        }
        private IEnumerator LoadArt()
        {
            artLoading = true;
            while (!detached && requestedRealm != 0 && (art == null || art.RealmId != requestedRealm))
            {
                byte realm = requestedRealm; background.sprite = null; background.color = Color.clear;
                if (art == null) art = new BoardArt();
                var iterator = art.Load(realm);
                while (true)
                {
                    bool more;
                    try { more = iterator.MoveNext(); }
                    catch (Exception) { status.text = "Realm artwork unavailable. Refresh to try again."; artLoading = false; art.Dispose(); art = null; yield break; }
                    if (!more) break; yield return iterator.Current;
                }
                if (!detached && realm == requestedRealm)
                { background.sprite = art.Sprite("background"); background.color = new Color(.12f, .12f, .12f, 1); }
            }
            artLoading = false;

        }
        private void PlaceSafe()
        {
            if (safe == null || Screen.width <= 0 || Screen.height <= 0) return;
            lastSafe = Screen.safeArea; lastSize = new Vector2Int(Screen.width, Screen.height);
            safe.anchorMin = new Vector2(lastSafe.xMin / Screen.width, lastSafe.yMin / Screen.height);
            safe.anchorMax = new Vector2(lastSafe.xMax / Screen.width, lastSafe.yMax / Screen.height);
            safe.offsetMin = new Vector2(14, 12); safe.offsetMax = new Vector2(-14, -12);
        }
        private void ResetPageScroll()
        {
            // Pages share a viewport, but not the previous page's offset or
            // drag inertia. Reset the top-anchored content before its new
            // layout grows; normalized positions still read the old height.
            var scroll = safe.GetComponent<ScrollRect>();
            scroll.StopMovement(); scroll.content.anchoredPosition = Vector2.zero;
        }
        private void ReplacePagePanel(ref RectTransform panel, string name)
        {
            if (panel != null) { panel.gameObject.SetActive(false); Destroy(panel.gameObject); }
            panel = Rect(name, pageContent); Stack(panel); ResetPageScroll();
        }
        private TMP_Text Label(Transform parent, string text, float size, bool title)
        {
            var value = Rect(text.Length > 30 ? "Text" : text, parent).gameObject.AddComponent<TextMeshProUGUI>();
            value.font = title ? heading : body; value.fontSize = size * textScale; value.text = text; value.color = new Color(1, .97f, .87f);
            value.richText = false; value.raycastTarget = false; value.overflowMode = TextOverflowModes.Overflow;
            return value;
        }
        private Button Button(Transform parent, string title, UnityEngine.Events.UnityAction action)
        {
            var rect = Rect(title, parent); rect.gameObject.AddComponent<LayoutElement>().minHeight = BoardLayout.CanvasTouchSize(52,
                injectedDensity ?? BoardController.ReadDisplayDensity(), root.GetComponent<Canvas>().scaleFactor);
            var image = rect.gameObject.AddComponent<Image>(); image.color = new Color(.15f, .25f, .34f, .98f);
            var button = rect.gameObject.AddComponent<Button>(); button.targetGraphic = image; button.onClick.AddListener(action);
            var label = Label(rect, title, 21, false); Stretch(label.rectTransform); label.alignment = TextAlignmentOptions.Center;
            return button;
        }
        private static RectTransform Rect(string name, Transform parent)
        { var rect = new GameObject(name, typeof(RectTransform)).GetComponent<RectTransform>(); rect.SetParent(parent, false); return rect; }
        private static void Stretch(RectTransform rect) { rect.anchorMin = Vector2.zero; rect.anchorMax = Vector2.one; rect.offsetMin = rect.offsetMax = Vector2.zero; }
    }
}
