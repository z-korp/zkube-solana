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

    // What a Daily board shows beside its run: the player's best score, when
    // entries close (Unix seconds) and the clock that counts down to it.
    public sealed class DailyContext
    {
        public ulong Best;
        public long ClosesAt;
        public Func<long> Now;
    }

    public sealed class BoardSession
    {
        public CoreRunToken Accepted { get; internal set; }
        public readonly BuildConfigRequest Rules;
        public readonly IBoardActionProvider Actions;
        public readonly bool Daily;
        public readonly byte RealmId;
        public readonly string Title;
        // A Daily's best and close; null for a Campaign run or a host without them.
        public readonly DailyContext DailyFacts;
        public BoardSession(CoreRunToken accepted, BuildConfigRequest rules, IBoardActionProvider actions, string title, byte realmId,
            DailyContext daily = null)
        {
            Accepted = accepted ?? throw new ArgumentNullException(nameof(accepted));
            Rules = rules ?? throw new ArgumentNullException(nameof(rules));
            Actions = actions ?? throw new ArgumentNullException(nameof(actions));
            Daily = rules.TierPolicy == 1;
            if (!System.Linq.Enumerable.Any(Protocol.Realms, realm => realm.MapId == realmId))
                throw new ArgumentOutOfRangeException(nameof(realmId), "No authored realm has this identity");
            RealmId = realmId; Title = title ?? ""; DailyFacts = Daily ? daily : null;
            // Config comes from the authoritative boundary, including all rules
            // and replay fields. Do not pair a HUD with unrelated state/config.
            byte[] encoded = NativeEngine.BuildConfig(rules);
            if (!System.Linq.Enumerable.SequenceEqual(encoded, accepted.Config))
                throw new ArgumentException("HUD configuration differs from the accepted run");
            NativeEngine.Summary(accepted);
        }
    }
}
