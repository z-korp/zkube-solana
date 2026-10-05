using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;

namespace ZKube.Integration.Execution
{
    public sealed class TransactionExecutor
    {
        private readonly TransactionPlanner planner;
        private readonly SolanaRpcTransport rpc;
        private readonly WalletClient wallet;
        private readonly TransactionJournal journal;
        private readonly SemaphoreSlim executing = new SemaphoreSlim(1, 1);
        public TransactionExecutor(TransactionPlanner planner, SolanaRpcTransport rpc, WalletClient wallet, TransactionJournal journal)
        { this.planner = planner; this.rpc = rpc; this.wallet = wallet; this.journal = journal; }

        public Task<ExecutionResult> Execute(TransactionPlan plan, string intent, IReadOnlyList<DeviceSigner> deviceSigners,
            IExecutionReconciler reconciler, CancellationToken cancellation = default) =>
            Execute(plan == null ? null : new[] { plan }, intent, deviceSigners, reconciler, cancellation);

        // One intent, offered in sizes: the most it could carry first, the
        // intent on its own last. A size that does not fit a packet, or that
        // its simulation rejects (compute included, at the limit it states),
        // gives way to the next, so nothing optional attached to an intent can
        // make it fail. Only the last size's rejection is the intent's.
        public async Task<ExecutionResult> Execute(IReadOnlyList<TransactionPlan> sizes, string intent, IReadOnlyList<DeviceSigner> deviceSigners,
            IExecutionReconciler reconciler, CancellationToken cancellation = default)
        {
            if (sizes == null || sizes.Count == 0 || sizes.Any(size => size == null) || reconciler == null) throw new ArgumentNullException();
            var plan = sizes[sizes.Count - 1];
            if (sizes.Any(size => size.Owner != plan.Owner || size.FeePayer != plan.FeePayer || size.Route != plan.Route || size.RunId != plan.RunId ||
                    size.OwnerSignatureRequired != plan.OwnerSignatureRequired || !size.DeviceSigners.SequenceEqual(plan.DeviceSigners)))
                throw new ArgumentException("Sizes of one intent share its owner, payer, route and signers");
            if (string.IsNullOrWhiteSpace(intent) || intent.Length > 64) throw new ArgumentException("Invalid execution intent");
            if (!executing.Wait(0)) return Rejected(intent, "execution-busy");
            PendingTransaction pending = null; DeviceSigner install = null;
            try
            {
                cancellation.ThrowIfCancellationRequested();
                // A new intent never receives an older intent's result. Recovery
                // is exclusively Resume; callers rebuild plans after it finishes.
                var prior = await journal.Load(plan.Owner).ConfigureAwait(false);
                if (prior != null) return Rejected(intent, "pending-transaction-exists");
                var signers = deviceSigners?.ToArray() ?? Array.Empty<DeviceSigner>();
                // The owner's wallet is only ever asked to sign a message the
                // install key has signed. An owner-only intent gets that key in
                // every size here, before anything is compiled, priced or
                // simulated; it needs no session and no balance, and is made on
                // first use. Intents that already carry a device signer keep it.
                if (signers.Length == 0 && plan.OwnerSignatureRequired && plan.DeviceSigners.Count == 0)
                {
                    install = await wallet.LoadDeviceSigner(plan.Owner, create: true).ConfigureAwait(false)
                        ?? throw new InvalidOperationException("Install key was not saved");
                    sizes = sizes.Select(size => planner.Presigned(size, install.Address)).ToArray();
                    plan = sizes[sizes.Count - 1]; signers = new[] { install };
                }
                if (signers.Any(s => s == null) || signers.Select(s => s.Address).Distinct(StringComparer.Ordinal).Count() != signers.Length ||
                    !signers.Select(s => s.Address).OrderBy(s => s, StringComparer.Ordinal).SequenceEqual(plan.DeviceSigners.OrderBy(s => s, StringComparer.Ordinal)))
                    return Rejected(intent, "required-device-signer-unavailable");
                if (plan.Route == PlanRoute.ResolvedEr && !plan.RunId.HasValue) return Rejected(intent, "missing-run-route");
                var endpoint = plan.Route == PlanRoute.Base ? rpc.Base :
                    await rpc.ResolveEr(planner.ActiveRun(plan.Owner, plan.RunId.Value)).ConfigureAwait(false);
                var lease = await rpc.LatestBlockhash(endpoint, cancellation).ConfigureAwait(false);
                bool fastEr = plan.Route == PlanRoute.ResolvedEr && !plan.OwnerSignatureRequired;
                // Each size is compiled, priced and simulated once, largest first.
                // A size that does not fit a packet, that its payer cannot fund
                // or that its simulation rejects steps down to the next; only
                // the last, the intent alone, can fail the intent.
                byte[] transaction = null;
                for (int index = 0; ; index++)
                {
                    plan = sizes[index]; bool last = index == sizes.Count - 1;
                    byte[] message;
                    try { message = plan.CompileMessage(lease.Blockhash); transaction = SolanaWire.UnsignedTransaction(message); }
                    catch (Exception error) when (!last && (error is ArgumentException || error is FormatException)) { continue; }
                    var feeTask = rpc.FeeForMessage(endpoint, message, cancellation);
                    var balanceTask = rpc.Balance(endpoint, plan.FeePayer, cancellation);
                    var rentTask = plan.FeePayer == plan.Owner ? Task.FromResult(0UL) : rpc.RentFloor(endpoint, 0, cancellation);
                    await Task.WhenAll(feeTask, balanceTask, rentTask).ConfigureAwait(false);
                    ulong fee = feeTask.Result;
                    // A larger size asks for more compute and so a larger fee:
                    // one the payer cannot cover gives way to a smaller size too.
                    if (plan.FeePayer == plan.Owner && balanceTask.Result < fee)
                    {
                        if (!last) continue;
                        return new ExecutionResult(ExecutionOutcome.FeeShortage, intent, code: "owner-fee-shortage");
                    }
                    try { plan.RequireDeviceFunding(balanceTask.Result, rentTask.Result, fee); }
                    catch (InvalidOperationException)
                    {
                        if (!last) continue;
                        return new ExecutionResult(ExecutionOutcome.FeeShortage, intent, code: "device-deposit-low");
                    }
                    foreach (var signer in signers) transaction = signer.PartialSign(transaction);
                    if (fastEr) break;
                    var simulation = await rpc.Simulate(endpoint, transaction, lease, cancellation).ConfigureAwait(false);
                    if (simulation.Succeeded) break;
                    if (!last) continue;
                    return new ExecutionResult(ExecutionOutcome.Rejected, intent, code: "simulation-rejected", chainError: simulation.ErrorJson);
                }
                cancellation.ThrowIfCancellationRequested();
                if (plan.OwnerSignatureRequired) transaction = await wallet.Sign(plan.Owner, transaction).ConfigureAwait(false);
                TransactionSignatures.ValidateFullySigned(transaction);
                cancellation.ThrowIfCancellationRequested();
                pending = new PendingTransaction(plan.Owner, intent, endpoint.Address.AbsoluteUri, endpoint.IsBase, transaction,
                    lease.Blockhash, lease.LastValidBlockHeight);
                try { await journal.Begin(pending).ConfigureAwait(false); }
                catch
                {
                    // Another executor may have won the durable compare-exchange.
                    // These local bytes are dropped; explicit Resume owns recovery.
                    pending = await journal.Load(plan.Owner).ConfigureAwait(false);
                    if (pending != null) return Rejected(intent, "pending-transaction-exists");
                    return Rejected(intent, "journal-write-failed");
                }
                try { await rpc.Send(endpoint, transaction, fastEr ? RpcSubmissionPolicy.ErSession : RpcSubmissionPolicy.Wallet,
                    lease, cancellation).ConfigureAwait(false); }
                // The persisted signature is the only retry/recovery identity.
                catch (Exception error) { ClientLog.Failure(intent + " send", error); }
                return await Reconcile(pending, reconciler, cancellation).ConfigureAwait(false);
            }
            catch (WalletRequestException error) { return Rejected(intent, error.Code); }
            // The wallet returned another message: nothing is sent, and what it changed is kept as evidence.
            catch (WalletChangedMessageException error) when (pending == null)
            { return new ExecutionResult(ExecutionOutcome.Rejected, intent, code: "wallet-changed-message", walletChange: error.Summary); }
            catch (OperationCanceledException)
            { return pending == null ? Rejected(intent, "cancelled") : Pending(pending, "observation-cancelled"); }
            catch (Exception error)
            {
                if (pending == null) return new ExecutionResult(ExecutionOutcome.Rejected, intent, code: "preparation-failed", failure: RequestFailure.Of(error));
                ClientLog.Failure(intent + " after its journal", error);
                return Pending(pending, "outcome-unknown");
            }
            finally { install?.Dispose(); executing.Release(); }
        }

        public async Task<ExecutionResult> Resume(string owner, IExecutionReconciler reconciler, CancellationToken cancellation = default, string expectedSignature = null)
        {
            if (reconciler == null) throw new ArgumentNullException(nameof(reconciler));
            if (!executing.Wait(0)) return Rejected(null, "execution-busy");
            try
            {
                var pending = await journal.Load(owner).ConfigureAwait(false);
                if (pending == null) return Rejected(null, "no-pending-transaction");
                if (expectedSignature != null && pending.Signature != expectedSignature)
                    return Rejected(null, "pending-transaction-changed");
                return await Reconcile(pending, reconciler, cancellation).ConfigureAwait(false);
            }
            finally { executing.Release(); }
        }

        // Identity cancellation happens first. Waiting for the one application
        // executor to drain, then holding its gate through the journal read and
        // key mutation, closes the disconnect race without a second authority.
        public async Task WithIdle(Func<Task> operation)
        {
            if (operation == null) throw new ArgumentNullException(nameof(operation));
            await executing.WaitAsync().ConfigureAwait(false);
            try { await operation().ConfigureAwait(false); }
            finally { executing.Release(); }
        }

        private async Task<ExecutionResult> Reconcile(PendingTransaction pending, IExecutionReconciler reconciler, CancellationToken cancellation)
        {
            try
            {
                var status = await rpc.HistoricalSignatureStatus(pending.Endpoint, pending.IsBase, pending.Signature, cancellation).ConfigureAwait(false);
                bool confirmed = IsConfirmed(status), expired = false;
                ulong height = 0;
                if (!confirmed)
                {
                    if (status.Confirmation != RpcConfirmation.Missing) return Pending(pending, "confirmation-pending");
                    height = await rpc.HistoricalBlockHeight(pending.Endpoint, pending.IsBase, cancellation).ConfigureAwait(false);
                    if (height <= pending.LastValidBlockHeight) return Pending(pending, "signature-not-yet-observed");
                    // Absence before the expiry-height observation cannot prove
                    // expiry. Search history again afterward and reject regression.
                    var afterExpiry = await rpc.HistoricalSignatureStatus(pending.Endpoint, pending.IsBase, pending.Signature, cancellation).ConfigureAwait(false);
                    if (afterExpiry.ContextSlot < status.ContextSlot) return Pending(pending, "status-context-regressed");
                    status = afterExpiry; confirmed = IsConfirmed(status);
                    expired = status.Confirmation == RpcConfirmation.Missing;
                    if (!confirmed && !expired) return Pending(pending, "confirmation-pending");
                }
                if (confirmed && !status.Slot.HasValue) return Pending(pending, "missing-confirmation-slot");
                ulong minimumSlot = Math.Max(status.ContextSlot, status.Slot ?? 0);
                var description = TransactionSignatures.Describe(pending.Transaction);
                var addresses = description.Accounts.Where(account => account.Writable).Select(account => account.Address).ToArray();
                var observations = new List<AffectedAccountObservation>();
                for (int offset = 0; offset < addresses.Length; offset += SolanaRpcTransport.MaximumBatchAccounts)
                {
                    var batch = addresses.Skip(offset).Take(SolanaRpcTransport.MaximumBatchAccounts).ToArray();
                    var result = await rpc.HistoricalAccounts(pending.Endpoint, pending.IsBase, batch,
                        minContextSlot: minimumSlot, cancellation: cancellation).ConfigureAwait(false);
                    if (result.Slot < minimumSlot || result.Accounts.Count != batch.Length) return Pending(pending, "account-context-regressed");
                    for (int i = 0; i < batch.Length; i++)
                    {
                        var account = result.Accounts[i];
                        if (account == null || account.Slot != result.Slot ||
                            (account.Envelope != null && account.Envelope.Address != batch[i])) return Pending(pending, "account-observation-invalid");
                        observations.Add(new AffectedAccountObservation(batch[i], account));
                    }
                }
                if (!await reconciler.Reconcile(new ExecutionReconciliation(pending, description, minimumSlot, observations.ToArray(), status, expired), cancellation).ConfigureAwait(false))
                    return Pending(pending, "affected-state-unresolved");
                await journal.Complete(pending, pending.Signature, confirmed, expired, height, true).ConfigureAwait(false);
                return new ExecutionResult(expired ? ExecutionOutcome.ExpiredReconciled :
                    status.ErrorJson == null ? ExecutionOutcome.ConfirmedSuccess : ExecutionOutcome.ConfirmedFailure,
                    pending.Intent, pending.Signature, chainError: status.ErrorJson);
            }
            catch (OperationCanceledException) { return Pending(pending, "observation-cancelled"); }
            catch (Exception error) { ClientLog.Failure(pending.Intent + " confirmation", error); return Pending(pending, "outcome-unknown"); }
        }
        private static bool IsConfirmed(RpcSignatureStatus status) => status.Confirmation == RpcConfirmation.Confirmed || status.Confirmation == RpcConfirmation.Finalized;
        private static ExecutionResult Pending(PendingTransaction transaction, string code) =>
            new ExecutionResult(ExecutionOutcome.Pending, transaction.Intent, transaction.Signature, code);
        private static ExecutionResult Rejected(string intent, string code) => new ExecutionResult(ExecutionOutcome.Rejected, intent, code: code);
    }
}
