using System;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core;
using ZKube.Integration.App;
using ZKube.Presentation;

namespace ZKube.Integration.Presentation
{
    public sealed partial class MoneyAppController
    {
        private RectTransform dailyPanel;
        private Button dailyButton;
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
            Button(dailyPanel, "Campaign", () => _ = OpenCampaign());
            Button(dailyPanel, "This device", () => _ = OpenSession());
            Button(dailyPanel, "Kredits", () => _ = OpenKredits());
            Button(dailyPanel, "Results", () => _ = OpenRewards());
            Button(dailyPanel, "Overview", () => _ = OpenOverview());
        }
        private void DrawDailyNotice(string message)
        { BeginDailyPanel(); Label(dailyPanel, "Daily", 32, true); Label(dailyPanel, message, 20, false); DailyNavigation(); }
        private void DrawDaily()
        {
            var state = dailyRead.Value; var lobby = state.Lobby;
            if (catalog == null) catalog = PageCatalog.Load();
            var realm = catalog.Realm(lobby.Realm); var objective = catalog.Objective(lobby.ObjectiveKind, lobby.ObjectiveValue);
            BeginDailyPanel();
            Label(dailyPanel, "Daily · " + DateTimeOffset.FromUnixTimeSeconds((long)lobby.DayId * 86400).ToString("d MMM yyyy", CultureInfo.InvariantCulture) + " UTC", 25, true);
            Label(dailyPanel, realm.realmName + " · " + realm.guardianName, 29, true);
            Label(dailyPanel, objective.name, 25, true); Label(dailyPanel, objective.description, 19, false);
            Label(dailyPanel, PublicStatus(lobby.Status), 21, false);
            if (lobby.PotLamports.HasValue)
                Label(dailyPanel, "Entries close " + DateTimeOffset.FromUnixTimeSeconds((long)NativeEngine.DailyWindow(lobby.DayId).FreezesAt).ToString("HH:mm", CultureInfo.InvariantCulture) + " UTC", 19, false);
            if (lobby.PotLamports.HasValue)
                Label(dailyPanel, "Prize pot · " + (lobby.PotLamports.Value / 1000000000m).ToString("0.#########", CultureInfo.InvariantCulture) + " SOL", 25, true);
            Label(dailyPanel, lobby.ObjectiveKind == 0 ? "Classic pays the prize pot to Score." : "One run competes on Score and Theme.", 19, false);
            Label(dailyPanel, "Kredits · " + lobby.Profile.Kredits, 22, true);
            if (sessionActionPending) Label(dailyPanel, "Your device request is still finishing. Wait before opening a run.", 19, false);
            Label(dailyPanel, DailyEntryNotice(state.Entry.Status), 19, false);
            if (state.Entry.Status == "pending-transaction")
                Button(dailyPanel, "Check transaction", () => _ = CheckTransaction());
            else if (state.Entry.Status == "resume" || state.Run.Phase != "none")
                Button(dailyPanel, "Resume Daily", () => _ = ResumeDailyRun());
            else if (state.Entry.Ready)
            {
                if (confirmingDaily)
                {
                    Label(dailyPanel, "Spend 1 Kredit?", 26, true);
                    Label(dailyPanel, "This enters today's Daily. Your entry funds the following paid Daily, including across a suspension.", 19, false);
                    Button(dailyPanel, "Confirm 1 Kredit", () => _ = ConfirmDailyEntry());
                    Button(dailyPanel, "Cancel entry", () => { if (!CanUseDaily()) return; confirmingDaily = false; DrawDaily(); });
                }
                else Button(dailyPanel, "Enter · 1 Kredit", AskDailyEntry);
            }
            DailyNavigation(); RequestArt(lobby.Realm); Controls();
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
        private void DailyControls(bool available)
        {
            if (dailyButton != null) dailyButton.interactable = available && !Busy && identity?.Owner != null;
            if (dailyPanel == null) return;
            foreach (var button in dailyPanel.GetComponentsInChildren<Button>(true))
            {
                bool navigation = button.name == "Overview" || button.name == "Refresh Daily" || button.name == "Campaign" || button.name == "This device" || button.name == "Kredits" || button.name == "Results";
                button.interactable = available && !Busy && (navigation || CanUseDaily());
                if (button.name == "Enter · 1 Kredit" || button.name == "Confirm 1 Kredit")
                    button.interactable = available && CanEnterDaily() && boardHost != null;
            }
        }
    }
}
