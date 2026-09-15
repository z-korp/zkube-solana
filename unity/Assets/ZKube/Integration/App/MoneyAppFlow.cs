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
    // Hosts read Value at publication, after dispatching onto their UI thread.
    // Retained data is rejected after identity change, supersession or shutdown.
    public sealed class MoneyRead<T>
    {
        private readonly T value;
        private readonly Func<bool> current;
        public bool IsCurrent => current();
        public T Value => IsCurrent ? value : throw new OperationCanceledException("Money application observation changed");
        internal MoneyRead(T value, Func<bool> current) { this.value = value; this.current = current; }
    }
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
        private long publicGeneration, ownerGeneration;
        private bool stopped;
        private Task stopTask;
        private MoneyRead<PublicDaily> publicValue;
        private MoneyRead<MoneyOwnerState> ownerValue;
        // One exact receipt for the connected identity, shared by all owner
        // pages. Read supersession preserves it; reconnect and shutdown do not.
        private ExecutionResult ownerOperation;
        private IdentityLease ownerOperationLease;
        private bool ownerOperationRecovered;
        private void ClearOwnerOperation()
        {
            lock (gate) { ownerOperation = null; ownerOperationLease = null; ownerOperationRecovered = false; }
        }
        private ExecutionResult ReadOwnerOperation(out bool recovered)
        {
            lock (gate)
            {
                if (!services.Identity.IsCurrent(ownerOperationLease)) ClearOwnerOperation();
                recovered = ownerOperation != null && ownerOperationRecovered;
                return ownerOperation;
            }
        }
        private bool CurrentOwnerOperation(ExecutionResult operation)
        {
            lock (gate)
            {
                if (!services.Identity.IsCurrent(ownerOperationLease)) ClearOwnerOperation();
                return ReferenceEquals(operation, ownerOperation);
            }
        }
        private void RememberOwnerOperation(IdentityLease lease, ExecutionResult operation, bool recovered = false)
        {
            lock (gate)
            {
                // A check after the journal has cleared observes no transaction;
                // it cannot replace the last real operation with a local rejection.
                if (stopped || !services.Identity.IsCurrent(lease) || operation == null ||
                    operation.Code == "no-pending-transaction") return;
                ownerOperation = operation; ownerOperationLease = lease; ownerOperationRecovered = recovered;
            }
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
                        previous = await services.Executor.Resume(lease.Owner, services.Dispatcher, read.Token, pending.Signature).ConfigureAwait(false);
                        RememberOwnerOperation(lease, previous, true);
                        Require(read, lease);
                        if (!Resolved(previous)) return PublishOwner(read, lease,
                            new MoneyOwnerState(lease.Owner, null, null, null, null, pending, previous), services.EconomyRevision(lease.Owner));
                    }
                    long revision = services.EconomyRevision(lease.Owner);
                    // Inspect never creates a key or prompts. It has its own
                    // identity cancellation; hold this read slot until it ends.
                    var session = await services.SessionLifecycle.Inspect().ConfigureAwait(false); Require(read, lease);
                    var profile = await services.Products.Profile(read.Token).ConfigureAwait(false); Require(read, lease);
                    var campaign = services.Campaign(lease.Owner).Runs.Active("campaign"); Require(read, lease);
                    var daily = await services.Runs.Inspect("daily", read.Token).ConfigureAwait(false); Require(read, lease);
                    var remaining = await services.Journal.Load(lease.Owner).ConfigureAwait(false); Require(read, lease);
                    previous = ReadOwnerOperation(out _);
                    return PublishOwner(read, lease, new MoneyOwnerState(lease.Owner, profile.Value, session,
                        campaign, daily, remaining, previous), revision);
                }
                finally { ownerReads.Release(); }
            }
            finally { EndRead(read); }
        });

        public Task<MoneyRead<string>> Connect(string expectedOwner = null) => Track(async () => {
            ClearOwnerOperation();
            long generation = InvalidateOwner();
            string owner = await services.Identity.Connect(expectedOwner).ConfigureAwait(false);
            var lease = services.Identity.Lease();
            services.SyncCampaign(lease);
            RequireOwnerGeneration(generation, lease);
            return new MoneyRead<string>(owner, () => CurrentOwnerGeneration(generation, lease));
        });

        // Explicit user action only. SessionLifecycle retains its own change
        // gate and distinguishes an old recovered receipt from a new repair.
        public Task<MoneyRead<SessionEnsureResult>> EnsureSession() => Track(async () => {
            var lease = services.Identity.Lease(); long generation = InvalidateOwner();
            var result = await services.SessionLifecycle.Ensure().ConfigureAwait(false);
            services.SyncCampaign(lease);
            RememberOwnerOperation(lease, result.Operation, result.Action == "recover");
            RequireOwnerGeneration(generation, lease);
            return new MoneyRead<SessionEnsureResult>(result, () => CurrentOwnerGeneration(generation, lease));
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
                        await services.Executor.Resume(lease.Owner, services.Dispatcher, read.Token, pending.Signature).ConfigureAwait(false);
                    RememberOwnerOperation(lease, result, true);
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

        private MoneyRead<MoneyOwnerState> PublishOwner(ReadRequest read, IdentityLease lease, MoneyOwnerState result, long revision)
        {
            Require(read, lease);
            if (services.EconomyRevision(lease.Owner) != revision) throw new OperationCanceledException("Owner economy changed during refresh");
            var value = new MoneyRead<MoneyOwnerState>(result,
                () => Current(read, lease) && services.EconomyRevision(lease.Owner) == revision &&
                    CurrentOwnerOperation(result.PreviousOperation));
            lock (gate) { Require(read, lease); ownerValue = value; } return value;
        }
        private static bool Resolved(ExecutionResult result) => result.Outcome == ExecutionOutcome.ConfirmedSuccess ||
            result.Outcome == ExecutionOutcome.ConfirmedFailure || result.Outcome == ExecutionOutcome.ExpiredReconciled;

        private sealed class ReadRequest
        {
            public bool Public;
            public long Generation;
            public CancellationTokenSource Cancellation;
            public CancellationToken Token;
        }
        private ReadRequest BeginRead(bool isPublic, CancellationToken external, IdentityLease lease = null)
        {
            CancellationTokenSource prior; ReadRequest read;
            lock (gate)
            {
                Check();
                var cancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, external, lease?.Cancellation ?? CancellationToken.None);
                read = new ReadRequest { Public = isPublic, Cancellation = cancellation, Token = cancellation.Token };
                if (isPublic) { prior = publicCancellation; publicCancellation = cancellation; read.Generation = ++publicGeneration; publicValue = null; }
                else { prior = ownerCancellation; ownerCancellation = cancellation; read.Generation = ++ownerGeneration; ownerValue = null; }
            }
            var errors = CancelAll(prior);
            if (errors.Count != 0) { EndRead(read); Report(errors); }
            return read;
        }
        private void EndRead(ReadRequest read)
        {
            lock (gate)
            {
                if (read.Public && publicCancellation == read.Cancellation) publicCancellation = null;
                if (!read.Public && ownerCancellation == read.Cancellation) ownerCancellation = null;
            }
            read.Cancellation.Dispose();
        }
        private bool Current(ReadRequest read, IdentityLease lease = null)
        {
            lock (gate) return !stopped && !read.Token.IsCancellationRequested &&
                read.Generation == (read.Public ? publicGeneration : ownerGeneration) && (lease == null || services.Identity.IsCurrent(lease));
        }
        private void Require(ReadRequest read, IdentityLease lease = null)
        { if (!Current(read, lease)) throw new OperationCanceledException("Money read was superseded"); }
        private bool CurrentOwnerGeneration(long generation, IdentityLease lease)
        { lock (gate) return !stopped && generation == ownerGeneration && services.Identity.IsCurrent(lease); }
        private void RequireOwnerGeneration(long generation, IdentityLease lease)
        { if (!CurrentOwnerGeneration(generation, lease)) throw new OperationCanceledException("Money action identity changed"); }
        private long InvalidateOwner()
        {
            CancellationTokenSource prior; long generation;
            lock (gate) { Check(); generation = ++ownerGeneration; ownerValue = null; prior = ownerCancellation; ownerCancellation = null; }
            Report(CancelAll(prior)); return generation;
        }
        private List<Exception> InvalidateAll()
        {
            CancellationTokenSource oldPublic, oldOwner;
            lock (gate)
            { publicGeneration++; ownerGeneration++; publicValue = null; ownerValue = null; ClearOwnerOperation();
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
