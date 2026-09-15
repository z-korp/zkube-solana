using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Integration.Execution;
using ZKube.Integration.Planning;

namespace ZKube.Integration.Client
{
    public sealed class EconomyClient
    {
        private readonly ClientIdentity identity;
        private readonly SessionAccess sessions;
        private readonly ProductQueries products;
        private readonly TransactionPlanner planner;
        private readonly TransactionJournal journal;
        private readonly TransactionExecutor executor;
        private readonly IExecutionReconciler reconciler;
        public EconomyClient(ClientIdentity identity, SessionAccess sessions, ProductQueries products, TransactionPlanner planner,
            TransactionJournal journal, TransactionExecutor executor, IExecutionReconciler reconciler)
        { this.identity = identity; this.sessions = sessions; this.products = products; this.planner = planner;
            this.journal = journal; this.executor = executor; this.reconciler = reconciler; }
        public async Task<ExecutionResult> Buy(uint pack, CancellationToken cancellation = default)
        {
            if (!SessionViewPolicy.KreditPacks.Contains(pack)) throw new ArgumentOutOfRangeException(nameof(pack));
            var lease = identity.Lease();
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(lease.Cancellation, cancellation);
            linked.Token.ThrowIfCancellationRequested();
            if (await journal.Load(lease.Owner).ConfigureAwait(false) != null)
                return ExecutionResult.Rejected("purchase-kredits", "pending-transaction-exists");
            return await executor.Execute(planner.Purchase(lease.Owner, pack), "purchase-kredits", Array.Empty<DeviceSigner>(), reconciler, linked.Token).ConfigureAwait(false);
        }
        public async Task<ExecutionResult> SetFeaturedIdentity(byte emblem, byte frame, CancellationToken cancellation = default)
        {
            var lease = identity.Lease();
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(lease.Cancellation, cancellation);
            linked.Token.ThrowIfCancellationRequested();
            if (await journal.Load(lease.Owner).ConfigureAwait(false) != null)
                return ExecutionResult.Rejected("set-featured-identity", "pending-transaction-exists");
            using var session = await sessions.Load(lease).ConfigureAwait(false);
            return await executor.Execute(planner.SetFeaturedIdentity(session.Actor, emblem, frame),
                "set-featured-identity", new[] { session.Signer }, reconciler, linked.Token).ConfigureAwait(false);
        }
        public async Task<ExecutionResult> Claim(uint day, string kind, CancellationToken cancellation = default)
        {
            var lease = identity.Lease();
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(lease.Cancellation, cancellation);
            linked.Token.ThrowIfCancellationRequested();
            if (await journal.Load(lease.Owner).ConfigureAwait(false) != null)
                return ExecutionResult.Rejected("claim-daily", "pending-transaction-exists");
            using var session = await sessions.Load(lease).ConfigureAwait(false);
            var read = await products.SettledBoard(day, kind, linked.Token).ConfigureAwait(false);
            var board = read.Value;
            if (board.ClaimStatus != "claimable" || board.Yours == null)
                throw new InvalidOperationException("Daily reward is not claimable");
            return await executor.Execute(planner.Claim(session.Actor, day, kind, board.Yours.Record.Position), "claim-daily", new[] { session.Signer }, reconciler, linked.Token).ConfigureAwait(false);
        }
    }
}
