using System;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    public enum BoardActionKind { Move, Guardian, Reroll, Abandon }
    public readonly struct BoardAction
    {
        public readonly BoardActionKind Kind;
        public readonly byte Row, Start, Destination;
        public BoardAction(BoardActionKind kind, byte row = 0, byte start = 0, byte destination = 0)
        { Kind = kind; Row = row; Start = start; Destination = destination; }
    }

    // The provider returns accepted native transitions or explicit snapshots. A timeout
    // must recover the accepted action before it allows a retry; the view never
    // interprets a submitted signature or local drag as committed gameplay.
    public interface IBoardActionProvider
    {
        Task<BoardActionResult> Submit(CoreRunToken accepted, BoardAction action, CancellationToken cancellation);
        Task<BoardActionResult> ResolveVrf(CoreRunToken accepted, CancellationToken cancellation);
    }

    public interface IBoardRecoveryProvider
    {
        // Observe the bound run; never resubmit the failed gesture. Return a
        // snapshot, or null when the host must rebind/leave this board.
        Task<BoardActionResult> Recover(CancellationToken cancellation);
    }

    // What a Daily board shows beside its run: the day's leaderboard top as
    // its read will give it (read once as the run opens), the player's own best
    // score (for the result's sound and the score plate's width), when entries
    // close (Unix seconds) and the clock that counts down to it.
    public sealed class DailyContext
    {
        public Task<ulong?> Top;
        public ulong Best;
        public long ClosesAt;
        public Func<long> Now;
    }

    // The Daily's crown badge: hidden without a top, the dim crown with the top's
    // number below it, the gold crown alone once this run's score passes it.
    public enum Crown { Hidden, Below, Beaten }
    public static class CrownBadge
    {
        // The top a read gave: none while it is out, when it failed or was
        // cancelled, and for an empty board.
        public static ulong? Top(Task<ulong?> read) =>
            read != null && read.Status == TaskStatus.RanToCompletion && read.Result is ulong top && top > 0 ? top : (ulong?)null;
        // A score equal to the top has not passed it.
        public static Crown State(ulong? top, ulong score) => top == null ? Crown.Hidden : score > top.Value ? Crown.Beaten : Crown.Below;
    }

    public sealed class BoardSession
    {
        public CoreRunToken Accepted { get; internal set; }
        public readonly BuildConfigRequest Rules;
        public readonly IBoardActionProvider Actions;
        public readonly bool Daily;
        public readonly byte RealmId;
        // A Daily's best and close; null for a Campaign run or a host without them.
        public readonly DailyContext DailyFacts;
        public BoardSession(CoreRunToken accepted, BuildConfigRequest rules, IBoardActionProvider actions, byte realmId,
            DailyContext daily = null)
        {
            Accepted = accepted ?? throw new ArgumentNullException(nameof(accepted));
            Rules = rules ?? throw new ArgumentNullException(nameof(rules));
            Actions = actions ?? throw new ArgumentNullException(nameof(actions));
            Daily = rules.TierPolicy == 1;
            if (!System.Linq.Enumerable.Any(Protocol.Realms, realm => realm.MapId == realmId))
                throw new ArgumentOutOfRangeException(nameof(realmId), "No authored realm has this identity");
            RealmId = realmId; DailyFacts = Daily ? daily : null;
            // Config comes from the authoritative boundary, including all rules
            // and replay fields. Do not pair a HUD with unrelated state/config.
            byte[] encoded = NativeEngine.BuildConfig(rules);
            if (!System.Linq.Enumerable.SequenceEqual(encoded, accepted.Config))
                throw new ArgumentException("HUD configuration differs from the accepted run");
            NativeEngine.Summary(accepted);
        }
    }
}
