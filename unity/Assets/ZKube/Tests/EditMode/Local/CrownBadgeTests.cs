using System;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using ZKube.Presentation;

namespace ZKube.Local.Tests
{
    // The Daily crown badge's one rule: the day's leaderboard top beside the live score.
    public sealed class CrownBadgeTests
    {
        [Test] public void TheCrownShowsTheTopUntilTheScorePassesItAndNothingWithoutATop()
        {
            // No top: no read, a read still out, a failed or cancelled read, an empty board.
            var pending = new TaskCompletionSource<ulong?>();
            var cancelled = new TaskCompletionSource<ulong?>(); cancelled.SetCanceled();
            foreach (var read in new[] { null, pending.Task, Task.FromException<ulong?>(new InvalidOperationException("read failed")),
                cancelled.Task, Task.FromResult<ulong?>(null), Task.FromResult<ulong?>(0) })
            {
                Assert.That(CrownBadge.Top(read), Is.Null);
                Assert.That(CrownBadge.State(CrownBadge.Top(read), 500), Is.EqualTo(Crown.Hidden), "never a copy of the score");
            }
            ulong? top = CrownBadge.Top(Task.FromResult<ulong?>(840));
            Assert.That(top, Is.EqualTo(840));
            Assert.That(CrownBadge.State(top, 0), Is.EqualTo(Crown.Below));
            Assert.That(CrownBadge.State(top, 839), Is.EqualTo(Crown.Below));
            Assert.That(CrownBadge.State(top, 840), Is.EqualTo(Crown.Below), "A score equal to the top has not passed it");
            Assert.That(CrownBadge.State(top, 841), Is.EqualTo(Crown.Beaten));
            // A read that lands later gives its top then.
            pending.SetResult(12);
            Assert.That(CrownBadge.State(CrownBadge.Top(pending.Task), 3), Is.EqualTo(Crown.Below));
        }
    }
}
