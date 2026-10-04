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
            string family = Family();
            return Run(async (epoch, token) => {
                if (device) sessionActionPending = true; else economyActionPending = true;
                ClearRefusal(); Present();
                try
                {
                    ExecutionResult result = null; string reason;
                    try { result = await request(token); reason = MoneyReceiptText.Refusal(result); }
                    catch (Exception error) when (!(error is OperationCanceledException)) { ClientLog.Failure(action, error); reason = Reason(error); }
                    if (result != null) sent?.Invoke(result);
                    if (!Current(epoch)) return;
                    // The wallet no longer answers for this address: the saved
                    // authorization has ended, and the page is Connect again with no stale account.
                    if (result != null && (result.Code == "account-changed" || result.Code == "authorization-required"))
                    { await Disconnect(false); Refuse("Connect", reason, () => _ = Connect()); return; }
                    if (result != null) ShowReceipt(result, identity.Owner); // Preserve the exact result before read-back can fail.
                    if (reason != null) Refuse(family, reason, retry);
                    await readBack(epoch, token);
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
            blocks.Add(PanelBlock.Text("Action open", WalletOpen, SkinTokens.TextMuted, true));
            blocks.Add(DisconnectButton());
        }
        // Until the Arena launches, its pages say so and lead to the Campaign.
        private PanelBlock[] OpensSoon() => new[] {
            PanelBlock.Talk("Arena opens soon.", "idle"),
            PanelBlock.Card("Opens soon card", PanelBlock.Row("Campaign open", "Campaign", "Open", tagToken: SkinTokens.Positive)),
            PanelBlock.Button(PageAction("Play Campaign", () => _ = OpenCampaign(), () => PageAvailable()), true, SkinSlots.IconPlay) };
    }
}
