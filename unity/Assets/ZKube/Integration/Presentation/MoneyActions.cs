using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Core.Generated;
using ZKube.Integration.App;
using ZKube.Integration.Execution;
using ZKube.Integration.Transport;
using ZKube.Presentation;

namespace ZKube.Integration.Presentation
{
    public sealed partial class MoneyAppAdapter
    {
        // The action that did not go through, on the page it was asked from: why,
        // and how to ask again. A tap never ends looking like nothing happened.
        private string refusal, refusalFamily;
        private Action refusalRetry;
        // A sent transaction is followed to a definite outcome by the client
        // itself: confirmed, failed or expired. Nobody is asked to check. One
        // round of the wait is bounded, a little past the time a transaction can
        // still land; beyond it the page says it is still checking and the next
        // round starts by itself.
        private const string StillChecking = "Still checking. This either completes or changes nothing.";
        // An action in progress shows on its button: the loader and its step in
        // a word, never a line that stands still. The executor says when the
        // wallet has the request and when the transaction leaves; the follower's
        // wait is Confirming.
        private volatile string actionStep;
        // Between two rounds of a wait that ran out the page rests a moment: the
        // loader keeps turning, and the player can leave the page.
        private TimeSpan followRest = TimeSpan.FromSeconds(3);
        private float followAgainAt;
        private bool slow;
        private void Slow() { slow = true; followAgainAt = UnityEngine.Time.unscaledTime + (float)followRest.TotalSeconds; }
        private PageAction Progressing()
        {
            string word = following || actionStep == "confirming" || PendingShown() ? "Confirming" : actionStep == "wallet" ? "Approve in wallet" : actionStep == "sending" ? "Sending" : "Preparing";
            return new PageAction { Label = word, Name = "Action progress", Progress = word, Short = word == "Approve in wallet" ? "In wallet" : null };
        }
        // The executor has already looked a few times in the first two seconds.
        // The follower looks every half second at first, then backs off: a
        // transaction that is going to land has usually landed by then.
        private TimeSpan followEvery = TimeSpan.FromMilliseconds(500), followFor = TimeSpan.FromSeconds(120);
        private bool following, waitedOut, unread;
        // A look that could not read its answer is not a wait. After this many in
        // a row, each spaced twice as far as the last, the follow stops and the
        // page says why with a retry: nothing loops on a reply it cannot read.
        private const int UnreadLooks = 3;
        private static string CouldNotConfirm(ExecutionResult result) => "This is not confirmed yet. " + MoneyReceiptText.Refusal(result.Failure);
        private TimeSpan FollowPause(TimeSpan elapsed) =>
            TimeSpan.FromTicks(followEvery.Ticks * (elapsed.Ticks < followEvery.Ticks * 12 ? 1 : elapsed.Ticks < followEvery.Ticks * 40 ? 2 : 4));
        // result is the action's own pending result, or null to follow whatever this address has waiting.
        private async Task<ExecutionResult> Follow(ExecutionResult result, long epoch, CancellationToken token)
        {
            if (result != null && result.Outcome != ExecutionOutcome.Pending) return result;
            bool own = result != null;
            following = true; waitedOut = false; unread = false; Present();
            try
            {
                var started = DateTime.UtcNow; int failed = 0;
                while (true)
                {
                    if (!Current(epoch)) return result;
                    if (result != null) await Task.Delay(TimeSpan.FromTicks(FollowPause(DateTime.UtcNow - started).Ticks << failed), token);
                    if (!Current(epoch)) return result;
                    var next = (await Flow.ResumePending(token, !own)).Value;
                    if (!Current(epoch) || next.Code == "no-pending-transaction") return result;
                    result = next;
                    if (result.Outcome != ExecutionOutcome.Pending) return result;
                    failed = result.Failure != null ? failed + 1 : 0;
                    if (failed >= UnreadLooks) { unread = true; return result; }
                    // Only a wait that really ran its length is over; a page the
                    // pause retired has not waited, and follows again when it is back.
                    if (DateTime.UtcNow - started >= followFor) { waitedOut = true; return result; }
                }
            }
            finally { following = false; }
        }
        // The page in front of the player shows a transaction that is still unconfirmed.
        private bool PendingShown() => Family() switch {
            "Daily" => dailyRead != null && dailyRead.TryValue(out var daily) && daily.Entry.Status == "pending-transaction",
            "Kredits" => kreditRead != null && kreditRead.TryValue(out var kredits) && kredits.Pending != null,
            "Rewards" => rewardRead != null && rewardRead.TryValue(out var rewards) && rewards.Pending != null,
            "Device" => sessionRead != null && sessionRead.TryValue(out var device) && device.Pending != null,
            "Profile" => profileRead != null && profileRead.TryValue(out var profile) && profile.Pending != null,
            "Operation" => LastReceipt?.Outcome == ExecutionOutcome.Pending,
            _ => false };
        // Follows what this address has waiting, from whichever page shows it, and
        // from the retry of a wait that ran out. It never signs or sends.
        public Task FollowTransaction() => Run(async (epoch, token) => {
            string family = Family(); ClearRefusal();
            ExecutionResult result;
            try { result = await Follow(null, epoch, token); }
            catch (Exception error) when (!(error is OperationCanceledException))
            { ClientLog.Failure("follow transaction", error); if (Current(epoch)) Refuse(family, Reason(error), () => _ = FollowTransaction()); return; }
            if (!Current(epoch)) return;
            ShowReceipt(result ?? ExecutionResult.Rejected(null, "no-pending-transaction"), identity.Owner);
            // A round that ran its length without an outcome: the page says it is still checking and follows again.
            // A follow that could not read its answer stops there, with the reason and a retry.
            if (result?.Outcome == ExecutionOutcome.Pending)
            { if (unread) Refuse(family, CouldNotConfirm(result), () => _ = FollowTransaction()); else if (waitedOut) Slow(); }
            else { slow = false; if (result != null && MoneyReceiptText.Refusal(result) is string reason) Inform(reason); }
            await RefreshVisiblePage(epoch, token); // A receipt survives an empty post-confirmation journal.
        });
        // Whether the Arena has launched is read from the protocol account by each
        // page's own read and never remembered. A page that found it not launched
        // reads again shortly, so it opens by itself once the launch Daily exists.
        private const long LaunchRecheckSeconds = 30;
        private long launchRecheckAt = long.MaxValue;
        private void AwaitLaunch(bool launched) => launchRecheckAt = launched ? long.MaxValue : now() + LaunchRecheckSeconds;

        private void Refuse(string family, string reason, Action retry) { refusal = reason; refusalFamily = family; refusalRetry = retry; Present(); }
        private void ClearRefusal() { refusal = null; refusalFamily = null; refusalRetry = null; }
        private string Reason(Exception error) => error is MoneyConfigurationException ? "Network configuration is unavailable." :
            error is WalletRequestException wallet ? MoneyReceiptText.Refusal(wallet.Code) : MoneyReceiptText.Refusal(RequestFailure.Of(error));

        // Every wallet and device action runs here. Its page shows the request
        // while it is open; a result that is not a success, or an error on the
        // way, stays on that page as a reason with a retry.
        private Task Act(string action, bool device, Func<CancellationToken, Task<ExecutionResult>> request,
            Func<long, CancellationToken, Task> readBack, Action retry, Action<ExecutionResult> sent = null)
        {
            string family = Family(); var lease = identity.Lease();
            return Run(async (epoch, token) => {
                if (device) sessionActionPending = true; else economyActionPending = true;
                ClearRefusal(); actionStep = null; slow = false; Present();
                try
                {
                    ExecutionResult result = null; string reason;
                    try
                    {
                        // An action belongs to the address, not to the page's reads: the
                        // wallet it opens pauses the app, which retires those reads and
                        // must never cancel the request the player is approving.
                        result = await Follow(await request(CancellationToken.None), epoch, token);
                        reason = MoneyReceiptText.Refusal(result);
                        // The wait ran out: the page it reads back shows it still pending and keeps following; nothing is sent again.
                        if (result.Outcome == ExecutionOutcome.Pending && waitedOut) Slow();
                        // It was sent and its outcome could not be read: the retry looks again and never sends again.
                        if (result.Outcome == ExecutionOutcome.Pending && unread) { reason = CouldNotConfirm(result); retry = () => _ = FollowTransaction(); }
                    }
                    catch (Exception error) when (!(error is OperationCanceledException)) { ClientLog.Failure(action, error); reason = Reason(error); }
                    if (result != null) sent?.Invoke(result);
                    // The outcome and its reason are this address's on this page, whether
                    // or not the pause retired the operation; only another address drops them.
                    if (!identity.IsCurrent(lease)) return;
                    // The wallet no longer answers for this address: the saved
                    // authorization has ended, and the page is Connect again with no stale account.
                    if (result != null && (result.Code == "account-changed" || result.Code == "authorization-required"))
                    { await Disconnect(false); Refuse("Connect", reason, () => _ = Connect()); return; }
                    if (result != null) ShowReceipt(result, lease.Owner); // Preserve the exact result before read-back can fail.
                    if (reason != null) Refuse(family, reason, retry);
                    // A retired page reads again by its own rule once the app is back.
                    if (Current(epoch)) await readBack(epoch, token);
                }
                finally
                {
                    if (device) sessionActionPending = false; else economyActionPending = false;
                    actionStep = null;
                    if (Current(epoch)) Present();
                    else if (device) sessionReadbackNeeded = true; else economyReadbackNeeded = true;
                }
            });
        }

        // This page's refused action: its reason and its retry, in place of the action itself.
        private string RefusalOn(string family) => refusalFamily == family ? refusal : null;
        private static PanelBlock RefusalLine(string reason) => PanelBlock.Text("Action refused", reason, SkinTokens.Negative, true);
        // A page hands these three states over by role: the reason stands over the foot
        // row, the action in its primary slot, and the way out of a wallet request last.
        private bool Refused(string family, PanelPageView page, Func<bool> available)
        {
            if (RefusalOn(family) == null) return false;
            page.Reason = RefusalLine(refusal);
            page.Primary = PageAction("Try again", refusalRetry, available, icon: SkinSlots.IconRetry);
            return true;
        }
        private void Requesting(PanelPageView page)
        {
            if (slow) page.Reason = PanelBlock.Text("Action slow", StillChecking, SkinTokens.TextMuted, true);
            page.Primary = Progressing();
            page.Destructive = Disconnecting();
        }
        private void Awaiting(string family, PanelPageView page, Func<bool> available)
        {
            if (Refused(family, page, available)) return;
            if (slow) page.Reason = PanelBlock.Text("Action slow", StillChecking, SkinTokens.TextMuted, true);
            page.Primary = Progressing();
        }
        // Until the Arena launches, its pages say so and lead to the Campaign.
        private void OpensSoon(PanelPageView page)
        {
            page.Blocks = new[] { PanelBlock.Title("Arena opens soon", centered: true),
                PanelBlock.Card("Opens soon card", PanelBlock.Row("Campaign open", "Campaign", "Open", tagToken: SkinTokens.Positive)) };
            page.Primary = PageAction("Play Campaign", () => _ = OpenCampaign(), () => PageAvailable(), icon: SkinSlots.IconPlay);
        }
    }
}
