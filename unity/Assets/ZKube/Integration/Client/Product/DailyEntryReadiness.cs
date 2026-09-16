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
        public ulong Kredits { get; }
        public SessionAssessment Session { get; }
        public bool Ready => Status == "ready";
        internal DailyEntryReadiness(string status, uint day,
            ulong kredits = 0, SessionAssessment session = null)
        { Status = status; DayId = day; Kredits = kredits; Session = session; }
    }

    internal sealed class DailyEntryObservation
    {
        internal uint Day;
        internal long ObservedAt;
        internal ulong Slot;
        internal PlayerPlanSnapshot Player;
        internal AccountEnvelope Occupied;
        private AccountEnvelope protocol, current, following, vault;
        internal DailyEntryAssessment Assess(AccountBindings accounts, long now) =>
            DailyEntrySnapshot.Inspect(accounts, protocol, current, following, vault, Day, now);

        internal static async Task<DailyEntryObservation> Read(AccountBindings accounts, TransactionPlanner planner,
            SolanaRpcTransport rpc, string owner, long timestamp, CancellationToken token)
        {
            if (timestamp < 0 || timestamp / 86400 >= uint.MaxValue) throw new ArgumentOutOfRangeException(nameof(timestamp));
            var value = new DailyEntryObservation { Day = checked((uint)(timestamp / 86400)), ObservedAt = timestamp };
            var first = await rpc.ReadAccounts(rpc.Base, new[] { planner.Player(owner), planner.ProtocolAddress,
                planner.Daily(value.Day), planner.CreditVaultAddress }, cancellation: token).ConfigureAwait(false);
            value.Slot = first.Slot;
            value.protocol = first.Accounts[1].Envelope; value.current = first.Accounts[2].Envelope; value.vault = first.Accounts[3].Envelope;
            if (first.Accounts[0].Envelope == null) return value;
            value.Player = PlayerPlanSnapshot.Decode(accounts, first.Accounts[0].Envelope, owner);
            if (value.Player.DailyRunId != 0) return value;
            uint next = value.protocol == null ? checked(value.Day + 1) :
                Math.Max(checked(value.Day + 1), (uint)accounts.ProtocolConfig(value.protocol)["suspended_until_day"]);
            var second = await rpc.ReadAccounts(rpc.Base, new[] { planner.Daily(next),
                planner.ActiveRun(owner, value.Player.NextRunId) }, minContextSlot: first.Slot, cancellation: token).ConfigureAwait(false);
            value.following = second.Accounts[0].Envelope; value.Occupied = second.Accounts[1].Envelope; value.Slot = second.Slot;
            return value;
        }
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

        public async Task<MoneyRead<DailyEntryReadiness>> Read(CancellationToken cancellation = default)
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
                var observation = await DailyEntryObservation.Read(accounts, planner, rpc, lease.Owner, timestamp, token).ConfigureAwait(false);
                var player = observation.Player;
                if (player == null) return new DailyEntryReadiness("missing-player", day);
                if (player.DailyRunId != 0) return new DailyEntryReadiness("resume", day, player.Kredits);
                var entry = observation.Assess(accounts, timestamp);
                if (entry.Snapshot == null) return new DailyEntryReadiness(entry.Status, day, kredits: player.Kredits);
                if (observation.Occupied != null) return new DailyEntryReadiness("run-address-occupied", day, kredits: player.Kredits);
                if (player.Kredits == 0) return new DailyEntryReadiness("needs-kredits", day);
                var session = await sessions.Inspect().ConfigureAwait(false);
                // A fresh current slot/sequence read detects cross-device entry
                // during this finite observation, without a mutable UI discovery flag.
                var last = await rpc.ReadAccount(rpc.Base, planner.Player(lease.Owner), minContextSlot: observation.Slot, cancellation: token).ConfigureAwait(false);
                if (last.Envelope == null) return new DailyEntryReadiness("changed", day);
                var after = PlayerPlanSnapshot.Decode(accounts, last.Envelope, lease.Owner);
                if (after.DailyRunId != 0) return new DailyEntryReadiness("resume", day, after.Kredits);
                long completedAt = now();
                if (after.NextRunId != player.NextRunId || after.Kredits != player.Kredits || completedAt / 86400 != day ||
                    await journal.Load(lease.Owner).ConfigureAwait(false) != null)
                    return new DailyEntryReadiness("changed", day, kredits: after.Kredits);
                var finalWindow = observation.Assess(accounts, completedAt);
                if (finalWindow.Snapshot == null) return new DailyEntryReadiness(finalWindow.Status, day, kredits: after.Kredits);
                return new DailyEntryReadiness(!session.Current ? "needs-session" : session.Funding != "ready" ? "needs-refill" : "ready",
                    day, kredits: after.Kredits, session: session);
            }
            var value = await Observe().ConfigureAwait(false);
            token.ThrowIfCancellationRequested();
            if (!identity.IsCurrent(lease)) throw new OperationCanceledException("Daily readiness identity changed");
            return new MoneyRead<DailyEntryReadiness>(identity, lease, value);
        }
    }
}
