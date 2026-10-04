using System;
using System.Collections;
using System.Linq;
using System.Threading.Tasks;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;

namespace ZKube.Presentation.Tests
{
    // The Daily crown badge on the HUD (CrownBadge): hidden without a top, the
    // dim crown and the top's number below it, the gold crown alone once the run
    // passes it, with its moment once.
    public sealed class DailyCrownTests
    {
        private GameObject root;
        private BoardController board;
        private BoardHarness evidence;

        [UnitySetUp] public IEnumerator SetUp()
        {
            root = new GameObject("Daily crown tests");
            board = root.AddComponent<BoardController>();
            evidence = root.AddComponent<BoardHarness>(); evidence.AutoStart = false;
            board.SetMuted(true); board.SetReducedMotion(false);
            yield return null;
        }
        [UnityTearDown] public IEnumerator TearDown() { UnityEngine.Object.Destroy(root); yield return null; }
        private IEnumerator Wait(Func<bool> predicate, string reason)
        {
            float deadline = Time.realtimeSinceStartup + 20;
            while (!predicate()) { if (Time.realtimeSinceStartup > deadline) Assert.Fail(reason); yield return null; }
        }
        private IEnumerator Load(Task<ulong?> top, string fixture = "realm-8-daily")
        {
            evidence.Daily = new DailyContext { Top = top, ClosesAt = 3600, Now = () => 0 };
            evidence.Load(fixture);
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board) && !board.Busy, "The board did not settle");
            Assert.That(board.Session.Daily, Is.True);
            yield return null;
        }
        private Image Piece(string name) => board.View.GetComponentsInChildren<Image>(true).Single(image => image.name == name);
        private TMP_Text Number => board.View.GetComponentsInChildren<TMP_Text>(true).Single(text => text.name == "Best");
        private void AssertShown(Crown crown, string number, string at)
        {
            Assert.That(board.View.CrownShown, Is.EqualTo(crown), at);
            Assert.That(Piece("Best badge").enabled && Piece("Best crown").enabled, Is.EqualTo(crown != Crown.Hidden), at + ": the badge");
            Assert.That(Number.enabled, Is.EqualTo(crown == Crown.Below), at + ": the number shows only below the top");
            if (number != null) Assert.That(Number.text, Is.EqualTo(number), at);
            Assert.That(Number.enabled && Number.text == board.State.DailyScore.ToString("N0", System.Globalization.CultureInfo.InvariantCulture) && board.State.DailyScore > 0,
                Is.False, at + ": never a copy of the score");
        }

        [UnityTest] public IEnumerator TheDailyCrownShowsTheDaysTopAndNeverACopyOfTheScore()
        {
            var screen = new Rect(0, 0, Screen.width, Screen.height);
            // A read that fails, or none: no badge.
            yield return Load(Task.FromException<ulong?>(new InvalidOperationException("read failed")));
            AssertShown(Crown.Hidden, null, "a failed read");
            yield return ZKube.Tests.Presentation.Captures.Snap(screen, "daily crown hidden");
            // A read still out shows nothing until it lands, then the top below it.
            var late = new TaskCompletionSource<ulong?>();
            yield return Load(late.Task);
            AssertShown(Crown.Hidden, null, "a read still out");
            late.SetResult(98765); yield return null; yield return null;
            AssertShown(Crown.Below, "98,765", "the read landed");
            Assert.That(Piece("Best crown").color.a, Is.LessThan(1), "Below the top the crown is dim");
            yield return ZKube.Tests.Presentation.Captures.Snap(screen, "daily crown below");
            // A top of 1: the first Daily fixture whose play passes it, once. A
            // fixture's inputs stop at its deadline, which the harness binds apart.
            Image ring = null; int rings = 0; bool lit = false, more = true;
            foreach (var fixture in BoardHarness.Fixtures.Select(value => value.name).Where(name => name.EndsWith("-daily")))
            {
                yield return Load(Task.FromResult<ulong?>(1), fixture);
                AssertShown(Crown.Below, "1", fixture + " before scoring");
                ring = Piece("Best crown ring"); rings = 0; lit = false; more = true; bool ended = false;
                for (int step = 0; step < 40 && !ended && board.State.DailyScore <= 1; step++)
                {
                    var input = evidence.PlayNextInput();
                    while (true)
                    {
                        try { more = input.MoveNext(); } catch (InvalidOperationException) { more = false; ended = true; }
                        if (!more) break;
                        if (ring.enabled && !lit) rings++; lit = ring.enabled; yield return input.Current;
                    }
                    more = true;
                    for (float until = Time.realtimeSinceStartup + 1; Time.realtimeSinceStartup < until;) { if (ring.enabled && !lit) rings++; lit = ring.enabled; yield return null; }
                    if (evidence.Exhausted) break;
                }
                if (board.State.DailyScore > 1) break;
            }
            Assert.That(board.State.DailyScore, Is.GreaterThan(1), "A Daily fixture scores past the top");
            AssertShown(Crown.Beaten, null, "passed");
            Assert.That(Piece("Best crown").color.a, Is.EqualTo(1).Within(.001f), "The crown lights");
            yield return ZKube.Tests.Presentation.Captures.Snap(screen, "daily crown beaten");
            // More play keeps it lit without another moment.
            for (int step = 0; step < 3 && !evidence.Exhausted; step++)
            {
                var input = evidence.PlayNextInput();
                while (true)
                {
                    try { more = input.MoveNext(); } catch (InvalidOperationException) { more = false; }
                    if (!more) break;
                    if (ring.enabled && !lit) rings++; lit = ring.enabled; yield return input.Current;
                }
                for (float until = Time.realtimeSinceStartup + .5f; Time.realtimeSinceStartup < until;) { if (ring.enabled && !lit) rings++; lit = ring.enabled; yield return null; }
            }
            Assert.That(rings, Is.EqualTo(1), "The new top's moment plays once");
            AssertShown(Crown.Beaten, null, "still passed");
        }
    }
}
