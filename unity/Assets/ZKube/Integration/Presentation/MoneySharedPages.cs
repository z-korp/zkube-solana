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
                PanelBlock.Pair(PageAction("Last operation", OpenOperation, () => PageAvailable() && !Busy),
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
            // The page stays while its run's result is being saved. One that is
            // not saved yet is asked for again here; the boards are the way out.
            bool unsaved = SavingResult && boardHost.Unsaved;
            value.Done = unsaved ? PageAction("Try again", boardHost.SaveAgain, PageAvailable)
                : PageAction("Back to Arena", () => { boardHost?.Close(); _ = OpenDaily(); }, () => PageAvailable() && !Busy && !SavingResult);
            uint day = value.Day;
            if (value.HasResult) value.Leaderboard = PageAction("See boards", () => { boardHost?.Close(); _ = OpenRewards(day); },
                () => PageAvailable() && !Busy && (!SavingResult || boardHost.Unsaved));
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
                // The Arena's page is one page with or without an address.
                "Connect" => "Daily",
                "Daily" => confirmingDaily ? "Entry" : "Daily",
                "Device" => revokeConfirming ? "Revoke" : "Device",
                "Profile" => "Profile " + profileView,
                _ => family
            };
        }
        // The painting a page wears is decided when it opens, from what the
        // device already holds. A page with none of its own, or whose own is
        // not known yet, keeps the painting on screen: no default stands in.
        private byte PageRealm() => Family() switch {
            "Campaign" => campaignPage == AppPage.Result ? campaign.Last.Realm : campaign.Realm,
            "Profile" => profileRead != null && profileRead.IsCurrent ? ProfileRealm() : KnownProfileRealm() ?? ShownRealm,
            "Rewards" => ShownRealm,
            "Result" => lastResult != null && lastResult.HasResult ? lastResult.Realm : TodayRealm,
            "Settings" => ShownRealm,
            _ => TodayRealm
        };
        private byte ShownRealm => shell.Artwork?.RealmId is byte realm && realm != 0 ? realm : TodayRealm;
        private void Draw()
        {
            var notices = new[] { NoticeFor(Family()) };
            switch (Family())
            {
                // The Arena has one home page. Without an address it carries the connect
                // request, and before its read lands what it is waiting for, in its own slots.
                case "Connect": views.Render(AppPage.Home); break;
                case "Campaign":
                    views.Render(campaignPage.Value, campaign.Unsaved ? notices.Append(RunBoard.UnsavedWarning) : notices); break;
                case "Daily":
                    if (dailyRead == null) views.Render(AppPage.Home);
                    else if (confirmingDaily) views.RenderPanel(EntryPage(), notices);
                    else
                    {
                        views.Render(AppPage.Home);
                        // The first Arena with an address teaches the Arena Daily, over the page and never on the entry sheet.
                        if (dailyRead.TryValue(out var shown) && shown.Lobby.Launched && !Lessons.Device.Taught(Lesson.ArenaDaily)) views.Teach(Lessons.ArenaDaily, () => Lessons.Device.Teach(Lesson.ArenaDaily));
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
            refusal != null && refusalFamily == family && family != "Device" && family != "Kredits" && family != "Daily" && family != "Operation" ? refusal : failure ?? info;

        // A page whose read is not there yet: what is being checked, or, when the
        // read failed or went stale, the guardian says why with the way forward.
        private PanelPageView Waiting(string key, string title, string subtitle, AppPage? tab, string message)
        {
            var page = new PanelPageView { Key = key + " waiting", Title = title, Subtitle = subtitle, Tab = tab };
            if (failure != null && !Busy)
                page.Blocks = new[] {
                    PanelBlock.Talk(failure, "defeated"),
                    PanelBlock.Title("Not loaded"),
                    PanelBlock.Button(PageAction("Try again", () => _ = RefreshOverview(), () => PageAvailable() && !Busy), true),
                    PanelBlock.Button(PageAction("Play Campaign", () => _ = OpenCampaign(), () => PageAvailable() && identity.Owner != null), false) };
            else if (Busy || message == null)
                page.Blocks = sessionActionPending || economyActionPending ?
                    new[] { PanelBlock.Button(Progressing(), true), DisconnectButton() } :
                    new[] { PanelBlock.Text("Page notice", message ?? "Checking…", SkinTokens.TextMuted) };
            else
                page.Blocks = new[] {
                    PanelBlock.Talk(message, "idle"),
                    PanelBlock.Button(PageAction("Refresh", () => _ = RefreshOverview(), () => PageAvailable() && !Busy), true) };
            return page;
        }
        private void Notice(string message) { pageNotice = message; Present(); }

        // The last operation: its outcome, what it was, the receipt and the one
        // thing to do next. Tapping the receipt shows the whole signature. It
        // is the one place a receipt is shown: Settings opens it, and no other
        // page carries a receipt card, since each action shows its own progress,
        // reason and retry where it was asked.
        private void OpenOperation()
        {
            if (!PageAvailable() || Busy) return;
            CloseProductViews(); browsingOperation = true; Present();
        }
        private void ReturnFromOperation() => OpenSharedPage(AppPage.Settings);
        private PanelPageView OperationPage()
        {
            var back = PageAction("Back", ReturnFromOperation, () => PageAvailable() && !Busy);
            var page = new PanelPageView { Key = "Operation", Title = "Last operation", Subtitle = "Arena", Back = back };
            var receipt = LastReceipt;
            var arcade = PageAction("Back to Arena", () => _ = OpenDaily(), () => PageAvailable() && !Busy);
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
            if (receipt.Outcome == ExecutionOutcome.Pending) Refused("Operation", blocks, () => PageAvailable() && !Busy);
            else if (receipt.Outcome == ExecutionOutcome.FeeShortage)
                blocks.Add(PanelBlock.Button(PageAction("Manage device", () => _ = OpenSession(), () => PageAvailable() && !Busy), true));
            else blocks.Add(PanelBlock.Button(arcade, true));
            page.Blocks = blocks.ToArray();
            return page;
        }
    }
}
