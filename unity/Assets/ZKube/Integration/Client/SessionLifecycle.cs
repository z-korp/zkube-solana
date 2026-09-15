using System;
using System.Collections.Generic;
using System.Linq;
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
        public Exception ReadbackError { get; }
        public bool Ready => Session != null && Session.Current && Session.Funding == "ready";
        internal SessionEnsureResult(string action, SessionAssessment session, ExecutionResult operation, Exception readbackError = null)
        { Action = action; Session = session; Operation = operation; ReadbackError = readbackError; }
    }
    public sealed class SessionLifecycle
    {
        private readonly ClientIdentity identity;
        private readonly WalletClient wallet;
        private readonly DeviceKeyLifecycle keys;
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
        public SessionLifecycle(ClientIdentity identity, WalletClient wallet, DeviceKeyLifecycle keys, SessionRecordStore records,
            SessionTokenBindings tokens, TransactionPlanner planner, SolanaRpcTransport rpc, TransactionJournal journal,
            TransactionExecutor executor, IExecutionReconciler reconciler, string program, Func<long> now)
        { this.identity = identity; this.wallet = wallet; this.keys = keys; this.records = records; this.tokens = tokens; this.planner = planner;
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
            DeviceSigner active = null, candidate = null;
            TransactionPlan plan = null; ExecutionResult local = null;
            var signers = new List<DeviceSigner>();
            try
            {
                await executor.WithIdle(async () =>
                {
                lease.Cancellation.ThrowIfCancellationRequested();
                // Recovery owns the previous signed intent. A fresh candidate,
                // expiry, or plan is never created while that intent is unresolved.
                if (await journal.Load(lease.Owner).ConfigureAwait(false) != null)
                { local = ExecutionResult.Rejected("session-renew", "pending-transaction-exists"); return; }
                var saved = await records.Load(lease.Owner).ConfigureAwait(false);
                active = await wallet.LoadDeviceSigner(lease.Owner).ConfigureAwait(false);
                AccountEnvelope oldToken = null; ulong oldBalance = 0;
                if (saved.Active != null)
                {
                    var observation = await rpc.ReadAccounts(rpc.Base, new[] { saved.Active.Token, saved.Active.Signer }, cancellation: lease.Cancellation).ConfigureAwait(false);
                    oldToken = observation.Accounts[0].Envelope;
                    if (oldToken != null)
                    {
                        var token = tokens.Decode(oldToken);
                        if (token.Authority != lease.Owner || token.FeePayer != lease.Owner || token.TargetProgram != program ||
                            token.SessionSigner != saved.Active.Signer || token.ValidUntil != saved.Active.ValidUntil) throw new FormatException("Stored session differs from chain");
                    }
                    var funding = observation.Accounts[1];
                    if (funding.Envelope != null) SessionReadiness.Funding(funding.Envelope, funding.Lamports, 0);
                    if (active != null && active.Address != saved.Active.Signer) throw new FormatException("Stored active key changed");
                    if (active == null)
                    {
                        // Explicit owner reauthorization after key loss is allowed;
                        // the missing old key cannot reclaim its allowance. This
                        // branch is unreachable during an unresolved transaction.
                        var withoutLostKey = new SessionRecords(lease.Owner, null, saved.Candidate);
                        await records.Replace(saved, withoutLostKey).ConfigureAwait(false); saved = withoutLostKey; oldToken = null;
                    }
                    else oldBalance = funding.Envelope == null ? 0 : funding.Lamports;
                }
                else if (active != null) throw new InvalidOperationException("Active key has no durable session identity");
                candidate = await keys.PrepareCandidate(lease.Owner).ConfigureAwait(false);
                if (saved.Candidate != null && saved.Candidate.Signer != candidate.Address) throw new FormatException("Stored candidate key changed");
                long started = now();
                var candidateRecord = new SessionRecord(lease.Owner, candidate.Address, tokens.Derive(lease.Owner, candidate.Address, program),
                    checked(started + PlanningConstants.SessionLifetimeSeconds));
                lease.Cancellation.ThrowIfCancellationRequested();
                var next = new SessionRecords(lease.Owner, saved.Active, candidateRecord);
                await records.Replace(saved, next).ConfigureAwait(false);
                plan = planner.RenewSession(lease.Owner, candidate.Address, started, oldToken, active?.Address, oldBalance);
                signers.Add(candidate);
                if (active != null && plan.DeviceSigners.Contains(active.Address)) signers.Add(active);
                }).ConfigureAwait(false);
                if (local != null) return local;
                return await executor.Execute(plan, "session-renew", signers, reconciler, lease.Cancellation).ConfigureAwait(false);
            }
            finally { active?.Dispose(); candidate?.Dispose(); }
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
                RpcAccount account;
                if (revoke) account = await rpc.ReadAccount(rpc.Base, signer.Address, cancellation: lease.Cancellation).ConfigureAwait(false);
                else
                {
                    var observation = await rpc.ReadAccounts(rpc.Base, new[] { saved.Active.Token, signer.Address }, cancellation: lease.Cancellation).ConfigureAwait(false);
                    account = observation.Accounts[1];
                    var assessment = SessionReadiness.Inspect(saved.Active, signer.Address, observation.Accounts[0].Envelope, account, 0, now(), tokens, program);
                    if (!assessment.Current) throw new InvalidOperationException("Renew an expired device session before funding it");
                }
                if (account.Envelope != null) SessionReadiness.Funding(account.Envelope, account.Lamports, 0);
                ulong balance = account.Envelope == null ? 0 : account.Lamports;
                plan = revoke ? planner.RevokeSession(lease.Owner, signer.Address, balance) : planner.RefillSession(lease.Owner, signer.Address, balance);
                if (plan == null)
                {
                    // Empty allowances need no transaction. This explicit revoke
                    // has already established there is no pending signed intent.
                    await wallet.RemoveDeviceSigner(lease.Owner).ConfigureAwait(false);
                    await records.Replace(saved, new SessionRecords(lease.Owner, null, saved.Candidate)).ConfigureAwait(false);
                    local = ExecutionResult.CompletedLocally("session-revoke"); return;
                }
                }).ConfigureAwait(false);
                if (local != null) return local;
                return await executor.Execute(plan, revoke ? "session-revoke" : "session-refill", new[] { signer }, reconciler, lease.Cancellation).ConfigureAwait(false);
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
            catch (Exception error) when (!lease.Cancellation.IsCancellationRequested && identity.IsCurrent(lease))
            { return new SessionEnsureResult(action, null, operation, error); }
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
        public Task Disconnect() => identity.Disconnect(DisconnectOwner);
        private async Task DisconnectOwner(string owner)
        {
            await changes.WaitAsync().ConfigureAwait(false);
            try
            {
                await executor.WithIdle(async () =>
                {
                // Preserve the keys needed to identify and recover an unresolved
                // request. Otherwise retain the existing client's active-key
                // deletion behavior. An unsubmitted candidate remains reusable.
                if (await journal.Load(owner).ConfigureAwait(false) != null) return;
                var saved = await records.Load(owner).ConfigureAwait(false);
                using var key = await wallet.LoadDeviceSigner(owner).ConfigureAwait(false);
                if (key != null && (saved.Active == null || key.Address != saved.Active.Signer)) throw new FormatException("Device identity changed during disconnect");
                await wallet.RemoveDeviceSigner(owner).ConfigureAwait(false);
                if (saved.Active != null) await records.Replace(saved, new SessionRecords(owner, null, saved.Candidate)).ConfigureAwait(false);
                }).ConfigureAwait(false);
            }
            finally { changes.Release(); }
        }
    }
}
