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
                case AppPage.Home: _ = OpenDaily(); break;
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
                PanelBlock.Card("Device card", PanelBlock.Eyebrow("This device", SkinTokens.TextMuted),
                    new PanelBlock { Kind = PanelKind.Text, Name = "Device status", Copy = DeviceState(session).Short,
                        Token = DeviceState(session).Token, Action = PageAction("Manage", () => _ = OpenSession(true), () => PageAvailable() && !Busy) }),
                PanelBlock.Pair(PageAction("Last operation", () => OpenOperation(true), () => PageAvailable() && !Busy),
                    PageAction("Disconnect", () => _ = Disconnect(), () => PageAvailable())) };
            return view;
        }
        // The Campaign's result is the journey's; the Arcade's is its last kept run.
        public ResultPageView ResultPage()
        {
            if (campaignPage == AppPage.Result) return campaign.ResultPage(Application.productName, identity.Owner);
            var value = lastResult != null && lastResult.PlayerName == identity.Owner ? lastResult :
                new ResultPageView { ProductName = Application.productName, Mode = "Daily", Realm = 1, PlayerName = identity.Owner ?? "" };
            value.Share = ResultSharing.Open; value.Arcade = true;
            value.Done = PageAction("Back to Arcade", () => _ = OpenDaily(), () => PageAvailable() && !Busy);
            return value;
        }
        private bool ResultAvailable(string mode) => lastResult != null && lastResult.HasResult &&
            lastResult.PlayerName == identity.Owner && lastResult.Mode == mode;

        // The page to draw, by what the player is browsing.
        private string Family() => identity?.Owner == null ? "Connect" : campaignPage != null ? "Campaign" : browsingDaily ? "Daily" :
            browsingKredits ? "Kredits" : browsingRewards ? "Rewards" : browsingSession ? "Device" : browsingProfile ? "Profile" :
            browsingOperation ? "Operation" : sharedPage.HasValue ? sharedPage.Value.ToString() : "Daily";
        private string PageKey()
        {
            string family = Family();
            return family switch {
                "Campaign" => campaignPage.Value.ToString(),
                "Daily" => confirmingDaily ? "Entry" : "Daily",
                "Rewards" => "Rewards " + rewardDay + (boardKind == null ? "" : " " + boardKind),
                "Device" => revokeConfirming ? "Revoke" : "Device",
                "Profile" => "Profile " + profileView,
                _ => family
            };
        }
        private byte PageRealm() => Family() switch {
            "Campaign" => campaignPage == AppPage.Result ? campaign.Last.Realm : campaign.Realm,
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
                    views.Render(campaignPage.Value, campaign.Unsaved ? notices.Append(RunBoard.UnsavedWarning) : notices); break;
                case "Daily":
                    if (dailyRead == null) views.RenderPanel(Waiting("Daily", null, "Arena", AppPage.Home, pageNotice));
                    else if (confirmingDaily) views.RenderPanel(EntryPage(), notices);
                    else
                    {
                        views.Render(AppPage.Home, notices);
                        // The first Arcade with an address teaches the Arena Daily, over the page and never on the entry sheet.
                        if (dailyRead.Value.Lobby.Launched && !Lessons.Device.Taught(Lesson.ArenaDaily)) views.Teach(Lessons.ArenaDaily, () => Lessons.Device.Teach(Lesson.ArenaDaily));
                    }
                    break;
                // A page without its read shows its failure itself.
                case "Kredits": views.RenderPanel(KreditPage(), kreditRead == null ? null : notices); break;
                case "Rewards": views.RenderPanel(RewardPage(), rewardRead == null ? null : notices); break;
                case "Device": views.RenderPanel(DevicePage(), sessionRead == null ? null : notices); break;
                case "Profile":
                    if (profileRead == null) views.RenderPanel(Waiting("Profile", "Profile", null, AppPage.Profile, pageNotice));
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
        private PanelBlock DisconnectButton() => PanelBlock.Button(PageAction("Disconnect", () => _ = Disconnect(), () => PageAvailable()), false);
        // A failure the page itself does not show goes on it as a notice; the
        // Connect, Device and Kredits pages show their refused action themselves.
        private string NoticeFor(string family) => family == "Connect" ? null :
            refusal != null && refusalFamily == family && family != "Device" && family != "Kredits" ? refusal : failure ?? info;

        // A page whose read is not there yet: what is being checked, or, when the
        // read failed or went stale, the guardian says why with the way forward.
        private PanelPageView Waiting(string key, string title, string subtitle, AppPage? tab, string message)
        {
            var page = new PanelPageView { Key = key + " waiting", Title = title, Subtitle = subtitle, Tab = tab };
            if (failure != null && !Busy)
                page.Blocks = new[] {
                    PanelBlock.Talk(failure == "Network configuration is unavailable." ? failure :
                        "We could not refresh Arcade. Check your connection, or continue your saved Campaign.", "defeated"),
                    PanelBlock.Title("No connection"),
                    PanelBlock.Button(PageAction("Try again", () => _ = RefreshOverview(), () => PageAvailable() && !Busy), true),
                    PanelBlock.Button(PageAction("Play Campaign", () => _ = OpenCampaign(), () => PageAvailable() && identity.Owner != null), false) };
            else if (Busy || message == null)
                page.Blocks = sessionActionPending || economyActionPending ?
                    new[] { PanelBlock.Text("Page notice", WalletOpen, SkinTokens.TextMuted), DisconnectButton() } :
                    new[] { PanelBlock.Text("Page notice", message ?? "Checking…", SkinTokens.TextMuted) };
            else
                page.Blocks = new[] {
                    PanelBlock.Talk(message, "idle"),
                    PanelBlock.Button(PageAction("Refresh", () => _ = RefreshOverview(), () => PageAvailable() && !Busy), true) };
            return page;
        }
        private void Notice(string message) { pageNotice = message; Present(); }

        // Connect: the guardian of today's realm, what connecting is, and the
        // one wallet request, or why it did not connect.
        private PanelPageView ConnectPage()
        {
            bool waiting = publicRead != null && publicRead.IsCurrent && !publicRead.Value.Launched;
            var blocks = new List<PanelBlock> {
                PanelBlock.Portrait(TodayRealm),
                PanelBlock.Card("Connect card",
                    PanelBlock.Title("Your address. Your play.", centered: true),
                    PanelBlock.Text("Connect cost", waiting ? "Arena opens soon. Campaign is open now." : "Connecting is free.", SkinTokens.TextMuted, true)) };
            if (failure != null && !Busy) blocks.Add(PanelBlock.Text("Connect failure", failure, SkinTokens.Negative, true));
            if (!Refused("Connect", blocks, () => PageAvailable() && !Busy))
                blocks.Add(PanelBlock.Button(PageAction("Connect wallet", () => _ = Connect(), () => PageAvailable() && !Busy, "Connect"), true));
            return new PanelPageView { Key = "Connect", Subtitle = "Arena", Blocks = blocks.ToArray() };
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
            var page = new PanelPageView { Key = "Operation", Title = "Last operation", Subtitle = "Arena", Back = back };
            var receipt = LastReceipt;
            var arcade = PageAction("Back to Arcade", () => _ = OpenDaily(), () => PageAvailable() && !Busy);
            if (receipt == null)
            {
                page.Blocks = new[] {
                    PanelBlock.Card("Operation card", PanelBlock.Icon(SkinSlots.IconKredit, SkinTokens.TextMuted),
                        PanelBlock.Title("No operation yet", centered: true),
                        PanelBlock.Text("Transaction receipt", receiptNotice ?? "Your latest operation will appear here after a wallet or device action.")),
                    PanelBlock.Text("Operation note", "You can play Campaign without a device session.", centered: false),
                    PanelBlock.Button(arcade, true) };
                return page;
            }
            var lines = new List<PanelBlock> {
                PanelBlock.Icon(SkinSlots.IconKredit, receipt.Outcome == ExecutionOutcome.ConfirmedSuccess ? SkinTokens.Accent : SkinTokens.TextMuted),
                PanelBlock.Title(MoneyReceiptText.Title(receipt), centered: true) };
            // A confirmed title already names the operation.
            if (receipt.Outcome != ExecutionOutcome.ConfirmedSuccess)
                lines.Add(PanelBlock.Text("Operation intent", MoneyReceiptText.Intent(receipt), SkinTokens.Objective, centered: true));
            lines.Add(PanelBlock.Eyebrow("Receipt", SkinTokens.TextMuted));
            if (string.IsNullOrEmpty(receipt.Signature)) lines.Add(PanelBlock.Text("Transaction receipt", MoneyReceiptText.Describe(receipt)));
            else
            {
                lines.Add(PanelBlock.Text("Transaction receipt", MoneyReceiptText.Describe(receipt, fullReceipt)));
                lines.Add(PanelBlock.Button(PageAction(fullReceipt ? "Hide receipt" : "Show receipt", ToggleReceiptDetails,
                    () => PageAvailable() && !Busy, "Receipt details"), false));
            }
            var blocks = new List<PanelBlock> { PanelBlock.Card("Operation card", lines.ToArray()) };
            blocks.Add(PanelBlock.Text("Operation next", MoneyReceiptText.Next(receipt), centered: false));
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
            // A refused action shows its reason on the page; its receipt would say it twice.
            if (receiptFamily != family || (refusal != null && refusalFamily == family)) return null;
            var receipt = LastReceipt;
            if (receipt == null && receiptNotice == null) return null;
            return PanelBlock.Card("Receipt card", PanelBlock.Eyebrow("Last operation", SkinTokens.TextMuted),
                PanelBlock.Text("Transaction receipt", receipt == null ? receiptNotice : MoneyReceiptText.Describe(receipt, fullReceipt)),
                PanelBlock.Button(PageAction("View operation", () => OpenOperation(false), () => PageAvailable() && !Busy), false));
        }
    }
}
