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
        // checked.
        private string pageNotice;
        public bool BrowsingOperation => browsingOperation;

        // An action does what its words say on the page it is tapped on. One that opens another
        // page is made by Leading, and its words name that page. An action that opens a page
        // without saying so is recorded here, where every test that taps it finds it.
        private PageAction PageAction(string text, Action invoke, Func<bool> available = null, string name = null, string icon = null)
        {
            var action = new PageAction { Label = text, Name = name, CanInvoke = available, Icon = icon };
            action.Invoke = () => {
                // Connecting and disconnecting change who is here, not which page is open.
                string from = Family(); invoke(); string to = Family();
                if (to != from && from != "Connect" && to != "Connect" && !strayOpens.Contains(name ?? text)) strayOpens.Add(name ?? text);
            };
            return action;
        }
        private static PageAction Leading(string text, Action invoke, Func<bool> available = null, string name = null, string icon = null) =>
            new PageAction { Label = text, Name = name, Invoke = invoke, CanInvoke = available, Icon = icon, Opens = true };
        private readonly List<string> strayOpens = new List<string>();
        public IReadOnlyList<string> StrayOpens => strayOpens;
        private bool PageAvailable() => Flow != null && !detached && !paused && isActiveAndEnabled && !PlayingRun;
        // A tab is a way off the page: it waits for nothing the page is doing.
        public bool CanNavigate(AppPage page) => PageAvailable() && (page == AppPage.Settings || identity.Owner != null);
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
            if (page == AppPage.Settings && identity.Owner != null) _ = Run(RefreshSharedPage, true);
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
            var view = AppPreferences.Read(() => { InitializeViews(); Present(); });
            if (identity?.Owner == null) return view;
            var session = settingsRead != null && settingsRead.IsCurrent ? settingsRead.Value.Session : null;
            view.Identity = new[] {
                PanelBlock.Card("Device card", PanelBlock.Eyebrow(Words.ArenaDeviceTitleHeading, SkinTokens.TextMuted),
                    new PanelBlock { Kind = PanelKind.Text, Name = "Device status", Copy = DeviceState(session).Short,
                        Token = DeviceState(session).Token, Action = Leading(Words.ArenaDeviceManageShort, () => _ = OpenSession(true), () => PageAvailable() && !Busy, "Manage") }) };
            // The foot row: the last operation, and Disconnect last.
            view.Tertiary = Leading(Words.ArenaOperationTitle, OpenOperation, () => PageAvailable() && !Busy, "Last operation"); view.Tertiary.Icon = SkinSlots.IconClock;
            view.Destructive = PageAction(Words.ArenaDisconnect, () => _ = Disconnect(), () => PageAvailable(), "Disconnect"); view.Destructive.Icon = SkinSlots.IconWallet;
            return view;
        }
        // The Campaign's result is the journey's; the Arcade's is its last kept run.
        public ResultPageView ResultPage()
        {
            if (campaignPage == AppPage.Result) return campaign.ResultPage(Application.productName, identity.Owner);
            var value = lastResult != null && lastResult.PlayerName == identity.Owner ? lastResult :
                new ResultPageView { ProductName = Application.productName, Mode = Words.ModeDaily, Realm = 1, PlayerName = identity.Owner ?? "" };
            value.Share = ResultSharing.Open; value.Arcade = true;
            // The page stays while its run's result is being saved. One that is
            // not saved yet is asked for again here; the boards are the way out.
            bool unsaved = SavingResult && boardHost.Unsaved;
            value.Done = unsaved ? PageAction(Words.ActionTryAgain, boardHost.SaveAgain, PageAvailable, "Try again")
                : Leading(Words.ActionContinue, () => { boardHost?.Close(); _ = OpenDaily(); }, () => PageAvailable() && !Busy && !SavingResult, "Continue");
            uint day = value.Day;
            if (value.HasResult) value.Leaderboard = Leading(Words.ArenaSeeBoards, () => { boardHost?.Close(); _ = OpenRewards(day); },
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
            // The page is made before its notice is: a reason the page drew is its own, and the notice leaves it out.
            refusalDrawn = false;
            string[] Notices() => new[] { NoticeFor(Family()) };
            switch (Family())
            {
                // The Arena has one home page. Without an address it carries the connect
                // request, and before its read lands what it is waiting for, in its own slots.
                case "Connect": views.Render(AppPage.Home); break;
                case "Campaign":
                    views.Render(campaignPage.Value, campaign.Unsaved ? Notices().Append(RunBoard.UnsavedWarning) : Notices()); break;
                case "Daily":
                    if (dailyRead == null) views.Render(AppPage.Home);
                    else if (confirmingDaily) views.RenderPanel(EntryPage(), Notices());
                    else
                    {
                        views.Render(AppPage.Home);
                        // The first Arena with an address teaches the Arena Daily, over the page and never on the entry sheet.
                        if (dailyRead.TryValue(out var shown) && shown.Lobby.Launched && !Lessons.Device.Taught(Lesson.ArenaDaily)) views.Teach(Lessons.ArenaDaily, () => Lessons.Device.Teach(Lesson.ArenaDaily));
                    }
                    break;
                // A page without its read shows its failure itself.
                case "Kredits": views.RenderPanel(KreditPage(), kreditRead == null ? null : Notices()); break;
                case "Rewards": views.RenderPanel(RewardPage(), rewardRead == null ? null : Notices()); break;
                case "Device": views.RenderPanel(DevicePage(), sessionRead == null ? null : Notices()); break;
                case "Profile":
                    if (profileRead == null) views.RenderPanel(Waiting("Profile", Words.TabProfile, null, AppPage.Profile, pageNotice));
                    else if (profileView == ProfileView.Main) views.Render(AppPage.Profile, Notices());
                    else views.RenderPanel(ProfilePanel(), Notices());
                    break;
                case "Operation": views.RenderPanel(OperationPage()); break;
                case "Settings": views.Render(AppPage.Settings, Notices()); break;
                case "Result": views.Render(AppPage.Result, Notices()); break;
                default: throw new InvalidOperationException("Unknown page " + Family());
            }
        }
        // While a wallet request is open, Disconnect stays within reach, last in the foot row.
        private PageAction Disconnecting() => PageAction(Words.ArenaDisconnect, () => _ = Disconnect(), () => PageAvailable(), "Disconnect", SkinSlots.IconWallet);
        // What the page should say above itself: a refused action's reason where the page did not
        // draw it, else a failed read or what the last operation left to say.
        private string NoticeFor(string family) => family == "Connect" ? null :
            RefusalOn(family) != null && !refusalDrawn ? refusal : failure ?? info;

        // A page whose read is not there yet: what is being checked, or, when the
        // read failed, why, with the way forward. A read that went stale is
        // simply made again.
        private PanelPageView Waiting(string key, string title, string subtitle, AppPage? tab, string message)
        {
            var page = new PanelPageView { Key = key + " waiting", Title = title, Subtitle = subtitle, Tab = tab };
            if (failure != null && !Busy)
            {
                page.Blocks = new[] { PanelBlock.Title(Words.ArenaHeadlineNotLoaded, centered: true, name: "Not loaded"), PanelBlock.Text("Page failure", failure, centered: true) };
                page.Primary = PageAction(Words.ActionTryAgain, () => _ = RefreshOverview(), () => PageAvailable() && !Busy, "Try again", SkinSlots.IconRetry);
                page.Secondary = Leading(Words.ArenaPlayCampaign, () => _ = OpenCampaign(), () => PageAvailable() && identity.Owner != null, "Play Campaign", SkinSlots.IconPlay);
            }
            else if (sessionActionPending || economyActionPending) Requesting(page);
            else page.Blocks = new[] { PanelBlock.Text("Page notice", message ?? Words.ArenaChecking, SkinTokens.TextMuted) };
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
            if (!PageAvailable()) return;
            CloseProductViews(); browsingOperation = true; Present();
        }
        private void ReturnFromOperation() => OpenSharedPage(AppPage.Settings);
        private PanelPageView OperationPage()
        {
            var back = Leading(null, ReturnFromOperation, PageAvailable);
            // A page that shows: it keeps its tab bar, Settings lit, which returns there. It has a
            // button only where there is a step to take.
            var page = new PanelPageView { Key = "Operation", Title = Words.ArenaOperationTitle, Subtitle = Words.TabArena, Back = back, Tab = AppPage.Settings };
            var receipt = LastReceipt;
            if (receipt == null)
            {
                page.Blocks = new[] {
                    PanelBlock.Card("Operation card", PanelBlock.Icon(SkinSlots.IconKredit, SkinTokens.TextMuted),
                        PanelBlock.Title(Words.ArenaOperationNone, centered: true, name: "No operation yet"),
                        PanelBlock.Text("Transaction receipt", receiptNotice ?? Words.ArenaOperationNoneDetail)),
                    PanelBlock.Text("Operation note", Words.ArenaOperationCampaignNote, centered: false) };
                return page;
            }
            var lines = new List<PanelBlock> {
                PanelBlock.Icon(SkinSlots.IconKredit, receipt.Outcome == ExecutionOutcome.ConfirmedSuccess ? SkinTokens.Accent : SkinTokens.TextMuted),
                PanelBlock.Title(MoneyReceiptText.Title(receipt), centered: true) };
            // A confirmed title already names the operation.
            if (receipt.Outcome != ExecutionOutcome.ConfirmedSuccess)
                lines.Add(PanelBlock.Text("Operation intent", MoneyReceiptText.Intent(receipt), SkinTokens.Objective, centered: true));
            lines.Add(PanelBlock.Eyebrow(Words.ArenaOperationReceipt, SkinTokens.TextMuted));
            if (string.IsNullOrEmpty(receipt.Signature)) lines.Add(PanelBlock.Text("Transaction receipt", MoneyReceiptText.Describe(receipt)));
            else
            {
                lines.Add(PanelBlock.Text("Transaction receipt", MoneyReceiptText.Describe(receipt, fullReceipt)));
                lines.Add(PanelBlock.Button(PageAction(fullReceipt ? Words.ArenaOperationHide : Words.ArenaOperationShow, ToggleReceiptDetails,
                    () => PageAvailable() && !Busy, "Receipt details"), false));
            }
            var blocks = new List<PanelBlock> { PanelBlock.Card("Operation card", lines.ToArray()) };
            blocks.Add(PanelBlock.Text("Operation next", MoneyReceiptText.Next(receipt), centered: false));
            if (receipt.Outcome == ExecutionOutcome.Pending) Refused("Operation", page, () => PageAvailable() && !Busy);
            else if (receipt.Outcome == ExecutionOutcome.FeeShortage)
                page.Primary = Leading(Words.ArenaDeviceManage, () => _ = OpenSession(), () => PageAvailable() && !Busy, "Manage device", SkinSlots.IconDevice);
            page.Blocks = blocks.ToArray();
            return page;
        }
    }
}
