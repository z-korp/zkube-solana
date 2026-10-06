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
        }, true);

        private void CloseSessionView() { ClearSessionObservation(); browsingSession = false; revokeConfirming = false; }
        private void ClearSessionObservation() { sessionRead = null; pageNotice = null; Present(); }
        private async Task RefreshSessionPage(long epoch, CancellationToken token)
        {
            ClearSessionObservation();
            if (identity.Owner == null) { CloseSessionView(); return; }
            Notice(Words.ArenaDeviceChecking); Status = "Checking device session…";
            var result = await Flow.RefreshSession(token);
            if (!Current(epoch) || !browsingSession) return;
            sessionRead = result; sessionReadbackNeeded = false; pageNotice = null; AwaitLaunch(result.Value.Launched); Present();
            var state = result.Value;
            if (state.PreviousOperation != null) ShowReceipt(state.PreviousOperation, state.Owner);
            Status = state.RecoveredOperation ? Words.ArenaDeviceRecovered : "Device session updated";
            // A followed transaction that failed keeps its reason on the page.
            if (state.RecoveredOperation && info == null) Inform(Status);
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
            ClearSessionObservation();
        }

        // How this device stands, in a title for its page and a short state for
        // Settings. A device whose last confirmed operation disabled it says so.
        private (string Title, string Short, string Token, string Guide) DeviceState(SessionAssessment session)
        {
            if (session == null) return (Words.ArenaDeviceTitle, Words.ArenaChecking, SkinTokens.TextMuted, null);
            if (session.Status == "none")
                return LastReceipt?.Intent == "session-revoke" && LastReceipt.Outcome == ExecutionOutcome.ConfirmedSuccess ?
                    (Words.ArenaDeviceDisabled, Words.ArenaDeviceDisabledShort, SkinTokens.Text, Words.ArenaDeviceDisabledGuide) :
                    (Words.ArenaDeviceSetup, Words.ArenaDeviceSetupShort, SkinTokens.Text,
                        Words.ArenaDeviceSetupGuide(MoneyText.SolInWords(DeviceFunding.RunCostShownLamports)));
            if (!session.Current)
                return (Words.ArenaDeviceRenew, Words.ArenaDeviceRenewShort, SkinTokens.Text, session.TokenMayClose ?
                    Words.ArenaDeviceRenewGuideEnded : Words.ArenaDeviceRenewGuide);
            if (session.Funding != "ready")
                return (Words.ArenaDeviceLow, Words.ArenaDeviceLow, SkinTokens.Text, Words.ArenaDeviceLowGuide(MoneyText.SolInWords(DeviceFunding.DepositLamports)));
            return (session.Status == "expiring" ? Words.ArenaDeviceExpiring : Words.ArenaDeviceActive, session.Status == "expiring" ? Words.ArenaDeviceExpiringShort : Words.ArenaDeviceActive,
                SkinTokens.Positive, Words.ArenaDeviceActiveGuide);
        }

        private PanelPageView DevicePage()
        {
            var back = sessionFromSettings ? PageAction(null, () => OpenSharedPage(AppPage.Settings), PageAvailable) :
                PageAction(null, () => _ = OpenDaily(), PageAvailable);
            if (sessionRead == null) { var waiting = Waiting("Device", Words.ArenaDeviceTitle, Words.ArenaDeviceSubtitle, sessionFromSettings ? AppPage.Settings : AppPage.Home, pageNotice); waiting.Back = back; return waiting; }
            if (revokeConfirming) return RevokePage();
            var state = sessionRead.Value; var session = state.Session; var look = DeviceState(session);
            var page = new PanelPageView { Key = "Device", Title = Words.ArenaDeviceTitle, Subtitle = Words.ArenaDeviceSubtitle, Back = back, Tab = sessionFromSettings ? AppPage.Settings : AppPage.Home };
            if (!state.Launched && session.ValidUntil <= 0) { OpensSoon(page); return page; }
            // A device to set up shows what the wallet puts on it; a device in use, how it stands.
            bool fresh = session.Status == "none" && look.Title == Words.ArenaDeviceSetup;
            var rows = new List<PanelBlock>();
            if (!fresh) rows.Add(PanelBlock.Row("Device state", Words.ArenaDeviceRowStatus, look.Title, tagToken: look.Token));
            rows.Add(PanelBlock.Row("Device owner", Words.ArenaDeviceRowOwner, Short(state.Owner)));
            // A device in use shows the deposit it has left; one to set up, the deposit it asks for.
            rows.Add(PanelBlock.Row("Deposit", Words.ArenaDeviceRowDeposit, session.ValidUntil > 0 ? Sol(session.Balance) : fresh ? Sol(DeviceFunding.DepositLamports) : "—"));
            if (session.ValidUntil > 0) rows.Add(PanelBlock.Row("Device expiry", Words.ArenaDeviceRowExpiry, Utc(session.ValidUntil)));
            var blocks = new List<PanelBlock> { PanelBlock.Card("Device card", rows.ToArray()) };
            // The page follows a pending transaction by itself, round after round.
            if (sessionActionPending) Requesting(page);
            else if (state.Pending != null) Awaiting("Device", page, () => PageAvailable() && !Busy);
            else
            {
                // The foot row: the step the device needs, and disabling it last, which asks first.
                if (!Refused("Device", page, DeviceChangeable))
                {
                    blocks.Add(PanelBlock.Text("Device guide", look.Guide, SkinTokens.TextMuted));
                    if (!session.Current)
                        page.Primary = PageAction(session.Status == "none" ? Words.ArenaDeviceEnable : Words.ArenaDeviceRenewAction, () => _ = EnsureDeviceSession(), DeviceChangeable,
                            session.Status == "none" ? "Enable device" : "Renew device", SkinSlots.IconDevice);
                    else if (session.Funding != "ready")
                        page.Primary = PageAction(Words.ArenaDeviceTopUp, () => _ = RefillDeviceSession(), DeviceChangeable, "Top up deposit", SkinSlots.IconPlus);
                }
                if (session.ValidUntil > 0)
                    page.Destructive = PageAction(Words.ArenaDeviceDisableAction, () => { revokeConfirming = true; Present(); }, DeviceChangeable, "Disable this device", SkinSlots.IconDevice);
            }
            page.Blocks = blocks.ToArray();
            return page;
        }
        private bool DeviceChangeable() => PageAvailable() && !Busy && !sessionActionPending && !economyActionPending && sessionRead != null && sessionRead.IsCurrent;

        // Disabling asks first: what stops, and what the wallet gets back.
        private PanelPageView RevokePage()
        {
            // The confirm's two verbs: the safe choice first, the disable beside it.
            var keep = PageAction(Words.ArenaDeviceKeep, () => { revokeConfirming = false; Present(); }, () => PageAvailable(), "Keep enabled", SkinSlots.Tick);
            return new PanelPageView { Key = "Revoke", Title = Words.ArenaDeviceDisable, Subtitle = Words.TabArena, Back = keep, Blocks = new[] {
                PanelBlock.Card("Revoke card", PanelBlock.Title(Words.ArenaDeviceRevokeTitle, centered: true, name: "Revoke device access?"),
                    PanelBlock.Text("Revoke effect", Words.ArenaDeviceRevokeEffect),
                    PanelBlock.Text("Revoke return", Words.ArenaDeviceRevokeReturn)) },
                Primary = keep,
                Destructive = PageAction(Words.ArenaDeviceRevokeConfirm, () => { revokeConfirming = false; _ = DisableDeviceSession(); }, DeviceChangeable, "Disable in wallet", SkinSlots.IconWallet) };
        }

        public Task EnsureDeviceSession() => ChangeDeviceSession(true, false);
        public Task RefillDeviceSession() => ChangeDeviceSession(false, false);
        public Task DisableDeviceSession() => ChangeDeviceSession(false, true);

        private Task ChangeDeviceSession(bool ensure, bool disable)
        {
            if (!browsingSession || sessionActionPending || economyActionPending || sessionRead == null || !sessionRead.IsCurrent || sessionRead.Value.Pending != null)
                return Task.CompletedTask;
            var assessment = sessionRead.Value.Session;
            if (!sessionRead.Value.Launched && assessment.ValidUntil <= 0) return Task.CompletedTask;
            if (ensure ? assessment.Current : disable ? assessment.ValidUntil <= 0 : !assessment.Current || assessment.Funding == "ready")
                return Task.CompletedTask;
            bool recovered = false;
            return Act(ensure ? "device setup" : disable ? "device disable" : "deposit top-up", true, async token => {
                if (!ensure) return (await (disable ? Flow.RevokeSession() : Flow.RefillSession())).Value;
                var ensured = (await Flow.EnsureSession()).Value;
                recovered = ensured.Action == "recover"; return ensured.Operation;
            }, async (epoch, token) => {
                await RefreshSessionPage(epoch, token);
                if (Current(epoch) && recovered) Inform(Words.ArenaDeviceRecovered);
            }, () => _ = ChangeDeviceSession(ensure, disable));
        }
    }
}
