using System;
using ZKube.Integration.Client;
using System.Globalization;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Integration.App;
using ZKube.Presentation;

namespace ZKube.Integration.Presentation
{
    public sealed partial class MoneyAppAdapter
    {
        private MoneyRead<MoneyDailyState> dailyRead;
        private bool browsingDaily, confirmingDaily;
        private long dailyRefreshAt = long.MaxValue;
        public bool BrowsingDaily => browsingDaily;
        public bool ConfirmingDailyEntry => confirmingDaily;

        public Task OpenDaily() => Run(async (epoch, token) => {
            if (identity.Owner == null) return;
            CloseProductViews(); browsingDaily = true;
            await RefreshDailyPage(epoch, token);
        });

        private void CloseDailyView() { ClearDailyObservation(); browsingDaily = false; }
        private void ClearDailyObservation()
        {
            dailyRead = null; confirmingDaily = false; dailyRefreshAt = long.MaxValue; pageNotice = null; Present();
        }
        private async Task RefreshDailyPage(long epoch, CancellationToken token)
        {
            ClearDailyObservation();
            if (identity.Owner == null) { CloseDailyView(); return; }
            Status = "Checking Daily…"; Notice("Checking today's challenge and your saved run.");
            var result = await Flow.RefreshDaily(token);
            if (!Current(epoch) || !browsingDaily) return;
            dailyRead = result; pageNotice = null; AwaitLaunch(result.Value.Lobby.Launched);
            if (ResultAvailable("Daily") && lastResult.Day == result.Value.Lobby.DayId)
                lastResult.Streak = (uint?)result.Value.Lobby.Profile.Fields?["entry_streak_days"];
            var value = result.Value.Lobby; long timestamp = now();
            dailyRefreshAt = (long)NativeEngine.Daily(checked(value.DayId + 1)).OpensAt;
            if (value.PotLamports.HasValue)
            {
                var window = NativeEngine.Daily(value.DayId);
                long opens = (long)window.OpensAt, freezes = (long)window.FreezesAt;
                if (opens > timestamp) dailyRefreshAt = Math.Min(dailyRefreshAt, opens);
                if (freezes > timestamp) dailyRefreshAt = Math.Min(dailyRefreshAt, freezes);
            }
            Present(); Status = "Daily updated";
        }
        private void RefreshDailyIdentity()
        {
            if (!browsingDaily || dailyRead == null) return;
            if (!dailyRead.IsCurrent)
            {
                ClearDailyObservation(); Notice("Daily information changed. Refresh before continuing.");
                Status = "Daily needs refreshing"; return;
            }
            if (!Busy && now() >= dailyRefreshAt) { confirmingDaily = false; _ = RefreshOverview(); }
        }
        private bool CanUseDaily() => browsingDaily && !Busy && !sessionActionPending && !economyActionPending && !paused && !detached && isActiveAndEnabled &&
            dailyRead != null && dailyRead.IsCurrent;
        private bool CanEnterDaily() => CanUseDaily() && now() < dailyRefreshAt &&
            dailyRead.Value.Entry.Ready && dailyRead.Value.Run.Phase == "none";
        public void AskDailyEntry()
        {
            if (!CanEnterDaily()) return;
            confirmingDaily = true; Present();
        }
        public Task ConfirmDailyEntry()
        {
            if (!confirmingDaily || !CanEnterDaily() || boardHost == null) return Task.CompletedTask;
            confirmingDaily = false;
            return OpenRun(() => Flow.StartDailyRun());
        }
        public Task ResumeDailyRun() => !CanUseDaily() || boardHost == null ? Task.CompletedTask :
            OpenRun(() => Flow.OpenSavedRun());

        // The Arcade: today's Daily with its prize pool and entry clock, the one
        // entry action or the reason there is none, then the Kredits and rewards.
        public DailyPageView DailyPage()
        {
            if (identity.Owner == null) return ConnectHome();
            if (dailyRead == null) return WaitingHome();
            var state = dailyRead.Value; var lobby = state.Lobby;
            var actions = new List<PageAction>();
            var arcade = new ArcadeView { Pot = lobby.PotLamports.HasValue ? Sol(lobby.PotLamports.Value) : null };
            long freezes = (long)NativeEngine.Daily(lobby.DayId).FreezesAt;
            string closes = DateTimeOffset.FromUnixTimeSeconds(freezes).ToString("HH:mm", CultureInfo.InvariantCulture) + " UTC";
            arcade.Closes = lobby.PotLamports.HasValue ? "Closes " + closes : null;
            // The day's state heads the clock; the entry's own state gives the reason.
            switch (lobby.Status)
            {
                case "frozen": case "finalized": arcade.Headline = "Entries closed"; arcade.Closes = "Closed " + closes; break;
                case "suspended": arcade.Headline = "Entries paused"; arcade.Closes = "Until further notice"; arcade.Warning = true; break;
                case "paused": arcade.Headline = "Play paused"; arcade.Warning = true; break;
                case "not-open": arcade.Headline = "Opens later today"; break;
            }
            if (ResultAvailable("Daily")) actions.Add(PageAction("View result", () => OpenSharedPage(AppPage.Result), CanUseDaily));
            if (sessionActionPending) Reason(arcade, "Your device request is still finishing.", "Wait before opening a run.");
            // Before the Arena launches there is no entry, device or Kredit to offer: the Campaign is the way on.
            if (!lobby.Launched)
            {
                arcade.Headline = "Opens soon";
                return new DailyPageView { Day = lobby.DayId, Realm = lobby.Realm, ClosesAt = freezes, Now = now,
                    ObjectiveKind = lobby.ObjectiveKind, ObjectiveValue = lobby.ObjectiveValue, Status = PublicStatus(lobby.Status), Arcade = arcade,
                    Actions = new[] { PageAction("Play Campaign", () => _ = OpenCampaign(), () => PageAvailable()) }, Blocks = Array.Empty<PanelBlock>() };
            }
            switch (state.Entry.Status)
            {
                case "pending-transaction":
                    Reason(arcade, "Check your pending transaction before continuing.", null);
                    actions.Add(PageAction("Check transaction", () => _ = CheckTransaction(), CanUseDaily));
                    break;
                case "resume": break;
                case "ready": break;
                case "needs-kredits": Reason(arcade, "No Kredits available", "Buy a pack to enter today."); break;
                // The button says what to do; no sentence repeats it.
                case "needs-session": case "missing-player":
                    actions.Add(PageAction("Set up device", () => _ = OpenSession(), CanUseDaily)); break;
                case "needs-refill":
                    Reason(arcade, "Top up this device’s deposit to enter.", null);
                    actions.Add(PageAction("Manage device", () => _ = OpenSession(), CanUseDaily)); break;
                case "suspended":
                    arcade.Headline = "Entries paused"; arcade.Closes = "Until further notice"; arcade.Warning = true;
                    Reason(arcade, "Daily entries are paused", "Campaign is still available."); break;
                case "paused":
                    arcade.Headline = "Play paused"; arcade.Warning = true;
                    Reason(arcade, "Daily play is paused", "Campaign is still available."); break;
                case "frozen": case "closed":
                    arcade.Headline = "Entries closed"; arcade.Closes = "Closed " + closes;
                    Reason(arcade, "Entries closed at " + closes, "Today’s results are being finalized."); break;
                case "not-open": arcade.Headline = "Opens later today"; Reason(arcade, "Today’s Daily has not opened yet.", null); break;
                case "changed":
                    Reason(arcade, "Your entry information changed. Refresh to check it.", null);
                    actions.Add(PageAction("Refresh", () => _ = RefreshOverview(), CanUseDaily)); break;
                case "run-address-occupied": Reason(arcade, "A saved run needs checking before another entry.", null); break;
                default:
                    Reason(arcade, "Daily entry is unavailable. Refresh to check again.", null);
                    actions.Add(PageAction("Refresh", () => _ = RefreshOverview(), CanUseDaily)); break;
            }
            if (state.Entry.Status != "pending-transaction")
            {
                if (state.Entry.Status == "resume" || state.Run.Phase != "none")
                    actions.Insert(0, PageAction("Resume Daily", () => _ = ResumeDailyRun(), () => CanUseDaily() && boardHost != null));
                else if (state.Entry.Ready)
                    actions.Insert(0, PageAction("Enter · 1 Kredit", AskDailyEntry, () => CanEnterDaily() && boardHost != null));
            }
            var blocks = new List<PanelBlock>();
            if (ResultAvailable("Daily") && lastResult.Day == lobby.DayId)
            {
                string objective = catalog.ObjectiveName(lobby.ObjectiveKind, lobby.ObjectiveValue);
                var rows = new List<PanelBlock> { PanelBlock.Eyebrow("Your last run today", SkinTokens.TextMuted),
                    PanelBlock.Row("Last run score", "Score", lastResult.Score.ToString("N0", CultureInfo.InvariantCulture)) };
                if (lobby.ObjectiveKind != 0)
                    rows.Add(PanelBlock.Row("Last run objective", Sentence(objective), lastResult.ObjectiveTotal.ToString("N0", CultureInfo.InvariantCulture)));
                blocks.Add(PanelBlock.Card("Last run card", rows.ToArray()));
            }
            blocks.Add(PanelBlock.Bar("Kredit balance", SkinSlots.IconKredit, NumberFit.Figure(lobby.Profile.Kredits), lobby.Profile.Kredits == 1 ? "Kredit" : "Kredits",
                false, PageAction("Kredits", () => _ = OpenKredits(), () => PageAvailable() && !Busy),
                PageAction("Rewards", () => _ = OpenRewards(), () => PageAvailable() && !Busy)));
            blocks.Add(PanelBlock.Text("Arena rule", lobby.ObjectiveKind == 0 ? "Classic pays the whole prize pool to Score." :
                "Your best run on each board counts.", SkinTokens.TextMuted));
            var receipt = ReceiptRow("Daily");
            if (receipt != null) blocks.Add(receipt);
            return new DailyPageView { Day = lobby.DayId, Realm = lobby.Realm, ClosesAt = freezes, Now = now,
                ObjectiveKind = lobby.ObjectiveKind, ObjectiveValue = lobby.ObjectiveValue, Status = PublicStatus(lobby.Status),
                Arcade = arcade, Actions = actions.ToArray(), Blocks = blocks.ToArray() };
        }
        // The page before its read: today's realm and objective come from the day alone.
        private DailyPageView Home(ArcadeView arcade, long closesAt, params PageAction[] actions)
        {
            var today = NativeEngine.Daily(Today);
            return new DailyPageView { Day = Today, Realm = today.Realm, ObjectiveKind = today.Kind, ObjectiveValue = today.Value,
                ClosesAt = closesAt, Now = now, Arcade = arcade, Actions = actions };
        }
        // Without an address the page asks for the wallet, or says why it did not connect.
        private DailyPageView ConnectHome()
        {
            var today = publicRead != null && publicRead.IsCurrent ? publicRead.Value : null;
            var arcade = new ArcadeView { Headline = today != null && !today.Launched ? "Opens soon" : null };
            var connect = PageAction("Connect wallet", () => _ = Connect(), () => PageAvailable() && !Busy, "Connect");
            string refused = RefusalOn("Connect");
            if (refused != null)
            {
                arcade.Reason = refused; arcade.Warning = true;
                connect = PageAction("Try again", refusalRetry, () => PageAvailable() && !Busy);
            }
            else if (failure != null && !Busy) { arcade.Reason = failure; arcade.Warning = true; }
            else { arcade.Reason = "Your address. Your play."; arcade.Detail = arcade.Headline != null ? "Campaign is open now." : "Connecting is free."; }
            var page = Home(arcade, today?.FreezesAt ?? 0, connect);
            page.NoTabs = true; return page;
        }
        // With an address and no read yet: what the page waits for, or why the read is not there.
        private DailyPageView WaitingHome()
        {
            if (failure != null && !Busy)
                return Home(new ArcadeView { Headline = "No connection", Reason = failure, Warning = true },
                    0, PageAction("Try again", () => _ = RefreshOverview(), () => PageAvailable() && !Busy),
                    PageAction("Play Campaign", () => _ = OpenCampaign(), () => PageAvailable()));
            if (!Busy && pageNotice != null)
                return Home(new ArcadeView { Headline = "Needs refreshing", Reason = pageNotice },
                    0, PageAction("Refresh", () => _ = RefreshOverview(), () => PageAvailable() && !Busy));
            return Home(new ArcadeView { Headline = "Checking…" }, 0);
        }
        private static void Reason(ArcadeView arcade, string reason, string detail)
        { if (arcade.Reason != null) return; arcade.Reason = reason; arcade.Detail = detail; }
        private static string Sentence(string value) => string.IsNullOrEmpty(value) ? value : char.ToUpperInvariant(value[0]) + value.Substring(1);

        // The entry choice: what one entry costs against the confirmed balance,
        // and that it cannot be refunded.
        private PanelPageView EntryPage()
        {
            var lobby = dailyRead.Value.Lobby; var realm = catalog.Realm(lobby.Realm);
            Action close = () => { confirmingDaily = false; Present(); };
            var cancel = PageAction("Not now", close, CanUseDaily, "Cancel entry");
            return new PanelPageView { Key = "Entry", Title = "Enter today’s Daily", Subtitle = realm.realmName + " · " + Day(lobby.DayId),
                Back = PageAction("Back", close, CanUseDaily),
                Blocks = new[] {
                    PanelBlock.Talk(realm.guardianLines.dailyGreeting, "greeting"),
                    PanelBlock.Card("Entry card",
                        PanelBlock.Row("Entry cost", "Entry", "1 Kredit", icon: SkinSlots.IconKredit),
                        PanelBlock.Row("Entry balance", "Confirmed balance", NumberFit.Figure(lobby.Profile.Kredits), icon: SkinSlots.IconKredit),
                        PanelBlock.Text("Entry terms", "This entry is paid and cannot be refunded. It funds the next paid Daily.", SkinTokens.TextMuted)),
                    PanelBlock.Button(PageAction("Confirm · 1 Kredit", () => _ = ConfirmDailyEntry(), () => CanEnterDaily() && boardHost != null, "Confirm 1 Kredit"), true, SkinSlots.IconPlay),
                    PanelBlock.Button(cancel, false) } };
        }
    }
}
