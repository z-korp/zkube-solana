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

        public async Task<ExecutionResult> Execute(TransactionPlan plan, string intent, IReadOnlyList<DeviceSigner> deviceSigners,
            IExecutionReconciler reconciler, CancellationToken cancellation = default)
        {
            if (plan == null || reconciler == null) throw new ArgumentNullException();
            if (string.IsNullOrWhiteSpace(intent) || intent.Length > 64) throw new ArgumentException("Invalid execution intent");
            if (!executing.Wait(0)) return Rejected(intent, "execution-busy");
            PendingTransaction pending = null;
            try
            {
                cancellation.ThrowIfCancellationRequested();
                // A new intent never receives an older intent's result. Recovery
                // is exclusively Resume; callers rebuild plans after it finishes.
                var prior = await journal.Load(plan.Owner).ConfigureAwait(false);
                if (prior != null) return Rejected(intent, "pending-transaction-exists");
                var signers = deviceSigners?.ToArray() ?? Array.Empty<DeviceSigner>();
                if (signers.Any(s => s == null) || signers.Select(s => s.Address).Distinct(StringComparer.Ordinal).Count() != signers.Length ||
                    !signers.Select(s => s.Address).OrderBy(s => s, StringComparer.Ordinal).SequenceEqual(plan.DeviceSigners.OrderBy(s => s, StringComparer.Ordinal)))
                    return Rejected(intent, "required-device-signer-unavailable");
                if (plan.Route == PlanRoute.ResolvedEr && !plan.RunId.HasValue) return Rejected(intent, "missing-run-route");
                var endpoint = plan.Route == PlanRoute.Base ? rpc.Base :
                    await rpc.ResolveEr(planner.ActiveRun(plan.Owner, plan.RunId.Value)).ConfigureAwait(false);
                var lease = await rpc.LatestBlockhash(endpoint, cancellation).ConfigureAwait(false);
                var message = plan.CompileMessage(lease.Blockhash);
                var transaction = SolanaWire.UnsignedTransaction(message);
                var feeTask = rpc.FeeForMessage(endpoint, message, cancellation);
                var balanceTask = rpc.Balance(endpoint, plan.FeePayer, cancellation);
                var rentTask = plan.FeePayer == plan.Owner ? Task.FromResult(0UL) : rpc.RentFloor(endpoint, 0, cancellation);
                await Task.WhenAll(feeTask, balanceTask, rentTask).ConfigureAwait(false);
                ulong fee = feeTask.Result;
                if (plan.FeePayer == plan.Owner && balanceTask.Result < fee)
                    return new ExecutionResult(ExecutionOutcome.FeeShortage, intent, code: "owner-fee-shortage", quotedFee: fee);
                try { plan.RequireDeviceFunding(balanceTask.Result, rentTask.Result, fee); }
                catch (InvalidOperationException)
                { return new ExecutionResult(ExecutionOutcome.FeeShortage, intent, code: "device-allowance-refill", quotedFee: fee); }

                bool fastEr = plan.Route == PlanRoute.ResolvedEr && !plan.OwnerSignatureRequired;
                foreach (var signer in signers) transaction = signer.PartialSign(transaction);
                if (!fastEr)
                {
                    var simulation = await rpc.Simulate(endpoint, transaction, lease, cancellation).ConfigureAwait(false);
                    if (!simulation.Succeeded) return new ExecutionResult(ExecutionOutcome.Rejected, intent, code: "simulation-rejected",
                        chainError: simulation.ErrorJson, quotedFee: fee);
                }
                cancellation.ThrowIfCancellationRequested();
                if (plan.OwnerSignatureRequired) transaction = await wallet.Sign(plan.Owner, transaction).ConfigureAwait(false);
                TransactionSignatures.ValidateFullySigned(transaction);
                if (!fastEr)
                {
                    var simulation = await rpc.Simulate(endpoint, transaction, lease, cancellation).ConfigureAwait(false);
                    if (!simulation.Succeeded) return new ExecutionResult(ExecutionOutcome.Rejected, intent, code: "signed-simulation-rejected",
                        chainError: simulation.ErrorJson, quotedFee: fee);
                }
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
                catch (Exception) { /* The persisted signature is the only retry/recovery identity. */ }
                return await Reconcile(pending, reconciler, cancellation).ConfigureAwait(false);
            }
            catch (WalletRequestException error) { return Rejected(intent, error.Code); }
            catch (OperationCanceledException)
            { return pending == null ? Rejected(intent, "cancelled") : Pending(pending, "observation-cancelled"); }
            catch (Exception)
            { return pending == null ? Rejected(intent, "preparation-failed") : Pending(pending, "outcome-unknown"); }
            finally { executing.Release(); }
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
            catch (Exception) { return Pending(pending, "outcome-unknown"); }
        }
        private static bool IsConfirmed(RpcSignatureStatus status) => status.Confirmation == RpcConfirmation.Confirmed || status.Confirmation == RpcConfirmation.Finalized;
        private static ExecutionResult Pending(PendingTransaction transaction, string code) =>
            new ExecutionResult(ExecutionOutcome.Pending, transaction.Intent, transaction.Signature, code);
        private static ExecutionResult Rejected(string intent, string code) => new ExecutionResult(ExecutionOutcome.Rejected, intent, code: code);
    }
}
