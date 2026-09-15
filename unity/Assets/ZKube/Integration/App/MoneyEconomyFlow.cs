using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Integration.Client;
using ZKube.Integration.Execution;

namespace ZKube.Integration.App
{
    public sealed class MoneyKreditState
    {
        public PlayerProfile Profile { get; }
        public PendingTransaction Pending { get; }
        public ExecutionResult PreviousOperation { get; }
        internal MoneyKreditState(PlayerProfile profile, PendingTransaction pending, ExecutionResult previous)
        { Profile = profile; Pending = pending; PreviousOperation = previous; }
    }

    public sealed class MoneyRewardState
    {
        public DailyBoards Boards { get; }
        public PlayerProfile Profile { get; }
        public SessionAssessment Session { get; }
        public PendingTransaction Pending { get; }
        public ExecutionResult PreviousOperation { get; }
        internal MoneyRewardState(DailyBoards boards, PlayerProfile profile, SessionAssessment session,
            PendingTransaction pending, ExecutionResult previous)
        { Boards = boards; Profile = profile; Session = session; Pending = pending; PreviousOperation = previous; }
    }

    public sealed partial class MoneyAppFlow
    {
        private int changingEconomy;
        public async Task<MoneyRead<MoneyKreditState>> RefreshKredits(CancellationToken cancellation = default)
        {
            var read = await ReadOwnerProduct(cancellation, async (lease, token) => {
                var profile = await services.Products.Profile(token).ConfigureAwait(false);
                var pending = await services.Journal.Load(lease.Owner).ConfigureAwait(false);
                return new MoneyKreditState(profile.Value, pending, ReadOwnerOperation(out _));
            }).ConfigureAwait(false);
            var value = read.Value;
            return new MoneyRead<MoneyKreditState>(value, () => read.IsCurrent && CurrentOwnerOperation(value.PreviousOperation));
        }

        // A reward page observes each sealing window and the actual profile.
        // Opening it does not reconcile a pending claim or authorize a session.
        public async Task<MoneyRead<MoneyRewardState>> RefreshRewards(uint day, CancellationToken cancellation = default)
        {
            var read = await ReadOwnerProduct(cancellation, async (lease, token) => {
                var boards = await services.Products.SettledBoards(day, token).ConfigureAwait(false);
                var profile = await services.Products.Profile(token).ConfigureAwait(false);
                var session = await services.SessionLifecycle.Inspect().ConfigureAwait(false);
                var pending = await services.Journal.Load(lease.Owner).ConfigureAwait(false);
                return new MoneyRewardState(boards.Value, profile.Value, session, pending, ReadOwnerOperation(out _));
            }).ConfigureAwait(false);
            var value = read.Value;
            return new MoneyRead<MoneyRewardState>(value, () => read.IsCurrent && CurrentOwnerOperation(value.PreviousOperation));
        }

        public Task<MoneyRead<ExecutionResult>> BuyKredits(uint pack, CancellationToken cancellation = default)
        {
            if (!SessionViewPolicy.KreditPacks.Contains(pack)) throw new ArgumentOutOfRangeException(nameof(pack));
            return ChangeEconomy(token => services.Economy.Buy(pack, token), cancellation);
        }

        public Task<MoneyRead<ExecutionResult>> SetFeaturedIdentity(byte emblem, byte frame, CancellationToken cancellation = default) =>
            ChangeEconomy(token => services.Economy.SetFeaturedIdentity(emblem, frame, token), cancellation);

        public Task<MoneyRead<ExecutionResult>> ClaimDaily(uint day, string kind, CancellationToken cancellation = default)
        {
            if (kind != "score" && kind != "theme") throw new ArgumentException("Unknown Daily board", nameof(kind));
            return ChangeEconomy(token => services.Economy.Claim(day, kind, token), cancellation);
        }

        // Shared owner lifetime and receipt publication; a second tap rejects
        // immediately instead of queuing a second wallet approval or claim.
        private Task<MoneyRead<ExecutionResult>> ChangeEconomy(Func<CancellationToken, Task<ExecutionResult>> change, CancellationToken cancellation)
        {
            if (Interlocked.CompareExchange(ref changingEconomy, 1, 0) != 0)
                throw new InvalidOperationException("An economy request is already finishing");
            return Change();
            async Task<MoneyRead<ExecutionResult>> Change()
            {
                try
                {
                    return await WithRunOwner(null, cancellation, async (lease, token) => {
                        var result = await change(token).ConfigureAwait(false);
                        // A blocked new intent is not a replacement receipt for
                        // the existing transaction. Keep the earlier operation
                        // and surface the blocking condition to the page.
                        if (result.Code == "pending-transaction-exists" || result.Code == "execution-busy")
                            throw new InvalidOperationException("Check the existing transaction before another economy request");
                        RememberOwnerOperation(lease, result);
                        return result;
                    }).ConfigureAwait(false);
                }
                finally { Volatile.Write(ref changingEconomy, 0); }
            }
        }
    }
}
