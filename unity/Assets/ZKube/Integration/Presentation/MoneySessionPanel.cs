using System;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Integration.App;
using ZKube.Integration.Client;
using ZKube.Integration.Execution;
using ZKube.Integration.Planning;

namespace ZKube.Integration.Presentation
{
    public sealed partial class MoneyAppController
    {
        private RectTransform sessionPanel;
        private Button sessionButton;
        private MoneyRead<MoneySessionState> sessionRead;
        private bool browsingSession, sessionActionPending, sessionReadbackNeeded;
        public bool BrowsingSession => browsingSession;
        public bool SessionActionPending => sessionActionPending;

        public Task OpenSession() => Run(async (epoch, token) => {
            if (identity.Owner == null) return;
            CloseProductViews(); browsingSession = true; overviewPanel.gameObject.SetActive(false);
            await RefreshSessionPage(epoch, token);
        });

        private void CloseSessionView()
        {
            ClearSessionObservation(); browsingSession = false;
            if (overviewPanel != null) overviewPanel.gameObject.SetActive(true);
        }
        private void ClearSessionObservation()
        {
            sessionRead = null;
            if (sessionPanel != null) { sessionPanel.gameObject.SetActive(false); Destroy(sessionPanel.gameObject); sessionPanel = null; }
        }
        private async Task RefreshSessionPage(long epoch, CancellationToken token)
        {
            ClearSessionObservation();
            if (identity.Owner == null) { CloseSessionView(); owner.text = "Connect your wallet to manage this device."; return; }
            DrawSessionNotice("Checking this device…"); status.text = "Checking device session…";
            var result = await Flow.RefreshSession(token);
            if (!Current(epoch) || !browsingSession) return;
            sessionRead = result; sessionReadbackNeeded = false; DrawSession();
            var state = result.Value;
            if (state.PreviousOperation != null) ShowReceipt(state.PreviousOperation, state.Owner);
            status.text = state.RecoveredOperation ? "Checked the existing transaction. No new device setup was requested." : "Device session updated";
        }
        private void RefreshSessionIdentity()
        {
            // A wallet callback can finish after pause/disable invalidated its
            // publication. Only a new read for the visible identity may follow.
            if (sessionReadbackNeeded && browsingSession && !Busy && !paused)
            { sessionReadbackNeeded = false; _ = RefreshOverview(); return; }
            if (browsingSession && !Busy && !sessionActionPending && sessionRead != null && sessionRead.IsCurrent)
            {
                var value = sessionRead.Value.Session; long timestamp = now();
                if (value.ValidUntil > 0 && (SessionReadiness.Status(value.ValidUntil, timestamp) != value.Status ||
                    (value.ValidUntil <= timestamp) != value.TokenMayClose))
                { _ = RefreshOverview(); return; }
            }
            if (!browsingSession || sessionRead == null || sessionRead.IsCurrent) return;
            ClearSessionObservation(); DrawSessionNotice("Device information changed. Refresh to check it again.");
            status.text = "Device session needs refreshing";
        }
        private void BeginSessionPanel()
        {
            ReplacePagePanel(ref sessionPanel, "Device session panel");
            Label(sessionPanel, "This device", 32, true);
        }
        private void SessionNavigation()
        {
            Button(sessionPanel, "Refresh session", () => _ = RefreshOverview());
            Button(sessionPanel, "Overview", () => _ = OpenOverview());
            Button(sessionPanel, "Disconnect", () => _ = Disconnect());
        }
        private void DrawSessionNotice(string message)
        { BeginSessionPanel(); Label(sessionPanel, message, 20, false); SessionNavigation(); }
        private void DrawSession()
        {
            var state = sessionRead.Value; var session = state.Session;
            BeginSessionPanel();
            Label(sessionPanel, state.Owner, 18, false);
            Label(sessionPanel, SessionText(session), 23, true);
            Label(sessionPanel, "A device session signs game actions. Your wallet approves setup and funds a recyclable fee-and-rent allowance.", 19, false);
            Label(sessionPanel, "This device can spend your prepaid Kredits on Daily entries. Buying Kredits still requires your wallet.", 19, false);
            Label(sessionPanel, "Allowance target: " + (PlanningConstants.DeviceAllowanceLamports / 1000000000m).ToString("0.#########", CultureInfo.InvariantCulture) +
                " SOL. Setup also needs account rent and transaction fees; your wallet shows the request.", 19, false);
            if (session.ValidUntil > 0)
            {
                Label(sessionPanel, "Fee allowance: " + (session.Balance / 1000000000m).ToString("0.#########", CultureInfo.InvariantCulture) + " SOL", 20, false);
                Label(sessionPanel, session.ValidUntil <= DateTimeOffset.MaxValue.ToUnixTimeSeconds() ?
                    "Authorization expires " + DateTimeOffset.FromUnixTimeSeconds(session.ValidUntil).ToString("d MMM yyyy HH:mm", CultureInfo.InvariantCulture) + " UTC." :
                    "Authorization expiry is outside this calendar's display range.", 18, false);
                if (!session.Current && !session.TokenMayClose)
                    Label(sessionPanel, "Renew before playing. The current authorization has not expired yet.", 18, false);
            }
            if (sessionActionPending)
                Label(sessionPanel, "A device request is still finishing. Returning to this page does not cancel a wallet request.", 19, false);
            else if (state.Pending != null)
            {
                Label(sessionPanel, "An existing transaction needs checking before this device can change. Checking it will not start a new setup.", 19, false);
                Button(sessionPanel, "Check transaction", () => _ = CheckTransaction());
            }
            else
            {
                if (!session.Current) Button(sessionPanel, session.Status == "none" ? "Enable device" : "Renew device", () => _ = EnsureDeviceSession());
                else if (session.Funding != "ready") Button(sessionPanel, "Refill allowance", () => _ = RefillDeviceSession());
                if (session.ValidUntil > 0)
                {
                    Label(sessionPanel, "Disable this device returns its remaining fee allowance to your wallet and removes its signing key here. Its on-chain authorization expires at the time shown above; this does not immediately revoke that token.", 18, false);
                    Button(sessionPanel, "Disable this device", () => _ = DisableDeviceSession());
                }
            }
            SessionNavigation();
        }

        public Task EnsureDeviceSession() => ChangeDeviceSession(true, false);
        public Task RefillDeviceSession() => ChangeDeviceSession(false, false);
        public Task DisableDeviceSession() => ChangeDeviceSession(false, true);

        private Task ChangeDeviceSession(bool ensure, bool disable)
        {
            if (!browsingSession || sessionActionPending || economyActionPending || sessionRead == null || !sessionRead.IsCurrent || sessionRead.Value.Pending != null)
                return Task.CompletedTask;
            var assessment = sessionRead.Value.Session;
            if (ensure ? assessment.Current : disable ? assessment.ValidUntil <= 0 : !assessment.Current || assessment.Funding == "ready")
                return Task.CompletedTask;
            return Run(async (epoch, token) => {
                sessionActionPending = true; Controls();
                try
                {
                    ExecutionResult result; bool recovered = false;
                    if (ensure)
                    {
                        var ensured = (await Flow.EnsureSession()).Value;
                        result = ensured.Operation; recovered = ensured.Action == "recover";
                    }
                    else result = (await (disable ? Flow.RevokeSession() : Flow.RefillSession())).Value;
                    if (!Current(epoch)) return;
                    ShowReceipt(result, identity.Owner); // Preserve the exact result before read-back can fail.
                    await RefreshSessionPage(epoch, token);
                    if (Current(epoch) && recovered) status.text = "Checked the existing transaction. No new device setup was requested.";
                }
                finally
                {
                    sessionActionPending = false;
                    if (Current(epoch)) { if (sessionRead != null && sessionRead.IsCurrent) DrawSession(); Controls(); }
                    else sessionReadbackNeeded = true;
                }
            });
        }
        private void SessionControls(bool available)
        {
            if (sessionButton != null) sessionButton.interactable = available && !Busy && identity?.Owner != null;
            if (sessionPanel == null) return;
            foreach (var button in sessionPanel.GetComponentsInChildren<Button>(true))
                button.interactable = available && (button.name == "Disconnect" || (!Busy &&
                    (button.name == "Overview" || button.name == "Refresh session" ||
                    (!sessionActionPending && !economyActionPending && sessionRead != null && sessionRead.IsCurrent))));
        }
    }
}
