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
    // Hosts read Value at publication, after dispatching onto their UI thread.
    // Retained data is rejected after identity change, supersession or shutdown.
    public sealed class MoneyRead<T>
    {
        private readonly T value;
        private readonly Func<bool> current;
        public bool IsCurrent => current();
        public T Value => IsCurrent ? value : throw new OperationCanceledException("Money application observation changed");
        public MoneyRead(T value, Func<bool> current) { this.value = value; this.current = current; }
        internal MoneyRead(ClientIdentity identity, IdentityLease lease, T value)
            : this(value, () => identity.HasCurrentData(lease)) { }
    }
    // Finite, read-only queries. Account transport verifies Base genesis, and
    // AccountBindings owns byte/PDA validation. No subscription, durable write,
    // wallet operation, or per-owner cache belongs to this facade.
    public sealed partial class ProductQueries
    {
        public const uint MaximumVerifiedQualifiedPlayers = 100000;
        private readonly ClientIdentity identity;
        private readonly AccountBindings accounts;
        private readonly TransactionPlanner addresses;
        private readonly SolanaRpcTransport rpc;
        private readonly Func<long> now;
        public ProductQueries(ClientIdentity identity, AccountBindings accounts, TransactionPlanner addresses,
            SolanaRpcTransport rpc, Func<long> now)
        { this.identity = identity; this.accounts = accounts; this.addresses = addresses; this.rpc = rpc;
            this.now = now; }

        public Task<MoneyRead<PlayerProfile>> Profile(CancellationToken cancellation = default) => Read(cancellation, async (lease, token) => {
            var read = await rpc.ReadAccount(rpc.Base, addresses.Player(lease.Owner), cancellation: token).ConfigureAwait(false);
            return Profile(lease.Owner, read);
        });

        internal Task<MoneyRead<string>> PurchaseDestination(CancellationToken cancellation) => Read(cancellation, async (_, token) => {
            var read = await rpc.ReadAccount(rpc.Base, addresses.ProtocolAddress, cancellation: token).ConfigureAwait(false);
            if (read.Envelope == null) throw new InvalidOperationException("Protocol is unavailable");
            return (string)accounts.ProtocolConfig(read.Envelope)["team_destination"];
        });

        public Task<MoneyRead<CampaignProgress>> Campaign(CancellationToken cancellation = default) => Read(cancellation, async (lease, token) => {
            var read = await rpc.ReadAccount(rpc.Base, addresses.Player(lease.Owner), cancellation: token).ConfigureAwait(false);
            var player = Profile(lease.Owner, read);
            byte[] packed = player.Fields?["campaign_stars"].Values<byte>().ToArray() ?? new byte[25];
            return CampaignProgress.FromStars(lease.Owner, NativeEngine.CampaignProgress(new byte[100], packed).Stars, player);
        });

        public Task<MoneyRead<DailyLobby>> CurrentDaily(CancellationToken cancellation = default) => Read(cancellation, async (lease, token) => {
            long timestamp = Clock(); uint day = CurrentDay(timestamp);
            var read = await rpc.ReadAccounts(rpc.Base, new[] { addresses.ProtocolAddress,
                addresses.Daily(day), addresses.Player(lease.Owner) }, cancellation: token).ConfigureAwait(false);
            var projection = PublicDailyQuery.Decode(accounts, day, Clock(),
                read.Accounts[0].Envelope, read.Accounts[1].Envelope);
            var profile = Profile(lease.Owner, read.Accounts[2]);
            return new DailyLobby(day, projection.Status, projection.Suspended, projection.ProtocolPaused,
                projection.Realm, projection.ObjectiveKind, projection.ObjectiveValue, projection.PotLamports,
                profile);
        });

        // Explicit day reads have no discovery lookback restriction: an old
        // board sealed recently can still be claimed during its own window.
        public Task<MoneyRead<DailyBoards>> SettledBoards(uint day, CancellationToken cancellation = default) => Read(cancellation, async (lease, token) => {
            long timestamp = Clock();
            var read = await rpc.ReadAccounts(rpc.Base, new[] { addresses.Daily(day), addresses.Board(day, "score"), addresses.Board(day, "theme") }, cancellation: token).ConfigureAwait(false);
            var daily = read.Accounts[0].Envelope == null ? null : accounts.ArenaDaily(read.Accounts[0].Envelope, day);
            string dailyStatus = daily == null ? "missing" : DailyStatus(daily, timestamp);
            return new DailyBoards(day, dailyStatus,
                Board(day, "score", read.Accounts[1].Envelope, daily, lease.Owner, timestamp),
                Board(day, "theme", read.Accounts[2].Envelope, daily, lease.Owner, timestamp));
        });

        // A single-board action must not depend on the peer board being present.
        // Both the page and preflight use Board for binding, payouts and expiry.
        public Task<MoneyRead<PrizeBoard>> SettledBoard(uint day, string kind, CancellationToken cancellation = default) => Read(cancellation, async (lease, token) => {
            if (kind != "score" && kind != "theme") throw new ArgumentException("Invalid reward board", nameof(kind));
            var read = await rpc.ReadAccounts(rpc.Base, new[] { addresses.Daily(day), addresses.Board(day, kind) }, cancellation: token).ConfigureAwait(false);
            var daily = read.Accounts[0].Envelope == null ? null : accounts.ArenaDaily(read.Accounts[0].Envelope, day);
            return Board(day, kind, read.Accounts[1].Envelope, daily, lease.Owner, Clock());
        });

        private PrizeBoard Board(uint day, string kind, AccountEnvelope envelope, JObject daily, string owner, long timestamp)
        {
            var board = accounts.ArenaBoard(envelope, day, kind);
            if (board == null) return new PrizeBoard(kind, "missing", "unavailable", null, Array.Empty<PrizeRow>(), owner, null);
            // Native width verification scans the full qualified count. Keep
            // untrusted reads inside the existing client/keeper work envelope;
            // this does not cap protocol width or substitute a truncated payout.
            if (board.QualifiedCount > MaximumVerifiedQualifiedPlayers)
                return new PrizeBoard(kind, "unsupported-verification", "unavailable", null, Array.Empty<PrizeRow>(), owner, null);
            var payouts = ValidateBoardEconomics(board, daily);
            if (!board.Sealed) return new PrizeBoard(kind, "unsealed", "unsealed", null, Array.Empty<PrizeRow>(), owner, board);
            long expiry = checked(board.SealedAt + (long)Protocol.ClaimWindowSeconds);
            bool expired = timestamp > expiry;
            var rows = board.Rows.Select(row => new PrizeRow(row, kind, payouts[row.Position])).ToArray();
            var yours = rows.SingleOrDefault(row => row.Record.Player == owner);
            string claim = daily == null ? "unavailable" : expired || (bool)daily["claims_expired"] ? "expired"
                : yours == null ? "no-placement" : yours.Record.Claimed ? "claimed" : "claimable";
            return new PrizeBoard(kind, expired ? "expired" : rows.Length == 0 ? "empty" : "sealed", claim, expiry, rows, owner, board);
        }

        private static ulong[] ValidateBoardEconomics(ValidatedBoardAccount board, JObject daily)
        {
            // Mirrors validate_finalized_board_binding. The finalized pool comes
            // from accounted payouts+rollover, never the remaining claim balance.
            if (daily != null)
            {
                if (!string.Equals(((JObject)daily["status"]).Properties().Single().Name, "Finalized", StringComparison.OrdinalIgnoreCase))
                    throw new FormatException("Prize board requires its finalized Daily");
                var ledger = daily["ledger"];
                var funded = new BigInteger((ulong)ledger["payout_lamports"]) + (ulong)ledger["rollover_out_lamports"];
                if (funded > ulong.MaxValue) throw new FormatException("Finalized Daily ledger overflows its pool");
                var pools = NativeEngine.BoardPools((ulong)funded, (uint)daily["theme_qualified_players"]);
                ulong pool = NativeWire.Read(pools, board.Kind == "score" ? 0 : 8, 8);
                if (board.PoolLamports != pool || board.QualifiedCount != (uint)daily[board.Kind + "_qualified_players"])
                    throw new FormatException("Prize board pool or qualification count differs from finalized Daily");
            }
            // Core owns width, denominator and each rounded payout. This only
            // applies the program's retained-account capacity and checks headers.
            var width = NativeEngine.BoardWidth(board.PoolLamports, board.QualifiedCount);
            uint widthCount = checked((uint)NativeWire.Read(width, 0, 4));
            var denominator = NativeWire.Bytes(width, 4, 16);
            uint count = Math.Min(widthCount, Protocol.ArenaBoardCapacity);
            if (board.PayoutCount != count || board.WidthCount != widthCount ||
                board.CapacityLimited != (count < widthCount) ||
                board.Denominator != new BigInteger(denominator.Concat(new byte[] { 0 }).ToArray()))
                throw new FormatException("Prize board does not match the native payout plan");
            var payouts = new ulong[count]; ulong paid = 0, claimed = 0;
            for (uint i = 0; i < count; i++)
            {
                payouts[i] = NativeEngine.PayoutForRank(board.PoolLamports, denominator, i + 1);
                paid = checked(paid + payouts[i]);
                if (board.Sealed && board.Rows[(int)i].Claimed) claimed = checked(claimed + payouts[i]);
            }
            if (paid > board.PoolLamports || board.PaidLamports != paid || board.RolloverLamports != board.PoolLamports - paid ||
                board.ClaimedLamports != claimed)
                throw new FormatException("Prize board paid, rollover or claimed ledger differs from native payouts");
            return payouts;
        }
        private PlayerProfile Profile(string owner, RpcAccount read) => new PlayerProfile(owner,
            read.Envelope == null ? null : accounts.PlayerState(read.Envelope, owner));
        private long Clock() => PublicDailyQuery.ValidateClock(now());
        private static uint CurrentDay(long timestamp) => PublicDailyQuery.CurrentDay(timestamp);
        private static string DailyStatus(JObject daily, long timestamp) => PublicDailyQuery.DailyStatus(daily, timestamp);
        private async Task<MoneyRead<T>> Read<T>(CancellationToken cancellation, Func<IdentityLease, CancellationToken, Task<T>> query)
        {
            var lease = identity.Lease();
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(lease.Cancellation, cancellation);
            linked.Token.ThrowIfCancellationRequested();
            var value = await query(lease, linked.Token).ConfigureAwait(false);
            linked.Token.ThrowIfCancellationRequested();
            if (!identity.IsCurrent(lease)) throw new OperationCanceledException("Product read identity changed");
            return new MoneyRead<T>(identity, lease, value);
        }
    }
}
