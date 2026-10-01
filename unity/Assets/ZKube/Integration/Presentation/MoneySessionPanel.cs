using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Core.Generated;
using ZKube.Integration.App;
using ZKube.Integration.Client;
using ZKube.Integration.Execution;
using ZKube.Integration.Planning;
using ZKube.Presentation;

namespace ZKube.Integration.Presentation
{
    public sealed partial class MoneyAppAdapter
    {
        private MoneyRead<MoneySessionState> sessionRead;
        private bool browsingSession, sessionActionPending, sessionReadbackNeeded, revokeConfirming, sessionFromSettings;
        public bool BrowsingSession => browsingSession;
        public bool SessionActionPending => sessionActionPending;

        public Task OpenSession() => OpenSession(false);
        private Task OpenSession(bool fromSettings) => Run(async (epoch, token) => {
            if (identity.Owner == null) return;
            CloseProductViews(); browsingSession = true; sessionFromSettings = fromSettings;
            await RefreshSessionPage(epoch, token);
        });

        private void CloseSessionView() { ClearSessionObservation(); browsingSession = false; revokeConfirming = false; }
        private void ClearSessionObservation() { sessionRead = null; pageNotice = null; Present(); }
        private async Task RefreshSessionPage(long epoch, CancellationToken token)
        {
            ClearSessionObservation();
            if (identity.Owner == null) { CloseSessionView(); return; }
            Notice("Checking this device…"); Status = "Checking device session…";
            var result = await Flow.RefreshSession(token);
            if (!Current(epoch) || !browsingSession) return;
            sessionRead = result; sessionReadbackNeeded = false; pageNotice = null; Present();
            var state = result.Value;
            if (state.PreviousOperation != null) ShowReceipt(state.PreviousOperation, state.Owner);
            Status = state.RecoveredOperation ? "Checked the existing transaction. No new device setup was requested." : "Device session updated";
            if (state.RecoveredOperation) Inform(Status);
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
            ClearSessionObservation(); Notice("Device information changed. Refresh to check it again.");
            Status = "Device session needs refreshing";
        }

        // How this device stands, in a title for its page and a short state for
        // Settings. A device whose last confirmed operation disabled it says so.
        private (string Title, string Short, string Token, string Guide) DeviceState(SessionAssessment session)
        {
            if (session == null) return ("This device", "Checking…", SkinTokens.TextMuted, null);
            if (session.Status == "none")
                return LastReceipt?.Intent == "session-revoke" && LastReceipt.Outcome == ExecutionOutcome.ConfirmedSuccess ?
                    ("Device disabled", "Disabled", SkinTokens.Text,
                        "This device can no longer spend Kredits or sign game actions. You can enable it again when ready.") :
                    ("Set up this device", "Not set up", SkinTokens.Text,
                        "Your wallet funds a " + Sol(PlanningConstants.DeviceAllowanceLamports) +
                        " fee allowance plus setup rent and fees. This device then spends your prepaid Kredits on Daily entries.");
            if (!session.Current)
                return ("Renew authorization", "Renewal needed", SkinTokens.Text, session.TokenMayClose ?
                    "The authorization has ended. Your wallet replaces it with a new one for this device." :
                    "Renew before playing. Your wallet replaces the current authorization with a new one for this device.");
            if (session.Funding != "ready")
                return ("Fee allowance low", "Allowance low", SkinTokens.Text,
                    "Refill the fee allowance to continue. Your wallet funds the " + Sol(PlanningConstants.DeviceAllowanceLamports) + " target and shows any fees.");
            return (session.Status == "expiring" ? "Session expires soon" : "Session active", session.Status == "expiring" ? "Expires soon" : "Session active",
                SkinTokens.Positive, "This device signs game actions and spends your prepaid Kredits on Daily entries. Your wallet approves purchases and device changes.");
        }

        private PanelPageView DevicePage()
        {
            var back = sessionFromSettings ? PageAction("Back", () => OpenSharedPage(AppPage.Settings), () => PageAvailable() && !Busy) :
                PageAction("Back", () => _ = OpenDaily(), () => PageAvailable() && !Busy);
            if (sessionRead == null) { var waiting = Waiting("Device", "This device", "Device session", sessionFromSettings ? 3 : 1, pageNotice); waiting.Back = back; return waiting; }
            if (revokeConfirming) return RevokePage();
            var state = sessionRead.Value; var session = state.Session; var look = DeviceState(session);
            var page = new PanelPageView { Key = "Device", Title = "This device", Subtitle = "Device session", Back = back, Tab = sessionFromSettings ? 3 : 1 };
            var rows = new List<PanelBlock> {
                PanelBlock.Row("Device state", "Status", look.Title, tagToken: look.Token),
                PanelBlock.Row("Device owner", "Owner", Short(state.Owner)),
                PanelBlock.Row("Fee allowance", "Fee allowance", session.ValidUntil > 0 ? Sol(session.Balance) : "—") };
            if (session.ValidUntil > 0) rows.Add(PanelBlock.Row("Device expiry", "Authorization ends", Utc(session.ValidUntil)));
            var blocks = new List<PanelBlock> { PanelBlock.Card("Device card", rows.ToArray()) };
            var receipt = ReceiptRow("Device");
            if (receipt != null) blocks.Add(receipt);
            if (sessionActionPending)
            {
                blocks.Add(PanelBlock.Text("Device guide", "A device request is still finishing. Returning to this page does not cancel a wallet request.", SkinTokens.TextMuted));
                blocks.Add(DisconnectButton());
            }
            else if (state.Pending != null)
            {
                blocks.Add(PanelBlock.Text("Device guide", "An existing transaction needs checking before this device can change. Checking it will not start a new setup.",
                    SkinTokens.TextMuted));
                blocks.Add(PanelBlock.Button(PageAction("Check transaction", () => _ = CheckTransaction(), () => PageAvailable() && !Busy), true));
            }
            else
            {
                blocks.Add(PanelBlock.Text("Device guide", look.Guide, SkinTokens.TextMuted));
                bool changeable = PageAvailable() && !Busy;
                if (session.ValidUntil > 0)
                    blocks.Add(PanelBlock.Button(PageAction("Disable this device", () => { revokeConfirming = true; Present(); }, DeviceChangeable), false));
                if (!session.Current)
                    blocks.Add(PanelBlock.Button(PageAction(session.Status == "none" ? "Enable device" : "Renew device", () => _ = EnsureDeviceSession(),
                        () => changeable && DeviceChangeable()), true));
                else if (session.Funding != "ready")
                    blocks.Add(PanelBlock.Button(PageAction("Refill allowance", () => _ = RefillDeviceSession(), DeviceChangeable), true));
                if (session.ValidUntil <= 0) blocks.Add(PanelBlock.Button(PageAction("Back to Campaign", () => _ = OpenCampaign(), () => PageAvailable()), false));
            }
            page.Blocks = blocks.ToArray();
            return page;
        }
        private bool DeviceChangeable() => PageAvailable() && !Busy && !sessionActionPending && !economyActionPending && sessionRead != null && sessionRead.IsCurrent;

        // Disabling asks first: what stops, and what the wallet gets back.
        private PanelPageView RevokePage()
        {
            var keep = PageAction("Keep enabled", () => { revokeConfirming = false; Present(); }, () => PageAvailable());
            return new PanelPageView { Key = "Revoke", Title = "Disable this device", Subtitle = "Arena", Back = keep, Blocks = new[] {
                PanelBlock.Card("Revoke card", PanelBlock.Title("Revoke device access?", centered: true),
                    PanelBlock.Text("Revoke effect", "This device will stop signing game actions and spending your prepaid Kredits."),
                    PanelBlock.Text("Revoke return", "The remaining fee allowance returns to your wallet. Your Kredits remain in your balance, and this device keeps its install key for later reauthorization.")),
                PanelBlock.Button(keep, true),
                PanelBlock.Button(PageAction("Disable in wallet", () => { revokeConfirming = false; _ = DisableDeviceSession(); }, DeviceChangeable), false) } };
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
                sessionActionPending = true; Present();
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
                    if (Current(epoch) && recovered) Inform("Checked the existing transaction. No new device setup was requested.");
                }
                finally
                {
                    sessionActionPending = false;
                    if (Current(epoch)) Present();
                    else sessionReadbackNeeded = true;
                }
            });
        }
    }
}
