using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Integration.Client;
using ZKube.Integration.Client.Runs;
using ZKube.Integration.Execution;

namespace ZKube.Integration.App
{
    public sealed class MoneyOwnerState
    {
        public string Owner { get; }
        public PlayerProfile Profile { get; }
        public SessionAssessment Session { get; }
        public ZKube.Local.LocalRunView Campaign { get; }
        public RunClientState Daily { get; }
        public PendingTransaction Pending { get; }
        public ExecutionResult PreviousOperation { get; }
        internal MoneyOwnerState(string owner, PlayerProfile profile, SessionAssessment session,
            ZKube.Local.LocalRunView campaign, RunClientState daily, PendingTransaction pending, ExecutionResult operation)
        { Owner = owner; Profile = profile; Session = session; Campaign = campaign; Daily = daily; Pending = pending; PreviousOperation = operation; }
    }

    // Headless foreground/owner lifetime. No timers, implicit Ensure, signing,
    // transaction retry or dependency disposal. Public and owner reads each have
    // one serialized finite operation; a newer request cancels old publication.
    public sealed partial class MoneyAppFlow
    {
        private readonly MoneyClientServices services;
        private readonly object gate = new object();
        private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
        private readonly SemaphoreSlim publicReads = new SemaphoreSlim(1, 1), ownerReads = new SemaphoreSlim(1, 1);
        private readonly HashSet<Task> operations = new HashSet<Task>();
        private CancellationTokenSource publicCancellation, ownerCancellation;
        private bool stopped;
        private Task stopTask;
        private MoneyRead<PublicDaily> publicValue;
        private MoneyRead<MoneyOwnerState> ownerValue;
        // One operation record belongs to the connected identity. Pages and
        // the board read this same record; a read failure cannot erase it.
        private RunOperationReceipts lastOperation;
        private void ClearOwnerOperation() { lock (gate) lastOperation = null; }
        private RunOperationReceipts CurrentOperation()
        {
            lock (gate)
            {
                if (lastOperation != null && !services.Identity.IsCurrent(lastOperation.Identity)) lastOperation = null;
                return lastOperation;
            }
        }
        public RunOperationReceipts LastRunReceipts(MoneyRunHandle run)
        {
            var value = CurrentOperation();
            return RunIdentityCurrent(run) && value != null && value.Steps.All(step => step.Address == run.Address)
                ? value : null;
        }
        private ExecutionResult ReadOwnerOperation(out bool recovered)
        {
            var value = CurrentOperation(); recovered = value?.Recovered ?? false; return value?.Last;
        }
        private bool CurrentOwnerOperation(ExecutionResult operation) => ReferenceEquals(operation, CurrentOperation()?.Last);
        private void RememberOperation(IdentityLease lease, IEnumerable<RunExecutionReceipt> receipts, bool recovered = false)
        {
            var steps = receipts.ToArray();
            lock (gate)
            {
                if (stopped || !services.Identity.IsCurrent(lease) || steps.Length == 0) return;
                lastOperation = RunOperationReceipts.Retained(lease, steps, recovered);
            }
        }
        private void RememberOwnerOperation(IdentityLease lease, ExecutionResult operation, bool recovered = false)
        {
            if (operation == null || operation.Code == "no-pending-transaction") return;
            RememberOperation(lease, new[] { new RunExecutionReceipt(lease.Owner, null, operation) }, recovered);
        }
        public MoneyRead<PublicDaily> Public { get { lock (gate) return publicValue; } }
        public MoneyRead<MoneyOwnerState> Owner { get { lock (gate) return ownerValue; } }
        public MoneyAppFlow(MoneyClientServices services) { this.services = services ?? throw new ArgumentNullException(nameof(services)); }

        public Task<MoneyRead<PublicDaily>> RefreshPublic(CancellationToken cancellation = default) => Track(async () => {
            var read = BeginRead(true, cancellation);
            try
            {
                await publicReads.WaitAsync(read.Token).ConfigureAwait(false);
                try
                {
                    var result = await services.PublicDaily.Current(read.Token).ConfigureAwait(false);
                    Require(read); var value = new MoneyRead<PublicDaily>(result, () => Current(read));
                    lock (gate) { Require(read); publicValue = value; } return value;
                }
                finally { publicReads.Release(); }
            }
            finally { EndRead(read); }
        });

        public Task<MoneyRead<MoneyOwnerState>> RefreshOwner(CancellationToken cancellation = default) => Track(async () => {
            var lease = services.Identity.Lease(); var read = BeginRead(false, cancellation, lease);
            try
            {
                await ownerReads.WaitAsync(read.Token).ConfigureAwait(false);
                try
                {
                    var pending = await services.Journal.Load(lease.Owner).ConfigureAwait(false); Require(read, lease);
                    ExecutionResult previous = null;
                    if (pending != null)
                    {
                        previous = await services.Executor.Resume(lease.Owner, services.Reconciler, read.Token, pending.Signature).ConfigureAwait(false);
                        RememberOwnerOperation(lease, previous, true);
                        read.Epoch = services.Identity.Epoch;
                        Require(read, lease);
                        if (!Resolved(previous)) return PublishOwner(read, lease,
                            new MoneyOwnerState(lease.Owner, null, null, null, null, pending, previous));
                    }
                    // Inspect never creates a key or prompts. It has its own
                    // identity cancellation; hold this read slot until it ends.
                    var session = await services.SessionLifecycle.Inspect().ConfigureAwait(false); Require(read, lease);
                    var profile = await services.Products.Profile(read.Token).ConfigureAwait(false); Require(read, lease);
                    var campaign = services.Campaign(lease.Owner).Runs.Active("campaign"); Require(read, lease);
                    var daily = await services.Runs.Inspect(read.Token).ConfigureAwait(false); Require(read, lease);
                    var remaining = await services.Journal.Load(lease.Owner).ConfigureAwait(false); Require(read, lease);
                    previous = ReadOwnerOperation(out _);
                    return PublishOwner(read, lease, new MoneyOwnerState(lease.Owner, profile.Value, session,
                        campaign, daily, remaining, previous));
                }
                finally { ownerReads.Release(); }
            }
            finally { EndRead(read); }
        });

        public Task<MoneyRead<string>> Connect(string expectedOwner = null) => Track(async () => {
            ClearOwnerOperation();
            var observation = InvalidateOwner();
            string owner = await services.Identity.Connect(expectedOwner).ConfigureAwait(false);
            var lease = services.Identity.Lease();
            services.SyncCampaign(lease);
            RequireOwnerObservation(observation, lease);
            return new MoneyRead<string>(owner, () => CurrentOwnerObservation(observation, lease));
        });

        // Explicit user action only. SessionLifecycle retains its own change
        // gate and distinguishes an old recovered receipt from a new repair.
        public Task<MoneyRead<SessionEnsureResult>> EnsureSession() => Track(async () => {
            var lease = services.Identity.Lease(); var observation = InvalidateOwner();
            var result = await services.SessionLifecycle.Ensure().ConfigureAwait(false);
            services.SyncCampaign(lease);
            RememberOwnerOperation(lease, result.Operation, result.Action == "recover");
            RequireOwnerObservation(observation, lease);
            return new MoneyRead<SessionEnsureResult>(result, () => CurrentOwnerObservation(observation, lease));
        });

        public Task<MoneyRead<ExecutionResult>> ResumePending(CancellationToken cancellation = default) => Track(async () => {
            var lease = services.Identity.Lease(); var read = BeginRead(false, cancellation, lease);
            try
            {
                await ownerReads.WaitAsync(read.Token).ConfigureAwait(false);
                try
                {
                    var pending = await services.Journal.Load(lease.Owner).ConfigureAwait(false); Require(read, lease);
                    var result = pending == null ? ExecutionResult.Rejected(null, "no-pending-transaction") :
                        await services.Executor.Resume(lease.Owner, services.Reconciler, read.Token, pending.Signature).ConfigureAwait(false);
                    RememberOwnerOperation(lease, result, true);
                    read.Epoch = services.Identity.Epoch;
                    Require(read, lease);
                    return new MoneyRead<ExecutionResult>(result, () => Current(read, lease));
                }
                finally { ownerReads.Release(); }
            }
            finally { EndRead(read); }
        });

        public Task Disconnect() => Track(async () => {
            var errors = InvalidateAll(); // Invalidate first; a callback cannot skip the other channel or native cleanup.
            try { await services.SessionLifecycle.Disconnect().ConfigureAwait(false); }
            catch (Exception error) { errors.Add(error); }
            Report(errors);
            return true;
        });

        private MoneyRead<MoneyOwnerState> PublishOwner(ReadRequest read, IdentityLease lease, MoneyOwnerState result)
        {
            Require(read, lease);
            var value = new MoneyRead<MoneyOwnerState>(result,
                () => Current(read, lease) &&
                    CurrentOwnerOperation(result.PreviousOperation));
            lock (gate) { Require(read, lease); ownerValue = value; } return value;
        }
        private static bool Resolved(ExecutionResult result) => result.Outcome == ExecutionOutcome.ConfirmedSuccess ||
            result.Outcome == ExecutionOutcome.ConfirmedFailure || result.Outcome == ExecutionOutcome.ExpiredReconciled;

        private sealed class ReadRequest
        {
            public bool Public;
            public long Epoch;
            public CancellationTokenSource Cancellation;
            public CancellationToken Token;
            public CancellationTokenRegistration CallerCancellation;
        }
        private ReadRequest BeginRead(bool isPublic, CancellationToken external, IdentityLease lease = null)
        {
            CancellationTokenSource prior; ReadRequest read;
            lock (gate)
            {
                Check();
                var cancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, lease?.Cancellation ?? CancellationToken.None);
                read = new ReadRequest { Public = isPublic, Cancellation = cancellation, Token = cancellation.Token, Epoch = services.Identity.Epoch };
                read.CallerCancellation = external.Register(() => {
                    try { cancellation.Cancel(); }
                    catch (ObjectDisposedException) { /* Superseded before the caller cancelled. */ }
                });
                if (isPublic) { prior = publicCancellation; publicCancellation = cancellation; publicValue = null; }
                else { prior = ownerCancellation; ownerCancellation = cancellation; ownerValue = null; }
            }
            var errors = CancelAll(prior);
            if (errors.Count != 0) { EndRead(read); Report(errors); }
            return read;
        }
        private void EndRead(ReadRequest read)
        {
            // The caller's request ends here; starting its next button action
            // does not invalidate the values it is about to render. A newer
            // flow read, identity change or reconciliation still does.
            read.CallerCancellation.Dispose();
            // A completed publication keeps its cancellation source until the
            // next read replaces it. This also invalidates retained values.
            lock (gate)
                if (read.Cancellation != publicCancellation && read.Cancellation != ownerCancellation)
                    read.Cancellation.Dispose();
        }
        private bool Current(ReadRequest read, IdentityLease lease = null)
        {
            lock (gate) return !stopped && !read.Token.IsCancellationRequested &&
                (read.Public || read.Epoch == services.Identity.Epoch) &&
                (lease == null || services.Identity.IsCurrent(lease));
        }
        private void Require(ReadRequest read, IdentityLease lease = null)
        { if (!Current(read, lease)) throw new OperationCanceledException("Money read was superseded"); }
        private bool CurrentOwnerObservation(CancellationToken observation, IdentityLease lease)
        { lock (gate) return !stopped && !observation.IsCancellationRequested && services.Identity.IsCurrent(lease); }
        private void RequireOwnerObservation(CancellationToken observation, IdentityLease lease)
        { if (!CurrentOwnerObservation(observation, lease)) throw new OperationCanceledException("Money action identity changed"); }
        private CancellationToken InvalidateOwner()
        {
            CancellationTokenSource prior; CancellationToken token;
            lock (gate)
            {
                Check(); ownerValue = null; prior = ownerCancellation;
                ownerCancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                token = ownerCancellation.Token;
            }
            Report(CancelAll(prior)); return token;
        }
        private List<Exception> InvalidateAll()
        {
            CancellationTokenSource oldPublic, oldOwner;
            lock (gate)
            { publicValue = null; ownerValue = null; ClearOwnerOperation();
                oldPublic = publicCancellation; oldOwner = ownerCancellation; publicCancellation = ownerCancellation = null; }
            return CancelAll(oldPublic, oldOwner);
        }
        private static List<Exception> CancelAll(params CancellationTokenSource[] sources)
        {
            var errors = new List<Exception>();
            foreach (var source in sources)
            {
                try { source?.Cancel(); }
                catch (ObjectDisposedException) { /* Completed concurrently with supersession. */ }
                catch (Exception error) { errors.Add(error); }
                finally { source?.Dispose(); }
            }
            return errors;
        }
        private static void Report(List<Exception> errors)
        { if (errors.Count != 0) throw new AggregateException("Money lifecycle callbacks or cleanup failed", errors); }
        private void Check() { if (stopped) throw new ObjectDisposedException(nameof(MoneyAppFlow)); }

        private Task<T> Track<T>(Func<Task<T>> operation)
        {
            var complete = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            lock (gate) { Check(); operations.Add(complete.Task); }
            async Task<T> Run()
            {
                try { return await operation().ConfigureAwait(false); }
                finally { lock (gate) operations.Remove(complete.Task); complete.TrySetResult(true); }
            }
            var result = Run();
            _ = result.ContinueWith(failed => { _ = failed.Exception; }, CancellationToken.None,
                TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
            return result;
        }
        public Task StopAsync()
        {
            Task[] pending; TaskCompletionSource<bool> completion;
            lock (gate)
            {
                if (stopTask != null) return stopTask;
                stopped = true;
                completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                stopTask = completion.Task;
                pending = operations.ToArray();
            }
            _ = Stop(pending, completion);
            return completion.Task;
        }
        private async Task Stop(Task[] pending, TaskCompletionSource<bool> completion)
        {
            try
            {
                var errors = InvalidateAll(); errors.AddRange(CancelAll(lifetime));
                try { await Task.WhenAll(pending).ConfigureAwait(false); }
                catch (Exception error) { errors.Add(error); }
                try { await services.DrainCampaignSync().ConfigureAwait(false); }
                catch (Exception error) { errors.Add(error); }
                try { await services.Executor.WithIdle(() => Task.CompletedTask).ConfigureAwait(false); }
                catch (Exception error) { errors.Add(error); }
                // Every owned resource gets its release attempt even if an
                // injected cancellation callback or earlier cleanup failed.
                foreach (var resource in new IDisposable[] { lifetime, publicReads, ownerReads })
                    try { resource.Dispose(); } catch (Exception error) { errors.Add(error); }
                Report(errors);
                completion.TrySetResult(true);
            }
            catch (Exception error) { completion.TrySetException(error); }
        }
    }
}
