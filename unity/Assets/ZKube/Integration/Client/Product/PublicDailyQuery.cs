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
        private readonly JObject daily;
        private readonly DailyWindow window;
        public uint DayId { get; }
        public ulong Slot { get; }
        public long ObservedAt { get; }
        public string Status { get; }
        public bool Suspended { get; }
        public bool ProtocolPaused { get; }
        public byte Realm { get; }
        public byte ObjectiveKind { get; }
        public byte ObjectiveValue { get; }
        public ulong? PotLamports { get; }
        public bool HasPublication => daily != null;
        public long? OpensAt => daily == null ? (long?)null : (long)window.OpensAt;
        public long? FreezesAt => daily == null ? (long?)null : (long)window.FreezesAt;
        public byte? StartingHeight => daily == null ? (byte?)null : NativeEngine.CampaignRules(Realm, 1).StartingHeight;
        public JObject Daily => (JObject)daily?.DeepClone();
        internal PublicDaily(uint day, ulong slot, long timestamp, string status, bool suspended,
            bool paused, byte realm, byte kind, byte value, ulong? pool, JObject fields)
        {
            DayId = day; window = NativeEngine.DailyWindow(day); Slot = slot; ObservedAt = timestamp; Status = status;
            Suspended = suspended; ProtocolPaused = paused; Realm = realm;
            ObjectiveKind = kind; ObjectiveValue = value; PotLamports = pool;
            daily = (JObject)fields?.DeepClone();
        }
    }

    // Construct without ClientIdentity or wallet. One Base batch reads only today's
    // protocol/config/Daily PDAs; SolanaRpcTransport verifies the configured genesis.
    public sealed class PublicDailyQuery
    {
        private readonly AccountBindings accounts;
        private readonly TransactionPlanner addresses;
        private readonly SolanaRpcTransport rpc;
        private readonly Func<long> now;
        public PublicDailyQuery(AccountBindings accounts, TransactionPlanner addresses,
            SolanaRpcTransport rpc, Func<long> now)
        { this.accounts = accounts; this.addresses = addresses; this.rpc = rpc; this.now = now; }

        public async Task<PublicDaily> Current(CancellationToken cancellation = default)
        {
            cancellation.ThrowIfCancellationRequested();
            uint day = CurrentDay(ValidateClock(now()));
            var read = await rpc.ReadAccounts(rpc.Base, new[] { addresses.ProtocolAddress,
                addresses.ArcadeAddress, addresses.Daily(day) }, cancellation: cancellation).ConfigureAwait(false);
            cancellation.ThrowIfCancellationRequested();
            return Decode(accounts, day, ValidateClock(now()), read.Slot,
                read.Accounts[0].Envelope, read.Accounts[1].Envelope, read.Accounts[2].Envelope);
        }

        // Both connected and disconnected facades use this validated projection.
        // Validate every supplied public account before an absent peer can hide it.
        internal static PublicDaily Decode(AccountBindings accounts, uint day, long timestamp, ulong slot,
            AccountEnvelope protocolEnvelope, AccountEnvelope arcadeEnvelope, AccountEnvelope dailyEnvelope)
        {
            if (CurrentDay(ValidateClock(timestamp)) != day)
                throw new InvalidOperationException("UTC Daily changed during read; read it again");
            var protocol = protocolEnvelope == null ? null : accounts.ProtocolConfig(protocolEnvelope);
            var arcade = arcadeEnvelope == null ? null : accounts.ArcadeConfig(arcadeEnvelope);
            var daily = dailyEnvelope == null ? null : accounts.ArenaDaily(dailyEnvelope, day);
            var pair = NativeEngine.DailyPair(day);
            bool paused = protocol != null && (bool)protocol["paused"];
            bool suspended = arcade != null && day < (uint)arcade["suspended_until_day"];
            string status = protocol == null || arcade == null ? "missing-config"
                : suspended ? "suspended" : daily == null ? "missing-daily"
                : paused ? "paused" : DailyStatus(daily, timestamp);
            // Missing publication/config has no invented funded pot or playable snapshot.
            bool published = protocol != null && arcade != null && daily != null;
            return new PublicDaily(day, slot, timestamp, status, suspended, paused,
                pair.Realm, pair.Kind, pair.Value, published ? AvailablePool(daily["ledger"]) : (ulong?)null,
                published ? daily : null);
        }


        internal static long ValidateClock(long timestamp)
        { if (timestamp < 0 || timestamp / 86400 > uint.MaxValue) throw new ArgumentOutOfRangeException("now"); return timestamp; }
        internal static uint CurrentDay(long timestamp) => checked((uint)(timestamp / 86400));
        internal static string DailyStatus(JObject daily, long timestamp)
        {
            var window = NativeEngine.DailyWindow((uint)daily["day_id"]);
            string status = ((JObject)daily["status"]).Properties().Single().Name.ToLowerInvariant();
            return status == "open" && timestamp >= (long)window.FreezesAt ? "frozen"
                : status == "open" && timestamp < (long)window.OpensAt ? "not-open" : status;
        }
        private static ulong AvailablePool(JToken ledger)
        {
            var value = new BigInteger((ulong)ledger["seeded_lamports"]) + (ulong)ledger["entry_lamports"] + (ulong)ledger["rollover_in_lamports"]
                - (ulong)ledger["payout_lamports"] - (ulong)ledger["rollover_out_lamports"];
            if (value < 0 || value > ulong.MaxValue) throw new FormatException("Daily ledger available pool is invalid");
            return (ulong)value;
        }
    }
}
