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
        public long? OpensAt => daily == null ? (long?)null : (long)daily["opens_at"];
        public long? FreezesAt => daily == null ? (long?)null : (long)daily["runs_close_at"];
        public byte? StartingHeight => daily == null ? (byte?)null : (byte)daily["rules"]["starting_rows"];
        public JObject Daily => (JObject)daily?.DeepClone();
        internal PublicDaily(uint day, ulong slot, long timestamp, string status, bool suspended,
            bool paused, byte realm, byte kind, byte value, ulong? pool, JObject fields)
        {
            DayId = day; Slot = slot; ObservedAt = timestamp; Status = status;
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
            if (daily != null && protocol != null) ValidateDailyPublication(daily, protocol, day);
            uint pair = NativeEngine.DailyPairIndex(day);
            byte realm = checked((byte)(pair / Protocol.DailyThemes.Length + 1));
            var theme = Protocol.DailyThemes[pair % Protocol.DailyThemes.Length];
            bool paused = protocol != null && (bool)protocol["paused"];
            bool suspended = arcade != null && day < (uint)arcade["suspended_until_day"];
            string status = protocol == null || arcade == null ? "missing-config"
                : suspended ? "suspended" : daily == null ? "missing-daily"
                : paused ? "paused" : DailyStatus(daily, timestamp);
            // Missing publication/config has no invented funded pot or playable snapshot.
            bool published = protocol != null && arcade != null && daily != null;
            return new PublicDaily(day, slot, timestamp, status, suspended, paused,
                realm, theme[0], theme[1], published ? AvailablePool(daily["ledger"]) : (ulong?)null,
                published ? daily : null);
        }

        internal static void ValidateDailyPublication(JObject daily, JObject protocol, uint day)
        {
            uint pair = NativeEngine.DailyPairIndex(day);
            byte realm = checked((byte)(pair / Protocol.DailyThemes.Length + 1));
            var theme = Protocol.DailyThemes[pair % Protocol.DailyThemes.Length];
            if ((uint)daily["catalog_version"] != Protocol.CatalogVersion)
                throw new FormatException("Daily catalog version is unsupported");
            if ((uint)daily["pressure"]["max_moves"] != Protocol.DailyMaxMoves)
                throw new FormatException("Daily move limit differs from protocol: expected " + Protocol.DailyMaxMoves + ", observed " + (uint)daily["pressure"]["max_moves"]);
            if ((byte)daily["map_id"] != realm || (byte)daily["daily_theme"]["kind"] != theme[0] ||
                (byte)daily["daily_theme"]["value"] != theme[1])
                throw new FormatException("Daily content disagrees with the protocol draw");
        }

        internal static long ValidateClock(long timestamp)
        { if (timestamp < 0 || timestamp / 86400 > uint.MaxValue) throw new ArgumentOutOfRangeException("now"); return timestamp; }
        internal static uint CurrentDay(long timestamp) => checked((uint)(timestamp / 86400));
        internal static string DailyStatus(JObject daily, long timestamp)
        {
            string status = ((JObject)daily["status"]).Properties().Single().Name.ToLowerInvariant();
            return status == "open" && timestamp >= (long)daily["runs_close_at"] ? "frozen"
                : status == "open" && timestamp < (long)daily["opens_at"] ? "not-open" : status;
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
