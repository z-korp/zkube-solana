using System;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Integration.Client;
using ZKube.Integration.Execution;

namespace ZKube.Integration.App
{
    public sealed class MoneySessionState
    {
        public string Owner { get; }
        public SessionAssessment Session { get; }
        public PendingTransaction Pending { get; }
        public ExecutionResult PreviousOperation { get; }
        public bool RecoveredOperation { get; }
        internal MoneySessionState(string owner, SessionAssessment session, PendingTransaction pending, ExecutionResult operation, bool recovered)
        { Owner = owner; Session = session; Pending = pending; PreviousOperation = operation; RecoveredOperation = recovered; }
    }

    public sealed partial class MoneyAppFlow
    {
        // Page opening and foreground are observations. In particular, a saved
        // journal is displayed without reconciling it or repairing a session.
        public Task<MoneyRead<MoneySessionState>> RefreshSession(CancellationToken cancellation = default) => Track(async () => {
            var lease = services.Identity.Lease(); var read = BeginRead(false, cancellation, lease);
            try
            {
                await ownerReads.WaitAsync(read.Token).ConfigureAwait(false);
                try
                {
                    var session = await services.SessionLifecycle.Inspect().ConfigureAwait(false); Require(read, lease);
                    var pending = await services.Journal.Load(lease.Owner).ConfigureAwait(false); Require(read, lease);
                    var operation = ReadOwnerOperation(out bool recovered);
                    return new MoneyRead<MoneySessionState>(new MoneySessionState(lease.Owner, session, pending, operation, recovered),
                        () => Current(read, lease) &&
                            CurrentOwnerOperation(operation));
                }
                finally { ownerReads.Release(); }
            }
            finally { EndRead(read); }
        });

        public Task<MoneyRead<ExecutionResult>> RefillSession() => Track(async () => {
            var lease = services.Identity.Lease(); var observation = InvalidateOwner();
            var result = await services.SessionLifecycle.Refill().ConfigureAwait(false);
            services.SyncCampaign(lease);
            RememberOwnerOperation(lease, result);
            RequireOwnerObservation(observation, lease);
            return new MoneyRead<ExecutionResult>(result, () => CurrentOwnerObservation(observation, lease));
        });

        public Task<MoneyRead<ExecutionResult>> RevokeSession() => Track(async () => {
            var lease = services.Identity.Lease(); var observation = InvalidateOwner();
            var result = await services.SessionLifecycle.Revoke().ConfigureAwait(false);
            RememberOwnerOperation(lease, result);
            RequireOwnerObservation(observation, lease);
            return new MoneyRead<ExecutionResult>(result, () => CurrentOwnerObservation(observation, lease));
        });
    }
}
