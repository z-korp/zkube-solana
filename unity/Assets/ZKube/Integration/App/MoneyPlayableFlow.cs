using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.ExceptionServices;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Integration.Client;
using ZKube.Integration.Client.Runs;

namespace ZKube.Integration.App
{
    public sealed class MoneyRunOperation
    {
        public RunClientState State { get; }
        public Exception Error { get; }
        public IReadOnlyList<RunExecutionReceipt> Receipts { get; }
        internal MoneyRunOperation(RunClientState state, Exception error, IEnumerable<RunExecutionReceipt> receipts)
        { State = state; Error = error; Receipts = Array.AsReadOnly(receipts.ToArray()); }
        public RunClientState RequireState()
        { if (Error != null) ExceptionDispatchInfo.Capture(Error).Throw(); return State; }
    }

    // One visual run identity. It owns no signer, marker, journal or service.
    public sealed class MoneyRunHandle
    {
        internal readonly IdentityLease Identity;
        public RunPresentationBinding Binding { get; }
        public string Owner => Binding.Owner;
        public string Mode => Binding.Mode;
        public string Address => Binding.Address;
        public long DeadlineAt => Binding.DeadlineAt;
        private MoneyRunOperation lastOperation;
        private MoneyRunOperation lastReceiptOperation;
        public MoneyRunOperation LastOperation => Volatile.Read(ref lastOperation);
        public MoneyRunOperation LastReceiptOperation => Volatile.Read(ref lastReceiptOperation);
        internal void Record(MoneyRunOperation value)
        {
            // A read failure before execution is a new operation outcome, but
            // cannot erase the last actual transaction accepted for this run.
            if (value.Receipts.Count != 0) Volatile.Write(ref lastReceiptOperation, value);
            Volatile.Write(ref lastOperation, value);
        }
        internal MoneyRunHandle(IdentityLease identity, RunClientState initial, ActiveRunReconciler native)
        { Identity = identity; Binding = new RunPresentationBinding(initial, native); }
    }

    public sealed class MoneyRunLaunch
    {
        public MoneyRunHandle Run { get; }
        public MoneyRunOperation Operation { get; }
        public bool CanBind => Run != null && Operation.Error == null && Operation.State?.Token != null &&
            NativeEngine.Summary(Operation.State.Token).Phase != (byte)CorePhase.AwaitingVrf;
        internal MoneyRunLaunch(MoneyRunHandle run, MoneyRunOperation operation) { Run = run; Operation = operation; }
    }

    public sealed partial class MoneyAppFlow
    {
        private int launchingRun;
        public bool RunIdentityCurrent(MoneyRunHandle run) => run != null && !stopped && services.Identity.IsCurrent(run.Identity);

        // Daily entry uses one synchronous launch guard and the same
        // tracked owner lifetime. No second tap can queue another paid entry.
        private Task<MoneyRead<MoneyRunLaunch>> LaunchNewRun(CancellationToken cancellation,
            Func<IdentityLease, CancellationToken, Task<MoneyRunLaunch>> action)
        {
            if (Interlocked.CompareExchange(ref launchingRun, 1, 0) != 0)
                throw new InvalidOperationException("A run is already opening");
            return Launch();
            async Task<MoneyRead<MoneyRunLaunch>> Launch()
            {
                try { return await WithRunOwner(null, cancellation, action).ConfigureAwait(false); }
                finally { Volatile.Write(ref launchingRun, 0); }
            }
        }

        // Explicit Resume observes first, then continues only this accepted run.
        // A missing account/slot remains a waiting or navigation result.
        public Task<MoneyRead<MoneyRunLaunch>> OpenSavedRun(string mode, CancellationToken cancellation = default) =>
            WithRunOwner(null, cancellation, async (lease, token) => {
                var state = await services.Runs.Inspect(mode, token).ConfigureAwait(false);
                var first = new MoneyRunOperation(state, null, Array.Empty<RunExecutionReceipt>());
                if (state.Account == null) return new MoneyRunLaunch(null, first);
                var handle = new MoneyRunHandle(lease, state, new ActiveRunReconciler(services.Accounts));
                if (await services.Journal.Load(lease.Owner).ConfigureAwait(false) != null)
                    first = await CaptureRun(lease, mode, handle.Address, scope =>
                        services.Runs.Recover(mode, handle.Binding, token, scope)).ConfigureAwait(false);
                return await OpenAcceptedRun(lease, mode, first, token, handle).ConfigureAwait(false);
            });

        private async Task<MoneyRunLaunch> OpenAcceptedRun(IdentityLease lease, string mode, MoneyRunOperation first,
            CancellationToken token, MoneyRunHandle handle = null)
        {
            if (first.State?.Account != null && handle == null)
                handle = new MoneyRunHandle(lease, first.State, new ActiveRunReconciler(services.Accounts));
            var operation = first;
            if (handle != null && first.Error == null && first.State?.Token != null &&
                NativeEngine.Summary(first.State.Token).Phase == (byte)CorePhase.AwaitingVrf)
            {
                var opening = await CaptureRun(lease, mode, handle.Address, scope =>
                    services.Runs.ResolveVrf(mode, handle.Binding, token, scope)).ConfigureAwait(false);
                operation = new MoneyRunOperation(opening.State, opening.Error, first.Receipts.Concat(opening.Receipts));
            }
            handle?.Record(operation); return new MoneyRunLaunch(handle, operation);
        }

        public Task<MoneyRead<MoneyRunOperation>> ObserveBoundRun(MoneyRunHandle run, CancellationToken cancellation = default) =>
            WithRunOwner(run, cancellation, async (lease, token) => {
                var observed = await services.Runs.Inspect(run.Mode, token).ConfigureAwait(false);
                if (observed.Account != null) run.Binding.Accept(observed);
                else if (observed.Marker != null) run.Binding.RequireIdentity(observed.Marker.Owner, observed.Marker.ActiveRun);
                return new MoneyRunOperation(observed, null, Array.Empty<RunExecutionReceipt>());
            });

        public Task<MoneyRead<MoneyRunOperation>> SubmitRun(MoneyRunHandle run, CoreRunToken accepted, RunClientAction action,
            byte row, byte start, byte destination, long observedNow, CancellationToken cancellation = default) =>
            BoundRun(run, cancellation, (token, scope) => {
                // This UI boundary never substitutes freeze for abandon/settle.
                // The existing protocol still verifies the actual action time.
                if (run.Mode == "daily" && observedNow >= run.DeadlineAt)
                    throw new InvalidOperationException("Daily entry is frozen; check its accepted result");
                return services.Runs.Apply(run.Mode, accepted, run.Binding, action, row, start, destination, token, scope);
            });
        public Task<MoneyRead<MoneyRunOperation>> ResolveRun(MoneyRunHandle run, CancellationToken cancellation = default) =>
            BoundRun(run, cancellation, (token, scope) => services.Runs.ResolveVrf(run.Mode, run.Binding, token, scope));
        public Task<MoneyRead<MoneyRunOperation>> RecoverRun(MoneyRunHandle run, CancellationToken cancellation = default) =>
            BoundRun(run, cancellation, (token, scope) => services.Runs.Recover(run.Mode, run.Binding, token, scope));
        public Task<MoneyRead<MoneyRunOperation>> SettleRun(MoneyRunHandle run, CancellationToken cancellation = default) =>
            WithRunOwner(run, cancellation, async (lease, token) => {
                MoneyRunOperation prior = null;
                if (await services.Journal.Load(lease.Owner).ConfigureAwait(false) != null)
                {
                    prior = await CaptureRun(lease, run.Mode, run.Address, scope =>
                        services.Runs.Recover(run.Mode, run.Binding, token, scope)).ConfigureAwait(false);
                    // Retry is an explicit reconciliation first. It cannot send
                    // another intent while confirmation or copy-back is pending.
                    if (prior.Error != null || prior.State?.Token == null)
                    { run.Record(prior); return prior; }
                }
                var next = await CaptureRun(lease, run.Mode, run.Address, scope =>
                    services.Runs.FinishAndSettle(run.Mode, run.Binding, token, scope)).ConfigureAwait(false);
                var result = prior == null ? next : new MoneyRunOperation(next.State, next.Error, prior.Receipts.Concat(next.Receipts));
                run.Record(result); return result;
            });

        private Task<MoneyRead<MoneyRunOperation>> BoundRun(MoneyRunHandle run, CancellationToken cancellation,
            Func<CancellationToken, RunOperationReceipts, Task<RunClientState>> action) =>
            WithRunOwner(run, cancellation, async (lease, token) => {
                var result = await CaptureRun(lease, run.Mode, run.Address, scope => action(token, scope)).ConfigureAwait(false);
                // Store before cancellation/publication checks, scoped to this
                // handle. A late callback never becomes another owner's receipt.
                run.Record(result); return result;
            });

        private async Task<MoneyRunOperation> CaptureRun(IdentityLease lease, string mode, string address,
            Func<RunOperationReceipts, Task<RunClientState>> action)
        {
            var scope = new RunOperationReceipts(lease.Owner, mode, address);
            RunClientState state = null; Exception failure = null;
            try { state = await action(scope).ConfigureAwait(false); }
            catch (Exception error) { failure = error; }
            foreach (var receipt in scope.Steps) RememberOwnerOperation(lease, receipt.Result);
            return new MoneyRunOperation(state, failure, scope.Steps);
        }

        // Every provider call is tracked and serialized with owner reads. A
        // foreground observation waits for an action rather than colliding with
        // RunClient's operating guard or disposing its transport during send.
        private Task<MoneyRead<T>> WithRunOwner<T>(MoneyRunHandle run, CancellationToken cancellation,
            Func<IdentityLease, CancellationToken, Task<T>> action) => Track(async () => {
                var lease = services.Identity.Lease();
                if (run != null && (!services.Identity.IsCurrent(run.Identity) || lease.Owner != run.Owner))
                    throw new OperationCanceledException("The visible run belongs to an earlier connection");
                InvalidateOwner();
                using var linked = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, lease.Cancellation, cancellation);
                var operationToken = linked.Token;
                await ownerReads.WaitAsync(linked.Token).ConfigureAwait(false);
                try
                {
                    var value = await action(lease, linked.Token).ConfigureAwait(false);
                    linked.Token.ThrowIfCancellationRequested();
                    if (!services.Identity.IsCurrent(lease)) throw new OperationCanceledException("Run owner changed");
                    return new MoneyRead<T>(value, () => !stopped && !operationToken.IsCancellationRequested && services.Identity.IsCurrent(lease));
                }
                finally { ownerReads.Release(); }
            });
    }
}
