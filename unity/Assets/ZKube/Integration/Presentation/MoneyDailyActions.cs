using System;
using ZKube.Integration.Client;
using System.Globalization;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core;
using ZKube.Integration.App;
using ZKube.Presentation;

namespace ZKube.Integration.Presentation
{
    public sealed partial class MoneyAppAdapter
    {
        private RectTransform dailyPanel;
        private MoneyRead<MoneyDailyState> dailyRead;
        private bool browsingDaily, confirmingDaily;
        private long dailyRefreshAt = long.MaxValue;
        public bool BrowsingDaily => browsingDaily;
        public bool ConfirmingDailyEntry => confirmingDaily;

        public Task OpenDaily() => Run(async (epoch, token) => {
            if (identity.Owner == null) return;
            CloseProductViews(); browsingDaily = true;
            overviewPanel.gameObject.SetActive(false);
            await RefreshDailyPage(epoch, token);
        });

        private void CloseDailyView()
        {
            ClearDailyObservation(); browsingDaily = false;
            if (overviewPanel != null) overviewPanel.gameObject.SetActive(true);
        }
        private void ClearDailyObservation()
        {
            dailyRead = null; confirmingDaily = false; dailyRefreshAt = long.MaxValue;
            if (browsingDaily) RetireArtwork();
            if (dailyPanel != null) { dailyPanel.gameObject.SetActive(false); Destroy(dailyPanel.gameObject); dailyPanel = null; }
        }
        private async Task RefreshDailyPage(long epoch, CancellationToken token)
        {
            ClearDailyObservation();
            if (identity.Owner == null) { CloseDailyView(); return; }
            status.text = "Checking Daily…"; DrawDailyNotice("Checking today's challenge and your saved run.");
            var result = await Flow.RefreshDaily(token);
            if (!Current(epoch) || !browsingDaily) return;
            dailyRead = result;
            if (ResultAvailable("Daily") && lastResult.Day == result.Value.Lobby.DayId)
                lastResult.Streak = (uint?)result.Value.Lobby.Profile.Fields?["entry_streak_days"];
            var value = result.Value.Lobby; long timestamp = now();
            dailyRefreshAt = checked(((long)value.DayId + 1) * 86400);
            if (value.PotLamports.HasValue)
            {
                var window = NativeEngine.DailyWindow(value.DayId);
                long opens = (long)window.OpensAt, freezes = (long)window.FreezesAt;
                if (opens > timestamp) dailyRefreshAt = Math.Min(dailyRefreshAt, opens);
                if (freezes > timestamp) dailyRefreshAt = Math.Min(dailyRefreshAt, freezes);
            }
            DrawDaily(); status.text = "Daily updated";
        }
        private void RefreshDailyIdentity()
        {
            if (!browsingDaily || dailyRead == null) return;
            if (!dailyRead.IsCurrent)
            {
                ClearDailyObservation(); DrawDailyNotice("Daily information changed. Refresh before continuing.");
                status.text = "Daily needs refreshing"; return;
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
            confirmingDaily = true; DrawDaily();
        }
        public Task ConfirmDailyEntry()
        {
            if (!confirmingDaily || !CanEnterDaily() || boardHost == null) return Task.CompletedTask;
            confirmingDaily = false;
            return OpenRun(() => Flow.StartDailyRun(), "Daily");
        }
        public Task ResumeDailyRun() => !CanUseDaily() || boardHost == null ? Task.CompletedTask :
            OpenRun(() => Flow.OpenSavedRun(), "Daily");

        private void BeginDailyPanel()
        {
            ReplacePagePanel(ref dailyPanel, "Daily lobby");
        }
        private void DailyNavigation()
        {
            Button(dailyPanel, "Refresh Daily", () => _ = RefreshOverview());
            shared.Navigation(dailyPanel);
        }
        private void DrawDailyNotice(string message)
        { BeginDailyPanel(); Label(dailyPanel, "Daily", 32, true); Label(dailyPanel, message, 20, false); DailyNavigation(); }
        private void DrawDaily()
        {
            BeginDailyPanel(); shared.Render(AppPage.Daily, dailyPanel);
            DailyNavigation(); Controls();
        }
        public DailyPageView DailyPage()
        {
            if (dailyRead == null)
            {
                var value = publicRead.Value;
                return new DailyPageView { Day = value.DayId, Realm = value.Realm,
                    ObjectiveKind = value.ObjectiveKind, ObjectiveValue = value.ObjectiveValue,
                    Status = PublicStatus(value.Status), Facts = value.PotLamports.HasValue ?
                        new[] { "Prize pot · " + (value.PotLamports.Value / 1000000000m).ToString("0.#########", CultureInfo.InvariantCulture) + " SOL" } : Array.Empty<string>() };
            }
            var state = dailyRead.Value; var lobby = state.Lobby;
            var facts = new List<string>(); var actions = new List<PageAction>();
            if (ResultAvailable("Daily")) actions.Add(PageAction("View result", () => OpenSharedPage(AppPage.Result), CanUseDaily));
            if (lobby.PotLamports.HasValue)
            {
                facts.Add("Entries close " + DateTimeOffset.FromUnixTimeSeconds((long)NativeEngine.DailyWindow(lobby.DayId).FreezesAt).ToString("HH:mm", CultureInfo.InvariantCulture) + " UTC");
                facts.Add("Prize pot · " + (lobby.PotLamports.Value / 1000000000m).ToString("0.#########", CultureInfo.InvariantCulture) + " SOL");
            }
            facts.Add(lobby.ObjectiveKind == 0 ? "Classic pays the prize pot to Score." : "One run competes on Score and Theme.");
            facts.Add("Kredits · " + lobby.Profile.Kredits);
            if (sessionActionPending) facts.Add("Your device request is still finishing. Wait before opening a run.");
            facts.Add(DailyEntryNotice(state.Entry.Status));
            if (state.Entry.Status == "pending-transaction")
                actions.Add(PageAction("Check transaction", () => _ = CheckTransaction(), CanUseDaily));
            else if (state.Entry.Status == "resume" || state.Run.Phase != "none")
                actions.Add(PageAction("Resume Daily", () => _ = ResumeDailyRun(), () => CanUseDaily() && boardHost != null));
            else if (state.Entry.Ready)
            {
                if (confirmingDaily)
                {
                    facts.Add("Spend 1 Kredit?");
                    facts.Add("This enters today's Daily. Your entry funds the following paid Daily, including across a suspension.");
                    actions.Add(PageAction("Confirm 1 Kredit", () => _ = ConfirmDailyEntry(), () => CanEnterDaily() && boardHost != null));
                    actions.Add(PageAction("Cancel entry", () => { confirmingDaily = false; DrawDaily(); }, CanUseDaily));
                }
                else actions.Add(PageAction("Enter · 1 Kredit", AskDailyEntry, () => CanEnterDaily() && boardHost != null));
            }
            return new DailyPageView { Day = lobby.DayId, Realm = lobby.Realm,
                ObjectiveKind = lobby.ObjectiveKind, ObjectiveValue = lobby.ObjectiveValue,
                Status = PublicStatus(lobby.Status), Facts = facts.ToArray(), Actions = actions.ToArray() };
        }
        private static string DailyEntryNotice(string status) => status switch {
            "ready" => "One prepaid Kredit per entry.", "resume" => "Your saved Daily is ready to check.",
            "pending-transaction" => "Check your pending transaction before continuing.",
            "needs-kredits" => "You need a Kredit to enter.", "needs-session" => "Set up this device before entering.",
            "needs-refill" => "Refill this device's fee allowance before entering.",
            "missing-player" => "Set up your player before entering.", "suspended" => "Daily entries are suspended.",
            "paused" => "Daily play is paused.", "frozen" or "closed" => "Entries are closed.",
            "not-open" => "Today's Daily has not opened yet.", "changed" => "Your entry information changed. Refresh to check it.",
            "run-address-occupied" => "A saved run needs checking before another entry.",
            _ => "Daily entry is unavailable. Refresh to check again."
        };
    }
}
