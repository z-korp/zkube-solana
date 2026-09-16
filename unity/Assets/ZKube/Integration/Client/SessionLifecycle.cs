using System;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Integration.Execution;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;

namespace ZKube.Integration.Client
{
    public sealed class SessionEnsureResult
    {
        public string Action { get; }
        public SessionAssessment Session { get; }
        public ExecutionResult Operation { get; }
        public bool Ready => Session != null && Session.Current && Session.Funding == "ready";
        internal SessionEnsureResult(string action, SessionAssessment session, ExecutionResult operation)
        { Action = action; Session = session; Operation = operation; }
    }
    public sealed class SessionLifecycle
    {
        private readonly ClientIdentity identity;
        private readonly WalletClient wallet;
        private readonly SessionRecordStore records;
        private readonly SessionTokenBindings tokens;
        private readonly TransactionPlanner planner;
        private readonly SolanaRpcTransport rpc;
        private readonly TransactionJournal journal;
        private readonly TransactionExecutor executor;
        private readonly IExecutionReconciler reconciler;
        private readonly string program;
        private readonly Func<long> now;
        private readonly SemaphoreSlim changes = new SemaphoreSlim(1, 1);
        public SessionLifecycle(ClientIdentity identity, WalletClient wallet, SessionRecordStore records,
            SessionTokenBindings tokens, TransactionPlanner planner, SolanaRpcTransport rpc, TransactionJournal journal,
            TransactionExecutor executor, IExecutionReconciler reconciler, string program, Func<long> now)
        { this.identity = identity; this.wallet = wallet; this.records = records; this.tokens = tokens; this.planner = planner;
            this.rpc = rpc; this.journal = journal; this.executor = executor; this.reconciler = reconciler; this.program = program; this.now = now; }

        public Task<SessionAssessment> Inspect() => Inspect(identity.Lease());
        private async Task<SessionAssessment> Inspect(IdentityLease lease)
        {
            var saved = await records.Load(lease.Owner).ConfigureAwait(false);
            using var signer = await wallet.LoadDeviceSigner(lease.Owner).ConfigureAwait(false);
            if (saved.Active == null || signer == null) return new SessionAssessment("none", "needsRenewal", 0, 0, false);
            var observation = await rpc.ReadAccounts(rpc.Base, new[] { saved.Active.Token, saved.Active.Signer }, cancellation: lease.Cancellation).ConfigureAwait(false);
            var rent = await rpc.RentFloor(rpc.Base, 0, lease.Cancellation).ConfigureAwait(false);
            lease.Cancellation.ThrowIfCancellationRequested();
            return SessionReadiness.Inspect(saved.Active, signer.Address, observation.Accounts[0].Envelope,
                observation.Accounts[1], rent, now(), tokens, program);
        }

        public Task<ExecutionResult> EnableOrRenew() => Change(EnableOrRenew);
        private async Task<ExecutionResult> EnableOrRenew(IdentityLease lease)
        {
            DeviceSigner signer = null;
            TransactionPlan plan = null; ExecutionResult local = null;
            try
            {
                await executor.WithIdle(async () =>
                {
                    lease.Cancellation.ThrowIfCancellationRequested();
                    if (await journal.Load(lease.Owner).ConfigureAwait(false) != null)
                    { local = ExecutionResult.Rejected("session-renew", "pending-transaction-exists"); return; }
                    signer = await wallet.LoadDeviceSigner(lease.Owner, create: true).ConfigureAwait(false);
                    if (signer == null) throw new InvalidOperationException("Device key was not saved");
                    string token = tokens.Derive(lease.Owner, signer.Address, program);
                    var observation = await rpc.ReadAccounts(rpc.Base, new[] { token, signer.Address }, cancellation: lease.Cancellation).ConfigureAwait(false);
                    var funding = observation.Accounts[1];
                    if (funding.Envelope != null) SessionReadiness.Funding(funding.Envelope, funding.Lamports, 0);
                    lease.Cancellation.ThrowIfCancellationRequested();
                    plan = planner.RenewSession(lease.Owner, signer.Address, now(), observation.Accounts[0].Envelope,
                        funding.Envelope == null ? 0 : funding.Lamports);
                }).ConfigureAwait(false);
                if (local != null) return local;
                return await executor.Execute(plan, "session-renew", new[] { signer }, reconciler, lease.Cancellation).ConfigureAwait(false);
            }
            finally { signer?.Dispose(); }
        }

        public Task<ExecutionResult> Refill() => Change(lease => Maintain(lease, false));
        public Task<ExecutionResult> Revoke() => Change(lease => Maintain(lease, true));
        private async Task<ExecutionResult> Maintain(IdentityLease lease, bool revoke)
        {
            DeviceSigner signer = null; TransactionPlan plan = null; ExecutionResult local = null;
            try
            {
                await executor.WithIdle(async () =>
                {
                lease.Cancellation.ThrowIfCancellationRequested();
                if (await journal.Load(lease.Owner).ConfigureAwait(false) != null)
                { local = ExecutionResult.Rejected(revoke ? "session-revoke" : "session-refill", "pending-transaction-exists"); return; }
                var saved = await records.Load(lease.Owner).ConfigureAwait(false);
                signer = await wallet.LoadDeviceSigner(lease.Owner).ConfigureAwait(false);
                if (saved.Active == null || signer == null || saved.Active.Signer != signer.Address) throw new InvalidOperationException("No matching device session");
                var observation = await rpc.ReadAccounts(rpc.Base, new[] { saved.Active.Token, signer.Address }, cancellation: lease.Cancellation).ConfigureAwait(false);
                var account = observation.Accounts[1];
                if (!revoke)
                {
                    var assessment = SessionReadiness.Inspect(saved.Active, signer.Address, observation.Accounts[0].Envelope, account, 0, now(), tokens, program);
                    if (!assessment.Current) throw new InvalidOperationException("Renew an expired device session before funding it");
                }
                if (account.Envelope != null) SessionReadiness.Funding(account.Envelope, account.Lamports, 0);
                ulong balance = account.Envelope == null ? 0 : account.Lamports;
                plan = revoke ? planner.RevokeSession(lease.Owner, signer.Address, observation.Accounts[0].Envelope, balance) : planner.RefillSession(lease.Owner, signer.Address, balance);
                if (plan == null)
                {
                    await records.Replace(saved, new SessionRecords(lease.Owner, null)).ConfigureAwait(false);
                    local = ExecutionResult.CompletedLocally("session-revoke");
                }
                }).ConfigureAwait(false);
                if (local != null) return local;
                var signers = plan.DeviceSigners.Count == 0 ? Array.Empty<DeviceSigner>() : new[] { signer };
                return await executor.Execute(plan, revoke ? "session-revoke" : "session-refill", signers, reconciler, lease.Cancellation).ConfigureAwait(false);
            }
            finally { signer?.Dispose(); }
        }
        // Recover only the existing signed intent. Its receipt remains distinct
        // from any later session repair, including when another intent was pending.
        public Task<SessionEnsureResult> Ensure() => Change(async lease => {
            var pending = await journal.Load(lease.Owner).ConfigureAwait(false);
            if (pending != null)
            {
                var resumed = await executor.Resume(lease.Owner, reconciler, lease.Cancellation, pending.Signature).ConfigureAwait(false);
                bool complete = resumed.Outcome == ExecutionOutcome.ConfirmedSuccess || resumed.Outcome == ExecutionOutcome.ConfirmedFailure ||
                    resumed.Outcome == ExecutionOutcome.ExpiredReconciled;
                return await EnsureReadback("recover", resumed, lease, complete).ConfigureAwait(false);
            }
            var before = await Inspect(lease).ConfigureAwait(false);
            if (before.Current && before.Funding == "ready")
                return new SessionEnsureResult("ready", before, ExecutionResult.CompletedLocally("session-ensure"));
            string action = before.Current ? "refill" : "renew";
            var result = before.Current ? await Maintain(lease, false).ConfigureAwait(false) : await EnableOrRenew(lease).ConfigureAwait(false);
            return await EnsureReadback(action, result, lease, result.Outcome == ExecutionOutcome.ConfirmedSuccess ||
                result.Outcome == ExecutionOutcome.CompletedLocally).ConfigureAwait(false);
        });
        // Executor acceptance already committed the outcome and can have cleared
        // its journal. A later observation failure cannot erase that receipt.
        private async Task<SessionEnsureResult> EnsureReadback(string action, ExecutionResult operation, IdentityLease lease, bool inspect)
        {
            if (!inspect) return new SessionEnsureResult(action, null, operation);
            try { return new SessionEnsureResult(action, await Inspect(lease).ConfigureAwait(false), operation); }
            catch (Exception) when (!lease.Cancellation.IsCancellationRequested && identity.IsCurrent(lease))
            { return new SessionEnsureResult(action, null, operation); }
        }
        private async Task<T> Change<T>(Func<IdentityLease, Task<T>> action)
        {
            var lease = identity.Lease();
            await changes.WaitAsync(lease.Cancellation).ConfigureAwait(false);
            try
            {
                var result = await action(lease).ConfigureAwait(false);
                lease.Cancellation.ThrowIfCancellationRequested();
                if (!identity.IsCurrent(lease)) throw new OperationCanceledException("Session identity changed");
                return result;
            }
            finally { changes.Release(); }
        }
        public Task Disconnect() => identity.Disconnect(async _ => {
            await changes.WaitAsync().ConfigureAwait(false);
            try { await executor.WithIdle(() => Task.CompletedTask).ConfigureAwait(false); }
            finally { changes.Release(); }
        });
    }
}
