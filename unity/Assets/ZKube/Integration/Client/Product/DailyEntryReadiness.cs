using System;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;

namespace ZKube.Integration.Client
{
    public sealed class DailyEntryReadiness
    {
        public string Status { get; }
        public uint DayId { get; }
        public ulong Slot { get; }
        public ulong? ResumeRunId { get; }
        public ulong Kredits { get; }
        public SessionAssessment Session { get; }
        public bool Ready => Status == "ready";
        internal DailyEntryReadiness(string status, uint day, ulong slot = 0, ulong? resume = null,
            ulong kredits = 0, SessionAssessment session = null)
        { Status = status; DayId = day; Slot = slot; ResumeRunId = resume; Kredits = kredits; Session = session; }
    }

    // Finite observation only. No claims scan, signature, key creation, mutation or
    // following-day content. The executor repeats all submission checks later.
    public sealed class DailyEntryReadinessQuery
    {
        private readonly ClientIdentity identity;
        private readonly SessionLifecycle sessions;
        private readonly AccountBindings accounts;
        private readonly TransactionPlanner planner;
        private readonly SolanaRpcTransport rpc;
        private readonly TransactionJournal journal;
        private readonly Func<long> now;
        public DailyEntryReadinessQuery(ClientIdentity identity, SessionLifecycle sessions, AccountBindings accounts,
            TransactionPlanner planner, SolanaRpcTransport rpc, TransactionJournal journal, Func<long> now)
        { this.identity = identity; this.sessions = sessions; this.accounts = accounts; this.planner = planner; this.rpc = rpc; this.journal = journal; this.now = now; }

        public async Task<ProductRead<DailyEntryReadiness>> Read(CancellationToken cancellation = default)
        {
            var lease = identity.Lease();
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(lease.Cancellation, cancellation);
            var token = linked.Token;
            long timestamp = now();
            if (timestamp < 0 || timestamp / 86400 >= uint.MaxValue) throw new ArgumentOutOfRangeException("now");
            uint day = checked((uint)(timestamp / 86400));
            async Task<DailyEntryReadiness> Observe()
            {
                token.ThrowIfCancellationRequested();
                if (await journal.Load(lease.Owner).ConfigureAwait(false) != null) return new DailyEntryReadiness("pending-transaction", day);
                var first = await rpc.ReadAccounts(rpc.Base, new[] { planner.Player(lease.Owner), planner.ProtocolAddress,
                    planner.ArcadeAddress, planner.Daily(day), planner.CreditVaultAddress }, cancellation: token).ConfigureAwait(false);
                if (first.Accounts[0].Envelope == null) return new DailyEntryReadiness("missing-player", day, first.Slot);
                var player = PlayerPlanSnapshot.Decode(accounts, first.Accounts[0].Envelope, lease.Owner);
                if (player.DailyRunId != 0) return new DailyEntryReadiness("resume", day, first.Slot, player.DailyRunId, player.Kredits);
                uint following = first.Accounts[2].Envelope == null ? checked(day + 1) :
                    Math.Max(checked(day + 1), (uint)accounts.ArcadeConfig(first.Accounts[2].Envelope)["suspended_until_day"]);
                var second = await rpc.ReadAccounts(rpc.Base, new[] { planner.Daily(following),
                    planner.ActiveRun(lease.Owner, player.NextRunId) }, minContextSlot: first.Slot, cancellation: token).ConfigureAwait(false);
                var entry = DailyEntrySnapshot.Inspect(accounts, first.Accounts[1].Envelope, first.Accounts[2].Envelope,
                    first.Accounts[3].Envelope, second.Accounts[0].Envelope, first.Accounts[4].Envelope, day, timestamp);
                if (entry.Snapshot == null) return new DailyEntryReadiness(entry.Status, day, second.Slot, kredits: player.Kredits);
                if (second.Accounts[1].Envelope != null) return new DailyEntryReadiness("run-address-occupied", day, second.Slot, kredits: player.Kredits);
                if (player.Kredits == 0) return new DailyEntryReadiness("needs-kredits", day, second.Slot);
                var session = await sessions.Inspect().ConfigureAwait(false);
                // A fresh current slot/sequence read detects cross-device entry
                // during this finite observation, without a mutable UI discovery flag.
                var last = await rpc.ReadAccount(rpc.Base, planner.Player(lease.Owner), minContextSlot: second.Slot, cancellation: token).ConfigureAwait(false);
                if (last.Envelope == null) return new DailyEntryReadiness("changed", day, last.Slot);
                var after = PlayerPlanSnapshot.Decode(accounts, last.Envelope, lease.Owner);
                if (after.DailyRunId != 0) return new DailyEntryReadiness("resume", day, last.Slot, after.DailyRunId, after.Kredits);
                long completedAt = now();
                if (after.NextRunId != player.NextRunId || after.Kredits != player.Kredits || completedAt / 86400 != day ||
                    await journal.Load(lease.Owner).ConfigureAwait(false) != null)
                    return new DailyEntryReadiness("changed", day, last.Slot, kredits: after.Kredits);
                var finalWindow = DailyEntrySnapshot.Inspect(accounts, first.Accounts[1].Envelope, first.Accounts[2].Envelope,
                    first.Accounts[3].Envelope, second.Accounts[0].Envelope, first.Accounts[4].Envelope, day, completedAt);
                if (finalWindow.Snapshot == null) return new DailyEntryReadiness(finalWindow.Status, day, last.Slot, kredits: after.Kredits);
                return new DailyEntryReadiness(!session.Current ? "needs-session" : session.Funding != "ready" ? "needs-refill" : "ready",
                    day, last.Slot, kredits: after.Kredits, session: session);
            }
            var value = await Observe().ConfigureAwait(false);
            token.ThrowIfCancellationRequested();
            if (!identity.IsCurrent(lease)) throw new OperationCanceledException("Daily readiness identity changed");
            return new ProductRead<DailyEntryReadiness>(identity, lease, value);
        }
    }
}
