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
        private const string WalletOpen = "Approve the request in your wallet.";
        // A sent transaction is followed to a definite outcome by the client
        // itself: confirmed, failed or expired. Nobody is asked to check. The
        // wait is bounded, a little past the time a transaction can still land;
        // beyond it the page says so and offers to keep following.
        private const string Confirming = "Waiting for Solana to confirm…", Unconfirmed = "Solana has not confirmed this yet.";
        private TimeSpan followEvery = TimeSpan.FromSeconds(2), followFor = TimeSpan.FromSeconds(120);
        private bool following;
        // result is the action's own pending result, or null to follow whatever this address has waiting.
        private async Task<ExecutionResult> Follow(ExecutionResult result, long epoch, CancellationToken token)
        {
            if (result != null && result.Outcome != ExecutionOutcome.Pending) return result;
            bool own = result != null;
            following = true; Present();
            try
            {
                var until = DateTime.UtcNow + followFor;
                while (true)
                {
                    if (!Current(epoch)) return result;
                    if (result != null) await Task.Delay(followEvery, token);
                    if (!Current(epoch)) return result;
                    var next = (await Flow.ResumePending(token, !own)).Value;
                    if (!Current(epoch) || next.Code == "no-pending-transaction") return result;
                    result = next;
                    if (result.Outcome != ExecutionOutcome.Pending || DateTime.UtcNow >= until) return result;
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
            if (result?.Outcome == ExecutionOutcome.Pending) Refuse(family, Unconfirmed, () => _ = FollowTransaction());
            else if (result != null && MoneyReceiptText.Refusal(result) is string reason) Inform(reason);
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
                ClearRefusal(); Present();
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
                        // The wait ran out: the retry keeps following, it never sends again.
                        if (result.Outcome == ExecutionOutcome.Pending) { reason = Unconfirmed; retry = () => _ = FollowTransaction(); }
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
                    if (Current(epoch)) Present();
                    else if (device) sessionReadbackNeeded = true; else economyReadbackNeeded = true;
                }
            });
        }

        // This page's refused action: its reason and its retry, in place of the action itself.
        private string RefusalOn(string family) => refusalFamily == family ? refusal : null;
        private static PanelBlock RefusalLine(string reason) => PanelBlock.Text("Action refused", reason, SkinTokens.Negative, true);
        private PanelBlock Retry(Func<bool> available) => PanelBlock.Button(PageAction("Try again", refusalRetry, available), true, SkinSlots.IconRetry);
        private bool Refused(string family, List<PanelBlock> blocks, Func<bool> available)
        {
            if (RefusalOn(family) == null) return false;
            blocks.Add(RefusalLine(refusal)); blocks.Add(Retry(available));
            return true;
        }
        // A request the wallet still has: what to do, and the way out.
        private void Requesting(List<PanelBlock> blocks)
        {
            blocks.Add(PanelBlock.Text("Action open", following ? Confirming : WalletOpen, SkinTokens.TextMuted, true));
            blocks.Add(DisconnectButton());
        }
        // Until the Arena launches, its pages say so and lead to the Campaign.
        private PanelBlock[] OpensSoon() => new[] {
            PanelBlock.Talk("Arena opens soon.", "idle"),
            PanelBlock.Card("Opens soon card", PanelBlock.Row("Campaign open", "Campaign", "Open", tagToken: SkinTokens.Positive)),
            PanelBlock.Button(PageAction("Play Campaign", () => _ = OpenCampaign(), () => PageAvailable()), true, SkinSlots.IconPlay) };
    }
}
