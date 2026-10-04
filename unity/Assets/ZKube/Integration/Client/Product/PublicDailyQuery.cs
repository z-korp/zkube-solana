using System;
using System.Linq;
using System.Numerics;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;

namespace ZKube.Integration.Client
{
    // Public facts only. No owner, profile, session, personal record or entry promise.
    public sealed class PublicDaily
    {
        private readonly DailyInfo window;
        // The game has launched: the protocol names its launch day and that day has come.
        public bool Launched { get; }
        public uint DayId { get; }
        public long ObservedAt { get; }
        public string Status { get; }
        public bool Suspended { get; }
        public bool ProtocolPaused { get; }
        public byte Realm { get; }
        public byte ObjectiveKind { get; }
        public byte ObjectiveValue { get; }
        public ulong? PotLamports { get; }
        public long? FreezesAt => !Launched ? (long?)null : (long)window.FreezesAt;
        internal PublicDaily(uint day, long timestamp, string status, bool suspended,
            bool paused, DailyInfo facts, ulong? pool, bool launched)
        {
            DayId = day; window = facts; ObservedAt = timestamp; Status = status;
            Suspended = suspended; ProtocolPaused = paused; Realm = facts.Realm;
            ObjectiveKind = facts.Kind; ObjectiveValue = facts.Value; PotLamports = pool;
            Launched = launched;
        }
    }

    // Construct without ClientIdentity or wallet. One Base batch reads today's
    // protocol/Daily PDAs and a second reads the Daily before it, whose waiting
    // share is part of today's pot; SolanaRpcTransport verifies the configured genesis.
    public sealed class PublicDailyQuery
    {
        private readonly AccountBindings accounts;
        private readonly TransactionPlanner addresses;
        private readonly SolanaRpcTransport rpc;
        private readonly Func<long> now;
        public PublicDailyQuery(AccountBindings accounts, TransactionPlanner addresses,
            SolanaRpcTransport rpc, Func<long> now)
        { this.accounts = accounts; this.addresses = addresses; this.rpc = rpc; this.now = now; }

        // The one launch rule, for a page that needs nothing else of the Daily:
        // read from the protocol account each time, never remembered.
        public async Task<bool> Launched(CancellationToken cancellation = default)
        {
            uint day = CurrentDay(ValidateClock(now()));
            var read = await rpc.ReadAccount(rpc.Base, addresses.ProtocolAddress, cancellation: cancellation).ConfigureAwait(false);
            cancellation.ThrowIfCancellationRequested();
            return Launched(read.Envelope == null ? null : accounts.ProtocolConfig(read.Envelope), day);
        }
        internal static bool Launched(JObject protocol, uint day) =>
            protocol != null && (uint)protocol["launch_day_id"] != 0 && day >= (uint)protocol["launch_day_id"];

        public async Task<PublicDaily> Current(CancellationToken cancellation = default)
        {
            cancellation.ThrowIfCancellationRequested();
            uint day = CurrentDay(ValidateClock(now()));
            var read = await rpc.ReadAccounts(rpc.Base, new[] { addresses.ProtocolAddress,
                addresses.Daily(day) }, cancellation: cancellation).ConfigureAwait(false);
            cancellation.ThrowIfCancellationRequested();
            var before = await Predecessor(accounts, addresses, rpc, day, read.Accounts[0].Envelope, read.Accounts[1].Envelope,
                read.Slot, cancellation).ConfigureAwait(false);
            cancellation.ThrowIfCancellationRequested();
            return Decode(accounts, day, ValidateClock(now()),
                read.Accounts[0].Envelope, read.Accounts[1].Envelope, before);
        }

        // The Daily whose waiting share today's pot still expects: the one today's
        // Daily names until it has received it, or the newest prepared Daily while
        // nobody has entered today.
        internal static async Task<AccountEnvelope> Predecessor(AccountBindings accounts, TransactionPlanner addresses, SolanaRpcTransport rpc,
            uint day, AccountEnvelope protocolEnvelope, AccountEnvelope dailyEnvelope, ulong slot, CancellationToken cancellation)
        {
            if (protocolEnvelope == null) return null;
            var protocol = accounts.ProtocolConfig(protocolEnvelope);
            var daily = dailyEnvelope == null ? null : accounts.ArenaDaily(dailyEnvelope, day);
            uint before = daily != null ? ((bool)daily["predecessor_rollover_applied"] ? 0 : (uint)daily["predecessor_day"])
                : (uint)protocol["last_prepared_day"];
            if (before == 0 || before >= day) return null;
            var read = await rpc.ReadAccount(rpc.Base, addresses.Daily(before), minContextSlot: slot, cancellation: cancellation).ConfigureAwait(false);
            return read.Envelope;
        }

        // Both connected and disconnected facades use this validated projection.
        // Validate every supplied public account before an absent peer can hide it.
        internal static PublicDaily Decode(AccountBindings accounts, uint day, long timestamp,
            AccountEnvelope protocolEnvelope, AccountEnvelope dailyEnvelope, AccountEnvelope predecessorEnvelope = null)
        {
            if (CurrentDay(ValidateClock(timestamp)) != day)
                throw new InvalidOperationException("UTC Daily changed during read; read it again");
            var protocol = protocolEnvelope == null ? null : accounts.ProtocolConfig(protocolEnvelope);
            var daily = dailyEnvelope == null ? null : accounts.ArenaDaily(dailyEnvelope, day);
            var pair = NativeEngine.Daily(day);
            bool paused = protocol != null && (bool)protocol["paused"];
            bool suspended = protocol != null && day < (uint)protocol["suspended_until_day"];
            // A launched game has a Daily every day: its account appears with the
            // first entry, and until then the day is open by the clock.
            bool published = Launched(protocol, day);
            string status = protocol == null ? "missing-config"
                : suspended ? "suspended" : !published ? "missing-daily"
                : paused ? "paused" : DailyStatus(daily, timestamp, pair);
            JObject predecessor = null;
            if (published && predecessorEnvelope != null)
            {
                predecessor = accounts.ArenaDaily(predecessorEnvelope);
                if ((uint)predecessor["day_id"] >= day) throw new FormatException("The Daily before today's is not an earlier day");
            }
            // Missing config or an unlaunched game has no invented pot or playable snapshot.
            return new PublicDaily(day, timestamp, status, suspended, paused,
                pair, published ? DailyCadence.Pot(daily, predecessor) : (ulong?)null,
                published);
        }


        internal static long ValidateClock(long timestamp)
        { CurrentDay(timestamp); return timestamp; }
        // The core owns which day an instant belongs to (days turn at 07:00 UTC).
        internal static uint CurrentDay(long timestamp)
        {
            try { return NativeEngine.DayAt(timestamp); }
            catch (NativeEngineException) { throw new ArgumentOutOfRangeException("now"); }
        }
        internal static string DailyStatus(JObject daily, long timestamp, DailyInfo window = null)
        {
            // A Daily carries no status: the clock opens and closes it, and it
            // is finalized once it records when.
            window ??= NativeEngine.Daily((uint)daily["day_id"]);
            return daily != null && DailyCadence.Finalized(daily) ? "finalized"
                : timestamp >= (long)window.FreezesAt ? "frozen"
                : timestamp < (long)window.OpensAt ? "not-open" : "open";
        }
    }
}
