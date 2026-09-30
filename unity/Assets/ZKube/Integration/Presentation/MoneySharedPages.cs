using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Integration.App;
using ZKube.Integration.Client;
using ZKube.Integration.Execution;
using ZKube.Presentation;

namespace ZKube.Integration.Presentation
{
    public sealed partial class MoneyAppAdapter
    {
        private AppPage? sharedPage;
        private ResultPageView lastResult;
        private bool browsingOperation;
        private string operationReturn;
        // Shown in place of a page whose read is not there: what is being
        // checked, or why the page needs refreshing.
        private string pageNotice;
        public bool BrowsingOperation => browsingOperation;

        private static PageAction PageAction(string text, Action invoke, Func<bool> available = null, string name = null) =>
            new PageAction { Label = text, Name = name, Invoke = invoke, CanInvoke = available };
        private bool PageAvailable() => Flow != null && !detached && !paused && isActiveAndEnabled && !PlayingRun;
        public bool CanNavigate(AppPage page) => PageAvailable() &&
            (page == AppPage.Campaign ? identity.Owner != null : !Busy && (page == AppPage.Settings || identity.Owner != null));
        public void Navigate(AppPage page)
        {
            if (!CanNavigate(page)) return;
            switch (page)
            {
                case AppPage.Campaign: _ = OpenCampaign(); break;
                case AppPage.Daily: _ = OpenDaily(); break;
                case AppPage.Profile: _ = OpenProfile(); break;
                case AppPage.Settings: OpenSharedPage(page); break;
                case AppPage.Result: OpenSharedPage(page); break;
                default: throw new ArgumentOutOfRangeException(nameof(page));
            }
        }
        public void Report(Exception error) => ShowError(error);
        // The Arcade has no Campaign panel; Campaign is its own tab.
        public CampaignSummaryView CampaignSummary() => null;
        private void CloseSharedView() { sharedPage = null; }
        private void OpenSharedPage(AppPage page)
        {
            CloseProductViews(); sharedPage = page;
            if (page == AppPage.Settings && identity.Owner != null) _ = Run(RefreshSharedPage);
            else Present();
        }
        // Settings shows this device's session from a read that only observes;
        // a pending transaction is never checked by opening a page.
        private MoneyRead<MoneySessionState> settingsRead;
        private async Task RefreshSharedPage(long epoch, CancellationToken token)
        {
            settingsRead = null;
            if (sharedPage != AppPage.Settings || identity.Owner == null) { Present(); return; }
            var read = await Flow.RefreshSession(token);
            if (!Current(epoch) || sharedPage != AppPage.Settings) return;
            settingsRead = read; Present();
        }
        public SettingsPageView SettingsPage()
        {
            var view = AppPreferences.Read(() => { textScale = AppPreferences.TextScale; InitializeViews(); Present(); });
            if (identity?.Owner == null) return view;
            var session = settingsRead != null && settingsRead.IsCurrent ? settingsRead.Value.Session : null;
            view.Identity = new[] {
                PanelBlock.Card("Device card", PanelBlock.Eyebrow("This device", SkinTokens.TextMuted, gap: 10),
                    new PanelBlock { Kind = PanelKind.Text, Name = "Device status", Copy = DeviceState(session).Short, Size = 18,
                        Token = DeviceState(session).Token, Action = PageAction("Manage", () => _ = OpenSession(true), () => PageAvailable() && !Busy) }),
                PanelBlock.Pair(PageAction("Last operation", () => OpenOperation(true), () => PageAvailable() && !Busy),
                    PageAction("Disconnect", () => _ = Disconnect(), () => PageAvailable())) };
            return view;
        }
        public ResultPageView ResultPage()
        {
            var value = lastResult != null && lastResult.PlayerName == identity.Owner ? lastResult :
                new ResultPageView { ProductName = Application.productName, Mode = "Daily", Realm = 1, PlayerName = identity.Owner ?? "" };
            if (value.HasResult && value.Mode == "Campaign")
            {
                // A Campaign result continues on the map, or replays its level; it has no Share.
                byte realm = value.Realm, level = value.Level;
                int stars = (value.StarSources & 1) + (value.StarSources >> 1 & 1) + (value.StarSources >> 2 & 1);
                value.Share = null;
                value.Done = PageAction(stars > 0 ? "Continue" : "Map", () => _ = OpenCampaign(), () => PageAvailable() && !Busy);
                value.Retry = PageAction("Retry", () => _ = OpenLocalCampaign(() => Flow.StartCampaignRun(realm, level), "Trial " + level),
                    () => PageAvailable() && !Busy && level > 0);
                return value;
            }
            value.Share = ResultSharing.Open;
            value.Done = PageAction("Back to Arcade", () => _ = OpenDaily(), () => PageAvailable() && !Busy);
            return value;
        }
        private bool ResultAvailable(string mode) => lastResult != null && lastResult.HasResult &&
            lastResult.PlayerName == identity.Owner && lastResult.Mode == mode;

        // The page to draw, by what the player is browsing.
        private string Family() => identity?.Owner == null ? "Connect" : browsingCampaign ? "Campaign" : browsingDaily ? "Daily" :
            browsingKredits ? "Kredits" : browsingRewards ? "Rewards" : browsingSession ? "Device" : browsingProfile ? "Profile" :
            browsingOperation ? "Operation" : sharedPage.HasValue ? sharedPage.Value.ToString() : "Daily";
        private string PageKey()
        {
            string family = Family();
            return family switch {
                "Campaign" => browseLevel == 0 ? "Campaign" : "Level",
                "Daily" => confirmingDaily ? "Entry" : "Daily",
                "Rewards" => "Rewards " + rewardDay + (boardKind == null ? "" : " " + boardKind),
                "Device" => revokeConfirming ? "Revoke" : "Device",
                "Profile" => "Profile " + profileView,
                _ => family
            };
        }
        private byte PageRealm() => Family() switch {
            "Campaign" => browseRealm,
            "Profile" => profileRead != null && profileRead.IsCurrent ? ProfileRealm() : TodayRealm,
            "Rewards" => NativeEngine.Daily(rewardDay).Realm,
            "Result" => lastResult != null && lastResult.HasResult ? lastResult.Realm : TodayRealm,
            "Settings" => shell.Artwork?.RealmId is byte realm && realm != 0 ? realm : TodayRealm,
            _ => TodayRealm
        };
        private void Draw()
        {
            var notices = new[] { NoticeFor(Family()) };
            switch (Family())
            {
                case "Connect": views.RenderPanel(ConnectPage()); break;
                case "Campaign":
                    if (CanBrowse() && campaignRead.Value.Browse.Realms.Count != 0) views.Render(browseLevel == 0 ? AppPage.Campaign : AppPage.Level, notices);
                    else views.RenderPanel(Waiting("Campaign", "Campaign", null, 0, pageNotice ?? "Campaign trial data is unavailable.")); break;
                case "Daily":
                    if (dailyRead == null) views.RenderPanel(Waiting("Daily", null, "arena", 1, pageNotice));
                    else if (confirmingDaily) views.RenderPanel(EntryPage(), notices);
                    else views.Render(AppPage.Daily, notices);
                    break;
                // A page without its read shows its failure itself.
                case "Kredits": views.RenderPanel(KreditPage(), kreditRead == null ? null : notices); break;
                case "Rewards": views.RenderPanel(RewardPage(), rewardRead == null ? null : notices); break;
                case "Device": views.RenderPanel(DevicePage(), sessionRead == null ? null : notices); break;
                case "Profile":
                    if (profileRead == null) views.RenderPanel(Waiting("Profile", "Profile", null, 2, pageNotice));
                    else if (profileView == ProfileView.Main) views.Render(AppPage.Profile, notices);
                    else views.RenderPanel(ProfilePanel(), notices);
                    break;
                case "Operation": views.RenderPanel(OperationPage()); break;
                case "Settings": views.Render(AppPage.Settings, notices); break;
                case "Result": views.Render(AppPage.Result, notices); break;
                default: throw new InvalidOperationException("Unknown page " + Family());
            }
        }
        // While a wallet request is open, Disconnect stays within reach.
        private PanelBlock DisconnectButton() => PanelBlock.Button(PageAction("Disconnect", () => _ = Disconnect(), () => PageAvailable()), false, lead: 8);
        // A failure the page itself does not show goes on it as a notice.
        private string NoticeFor(string family) => family == "Connect" ? null :
            failure != null && !(walletFailure && family == "Kredits") ? failure : info;

        // A page whose read is not there yet: what is being checked, or, when the
        // read failed or went stale, the guardian says why with the way forward.
        private PanelPageView Waiting(string key, string title, string subtitle, int tab, string message)
        {
            var page = new PanelPageView { Key = key + " waiting", Title = title, Subtitle = subtitle, Tab = tab, Settings = tab != 0 };
            if (failure != null && !Busy)
                page.Blocks = new[] {
                    PanelBlock.Talk(failure == "Network configuration is unavailable." ? failure :
                        "We could not refresh Arcade. Check your connection, or continue your saved Campaign.", "defeated"),
                    PanelBlock.Title("No connection", 27, gap: 50),
                    PanelBlock.Button(PageAction("Try again", () => _ = RefreshOverview(), () => PageAvailable() && !Busy), true),
                    PanelBlock.Button(PageAction("Play Campaign", () => _ = OpenCampaign(), () => PageAvailable() && identity.Owner != null), false) };
            else if (Busy || message == null)
                page.Blocks = sessionActionPending || economyActionPending ?
                    new[] { PanelBlock.Text("Page notice", "Your wallet request is still finishing.", 16, SkinTokens.TextMuted, lead: 40), DisconnectButton() } :
                    new[] { PanelBlock.Text("Page notice", message ?? "Checking…", 16, SkinTokens.TextMuted, lead: 40) };
            else
                page.Blocks = new[] {
                    PanelBlock.Talk(message, "idle"),
                    PanelBlock.Button(PageAction("Refresh", () => _ = RefreshOverview(), () => PageAvailable() && !Busy), true) };
            return page;
        }
        private void Notice(string message) { pageNotice = message; Present(); }

        // Connect: the guardian of today's realm, what connecting is, today's
        // Daily from the public read, and the wallet request.
        private PanelPageView ConnectPage()
        {
            var today = publicRead != null && publicRead.IsCurrent ? publicRead.Value : null;
            string facts = today == null ? "Checking today’s Daily…" : "Today · " + Day(today.DayId) + " · UTC · " + PublicStatus(today.Status);
            var blocks = new List<PanelBlock> {
                PanelBlock.Portrait(TodayRealm, 164, gap: 39, lead: 43),
                PanelBlock.Card("Connect card",
                    PanelBlock.Title("Your address. Your play.", 25, gap: 26, centered: true),
                    PanelBlock.Text("Connect copy", "Connect your Solana wallet to enter Arena. Your address is your player identity.", 17, gap: 16),
                    PanelBlock.Text("Connect cost", "Campaign is free. Connecting does not spend SOL or enable a device session.", 15, SkinTokens.TextMuted, gap: 16),
                    PanelBlock.Text("Daily facts", facts, 13, SkinTokens.TextMuted, gap: 0)) };
            if (failure != null && !Busy) blocks.Add(PanelBlock.Text("Connect failure", walletFailure ? "Connection cancelled" : failure, 18, SkinTokens.Negative, gap: 18));
            else blocks[blocks.Count - 1].Gap = 48;
            blocks.Add(PanelBlock.Button(PageAction(failure != null ? "Try connecting again" : "Connect wallet", () => _ = Connect(),
                () => PageAvailable() && !Busy, "Connect"), true, 24));
            blocks.Add(PanelBlock.Text("Connect hint", "Choose your wallet in the Android wallet sheet.", 13, SkinTokens.TextMuted, gap: 0));
            return new PanelPageView { Key = "Connect", Subtitle = "arena", Blocks = blocks.ToArray() };
        }

        // The last operation: its outcome, what it was, the receipt and the one
        // thing to do next. Tapping the receipt shows the whole signature.
        private void OpenOperation(bool fromSettings)
        {
            if (!PageAvailable() || Busy) return;
            operationReturn = fromSettings ? "Settings" : Family();
            CloseProductViews(); browsingOperation = true; Present();
        }
        // Back returns to the page the operation was opened from.
        private void ReturnFromOperation()
        {
            switch (operationReturn)
            {
                case "Settings": OpenSharedPage(AppPage.Settings); break;
                case "Kredits": _ = OpenKredits(); break;
                case "Device": _ = OpenSession(); break;
                case "Rewards": _ = OpenRewards(rewardDay); break;
                case "Profile": _ = OpenProfile(); break;
                default: _ = OpenDaily(); break;
            }
        }
        private PanelPageView OperationPage()
        {
            var back = PageAction("Back", ReturnFromOperation, () => PageAvailable() && !Busy);
            var page = new PanelPageView { Key = "Operation", Title = "Last operation", Subtitle = "arena", Back = back };
            var receipt = LastReceipt;
            var arcade = PageAction("Back to Arcade", () => _ = OpenDaily(), () => PageAvailable() && !Busy);
            if (receipt == null)
            {
                page.Blocks = new[] {
                    PanelBlock.Card("Operation card", PanelBlock.Icon(SkinSlots.IconKredit, 64, SkinTokens.TextMuted),
                        PanelBlock.Title("No operation yet", 25, gap: 20, centered: true),
                        PanelBlock.Text("Transaction receipt", receiptNotice ?? "Your latest operation will appear here after a wallet or device action.", 16, gap: 8)),
                    PanelBlock.Text("Operation note", "You can play Campaign without a device session.", 16, gap: 40, centered: false),
                    PanelBlock.Button(arcade, true) };
                return page;
            }
            var lines = new List<PanelBlock> {
                PanelBlock.Icon(SkinSlots.IconKredit, 64, receipt.Outcome == ExecutionOutcome.ConfirmedSuccess ? SkinTokens.Accent : SkinTokens.TextMuted),
                PanelBlock.Title(MoneyReceiptText.Title(receipt), 25, gap: 18, centered: true) };
            // A confirmed title already names the operation.
            if (receipt.Outcome != ExecutionOutcome.ConfirmedSuccess)
                lines.Add(PanelBlock.Text("Operation intent", MoneyReceiptText.Intent(receipt), 18, SkinTokens.Objective, gap: 30, centered: true));
            else lines[lines.Count - 1].Gap = 30;
            lines.Add(PanelBlock.Eyebrow("Receipt", SkinTokens.TextMuted, gap: 12));
            if (string.IsNullOrEmpty(receipt.Signature)) lines.Add(PanelBlock.Text("Transaction receipt", MoneyReceiptText.Describe(receipt), 16, gap: 0));
            else
            {
                lines.Add(PanelBlock.Text("Transaction receipt", MoneyReceiptText.Describe(receipt, fullReceipt), 16, gap: 10));
                lines.Add(PanelBlock.Button(PageAction(fullReceipt ? "Hide receipt" : "Show receipt", ToggleReceiptDetails,
                    () => PageAvailable() && !Busy, "Receipt details"), false, 0));
            }
            var blocks = new List<PanelBlock> { PanelBlock.Card("Operation card", lines.ToArray()) };
            blocks.Add(PanelBlock.Text("Operation next", MoneyReceiptText.Next(receipt), 16, gap: 40, centered: false));
            if (receipt.Outcome == ExecutionOutcome.Pending)
                blocks.Add(PanelBlock.Button(PageAction("Check transaction", () => _ = CheckTransaction(), () => PageAvailable() && !Busy), true));
            else if (receipt.Outcome == ExecutionOutcome.FeeShortage)
                blocks.Add(PanelBlock.Button(PageAction("Manage device", () => _ = OpenSession(), () => PageAvailable() && !Busy), true));
            else blocks.Add(PanelBlock.Button(arcade, true));
            page.Blocks = blocks.ToArray();
            return page;
        }
        // The receipt of an operation on this page, as a row that opens the
        // last operation.
        private PanelBlock ReceiptRow(string family)
        {
            if (receiptFamily != family) return null;
            var receipt = LastReceipt;
            if (receipt == null && receiptNotice == null) return null;
            return PanelBlock.Card("Receipt card", PanelBlock.Eyebrow("Last operation", SkinTokens.TextMuted, gap: 10),
                PanelBlock.Text("Transaction receipt", receipt == null ? receiptNotice : MoneyReceiptText.Describe(receipt, fullReceipt), 15, gap: 12),
                PanelBlock.Button(PageAction("View operation", () => OpenOperation(false), () => PageAvailable() && !Busy), false, 0));
        }
    }
}
