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
        // Whether the game has launched, as the protocol account said in this read.
        public bool Launched { get; }
        internal MoneyKreditState(PlayerProfile profile, PendingTransaction pending, ExecutionResult previous, bool launched)
        { Profile = profile; Pending = pending; PreviousOperation = previous; Launched = launched; }
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
                // The balance and the launch state are read together: one round trip, not two.
                var reading = services.Products.Profile(token); var launching = services.PublicDaily.Launched(token);
                await Task.WhenAll(reading, launching).ConfigureAwait(false);
                var pending = await services.Journal.Load(lease.Owner).ConfigureAwait(false);
                return new MoneyKreditState(reading.Result.Value, pending, ReadOwnerOperation(out _), launching.Result);
            }).ConfigureAwait(false);
            var value = read.Value;
            return new MoneyRead<MoneyKreditState>(value, () => read.IsCurrent && CurrentOwnerOperation(value.PreviousOperation));
        }

        // Today's Score board top for the Daily crown, read once as a run opens.
        // Any failure is no top: the board then shows no badge.
        public async Task<ulong?> DailyTop(uint day)
        {
            try { return (await services.Products.ScoreTop(day).ConfigureAwait(false)).Value; }
            catch (Exception error) { ZKube.Integration.Transport.ClientLog.Failure("daily top", error); return null; }
        }

        // A day's two boards as the chain holds them, read beside the landing
        // page's Daily: no profile, session or journal rides with it.
        public async Task<DailyBoards> Boards(uint day, CancellationToken cancellation = default) =>
            (await services.Products.SettledBoards(day, cancellation).ConfigureAwait(false)).Value;

        // The rewards this address can still claim: its unclaimed positions on
        // the sealed boards of the claim window before today, by the read an
        // entry makes to carry claims; oldest day first, Score before the Theme.
        public async Task<(uint Day, string Kind)[]> ClaimableRewards(uint today, long now, CancellationToken cancellation = default)
        {
            string owner = services.Identity.Owner;
            if (owner == null) return Array.Empty<(uint, string)>();
            return (await services.Runs.EntryClaims(owner, today, cancellation).ConfigureAwait(false))
                .Where(reward => !reward.Claimed && now <= reward.SealedAt + (long)ZKube.Core.Generated.Protocol.ClaimWindowSeconds)
                .OrderBy(reward => reward.DayId).ThenBy(reward => reward.Kind == "score" ? 0 : 1).Select(reward => (reward.DayId, reward.Kind)).ToArray();
        }
        // More of a sealed board's places below its paying rows; how many were added.
        public Task<int> MoreStandings(PrizeBoard board, CancellationToken cancellation = default) => services.Products.MoreStandings(board, cancellation);

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

        public Task<MoneyRead<ExecutionResult>> SettleDailies(CancellationToken cancellation = default) =>
            ChangeEconomy(token => services.Economy.SettleDailies(token), cancellation);

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
